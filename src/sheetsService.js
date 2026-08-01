/**
 * sheetsService.js
 * Google Sheets API操作（GAS版 Spreadsheet.gs / Reminder.gs のユーザー管理部分の移植・簡略化）
 *
 * GAS版との主な設計変更点:
 * - 行の物理的な並び順を維持する処理（二分探索での挿入位置決定、onEdit時の自動再ソート）は廃止。
 *   新規行は常にシート末尾に追加し、表示側（webhookHandler）で都度日付順にソートする。
 *   これによりGAS特有の`onEdit`簡易トリガー（外部Node.jsでは代替できない）が不要になる。
 * - CacheServiceに相当する読み取りキャッシュは持たない（Sheets APIを都度直接呼び出す）。
 *   スプレッドシートを直接編集した場合でも、次の読み取りで即座に反映される。
 */

const { google } = require('googleapis');
const config = require('./config');
const { LockedMonthError } = require('./errors');

let sheetsClientPromise = null;

function getSheetsClient() {
  if (!sheetsClientPromise) {
    const auth = new google.auth.GoogleAuth({
      keyFile: config.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
      scopes: ['https://www.googleapis.com/auth/spreadsheets'],
    });
    sheetsClientPromise = Promise.resolve(google.sheets({ version: 'v4', auth }));
  }
  return sheetsClientPromise;
}

function columnLetter(index) {
  return String.fromCharCode(64 + index);
}

async function getSheetMeta() {
  const sheets = await getSheetsClient();
  const meta = await sheets.spreadsheets.get({
    spreadsheetId: config.SPREADSHEET_ID,
    fields: 'sheets.properties(sheetId,title)',
  });
  return meta.data.sheets.map((s) => s.properties);
}

async function listSheetTitles() {
  const props = await getSheetMeta();
  return props.map((p) => p.title);
}

async function getSheetId(title) {
  const props = await getSheetMeta();
  const found = props.find((p) => p.title === title);
  return found ? found.sheetId : null;
}

async function ensureMonthlySheet(ym) {
  const titles = await listSheetTitles();
  if (titles.includes(ym)) return;

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: ym } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${ym}!A1:D1`,
    valueInputOption: 'RAW',
    requestBody: { values: [config.MONTH_HEADER] },
  });
}

async function getMonthlyStatus(ym) {
  const titles = await listSheetTitles();
  if (!titles.includes(ym)) return '';

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${ym}!${config.SHEET_CONSTANTS.STATUS_CELL}`,
  });
  return (res.data.values && res.data.values[0] && res.data.values[0][0]) || '';
}

async function setMonthlyStatus(ym, status) {
  await ensureMonthlySheet(ym);
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${ym}!${config.SHEET_CONSTANTS.STATUS_CELL}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[status]] },
  });
}

async function assertMonthEditable(ym) {
  const status = await getMonthlyStatus(ym);
  if (status && status !== config.PAYMENT_STATUS[0]) {
    throw new LockedMonthError(ym, status);
  }
}

async function getMonthlyData(ym) {
  const titles = await listSheetTitles();
  if (!titles.includes(ym)) return [];

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${ym}!A2:D`,
  });
  return res.data.values || [];
}

/**
 * 複数月の明細データ(A2:D)とステータスセルをbatchGetでまとめて取得する（reminder.jsのリマインドが使用）。
 * 月ごとにgetMonthlyData/getMonthlyStatusを個別に呼ぶとAPI呼び出しが月数分に膨らみ、
 * Sheets APIの分間クォータに抵触する（2026-07-29実際に429エラーで発生、
 * maintenanceSortSheetsのbatchGet対応と同じ理由）ため、必ずこちらを使うこと。
 * @param {string[]} yms 存在が確認済みの月次シート名（yyyy-MM）の配列
 * @returns {Promise<Record<string, {values: string[][], status: string}>>}
 */
async function getMonthlyDataAndStatusBatch(yms) {
  if (yms.length === 0) return {};

  const sheets = await getSheetsClient();
  const ranges = yms.flatMap((ym) => [`${ym}!A2:D`, `${ym}!${config.SHEET_CONSTANTS.STATUS_CELL}`]);
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: config.SPREADSHEET_ID,
    ranges,
  });

  const result = {};
  yms.forEach((ym, i) => {
    const dataRange = res.data.valueRanges[i * 2];
    const statusRange = res.data.valueRanges[i * 2 + 1];
    result[ym] = {
      values: dataRange.values || [],
      status: (statusRange.values && statusRange.values[0] && statusRange.values[0][0]) || '',
    };
  });
  return result;
}

/**
 * @param {string} isoDateStr 'yyyy-MM-dd'
 */
async function appendEntry(isoDateStr, subject, price, payer) {
  const ym = isoDateStr.slice(0, 7);
  await assertMonthEditable(ym);
  await ensureMonthlySheet(ym);

  const formatted = isoDateStr.replace(/-/g, '/');
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.append({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${ym}!A:D`,
    valueInputOption: 'USER_ENTERED',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[formatted, subject, price, payer]] },
  });
}

/**
 * @param {string} ym 'yyyy-MM'
 * @param {number} rowNumber シート上の行番号（1始まり、ヘッダーは1行目なのでデータは2以上）
 */
async function deleteRow(ym, rowNumber) {
  await assertMonthEditable(ym);
  const sheetId = await getSheetId(ym);
  if (sheetId === null) throw new LockedMonthError(ym, '');

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.SPREADSHEET_ID,
    requestBody: {
      requests: [
        {
          deleteDimension: {
            range: {
              sheetId,
              dimension: 'ROWS',
              startIndex: rowNumber - 1,
              endIndex: rowNumber,
            },
          },
        },
      ],
    },
  });
}

/**
 * @param {string} ym 'yyyy-MM'
 * @param {number} rowNumber シート上の行番号
 * @param {number} columnIndex 1始まりの列番号（config.SHEET_CONSTANTS.COLUMNS参照）
 * @param {string|number} value
 */
async function updateCell(ym, rowNumber, columnIndex, value) {
  await assertMonthEditable(ym);
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${ym}!${columnLetter(columnIndex)}${rowNumber}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[value]] },
  });
}

// ============================================================
// users シート（月初リマインドの送信先管理。GAS版 Reminder.gs の一部）
// ============================================================

const USERS_SHEET = 'users';
const USERS_HEADER = ['User ID', '最終利用日時', '利用回数'];

async function ensureUsersSheet() {
  const titles = await listSheetTitles();
  if (titles.includes(USERS_SHEET)) return;

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.batchUpdate({
    spreadsheetId: config.SPREADSHEET_ID,
    requestBody: { requests: [{ addSheet: { properties: { title: USERS_SHEET } } }] },
  });
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${USERS_SHEET}!A1:C1`,
    valueInputOption: 'RAW',
    requestBody: { values: [USERS_HEADER] },
  });
}

/**
 * ユーザーをデータベースに登録・更新（利用ごとに呼ぶ想定）
 */
async function registerUser(userId, timestamp) {
  if (!userId) return;
  await ensureUsersSheet();

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${USERS_SHEET}!A2:C`,
  });
  const rows = res.data.values || [];
  const index = rows.findIndex((r) => r[0] === userId);

  if (index >= 0) {
    const rowNumber = index + 2;
    const currentCount = Number(rows[index][2]) || 0;
    await sheets.spreadsheets.values.update({
      spreadsheetId: config.SPREADSHEET_ID,
      range: `${USERS_SHEET}!B${rowNumber}:C${rowNumber}`,
      valueInputOption: 'RAW',
      requestBody: { values: [[timestamp, currentCount + 1]] },
    });
    return;
  }

  await sheets.spreadsheets.values.append({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${USERS_SHEET}!A:C`,
    valueInputOption: 'RAW',
    insertDataOption: 'INSERT_ROWS',
    requestBody: { values: [[userId, timestamp, 1]] },
  });
}

async function getAllUserIds() {
  const titles = await listSheetTitles();
  if (!titles.includes(USERS_SHEET)) return [];

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${USERS_SHEET}!A2:A`,
  });
  return (res.data.values || []).map((r) => r[0]).filter(Boolean);
}

/**
 * 全月次シートの日付列（A列）が昇順かチェックし、崩れているシートを物理的に並べ替える。
 * スプレッドシートへの直接入力時に行順が崩れるケースに備えたメンテナンス用（maintenanceSortSheets.js）。
 * 表示側（webhookHandler）は都度JSでソートするためBot動作には影響しないが、
 * スプレッドシートを直接開いたときの見た目を揃える目的。
 *
 * 月ごとに個別リクエストすると月数分だけAPI呼び出しが発生しSheets APIの分間クォータに
 * すぐ抵触するため（2026-07-26実測、38ヶ月分で429 Too Many Requestsを確認）、
 * 全月の値取得はbatchGet、ソート実行はbatchUpdateでそれぞれ1回にまとめている。
 * @returns {string[]} 実際にソートしたシート名の一覧
 */
async function sortAllMonthlySheetsIfNeeded() {
  const props = await getSheetMeta();
  const monthly = props.filter((p) => /^\d{4}-\d{2}$/.test(p.title));
  if (monthly.length === 0) return [];

  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: config.SPREADSHEET_ID,
    ranges: monthly.map((p) => `${p.title}!A2:E`),
  });

  const sortRequests = [];
  const sortedTitles = [];
  (res.data.valueRanges || []).forEach((vr, i) => {
    const values = vr.values || [];
    if (values.length < 2) return;

    const sorted = values.every(
      (v, idx) => idx === 0 || new Date(v[0]) >= new Date(values[idx - 1][0])
    );
    if (sorted) return;

    sortedTitles.push(monthly[i].title);
    sortRequests.push({
      sortRange: {
        range: {
          sheetId: monthly[i].sheetId,
          startRowIndex: 1,
          endRowIndex: 1 + values.length,
          startColumnIndex: 0,
          endColumnIndex: config.SHEET_CONSTANTS.COLUMN_COUNT_WITH_ID,
        },
        sortSpecs: [{ dimensionIndex: 0, sortOrder: 'ASCENDING' }],
      },
    });
  });

  if (sortRequests.length > 0) {
    await sheets.spreadsheets.batchUpdate({
      spreadsheetId: config.SPREADSHEET_ID,
      requestBody: { requests: sortRequests },
    });
  }

  return sortedTitles;
}

/**
 * 汎用の範囲読み取り。DB→Sheetsミラー同期（sheetsMirrorService.js）がE列（ID）を
 * スキャンして対象行を特定する用途で使う。
 */
async function readRange(range) {
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.get({
    spreadsheetId: config.SPREADSHEET_ID,
    range,
  });
  return res.data.values || [];
}

/**
 * appendEntryと同じ動作に加え、追加された行のE列にIDを書き込む
 * （DB主体化後のミラー同期用、2026-07-30〜）。appendEntry自体は変更しない。
 *
 * values.append（appendEntryが使う方式）は「シート上で使用済みとして記録されている範囲」
 * の直後に追記する仕様のため、過去の書式設定等が残っていると実データの直後ではなく
 * 大きく離れた行まで飛んで追記されることがある（2026-07-30実際に発生、A列の実データが
 * 8行目までしかないのに34行目に追記された）。そのため本関数ではA列を読んで実データの
 * 最終行を自前で特定し、その直後へvalues.updateで直接書き込むことで空白行の発生を防ぐ。
 * @param {string} isoDateStr 'yyyy-MM-dd'
 * @param {number} id
 */
async function appendEntryWithId(isoDateStr, subject, price, payer, id) {
  const ym = isoDateStr.slice(0, 7);
  await assertMonthEditable(ym);
  await ensureMonthlySheet(ym);

  const formatted = isoDateStr.replace(/-/g, '/');
  const dateColumn = await readRange(`${ym}!A2:A`);
  let lastFilledIndex = -1;
  dateColumn.forEach((row, i) => {
    if (row[0]) lastFilledIndex = i;
  });
  const targetRow = config.SHEET_CONSTANTS.DATA_START_ROW + lastFilledIndex + 1;

  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${ym}!A${targetRow}:D${targetRow}`,
    valueInputOption: 'USER_ENTERED',
    requestBody: { values: [[formatted, subject, price, payer]] },
  });
  // ID列は移行データ（migrateSheetsToDb.js）と表記を揃えるため文字列のままRAWで書き込む。
  // USER_ENTEREDで書くと数値として解釈され右詰め表示になり、移行済みIDの左詰め表示と食い違う
  // （2026-07-30実際に発生・修正）。
  await sheets.spreadsheets.values.update({
    spreadsheetId: config.SPREADSHEET_ID,
    range: `${ym}!E${targetRow}`,
    valueInputOption: 'RAW',
    requestBody: { values: [[String(id)]] },
  });
}

/**
 * 複数の範囲への書き込みを1回のvalues.batchUpdateにまとめる汎用ヘルパー。
 * 移行スクリプト（migrateSheetsToDb.js）のID列書き戻しや、DB→Sheetsミラー同期で使用する。
 * @param {{range: string, values: any[][]}[]} data
 */
async function writeValuesBatch(data) {
  if (data.length === 0) return;
  const sheets = await getSheetsClient();
  await sheets.spreadsheets.values.batchUpdate({
    spreadsheetId: config.SPREADSHEET_ID,
    requestBody: { valueInputOption: 'RAW', data },
  });
}

/**
 * 全シート（月次シート＋usersシート）の値をまとめて取得する。バックアップ用途（backup.js）。
 */
async function exportAllSheets() {
  const titles = await listSheetTitles();
  const sheets = await getSheetsClient();
  const res = await sheets.spreadsheets.values.batchGet({
    spreadsheetId: config.SPREADSHEET_ID,
    ranges: titles,
  });

  const result = {};
  res.data.valueRanges.forEach((vr, i) => {
    result[titles[i]] = vr.values || [];
  });
  return result;
}

module.exports = {
  listSheetTitles,
  exportAllSheets,
  ensureMonthlySheet,
  getMonthlyStatus,
  setMonthlyStatus,
  assertMonthEditable,
  getMonthlyData,
  getMonthlyDataAndStatusBatch,
  appendEntry,
  deleteRow,
  updateCell,
  sortAllMonthlySheetsIfNeeded,
  registerUser,
  getAllUserIds,
  writeValuesBatch,
  readRange,
  appendEntryWithId,
};
