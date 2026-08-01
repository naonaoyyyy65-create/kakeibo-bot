/**
 * get_drive_token.js
 * Google Driveへのオフサイトバックアップ用に、ユーザー自身のGoogleアカウントの
 * OAuthリフレッシュトークンを一度だけ取得するための対話的スクリプト。
 * サービスアカウントはDriveの保存容量を持たないため（drive.files.create時に
 * "Service Accounts do not have storage quota" エラーになる)、ユーザー本人の
 * OAuth委任でファイルを作成する方式に切り替えるために用意した。
 *
 * 実行方法: node scripts/get_drive_token.js
 * 表示されたURLをブラウザで開いて許可すると、リフレッシュトークンが標準出力に表示される。
 * 取得したトークンは .env の GDRIVE_OAUTH_REFRESH_TOKEN に設定すること（PC・Pi両方）。
 */

const http = require('http');
const { URL } = require('url');
const { google } = require('googleapis');
const oauthClient = require('../credentials/oauth_client.json').installed;

const PORT = 53682;
const REDIRECT_URI = `http://localhost:${PORT}`;

const oauth2Client = new google.auth.OAuth2(
  oauthClient.client_id,
  oauthClient.client_secret,
  REDIRECT_URI
);

const authUrl = oauth2Client.generateAuthUrl({
  access_type: 'offline',
  prompt: 'consent',
  scope: ['https://www.googleapis.com/auth/drive.file'],
});

console.log('以下のURLをブラウザで開き、Googleアカウントでログインして許可してください:');
console.log(authUrl);

const server = http.createServer((req, res) => {
  const url = new URL(req.url, REDIRECT_URI);
  const code = url.searchParams.get('code');
  if (!code) {
    res.end('code not found');
    return;
  }
  res.end('認証が完了しました。このタブは閉じて構いません。');

  oauth2Client
    .getToken(code)
    .then(({ tokens }) => {
      console.log('\nリフレッシュトークンが取得できました。.envのGDRIVE_OAUTH_REFRESH_TOKENに設定してください:\n');
      console.log(tokens.refresh_token);
      server.close();
      process.exit(0);
    })
    .catch((err) => {
      console.error('トークン交換に失敗しました:', err);
      server.close();
      process.exitCode = 1;
    });
});

server.listen(PORT, () => {
  console.log(`\n(ローカルサーバーが http://localhost:${PORT} で認可コードの受信を待機中...)`);
});
