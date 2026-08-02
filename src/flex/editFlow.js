/**
 * flex/editFlow.js
 * 編集フロー（旧flexBuilders.jsの分割時に抽出）。
 */

const { UI_COLORS, PAYER_CHOICE, MONTH_HEADER, ACT } = require('../config');
const { fmtDate, fmtNum } = require('../utils');
const { buildFlexMessage, buildEmpty, makePostbackButton, makeDatePickerButton } = require('./core');

function makeColumnButtons() {
  return MONTH_HEADER.map((label) => makePostbackButton(label, `act=${ACT.EDIT_COLUMN}&v=${encodeURIComponent(label)}`));
}

/**
 * @param {Array.<{id:number,date:string,subject:string,price:number,payer:string}>} entries
 *   2026-07-30〜、DB主体化に伴い物理行番号(i+2)ではなくentries.idをpostbackに埋め込む
 *   （行番号は日次ソートcron等で不安定なため、DBの主キーで行を特定する）。
 */
function buildAskRowEdit(entries) {
  if (entries.length === 0) return buildEmpty('編集するデータがありません');

  return buildFlexMessage('編集する行を選択', [], {
    buttons: entries.map((e) => makePostbackButton(`${fmtDate(e.date, 'M/d')} ${e.subject}`, `act=${encodeURIComponent(ACT.EDIT_ROW)}&v=${encodeURIComponent(e.id)}`)),
    cancel: true,
  });
}

function buildEditColumnSelect(row) {
  return buildFlexMessage(
    '編集する項目を選択',
    [{ type: 'text', text: `選択行\n${fmtDate(row[0], 'M/d')} ${row[1]}  ¥${fmtNum(row[2])} (${row[3]})`, size: 'sm', color: UI_COLORS.textMuted, wrap: true }],
    { buttons: makeColumnButtons(), cancel: true }
  );
}

function buildEditValuePrompt(column, currentValueText) {
  const hint = [{ type: 'text', text: `現在値：${currentValueText}`, size: 'sm', color: UI_COLORS.textFaint }];

  if (column === '日付') {
    return buildFlexMessage('新しい日付を選択', hint, {
      buttons: [makeDatePickerButton(`act=${ACT.EDIT_VALUE}`, '日付を選択')],
      cancel: true,
    });
  }

  if (column === '払った人') {
    return buildFlexMessage('新しい払った人を選択', hint, {
      buttons: PAYER_CHOICE.map((p) => makePostbackButton(p, `act=${ACT.EDIT_VALUE}&v=${p}`, 'primary')),
      cancel: true,
    });
  }

  const guide = column === '値段' ? '新しい金額を入力してください（数字）' : '新しい値を入力してください';
  return buildFlexMessage(guide, hint, { cancel: true });
}

function buildEditConfirm(column, currentText, newText) {
  return buildFlexMessage('編集内容確認', [{ type: 'text', text: `${column}\n${currentText} → ${newText}`, wrap: true }], {
    buttons: [
      makePostbackButton('保存', `act=${ACT.SAVE_EDIT}`, 'primary'),
      makePostbackButton('キャンセル', `act=${ACT.CANCEL}`, 'secondary'),
    ],
  });
}

module.exports = { buildAskRowEdit, buildEditColumnSelect, buildEditValuePrompt, buildEditConfirm };
