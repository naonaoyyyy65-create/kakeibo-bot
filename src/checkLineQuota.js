/**
 * checkLineQuota.js
 * このBot（家計簿Bot）自身のLINEチャネルの月間無料メッセージ枠を確認し、
 * 監視通知Bot（notify-bot、`../../監視通知/CLAUDE.md`参照）の`/line-quota`へ集計値のみを送る。
 * トークン等の秘密情報は送らない。notify-bot側でカレンダーBot・家計簿Bot両方のレポートが
 * 揃った時点で1通のFlexメッセージにまとめて送信される（2026-07-29、「1つのメッセージに
 * まとめて送りたい」との依頼により、自前でテキスト整形してnotify-botの/notifyへ送る方式から変更）。
 * Pi上のcronから週1で実行する想定。
 */
const { LineBotClient } = require('@line/bot-sdk');
const config = require('./config');

const NOTIFY_URL = process.env.NOTIFY_BOT_URL || 'http://127.0.0.1:3004';

async function main() {
  const client = LineBotClient.fromChannelAccessToken({ channelAccessToken: config.LINE_CHANNEL_ACCESS_TOKEN });
  const [quota, consumption] = await Promise.all([client.getMessageQuota(), client.getMessageQuotaConsumption()]);
  const limit = quota.type === 'limited' ? quota.value : consumption.totalUsage;

  const res = await fetch(`${NOTIFY_URL}/line-quota`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ bot: 'kakeibo', used: consumption.totalUsage, limit }),
  });
  if (!res.ok) throw new Error(`notify-bot returned ${res.status}`);

  console.log(`LINE無料枠チェック完了: ${consumption.totalUsage}/${limit}通`);
}

main().catch((err) => {
  console.error('checkLineQuota failed:', err);
  process.exitCode = 1;
});
