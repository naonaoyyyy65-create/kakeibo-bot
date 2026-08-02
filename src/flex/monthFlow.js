/**
 * flex/monthFlow.js
 * ステータス変更・月選択・月次一覧・月次確認サマリー（旧flexBuilders.jsの分割時に抽出）。
 */

const { UI_COLORS, STATUS_STYLE, PAYMENT_STATUS, PAYER_ICON, ACT } = require('../config');
const { fmtDate, fmtNum, formatInTZ } = require('../utils');
const { buildFlexMessage, makePostbackButton } = require('./core');

// ============================================================
// ステータス変更
// ============================================================

function buildAskStatus(ym) {
  return buildFlexMessage('支払いステータスを選択', [], {
    buttons: PAYMENT_STATUS.map((s) => makePostbackButton(s, `act=${ACT.UPDATE_STATUS}&ym=${ym}&v=${encodeURIComponent(s)}`)),
    cancel: true,
  });
}

// ============================================================
// 月選択
// ============================================================

function recentMonths(count) {
  const now = new Date();
  now.setDate(1);
  const seen = new Set();
  const months = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    const ym = formatInTZ(d, 'yyyy-MM');
    if (seen.has(ym)) continue;
    seen.add(ym);
    months.push(ym);
  }
  return months;
}

function buildMonthSelection(postbackAct, altText, monthsCount = 3, includeOther = false) {
  const buttons = recentMonths(monthsCount).map((ym) => makePostbackButton(ym, `act=${postbackAct}&v=${ym}`));
  if (includeOther) buttons.push(makePostbackButton('その他', `act=${postbackAct}&v=other`));
  return buildFlexMessage(altText, [], { buttons, cancel: true });
}

function buildAskMonth() {
  return buildMonthSelection(ACT.MONTH, '月選択', 3, true);
}
function buildOlderMonths() {
  return buildMonthSelection(ACT.MONTH, '過去30ヶ月から選択', 30, false);
}
function buildAskMonthDelete() {
  return buildMonthSelection(ACT.DELETE_MONTH, '削除月選択', 3, false);
}
function buildAskMonthEdit() {
  return buildMonthSelection(ACT.EDIT, '編集対象月を選択', 3, true);
}

// ============================================================
// 月次一覧（確認画面）
// ============================================================

function buildMonthlyFlex(ym, values, settlement, stats) {
  const [year, month] = ym.split('-');

  const rows = values.map((r, index) => ({
    type: 'box',
    layout: 'vertical',
    margin: index === 0 ? 'md' : 'sm',
    spacing: 'xs',
    contents: [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: fmtDate(r[0], 'M/d'), size: 'xs', color: UI_COLORS.textLight, flex: 3 },
          { type: 'text', text: PAYER_ICON[r[3]] || r[3], size: 'sm', flex: 0, align: 'end', margin: 'md' },
        ],
      },
      {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          { type: 'text', text: r[1], size: 'sm', color: UI_COLORS.textDark, flex: 5, wrap: true, weight: 'bold' },
          { type: 'text', text: `¥${fmtNum(r[2])}`, size: 'md', weight: 'bold', align: 'end', flex: 3, color: r[3] === 'a' ? UI_COLORS.payerA : UI_COLORS.payerC },
        ],
      },
      ...(index < values.length - 1 ? [{ type: 'separator', margin: 'sm', color: UI_COLORS.separator }] : []),
    ],
  }));

  const options = {};
  if (stats) options.stats = stats;
  if (settlement) {
    options.settlement = settlement;
    options.buttons = [makePostbackButton('Statusを変更', `act=${ACT.SET_STATUS}&ym=${ym}`, 'secondary')];
  }

  return buildFlexMessage(`${Number(year)}年${Number(month)}月家計簿`, rows, options);
}

// ============================================================
// 月次確認のサマリー（合計・精算をスクロール無しで最初に見せる。「他の月を見る」導線も統一してここに集約）
// ============================================================

function summaryRow(label, value, opts = {}) {
  return {
    type: 'box',
    layout: 'baseline',
    margin: opts.margin || 'md',
    contents: [
      { type: 'text', text: label, size: 'sm', color: UI_COLORS.textMuted, flex: 2 },
      { type: 'text', text: String(value), size: opts.size || 'sm', weight: opts.weight, color: opts.color || UI_COLORS.textDark, flex: 5, align: 'end', wrap: true },
    ],
  };
}

// 統計・精算をそれぞれ色付きの箱にまとめる構成は情報が重複して見づらかったため、
// 合計・件数・精算・ステータスをラベル+値のシンプルな1本のリストにまとめる（2026-07-25、ユーザー指摘により簡略化）。
function buildMonthSummary(ym, stats, settlement, status) {
  const [year, month] = ym.split('-');
  const style = STATUS_STYLE[status] || { color: UI_COLORS.textLight, icon: '📝' };

  /** @type {Record<string, any>[]} */
  const rows = [
    summaryRow('合計', `¥${fmtNum(stats.total)}`, { size: 'xl', weight: 'bold', color: UI_COLORS.textDark, margin: 'none' }),
    summaryRow('件数', `${stats.count}件`),
  ];

  if (settlement) {
    rows.push({ type: 'separator', margin: 'md' });
    rows.push(summaryRow('精算', settlement.text, { size: 'lg', weight: 'bold', color: UI_COLORS.settlement }));
  }

  rows.push({ type: 'separator', margin: 'md' });
  rows.push(summaryRow('ステータス', `${style.icon} ${status}`, { weight: 'bold', color: style.color }));

  const buttons = [];
  if (settlement) buttons.push(makePostbackButton('Statusを変更', `act=${ACT.SET_STATUS}&ym=${ym}`, 'secondary'));
  buttons.push(makePostbackButton('他の月を見る', `act=${ACT.SHOW_MONTH_PICKER}`, 'secondary'));

  return buildFlexMessage(`${Number(year)}年${Number(month)}月家計簿`, rows, { buttons });
}

module.exports = {
  buildAskStatus,
  buildAskMonth,
  buildOlderMonths,
  buildAskMonthDelete,
  buildAskMonthEdit,
  buildMonthlyFlex,
  buildMonthSummary,
};
