const { test } = require('node:test');
const assert = require('node:assert/strict');
const {
  normalizeAmount,
  calcSettlement,
  calcMonthlyStats,
  getCurrentValueForEdit,
  formatEditValue,
  fmtNum,
  fmtDate,
  formatInTZ,
} = require('../src/utils');
const { ValidationError } = require('../src/errors');

test('normalizeAmount: 数字・カンマ・円記号・円を吸収', () => {
  assert.equal(normalizeAmount('2500'), 2500);
  assert.equal(normalizeAmount('2,500'), 2500);
  assert.equal(normalizeAmount('¥2500'), 2500);
  assert.equal(normalizeAmount('2500円'), 2500);
});

test('normalizeAmount: 0以下・非数値はエラー', () => {
  assert.throws(() => normalizeAmount('0'), ValidationError);
  assert.throws(() => normalizeAmount('-100'), ValidationError);
  assert.throws(() => normalizeAmount('abc'), ValidationError);
});

test('calcSettlement: 同額なら精算不要（null）', () => {
  const values = [
    ['2026/07/01', 'A', 1000, 'c'],
    ['2026/07/02', 'B', 1000, 'a'],
  ];
  assert.equal(calcSettlement(values), null);
});

test('calcSettlement: cが多く払った場合はaからcへ', () => {
  const values = [
    ['2026/07/01', 'A', 2000, 'c'],
    ['2026/07/02', 'B', 0, 'a'],
  ];
  const s = calcSettlement(values);
  assert.match(s.text, /^a\s*→\s*c\s*¥1,000$/);
});

test('calcSettlement: aが多く払った場合はcからaへ', () => {
  const values = [
    ['2026/07/01', 'A', 0, 'c'],
    ['2026/07/02', 'B', 3000, 'a'],
  ];
  const s = calcSettlement(values);
  assert.match(s.text, /^c\s*→\s*a\s*¥1,500$/);
});

test('calcMonthlyStats: 合計・件数・内訳・1日平均', () => {
  const values = [
    ['2026/07/01', 'A', 1000, 'c'],
    ['2026/07/02', 'B', 2000, 'a'],
  ];
  const stats = calcMonthlyStats('2026-07', values);
  assert.equal(stats.total, 3000);
  assert.equal(stats.totalC, 1000);
  assert.equal(stats.totalA, 2000);
  assert.equal(stats.count, 2);
  assert.equal(stats.avgPerDay, Math.round(3000 / 31));
});

test('getCurrentValueForEdit: 列ごとの表示形式', () => {
  const current = { date: '2026/07/01', subject: 'スーパー', price: 2500, payer: 'c' };
  assert.equal(getCurrentValueForEdit(current, '日付'), '2026/07/01');
  assert.equal(getCurrentValueForEdit(current, '題目'), 'スーパー');
  assert.equal(getCurrentValueForEdit(current, '値段'), '¥2,500');
  assert.equal(getCurrentValueForEdit(current, '払った人'), 'c');
});

test('formatEditValue: 値段だけ¥表示、他はそのまま', () => {
  assert.equal(formatEditValue('値段', 3000), '¥3,000');
  assert.equal(formatEditValue('題目', 'カフェ'), 'カフェ');
});

test('fmtNum / fmtDate', () => {
  assert.equal(fmtNum(2500), '2,500');
  assert.equal(fmtDate('2026-07-25', 'yyyy/MM/dd'), '2026/07/25');
  assert.equal(fmtDate('2026-07-25', 'M/d'), '7/25');
});

test('formatInTZ: dパターンは日を先頭ゼロなしで返す（第2月曜判定に使用）', () => {
  assert.equal(formatInTZ(new Date('2026-07-08T00:00:00+09:00'), 'd'), '8');
  assert.equal(formatInTZ(new Date('2026-07-01T00:00:00+09:00'), 'd'), '1');
});
