const test = require('node:test');
const assert = require('node:assert/strict');
const { createDbService } = require('../src/dbService');

function freshDb() {
  return createDbService(':memory:');
}

test('getMonthlyStatus: 未設定の月は空文字', () => {
  const db = freshDb();
  assert.equal(db.getMonthlyStatus('2026-07'), '');
});

test('setMonthlyStatus/getMonthlyStatusが往復する', () => {
  const db = freshDb();
  db.setMonthlyStatus('2026-07', '確定済');
  assert.equal(db.getMonthlyStatus('2026-07'), '確定済');
  db.setMonthlyStatus('2026-07', '支払済');
  assert.equal(db.getMonthlyStatus('2026-07'), '支払済');
});

test('assertMonthEditable: 未設定/確定前は通り、確定済/支払済は例外', () => {
  const db = freshDb();
  assert.doesNotThrow(() => db.assertMonthEditable('2026-07'));
  db.setMonthlyStatus('2026-07', '確定前');
  assert.doesNotThrow(() => db.assertMonthEditable('2026-07'));
  db.setMonthlyStatus('2026-07', '確定済');
  assert.throws(() => db.assertMonthEditable('2026-07'), /LockedMonthError|locked/i);
});

test('insertEntry: 追加した明細がgetMonthlyEntriesで取得できる', () => {
  const db = freshDb();
  const created = db.insertEntry({ date: '2026-07-10', subject: 'スーパー', price: 2500, payer: 'c' });
  assert.equal(created.ym, '2026-07');
  assert.equal(typeof created.id, 'number');

  const entries = db.getMonthlyEntries('2026-07');
  assert.equal(entries.length, 1);
  assert.deepEqual(entries[0], created);
});

test('insertEntry: ロックされた月には追加できない', () => {
  const db = freshDb();
  db.setMonthlyStatus('2026-07', '確定済');
  assert.throws(() => db.insertEntry({ date: '2026-07-10', subject: 'x', price: 100, payer: 'c' }));
});

test('getMonthlyEntries: 日付順（同日はid順）に並ぶ', () => {
  const db = freshDb();
  db.insertEntry({ date: '2026-07-20', subject: 'b', price: 100, payer: 'c' });
  db.insertEntry({ date: '2026-07-05', subject: 'a', price: 200, payer: 'a' });
  db.insertEntry({ date: '2026-07-05', subject: 'a2', price: 50, payer: 'c' });

  const entries = db.getMonthlyEntries('2026-07');
  assert.deepEqual(entries.map((e) => e.subject), ['a', 'a2', 'b']);
});

test('updateEntryById: 指定フィールドのみ更新される', () => {
  const db = freshDb();
  const created = db.insertEntry({ date: '2026-07-10', subject: 'スーパー', price: 2500, payer: 'c' });
  const updated = db.updateEntryById('2026-07', created.id, { price: 3000 });
  assert.equal(updated.price, 3000);
  assert.equal(updated.subject, 'スーパー');
});

test('updateEntryById: 日付を編集して月をまたいでも、ロック判定は呼び出し時に渡したymが基準', () => {
  const db = freshDb();
  const created = db.insertEntry({ date: '2026-07-10', subject: 'x', price: 100, payer: 'c' });
  db.setMonthlyStatus('2026-06', '確定済');
  // 呼び出し元は選択中の月(2026-07、確定前)を渡す想定。2026-06がロックされていても弾かれない。
  const updated = db.updateEntryById('2026-07', created.id, { date: '2026-06-15' });
  assert.equal(updated.date, '2026-06-15');
  assert.equal(updated.ym, '2026-06');
});

test('updateEntryById: 存在しないidはNotFoundError', () => {
  const db = freshDb();
  assert.throws(() => db.updateEntryById('2026-07', 999, { price: 1 }), /not found|見つかりません/i);
});

test('deleteEntryById: ソフトデリートされ、以後getMonthlyEntries/getEntryByIdから見えない', () => {
  const db = freshDb();
  const created = db.insertEntry({ date: '2026-07-10', subject: 'x', price: 100, payer: 'c' });
  db.deleteEntryById('2026-07', created.id);
  assert.equal(db.getMonthlyEntries('2026-07').length, 0);
  assert.equal(db.getEntryById(created.id), undefined);
});

test('deleteEntryById: 削除済み・存在しないidの再削除はNotFoundError', () => {
  const db = freshDb();
  const created = db.insertEntry({ date: '2026-07-10', subject: 'x', price: 100, payer: 'c' });
  db.deleteEntryById('2026-07', created.id);
  assert.throws(() => db.deleteEntryById('2026-07', created.id));
});

test('upsertUser: 初回はuse_count=1、以後の呼び出しでインクリメントされる', () => {
  const db = freshDb();
  db.upsertUser('U1', '2026-07-30 10:00:00');
  db.upsertUser('U1', '2026-07-30 11:00:00');
  db.upsertUser('U2', '2026-07-30 12:00:00');

  const ids = db.getAllUserIds();
  assert.deepEqual(new Set(ids), new Set(['U1', 'U2']));

  const raw = db.getRawDb().prepare('SELECT use_count, last_used_at FROM users WHERE user_id = ?').get('U1');
  assert.equal(raw.use_count, 2);
  assert.equal(raw.last_used_at, '2026-07-30 11:00:00');
});

test('upsertUser: userIdが空ならno-op', () => {
  const db = freshDb();
  db.upsertUser('', '2026-07-30 10:00:00');
  assert.deepEqual(db.getAllUserIds(), []);
});
