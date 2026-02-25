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
- コメントはサーバーメモリ上に保持（サーバー再起動で消えます）
