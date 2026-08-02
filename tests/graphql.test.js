const test = require('node:test');
const assert = require('node:assert/strict');
const { createDbService } = require('../src/dbService');
const { server } = require('../src/graphqlServer');

// ApolloServerのexecuteOperationは実際にHTTPを立てずにクエリを実行できるため、
// server.js/graphqlServer.jsと同様「本番データに一切アクセスしない」テスト方針を保てる。
/**
 * @returns {Promise<any>} GraphQLレスポンスの型はテストの可読性のためanyのまま扱う
 */
async function runQuery(query, variables, db) {
  const response = await server.executeOperation({ query, variables }, { contextValue: { db } });
  assert.equal(response.body.kind, 'single');
  return response.body.singleResult;
}

function freshDbWithData() {
  const db = createDbService(':memory:');
  db.insertEntry({ date: '2026-07-05', subject: 'スーパー', price: 2000, payer: 'c' });
  db.insertEntry({ date: '2026-07-10', subject: 'カフェ', price: 1000, payer: 'a' });
  db.setMonthlyStatus('2026-07', '確定済');
  return db;
}

test('months: データが存在する月の一覧を返す', async () => {
  const db = freshDbWithData();
  db.insertEntry({ date: '2026-06-01', subject: '外食', price: 3000, payer: 'c' });

  const result = await runQuery('query { months }', {}, db);
  assert.deepEqual(result.data.months, ['2026-06', '2026-07']);
});

test('monthSummary: 明細・統計・精算・ステータスをまとめて返す', async () => {
  const db = freshDbWithData();

  const query = `
    query ($ym: String!) {
      monthSummary(ym: $ym) {
        ym
        status
        total
        totalC
        totalA
        count
        settlement { text }
        entries { id date subject price payer }
      }
    }
  `;
  const result = await runQuery(query, { ym: '2026-07' }, db);
  const summary = result.data.monthSummary;

  assert.equal(summary.ym, '2026-07');
  assert.equal(summary.status, '確定済');
  assert.equal(summary.total, 3000);
  assert.equal(summary.totalC, 2000);
  assert.equal(summary.totalA, 1000);
  assert.equal(summary.count, 2);
  assert.match(summary.settlement.text, /^a\s*→\s*c\s*¥500$/);
  assert.equal(summary.entries.length, 2);
  assert.deepEqual(
    summary.entries.map((e) => e.subject),
    ['スーパー', 'カフェ']
  );
});

test('monthSummary: データが無い月はcount=0・settlement=nullの空サマリーを返す', async () => {
  const db = createDbService(':memory:');

  const query = `
    query ($ym: String!) {
      monthSummary(ym: $ym) { ym status total count settlement { text } entries { id } }
    }
  `;
  const result = await runQuery(query, { ym: '2026-01' }, db);
  const summary = result.data.monthSummary;

  assert.equal(summary.status, '');
  assert.equal(summary.total, 0);
  assert.equal(summary.count, 0);
  assert.equal(summary.settlement, null);
  assert.deepEqual(summary.entries, []);
});

test('monthSummary: ymを渡さないとバリデーションエラーになる', async () => {
  const db = freshDbWithData();
  const result = await runQuery('query { monthSummary { ym } }', {}, db);
  assert.ok(result.errors && result.errors.length > 0);
});
