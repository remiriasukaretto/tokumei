# tokumei

クライアントPCで入力したコメントを、ホスト側でリアルタイム表示するシンプルなWebアプリです。

## 使い方

1. サーバー起動

```bash
node server.js
```

2. ブラウザでアクセス
- クライアント入力画面: `http://localhost:3000/client`
- ホスト監視画面: `http://localhost:3000/host`

## 仕様
- クライアントは `/comments` へ POST でコメント送信
- ホストは `EventSource` (`/events`) で新着コメントをリアルタイム受信
- クライアント画面で「このブラウザで送信した履歴」を確認可能（ブラウザ `localStorage` 利用）
- ホスト画面で各コメントに `いいね/ハート/笑` リアクションを付与可能（`POST /comments/:id/reactions`）
- ホスト画面で各コメントへ返信可能（`POST /comments/:id/replies`）
- NG候補ワード（例: `死ね`, `kill`, `fuck`）を含む投稿は拒否し、該当語を自動でNGワードに追加
- 現在のNGワード一覧は `/ng-words` で取得でき、ホスト画面にも表示
- コメント/NGワードはサーバーメモリ上に保持（サーバー再起動で消えます）
