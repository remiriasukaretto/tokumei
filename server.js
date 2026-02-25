const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const comments = [];
const sseClients = new Set();
const ngWords = new Set();
const AUTO_NG_CANDIDATES = ['死ね', '殺す', 'fuck', 'shit', 'kill'];
const REACTION_TYPES = ['like', 'love', 'laugh'];

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function sendEvent(res, eventName, payload) {
  res.write(`event: ${eventName}\n`);
  res.write(`data: ${JSON.stringify(payload)}\n\n`);
}

function broadcastEvent(eventName, payload) {
  for (const client of sseClients) {
    sendEvent(client, eventName, payload);
  }
}

function normalizeReactions(reactions) {
  return {
    like: Number(reactions?.like) || 0,
    love: Number(reactions?.love) || 0,
    laugh: Number(reactions?.laugh) || 0,
  };
}

function findCommentById(id) {
  return comments.find((comment) => comment.id === id);
}

function detectNgWords(message) {
  const normalized = String(message).toLowerCase();
  const detectedWords = new Set();
  let autoAddedWords = [];

  for (const word of ngWords) {
    if (normalized.includes(word.toLowerCase())) {
      detectedWords.add(word);
    }
  }

  for (const candidate of AUTO_NG_CANDIDATES) {
    if (!normalized.includes(candidate.toLowerCase())) {
      continue;
    }

    detectedWords.add(candidate);
    if (!ngWords.has(candidate)) {
      ngWords.add(candidate);
      autoAddedWords.push(candidate);
    }
  }

  return {
    detectedWords: [...detectedWords],
    autoAddedWords,
  };
}

function serveFile(res, filePath, contentType) {
  fs.readFile(filePath, (err, data) => {
    if (err) {
      res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
      res.end('Not Found');
      return;
    }

    res.writeHead(200, { 'Content-Type': contentType });
    res.end(data);
  });
}

const server = http.createServer((req, res) => {
  const url = new URL(req.url, `http://${req.headers.host}`);

  if (req.method === 'GET' && url.pathname === '/') {
    res.writeHead(302, { Location: '/client' });
    res.end();
    return;
  }

  if (req.method === 'GET' && url.pathname === '/client') {
    serveFile(res, path.join(PUBLIC_DIR, 'client.html'), 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/host') {
    serveFile(res, path.join(PUBLIC_DIR, 'host.html'), 'text/html; charset=utf-8');
    return;
  }

  if (req.method === 'GET' && url.pathname === '/events') {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream; charset=utf-8',
      'Cache-Control': 'no-cache',
      Connection: 'keep-alive',
    });

    for (const comment of comments) {
      sendEvent(res, 'comment', comment);
    }
    sendEvent(res, 'ng_words_updated', { ngWords: [...ngWords], autoAddedWords: [] });

    sseClients.add(res);

    req.on('close', () => {
      sseClients.delete(res);
    });

    return;
  }

  if (req.method === 'GET' && url.pathname === '/comments') {
    sendJson(res, 200, comments);
    return;
  }

  if (req.method === 'GET' && url.pathname === '/ng-words') {
    sendJson(res, 200, { ngWords: [...ngWords] });
    return;
  }

  if (req.method === 'POST' && url.pathname === '/comments') {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;
    });

    req.on('end', () => {
      try {
        const { message, name } = JSON.parse(raw || '{}');

        if (!message || typeof message !== 'string' || !message.trim()) {
          sendJson(res, 400, { error: 'message is required' });
          return;
        }

        const trimmedMessage = message.trim();
        const { detectedWords, autoAddedWords } = detectNgWords(trimmedMessage);

        if (autoAddedWords.length > 0) {
          broadcastEvent('ng_words_updated', {
            ngWords: [...ngWords],
            autoAddedWords,
          });
        }

        if (detectedWords.length > 0) {
          sendJson(res, 422, {
            error: 'ng words detected',
            detectedWords,
          });
          return;
        }

        const comment = {
          id: Date.now(),
          name: (name && String(name).trim()) || '匿名',
          message: trimmedMessage,
          createdAt: new Date().toISOString(),
          reactions: normalizeReactions(),
          replies: [],
          needsReply: true,
        };

        comments.push(comment);
        broadcastEvent('comment', comment);
        sendJson(res, 201, comment);
      } catch (error) {
        sendJson(res, 400, { error: 'invalid json' });
      }
    });

    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/comments/') && url.pathname.endsWith('/reactions')) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 3 || parts[0] !== 'comments' || parts[2] !== 'reactions') {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    const commentId = Number(parts[1]);
    if (!Number.isFinite(commentId)) {
      sendJson(res, 400, { error: 'invalid comment id' });
      return;
    }

    const comment = findCommentById(commentId);
    if (!comment) {
      sendJson(res, 404, { error: 'comment not found' });
      return;
    }

    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });

    req.on('end', () => {
      try {
        const { type } = JSON.parse(raw || '{}');
        if (!REACTION_TYPES.includes(type)) {
          sendJson(res, 400, { error: 'invalid reaction type' });
          return;
        }

        comment.reactions = normalizeReactions(comment.reactions);
        comment.reactions[type] += 1;

        const payload = {
          commentId,
          reactions: comment.reactions,
        };

        broadcastEvent('reaction_updated', payload);
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, 400, { error: 'invalid json' });
      }
    });

    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/comments/') && url.pathname.endsWith('/replies')) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 3 || parts[0] !== 'comments' || parts[2] !== 'replies') {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    const commentId = Number(parts[1]);
    if (!Number.isFinite(commentId)) {
      sendJson(res, 400, { error: 'invalid comment id' });
      return;
    }

    const comment = findCommentById(commentId);
    if (!comment) {
      sendJson(res, 404, { error: 'comment not found' });
      return;
    }
    if (comment.needsReply === false) {
      sendJson(res, 409, { error: 'reply is not required for this comment' });
      return;
    }

    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });

    req.on('end', () => {
      try {
        const { message, name } = JSON.parse(raw || '{}');
        if (!message || typeof message !== 'string' || !message.trim()) {
          sendJson(res, 400, { error: 'message is required' });
          return;
        }

        const reply = {
          id: Date.now(),
          name: (name && String(name).trim()) || 'ホスト',
          message: message.trim(),
          createdAt: new Date().toISOString(),
        };

        if (!Array.isArray(comment.replies)) {
          comment.replies = [];
        }
        comment.replies.push(reply);

        const payload = {
          commentId,
          reply,
        };
        broadcastEvent('reply_added', payload);
        sendJson(res, 201, payload);
      } catch (error) {
        sendJson(res, 400, { error: 'invalid json' });
      }
    });

    return;
  }

  if (req.method === 'POST' && url.pathname.startsWith('/comments/') && url.pathname.endsWith('/reply-status')) {
    const parts = url.pathname.split('/').filter(Boolean);
    if (parts.length !== 3 || parts[0] !== 'comments' || parts[2] !== 'reply-status') {
      sendJson(res, 404, { error: 'Not Found' });
      return;
    }

    const commentId = Number(parts[1]);
    if (!Number.isFinite(commentId)) {
      sendJson(res, 400, { error: 'invalid comment id' });
      return;
    }

    const comment = findCommentById(commentId);
    if (!comment) {
      sendJson(res, 404, { error: 'comment not found' });
      return;
    }

    let raw = '';
    req.on('data', (chunk) => {
      raw += chunk;
    });

    req.on('end', () => {
      try {
        const { needsReply } = JSON.parse(raw || '{}');
        if (typeof needsReply !== 'boolean') {
          sendJson(res, 400, { error: 'needsReply(boolean) is required' });
          return;
        }

        comment.needsReply = needsReply;
        const payload = { commentId, needsReply };
        broadcastEvent('reply_requirement_updated', payload);
        sendJson(res, 200, payload);
      } catch (error) {
        sendJson(res, 400, { error: 'invalid json' });
      }
    });

    return;
  }

  res.writeHead(404, { 'Content-Type': 'text/plain; charset=utf-8' });
  res.end('Not Found');
});

server.listen(PORT, HOST, () => {
  console.log(`Server running on http://${HOST}:${PORT}`);
  console.log(`Client page: http://${HOST}:${PORT}/client`);
  console.log(`Host page:   http://${HOST}:${PORT}/host`);
});
