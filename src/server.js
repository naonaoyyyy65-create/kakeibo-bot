/**
 * server.js
 * Expressサーバーのエントリポイント（GAS版 doPost 相当）
 */

const express = require('express');
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

app.listen(config.PORT, () => {
  console.log(`kakeibo-bot listening on port ${config.PORT}`);
});
