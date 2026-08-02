/**
 * typeDefs.js
 * 読み取り専用GraphQL API（家計簿データの参照用）のスキーマ定義。
 *
 * 家計簿Bot本体（LINE Webhook）の書き込みロジックには一切依存せず、既存のSQLite
 * （dbService.js）を読むだけの新規サービス。将来のフロントエンドSPA案の土台として
 * 2026-08-02に追加した。
 */

const typeDefs = `#graphql
  type Entry {
    id: Int!
    ym: String!
    date: String!
    subject: String!
    price: Int!
    payer: String!
  }

  type Settlement {
    text: String!
  }

  type MonthSummary {
    ym: String!
    status: String!
    total: Int!
    totalC: Int!
    totalA: Int!
    count: Int!
    avgPerDay: Int!
    settlement: Settlement
    entries: [Entry!]!
  }

  type Query {
    "データが存在する月（yyyy-MM）の一覧を古い順に返す"
    months: [String!]!
    "指定した月の明細・統計・精算・支払いステータスをまとめて返す"
    monthSummary(ym: String!): MonthSummary!
  }
`;

module.exports = typeDefs;
