/**
 * resolvers.js
 * 読み取り専用GraphQL APIのリゾルバー本体。
 *
 * dbServiceのシングルトンを直接requireせず、Apollo Serverのcontext経由で受け取る
 * （graphqlServer.jsが本番用のシングルトンを渡し、テストは`:memory:`インスタンスを渡せる
 * ようにするため。既存Botの各handlerがdbServiceを直接requireする設計とは異なる、
 * このAPI固有の設計判断）。
 *
 * 統計・精算の計算は既存のutils.calcMonthlyStats/calcSettlementをそのまま再利用する。
 * これらはSheets時代からの行タプル形式 [date, subject, price, payer] を受け取る設計のため、
 * dbServiceが返すEntryオブジェクトをここで変換してから渡す。
 */

const { calcMonthlyStats, calcSettlement } = require('../utils');

/** @param {import('../dbService').Entry} entry */
function toRow(entry) {
  return [entry.date, entry.subject, entry.price, entry.payer];
}

const resolvers = {
  Query: {
    months: (_parent, _args, context) => context.db.listMonths(),
    monthSummary: (_parent, { ym }, context) => {
      const entries = context.db.getMonthlyEntries(ym);
      const rows = entries.map(toRow);
      const stats = calcMonthlyStats(ym, rows);
      const settlement = calcSettlement(rows);
      const status = context.db.getMonthlyStatus(ym);
      return { ym, status, ...stats, settlement, entries };
    },
  },
};

module.exports = resolvers;
