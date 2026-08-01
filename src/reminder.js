/**
 * reminder.js
 * リマインド機能（GAS版 Reminder.gs の移植）
 *
 * Pi上のcronから毎月1日9:00・第2月曜9:00の2回 `node src/reminder.js` を実行する想定
 * （設置は `../../ラズパイ/CLAUDE.md` 参照）。「先月分のみ」ではなく、先月までに存在する
 * 月次シートのうち支払済（PAYMENT_STATUS[2]）でないものすべてをチェックし、まとめて通知する
 * （2026-07-29、「先月分だけでなく未対応の月すべてに連絡してほしい」との依頼により変更）。
 *
 * 第2月曜日のcron（`0 9 * * 1`、標準cronはday-of-monthとday-of-weekを両方指定するとOR判定に
 * なるため、day-of-week単体指定＋本スクリプト側での日付ガードで「第2月曜のみ」に絞り込む）は
 * `--dow-check`付きで呼び出すこと。1日のcron（`0 9 1 * *`）はガード不要（day-of-month単体指定
 * のみで曖昧さがないため）。
 *
 * 実行方法（2026-07-29、「本番は2人全員・デバッグ時は1人」に変更。従来の--allは廃止しデフォルト動作に統合）:
 *   node src/reminder.js               … .envのNOTIFY_USER_IDS（利用者2人）に送信
 *   node src/reminder.js --debug       … .envのREMINDER_USER_IDS（テスト用1名）のみに送信
 *   node src/reminder.js --dow-check   … 今日が第2月曜（8〜14日のいずれか）でなければ何もせず終了
 *
 * 本番送信先は`usersシート`（sheets.getAllUserIds()）ではなく`.env`のNOTIFY_USER_IDSを明示的に使う。
 * usersシートは開発中に登録されたテスト用ID（"Utest"等）が混入しうるため（2026-07-29実際に確認、
 * 詳細はCLAUDE.md参照）、送信先としては信頼しない。
 */

const { client } = require('./lineService');
const sheets = require('./sheetsService');
const flex = require('./flexBuilders');
const reminderStore = require('./reminderStore');
const { formatInTZ } = require('./utils');
const config = require('./config');

/**
 * 明細データ・ステータスから、月ごとのリマインド要否を判定する（APIを呼ばない純粋関数）。
 */
function evaluateMonth(ym, values, status) {
  const [year, month] = ym.split('-');

  if (values.length === 0) {
    return { ym, year: Number(year), month: Number(month), status: null, hasData: false, needsReminder: true, messageType: 'NO_DATA' };
  }

  const dataCount = values.length;
  const total = values.reduce((sum, row) => sum + (Number(row[2]) || 0), 0);

  let needsReminder = false;
  let messageType = 'COMPLETED';

  if (!status || status === config.PAYMENT_STATUS[0]) {
    needsReminder = true;
    messageType = 'NEED_INPUT';
  } else if (status === config.PAYMENT_STATUS[1]) {
    needsReminder = true;
    messageType = 'NEED_PAYMENT';
  }

  return {
    ym,
    year: Number(year),
    month: Number(month),
    status: status || config.PAYMENT_STATUS[0],
    hasData: true,
    dataCount,
    total,
    needsReminder,
    messageType,
  };
}

/**
 * 1ヶ月分のリマインド要否をチェックする（単月の動作確認・デバッグ用）。
 * `collectUnpaidMonths`は月数分のAPI呼び出しを避けるため、これは使わず
 * `getMonthlyDataAndStatusBatch`で直接まとめて取得する。
 */
async function checkMonthStatus(ym) {
  const titles = await sheets.listSheetTitles();
  if (!titles.includes(ym)) return evaluateMonth(ym, [], null);

  const values = await sheets.getMonthlyData(ym);
  if (values.length === 0) return evaluateMonth(ym, [], null);

  const status = await sheets.getMonthlyStatus(ym);
  return evaluateMonth(ym, values, status);
}

/**
 * 先月までに存在する月次シートのうち、支払済でないもの（NO_DATA/NEED_INPUT/NEED_PAYMENT）を
 * 古い月順に集める。月数分のAPI呼び出しに膨らまないよう、データ取得は
 * `getMonthlyDataAndStatusBatch`のbatchGet1回にまとめている（2026-07-29、月数の多い実データで
 * Sheets APIの分間クォータに抵触したため対応。詳細はCLAUDE.md参照）。
 *
 * 加えて、`reminderStore`に「支払済確認済み」として記録済みの月はSheets API呼び出し自体を
 * 省略する（支払済の月は確定前に戻さない限り再編集できず状態が変わらないため、一度確認できれば
 * 以後チェック不要。2026-07-29、「支払済の月は今後確認しなくていいようにして」との依頼により追加）。
 * @param {string} uptoYm 'yyyy-MM'（この月を含めて以前の月が対象）
 */
async function collectUnpaidMonths(uptoYm) {
  const titles = await sheets.listSheetTitles();
  const monthTitles = titles.filter((t) => /^\d{4}-\d{2}$/.test(t) && t <= uptoYm).sort();

  const settled = new Set(reminderStore.getSettledMonths());
  const monthsToCheck = monthTitles.filter((ym) => !settled.has(ym));
  if (monthsToCheck.length === 0) return [];

  const batch = await sheets.getMonthlyDataAndStatusBatch(monthsToCheck);
  const results = monthsToCheck.map((ym) => evaluateMonth(ym, batch[ym].values, batch[ym].status));

  const newlySettled = results.filter((r) => r.messageType === 'COMPLETED').map((r) => r.ym);
  reminderStore.addSettledMonths(newlySettled);

  return results.filter((result) => result.needsReminder);
}

async function monthlyReminder(sendToAll = true) {
  const userIds = sendToAll ? config.NOTIFY_USER_IDS : config.REMINDER_USER_IDS;

  if (userIds.length === 0) {
    console.log(`No user IDs found (sendToAll=${sendToAll})`);
    return;
  }

  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthYm = formatInTZ(lastMonth, 'yyyy-MM');

  const results = await collectUnpaidMonths(lastMonthYm);
  console.log(`Checked up to ${lastMonthYm}: ${results.length}件が要リマインド (${results.map((r) => r.ym).join(', ') || 'なし'})`);

  if (results.length === 0) {
    console.log('No reminder needed');
    return;
  }

  const message = flex.buildReminderMessage(results);
  if (!message) {
    console.log('buildReminderMessage returned null, nothing to send');
    return;
  }

  let success = 0;
  let failed = 0;
  for (const userId of userIds) {
    try {
      await client.pushMessage(userId, message);
      success += 1;
    } catch (err) {
      failed += 1;
      console.error(`Failed to send reminder to ${userId}:`, err.message);
    }
  }
  console.log(`Reminder sent (${results.map((r) => r.ym).join(', ')}): success=${success} failed=${failed}`);
}

if (require.main === module) {
  const args = process.argv.slice(2);
  const debug = args.includes('--debug');
  const sendToAll = !debug;
  const dowCheck = args.includes('--dow-check');

  if (dowCheck) {
    const dayOfMonth = Number(formatInTZ(new Date(), 'd'));
    if (dayOfMonth < 8 || dayOfMonth > 14) {
      console.log(`--dow-check: 本日(${dayOfMonth}日)は第2月曜日ではないためスキップします`);
      process.exit(0);
    }
  }

  monthlyReminder(sendToAll).catch((err) => {
    console.error('monthlyReminder failed:', err);
    process.exitCode = 1;
  });
}

module.exports = { evaluateMonth, checkMonthStatus, collectUnpaidMonths, monthlyReminder };
