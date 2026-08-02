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

test('月/日が今年ではまだ来ていない日付なら前年の日付として解釈される', () => {
  // 常に「今日の翌日」を対象にする（同一年内なら未来日、年末年始をまたぐ場合のみ翌年1/1が
  // 「今年の1/1」＝過去日と解釈され本テストの前提が崩れるが、発生は年1日のみのため許容する）。
  const now = new Date();
  const tomorrow = new Date(now.getFullYear(), now.getMonth(), now.getDate() + 1);
  const mm = tomorrow.getMonth() + 1;
  const dd = tomorrow.getDate();

  const r = parseQuickInput(`${mm}/${dd} カフェ 800 a`);
  const [y, m, d] = r.date.split('-').map(Number);
  assert.equal(y, now.getFullYear() - 1);
  assert.equal(m, mm);
  assert.equal(d, dd);
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
