/**
 * flex/deleteFlow.js
 * 削除フロー（旧flexBuilders.jsの分割時に抽出）。
 */

const { UI_COLORS, ACT } = require('../config');
const { fmtDate, fmtNum } = require('../utils');
const { makePostbackButton } = require('./core');

/**
 * @param {Array.<{id:number,date:string,subject:string,price:number,payer:string}>} entries
 *   buildAskRowEditと同じ理由でentries.idをpostbackに埋め込む。
 */
function buildDeleteRowList(ym, entries) {
  const [year, month] = ym.split('-');

  const rows = entries.map((e) => ({
    type: 'box',
    layout: 'vertical',
    spacing: 'sm',
    margin: 'md',
    contents: [
      { type: 'text', text: `${fmtDate(e.date, 'M/d')}  ${e.subject}`, weight: 'bold', wrap: true },
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          { type: 'text', text: `¥${fmtNum(e.price)}`, flex: 3, color: e.payer === 'a' ? UI_COLORS.payerA : UI_COLORS.payerC },
          { type: 'text', text: `(${e.payer})`, flex: 1, align: 'end', color: UI_COLORS.textFaint },
        ],
      },
      makePostbackButton('この行を削除', `act=${ACT.DELETE_ROW}&v=${e.id}`, 'primary', UI_COLORS.danger),
      { type: 'separator', margin: 'md' },
    ],
  }));

  return {
    type: 'flex',
    altText: '削除する行を選択',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: `${Number(year)}年${Number(month)}月 家計簿（削除）`, weight: 'bold', size: 'lg', margin: 'md' },
          ...rows,
          makePostbackButton('キャンセル', `act=${ACT.CANCEL}`, 'secondary'),
        ],
      },
    },
  };
}

module.exports = { buildDeleteRowList };
