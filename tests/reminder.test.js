process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'dummy';
process.env.LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'dummy';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'dummy';
process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './credentials/service-account.json';
process.env.REMINDER_USER_IDS = 'Udebug1';
process.env.NOTIFY_USER_IDS = 'Uall1,Uall2';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

// sheetsServiceを丸ごとモックに差し替え、月ごとの行データ・ステータスを固定値で返す
// （webhookHandler.test.jsと同じmock.moduleパターン）。

const MONTH_ROWS = {
  '2026-05': [
    ['2026/05/01', 'スーパー', 3000, 'c'],
    ['2026/05/10', 'カフェ', 1000, 'a'],
  ],
  '2026-06': [['2026/06/01', 'スーパー', 2000, 'c']],
  '2026-07': [],
};

const MONTH_STATUS = {
  '2026-05': '支払済',
  '2026-06': '確定済',
  '2026-07': '',
};

const TITLES = ['2026-05', '2026-06', '2026-07', '2026-08', 'users'];

const pushedTo = [];
let batchCallCount = 0;
let lastBatchYms = [];
let settledMonths = [];

mock.module('../src/sheetsService.js', {
  exports: {
    listSheetTitles: async () => TITLES,
    getMonthlyData: async (ym) => MONTH_ROWS[ym] || [],
    getMonthlyStatus: async (ym) => MONTH_STATUS[ym] || '',
    // collectUnpaidMonthsはAPI呼び出しを月数分に増やさないためこちらをbatchGet1回で使う
    // （個別のgetMonthlyData/getMonthlyStatusは使わない、2026-07-29のクォータ対応）。
    getMonthlyDataAndStatusBatch: async (yms) => {
      batchCallCount += 1;
      lastBatchYms = yms;
      const result = {};
      yms.forEach((ym) => {
        result[ym] = { values: MONTH_ROWS[ym] || [], status: MONTH_STATUS[ym] || '' };
      });
      return result;
    },
    // monthlyReminderの本番送信先はconfig.NOTIFY_USER_IDSを使うためgetAllUserIdsは参照されない。
    // 他のexportとインターフェースを揃えるためのダミー。
    getAllUserIds: async () => {
      throw new Error('getAllUserIds should not be called by reminder.js (NOTIFY_USER_IDS is used instead)');
    },
  },
});
mock.module('../src/lineService.js', {
  exports: {
    client: {
      // 'fail-user'宛のpushだけ失敗させ、monthlyReminderのcatch節（一部失敗しても他は送信継続）を検証する
      pushMessage: async (userId) => {
        if (userId === 'fail-user') throw new Error('push failed (test)');
        pushedTo.push(userId);
      },
    },
  },
});
mock.module('../src/reminderStore.js', {
  exports: {
    getSettledMonths: () => settledMonths,
    addSettledMonths: (yms) => {
      settledMonths = [...new Set([...settledMonths, ...yms])];
    },
  },
});

const { evaluateMonth, checkMonthStatus, collectUnpaidMonths, monthlyReminder } = require('../src/reminder');
const config = require('../src/config');
const flexBuilders = require('../src/flexBuilders');

test('evaluateMonth: ステータス未設定はneedsReminder=true（NEED_INPUT）', () => {
  const result = evaluateMonth('2026-04', [['2026/04/01', 'スーパー', 1000, 'c']], '');
  assert.equal(result.needsReminder, true);
  assert.equal(result.messageType, 'NEED_INPUT');
  assert.equal(result.status, config.PAYMENT_STATUS[0]);
});

test('evaluateMonth: ステータスが確定前でも明示的にneedsReminder=true（NEED_INPUT）', () => {
  const result = evaluateMonth('2026-04', [['2026/04/01', 'スーパー', 1000, 'c']], config.PAYMENT_STATUS[0]);
  assert.equal(result.needsReminder, true);
  assert.equal(result.messageType, 'NEED_INPUT');
});

test('checkMonthStatus: 支払済はneedsReminder=false（COMPLETED）', async () => {
  const result = await checkMonthStatus('2026-05');
  assert.equal(result.needsReminder, false);
  assert.equal(result.messageType, 'COMPLETED');
});

test('checkMonthStatus: 確定済はneedsReminder=true（NEED_PAYMENT）', async () => {
  const result = await checkMonthStatus('2026-06');
  assert.equal(result.needsReminder, true);
  assert.equal(result.messageType, 'NEED_PAYMENT');
});

test('checkMonthStatus: データなしはneedsReminder=true（NO_DATA）', async () => {
  const result = await checkMonthStatus('2026-07');
  assert.equal(result.needsReminder, true);
  assert.equal(result.messageType, 'NO_DATA');
});

test('collectUnpaidMonths: uptoYmより後の月・usersシートは除外し、古い月順に並べる', async () => {
  settledMonths = [];
  const results = await collectUnpaidMonths('2026-07');
  assert.deepEqual(results.map((r) => r.ym), ['2026-06', '2026-07']);
});

test('collectUnpaidMonths: 支払済（2026-05）はneedsReminder=falseのため含まれない', async () => {
  settledMonths = [];
  const results = await collectUnpaidMonths('2026-07');
  assert.ok(!results.some((r) => r.ym === '2026-05'));
});

test('collectUnpaidMonths: uptoYmを過去月にすると、それ以降の未対応月は対象外', async () => {
  settledMonths = [];
  const results = await collectUnpaidMonths('2026-05');
  assert.deepEqual(results, []);
});

test('collectUnpaidMonths: 対象月数によらずgetMonthlyDataAndStatusBatchは1回だけ呼ばれる（分間クォータ対策）', async () => {
  settledMonths = [];
  batchCallCount = 0;
  await collectUnpaidMonths('2026-07');
  assert.equal(batchCallCount, 1);
});

test('collectUnpaidMonths: 対象月が0件ならgetMonthlyDataAndStatusBatchを呼ばない', async () => {
  settledMonths = [];
  batchCallCount = 0;
  const results = await collectUnpaidMonths('2026-01');
  assert.deepEqual(results, []);
  assert.equal(batchCallCount, 0);
});

test('collectUnpaidMonths: 支払済と確認できた月はreminderStoreに記録される', async () => {
  settledMonths = [];
  await collectUnpaidMonths('2026-07');
  assert.deepEqual(settledMonths, ['2026-05']);
});

test('collectUnpaidMonths: reminderStoreに記録済みの月はgetMonthlyDataAndStatusBatchの対象から除外される', async () => {
  settledMonths = ['2026-05'];
  batchCallCount = 0;
  lastBatchYms = [];
  const results = await collectUnpaidMonths('2026-07');
  assert.deepEqual(lastBatchYms, ['2026-06', '2026-07']);
  assert.ok(!results.some((r) => r.ym === '2026-05'));
});

test('monthlyReminder: sendToAll=true（デフォルト）はNOTIFY_USER_IDS（利用者2人）に送る', async () => {
  settledMonths = [];
  pushedTo.length = 0;
  await monthlyReminder(true);
  assert.deepEqual(pushedTo, ['Uall1', 'Uall2']);
});

test('monthlyReminder: sendToAll=false（--debug相当）はREMINDER_USER_IDSの1人にのみ送る', async () => {
  settledMonths = [];
  pushedTo.length = 0;
  await monthlyReminder(false);
  assert.deepEqual(pushedTo, ['Udebug1']);
});

test('monthlyReminder: 送信先が0件なら何もせず（例外を投げず）終了する', async () => {
  const original = [...config.NOTIFY_USER_IDS];
  config.NOTIFY_USER_IDS.length = 0;
  pushedTo.length = 0;
  try {
    await assert.doesNotReject(monthlyReminder(true));
    assert.deepEqual(pushedTo, []);
  } finally {
    config.NOTIFY_USER_IDS.push(...original);
  }
});

test('monthlyReminder: buildReminderMessageがnullを返す場合は送信せず終了する（通常のevaluateMonthロジックでは発生しないが、防御的分岐として存在するため直接検証）', async (t) => {
  settledMonths = [];
  pushedTo.length = 0;
  t.mock.method(flexBuilders, 'buildReminderMessage', () => null);
  await assert.doesNotReject(monthlyReminder(true));
  assert.deepEqual(pushedTo, []);
});

test('monthlyReminder: 対象月が無ければ何もせず終了する', async () => {
  // lastMonthYm（実行時の先月）まで全て支払済扱いにし、collectUnpaidMonthsが空を返す状況を再現。
  // 実行日に依存せず常に成立するよう、対象範囲を実際のlastMonthYm算出ロジックと同じ式で動的に求める
  // （固定の年月をハードコードすると、テスト実行日が進んだ際に不要な月が対象外から漏れて失敗するため）。
  const now = new Date();
  const lastMonth = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  const lastMonthYm = `${lastMonth.getFullYear()}-${String(lastMonth.getMonth() + 1).padStart(2, '0')}`;
  settledMonths = TITLES.filter((t) => /^\d{4}-\d{2}$/.test(t) && t <= lastMonthYm);
  pushedTo.length = 0;
  await monthlyReminder(true);
  assert.deepEqual(pushedTo, []);
});

test('monthlyReminder: 一部の送信先へのpushが失敗しても他の送信先には送り、例外は投げない', async () => {
  settledMonths = [];
  const original = [...config.NOTIFY_USER_IDS];
  config.NOTIFY_USER_IDS.length = 0;
  config.NOTIFY_USER_IDS.push('fail-user', 'Uall1');
  pushedTo.length = 0;
  try {
    await assert.doesNotReject(monthlyReminder(true));
    assert.deepEqual(pushedTo, ['Uall1']);
  } finally {
    config.NOTIFY_USER_IDS.length = 0;
    config.NOTIFY_USER_IDS.push(...original);
  }
});
