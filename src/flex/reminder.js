/**
 * flex/reminder.js
 * 月初リマインド（reminder.js から利用。旧flexBuilders.jsの分割時に抽出）。
 */

const { UI_COLORS, ACT } = require('../config');
const { makePostbackButton } = require('./core');

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

module.exports = { buildReminderMessage };
