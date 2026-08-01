/**
 * sheetsSyncHandler.js
 * スプレッドシート直接編集(GAS onEditインストール型トリガー)→Piの`/sheets-sync`エンドポイント
 * から呼ばれるロジック本体（2026-07-30〜）。Express非依存にしてHTTP無しで単体テストできるようにする。
 *
 * リクエスト形式:
 * - {type:'status', ym, status} … G1（ステータスセル）編集
 * - {type:'rows', ym, rows:[{sheetRow, id, date, subject, price, payer}]} … データ行編集
 *   - idが空の行 = 手入力の新規行 → DBへ挿入し、採番したidを{sheetRow,id}としてレスポンスに含める
 *     （GAS側がE列へ同期的に書き戻す）
 *   - idがある行 = 既存行の編集 → 該当DB行を更新
 *   - 日付・題目・値段・払った人が全部揃っていない行（セルを順番に埋めている途中等）はno-op
 *     （途中入力の状態でDBに反映してしまうと不完全なデータが混入するため）
 * - 行削除はこのエンドポイントの対象外（onEditは行削除を確実に検知できないため運用ルールで
 *   「削除はBot経由のみ」としている、`../CLAUDE.md`のネット回線ではなく本プロジェクトの決定）
 */
const db = require('./dbService');
const { normalizeAmount } = require('./utils');
const { ValidationError } = require('./errors');

function normalizeRow(row) {
  const { date, subject, price, payer } = row;
  if (!date || !subject || price === undefined || price === '' || !payer) return null;
  if (!['c', 'a'].includes(payer)) return null;
  try {
    return { date, subject, price: normalizeAmount(price), payer };
  } catch {
    return null;
  }
}

function handleSheetsSyncRequest(body) {
  if (!body || typeof body !== 'object') {
    throw new ValidationError('invalid body', 'リクエストの形式が不正です');
  }

  if (body.type === 'status') {
    if (!body.ym || typeof body.status !== 'string') {
      throw new ValidationError('invalid status payload', 'ステータス更新のリクエストが不正です');
    }
    db.setMonthlyStatus(body.ym, body.status);
    return { ok: true };
  }

  if (body.type === 'rows') {
    if (!body.ym || !Array.isArray(body.rows)) {
      throw new ValidationError('invalid rows payload', '行更新のリクエストが不正です');
    }

    const assignedIds = [];
    const errors = [];
    for (const row of body.rows) {
      try {
        const normalized = normalizeRow(row);
        if (!normalized) continue; // 不完全な行（途中入力等）は静かにスキップ

        if (row.id) {
          db.updateEntryById(body.ym, Number(row.id), normalized);
        } else {
          const created = db.insertEntry(normalized);
          assignedIds.push({ sheetRow: row.sheetRow, id: created.id });
        }
      } catch (err) {
        errors.push({ sheetRow: row.sheetRow, reason: err.userMessage || err.message });
      }
    }
    return { ok: true, assignedIds, errors };
  }

  throw new ValidationError(`unknown sync type: ${body.type}`, '不明な同期タイプです');
}

module.exports = { handleSheetsSyncRequest };
