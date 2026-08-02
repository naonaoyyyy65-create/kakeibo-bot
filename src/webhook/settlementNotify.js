// @ts-nocheck -- TODO(TS移行): 段階的TypeScript導入の対象外。個別に型を付けて解除する予定
/**
 * webhook/settlementNotify.js
 * 精算完了通知（旧webhookHandler.jsの分割時に抽出）。
 * ステータスを「支払済」にした本人以外の登録ユーザーへPush。
 */

const { client } = require('../lineService');
const flex = require('../flexBuilders');
const { UI_COLORS, NOTIFY_USER_IDS } = require('../config');

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

module.exports = { notifySettlementComplete };
