const test = require('node:test');
const assert = require('node:assert/strict');
const { SheetError, LineApiError, LockedMonthError } = require('../src/errors');

test('SheetError: operationを保持し、userMessageは指定値になる', () => {
  const err = new SheetError('failed to update range', 'シート更新に失敗しました', 'updateRange');
  assert.equal(err.name, 'SheetError');
  assert.equal(err.message, 'failed to update range');
  assert.equal(err.userMessage, 'シート更新に失敗しました');
  assert.equal(err.operation, 'updateRange');
});

test('LineApiError: statusCode/bodyを保持し、userMessageは固定文言になる', () => {
  const err = new LineApiError('reply failed', 400, { message: 'invalid reply token' });
  assert.equal(err.name, 'LineApiError');
  assert.equal(err.message, 'reply failed');
  assert.equal(err.userMessage, 'LINEへの送信に失敗しました');
  assert.equal(err.statusCode, 400);
  assert.deepEqual(err.body, { message: 'invalid reply token' });
});

test('LockedMonthError: ym/statusを保持しuserMessageに月とステータスを含む', () => {
  const err = new LockedMonthError('2026-07', '確定済');
  assert.equal(err.ym, '2026-07');
  assert.equal(err.status, '確定済');
  assert.match(err.userMessage, /2026-07/);
  assert.match(err.userMessage, /確定済/);
});
