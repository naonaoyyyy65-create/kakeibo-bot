/**
 * quickInput.js
 * テキスト一括入力機能（GAS版 QuickInput.gs の移植）
 *
 * 入力例（題目・金額・払った人はスペース区切りで順不同、日付は先頭のみ）:
 * - "スーパー 2500 c"          → 今日の日付で登録
 * - "2500 スーパー c"          → 順序が逆でもOK
 * - "1/10 カフェ 800 a"        → 1/10で登録
 * - "昨日 ランチ 1200 c"       → 相対日付（今日/昨日/おととい/一昨日）
 * - "スーパー　2,500円　Ｃ"    → 全角スペース/カンマ/円/全角英字もOK
 * - "コンビニ 1.5k c"          → k = 千円単位
 */

const { isoDate, normalizeAmount, formatInTZ } = require('./utils');

const RELATIVE_DATE_OFFSET = {
  今日: 0,
  きょう: 0,
  昨日: -1,
  きのう: -1,
  おととい: -2,
  一昨日: -2,
};

function toHalfWidth(str) {
  return str
    .replace(/[Ａ-Ｚａ-ｚ０-９]/g, (ch) => String.fromCharCode(ch.charCodeAt(0) - 0xfee0))
    .replace(/　/g, ' ')
    .replace(/／/g, '/');
}

function expandKiloSuffix(token) {
  const m = token.match(/^(¥?)(\d+(?:\.\d+)?)[kK]$/);
  if (!m) return token;
  const [, yen, num] = m;
  return yen + Math.round(parseFloat(num) * 1000);
}

/**
 * テキストから家計簿データをパース
 * @param {string} text
 * @returns {{date: string, subject: string, price: number, payer: string}|null}
 */
function parseQuickInput(text) {
  if (!text || typeof text !== 'string') return null;

  const trimmed = toHalfWidth(text.trim()).replace(/\s+/g, ' ').trim();
  if (!trimmed) return null;

  let rest = trimmed;
  let date = null;

  const relativeMatch = rest.match(/^(今日|きょう|昨日|きのう|おととい|一昨日)\s+(.+)$/);
  if (relativeMatch) {
    date = isoDate(RELATIVE_DATE_OFFSET[relativeMatch[1]]);
    rest = relativeMatch[2];
  } else {
    const dateMatch = rest.match(/^(\d{1,2})\/(\d{1,2})\s+(.+)$/);
    if (dateMatch) {
      const [, month, day, remainder] = dateMatch;
      const now = new Date();
      const year = now.getFullYear();

      let targetDate = new Date(year, parseInt(month, 10) - 1, parseInt(day, 10));
      if (targetDate > now) {
        targetDate = new Date(year - 1, parseInt(month, 10) - 1, parseInt(day, 10));
      }
      date = formatInTZ(targetDate, 'yyyy-MM-dd');
      rest = remainder;
    }
  }
  if (date === null) date = isoDate(0);

  let payer = 'c';
  const payerMatch = rest.match(/^(.+?)\s+([ca])$/i);
  if (payerMatch) {
    rest = payerMatch[1];
    payer = payerMatch[2].toLowerCase();
  }

  const tokens = rest.split(' ').filter(Boolean).map(expandKiloSuffix);
  if (tokens.length < 2) return null;

  const priceRe = /^¥?[\d,]+円?$/;
  const priceIndexes = [];
  tokens.forEach((t, i) => {
    if (priceRe.test(t)) priceIndexes.push(i);
  });

  if (priceIndexes.length === 0) return null;

  const priceIdx = priceIndexes[priceIndexes.length - 1];
  const priceStr = tokens[priceIdx];
  const subject = tokens.filter((_, i) => i !== priceIdx).join(' ').trim();

  if (!subject) return null;

  return {
    date,
    subject,
    price: normalizeAmount(priceStr),
    payer,
  };
}

module.exports = { parseQuickInput, toHalfWidth, expandKiloSuffix };
