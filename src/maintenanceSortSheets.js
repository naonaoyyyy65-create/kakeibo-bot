/**
 * maintenanceSortSheets.js
 * 全月次シートの日付列（A列）が昇順かチェックし、崩れているシートを物理的に並べ替える。
 * Bot経由の操作は常に末尾追記＋表示側ソートのため対象外だが、スプレッドシートへの直接入力で
 * 行順が崩れた場合に備えたメンテナンス（GAS版 maintenanceSortAllMonthlySheets の移植）。
 * Pi上のcronで日次実行する想定（設置は `../../ラズパイ/CLAUDE.md` 参照）。
 *
 * 実行方法: node src/maintenanceSortSheets.js
 */

const sheets = require('./sheetsService');

async function runMaintenance() {
  const sortedTitles = await sheets.sortAllMonthlySheetsIfNeeded();
  sortedTitles.forEach((ym) => console.log(`Sorted: ${ym}`));
  console.log(`Maintenance complete. Sorted ${sortedTitles.length} sheet(s).`);
}

if (require.main === module) {
  runMaintenance().catch((err) => {
    console.error('maintenance sort failed:', err);
    process.exitCode = 1;
  });
}

module.exports = { runMaintenance };
