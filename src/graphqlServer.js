/**
 * graphqlServer.js
 * 読み取り専用GraphQL APIのエントリポイント。
 *
 * server.js（LINE Webhook本体）とは別プロセス・別ポートで動かす想定。本番の書き込みロジックには
 * 触れず、既存のSQLite（dbService.js）を読むだけ。テスト（tests/graphql.test.js）からは
 * server.jsと同様に`require.main === module`ガードでlistenを避け、`server`インスタンスの
 * `executeOperation`を直接呼ぶことでHTTPを立てずに検証する。
 */

const { ApolloServer } = require('@apollo/server');
const { startStandaloneServer } = require('@apollo/server/standalone');
const typeDefs = require('./graphql/typeDefs');
const resolvers = require('./graphql/resolvers');
const db = require('./dbService');
const config = require('./config');

const server = new ApolloServer({ typeDefs, resolvers });

/* node:coverage ignore next 8 */
if (require.main === module) {
  startStandaloneServer(server, {
    listen: { port: Number(config.GRAPHQL_PORT) },
    context: async () => ({ db }),
  }).then(({ url }) => {
    console.log(`GraphQL read API ready at ${url}`);
  });
}

module.exports = { server };
