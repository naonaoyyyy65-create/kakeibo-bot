/**
 * flexBuilders.js
 * LINE Flex Messageの構築（GAS版 Flex.gs / UI.gs の移植）
 *
 * GAS版はFlexページ単体をCacheServiceでキャッシュしていたが、Node.js版は
 * Sheets APIを都度直接呼ぶ設計（sheetsService.js参照）のためキャッシュ層は持たない。
 *
 * 実装は画面/機能単位で`flex/`配下に分割し、このファイルは公開APIをまとめる
 * バレルファイルとして残している（他モジュールからの`require('./flexBuilders')`、
 * および`tests/webhookHandler.test.js`の`mock.module('../src/flexBuilders.js', ...)`
 * を変更せずに済むように、あえてディレクトリ化はしていない）。
 */

const core = require('./flex/core');
const menu = require('./flex/menu');
const addFlow = require('./flex/addFlow');
const monthFlow = require('./flex/monthFlow');
const editFlow = require('./flex/editFlow');
const deleteFlow = require('./flex/deleteFlow');
const guide = require('./flex/guide');
const reminder = require('./flex/reminder');

module.exports = {
  makePostbackButton: core.makePostbackButton,
  makeDatePickerButton: core.makeDatePickerButton,
  buildFlexMessage: core.buildFlexMessage,
  buildToast: core.buildToast,
  buildEmpty: core.buildEmpty,
  buildIdleMenu: menu.buildIdleMenu,
  buildAskDate: addFlow.buildAskDate,
  buildAskPayer: addFlow.buildAskPayer,
  buildAddConfirmRows: addFlow.buildAddConfirmRows,
  buildAddConfirmFlex: addFlow.buildAddConfirmFlex,
  buildConfirm: addFlow.buildConfirm,
  buildAskStatus: monthFlow.buildAskStatus,
  buildAskMonth: monthFlow.buildAskMonth,
  buildOlderMonths: monthFlow.buildOlderMonths,
  buildAskMonthDelete: monthFlow.buildAskMonthDelete,
  buildAskMonthEdit: monthFlow.buildAskMonthEdit,
  buildMonthlyFlex: monthFlow.buildMonthlyFlex,
  buildMonthSummary: monthFlow.buildMonthSummary,
  buildAskRowEdit: editFlow.buildAskRowEdit,
  buildEditColumnSelect: editFlow.buildEditColumnSelect,
  buildEditValuePrompt: editFlow.buildEditValuePrompt,
  buildEditConfirm: editFlow.buildEditConfirm,
  buildDeleteRowList: deleteFlow.buildDeleteRowList,
  buildQuickInputGuide: guide.buildQuickInputGuide,
  buildQuickInputFailedGuide: guide.buildQuickInputFailedGuide,
  buildReminderMessage: reminder.buildReminderMessage,
};
