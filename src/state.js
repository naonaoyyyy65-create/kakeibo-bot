/**
 * state.js
 * 会話状態の管理（GAS版 CacheService.getUserCache 相当）
 *
 * GAS版はCacheServiceでユーザーごとの状態を3600秒保持していたが、
 * Node.js版はプロセスがずっと常駐しているため、単純なメモリ内Mapで代替する。
 * 注意: サービス再起動（デプロイ時）で全ユーザーの保留中の状態は消える
 * （GASのキャッシュ期限切れと同じ扱いとして許容する）。
 */

const STATE_TTL_MS = 60 * 60 * 1000; // 3600秒。GAS版と同じ長さ
const store = new Map();

function getState(userId) {
  const entry = store.get(userId);
  if (!entry || entry.expiresAt < Date.now()) {
    return { step: 'IDLE', data: {} };
  }
  return entry.value;
}

function setState(userId, value) {
  store.set(userId, { value, expiresAt: Date.now() + STATE_TTL_MS });
}

function clearState(userId) {
  store.delete(userId);
}

module.exports = { getState, setState, clearState };
