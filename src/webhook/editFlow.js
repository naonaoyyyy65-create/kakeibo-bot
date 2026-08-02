// @ts-nocheck -- TODO(TS移行): 段階的TypeScript導入の対象外。個別に型を付けて解除する予定
/**
 * webhook/editFlow.js
 * ステップハンドラー：編集フロー（旧webhookHandler.jsの分割時に抽出）。
 */

const { client } = require('../lineService');
const { setState, clearState } = require('../state');
const db = require('../dbService');
const mirror = require('../sheetsMirrorService');
const flex = require('../flexBuilders');
const { normalizeAmount, getCurrentValueForEdit, formatEditValue } = require('../utils');
const { ACT, STEP, UI_COLORS } = require('../config');
const { ValidationError, StateError } = require('../errors');

async function handleStepAskEditMonth(state, data, replyToken, userId) {
  if (data.act !== ACT.EDIT) return;
  db.assertMonthEditable(data.v);

  const entries = db.getMonthlyEntries(data.v);
  if (entries.length === 0) {
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildEmpty('データがありません'));
    return;
  }

  state.data.ym = data.v;
  state.step = STEP.ASK_EDIT_ROW;
  setState(userId, state);
  await client.replyMessage(replyToken, flex.buildAskRowEdit(entries));
}

async function handleStepAskEditRow(state, data, replyToken, userId) {
  if (data.act !== ACT.EDIT_ROW) {
    throw new StateError(`Unexpected action in ASK_EDIT_ROW: ${data.act}`, '行選択が正しくありません');
  }

  const entryId = Number(data.v);
  if (!entryId) {
    throw new ValidationError(`Invalid entry id: ${data.v}`, '行選択が正しくありません');
  }

  // idはDB全体で一意（月をまたいで採番）なので、選択中の月(state.data.ym)と
  // 一致するかも合わせて確認する（別月の古いpostbackが誤って使われる事故を防ぐ）。
  const entry = db.getEntryById(entryId);
  if (!entry || entry.ym !== state.data.ym) {
    throw new ValidationError(`Entry ${entryId} not found in ${state.data.ym}`, '選択された行が見つかりません');
  }

  state.data.entryId = entryId;
  state.data.current = { date: entry.date, subject: entry.subject, price: entry.price, payer: entry.payer };
  state.step = STEP.ASK_EDIT_COLUMN;
  setState(userId, state);

  await client.replyMessage(replyToken, flex.buildEditColumnSelect([entry.date, entry.subject, entry.price, entry.payer]));
}

async function handleStepAskEditColumn(state, data, replyToken, userId) {
  if (data.act !== ACT.EDIT_COLUMN) {
    await client.replyMessage(replyToken, { type: 'text', text: '項目選択が正しくありません' });
    return;
  }

  state.data.column = data.v;
  state.step = STEP.WAIT_EDIT_VALUE;
  setState(userId, state);

  const currentText = getCurrentValueForEdit(state.data.current, data.v);
  await client.replyMessage(replyToken, flex.buildEditValuePrompt(data.v, currentText));
}

async function handleStepWaitEditValue(state, data, replyToken, userId, params = {}) {
  let newValue = data.v;

  // DBの日付列は'yyyy-MM-dd'(ISO)で保持するため、以前のようなスラッシュ変換はしない
  // （Sheetsミラー側でmirrorUpdateEntryが'yyyy/MM/dd'への変換を行う）。
  if (state.data.column === '日付' && params.date) newValue = params.date;
  if (!newValue && data.text) newValue = data.text;
  if (state.data.column === '値段') newValue = normalizeAmount(newValue);

  state.data.newValue = newValue;
  state.step = STEP.CONFIRM_EDIT;
  setState(userId, state);

  const currentText = getCurrentValueForEdit(state.data.current, state.data.column);
  const newText = formatEditValue(state.data.column, newValue);
  await client.replyMessage(replyToken, flex.buildEditConfirm(state.data.column, currentText, newText));
}

async function handleStepConfirmEdit(state, data, replyToken, userId) {
  if (data.act === ACT.SAVE_EDIT) {
    await saveEdit(state);
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildToast('編集内容を保存しました'));
    return;
  }
  if (data.act === ACT.CANCEL) {
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildToast('編集をキャンセルしました', { icon: '✖️', color: UI_COLORS.textLight }));
  }
}

async function saveEdit(state) {
  const fieldMap = {
    日付: 'date',
    題目: 'subject',
    値段: 'price',
    払った人: 'payer',
  };
  const field = fieldMap[state.data.column];
  const updated = db.updateEntryById(state.data.ym, state.data.entryId, { [field]: state.data.newValue });
  mirror
    .mirrorUpdateEntry(state.data.ym, updated.id, updated.date, updated.subject, updated.price, updated.payer)
    .catch((err) => console.error('mirror update failed:', err));
}

module.exports = {
  handleStepAskEditMonth,
  handleStepAskEditRow,
  handleStepAskEditColumn,
  handleStepWaitEditValue,
  handleStepConfirmEdit,
};
