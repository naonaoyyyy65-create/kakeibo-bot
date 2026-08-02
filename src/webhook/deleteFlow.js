// @ts-nocheck -- TODO(TS移行): 段階的TypeScript導入の対象外。個別に型を付けて解除する予定
/**
 * webhook/deleteFlow.js
 * ステップハンドラー：削除フロー（旧webhookHandler.jsの分割時に抽出）。
 */

const { client } = require('../lineService');
const { setState, clearState } = require('../state');
const db = require('../dbService');
const mirror = require('../sheetsMirrorService');
const flex = require('../flexBuilders');
const { ACT, STEP, UI_COLORS } = require('../config');

async function handleStepAskMonthDelete(state, data, replyToken, userId) {
  if (data.act !== ACT.DELETE_MONTH) return;
  db.assertMonthEditable(data.v);

  const entries = db.getMonthlyEntries(data.v);
  if (entries.length === 0) {
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildEmpty('データがありません'));
    return;
  }

  setState(userId, { step: STEP.CONFIRM_DELETE, data: { ym: data.v } });
  await client.replyMessage(replyToken, flex.buildDeleteRowList(data.v, entries));
}

async function handleStepConfirmDelete(state, data, replyToken, userId) {
  if (data.act !== ACT.DELETE_ROW) return;
  const id = Number(data.v);
  db.deleteEntryById(state.data.ym, id);
  mirror.mirrorDeleteEntry(state.data.ym, id).catch((err) => console.error('mirror delete failed:', err));
  clearState(userId);
  await client.replyMessage(replyToken, flex.buildToast('削除しました', { icon: '🗑️', color: UI_COLORS.danger }));
}

module.exports = { handleStepAskMonthDelete, handleStepConfirmDelete };
