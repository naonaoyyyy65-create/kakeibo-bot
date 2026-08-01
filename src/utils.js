/**
 * utils.js
 * ユーティリティ関数と計算処理（GAS版 Utils.gs の移植）
 *
 * 日付フォーマットはGASの Utilities.formatDate(date, TZ, pattern) 相当を
 * Intl.DateTimeFormat で代替し、実行環境のタイムゾーン設定に関わらず
 * 常に Asia/Tokyo で解釈する。
 */

const { TZ } = require('./config');
const { ValidationError } = require('./errors');

function formatInTZ(date, pattern) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  })
    .formatToParts(date)
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});

  const { year, month, day } = parts;
  switch (pattern) {
    case 'yyyy-MM-dd':
      return `${year}-${month}-${day}`;
    case 'yyyy/MM/dd':
      return `${year}/${month}/${day}`;
    case 'yyyy-MM':
      return `${year}-${month}`;
    case 'M/d':
      return `${Number(month)}/${Number(day)}`;
    case 'd':
      return `${Number(day)}`;
    default:
      return `${year}-${month}-${day}`;
  }
}

function nowTimestamp() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false,
  })
    .formatToParts(new Date())
    .reduce((acc, p) => {
      acc[p.type] = p.value;
      return acc;
    }, {});
  return `${parts.year}-${parts.month}-${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function isoDate(offsetDays = 0) {
  const d = new Date();
  d.setDate(d.getDate() + offsetDays);
  return formatInTZ(d, 'yyyy-MM-dd');
}

function fmtDate(date, pattern = 'M/d') {
  return formatInTZ(new Date(date), pattern);
}

function fmtNum(n) {
  return Number(n).toLocaleString();
}

function normalizeAmount(s) {
  const n = Number(String(s).replace(/[,¥円\s]/g, ''));
  if (Number.isNaN(n) || n <= 0) {
    throw new ValidationError(
      `Invalid amount: ${s}`,
      '金額は正の数字で入力してください（例: 1000, 1,000, ¥1000, 1000円）'
    );
  }
  return n;
}

function calcSettlement(values) {
  const total = values.reduce((sum, r) => {
    const amount = Number(r[2]) || 0;
    return sum + (r[3] === 'c' ? amount : r[3] === 'a' ? -amount : 0);
  }, 0);

  if (total === 0) return null;

  const amount = Math.ceil(Math.abs(total) / 2);
  const from = total > 0 ? 'a' : 'c';
  const to = total > 0 ? 'c' : 'a';
  return { text: `${from} → ${to} ¥${amount.toLocaleString()}` };
}

function getCurrentValueForEdit(current, column) {
  const map = {
    日付: fmtDate(current.date, 'yyyy/MM/dd'),
    題目: current.subject,
    値段: `¥${fmtNum(current.price)}`,
    払った人: current.payer,
  };
  return map[column] || '';
}

function formatEditValue(column, value) {
  if (column === '値段') return `¥${fmtNum(value)}`;
  if (column === '日付') return fmtDate(value, 'yyyy/MM/dd');
  return value;
}

function calcMonthlyStats(ym, values) {
  let totalC = 0;
  let totalA = 0;
  let count = 0;

  values.forEach((r) => {
    const amount = Number(r[2]) || 0;
    count += 1;
    if (r[3] === 'c') totalC += amount;
    if (r[3] === 'a') totalA += amount;
  });

  const [year, month] = ym.split('-').map(Number);
  const daysInMonth = new Date(year, month, 0).getDate();
  const total = totalC + totalA;

  return {
    total,
    totalC,
    totalA,
    count,
    avgPerDay: total > 0 ? Math.round(total / daysInMonth) : 0,
  };
}

module.exports = {
  formatInTZ,
  nowTimestamp,
  isoDate,
  fmtDate,
  fmtNum,
  normalizeAmount,
  calcSettlement,
  calcMonthlyStats,
  getCurrentValueForEdit,
  formatEditValue,
};
