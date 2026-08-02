// @ts-nocheck -- TODO(TS移行): 段階的TypeScript導入の対象外。個別に型を付けて解除する予定
/**
 * reminderStore.js
 * 「支払済」と確認済みの月次シートをローカルJSONに記録し、reminder.jsが以後の実行で
 * その月をSheets API呼び出し対象から除外できるようにする（カレンダーBotのstore.jsと同じ設計）。
 *
 * 支払済の月は`sheetsService.assertMonthEditable`の仕様上、確定前に戻さない限り再編集できない
 * ため、一度支払済と確認できればチェック対象から永久に外してよい（月数が増えるほどSheets APIの
 * 分間クォータを圧迫するため、2026-07-29「支払済の月は今後確認しなくていいようにして」との
 * 依頼を受け追加）。
 *
 * 万一、支払済の月を確定前に戻して再編集した場合は、このファイルから該当月を手動で
 * 削除すれば次回実行時に再チェック対象へ戻る。
 */
const fs = require('fs');
const path = require('path');

function createStore(filePath) {
  const resolvedPath = path.resolve(filePath);

  function load() {
    try {
      const raw = fs.readFileSync(resolvedPath, 'utf8');
      const data = JSON.parse(raw);
      return Array.isArray(data.settledMonths) ? data.settledMonths : [];
    } catch {
      return [];
    }
  }

  function save(months) {
    fs.mkdirSync(path.dirname(resolvedPath), { recursive: true });
    fs.writeFileSync(resolvedPath, JSON.stringify({ settledMonths: months }, null, 2), 'utf8');
  }

  return {
    getSettledMonths() {
      return load();
    },
    addSettledMonths(yms) {
      if (yms.length === 0) return;
      const merged = new Set(load());
      yms.forEach((ym) => merged.add(ym));
      save([...merged].sort());
    },
  };
}

const config = require('./config');

module.exports = createStore(config.SETTLED_MONTHS_FILE_PATH);
module.exports.createStore = createStore;
