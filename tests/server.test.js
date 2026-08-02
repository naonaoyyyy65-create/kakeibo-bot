// server.js は express.json() 等のbody parserを/webhookより前段に挟めない制約
// （LINEの署名検証が生ボディを必要とするため）を持つため、実際の起動順序・
// ミドルウェア構成ごと検証できるよう、webhookHandler/sheetsSyncHandlerだけを
// モックしてExpressアプリ全体にHTTPリクエストを送るsupertest統合テストにした。
// これにより、これまでのユニットテスト（webhookHandler.test.js等）では
// 検証されていなかった「LINE署名検証」「ルーティング」「/sheets-syncの認証」を
// server.js の実装のまま確認できる。
process.env.LINE_CHANNEL_SECRET = 'test-channel-secret';
process.env.LINE_CHANNEL_ACCESS_TOKEN = 'test-channel-access-token';
process.env.SHEETS_SYNC_SHARED_SECRET = 'test-sync-secret';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'dummy';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');
const crypto = require('crypto');
const request = require('supertest');

const webhookHandlerMocks = {
  handleEvents: mock.fn((/** @type {any[]} */ _events) => Promise.resolve()),
};
mock.module('../src/webhookHandler.js', { exports: webhookHandlerMocks });

const sheetsSyncMocks = {
  handleSheetsSyncRequest: mock.fn((/** @type {any} */ _body) => ({ ok: true })),
};
mock.module('../src/sheetsSyncHandler.js', { exports: sheetsSyncMocks });

const app = require('../src/server');

function lineSignature(rawBody) {
  return crypto.createHmac('sha256', process.env.LINE_CHANNEL_SECRET).update(rawBody).digest('base64');
}

function resetAll() {
  webhookHandlerMocks.handleEvents.mock.resetCalls();
  sheetsSyncMocks.handleSheetsSyncRequest.mock.resetCalls();
}

test('GET /health は200 okを返す', async () => {
  const res = await request(app).get('/health');
  assert.equal(res.status, 200);
  assert.equal(res.text, 'ok');
});

test('POST /webhook: 正しい署名なら200を返しhandleEventsへeventsが渡る', async () => {
  resetAll();
  const payload = { events: [{ type: 'message', replyToken: 'tok1' }] };
  const rawBody = JSON.stringify(payload);

  const res = await request(app)
    .post('/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Line-Signature', lineSignature(rawBody))
    .send(rawBody);

  assert.equal(res.status, 200);
  assert.equal(res.text, 'OK');
  // handleEventsは非同期fire-and-forgetなので、呼び出されるまで少し待つ
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(webhookHandlerMocks.handleEvents.mock.callCount(), 1);
  assert.deepEqual(webhookHandlerMocks.handleEvents.mock.calls[0].arguments[0], payload.events);
});

test('POST /webhook: 署名が不正なら拒否されhandleEventsは呼ばれない', async () => {
  resetAll();
  const payload = { events: [] };
  const rawBody = JSON.stringify(payload);

  const res = await request(app)
    .post('/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Line-Signature', 'invalid-signature')
    .send(rawBody);

  assert.equal(res.status, 401);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(webhookHandlerMocks.handleEvents.mock.callCount(), 0);
});

test('POST /webhook: 本文が不正なJSONなら400（署名は正しく計算する）', async () => {
  resetAll();
  const rawBody = 'this is not valid json';

  const res = await request(app)
    .post('/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Line-Signature', lineSignature(rawBody))
    .send(rawBody);

  assert.equal(res.status, 400);
  assert.equal(webhookHandlerMocks.handleEvents.mock.callCount(), 0);
});

test('POST /webhook: handleEventsが失敗してもレスポンスには影響しない（fire-and-forget）', async () => {
  resetAll();
  webhookHandlerMocks.handleEvents.mock.mockImplementationOnce(() => Promise.reject(new Error('boom')));
  const payload = { events: [{ type: 'message', replyToken: 'tok2' }] };
  const rawBody = JSON.stringify(payload);

  const res = await request(app)
    .post('/webhook')
    .set('Content-Type', 'application/json')
    .set('X-Line-Signature', lineSignature(rawBody))
    .send(rawBody);

  assert.equal(res.status, 200);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(webhookHandlerMocks.handleEvents.mock.callCount(), 1);
});

test('POST /sheets-sync: 本文が不正なJSONなら500（bot-sdk固有ではない汎用エラー分岐）', async () => {
  resetAll();
  const res = await request(app)
    .post('/sheets-sync')
    .set('X-Sync-Secret', 'test-sync-secret')
    .set('Content-Type', 'application/json')
    .send('this is not valid json');

  assert.equal(res.status, 500);
  assert.equal(sheetsSyncMocks.handleSheetsSyncRequest.mock.callCount(), 0);
});

test('POST /webhook: 署名ヘッダが無ければ拒否される', async () => {
  resetAll();
  const rawBody = JSON.stringify({ events: [] });

  const res = await request(app).post('/webhook').set('Content-Type', 'application/json').send(rawBody);

  assert.equal(res.status, 401);
  assert.equal(webhookHandlerMocks.handleEvents.mock.callCount(), 0);
});

test('POST /sheets-sync: 正しい共有シークレットならhandleSheetsSyncRequestの結果を返す', async () => {
  resetAll();
  const res = await request(app)
    .post('/sheets-sync')
    .set('X-Sync-Secret', 'test-sync-secret')
    .send({ type: 'status', ym: '2026-07', status: '確定済' });

  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { ok: true });
  assert.equal(sheetsSyncMocks.handleSheetsSyncRequest.mock.callCount(), 1);
  assert.deepEqual(sheetsSyncMocks.handleSheetsSyncRequest.mock.calls[0].arguments[0], {
    type: 'status',
    ym: '2026-07',
    status: '確定済',
  });
});

test('POST /sheets-sync: シークレットが無い/不正なら401でhandleSheetsSyncRequestは呼ばれない', async () => {
  resetAll();
  const noHeader = await request(app).post('/sheets-sync').send({ type: 'status' });
  assert.equal(noHeader.status, 401);

  const wrongHeader = await request(app)
    .post('/sheets-sync')
    .set('X-Sync-Secret', 'wrong-secret')
    .send({ type: 'status' });
  assert.equal(wrongHeader.status, 401);

  assert.equal(sheetsSyncMocks.handleSheetsSyncRequest.mock.callCount(), 0);
});

test('POST /sheets-sync: handleSheetsSyncRequestが例外を投げたら400とuserMessageを返す', async () => {
  resetAll();
  sheetsSyncMocks.handleSheetsSyncRequest.mock.mockImplementationOnce(() => {
    /** @type {Error & {userMessage?: string}} */
    const err = new Error('invalid');
    err.userMessage = 'リクエストの形式が不正です';
    throw err;
  });

  const res = await request(app)
    .post('/sheets-sync')
    .set('X-Sync-Secret', 'test-sync-secret')
    .send({ type: 'bogus' });

  assert.equal(res.status, 400);
  assert.deepEqual(res.body, { error: 'リクエストの形式が不正です' });
});
