/**
 * flex/guide.js
 * クイック入力ガイド（旧flexBuilders.jsの分割時に抽出）。
 */

const { UI_COLORS, PAYER_ICON, ACT } = require('../config');
const { buildFlexMessage, makePostbackButton } = require('./core');

function guideHeading(icon, label, margin = 'lg') {
  return {
    type: 'box',
    layout: 'horizontal',
    spacing: 'xs',
    margin,
    contents: [
      { type: 'text', text: icon, size: 'sm', flex: 0 },
      { type: 'text', text: label, weight: 'bold', size: 'md', color: UI_COLORS.textDark, margin: 'xs' },
    ],
  };
}

function guideCard(rows) {
  return { type: 'box', layout: 'vertical', margin: 'sm', spacing: 'xs', backgroundColor: UI_COLORS.cardBg, cornerRadius: 'md', paddingAll: 'md', contents: rows };
}

function guideExampleRow(format, note = '') {
  if (!note) return { type: 'text', text: format, size: 'sm', color: UI_COLORS.textDark, wrap: true };
  return {
    type: 'box',
    layout: 'baseline',
    spacing: 'sm',
    contents: [
      { type: 'text', text: format, size: 'sm', color: UI_COLORS.textDark, flex: 4, wrap: true },
      { type: 'text', text: note, size: 'xs', color: UI_COLORS.textLight, flex: 5, align: 'end', wrap: true },
    ],
  };
}

function guidePayerBadge(payer, label) {
  const color = payer === 'a' ? UI_COLORS.payerA : UI_COLORS.payerC;
  return {
    type: 'box',
    layout: 'horizontal',
    flex: 1,
    spacing: 'xs',
    paddingAll: 'sm',
    backgroundColor: color,
    cornerRadius: 'md',
    contents: [
      { type: 'text', text: PAYER_ICON[payer], size: 'sm', flex: 0, color: UI_COLORS.white },
      { type: 'text', text: `${payer} = ${label}`, size: 'xs', color: UI_COLORS.white, weight: 'bold', margin: 'xs', wrap: true },
    ],
  };
}

function buildQuickInputGuide() {
  return buildFlexMessage(
    '💡 クイック入力ガイド',
    [
      guideHeading('🧾', '基本形', 'none'),
      guideCard([
        { type: 'text', text: '題目 金額 払った人（順不同・省略可）', size: 'sm', weight: 'bold', color: UI_COLORS.textDark, wrap: true },
        { type: 'separator', margin: 'sm' },
        guideExampleRow('スーパー 2500 c', ''),
        guideExampleRow('2500 スーパー', '→ 順番が逆・省略もOK'),
      ]),
      guideHeading('📅', '日付'),
      guideCard([
        guideExampleRow('（省略）', '今日'),
        guideExampleRow('昨日 / おととい', '相対日付'),
        guideExampleRow('1/10 ランチ 800 a', '月/日を指定'),
      ]),
      guideHeading('💰', '金額の書き方'),
      guideCard([
        { type: 'text', text: '2500 ・ 2,500 ・ 2500円 ・ 1.5k', size: 'sm', color: UI_COLORS.textDark, wrap: true },
        { type: 'text', text: 'すべて同じ2,500円として登録されます', size: 'xs', color: UI_COLORS.textLight, margin: 'xs' },
      ]),
      guideHeading('👤', '払った人'),
      { type: 'box', layout: 'horizontal', margin: 'sm', spacing: 'sm', contents: [guidePayerBadge('c', '自分'), guidePayerBadge('a', '相手')] },
      { type: 'separator', margin: 'lg' },
      { type: 'text', text: '全角スペース・全角英数字（Ｃなど）もそのまま入力できます', size: 'xs', color: UI_COLORS.textLight, margin: 'md', wrap: true },
    ],
    { buttons: [makePostbackButton('閉じる', `act=${ACT.CANCEL}`, 'secondary')] }
  );
}

function buildQuickInputFailedGuide(text) {
  return buildFlexMessage(
    '⚠️ 読み取れませんでした',
    [
      { type: 'text', text: `入力: 「${text}」`, size: 'sm', color: UI_COLORS.textMuted, wrap: true, margin: 'none' },
      { type: 'separator', margin: 'md' },
      guideHeading('🧾', '基本形', 'md'),
      guideCard([guideExampleRow('題目 金額 払った人（順不同・省略可）'), guideExampleRow('スーパー 2500 c')]),
    ],
    {
      buttons: [
        makePostbackButton('通常入力で追加', `act=${ACT.START_ADD}`, 'primary', UI_COLORS.primary),
        makePostbackButton('ガイドを見る', `act=${ACT.SHOW_GUIDE}`, 'secondary'),
      ],
      cancel: true,
    }
  );
}

module.exports = { buildQuickInputGuide, buildQuickInputFailedGuide };
