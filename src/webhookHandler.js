// @ts-nocheck -- TODO(TS移行): 段階的TypeScript導入の対象外。個別に型を付けて解除する予定
/**
 * webhookHandler.js
 * イベントハンドラーとルーティング（GAS版 Handlers.gs / Steps.gs の移植）
 *
 * GAS版との差分:
 * - ユーザー登録（users シート更新）は事前チェックを待たずfire-and-forgetで行う。
 *   GAS版は同期的に実行し失敗すると本来の操作そのものがエラー扱いになってしまう
 *   構造だったため、Node.js版ではログのみ出す非致命的な処理に変更した。
 * - 編集時の日付列変更に伴う自動再ソート（sortMonthlySheet_）は行わない
 *   （sheetsService.js の設計方針: 新規行は末尾追加、表示時に都度ソート）。
 *
 * 実装はフロー単位で`webhook/`配下に分割し、このファイルはイベントの受付
 * （postback/messageの振り分け・エラーハンドリング）だけを担うバレルファイル
 * として残している（`tests/server.test.js`の
 * `mock.module('../src/webhookHandler.js', ...)`を変更せずに済むように、
 * あえてディレクトリ化はしていない）。
 */

const { client } = require('./lineService');
const db = require('./dbService');
const { nowTimestamp } = require('./utils');
const { handlePostback } = require('./webhook/postbackRouter');
const { handleMessage } = require('./webhook/messageRouter');

async function handleEvents(events) {
  await Promise.all(events.map((ev) => handleEvent(ev).catch((err) => handleEventError(ev, err))));
}

async function handleEventError(ev, err) {
  console.error('event handling failed:', err);
  if (!ev.replyToken) return;
  try {
    await client.replyMessage(ev.replyToken, {
      type: 'text',
      text: err.userMessage || '処理中にエラーが発生しました',
    });
  } catch (replyErr) {
    console.error('failed to notify user of error:', replyErr);
  }
}

async function handleEvent(ev) {
  const userId = ev.source && ev.source.userId;
  const replyToken = ev.replyToken;
  if (!userId || !replyToken) return;

  try {
    db.upsertUser(userId, nowTimestamp());
  } catch (err) {
    console.error('upsertUser failed:', err);
  }

  if (ev.type === 'postback') {
    await handlePostback(ev, userId, replyToken);
  } else if (ev.type === 'message' && ev.message.type === 'text') {
    await handleMessage(ev, userId, replyToken);
  }
}

module.exports = { handleEvents };
