// @ts-nocheck -- TODO(TS移行): 段階的TypeScript導入の対象外。個別に型を付けて解除する予定
const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('fs');
const os = require('os');
const path = require('path');
const { createStore } = require('../src/reminderStore');

function tempStorePath() {
  return path.join(os.tmpdir(), `kakeibo-reminder-store-test-${Date.now()}-${Math.random().toString(36).slice(2)}.json`);
}

test('getSettledMonths: 未保存時は空配列を返す', () => {
  const store = createStore(tempStorePath());
  assert.deepEqual(store.getSettledMonths(), []);
});

test('addSettledMonths/getSettledMonthsが往復し、複数回の追加が積み上がる（重複除去・ソート済み）', () => {
  const filePath = tempStorePath();
  const store = createStore(filePath);
  store.addSettledMonths(['2026-06']);
  store.addSettledMonths(['2026-05', '2026-06']);

  assert.deepEqual(store.getSettledMonths(), ['2026-05', '2026-06']);
  fs.unlinkSync(filePath);
});

test('addSettledMonths: 空配列を渡しても何も起きない（ファイルは作られない）', () => {
  const filePath = tempStorePath();
  const store = createStore(filePath);
  store.addSettledMonths([]);
  assert.equal(fs.existsSync(filePath), false);
});
