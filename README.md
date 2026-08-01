# kakeibo-bot

LINEのトーク上でテキスト入力・ボタン操作するだけで記帳できる、2人で使う割り勘家計簿LINE Bot。Node.js（Express）＋ SQLite ＋ Google Sheets API（人間可読なミラー）＋ LINE Messaging APIで実装し、Raspberry Pi上でsystemdサービスとして常時稼働している本番システムです。

もとは Google Apps Script（GAS）版として作り始め、機能パリティを達成した段階でNode.js版に全面移行しました。

## 主な機能

- **クイック入力**: `スーパー 2500 c` のようにテキスト1行で即登録（日付・語順は不問、全角/半角、`1.5k`のような単位表記にも対応）
- **ステップ入力**: ボタンで日付→題目→金額→払った人を順に入力する対話フロー
- **月次確認**: 「確認」で即座に今月のデータを表示（合計・精算額のサマリーを先に表示）。他の月へも遷移可能
- **編集・削除**: 月→行→項目を選んで既存データを修正・削除
- **支払いステータス管理**: `確定前→確定済→支払済`の3段階。確定後はLINEからの追加・編集・削除をロックし、誤操作を防止
- **月初めリマインド**: 未精算の月をまとめて通知（cron実行、通知先の切り替えはデバッグフラグで対応）
- **スプレッドシートとの双方向同期**: Bot側の操作はスプレッドシートへ非同期ミラー、スプレッドシート側の直接編集もWebhook経由でDBへ反映
- **オフサイトバックアップ**: DB・スプレッドシートの両方を週次でバックアップし、任意でGoogle Driveへもアップロード

## 技術スタック

- Node.js / Express
- SQLite（`better-sqlite3`）— 主データストア
- Google Sheets API — 人間が直接編集できるミラーとして双方向同期
- Google Apps Script（`onEdit`インストール型トリガー）— スプレッドシート側の変更検知
- Google Drive API（OAuth委任）— バックアップのオフサイト保存
- LINE Messaging API（`@line/bot-sdk`）
- `node:test`（標準テストランナー、外部依存なし）

## アーキテクチャ / 設計上の工夫

このプロジェクトの一番の見どころは、**運用しながら「スプレッドシート直叩き」から「SQLite主体＋双方向ミラー同期」へ段階的に移行した過程**です。

- **なぜSQLiteに移行したか**: 当初はスプレッドシートを唯一のデータソースとして都度APIを呼ぶ設計でしたが、応答速度がSheets/LINE APIへのネットワーク往復に律速されていました。ローカルのSQLiteを主データストアにすることで応答速度を改善しつつ、スプレッドシートは「人間が使い慣れた画面で直接編集できるミラー」として残す方針にしました。
- **双方向同期の設計**:
  - Bot操作 → DBへ即時反映（LINE返信はこの完了を待つ）→ スプレッドシートへは非同期・fire-and-forgetでミラー
  - スプレッドシート直接編集 → Apps Scriptのインストール型`onEdit`トリガーが共有シークレット付きでWebhookへ通知 → DBへ反映
  - 行の同一性は物理行番号ではなくID列で判定するため、スプレッドシート上で行を挿入してもID対応が崩れない設計
- **ソフトデリート**: 金銭データを扱うため、削除は論理削除（`deleted_at`）のみ。IDも欠番のまま採番し、過去の参照が別データを指してしまう事故を防止
- **APIクォータ対策**: 月ごとに個別リクエストする実装ではGoogle Sheets APIの分間クォータにすぐ抵触したため、`batchGet`/`batchUpdate`でまとめてリクエストする方式に変更。加えて、支払済が確定した月はローカルにキャッシュして以後のAPI呼び出し対象から除外し、リクエスト数自体を削減
- **`@line/bot-sdk`のモック不可問題への対応**: SDKがESM/CJSデュアルパッケージ構成のため`node:test`の`mock.module()`で正しくモックできない問題に対し、実際の送信関数を引数として渡す設計に切り出してテスト可能にした（カレンダーBotと共通の設計判断）
- **失敗の可視化**: バックアップ処理は「全体失敗」「スプレッドシート出力のみ失敗」「Driveアップロードのみ失敗」を区別してLINEへ通知し、サイレントに失敗し続けることを防止

## フォルダ構成

```
.
├── package.json
├── .env.example
├── src/
│   ├── config.js               # 環境変数の読み込み・定数
│   ├── server.js               # Expressエントリポイント（/webhook, /sheets-sync, /health）
│   ├── dbService.js            # 主データストア（SQLite、better-sqlite3）
│   ├── sheetsService.js        # Google Sheets API操作
│   ├── sheetsMirrorService.js  # DB→Sheetsの非同期ミラー同期
│   ├── sheetsSyncHandler.js    # Sheets→DBの逆方向同期（/sheets-syncハンドラ）
│   ├── migrateSheetsToDb.js    # 初回移行用の一括移行スクリプト
│   ├── quickInput.js           # クイック入力パーサー
│   ├── flexBuilders.js         # LINE Flex Message構築
│   ├── lineService.js          # LINE APIクライアント・署名検証middleware
│   ├── webhookHandler.js       # イベントルーティング・全ステップフロー
│   ├── state.js                # 会話状態管理（メモリ内Map）
│   ├── errors.js                # カスタムエラークラス
│   ├── utils.js                 # 日付/金額フォーマット・精算計算
│   ├── reminder.js              # 未精算月のリマインド（cron実行）
│   ├── reminderStore.js         # リマインド確認済み月の永続化
│   ├── backup.js                # DB・スプレッドシートのバックアップ（cron実行）
│   ├── maintenanceSortSheets.js # スプレッドシートの行順メンテナンス（cron実行）
│   └── checkLineQuota.js        # LINE無料メッセージ枠の週次通知
├── scripts/
│   └── get_drive_token.js       # Google Drive用OAuthリフレッシュトークンの取得スクリプト
├── tests/                       # node:testによるユニットテスト
└── deploy/
    ├── kakeibo-bot.service      # systemdユニットファイル
    ├── health_monitor.sh        # ヘルスチェック監視スクリプト（cron実行）
    └── deploy_kakeibo.ps1       # デプロイスクリプト（PC→サーバー、scp+ssh）
```

## データモデル（SQLite）

```sql
CREATE TABLE entries (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  ym TEXT NOT NULL,               -- 'yyyy-MM'
  date TEXT NOT NULL,             -- 'yyyy-MM-dd'
  subject TEXT NOT NULL,
  price INTEGER NOT NULL,
  payer TEXT NOT NULL CHECK (payer IN ('c','a')),
  created_at TEXT NOT NULL, updated_at TEXT NOT NULL,
  deleted_at TEXT NULL            -- ソフトデリート
);
CREATE TABLE month_status (ym TEXT PRIMARY KEY, status TEXT NOT NULL DEFAULT '', updated_at TEXT NOT NULL);
CREATE TABLE users (user_id TEXT PRIMARY KEY, last_used_at TEXT NOT NULL, use_count INTEGER NOT NULL DEFAULT 0);
```

## セットアップ

1. LINE Developersでチャネルを作成し、アクセストークン・チャネルシークレットを取得
2. GCPプロジェクトでサービスアカウントを作成し、Sheets APIを有効化。JSONキーを`credentials/service-account.json`に配置
3. 対象のスプレッドシートをサービスアカウントに編集者として共有
4. `.env.example`を`.env`にコピーし、各値を設定（Google Driveバックアップを使う場合は`scripts/get_drive_token.js`でOAuthリフレッシュトークンを取得）
5. `npm install`
6. `npm test` でユニットテストを実行（本番データには一切アクセスしない設計）
7. `node src/server.js` でローカル起動、または`deploy/`のsystemdユニットファイルを参考にサーバーへ配置

## テスト

```
npm test
```

`node:test`を使用。`dbService.js`は`better-sqlite3`の`:memory:`DBに対して直接テストし、外部APIに依存する層（`sheetsService.js`/`lineService.js`）は`mock.module()`でモック。テストは本番データを含むDBファイルに一切アクセスしない設計を徹底しています。
