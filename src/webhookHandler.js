/**
 * webhookHandler.js
 * イベントハンドラーとルーティング（GAS版 Handlers.gs / Steps.gs の移植）
 *
 * GAS版との差分:
 * - ユーザー登録（users シート更新）は事前チェックを待たずfire-and-forgetで行う。
 *   GAS版は同期的に実行し失敗すると本来の操作そのものがエラー扱いになってしまう
 *   構造だったため、Node.js版ではログのみ出す非致命的な処理に変更した。
 * - 編集時の日付列変更に伴う自動再ソート（sortMonthlySheet_）は行わない
 *   （sheetsService.js の設計方針: 新規行は末尾追加、表示時に都度ソート）。
 */

const { client } = require('./lineService');
const { getState, setState, clearState } = require('./state');
const { parseQuickInput, toHalfWidth } = require('./quickInput');
const db = require('./dbService');
const mirror = require('./sheetsMirrorService');
const flex = require('./flexBuilders');
const {
  calcSettlement,
  calcMonthlyStats,
  isoDate,
  normalizeAmount,
  getCurrentValueForEdit,
  formatEditValue,
  nowTimestamp,
} = require('./utils');
const { ACT, STEP, PAGE_SIZE, UI_COLORS, STATUS_STYLE, PAYMENT_STATUS, NOTIFY_USER_IDS } = require('./config');
const { ValidationError, StateError } = require('./errors');

async function handleEvents(events) {
  await Promise.all(events.map((ev) => handleEvent(ev).catch((err) => handleEventError(ev, err))));
}

async function handleEventError(ev, err) {
  console.error('event handling failed:', err);
  if (!ev.replyToken) return;
  try {
    await client.replyMessage(ev.replyToken, {
      type: 'text',
      text: err.userMessage || '処理中にエラーが発生しました',
    });
  } catch (replyErr) {
    console.error('failed to notify user of error:', replyErr);
  }
}

async function handleEvent(ev) {
  const userId = ev.source && ev.source.userId;
  const replyToken = ev.replyToken;
  if (!userId || !replyToken) return;

  try {
    db.upsertUser(userId, nowTimestamp());
  } catch (err) {
    console.error('upsertUser failed:', err);
  }

  if (ev.type === 'postback') {
    await handlePostback(ev, userId, replyToken);
  } else if (ev.type === 'message' && ev.message.type === 'text') {
    await handleMessage(ev, userId, replyToken);
  }
}

function parseQuery(q) {
  if (!q) return {};
  return q.split('&').reduce((obj, pair) => {
    if (!pair) return obj;
    const [key, ...rest] = pair.split('=');
    obj[key] = decodeURIComponent(rest.join('='));
    return obj;
  }, {});
}

// ============================================================
// Postback ルーティング
// ============================================================

async function handlePostback(ev, userId, replyToken) {
  const data = parseQuery(ev.postback.data || '');
  const params = ev.postback.params || {};
  const state = getState(userId);

  if (data.act === ACT.START_CHECK) {
    clearState(userId);
    await handleShowMonth(replyToken, userId, isoDate(0).slice(0, 7));
    return;
  }

  if (data.act === ACT.SHOW_MONTH_PICKER) {
    setState(userId, { step: STEP.ASK_MONTH, data: {} });
    await client.replyMessage(replyToken, flex.buildAskMonth());
    return;
  }

  const startActions = {
    [ACT.START_ADD]: [STEP.ASK_DATE, () => flex.buildAskDate()],
    [ACT.START_DELETE]: [STEP.ASK_MONTH_DELETE, () => flex.buildAskMonthDelete()],
    [ACT.START_EDIT]: [STEP.ASK_EDIT_MONTH, () => flex.buildAskMonthEdit()],
  };

  if (startActions[data.act]) {
    clearState(userId);
    const [step, build] = startActions[data.act];
    setState(userId, { step, data: {} });
    await client.replyMessage(replyToken, build());
    return;
  }

  if (data.act === ACT.CANCEL) {
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildToast('キャンセルしました', { icon: '✖️', color: UI_COLORS.textLight }));
    return;
  }

  if (data.act === ACT.SET_STATUS) {
    await client.replyMessage(replyToken, flex.buildAskStatus(data.ym));
    return;
  }
  if (data.act === ACT.UPDATE_STATUS) {
    db.setMonthlyStatus(data.ym, data.v);
    mirror.mirrorSetStatus(data.ym, data.v).catch((err) => console.error('mirror status failed:', err));
    const style = STATUS_STYLE[data.v] || {};
    await client.replyMessage(replyToken, flex.buildToast(`ステータスを「${data.v}」に更新しました`, { icon: style.icon, color: style.color }));
    if (data.v === PAYMENT_STATUS[2]) {
      notifySettlementComplete(data.ym, userId).catch((err) => console.error('settlement notify failed:', err));
    }
    return;
  }

  if (data.act === ACT.SHOW_MENU) {
    await client.replyMessage(replyToken, flex.buildIdleMenu());
    return;
  }
  if (data.act === ACT.SHOW_GUIDE) {
    await client.replyMessage(replyToken, flex.buildQuickInputGuide());
    return;
  }

  const stepHandlers = {
    [STEP.ASK_DATE]: handleStepAskDate,
    [STEP.ASK_PAYER]: handleStepAskPayer,
    [STEP.CONFIRM]: handleStepConfirm,
    [STEP.ASK_MONTH]: handleStepAskMonth,
    [STEP.ASK_MONTH_DELETE]: handleStepAskMonthDelete,
    [STEP.CONFIRM_DELETE]: handleStepConfirmDelete,
    [STEP.ASK_EDIT_MONTH]: handleStepAskEditMonth,
    [STEP.ASK_EDIT_ROW]: handleStepAskEditRow,
    [STEP.ASK_EDIT_COLUMN]: handleStepAskEditColumn,
    [STEP.WAIT_EDIT_VALUE]: handleStepWaitEditValue,
    [STEP.CONFIRM_EDIT]: handleStepConfirmEdit,
  };

  const handler = stepHandlers[state.step];
  if (!handler) {
    throw new StateError(`Unknown step: ${state.step}`, '不正な状態です。最初からやり直してください。');
  }
  await handler(state, data, replyToken, userId, params);
}

// ============================================================
// 精算完了通知（ステータスを「支払済」にした本人以外の登録ユーザーへPush）
// ============================================================

/**
 * 送信先は`sheets.getAllUserIds()`（usersシート）ではなく`config.NOTIFY_USER_IDS`
 * （利用者2人を明示指定）を使う。usersシートには開発時の残留テストID（"Utest"）が
 * 混入していることが判明した（reminder.jsの本番送信先と同じ理由、2026-07-29修正）。
 */
async function notifySettlementComplete(ym, actingUserId) {
  const targets = NOTIFY_USER_IDS.filter((id) => id !== actingUserId);
  if (targets.length === 0) return;

  const [year, month] = ym.split('-');
  const message = flex.buildToast(`${Number(year)}年${Number(month)}月の精算が完了しました`, { icon: '🎉', color: UI_COLORS.payerC });

  await Promise.all(
    targets.map((id) => client.pushMessage(id, message).catch((err) => console.error(`settlement push to ${id} failed:`, err)))
  );
}

// ============================================================
// ステップハンドラー：追加フロー
// ============================================================

async function handleStepAskDate(state, data, replyToken, userId, params = {}) {
  const offsetMap = { [ACT.DATE_TODAY]: 0, [ACT.DATE_YESTERDAY]: -1 };

  if (data.act in offsetMap) state.data.date = isoDate(offsetMap[data.act]);
  else if (data.act === ACT.DATE_PICK && params.date) state.data.date = params.date;
  else return;

  db.assertMonthEditable(state.data.date.slice(0, 7));

  state.step = STEP.WAIT_SUBJECT;
  setState(userId, state);
  await client.replyMessage(replyToken, { type: 'text', text: '題目を入力してください' });
}

async function handleStepAskPayer(state, data, replyToken, userId) {
  if (data.act !== ACT.PAYER) return;
  state.data.payer = data.v;
  state.step = STEP.CONFIRM;
  setState(userId, state);
  await client.replyMessage(replyToken, flex.buildConfirm(state.data));
}

async function handleStepConfirm(state, data, replyToken, userId) {
  if (data.act === ACT.SAVE) {
    const created = db.insertEntry({
      date: state.data.date,
      subject: state.data.subject,
      price: state.data.price,
      payer: state.data.payer,
    });
    mirror
      .mirrorAppendEntry(created.id, created.date, created.subject, created.price, created.payer)
      .catch((err) => console.error('mirror append failed:', err));
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildToast('保存しました'));
    return;
  }
  if (data.act === ACT.EDIT) {
    clearState(userId);
    setState(userId, { step: STEP.ASK_DATE, data: {} });
    await client.replyMessage(replyToken, flex.buildAskDate());
  }
}

// ============================================================
// ステップハンドラー：確認フロー
// ============================================================

async function handleStepAskMonth(state, data, replyToken, userId) {
  if (data.act !== ACT.MONTH) return;
  if (data.v === 'other') {
    await client.replyMessage(replyToken, flex.buildOlderMonths());
    return;
  }
  await handleShowMonth(replyToken, userId, data.v);
}

async function handleShowMonth(replyToken, userId, ym) {
  // 読み取り経路はDB主体化済み（2026-07-30〜）。DBはSQLで既に日付順のため
  // クライアント側ソートは不要（以前はSheetsが物理行順のままだったため必要だった）。
  const entries = db.getMonthlyEntries(ym);
  if (entries.length === 0) {
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildEmpty('その月のデータはありません'));
    return;
  }

  clearState(userId);

  const sorted = entries.map((e) => [e.date, e.subject, e.price, e.payer]);
  const settlement = calcSettlement(sorted);
  const stats = calcMonthlyStats(ym, sorted);
  const status = db.getMonthlyStatus(ym);

  // 合計・精算をスクロールせず即確認できるよう、明細一覧より先にサマリーを送る
  const messages = [flex.buildMonthSummary(ym, stats, settlement, status)];
  for (let i = 0; i < sorted.length; i += PAGE_SIZE) {
    const page = sorted.slice(i, i + PAGE_SIZE);
    messages.push(flex.buildMonthlyFlex(ym, page, null, null));
  }

  await client.replyMessage(replyToken, messages);
}

// ============================================================
// ステップハンドラー：削除フロー
// ============================================================

async function handleStepAskMonthDelete(state, data, replyToken, userId) {
  if (data.act !== ACT.DELETE_MONTH) return;
  db.assertMonthEditable(data.v);

  const entries = db.getMonthlyEntries(data.v);
  if (entries.length === 0) {
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildEmpty('データがありません'));
    return;
  }

  setState(userId, { step: STEP.CONFIRM_DELETE, data: { ym: data.v } });
  await client.replyMessage(replyToken, flex.buildDeleteRowList(data.v, entries));
}

async function handleStepConfirmDelete(state, data, replyToken, userId) {
  if (data.act !== ACT.DELETE_ROW) return;
  const id = Number(data.v);
  db.deleteEntryById(state.data.ym, id);
  mirror.mirrorDeleteEntry(state.data.ym, id).catch((err) => console.error('mirror delete failed:', err));
  clearState(userId);
  await client.replyMessage(replyToken, flex.buildToast('削除しました', { icon: '🗑️', color: UI_COLORS.danger }));
}

// ============================================================
// ステップハンドラー：編集フロー
// ============================================================

async function handleStepAskEditMonth(state, data, replyToken, userId) {
  if (data.act !== ACT.EDIT) return;
  db.assertMonthEditable(data.v);

  const entries = db.getMonthlyEntries(data.v);
  if (entries.length === 0) {
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildEmpty('データがありません'));
    return;
  }

  state.data.ym = data.v;
  state.step = STEP.ASK_EDIT_ROW;
  setState(userId, state);
  await client.replyMessage(replyToken, flex.buildAskRowEdit(entries));
}

async function handleStepAskEditRow(state, data, replyToken, userId) {
  if (data.act !== ACT.EDIT_ROW) {
    throw new StateError(`Unexpected action in ASK_EDIT_ROW: ${data.act}`, '行選択が正しくありません');
  }

  const entryId = Number(data.v);
  if (!entryId) {
    throw new ValidationError(`Invalid entry id: ${data.v}`, '行選択が正しくありません');
  }

  // idはDB全体で一意（月をまたいで採番）なので、選択中の月(state.data.ym)と
  // 一致するかも合わせて確認する（別月の古いpostbackが誤って使われる事故を防ぐ）。
  const entry = db.getEntryById(entryId);
  if (!entry || entry.ym !== state.data.ym) {
    throw new ValidationError(`Entry ${entryId} not found in ${state.data.ym}`, '選択された行が見つかりません');
  }

  state.data.entryId = entryId;
  state.data.current = { date: entry.date, subject: entry.subject, price: entry.price, payer: entry.payer };
  state.step = STEP.ASK_EDIT_COLUMN;
  setState(userId, state);

  await client.replyMessage(replyToken, flex.buildEditColumnSelect([entry.date, entry.subject, entry.price, entry.payer]));
}

async function handleStepAskEditColumn(state, data, replyToken, userId) {
  if (data.act !== ACT.EDIT_COLUMN) {
    await client.replyMessage(replyToken, { type: 'text', text: '項目選択が正しくありません' });
    return;
  }

  state.data.column = data.v;
  state.step = STEP.WAIT_EDIT_VALUE;
  setState(userId, state);

  const currentText = getCurrentValueForEdit(state.data.current, data.v);
  await client.replyMessage(replyToken, flex.buildEditValuePrompt(data.v, currentText));
}

async function handleStepWaitEditValue(state, data, replyToken, userId, params = {}) {
  let newValue = data.v;

  // DBの日付列は'yyyy-MM-dd'(ISO)で保持するため、以前のようなスラッシュ変換はしない
  // （Sheetsミラー側でmirrorUpdateEntryが'yyyy/MM/dd'への変換を行う）。
  if (state.data.column === '日付' && params.date) newValue = params.date;
  if (!newValue && data.text) newValue = data.text;
  if (state.data.column === '値段') newValue = normalizeAmount(newValue);

  state.data.newValue = newValue;
  state.step = STEP.CONFIRM_EDIT;
  setState(userId, state);

  const currentText = getCurrentValueForEdit(state.data.current, state.data.column);
  const newText = formatEditValue(state.data.column, newValue);
  await client.replyMessage(replyToken, flex.buildEditConfirm(state.data.column, currentText, newText));
}

async function handleStepConfirmEdit(state, data, replyToken, userId) {
  if (data.act === ACT.SAVE_EDIT) {
    await saveEdit(state);
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildToast('編集内容を保存しました'));
    return;
  }
  if (data.act === ACT.CANCEL) {
    clearState(userId);
    await client.replyMessage(replyToken, flex.buildToast('編集をキャンセルしました', { icon: '✖️', color: UI_COLORS.textLight }));
  }
}

async function saveEdit(state) {
  const fieldMap = {
    日付: 'date',
    題目: 'subject',
    値段: 'price',
    払った人: 'payer',
  };
  const field = fieldMap[state.data.column];
  const updated = db.updateEntryById(state.data.ym, state.data.entryId, { [field]: state.data.newValue });
  mirror
    .mirrorUpdateEntry(state.data.ym, updated.id, updated.date, updated.subject, updated.price, updated.payer)
    .catch((err) => console.error('mirror update failed:', err));
}

// ============================================================
// テキストメッセージハンドラー
// ============================================================

async function handleMessage(ev, userId, replyToken) {
  const text = ev.message.text.trim();
  const state = getState(userId);

  if (state.step === STEP.IDLE) {
    const parsed = parseQuickInput(text);
    if (parsed) {
      db.assertMonthEditable(parsed.date.slice(0, 7));
      setState(userId, { step: STEP.CONFIRM, data: parsed });
      await client.replyMessage(replyToken, flex.buildAddConfirmFlex(parsed));
      return;
    }

    if (/追加|ついか|登録|とうろく|入力|にゅうりょく/.test(text)) {
      setState(userId, { step: STEP.ASK_DATE, data: {} });
      await client.replyMessage(replyToken, flex.buildAskDate());
      return;
    }

    if (/確認|かくにん|表示|ひょうじ|見る|みる|閲覧|えつらん/.test(text)) {
      await handleShowMonth(replyToken, userId, isoDate(0).slice(0, 7));
      return;
    }

    if (/編集|へんしゅう|修正|しゅうせい|変更|へんこう/.test(text)) {
      setState(userId, { step: STEP.ASK_EDIT_MONTH, data: {} });
      await client.replyMessage(replyToken, flex.buildAskMonthEdit());
      return;
    }

    if (/削除|さくじょ|消す|けす/.test(text)) {
      setState(userId, { step: STEP.ASK_MONTH_DELETE, data: {} });
      await client.replyMessage(replyToken, flex.buildAskMonthDelete());
      return;
    }

    if (/ヘルプ|へるぷ|help|使い方|つかいかた/i.test(text)) {
      await client.replyMessage(replyToken, flex.buildQuickInputGuide());
      return;
    }

    if (/\d/.test(toHalfWidth(text))) {
      await client.replyMessage(replyToken, flex.buildQuickInputFailedGuide(text));
      return;
    }

    await client.replyMessage(replyToken, flex.buildIdleMenu());
    return;
  }

  if (state.step === STEP.WAIT_SUBJECT) {
    state.data.subject = text;
    state.step = STEP.WAIT_PRICE;
    setState(userId, state);
    await client.replyMessage(replyToken, { type: 'text', text: '値段を数字で入力してください' });
    return;
  }

  if (state.step === STEP.WAIT_PRICE) {
    const price = normalizeAmount(text);
    state.data.price = price;
    state.step = STEP.ASK_PAYER;
    setState(userId, state);
    await client.replyMessage(replyToken, flex.buildAskPayer());
    return;
  }

  if (state.step === STEP.WAIT_EDIT_VALUE) {
    await handleStepWaitEditValue(state, { v: text }, replyToken, userId, {});
  }
}

module.exports = { handleEvents };
