/**
 * server.js
 * Expressサーバーのエントリポイント（GAS版 doPost 相当）
 */

const express = require('express');
const { SignatureValidationFailed, JSONParseError } = require('@line/bot-sdk');
const config = require('./config');
const { middleware: lineMiddleware } = require('./lineService');
const { handleEvents } = require('./webhookHandler');
const { handleSheetsSyncRequest } = require('./sheetsSyncHandler');

const app = express();

app.get('/health', (_req, res) => res.status(200).send('ok'));

// 注意: line.middleware は署名検証のため生のリクエストボディを必要とする。
// このルートより前にexpress.json()等のbody parserを挟まないこと。
app.post('/webhook', lineMiddleware, (req, res) => {
  // LINEには先に200を返し、実処理は非同期で行う（GAS版のdoPostと同じ方針）
  res.status(200).send('OK');
  const events = req.body.events || [];
  console.log(`webhook received: ${events.length}件のイベント`);
  handleEvents(events).catch((err) => {
    console.error('webhook handling failed:', err);
  });
});

// スプレッドシート直接編集の同期用（GAS onEditインストール型トリガーから呼ばれる、2026-07-30〜）。
// express.json()はこのルートにだけ適用し、/webhookの生ボディ要件には影響させない。
app.post('/sheets-sync', express.json(), (req, res) => {
  const secret = req.get('X-Sync-Secret');
  if (!config.SHEETS_SYNC_SHARED_SECRET || secret !== config.SHEETS_SYNC_SHARED_SECRET) {
    res.status(401).json({ error: 'unauthorized' });
    return;
  }
  try {
    const result = handleSheetsSyncRequest(req.body);
    res.status(200).json(result);
  } catch (err) {
    console.error('sheets-sync failed:', err);
    res.status(400).json({ error: err.userMessage || err.message });
  }
});

// lineMiddleware(署名検証)が投げるエラーはstatusCodeを持たないため、ハンドラー未設置だと
// Expressのデフォルトエラーハンドラーに落ちて500になってしまう（2026-08-02、supertestの
// 統合テスト追加時に発覚・修正。不正/欠落した署名は401、Webhook本文のJSONパース失敗は400が適切）。
// eslint-disable-next-line no-unused-vars
app.use((err, _req, res, next) => {
  if (err instanceof SignatureValidationFailed) {
    res.status(401).send('signature validation failed');
    return;
  }
  if (err instanceof JSONParseError) {
    res.status(400).send('invalid request body');
    return;
  }
  console.error('unhandled error:', err);
  res.status(500).send('internal server error');
});

// テスト（supertest）からrequireした場合はlistenせず、appだけをexportする。
// 本番実行（node src/server.js）の場合のみ実際にポートを開く。
// このブロックはテストプロセス内では常にfalseになり子プロセスを立てないと実行できないため、
// カバレッジ計測からは意図的に除外する。
/* node:coverage ignore next 5 */
if (require.main === module) {
  app.listen(config.PORT, () => {
    console.log(`kakeibo-bot listening on port ${config.PORT}`);
  });
}

module.exports = app;
