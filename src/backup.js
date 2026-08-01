/**
 * backup.js
 * DB（data/kakeibo.db、SQLite）を主バックアップとしてローカルに書き出す（2026-07-30〜、DB主体化）。
 * あわせてスプレッドシート全体（全月次シート＋usersシート）のJSONエクスポートも副次バックアップ
 * として保存する（人間可読な形での保存、およびDBとのクロスチェック用）。
 * Pi上のcronで週次実行する想定（設置は `../../ラズパイ/CLAUDE.md` 参照）。
 *
 * ローカル保存（Piのbackup/ディレクトリ）に加え、GDRIVE_BACKUP_FOLDER_ID設定時は
 * DBファイル・Sheetsエクスポート両方をGoogle Driveへもアップロードする（Piのストレージ自体が
 * 壊れた場合の保険）。サービスアカウントはDriveの保存容量を持たず新規ファイル作成ができない
 * （"Service Accounts do not have storage quota"エラーになる）ため、ユーザー本人のOAuthリフレッシュ
 * トークン（GDRIVE_OAUTH_REFRESH_TOKEN、scripts/get_drive_token.jsで取得）を使ってユーザー自身の
 * Drive容量にアップロードする方式にしている。
 * Drive側の処理・Sheetsエクスポート側の処理はあくまで補助のため、失敗してもDBのローカル
 * バックアップ自体が成功していれば致命的エラーとしては扱わない（通知のみ）。
 *
 * 実行方法: node src/backup.js
 */

const fs = require('fs');
const path = require('path');
const { google } = require('googleapis');
const sheets = require('./sheetsService');
const db = require('./dbService');
const config = require('./config');
const { formatInTZ } = require('./utils');

const BACKUP_DIR = path.join(__dirname, '..', 'backup');
const RETENTION_DAYS = 90;
const NOTIFY_URL = process.env.NOTIFY_BOT_URL || 'http://127.0.0.1:3004/notify';

/**
 * バックアップ失敗を監視通知Bot（notify-bot）経由でLINEへ通知する
 * （2026-07-29追加。それまでは失敗してもbackup.logに記録されるだけで誰も気づけなかった）。
 * 通知自体の失敗はバックアップ処理の成否に影響させない（ログのみ）。
 */
async function notifyFailure(msg) {
  try {
    const res = await fetch(NOTIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ msg }),
    });
    if (!res.ok) console.error(`notify-bot returned ${res.status}`);
  } catch (err) {
    console.error('notify-botへの通知に失敗:', err.message);
  }
}

async function runBackup() {
  if (!fs.existsSync(BACKUP_DIR)) fs.mkdirSync(BACKUP_DIR, { recursive: true });
  const dateStr = formatInTZ(new Date(), 'yyyy-MM-dd');

  // 主バックアップ: DBファイル（better-sqlite3のネイティブbackup API、WAL中でも安全に取得できる）
  const dbFilename = `${dateStr}.db`;
  const dbFilepath = path.join(BACKUP_DIR, dbFilename);
  await db.backupTo(dbFilepath);
  console.log(`DB backup written: ${dbFilepath}`);

  // 副次バックアップ: スプレッドシートのエクスポート（人間可読な保存・DBとのクロスチェック用）。
  // DB側の主バックアップは既に成功しているため、ここが失敗しても非致命的として扱う。
  let sheetsFilepath = null;
  let sheetsFilename = null;
  try {
    const data = await sheets.exportAllSheets();
    sheetsFilename = `${dateStr}-sheets.json`;
    sheetsFilepath = path.join(BACKUP_DIR, sheetsFilename);
    fs.writeFileSync(sheetsFilepath, JSON.stringify(data, null, 2), 'utf8');
    console.log(`Sheets export backup written: ${sheetsFilepath}`);
  } catch (err) {
    console.error('Sheets export backup failed (DB backup succeeded):', err);
    await notifyFailure(`⚠️ 家計簿Bot: Sheetsエクスポートのバックアップが失敗しました（DBバックアップは成功）\n${err.message}`);
  }

  cleanupOldBackups();

  try {
    await backupToDrive(dbFilepath, dbFilename, 'application/x-sqlite3');
    if (sheetsFilepath) {
      await backupToDrive(sheetsFilepath, sheetsFilename, 'application/json');
    }
  } catch (err) {
    console.error('Google Drive backup failed (local backup succeeded):', err);
    await notifyFailure(`⚠️ 家計簿Bot: Google Driveバックアップが失敗しました（ローカルバックアップは成功）\n${err.message}`);
  }
}

function cleanupOldBackups() {
  const now = Date.now();
  const files = fs.readdirSync(BACKUP_DIR).filter((f) => f.endsWith('.json') || f.endsWith('.db'));

  files.forEach((f) => {
    const filepath = path.join(BACKUP_DIR, f);
    const ageDays = (now - fs.statSync(filepath).mtimeMs) / (1000 * 60 * 60 * 24);
    if (ageDays > RETENTION_DAYS) {
      fs.unlinkSync(filepath);
      console.log(`Removed old backup: ${f}`);
    }
  });
}

// ============================================================
// Google Driveへのオフサイトバックアップ（任意設定）
// ============================================================

let driveClientPromise = null;

function getDriveClient() {
  if (!driveClientPromise) {
    const auth = new google.auth.OAuth2(
      config.GDRIVE_OAUTH_CLIENT_ID,
      config.GDRIVE_OAUTH_CLIENT_SECRET
    );
    auth.setCredentials({ refresh_token: config.GDRIVE_OAUTH_REFRESH_TOKEN });
    driveClientPromise = Promise.resolve(google.drive({ version: 'v3', auth }));
  }
  return driveClientPromise;
}

async function backupToDrive(filepath, filename, mimeType) {
  if (!config.GDRIVE_BACKUP_FOLDER_ID) {
    console.log('GDRIVE_BACKUP_FOLDER_ID未設定のためGoogle Driveへのアップロードをスキップします');
    return;
  }
  if (!config.GDRIVE_OAUTH_REFRESH_TOKEN) {
    console.log('GDRIVE_OAUTH_REFRESH_TOKEN未設定のためGoogle Driveへのアップロードをスキップします');
    return;
  }

  const drive = await getDriveClient();
  await drive.files.create({
    requestBody: { name: filename, parents: [config.GDRIVE_BACKUP_FOLDER_ID] },
    media: { mimeType, body: fs.createReadStream(filepath) },
    fields: 'id',
  });
  console.log(`Drive backup uploaded: ${filename}`);

  await cleanupOldDriveBackups(drive);
}

async function cleanupOldDriveBackups(drive) {
  const cutoff = new Date(Date.now() - RETENTION_DAYS * 24 * 60 * 60 * 1000).toISOString();
  const res = await drive.files.list({
    q: `'${config.GDRIVE_BACKUP_FOLDER_ID}' in parents and createdTime < '${cutoff}' and trashed = false`,
    fields: 'files(id, name)',
  });

  for (const file of res.data.files || []) {
    await drive.files.delete({ fileId: file.id });
    console.log(`Removed old Drive backup: ${file.name}`);
  }
}

if (require.main === module) {
  runBackup().catch(async (err) => {
    console.error('backup failed:', err);
    await notifyFailure(`⚠️ 家計簿Bot: バックアップ処理が失敗しました\n${err.message}`);
    process.exitCode = 1;
  });
}

module.exports = { runBackup };
