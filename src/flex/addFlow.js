/**
 * flex/addFlow.js
 * 追加フロー（旧flexBuilders.jsの分割時に抽出）。
 */

const { UI_COLORS, PAYER_ICON, PAYER_CHOICE, ACT } = require('../config');
const { fmtDate } = require('../utils');
const { buildFlexMessage, makePostbackButton, makeDatePickerButton } = require('./core');

function buildAskDate() {
  return buildFlexMessage('日付を選択', [], {
    buttons: [
      makePostbackButton('今日', `act=${ACT.DATE_TODAY}`, 'primary', UI_COLORS.info),
      makePostbackButton('昨日', `act=${ACT.DATE_YESTERDAY}`, 'primary', UI_COLORS.infoDark),
      makeDatePickerButton(`act=${ACT.DATE_PICK}`, '日付指定'),
    ],
    cancel: true,
  });
}

function buildAskPayer() {
  return buildFlexMessage('払った人を選択', [], {
    buttons: PAYER_CHOICE.map((p) => makePostbackButton(p, `act=${ACT.PAYER}&v=${p}`, 'primary', UI_COLORS.payerC)),
    cancel: true,
  });
}

function buildAddConfirmRows(data) {
  return [
    { type: 'text', text: `日付: ${fmtDate(data.date, 'M/d')}`, size: 'sm', color: UI_COLORS.textMuted },
    { type: 'text', text: `題目: ${data.subject}`, size: 'md', weight: 'bold', color: UI_COLORS.textDark, margin: 'sm' },
    {
      type: 'text',
      text: `金額: ¥${Number(data.price).toLocaleString()}`,
      size: 'lg',
      weight: 'bold',
      color: data.payer === 'a' ? UI_COLORS.payerA : UI_COLORS.payerC,
      margin: 'sm',
    },
    { type: 'text', text: `払った人: ${PAYER_ICON[data.payer] || data.payer} ${data.payer}`, size: 'sm', color: UI_COLORS.textMuted, margin: 'sm' },
  ];
}

// クイック入力からの確認（保存・修正・キャンセルの3ボタン、GAS版 handleMessage_ の分岐と同じ構成）
function buildAddConfirmFlex(data) {
  return buildFlexMessage('この内容で登録しますか？', buildAddConfirmRows(data), {
    buttons: [
      makePostbackButton('保存', `act=${ACT.SAVE}`, 'primary', UI_COLORS.primary),
      makePostbackButton('修正', `act=${ACT.EDIT}`, 'secondary'),
      makePostbackButton('キャンセル', `act=${ACT.CANCEL}`, 'secondary'),
    ],
  });
}

// ステップ入力フローからの確認（GAS版 sendConfirm_）
function buildConfirm(data) {
  return buildFlexMessage('この内容で登録しますか？', buildAddConfirmRows(data), {
    buttons: [
      makePostbackButton('保存', `act=${ACT.SAVE}`, 'primary', UI_COLORS.primary),
      makePostbackButton('修正', `act=${ACT.EDIT}`, 'secondary'),
    ],
    cancel: true,
  });
}

module.exports = { buildAskDate, buildAskPayer, buildAddConfirmRows, buildAddConfirmFlex, buildConfirm };
