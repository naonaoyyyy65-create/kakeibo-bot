/**
 * flexBuilders.js
 * LINE Flex Messageの構築（GAS版 Flex.gs / UI.gs の移植）
 *
 * GAS版はFlexページ単体をCacheServiceでキャッシュしていたが、Node.js版は
 * Sheets APIを都度直接呼ぶ設計（sheetsService.js参照）のためキャッシュ層は持たない。
 */

/**
 * Flex Messageのコンポーネント（box/text/button/separator等）はネストごとに
 * プロパティの組み合わせが大きく異なるため、厳密な構造型よりも「object型」で
 * 緩く受ける方針にした（@line/bot-sdkの正式なFlex型に厳密適合させる場合、
 * このファイルの大半のオブジェクトリテラルを書き換える必要があり労力対効果が低いため）。
 * @typedef {Record<string, any>} FlexNode
 */

const { UI_COLORS, STATUS_STYLE, PAYER_ICON, MONTH_HEADER, PAYER_CHOICE, PAYMENT_STATUS, ACT } = require('./config');
const { fmtDate, fmtNum, formatInTZ } = require('./utils');

// ============================================================
// ボタン生成ヘルパー
// ============================================================

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

function makeColumnButtons() {
  return MONTH_HEADER.map((label) => makePostbackButton(label, `act=${ACT.EDIT_COLUMN}&v=${encodeURIComponent(label)}`));
}

// ============================================================
// 汎用Flexビルダー（GAS版 buildFlexMessage）
// ============================================================

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

// ============================================================
// トースト・空データ通知
// ============================================================

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

// ============================================================
// アイドルメニュー
// ============================================================

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

// ============================================================
// 追加フロー
// ============================================================

function buildAskDate() {
  return buildFlexMessage('日付を選択', [], {
    buttons: [
      makePostbackButton('今日', `act=${ACT.DATE_TODAY}`, 'primary', UI_COLORS.info),
      makePostbackButton('昨日', `act=${ACT.DATE_YESTERDAY}`, 'primary', UI_COLORS.infoDark),
      makeDatePickerButton(`act=${ACT.DATE_PICK}`, '日付指定'),
    ],
    cancel: true,
  });
}

function buildAskPayer() {
  return buildFlexMessage('払った人を選択', [], {
    buttons: PAYER_CHOICE.map((p) => makePostbackButton(p, `act=${ACT.PAYER}&v=${p}`, 'primary', UI_COLORS.payerC)),
    cancel: true,
  });
}

function buildAddConfirmRows(data) {
  return [
    { type: 'text', text: `日付: ${fmtDate(data.date, 'M/d')}`, size: 'sm', color: UI_COLORS.textMuted },
    { type: 'text', text: `題目: ${data.subject}`, size: 'md', weight: 'bold', color: UI_COLORS.textDark, margin: 'sm' },
    {
      type: 'text',
      text: `金額: ¥${Number(data.price).toLocaleString()}`,
      size: 'lg',
      weight: 'bold',
      color: data.payer === 'a' ? UI_COLORS.payerA : UI_COLORS.payerC,
      margin: 'sm',
    },
    { type: 'text', text: `払った人: ${PAYER_ICON[data.payer] || data.payer} ${data.payer}`, size: 'sm', color: UI_COLORS.textMuted, margin: 'sm' },
  ];
}

// クイック入力からの確認（保存・修正・キャンセルの3ボタン、GAS版 handleMessage_ の分岐と同じ構成）
function buildAddConfirmFlex(data) {
  return buildFlexMessage('この内容で登録しますか？', buildAddConfirmRows(data), {
    buttons: [
      makePostbackButton('保存', `act=${ACT.SAVE}`, 'primary', UI_COLORS.primary),
      makePostbackButton('修正', `act=${ACT.EDIT}`, 'secondary'),
      makePostbackButton('キャンセル', `act=${ACT.CANCEL}`, 'secondary'),
    ],
  });
}

// ステップ入力フローからの確認（GAS版 sendConfirm_）
function buildConfirm(data) {
  return buildFlexMessage('この内容で登録しますか？', buildAddConfirmRows(data), {
    buttons: [
      makePostbackButton('保存', `act=${ACT.SAVE}`, 'primary', UI_COLORS.primary),
      makePostbackButton('修正', `act=${ACT.EDIT}`, 'secondary'),
    ],
    cancel: true,
  });
}

// ============================================================
// ステータス変更
// ============================================================

function buildAskStatus(ym) {
  return buildFlexMessage('支払いステータスを選択', [], {
    buttons: PAYMENT_STATUS.map((s) => makePostbackButton(s, `act=${ACT.UPDATE_STATUS}&ym=${ym}&v=${encodeURIComponent(s)}`)),
    cancel: true,
  });
}

// ============================================================
// 月選択
// ============================================================

function recentMonths(count) {
  const now = new Date();
  now.setDate(1);
  const seen = new Set();
  const months = [];
  for (let i = 0; i < count; i += 1) {
    const d = new Date(now);
    d.setMonth(d.getMonth() - i);
    const ym = formatInTZ(d, 'yyyy-MM');
    if (seen.has(ym)) continue;
    seen.add(ym);
    months.push(ym);
  }
  return months;
}

function buildMonthSelection(postbackAct, altText, monthsCount = 3, includeOther = false) {
  const buttons = recentMonths(monthsCount).map((ym) => makePostbackButton(ym, `act=${postbackAct}&v=${ym}`));
  if (includeOther) buttons.push(makePostbackButton('その他', `act=${postbackAct}&v=other`));
  return buildFlexMessage(altText, [], { buttons, cancel: true });
}

function buildAskMonth() {
  return buildMonthSelection(ACT.MONTH, '月選択', 3, true);
}
function buildOlderMonths() {
  return buildMonthSelection(ACT.MONTH, '過去30ヶ月から選択', 30, false);
}
function buildAskMonthDelete() {
  return buildMonthSelection(ACT.DELETE_MONTH, '削除月選択', 3, false);
}
function buildAskMonthEdit() {
  return buildMonthSelection(ACT.EDIT, '編集対象月を選択', 3, true);
}

// ============================================================
// 月次一覧（確認画面）
// ============================================================

function buildMonthlyFlex(ym, values, settlement, stats) {
  const [year, month] = ym.split('-');

  const rows = values.map((r, index) => ({
    type: 'box',
    layout: 'vertical',
    margin: index === 0 ? 'md' : 'sm',
    spacing: 'xs',
    contents: [
      {
        type: 'box',
        layout: 'horizontal',
        contents: [
          { type: 'text', text: fmtDate(r[0], 'M/d'), size: 'xs', color: UI_COLORS.textLight, flex: 3 },
          { type: 'text', text: PAYER_ICON[r[3]] || r[3], size: 'sm', flex: 0, align: 'end', margin: 'md' },
        ],
      },
      {
        type: 'box',
        layout: 'horizontal',
        spacing: 'sm',
        contents: [
          { type: 'text', text: r[1], size: 'sm', color: UI_COLORS.textDark, flex: 5, wrap: true, weight: 'bold' },
          { type: 'text', text: `¥${fmtNum(r[2])}`, size: 'md', weight: 'bold', align: 'end', flex: 3, color: r[3] === 'a' ? UI_COLORS.payerA : UI_COLORS.payerC },
        ],
      },
      ...(index < values.length - 1 ? [{ type: 'separator', margin: 'sm', color: UI_COLORS.separator }] : []),
    ],
  }));

  const options = {};
  if (stats) options.stats = stats;
  if (settlement) {
    options.settlement = settlement;
    options.buttons = [makePostbackButton('Statusを変更', `act=${ACT.SET_STATUS}&ym=${ym}`, 'secondary')];
  }

  return buildFlexMessage(`${Number(year)}年${Number(month)}月家計簿`, rows, options);
}

// ============================================================
// 月次確認のサマリー（合計・精算をスクロール無しで最初に見せる。「他の月を見る」導線も統一してここに集約）
// ============================================================

function summaryRow(label, value, opts = {}) {
  return {
    type: 'box',
    layout: 'baseline',
    margin: opts.margin || 'md',
    contents: [
      { type: 'text', text: label, size: 'sm', color: UI_COLORS.textMuted, flex: 2 },
      { type: 'text', text: String(value), size: opts.size || 'sm', weight: opts.weight, color: opts.color || UI_COLORS.textDark, flex: 5, align: 'end', wrap: true },
    ],
  };
}

// 統計・精算をそれぞれ色付きの箱にまとめる構成は情報が重複して見づらかったため、
// 合計・件数・精算・ステータスをラベル+値のシンプルな1本のリストにまとめる（2026-07-25、ユーザー指摘により簡略化）。
function buildMonthSummary(ym, stats, settlement, status) {
  const [year, month] = ym.split('-');
  const style = STATUS_STYLE[status] || { color: UI_COLORS.textLight, icon: '📝' };

  /** @type {FlexNode[]} */
  const rows = [
    summaryRow('合計', `¥${fmtNum(stats.total)}`, { size: 'xl', weight: 'bold', color: UI_COLORS.textDark, margin: 'none' }),
    summaryRow('件数', `${stats.count}件`),
  ];

  if (settlement) {
    rows.push({ type: 'separator', margin: 'md' });
    rows.push(summaryRow('精算', settlement.text, { size: 'lg', weight: 'bold', color: UI_COLORS.settlement }));
  }

  rows.push({ type: 'separator', margin: 'md' });
  rows.push(summaryRow('ステータス', `${style.icon} ${status}`, { weight: 'bold', color: style.color }));

  const buttons = [];
  if (settlement) buttons.push(makePostbackButton('Statusを変更', `act=${ACT.SET_STATUS}&ym=${ym}`, 'secondary'));
  buttons.push(makePostbackButton('他の月を見る', `act=${ACT.SHOW_MONTH_PICKER}`, 'secondary'));

  return buildFlexMessage(`${Number(year)}年${Number(month)}月家計簿`, rows, { buttons });
}

// ============================================================
// 編集フロー
// ============================================================

/**
 * @param {Array.<{id:number,date:string,subject:string,price:number,payer:string}>} entries
 *   2026-07-30〜、DB主体化に伴い物理行番号(i+2)ではなくentries.idをpostbackに埋め込む
 *   （行番号は日次ソートcron等で不安定なため、DBの主キーで行を特定する）。
 */
function buildAskRowEdit(entries) {
  if (entries.length === 0) return buildEmpty('編集するデータがありません');

  return buildFlexMessage('編集する行を選択', [], {
    buttons: entries.map((e) => makePostbackButton(`${fmtDate(e.date, 'M/d')} ${e.subject}`, `act=${encodeURIComponent(ACT.EDIT_ROW)}&v=${encodeURIComponent(e.id)}`)),
    cancel: true,
  });
}

function buildEditColumnSelect(row) {
  return buildFlexMessage(
    '編集する項目を選択',
    [{ type: 'text', text: `選択行\n${fmtDate(row[0], 'M/d')} ${row[1]}  ¥${fmtNum(row[2])} (${row[3]})`, size: 'sm', color: UI_COLORS.textMuted, wrap: true }],
    { buttons: makeColumnButtons(), cancel: true }
  );
}

function buildEditValuePrompt(column, currentValueText) {
  const hint = [{ type: 'text', text: `現在値：${currentValueText}`, size: 'sm', color: UI_COLORS.textFaint }];

  if (column === '日付') {
    return buildFlexMessage('新しい日付を選択', hint, {
      buttons: [makeDatePickerButton(`act=${ACT.EDIT_VALUE}`, '日付を選択')],
      cancel: true,
    });
  }

  if (column === '払った人') {
    return buildFlexMessage('新しい払った人を選択', hint, {
      buttons: PAYER_CHOICE.map((p) => makePostbackButton(p, `act=${ACT.EDIT_VALUE}&v=${p}`, 'primary')),
      cancel: true,
    });
  }

  const guide = column === '値段' ? '新しい金額を入力してください（数字）' : '新しい値を入力してください';
  return buildFlexMessage(guide, hint, { cancel: true });
}

function buildEditConfirm(column, currentText, newText) {
  return buildFlexMessage('編集内容確認', [{ type: 'text', text: `${column}\n${currentText} → ${newText}`, wrap: true }], {
    buttons: [
      makePostbackButton('保存', `act=${ACT.SAVE_EDIT}`, 'primary'),
      makePostbackButton('キャンセル', `act=${ACT.CANCEL}`, 'secondary'),
    ],
  });
}

// ============================================================
// 削除フロー
// ============================================================

/**
 * @param {Array.<{id:number,date:string,subject:string,price:number,payer:string}>} entries
 *   buildAskRowEditと同じ理由でentries.idをpostbackに埋め込む。
 */
function buildDeleteRowList(ym, entries) {
  const [year, month] = ym.split('-');

  const rows = entries.map((e) => ({
    type: 'box',
    layout: 'vertical',
    spacing: 'sm',
    margin: 'md',
    contents: [
      { type: 'text', text: `${fmtDate(e.date, 'M/d')}  ${e.subject}`, weight: 'bold', wrap: true },
      {
        type: 'box',
        layout: 'baseline',
        contents: [
          { type: 'text', text: `¥${fmtNum(e.price)}`, flex: 3, color: e.payer === 'a' ? UI_COLORS.payerA : UI_COLORS.payerC },
          { type: 'text', text: `(${e.payer})`, flex: 1, align: 'end', color: UI_COLORS.textFaint },
        ],
      },
      makePostbackButton('この行を削除', `act=${ACT.DELETE_ROW}&v=${e.id}`, 'primary', UI_COLORS.danger),
      { type: 'separator', margin: 'md' },
    ],
  }));

  return {
    type: 'flex',
    altText: '削除する行を選択',
    contents: {
      type: 'bubble',
      body: {
        type: 'box',
        layout: 'vertical',
        spacing: 'md',
        contents: [
          { type: 'text', text: `${Number(year)}年${Number(month)}月 家計簿（削除）`, weight: 'bold', size: 'lg', margin: 'md' },
          ...rows,
          makePostbackButton('キャンセル', `act=${ACT.CANCEL}`, 'secondary'),
        ],
      },
    },
  };
}

// ============================================================
// クイック入力ガイド
// ============================================================

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

// ============================================================
// 月初リマインド（reminder.js から利用）
// ============================================================

const REMINDER_CAROUSEL_MAX = 10;

function buildReminderBubble_(result) {
  const { year, month, status, dataCount, total, messageType } = result;

  let title;
  let icon;
  let color;
  let mainText;
  let subText;

  switch (messageType) {
    case 'NO_DATA':
      icon = '📝';
      title = '家計簿が未入力です';
      color = UI_COLORS.danger;
      mainText = `${year}年${month}月`;
      subText = 'データがまだ登録されていません';
      break;
    case 'NEED_INPUT':
      icon = '⚠️';
      title = '家計簿を入力してください';
      color = UI_COLORS.warning;
      mainText = `${year}年${month}月`;
      subText = `${dataCount}件・合計 ¥${total.toLocaleString()}\nステータス: ${status}`;
      break;
    case 'NEED_PAYMENT':
      icon = '💸';
      title = '精算・支払いをお願いします';
      color = UI_COLORS.info;
      mainText = `${year}年${month}月`;
      subText = `${dataCount}件・合計 ¥${total.toLocaleString()}\nステータス: ${status}`;
      break;
    default:
      return null;
  }

  const bubble = {
    type: 'bubble',
    body: {
      type: 'box',
      layout: 'vertical',
      spacing: 'md',
      contents: [
        {
          type: 'box',
          layout: 'vertical',
          spacing: 'sm',
          contents: [
            { type: 'text', text: icon, size: 'xxl', align: 'center' },
            { type: 'text', text: title, weight: 'bold', size: 'lg', align: 'center', wrap: true, color },
          ],
        },
        { type: 'separator', margin: 'lg' },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'lg',
          spacing: 'sm',
          backgroundColor: UI_COLORS.cardBg,
          cornerRadius: 'md',
          paddingAll: 'md',
          contents: [
            { type: 'text', text: mainText, size: 'xl', weight: 'bold', color: UI_COLORS.textDark, align: 'center' },
            { type: 'text', text: subText, size: 'sm', color: UI_COLORS.textMuted, align: 'center', margin: 'sm', wrap: true },
          ],
        },
        {
          type: 'box',
          layout: 'vertical',
          margin: 'lg',
          spacing: 'sm',
          contents: [makePostbackButton('メニューを表示', `act=${ACT.SHOW_MENU}`, 'primary', color)],
        },
        {
          type: 'text',
          text: 'メニューから「確認」を選んで対象月のデータを確認できます',
          size: 'xs',
          color: UI_COLORS.textLight,
          align: 'center',
          margin: 'md',
          wrap: true,
        },
      ],
    },
  };

  return { title, bubble };
}

/**
 * 未対応（先月まででNO_DATA/NEED_INPUT/NEED_PAYMENTのいずれか）の月ごとの結果一覧を、
 * 1件ならバブル単体、複数件ならカルーセル1メッセージにまとめて返す（2026-07-29、
 * 「先月分のみ」から「先月までの未対応月すべて」への変更に伴い複数件対応が必要になったため追加）。
 */
function buildReminderMessage(results) {
  const built = results.map((r) => buildReminderBubble_(r)).filter(Boolean);
  if (built.length === 0) return null;

  if (built.length === 1) {
    return { type: 'flex', altText: built[0].title, contents: built[0].bubble };
  }

  return {
    type: 'flex',
    altText: `未対応の月が${built.length}件あります`,
    contents: { type: 'carousel', contents: built.slice(0, REMINDER_CAROUSEL_MAX).map((b) => b.bubble) },
  };
}

module.exports = {
  makePostbackButton,
  makeDatePickerButton,
  buildFlexMessage,
  buildToast,
  buildEmpty,
  buildIdleMenu,
  buildAskDate,
  buildAskPayer,
  buildAddConfirmRows,
  buildAddConfirmFlex,
  buildConfirm,
  buildAskStatus,
  buildAskMonth,
  buildOlderMonths,
  buildAskMonthDelete,
  buildAskMonthEdit,
  buildMonthlyFlex,
  buildMonthSummary,
  buildAskRowEdit,
  buildEditColumnSelect,
  buildEditValuePrompt,
  buildEditConfirm,
  buildDeleteRowList,
  buildQuickInputGuide,
  buildQuickInputFailedGuide,
  buildReminderMessage,
};
