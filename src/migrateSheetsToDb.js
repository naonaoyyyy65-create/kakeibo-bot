/**
 * migrateSheetsToDb.js
 * スプレッドシートの既存データをSQLite（dbService.js）へ一括移行する一回限りのスクリプト。
 * PCから実行する想定（sheetsService.jsは変更していないのでそのまま使う）。
 *
 * 実行手順:
 *   1. node src/migrateSheetsToDb.js --dry-run   # 件数だけ確認、DBにもSheetsにも一切書き込まない
 *   2. node src/backup.js                        # 念のためバックアップ
 *   3. node src/migrateSheetsToDb.js              # 本番実行（DB作成＋Sheets E列書き戻し）
 *   4. data/kakeibo.db をPiへscp
 *
 * 安全策:
 *   - data/kakeibo.db が既に存在する場合は二重実行防止のため拒否する（先に削除してから再実行すること）
 *   - --dry-run では件数の表示のみ行い、DBファイルもSheetsも一切変更しない
 */

const fs = require('fs');
const path = require('path');
const sheetsService = require('./sheetsService');
const config = require('./config');
const { createDbService } = require('./dbService');

const DB_PATH = path.resolve(config.DB_FILE_PATH);

async function collectSheetsData() {
  const titles = await sheetsService.listSheetTitles();
  const monthlyYms = titles.filter((t) => /^\d{4}-\d{2}$/.test(t)).sort();
  const batch = await sheetsService.getMonthlyDataAndStatusBatch(monthlyYms);

  const exported = await sheetsService.exportAllSheets();
  const usersRows = (exported.users || []).slice(1); // ヘッダー行を除く

  return { monthlyYms, batch, usersRows };
}

/**
 * 移行専用の価格パース。値段は「¥144,200」のような表記ゆれがGAS時代のデータに残っているため、
 * Bot本体のutils.normalizeAmountと同じ¥/カンマ/円/空白の除去は行うが、0円以下を拒否する
 * normalizeAmountの新規入力向けバリデーションはあえて使わない（過去の実データとして
 * 0円の記録がそのまま残っている場合、履歴の正確性を優先しそのまま取り込む）。
 */
function parsePriceForMigration(raw) {
  const n = Number(String(raw).replace(/[,¥円\s]/g, ''));
  return Number.isNaN(n) ? null : n;
}

function validateRow([date, subject, price, payer]) {
  if (!date || !subject || price === undefined || price === '' || !payer) {
    return { valid: false, reason: '日付・題目・値段・払った人のいずれかが空欄' };
  }
  if (!['c', 'a'].includes(payer)) {
    return { valid: false, reason: `払った人が不正な値: ${payer}` };
  }
  const parsed = parsePriceForMigration(price);
  if (parsed === null) {
    return { valid: false, reason: `値段が数値として解釈できない: ${price}` };
  }
  return { valid: true, price: parsed };
}

async function runMigration({ dryRun }) {
  const { monthlyYms, batch, usersRows } = await collectSheetsData();

  const totalEntries = monthlyYms.reduce((sum, ym) => sum + batch[ym].values.length, 0);
  const incomplete = [];
  monthlyYms.forEach((ym) => {
    batch[ym].values.forEach((row, i) => {
      const result = validateRow(row);
      if (!result.valid) incomplete.push({ ym, sheetRow: i + 2, row, reason: result.reason });
    });
  });

  console.log(`対象月: ${monthlyYms.length}ヶ月`);
  console.log(`明細行数の合計: ${totalEntries}`);
  console.log(`usersシート: ${usersRows.length}件`);
  if (incomplete.length > 0) {
    console.log(`不完全な行（インポート対象外・スプレッドシート側は変更しない）: ${incomplete.length}件`);
    incomplete.forEach((s) => console.log(`  ${s.ym} row${s.sheetRow} [${s.reason}]: ${JSON.stringify(s.row)}`));
  }

  if (dryRun) {
    console.log('--dry-run のため、ここで終了します（DB・Sheetsとも未変更）');
    return;
  }

  if (fs.existsSync(DB_PATH)) {
    throw new Error(
      `DBファイルが既に存在します: ${DB_PATH}\n二重実行防止のため中断しました。移行をやり直す場合は先に手動で削除してください。`
    );
  }

  const db = createDbService(DB_PATH);
  const rawDb = db.getRawDb();

  // 1件ずつappendEntry/upsertUserを呼ぶとassertMonthEditable等の余計な判定が都度走るため、
  // 低レベルAPIで直接INSERTしトランザクション1本にまとめる（数百件規模でも高速・安全）。
  const idAssignments = []; // { ym, sheetRow, id } … Sheets E列への書き戻し用
  const skipped = []; // 不完全な行（日付/題目/値段/払った人のいずれかが空欄）はDBへ取り込まずスキップする

  const insertEntryStmt = rawDb.prepare(
    `INSERT INTO entries (ym, date, subject, price, payer) VALUES (?, ?, ?, ?, ?)`
  );
  const upsertStatusStmt = rawDb.prepare(
    `INSERT INTO month_status (ym, status) VALUES (?, ?)
     ON CONFLICT(ym) DO UPDATE SET status = excluded.status`
  );
  const upsertUserStmt = rawDb.prepare(
    `INSERT INTO users (user_id, last_used_at, use_count) VALUES (?, ?, ?)
     ON CONFLICT(user_id) DO UPDATE SET last_used_at = excluded.last_used_at, use_count = excluded.use_count`
  );

  const transaction = rawDb.transaction(() => {
    for (const ym of monthlyYms) {
      const { values, status } = batch[ym];
      values.forEach((row, i) => {
        const result = validateRow(row);
        if (!result.valid) {
          skipped.push({ ym, sheetRow: i + 2, row, reason: result.reason });
          return;
        }
        const [dateRaw, subject, , payer] = row;
        const date = String(dateRaw).replace(/\//g, '-');
        const info = insertEntryStmt.run(ym, date, subject, result.price, payer);
        idAssignments.push({ ym, sheetRow: i + 2, id: Number(info.lastInsertRowid) });
      });
      upsertStatusStmt.run(ym, status || '');
    }

    usersRows.forEach((row) => {
      const [userId, lastUsedAt, useCount] = row;
      if (!userId) return;
      upsertUserStmt.run(userId, lastUsedAt || '', Number(useCount) || 0);
    });
  });
  transaction();

  console.log(`DB作成完了: ${DB_PATH}（${idAssignments.length}件の明細をインポート）`);
  if (skipped.length > 0) {
    console.log(`不完全な行をスキップしました（${skipped.length}件、スプレッドシート側は変更していません）:`);
    skipped.forEach((s) => console.log(`  ${s.ym} row${s.sheetRow} [${s.reason}]: ${JSON.stringify(s.row)}`));
  }

  await writeIdsBackToSheets(idAssignments, monthlyYms);
  console.log('スプレッドシートへのID書き戻し完了');
}

/**
 * 採番したIDを各月次シートのE列へ一括で書き戻す。月ごとに個別リクエストすると
 * Sheets APIの分間クォータに抵触するため（sortAllMonthlySheetsIfNeeded等と同じ理由）、
 * 1回のvalues.batchUpdateにまとめる。あわせてE1に'ID'ヘッダーも書き込む。
 */
async function writeIdsBackToSheets(idAssignments, monthlyYms) {
  const byYm = new Map();
  idAssignments.forEach((a) => {
    if (!byYm.has(a.ym)) byYm.set(a.ym, []);
    byYm.get(a.ym).push(a);
  });

  const data = [];
  monthlyYms.forEach((ym) => {
    data.push({ range: `${ym}!E1`, values: [['ID']] });
    const rows = byYm.get(ym) || [];
    rows.forEach((a) => {
      data.push({ range: `${ym}!E${a.sheetRow}`, values: [[String(a.id)]] });
    });
  });

  // 1リクエストのサイズが大きくなりすぎないよう500件ずつチャンクする
  const CHUNK_SIZE = 500;
  for (let i = 0; i < data.length; i += CHUNK_SIZE) {
    await sheetsService.writeValuesBatch(data.slice(i, i + CHUNK_SIZE));
  }
}

if (require.main === module) {
  const dryRun = process.argv.includes('--dry-run');
  runMigration({ dryRun }).catch((err) => {
    console.error('migration failed:', err);
    process.exitCode = 1;
  });
}

module.exports = { runMigration };
