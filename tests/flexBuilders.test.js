process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'dummy';
process.env.LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'dummy';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'dummy';
process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './credentials/service-account.json';

const { test } = require('node:test');
const assert = require('node:assert/strict');
const flex = require('../src/flexBuilders');
const { calcSettlement, calcMonthlyStats } = require('../src/utils');

const sampleRows = [
  ['2026/07/01', 'スーパー', 2500, 'c'],
  ['2026/07/10', 'カフェ', 800, 'a'],
];

test('buildMonthSummary: 精算ありの場合はStatusを変更ボタンと他の月を見るボタンが両方出る', () => {
  const settlement = calcSettlement(sampleRows);
  const stats = calcMonthlyStats('2026-07', sampleRows);
  const msg = flex.buildMonthSummary('2026-07', stats, { ...settlement, status: '確定前' }, '確定前');
  const buttonBox = msg.contents.body.contents.find((c) => c.layout === 'vertical' && c.contents?.[0]?.action);
  const labels = buttonBox.contents.map((b) => b.action.label);
  assert.ok(labels.includes('Statusを変更'));
  assert.ok(labels.includes('他の月を見る'));
});

test('buildMonthSummary: 精算不要（null）でも他の月を見るボタンは出る', () => {
  const evenRows = [
    ['2026/07/01', 'A', 1000, 'c'],
    ['2026/07/02', 'B', 1000, 'a'],
  ];
  const settlement = calcSettlement(evenRows);
  const stats = calcMonthlyStats('2026-07', evenRows);
  const msg = flex.buildMonthSummary('2026-07', stats, settlement, '確定前');
  const buttonBox = msg.contents.body.contents.find((c) => c.layout === 'vertical' && c.contents?.[0]?.action);
  const labels = buttonBox.contents.map((b) => b.action.label);
  assert.ok(!labels.includes('Statusを変更'));
  assert.ok(labels.includes('他の月を見る'));
});

test('buildMonthlyFlex: rowsのみ渡した場合はstats/settlementブロックを含まない', () => {
  const msg = flex.buildMonthlyFlex('2026-07', sampleRows, null, null);
  const text = JSON.stringify(msg);
  assert.ok(!text.includes('📊 統計'));
  assert.ok(!text.includes('💰 精算'));
});

function makeReminderResult(ym, messageType, overrides = {}) {
  const [year, month] = ym.split('-');
  return {
    ym,
    year: Number(year),
    month: Number(month),
    status: '確定前',
    dataCount: 3,
    total: 5000,
    needsReminder: true,
    messageType,
    ...overrides,
  };
}

test('buildReminderMessage: 空配列やCOMPLETEDのみの場合はnull', () => {
  assert.equal(flex.buildReminderMessage([]), null);
  assert.equal(flex.buildReminderMessage([makeReminderResult('2026-06', 'COMPLETED')]), null);
});

test('buildReminderMessage: 1件ならbubble単体（altTextは対象月のタイトル）', () => {
  const msg = flex.buildReminderMessage([makeReminderResult('2026-06', 'NEED_PAYMENT')]);
  assert.equal(msg.contents.type, 'bubble');
  assert.equal(msg.altText, '精算・支払いをお願いします');
  assert.ok(JSON.stringify(msg).includes('2026年6月'));
});

test('buildReminderMessage: 複数件ならcarouselにまとめ、各月の内容を含む', () => {
  const msg = flex.buildReminderMessage([
    makeReminderResult('2026-05', 'NEED_PAYMENT'),
    makeReminderResult('2026-06', 'NEED_INPUT'),
  ]);
  assert.equal(msg.contents.type, 'carousel');
  assert.equal(msg.contents.contents.length, 2);
  const text = JSON.stringify(msg);
  assert.ok(text.includes('2026年5月'));
  assert.ok(text.includes('2026年6月'));
});

test('buildIdleMenu / buildAskDate / buildAskMonth など基本ビルダーは例外を投げない', () => {
  assert.doesNotThrow(() => flex.buildIdleMenu());
  assert.doesNotThrow(() => flex.buildAskDate());
  assert.doesNotThrow(() => flex.buildAskPayer());
  assert.doesNotThrow(() => flex.buildAskMonth());
  assert.doesNotThrow(() => flex.buildOlderMonths());
  assert.doesNotThrow(() => flex.buildAskMonthDelete());
  assert.doesNotThrow(() => flex.buildAskMonthEdit());
  assert.doesNotThrow(() => flex.buildQuickInputGuide());
});
