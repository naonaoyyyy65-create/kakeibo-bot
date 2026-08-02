// @ts-nocheck -- TODO(TS移行): 段階的TypeScript導入の対象外。個別に型を付けて解除する予定
/**
 * webhook/monthFlow.js
 * ステップハンドラー：確認フロー（旧webhookHandler.jsの分割時に抽出）。
 * handleShowMonthはPostbackルーティング・テキストメッセージ双方から使われる。
 */

const { client } = require('../lineService');
const { clearState } = require('../state');
const db = require('../dbService');
const flex = require('../flexBuilders');
const { calcSettlement, calcMonthlyStats } = require('../utils');
const { ACT, PAGE_SIZE } = require('../config');

async function handleStepAskMonth(state, data, replyToken, userId) {
  if (data.act !== ACT.MONTH) return;
  if (data.v === 'other') {
    await client.replyMessage(replyToken, flex.buildOlderMonths());
    return;
  }
  await handleShowMonth(replyToken, userId, data.v);
}

async function handleShowMonth(replyToken, userId, ym) {
  // 読み取り経路はDB主体化済み（2026-07-30〜）。DBはSQLで既に日付順のため
  // クライアント側ソートは不要（以前はSheetsが物理行順のままだったため必要だった）。
  const entries = db.getMonthlyEntries(ym);
  if (entries.length === 0) {
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildEmpty('その月のデータはありません'));
    return;
  }

  clearState(userId);

  const sorted = entries.map((e) => [e.date, e.subject, e.price, e.payer]);
  const settlement = calcSettlement(sorted);
  const stats = calcMonthlyStats(ym, sorted);
  const status = db.getMonthlyStatus(ym);

  // 合計・精算をスクロールせず即確認できるよう、明細一覧より先にサマリーを送る
  const messages = [flex.buildMonthSummary(ym, stats, settlement, status)];
  for (let i = 0; i < sorted.length; i += PAGE_SIZE) {
    const page = sorted.slice(i, i + PAGE_SIZE);
    messages.push(flex.buildMonthlyFlex(ym, page, null, null));
  }

  await client.replyMessage(replyToken, messages);
}

module.exports = { handleStepAskMonth, handleShowMonth };
