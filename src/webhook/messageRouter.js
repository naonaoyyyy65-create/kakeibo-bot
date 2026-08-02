// @ts-nocheck -- TODO(TS移行): 段階的TypeScript導入の対象外。個別に型を付けて解除する予定
/**
 * webhook/messageRouter.js
 * テキストメッセージハンドラー（旧webhookHandler.jsの分割時に抽出）。
 */

const { client } = require('../lineService');
const { getState, setState } = require('../state');
const { parseQuickInput, toHalfWidth } = require('../quickInput');
const db = require('../dbService');
const flex = require('../flexBuilders');
const { isoDate, normalizeAmount } = require('../utils');
const { STEP } = require('../config');
const { handleShowMonth } = require('./monthFlow');
const { handleStepWaitEditValue } = require('./editFlow');

async function handleMessage(ev, userId, replyToken) {
  const text = ev.message.text.trim();
  const state = getState(userId);

  if (state.step === STEP.IDLE) {
    const parsed = parseQuickInput(text);
    if (parsed) {
      db.assertMonthEditable(parsed.date.slice(0, 7));
      setState(userId, { step: STEP.CONFIRM, data: parsed });
      await client.replyMessage(replyToken, flex.buildAddConfirmFlex(parsed));
      return;
    }

    if (/追加|ついか|登録|とうろく|入力|にゅうりょく/.test(text)) {
      setState(userId, { step: STEP.ASK_DATE, data: {} });
      await client.replyMessage(replyToken, flex.buildAskDate());
      return;
    }

    if (/確認|かくにん|表示|ひょうじ|見る|みる|閲覧|えつらん/.test(text)) {
      await handleShowMonth(replyToken, userId, isoDate(0).slice(0, 7));
      return;
    }

    if (/編集|へんしゅう|修正|しゅうせい|変更|へんこう/.test(text)) {
      setState(userId, { step: STEP.ASK_EDIT_MONTH, data: {} });
      await client.replyMessage(replyToken, flex.buildAskMonthEdit());
      return;
    }

    if (/削除|さくじょ|消す|けす/.test(text)) {
      setState(userId, { step: STEP.ASK_MONTH_DELETE, data: {} });
      await client.replyMessage(replyToken, flex.buildAskMonthDelete());
      return;
    }

    if (/ヘルプ|へるぷ|help|使い方|つかいかた/i.test(text)) {
      await client.replyMessage(replyToken, flex.buildQuickInputGuide());
      return;
    }

    if (/\d/.test(toHalfWidth(text))) {
      await client.replyMessage(replyToken, flex.buildQuickInputFailedGuide(text));
      return;
    }

    await client.replyMessage(replyToken, flex.buildIdleMenu());
    return;
  }

  if (state.step === STEP.WAIT_SUBJECT) {
    state.data.subject = text;
    state.step = STEP.WAIT_PRICE;
    setState(userId, state);
    await client.replyMessage(replyToken, { type: 'text', text: '値段を数字で入力してください' });
    return;
  }

  if (state.step === STEP.WAIT_PRICE) {
    const price = normalizeAmount(text);
    state.data.price = price;
    state.step = STEP.ASK_PAYER;
    setState(userId, state);
    await client.replyMessage(replyToken, flex.buildAskPayer());
    return;
  }

  if (state.step === STEP.WAIT_EDIT_VALUE) {
    await handleStepWaitEditValue(state, { v: text }, replyToken, userId, {});
  }
}

module.exports = { handleMessage };
