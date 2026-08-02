/**
 * dbService.js
 * 主データストア（SQLite、better-sqlite3）。2026-07-30〜、Sheets直叩き設計から移行。
 *
 * 設計方針:
 * - entriesはソフトデリート（deleted_at）。誤操作での金銭データ消失を避けるため物理削除しない。
 *   スプレッドシート側のミラー（sheetsMirrorService.js）は今まで通り物理削除する。
 * - reminderStore.js/store.jsと同じファクトリー関数パターン（createDbService(filePath)）。
 *   デフォルトインスタンスをexportしつつ、テストは`createDbService(':memory:')`で完全に独立させる。
 * - assertMonthEditable等のロック判定はDBのmonth_statusが唯一の情報源。
 */

/**
 * @typedef {Object} Entry
 * @property {number} id
 * @property {string} ym
 * @property {string} date
 * @property {string} subject
 * @property {number} price
 * @property {'c'|'a'} payer
 */

/**
 * @typedef {Object} EntryInput
 * @property {string} date
 * @property {string} subject
 * @property {number} price
 * @property {'c'|'a'} payer
 */
const path = require('path');
const Database = require('better-sqlite3');
const config = require('./config');
const { LockedMonthError, NotFoundError } = require('./errors');

const SCHEMA = `
PRAGMA journal_mode = WAL;

CREATE TABLE IF NOT EXISTS entries (
  id          INTEGER PRIMARY KEY AUTOINCREMENT,
  ym          TEXT    NOT NULL,
  date        TEXT    NOT NULL,
  subject     TEXT    NOT NULL,
  price       INTEGER NOT NULL,
  payer       TEXT    NOT NULL CHECK (payer IN ('c','a')),
  created_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime')),
  updated_at  TEXT    NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime')),
  deleted_at  TEXT    NULL
);
CREATE INDEX IF NOT EXISTS idx_entries_ym_date ON entries (ym, date, id);

CREATE TABLE IF NOT EXISTS month_status (
  ym          TEXT PRIMARY KEY,
  status      TEXT NOT NULL DEFAULT '' CHECK (status IN ('', '確定前', '確定済', '支払済')),
  updated_at  TEXT NOT NULL DEFAULT (strftime('%Y-%m-%d %H:%M:%S','now','localtime'))
);

CREATE TABLE IF NOT EXISTS users (
  user_id      TEXT PRIMARY KEY,
  last_used_at TEXT NOT NULL,
  use_count    INTEGER NOT NULL DEFAULT 0
);
`;

function createDbService(filePath) {
  const resolvedPath = filePath === ':memory:' ? filePath : path.resolve(filePath);

  // 接続はここで即座に開かず、実際に最初にDB操作が行われた時点まで遅延する。
  // createDbService(path)を呼ぶ・requireするだけではファイルを作らない
  // （移行スクリプトの「DBファイルが既に存在するか」チェックが意味を持つために必須）。
  let db = null;
  function getDb() {
    if (db) return db;
    if (resolvedPath !== ':memory:') {
      const fs = require('fs');
      fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    }
    db = new Database(resolvedPath);
    db.exec(SCHEMA);
    return db;
  }

  /**
   * @param {any} row
   * @returns {Entry|undefined}
   */
  function rowToEntry(row) {
    if (!row) return undefined;
    return {
      id: row.id,
      ym: row.ym,
      date: row.date,
      subject: row.subject,
      price: row.price,
      payer: row.payer,
    };
  }

  function getMonthlyStatus(ym) {
    const row = getDb().prepare('SELECT status FROM month_status WHERE ym = ?').get(ym);
    return row ? row.status : '';
  }

  function setMonthlyStatus(ym, status) {
    getDb().prepare(
      `INSERT INTO month_status (ym, status, updated_at)
       VALUES (?, ?, strftime('%Y-%m-%d %H:%M:%S','now','localtime'))
       ON CONFLICT(ym) DO UPDATE SET status = excluded.status, updated_at = excluded.updated_at`
    ).run(ym, status);
  }

  function assertMonthEditable(ym) {
    const status = getMonthlyStatus(ym);
    if (status && status !== config.PAYMENT_STATUS[0]) {
      throw new LockedMonthError(ym, status);
    }
  }

  function getMonthlyEntries(ym) {
    const rows = getDb()
      .prepare(
        `SELECT id, ym, date, subject, price, payer FROM entries
         WHERE ym = ? AND deleted_at IS NULL
         ORDER BY date ASC, id ASC`
      )
      .all(ym);
    return rows.map(rowToEntry);
  }

  function getEntryById(id) {
    const row = getDb()
      .prepare('SELECT id, ym, date, subject, price, payer FROM entries WHERE id = ? AND deleted_at IS NULL')
      .get(id);
    return rowToEntry(row);
  }

  /**
   * @param {EntryInput} entry
   * @returns {Entry|undefined}
   */
  function insertEntry({ date, subject, price, payer }) {
    const ym = date.slice(0, 7);
    assertMonthEditable(ym);
    const info = getDb()
      .prepare(
        `INSERT INTO entries (ym, date, subject, price, payer)
         VALUES (?, ?, ?, ?, ?)`
      )
      .run(ym, date, subject, price, payer);
    return getEntryById(info.lastInsertRowid);
  }

  /**
   * @param {string} ym 選択中の月（ロック判定に使う。dateを編集して別月に移す場合でも
   *                     このymが基準——sheetsService.updateCellの既存挙動を踏襲）
   * @param {number} id
   * @param {Partial<EntryInput>} patch 更新するフィールドのみ（date/subject/price/payer）
   * @returns {Entry|undefined}
   */
  function updateEntryById(ym, id, patch) {
    assertMonthEditable(ym);
    /** @type {Entry|undefined} */
    const existing = getDb().prepare('SELECT * FROM entries WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!existing) throw new NotFoundError(`entry ${id} not found`, 'その明細は見つかりませんでした');

    const next = {
      date: patch.date !== undefined ? patch.date : existing.date,
      subject: patch.subject !== undefined ? patch.subject : existing.subject,
      price: patch.price !== undefined ? patch.price : existing.price,
      payer: patch.payer !== undefined ? patch.payer : existing.payer,
    };
    const nextYm = next.date.slice(0, 7);
    getDb().prepare(
      `UPDATE entries SET ym = ?, date = ?, subject = ?, price = ?, payer = ?,
         updated_at = strftime('%Y-%m-%d %H:%M:%S','now','localtime')
       WHERE id = ?`
    ).run(nextYm, next.date, next.subject, next.price, next.payer, id);
    return getEntryById(id);
  }

  function deleteEntryById(ym, id) {
    assertMonthEditable(ym);
    const existing = getDb().prepare('SELECT id FROM entries WHERE id = ? AND deleted_at IS NULL').get(id);
    if (!existing) throw new NotFoundError(`entry ${id} not found`, 'その明細は見つかりませんでした');
    getDb().prepare(
      `UPDATE entries SET deleted_at = strftime('%Y-%m-%d %H:%M:%S','now','localtime') WHERE id = ?`
    ).run(id);
  }

  function upsertUser(userId, timestamp) {
    if (!userId) return;
    getDb().prepare(
      `INSERT INTO users (user_id, last_used_at, use_count)
       VALUES (?, ?, 1)
       ON CONFLICT(user_id) DO UPDATE SET last_used_at = excluded.last_used_at, use_count = use_count + 1`
    ).run(userId, timestamp);
  }

  function getAllUserIds() {
    return getDb().prepare('SELECT user_id FROM users').all().map((r) => r.user_id);
  }

  async function backupTo(destPath) {
    if (destPath !== ':memory:') {
      const fs = require('fs');
      fs.mkdirSync(path.dirname(path.resolve(destPath)), { recursive: true });
    }
    return getDb().backup(destPath);
  }

  function getRawDb() {
    return getDb();
  }

  function close() {
    if (db) db.close();
  }

  return {
    getMonthlyStatus,
    setMonthlyStatus,
    assertMonthEditable,
    getMonthlyEntries,
    getEntryById,
    insertEntry,
    updateEntryById,
    deleteEntryById,
    upsertUser,
    getAllUserIds,
    backupTo,
    getRawDb,
    close,
  };
}

module.exports = { ...createDbService(config.DB_FILE_PATH), createDbService };
