/**
 * flex/core.js
 * 汎用Flexビルダー・共通ヘルパー（旧flexBuilders.jsの分割時に抽出）。
 * 他のflex/*.jsファイルはすべてここのbuildFlexMessage/makePostbackButton等を利用する。
 */

/**
 * Flex Messageのコンポーネント（box/text/button/separator等）はネストごとに
 * プロパティの組み合わせが大きく異なるため、厳密な構造型よりも「object型」で
 * 緩く受ける方針にした（@line/bot-sdkの正式なFlex型に厳密適合させる場合、
 * このファイルの大半のオブジェクトリテラルを書き換える必要があり労力対効果が低いため）。
 * @typedef {Record<string, any>} FlexNode
 */

const { UI_COLORS, STATUS_STYLE, ACT } = require('../config');

function makePostbackButton(label, data, style = 'secondary', color = null) {
  const btn = { type: 'button', style, action: { type: 'postback', label, data } };
  if (color) btn.color = color;
  return btn;
}

function makeDatePickerButton(data, label = '日付を選択') {
  return {
    type: 'button',
    style: 'primary',
    action: { type: 'datetimepicker', label, data, mode: 'date' },
  };
}

function buildFlexMessage(title, rows = [], options = {}) {
  const contents = [];

  const titleParts = title.includes('年') && title.includes('月') ? title.match(/(\d+)年(\d+)月/) : null;
  if (titleParts) {
    contents.push({
      type: 'box',
      layout: 'vertical',
      contents: [
        { type: 'text', text: `${titleParts[1]}年 ${titleParts[2]}月`, size: 'xl', weight: 'bold', color: UI_COLORS.textDark },
        { type: 'text', text: '家計簿', size: 'sm', color: UI_COLORS.textMuted, margin: 'xs' },
      ],
    });
  } else {
    contents.push({ type: 'text', text: title, weight: 'bold', size: 'lg', margin: 'md' });
  }

  contents.push(...rows);

  if (options.stats) {
    const s = options.stats;
    contents.push({ type: 'separator', margin: 'lg' });
    contents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      spacing: 'sm',
      backgroundColor: UI_COLORS.cardBg,
      cornerRadius: 'md',
      paddingAll: 'md',
      contents: [
        { type: 'text', text: '📊 統計', weight: 'bold', size: 'md', color: UI_COLORS.headerBg },
        { type: 'separator', margin: 'sm' },
        {
          type: 'box',
          layout: 'baseline',
          margin: 'md',
          spacing: 'sm',
          contents: [
            { type: 'text', text: '合計', color: UI_COLORS.textMuted, size: 'sm', flex: 2 },
            { type: 'text', text: `¥${s.total.toLocaleString()}`, weight: 'bold', size: 'lg', color: UI_COLORS.textDark, flex: 5, align: 'end' },
          ],
        },
        {
          type: 'box',
          layout: 'baseline',
          spacing: 'sm',
          contents: [
            { type: 'text', text: '件数', color: UI_COLORS.textMuted, size: 'xs', flex: 2 },
            { type: 'text', text: `${s.count}件`, size: 'sm', color: UI_COLORS.textMuted, flex: 5, align: 'end' },
          ],
        },
        { type: 'separator', margin: 'sm' },
        {
          type: 'box',
          layout: 'horizontal',
          margin: 'sm',
          spacing: 'md',
          contents: [
            {
              type: 'box',
              layout: 'vertical',
              flex: 1,
              spacing: 'xs',
              contents: [
                { type: 'text', text: 'c', color: UI_COLORS.textMuted, size: 'xs', align: 'center' },
                { type: 'text', text: `¥${s.totalC.toLocaleString()}`, size: 'sm', color: UI_COLORS.payerC, align: 'center', weight: 'bold' },
              ],
            },
            {
              type: 'box',
              layout: 'vertical',
              flex: 1,
              spacing: 'xs',
              contents: [
                { type: 'text', text: 'a', color: UI_COLORS.textMuted, size: 'xs', align: 'center' },
                { type: 'text', text: `¥${s.totalA.toLocaleString()}`, size: 'sm', color: UI_COLORS.payerA, align: 'center', weight: 'bold' },
              ],
            },
          ],
        },
        { type: 'separator', margin: 'sm' },
        {
          type: 'box',
          layout: 'baseline',
          margin: 'sm',
          spacing: 'sm',
          contents: [
            { type: 'text', text: '1日平均', color: UI_COLORS.textMuted, size: 'xs', flex: 2 },
            { type: 'text', text: `¥${s.avgPerDay.toLocaleString()}`, size: 'sm', color: UI_COLORS.primaryDark, flex: 5, align: 'end' },
          ],
        },
      ],
    });
  }

  if (options.settlement) {
    contents.push({ type: 'separator', margin: 'lg' });

    /** @type {FlexNode[]} */
    const settlementContents = [
      { type: 'text', text: '💰 精算', weight: 'bold', size: 'md', color: UI_COLORS.settlement },
      { type: 'separator', margin: 'sm', color: UI_COLORS.settlementSep },
    ];

    if (options.settlement.text) {
      const match = options.settlement.text.match(/(\w+)\s*→\s*(\w+)\s*¥?([\d,]+)/);
      if (match) {
        const [, from, to, amount] = match;
        settlementContents.push({
          type: 'box',
          layout: 'horizontal',
          margin: 'md',
          contents: [
            { type: 'text', text: from, size: 'xl', weight: 'bold', color: UI_COLORS.settlement, flex: 1, align: 'center' },
            { type: 'text', text: '→', size: 'xxl', color: UI_COLORS.settlementDark, flex: 1, align: 'center' },
            { type: 'text', text: to, size: 'xl', weight: 'bold', color: UI_COLORS.settlement, flex: 1, align: 'center' },
          ],
        });
        settlementContents.push({
          type: 'box',
          layout: 'vertical',
          margin: 'md',
          backgroundColor: UI_COLORS.settlementAmount,
          cornerRadius: 'md',
          paddingAll: 'md',
          contents: [{ type: 'text', text: `¥${amount}`, size: 'xxl', weight: 'bold', color: UI_COLORS.white, align: 'center' }],
        });
      } else {
        settlementContents.push({
          type: 'text',
          text: options.settlement.text,
          size: 'xl',
          weight: 'bold',
          color: UI_COLORS.settlementDark,
          margin: 'md',
          align: 'center',
        });
      }
    }

    if (options.settlement.status) {
      const style = STATUS_STYLE[options.settlement.status] || { color: UI_COLORS.textLight, icon: '📝' };
      settlementContents.push({
        type: 'box',
        layout: 'horizontal',
        margin: 'md',
        contents: [
          {
            type: 'box',
            layout: 'horizontal',
            backgroundColor: style.color,
            cornerRadius: 'md',
            paddingAll: 'sm',
            spacing: 'xs',
            contents: [
              { type: 'text', text: style.icon, size: 'sm', flex: 0 },
              { type: 'text', text: options.settlement.status, color: UI_COLORS.white, size: 'sm', weight: 'bold', flex: 0, margin: 'xs' },
            ],
          },
        ],
      });
    }

    contents.push({
      type: 'box',
      layout: 'vertical',
      margin: 'md',
      spacing: 'md',
      backgroundColor: UI_COLORS.settlementBg,
      cornerRadius: 'lg',
      paddingAll: 'lg',
      contents: settlementContents,
    });
  }

  if (options.buttons && options.buttons.length) {
    contents.push({ type: 'box', layout: 'vertical', margin: 'md', spacing: 'sm', contents: options.buttons });
  }

  if (options.cancel) {
    contents.push(makePostbackButton('キャンセル', `act=${ACT.CANCEL}`, 'secondary'));
  }

  return {
    type: 'flex',
    altText: title,
    contents: { type: 'bubble', body: { type: 'box', layout: 'vertical', spacing: 'md', contents } },
  };
}

function buildToast(text, opts = {}) {
  const color = opts.color || UI_COLORS.primary;
  const icon = opts.icon || '✅';
  return {
    type: 'flex',
    altText: text,
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        paddingAll: 'lg',
        backgroundColor: color,
        cornerRadius: 'md',
        contents: [
          { type: 'text', text: icon, size: 'md', flex: 0, color: UI_COLORS.white },
          { type: 'text', text, size: 'sm', weight: 'bold', color: UI_COLORS.white, wrap: true, flex: 1, gravity: 'center' },
        ],
      },
    },
  };
}

function buildEmpty(text) {
  return buildFlexMessage(text, [{ type: 'text', text: '📭', size: 'xxl', align: 'center', margin: 'md' }], {
    buttons: [makePostbackButton('メニューに戻る', `act=${ACT.SHOW_MENU}`, 'primary', UI_COLORS.primary)],
  });
}

module.exports = {
  makePostbackButton,
  makeDatePickerButton,
  buildFlexMessage,
  buildToast,
  buildEmpty,
};
