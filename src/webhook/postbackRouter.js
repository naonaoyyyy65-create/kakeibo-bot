// @ts-nocheck -- TODO(TS移行): 段階的TypeScript導入の対象外。個別に型を付けて解除する予定
/**
 * webhook/postbackRouter.js
 * Postback ルーティング（旧webhookHandler.jsの分割時に抽出）。
 */

const { client } = require('../lineService');
const { getState, setState, clearState } = require('../state');
const db = require('../dbService');
const mirror = require('../sheetsMirrorService');
const flex = require('../flexBuilders');
const { ACT, STEP, UI_COLORS, STATUS_STYLE, PAYMENT_STATUS } = require('../config');
const { isoDate } = require('../utils');
const { StateError } = require('../errors');
const { notifySettlementComplete } = require('./settlementNotify');
const { handleStepAskDate, handleStepAskPayer, handleStepConfirm } = require('./addFlow');
const { handleStepAskMonth, handleShowMonth } = require('./monthFlow');
const { handleStepAskMonthDelete, handleStepConfirmDelete } = require('./deleteFlow');
const {
  handleStepAskEditMonth,
  handleStepAskEditRow,
  handleStepAskEditColumn,
  handleStepWaitEditValue,
  handleStepConfirmEdit,
} = require('./editFlow');

function parseQuery(q) {
  if (!q) return {};
  return q.split('&').reduce((obj, pair) => {
    if (!pair) return obj;
    const [key, ...rest] = pair.split('=');
    obj[key] = decodeURIComponent(rest.join('='));
    return obj;
  }, {});
}

async function handlePostback(ev, userId, replyToken) {
  const data = parseQuery(ev.postback.data || '');
  const params = ev.postback.params || {};
  const state = getState(userId);

  if (data.act === ACT.START_CHECK) {
    clearState(userId);
    await handleShowMonth(replyToken, userId, isoDate(0).slice(0, 7));
    return;
  }

  if (data.act === ACT.SHOW_MONTH_PICKER) {
    setState(userId, { step: STEP.ASK_MONTH, data: {} });
    await client.replyMessage(replyToken, flex.buildAskMonth());
    return;
  }

  const startActions = {
    [ACT.START_ADD]: [STEP.ASK_DATE, () => flex.buildAskDate()],
    [ACT.START_DELETE]: [STEP.ASK_MONTH_DELETE, () => flex.buildAskMonthDelete()],
    [ACT.START_EDIT]: [STEP.ASK_EDIT_MONTH, () => flex.buildAskMonthEdit()],
  };

  if (startActions[data.act]) {
    clearState(userId);
    const [step, build] = startActions[data.act];
    setState(userId, { step, data: {} });
    await client.replyMessage(replyToken, build());
    return;
  }

  if (data.act === ACT.CANCEL) {
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildToast('キャンセルしました', { icon: '✖️', color: UI_COLORS.textLight }));
    return;
  }

  if (data.act === ACT.SET_STATUS) {
    await client.replyMessage(replyToken, flex.buildAskStatus(data.ym));
    return;
  }
  if (data.act === ACT.UPDATE_STATUS) {
    db.setMonthlyStatus(data.ym, data.v);
    mirror.mirrorSetStatus(data.ym, data.v).catch((err) => console.error('mirror status failed:', err));
    const style = STATUS_STYLE[data.v] || {};
    await client.replyMessage(replyToken, flex.buildToast(`ステータスを「${data.v}」に更新しました`, { icon: style.icon, color: style.color }));
    if (data.v === PAYMENT_STATUS[2]) {
      notifySettlementComplete(data.ym, userId).catch((err) => console.error('settlement notify failed:', err));
    }
    return;
  }

  if (data.act === ACT.SHOW_MENU) {
    await client.replyMessage(replyToken, flex.buildIdleMenu());
    return;
  }
  if (data.act === ACT.SHOW_GUIDE) {
    await client.replyMessage(replyToken, flex.buildQuickInputGuide());
    return;
  }

  const stepHandlers = {
    [STEP.ASK_DATE]: handleStepAskDate,
    [STEP.ASK_PAYER]: handleStepAskPayer,
    [STEP.CONFIRM]: handleStepConfirm,
    [STEP.ASK_MONTH]: handleStepAskMonth,
    [STEP.ASK_MONTH_DELETE]: handleStepAskMonthDelete,
    [STEP.CONFIRM_DELETE]: handleStepConfirmDelete,
    [STEP.ASK_EDIT_MONTH]: handleStepAskEditMonth,
    [STEP.ASK_EDIT_ROW]: handleStepAskEditRow,
    [STEP.ASK_EDIT_COLUMN]: handleStepAskEditColumn,
    [STEP.WAIT_EDIT_VALUE]: handleStepWaitEditValue,
    [STEP.CONFIRM_EDIT]: handleStepConfirmEdit,
  };

  const handler = stepHandlers[state.step];
  if (!handler) {
    throw new StateError(`Unknown step: ${state.step}`, '不正な状態です。最初からやり直してください。');
  }
  await handler(state, data, replyToken, userId, params);
}

module.exports = { handlePostback };
