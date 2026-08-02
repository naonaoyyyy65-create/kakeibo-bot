/**
 * flex/menu.js
 * アイドルメニュー（旧flexBuilders.jsの分割時に抽出）。
 */

const { UI_COLORS, ACT } = require('../config');
const { buildFlexMessage, makePostbackButton } = require('./core');

function buildIdleMenu() {
  return buildFlexMessage(
    '操作を選択',
    [
      { type: 'text', text: '💡 クイック入力', weight: 'bold', size: 'md', color: UI_COLORS.textDark },
      { type: 'text', text: '題目 金額 払った人', size: 'sm', color: UI_COLORS.textMuted, margin: 'sm' },
      { type: 'text', text: '例: スーパー 2500 c', size: 'xs', color: UI_COLORS.textLight, margin: 'xs' },
      { type: 'separator', margin: 'md' },
      { type: 'text', text: '📅 日付指定', weight: 'bold', size: 'md', color: UI_COLORS.textDark, margin: 'md' },
      { type: 'text', text: '月/日 題目 金額 払った人', size: 'sm', color: UI_COLORS.textMuted, margin: 'sm' },
      { type: 'text', text: '例: 1/10 カフェ 800 a', size: 'xs', color: UI_COLORS.textLight, margin: 'xs' },
    ],
    {
      buttons: [
        makePostbackButton('追加', `act=${ACT.START_ADD}`, 'primary', UI_COLORS.primary),
        makePostbackButton('編集', `act=${ACT.START_EDIT}`, 'secondary'),
        makePostbackButton('確認', `act=${ACT.START_CHECK}`, 'secondary'),
        makePostbackButton('削除', `act=${ACT.START_DELETE}`, 'secondary'),
      ],
    }
  );
}

module.exports = { buildIdleMenu };
