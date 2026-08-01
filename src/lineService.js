/**
 * lineService.js
 * LINE API通信（GAS版 LINE.gs の移植。@line/bot-sdkを使用）
 *
 * GAS版はWebhook署名検証を行っていなかったが、@line/bot-sdkのmiddlewareを
 * 使うことで検証込みで簡単に実装できるため、Node.js版では標準対応する。
 */

const { LineBotClient, middleware } = require('@line/bot-sdk');
const config = require('./config');

const lineConfig = {
  channelAccessToken: config.LINE_CHANNEL_ACCESS_TOKEN,
  channelSecret: config.LINE_CHANNEL_SECRET,
};

const rawClient = LineBotClient.fromChannelAccessToken({ channelAccessToken: config.LINE_CHANNEL_ACCESS_TOKEN });

// @line/bot-sdk v9以降、replyMessage/pushMessage/broadcastは位置引数から
// {replyToken, messages}等のオブジェクト引数に変更された。webhookHandler.js側の
// 30箇所以上の呼び出し（旧位置引数シグネチャ）を書き換えずに済むよう、
// 旧シグネチャのまま使える薄いラッパーとしてclientを再定義する
// （v11アップグレードの動機は@line/bot-sdk同梱のfile-typeパッケージの脆弱性解消、詳細はCLAUDE.md参照）。
const client = {
  replyMessage: (replyToken, messages) =>
    rawClient.replyMessage({ replyToken, messages: Array.isArray(messages) ? messages : [messages] }),
  pushMessage: (to, messages) =>
    rawClient.pushMessage({ to, messages: Array.isArray(messages) ? messages : [messages] }),
  broadcast: (messages) => rawClient.broadcast({ messages: Array.isArray(messages) ? messages : [messages] }),
};

module.exports = {
  client,
  middleware: middleware(lineConfig),
};
