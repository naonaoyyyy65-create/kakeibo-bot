// @ts-nocheck -- TODO(TS移行): 段階的TypeScript導入の対象外。個別に型を付けて解除する予定
/**
 * webhook/addFlow.js
 * ステップハンドラー：追加フロー（旧webhookHandler.jsの分割時に抽出）。
 */

const { client } = require('../lineService');
const { setState, clearState } = require('../state');
const db = require('../dbService');
const mirror = require('../sheetsMirrorService');
const flex = require('../flexBuilders');
const { isoDate } = require('../utils');
const { ACT, STEP } = require('../config');

async function handleStepAskDate(state, data, replyToken, userId, params = {}) {
  const offsetMap = { [ACT.DATE_TODAY]: 0, [ACT.DATE_YESTERDAY]: -1 };

  if (data.act in offsetMap) state.data.date = isoDate(offsetMap[data.act]);
  else if (data.act === ACT.DATE_PICK && params.date) state.data.date = params.date;
  else return;

  db.assertMonthEditable(state.data.date.slice(0, 7));

  state.step = STEP.WAIT_SUBJECT;
  setState(userId, state);
  await client.replyMessage(replyToken, { type: 'text', text: '題目を入力してください' });
}

async function handleStepAskPayer(state, data, replyToken, userId) {
  if (data.act !== ACT.PAYER) return;
  state.data.payer = data.v;
  state.step = STEP.CONFIRM;
  setState(userId, state);
  await client.replyMessage(replyToken, flex.buildConfirm(state.data));
}

async function handleStepConfirm(state, data, replyToken, userId) {
  if (data.act === ACT.SAVE) {
    const created = db.insertEntry({
      date: state.data.date,
      subject: state.data.subject,
      price: state.data.price,
      payer: state.data.payer,
    });
    mirror
      .mirrorAppendEntry(created.id, created.date, created.subject, created.price, created.payer)
      .catch((err) => console.error('mirror append failed:', err));
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildToast('保存しました'));
    return;
  }
  if (data.act === ACT.EDIT) {
    clearState(userId);
    setState(userId, { step: STEP.ASK_DATE, data: {} });
    await client.replyMessage(replyToken, flex.buildAskDate());
  }
}

module.exports = { handleStepAskDate, handleStepAskPayer, handleStepConfirm };
