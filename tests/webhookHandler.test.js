process.env.LINE_CHANNEL_ACCESS_TOKEN = process.env.LINE_CHANNEL_ACCESS_TOKEN || 'dummy';
process.env.LINE_CHANNEL_SECRET = process.env.LINE_CHANNEL_SECRET || 'dummy';
process.env.SPREADSHEET_ID = process.env.SPREADSHEET_ID || 'dummy';
process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH = process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH || './credentials/service-account.json';

const { test, mock } = require('node:test');
const assert = require('node:assert/strict');

// sheetsService / flexBuilders / lineService を丸ごとモックに差し替える。
// webhookHandler.js は各モジュールをオブジェクトごと require するため
// （分割代入せずプロパティ経由で呼ぶ）、実装差し替え(mockImplementation)は
// require後でも反映される。

function makeMocks(names, implFactory) {
  const fns = {};
  const defaults = {};
  for (const name of names) {
    const impl = implFactory(name);
    defaults[name] = impl;
    fns[name] = mock.fn(impl);
  }
  return {
    exports: fns,
    reset() {
      for (const name of names) {
        fns[name].mock.resetCalls();
        fns[name].mock.mockImplementation(defaults[name]);
      }
    },
  };
}

function makeMocksFromDefaults(defaultsMap) {
  return makeMocks(Object.keys(defaultsMap), (name) => defaultsMap[name]);
}

const SHEETS_METHODS = [
  'listSheetTitles', 'exportAllSheets', 'ensureMonthlySheet', 'getMonthlyStatus',
  'setMonthlyStatus', 'assertMonthEditable', 'getMonthlyData', 'appendEntry',
  'deleteRow', 'updateCell', 'registerUser', 'getAllUserIds',
];
// dbService.jsは同期API（better-sqlite3）なので、デフォルト実装もPromiseを返さない同期関数にする。
// 本物のdbServiceを絶対にrequireさせない（本番データを含む data/kakeibo.db に誤ってアクセスしないため）。
const DB_DEFAULTS = {
  getMonthlyStatus: () => '',
  setMonthlyStatus: () => undefined,
  assertMonthEditable: () => undefined,
  getMonthlyEntries: () => [],
  getEntryById: () => undefined,
  insertEntry: () => ({ id: 1, ym: '2026-07', date: '2026-07-01', subject: '', price: 0, payer: 'c' }),
  updateEntryById: () => ({ id: 1, ym: '2026-07', date: '2026-07-01', subject: '', price: 0, payer: 'c' }),
  deleteEntryById: () => undefined,
  upsertUser: () => undefined,
  getAllUserIds: () => [],
};
// sheetsMirrorService.jsは実装（sheetsServiceへの実際のミラー処理）を素通りさせず、
// webhookHandlerが正しい引数で呼んでいるかだけを検証する（ミラー自体のロジックは
// sheetsMirrorService専用のテストで担保する想定）。
const MIRROR_METHODS = ['mirrorAppendEntry', 'mirrorUpdateEntry', 'mirrorDeleteEntry', 'mirrorSetStatus'];
const FLEX_METHODS = [
  'makePostbackButton', 'makeDatePickerButton', 'buildFlexMessage', 'buildToast', 'buildEmpty',
  'buildIdleMenu', 'buildAskDate', 'buildAskPayer', 'buildAddConfirmRows', 'buildAddConfirmFlex',
  'buildConfirm', 'buildAskStatus', 'buildAskMonth', 'buildOlderMonths', 'buildAskMonthDelete',
  'buildAskMonthEdit', 'buildMonthlyFlex', 'buildMonthSummary', 'buildAskRowEdit',
  'buildEditColumnSelect', 'buildEditValuePrompt', 'buildEditConfirm', 'buildDeleteRowList',
  'buildQuickInputGuide', 'buildQuickInputFailedGuide', 'buildReminderMessage',
];

// sheetsService/lineServiceの戻り値は `.catch()` で連結される箇所があるため
// （registerUserのfire-and-forget等）、デフォルト実装は必ずPromiseを返すasync関数にする。
const sheetsMocks = makeMocks(SHEETS_METHODS, () => async () => undefined);
const dbMocks = makeMocksFromDefaults(DB_DEFAULTS);
const mirrorMocks = makeMocks(MIRROR_METHODS, () => async () => undefined);
const flexMocks = makeMocks(FLEX_METHODS, (name) => (...args) => ({ __flex: name, args }));
const lineMocks = makeMocks(['replyMessage', 'pushMessage', 'broadcast'], () => async () => undefined);

mock.module('../src/sheetsService.js', { exports: sheetsMocks.exports });
mock.module('../src/dbService.js', { exports: dbMocks.exports });
mock.module('../src/sheetsMirrorService.js', { exports: mirrorMocks.exports });
mock.module('../src/flexBuilders.js', { exports: flexMocks.exports });
mock.module('../src/lineService.js', { exports: { client: lineMocks.exports, middleware: () => {} } });

const { handleEvents } = require('../src/webhookHandler');
const { setState, getState, clearState } = require('../src/state');
const config = require('../src/config');
const { STEP, ACT, PAYMENT_STATUS } = config;
const { LockedMonthError } = require('../src/errors');

/**
 * notifySettlementComplete（webhookHandler.js）はconfig.NOTIFY_USER_IDSを直接参照するため、
 * テストごとに送信先を変えたい場合はこの配列を書き換える（同一モジュールインスタンスの
 * 参照なのでwebhookHandler.js側にも反映される）。
 */
function setNotifyUserIds(...ids) {
  config.NOTIFY_USER_IDS.length = 0;
  config.NOTIFY_USER_IDS.push(...ids);
}

const sheets = sheetsMocks.exports;
const db = dbMocks.exports;
const mirror = mirrorMocks.exports;
const flex = flexMocks.exports;
const lineClient = lineMocks.exports;

function resetAll() {
  sheetsMocks.reset();
  dbMocks.reset();
  mirrorMocks.reset();
  flexMocks.reset();
  lineMocks.reset();
}

let uidCounter = 0;
function nextUserId() {
  uidCounter += 1;
  const id = `test-user-${uidCounter}`;
  clearState(id);
  return id;
}

function qs(data) {
  return Object.entries(data)
    .map(([k, v]) => `${k}=${encodeURIComponent(v)}`)
    .join('&');
}

function postbackEvent(userId, data, params) {
  return {
    type: 'postback',
    replyToken: 'reply-token',
    source: { userId },
    postback: { data: qs(data), params: params || {} },
  };
}

function messageEvent(userId, text) {
  return {
    type: 'message',
    replyToken: 'reply-token',
    source: { userId },
    message: { type: 'text', text },
  };
}

function lastReplyMessage() {
  const call = lineClient.replyMessage.mock.calls.at(-1);
  return call.arguments[1];
}

// ============================================================
// 追加フロー：状態遷移とロック処理
// ============================================================

test('START_ADDでASK_DATE状態に遷移しbuildAskDateを返信する', async () => {
  resetAll();
  const uid = nextUserId();
  await handleEvents([postbackEvent(uid, { act: ACT.START_ADD })]);
  assert.equal(getState(uid).step, STEP.ASK_DATE);
  assert.equal(flex.buildAskDate.mock.callCount(), 1);
});

test('日付選択（today）でロックされていなければWAIT_SUBJECTへ進む', async () => {
  resetAll();
  const uid = nextUserId();
  setState(uid, { step: STEP.ASK_DATE, data: {} });
  await handleEvents([postbackEvent(uid, { act: ACT.DATE_TODAY })]);
  assert.equal(getState(uid).step, STEP.WAIT_SUBJECT);
  assert.equal(db.assertMonthEditable.mock.callCount(), 1);
});

test('確定済み月への追加はLockedMonthErrorでブロックされ状態は変化しない', async () => {
  resetAll();
  const uid = nextUserId();
  setState(uid, { step: STEP.ASK_DATE, data: {} });
  db.assertMonthEditable.mock.mockImplementation(() => {
    throw new LockedMonthError('2026-07', '確定済');
  });
  await handleEvents([postbackEvent(uid, { act: ACT.DATE_TODAY })]);
  assert.equal(getState(uid).step, STEP.ASK_DATE);
  assert.equal(lastReplyMessage().text, '2026-07は「確定済」のため編集できません');
});

test('クイック入力はロックされた月だとinsertEntryを呼ばずエラーメッセージを返す', async () => {
  resetAll();
  const uid = nextUserId();
  db.assertMonthEditable.mock.mockImplementation(() => {
    throw new LockedMonthError('2026-07', '支払済');
  });
  await handleEvents([messageEvent(uid, 'スーパー 2500 c')]);
  assert.equal(db.insertEntry.mock.callCount(), 0);
  assert.equal(getState(uid).step, STEP.IDLE);
  assert.match(lastReplyMessage().text, /支払済/);
});

test('クイック入力が成功するとCONFIRM状態に遷移する', async () => {
  resetAll();
  const uid = nextUserId();
  await handleEvents([messageEvent(uid, 'スーパー 2500 c')]);
  assert.equal(getState(uid).step, STEP.CONFIRM);
  assert.equal(flex.buildAddConfirmFlex.mock.callCount(), 1);
});

test('確認画面でSAVEするとinsertEntryを正しい引数で呼びミラーを発火させ状態をクリアする', async () => {
  resetAll();
  const uid = nextUserId();
  db.insertEntry.mock.mockImplementation(() => ({ id: 42, ym: '2026-07', date: '2026-07-25', subject: 'スーパー', price: 2500, payer: 'c' }));
  setState(uid, { step: STEP.CONFIRM, data: { date: '2026-07-25', subject: 'スーパー', price: 2500, payer: 'c' } });
  await handleEvents([postbackEvent(uid, { act: ACT.SAVE })]);
  assert.equal(db.insertEntry.mock.callCount(), 1);
  assert.deepEqual(db.insertEntry.mock.calls[0].arguments[0], { date: '2026-07-25', subject: 'スーパー', price: 2500, payer: 'c' });
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mirror.mirrorAppendEntry.mock.callCount(), 1);
  assert.deepEqual(mirror.mirrorAppendEntry.mock.calls[0].arguments, [42, '2026-07-25', 'スーパー', 2500, 'c']);
  assert.equal(getState(uid).step, STEP.IDLE);
});

test('確認画面でEDITに戻ると入力をやり直しASK_DATEに戻る', async () => {
  resetAll();
  const uid = nextUserId();
  setState(uid, { step: STEP.CONFIRM, data: { date: '2026-07-25', subject: 'スーパー', price: 2500, payer: 'c' } });
  await handleEvents([postbackEvent(uid, { act: ACT.EDIT })]);
  assert.equal(getState(uid).step, STEP.ASK_DATE);
  assert.equal(db.insertEntry.mock.callCount(), 0);
});

// ============================================================
// 削除フロー
// ============================================================

test('確定済み月は削除もブロックされデータ取得すら行わない', async () => {
  resetAll();
  const uid = nextUserId();
  setState(uid, { step: STEP.ASK_MONTH_DELETE, data: {} });
  db.assertMonthEditable.mock.mockImplementation(() => {
    throw new LockedMonthError('2026-07', '確定済');
  });
  await handleEvents([postbackEvent(uid, { act: ACT.DELETE_MONTH, v: '2026-07' })]);
  assert.equal(db.getMonthlyEntries.mock.callCount(), 0);
  assert.equal(getState(uid).step, STEP.ASK_MONTH_DELETE);
});

test('削除確定でdeleteEntryByIdを呼びミラーを発火させ状態をクリアする', async () => {
  resetAll();
  const uid = nextUserId();
  setState(uid, { step: STEP.CONFIRM_DELETE, data: { ym: '2026-07' } });
  await handleEvents([postbackEvent(uid, { act: ACT.DELETE_ROW, v: '3' })]);
  assert.equal(db.deleteEntryById.mock.callCount(), 1);
  assert.deepEqual(db.deleteEntryById.mock.calls[0].arguments, ['2026-07', 3]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mirror.mirrorDeleteEntry.mock.callCount(), 1);
  assert.deepEqual(mirror.mirrorDeleteEntry.mock.calls[0].arguments, ['2026-07', 3]);
  assert.equal(getState(uid).step, STEP.IDLE);
});

// ============================================================
// 編集フロー
// ============================================================

test('編集で存在しない行を選ぶとValidationErrorになり状態は変化しない', async () => {
  resetAll();
  const uid = nextUserId();
  setState(uid, { step: STEP.ASK_EDIT_ROW, data: { ym: '2026-07' } });
  db.getEntryById.mock.mockImplementation(() => undefined);
  await handleEvents([postbackEvent(uid, { act: ACT.EDIT_ROW, v: '99' })]);
  assert.equal(getState(uid).step, STEP.ASK_EDIT_ROW);
  assert.match(lastReplyMessage().text, /見つかりません/);
});

test('編集で別の月のIDを選ぶとValidationErrorになり状態は変化しない', async () => {
  resetAll();
  const uid = nextUserId();
  setState(uid, { step: STEP.ASK_EDIT_ROW, data: { ym: '2026-07' } });
  db.getEntryById.mock.mockImplementation(() => ({ id: 5, ym: '2026-06', date: '2026-06-01', subject: 'x', price: 100, payer: 'c' }));
  await handleEvents([postbackEvent(uid, { act: ACT.EDIT_ROW, v: '5' })]);
  assert.equal(getState(uid).step, STEP.ASK_EDIT_ROW);
  assert.match(lastReplyMessage().text, /見つかりません/);
});

test('値段の編集を保存するとupdateEntryByIdが正しい引数で呼ばれミラーを発火させる', async () => {
  resetAll();
  const uid = nextUserId();
  db.updateEntryById.mock.mockImplementation(() => ({ id: 42, ym: '2026-07', date: '2026-07-10', subject: 'x', price: 3000, payer: 'c' }));
  setState(uid, {
    step: STEP.CONFIRM_EDIT,
    data: { ym: '2026-07', entryId: 42, column: '値段', newValue: 3000, current: {} },
  });
  await handleEvents([postbackEvent(uid, { act: ACT.SAVE_EDIT })]);
  assert.equal(db.updateEntryById.mock.callCount(), 1);
  assert.deepEqual(
    db.updateEntryById.mock.calls[0].arguments,
    ['2026-07', 42, { price: 3000 }]
  );
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(mirror.mirrorUpdateEntry.mock.callCount(), 1);
  assert.deepEqual(mirror.mirrorUpdateEntry.mock.calls[0].arguments, ['2026-07', 42, '2026-07-10', 'x', 3000, 'c']);
  assert.equal(getState(uid).step, STEP.IDLE);
});

test('編集をキャンセルすると保存されず状態がクリアされる', async () => {
  resetAll();
  const uid = nextUserId();
  setState(uid, {
    step: STEP.CONFIRM_EDIT,
    data: { ym: '2026-07', entryId: 42, column: '値段', newValue: 3000, current: {} },
  });
  await handleEvents([postbackEvent(uid, { act: ACT.CANCEL })]);
  assert.equal(db.updateEntryById.mock.callCount(), 0);
  assert.equal(getState(uid).step, STEP.IDLE);
});

// ============================================================
// ステータス変更・精算完了通知
// ============================================================

test('ステータスを支払済にすると操作者以外へ精算完了通知がpushされる', async () => {
  resetAll();
  const uid = nextUserId();
  setNotifyUserIds(uid, 'other-user');
  await handleEvents([postbackEvent(uid, { act: ACT.UPDATE_STATUS, ym: '2026-07', v: PAYMENT_STATUS[2] })]);
  assert.equal(db.setMonthlyStatus.mock.callCount(), 1);

  // notifySettlementCompleteはfire-and-forgetで待たれないため、マイクロタスクの完了を待つ
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lineClient.pushMessage.mock.callCount(), 1);
  assert.equal(lineClient.pushMessage.mock.calls[0].arguments[0], 'other-user');
});

test('操作者しかNOTIFY_USER_IDSに含まれない場合は精算完了通知を送らない', async () => {
  resetAll();
  const uid = nextUserId();
  setNotifyUserIds(uid);
  await handleEvents([postbackEvent(uid, { act: ACT.UPDATE_STATUS, ym: '2026-07', v: PAYMENT_STATUS[2] })]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lineClient.pushMessage.mock.callCount(), 0);
});

test('確定済への変更では精算完了通知を送らない', async () => {
  resetAll();
  const uid = nextUserId();
  setNotifyUserIds(uid, 'other-user');
  await handleEvents([postbackEvent(uid, { act: ACT.UPDATE_STATUS, ym: '2026-07', v: PAYMENT_STATUS[1] })]);
  await new Promise((resolve) => setImmediate(resolve));
  assert.equal(lineClient.pushMessage.mock.callCount(), 0);
});

// ============================================================
// 確認・その他
// ============================================================

test('確認で当月データが無ければbuildEmptyを返し状態をクリアする', async () => {
  resetAll();
  const uid = nextUserId();
  db.getMonthlyEntries.mock.mockImplementation(() => []);
  await handleEvents([postbackEvent(uid, { act: ACT.START_CHECK })]);
  assert.equal(flex.buildEmpty.mock.callCount(), 1);
  assert.equal(getState(uid).step, STEP.IDLE);
});

test('確認で当月データがあればDBから取得しサマリーと明細を送信する', async () => {
  resetAll();
  const uid = nextUserId();
  db.getMonthlyEntries.mock.mockImplementation(() => [
    { id: 1, ym: '2026-07', date: '2026-07-01', subject: 'スーパー', price: 2500, payer: 'c' },
  ]);
  db.getMonthlyStatus.mock.mockImplementation(() => '確定前');
  await handleEvents([postbackEvent(uid, { act: ACT.START_CHECK })]);
  assert.equal(flex.buildMonthSummary.mock.callCount(), 1);
  assert.equal(flex.buildMonthlyFlex.mock.callCount(), 1);
  assert.equal(sheets.getMonthlyData.mock.callCount(), 0);
  assert.equal(sheets.getMonthlyStatus.mock.callCount(), 0);
});

test('不明な状態のpostbackはStateErrorとしてエラーメッセージを返す', async () => {
  resetAll();
  const uid = nextUserId();
  setState(uid, { step: 'BOGUS_STEP', data: {} });
  await handleEvents([postbackEvent(uid, { act: 'not-a-known-action' })]);
  assert.match(lastReplyMessage().text, /不正な状態です/);
});

test('キャンセルpostbackで状態がクリアされる', async () => {
  resetAll();
  const uid = nextUserId();
  setState(uid, { step: STEP.WAIT_EDIT_VALUE, data: { ym: '2026-07' } });
  await handleEvents([postbackEvent(uid, { act: ACT.CANCEL })]);
  assert.equal(getState(uid).step, STEP.IDLE);
});
