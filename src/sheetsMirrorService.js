/**
 * sheetsMirrorService.js
 * DB(dbService.js)への書き込みを、非同期・fire-and-forgetでスプレッドシートへミラーする
 * （2026-07-30〜、DB主体化）。呼び出し元（webhookHandler.js）はLINE返信を待たせず、
 * このモジュールの関数は`.catch()`でエラーをログするだけに留める設計。
 *
 * 行の同一性はE列（entries.id）で判定する。物理行番号は日次ソートcron
 * （maintenanceSortSheets.js）で変動するため信用しない。
 *
 * 既にDB側でassertMonthEditable等のロック判定を通過済みの変更を反映するだけなので、
 * ここではsheetsService.jsの業務ルール検証（assertMonthEditable）を再度通す
 * （appendEntryWithId/deleteRow/updateCellが内部で行う）。DBとSheetsのステータス
 * ミラーに極小のタイムラグがある間に限り、稀にミラー書き込みが失敗しうる
 * （その場合はログのみでエラーを飲み込み、次回の手動確認・将来のリコンサイルジョブに委ねる）。
 */
const sheetsService = require('./sheetsService');

async function findSheetRowById(ym, id) {
  const idColumn = await sheetsService.readRange(`${ym}!E2:E`);
  const index = idColumn.findIndex((r) => r[0] === String(id));
  return index >= 0 ? index + 2 : null;
}

async function mirrorAppendEntry(id, date, subject, price, payer) {
  await sheetsService.appendEntryWithId(date, subject, price, payer, id);
}

async function mirrorUpdateEntry(oldYm, id, date, subject, price, payer) {
  const newYm = date.slice(0, 7);

  if (newYm !== oldYm) {
    // 月をまたぐ更新: 旧シートの行を削除し、新シートに同じIDで追加し直す
    await mirrorDeleteEntry(oldYm, id);
    await sheetsService.appendEntryWithId(date, subject, price, payer, id);
    return;
  }

  const row = await findSheetRowById(oldYm, id);
  if (row === null) {
    console.error(`sheetsMirror: id ${id} not found in ${oldYm}, skip update`);
    return;
  }
  await sheetsService.writeValuesBatch([
    { range: `${oldYm}!A${row}:D${row}`, values: [[date.replace(/-/g, '/'), subject, price, payer]] },
  ]);
}

async function mirrorDeleteEntry(ym, id) {
  const row = await findSheetRowById(ym, id);
  if (row === null) {
    console.error(`sheetsMirror: id ${id} not found in ${ym}, skip delete`);
    return;
  }
  await sheetsService.deleteRow(ym, row);
}

async function mirrorSetStatus(ym, status) {
  await sheetsService.setMonthlyStatus(ym, status);
}

module.exports = {
  mirrorAppendEntry,
  mirrorUpdateEntry,
  mirrorDeleteEntry,
  mirrorSetStatus,
};
