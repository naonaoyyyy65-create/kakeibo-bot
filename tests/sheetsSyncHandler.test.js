process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'dummy';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

// dbService.jsは本番データを含むファイルをrequire時に開く実装ではないが、
// 実DBに一切触れさせない方針を他のテストと統一するためモックする。
const dbMocks = {
  setMonthlyStatus: mock.fn(() => undefined),
  updateEntryById: mock.fn(() => ({ id: 1, ym: '2026-07', date: '2026-07-01', subject: 'x', price: 100, payer: 'c' })),
  insertEntry: mock.fn((data) => ({ id: 99, ym: data.date.slice(0, 7), ...data })),
};
mock.module('../src/dbService.js', { exports: dbMocks });

const { handleSheetsSyncRequest } = require('../src/sheetsSyncHandler');
const { ValidationError } = require('../src/errors');

function resetAll() {
  dbMocks.setMonthlyStatus.mock.resetCalls();
  dbMocks.updateEntryById.mock.resetCalls();
  dbMocks.insertEntry.mock.resetCalls();
}

test('type=statusでdb.setMonthlyStatusが呼ばれる', () => {
  resetAll();
  const result = handleSheetsSyncRequest({ type: 'status', ym: '2026-07', status: '確定済' });
  assert.deepEqual(result, { ok: true });
  assert.equal(dbMocks.setMonthlyStatus.mock.callCount(), 1);
  assert.deepEqual(dbMocks.setMonthlyStatus.mock.calls[0].arguments, ['2026-07', '確定済']);
});

test('type=statusでym/statusが不正ならValidationError', () => {
  resetAll();
  assert.throws(() => handleSheetsSyncRequest({ type: 'status', ym: '2026-07' }), ValidationError);
});

test('idの無い完全な行は新規insertEntryされ、assignedIdsに含まれる', () => {
  resetAll();
  const result = handleSheetsSyncRequest({
    type: 'rows',
    ym: '2026-07',
    rows: [{ sheetRow: 5, date: '2026-07-10', subject: 'スーパー', price: 2500, payer: 'c' }],
  });
  assert.equal(dbMocks.insertEntry.mock.callCount(), 1);
  assert.deepEqual(dbMocks.insertEntry.mock.calls[0].arguments[0], {
    date: '2026-07-10', subject: 'スーパー', price: 2500, payer: 'c',
  });
  assert.deepEqual(result.assignedIds, [{ sheetRow: 5, id: 99 }]);
});

test('idのある行はupdateEntryByIdが呼ばれる', () => {
  resetAll();
  handleSheetsSyncRequest({
    type: 'rows',
    ym: '2026-07',
    rows: [{ sheetRow: 3, id: '42', date: '2026-07-05', subject: 'カフェ', price: 800, payer: 'a' }],
  });
  assert.equal(dbMocks.updateEntryById.mock.callCount(), 1);
  assert.deepEqual(dbMocks.updateEntryById.mock.calls[0].arguments, [
    '2026-07', 42, { date: '2026-07-05', subject: 'カフェ', price: 800, payer: 'a' },
  ]);
});

test('日付・題目・値段・払った人が揃っていない行はno-op（途中入力の想定）', () => {
  resetAll();
  const result = handleSheetsSyncRequest({
    type: 'rows',
    ym: '2026-07',
    rows: [
      { sheetRow: 5, date: '2026-07-10', subject: '', price: '', payer: '' },
      { sheetRow: 6, date: '2026-07-11', subject: 'A', price: '', payer: 'c' },
    ],
  });
  assert.equal(dbMocks.insertEntry.mock.callCount(), 0);
  assert.equal(dbMocks.updateEntryById.mock.callCount(), 0);
  assert.deepEqual(result.assignedIds, []);
});

test('払った人がc/a以外の行はno-op', () => {
  resetAll();
  handleSheetsSyncRequest({
    type: 'rows',
    ym: '2026-07',
    rows: [{ sheetRow: 5, date: '2026-07-10', subject: 'x', price: 100, payer: 'd' }],
  });
  assert.equal(dbMocks.insertEntry.mock.callCount(), 0);
});

test('値段が数値として解釈できない行はno-op', () => {
  resetAll();
  handleSheetsSyncRequest({
    type: 'rows',
    ym: '2026-07',
    rows: [{ sheetRow: 5, date: '2026-07-10', subject: 'x', price: 'abc', payer: 'c' }],
  });
  assert.equal(dbMocks.insertEntry.mock.callCount(), 0);
});

test('値段が¥・カンマ付きでも正規化されて渡る', () => {
  resetAll();
  handleSheetsSyncRequest({
    type: 'rows',
    ym: '2026-07',
    rows: [{ sheetRow: 5, date: '2026-07-10', subject: 'x', price: '¥1,234', payer: 'c' }],
  });
  assert.equal(dbMocks.insertEntry.mock.calls[0].arguments[0].price, 1234);
});

test('1件の行でエラーが起きても他の行の処理は続行しerrorsに記録される', () => {
  resetAll();
  dbMocks.updateEntryById.mock.mockImplementationOnce(() => {
    throw new Error('boom');
  });
  const result = handleSheetsSyncRequest({
    type: 'rows',
    ym: '2026-07',
    rows: [
      { sheetRow: 3, id: '42', date: '2026-07-05', subject: 'A', price: 100, payer: 'c' },
      { sheetRow: 4, date: '2026-07-06', subject: 'B', price: 200, payer: 'a' },
    ],
  });
  assert.equal(result.errors.length, 1);
  assert.equal(result.errors[0].sheetRow, 3);
  assert.equal(dbMocks.insertEntry.mock.callCount(), 1);
});

test('type=rowsでym/rowsが不正ならValidationError', () => {
  resetAll();
  assert.throws(() => handleSheetsSyncRequest({ type: 'rows', ym: '2026-07' }), ValidationError);
});

test('未知のtypeはValidationError', () => {
  resetAll();
  assert.throws(() => handleSheetsSyncRequest({ type: 'bogus' }), ValidationError);
});
