const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parseQuickInput } = require('../src/quickInput');

test('基本形（題目 金額 払った人）', () => {
  const r = parseQuickInput('スーパー 2500 c');
  assert.equal(r.subject, 'スーパー');
  assert.equal(r.price, 2500);
  assert.equal(r.payer, 'c');
  assert.match(r.date, /^\d{4}-\d{2}-\d{2}$/);
});

test('順番が逆でもパースできる', () => {
  const r = parseQuickInput('2500 スーパー c');
  assert.equal(r.subject, 'スーパー');
  assert.equal(r.price, 2500);
  assert.equal(r.payer, 'c');
});

test('月/日を指定した日付', () => {
  const r = parseQuickInput('1/10 カフェ 800 a');
  assert.equal(r.subject, 'カフェ');
  assert.equal(r.price, 800);
  assert.equal(r.payer, 'a');
  assert.match(r.date, /-01-10$/);
});

test('相対日付（昨日）', () => {
  const r = parseQuickInput('昨日 ランチ 1200 c');
  const expected = new Date();
  expected.setDate(expected.getDate() - 1);
  const y = expected.getFullYear();
  const m = String(expected.getMonth() + 1).padStart(2, '0');
  const d = String(expected.getDate()).padStart(2, '0');
  assert.equal(r.date, `${y}-${m}-${d}`);
  assert.equal(r.subject, 'ランチ');
  assert.equal(r.price, 1200);
});

test('全角スペース・カンマ・円・全角英字もOK', () => {
  const r = parseQuickInput('スーパー　2,500円　Ｃ');
  assert.equal(r.subject, 'スーパー');
  assert.equal(r.price, 2500);
  assert.equal(r.payer, 'c');
});

test('kサフィックスは千円単位', () => {
  const r = parseQuickInput('コンビニ 1.5k c');
  assert.equal(r.price, 1500);
});

test('払った人を省略するとcになる', () => {
  const r = parseQuickInput('昨日 ランチ 1200');
  assert.equal(r.payer, 'c');
});

test('数字を含まない入力はnull', () => {
  assert.equal(parseQuickInput('こんにちは'), null);
});

test('題目が無い入力はnull', () => {
  assert.equal(parseQuickInput('2500'), null);
});

test('空文字・非文字列はnull', () => {
  assert.equal(parseQuickInput(''), null);
  assert.equal(parseQuickInput(null), null);
  assert.equal(parseQuickInput(undefined), null);
});
