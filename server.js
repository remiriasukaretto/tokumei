const http = require('http');
const fs = require('fs');
const path = require('path');

const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '127.0.0.1';
const PUBLIC_DIR = path.join(__dirname, 'public');

const comments = [];
const sseClients = new Set();

function sendJson(res, statusCode, payload) {
  const body = JSON.stringify(payload);
  res.writeHead(statusCode, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': Buffer.byteLength(body),
  });
  res.end(body);
}

function broadcastComment(comment) {
  const data = `data: ${JSON.stringify(comment)}\n\n`;
  for (const client of sseClients) {
    client.write(data);
  }
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
      res.write(`data: ${JSON.stringify(comment)}\n\n`);
    }

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

  if (req.method === 'POST' && url.pathname === '/comments') {
    let raw = '';

    req.on('data', (chunk) => {
      raw += chunk;
    });

    req.on('end', () => {
      try {
        const { message, name } = JSON.parse(raw || '{}');

        if (!message || typeof message !== 'string') {
          sendJson(res, 400, { error: 'message is required' });
          return;
        }

        const comment = {
          id: Date.now(),
          name: (name && String(name).trim()) || '匿名',
          message: message.trim(),
          createdAt: new Date().toISOString(),
        };

        comments.push(comment);
        broadcastComment(comment);
        sendJson(res, 201, comment);
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
