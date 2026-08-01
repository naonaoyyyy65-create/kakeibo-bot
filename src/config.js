require('dotenv').config();

const TZ = 'Asia/Tokyo';

const MONTH_HEADER = ['日付', '題目', '値段', '払った人'];
const PAYER_CHOICE = ['c', 'a'];
const PAYMENT_STATUS = ['確定前', '確定済', '支払済'];
const PAGE_SIZE = 8;

const UI_COLORS = {
  primary: '#1abc9c',
  primaryDark: '#16a085',
  textDark: '#2c3e50',
  textMuted: '#7f8c8d',
  textLight: '#95a5a6',
  textFaint: '#888888',
  headerBg: '#34495e',
  payerC: '#27ae60',
  payerA: '#e74c3c',
  info: '#3498db',
  infoDark: '#2980b9',
  warning: '#f39c12',
  danger: '#e74c3c',
  settlement: '#e67e22',
  settlementDark: '#d35400',
  settlementBg: '#fff3e0',
  settlementSep: '#ffe0b2',
  settlementAmount: '#ff9800',
  cardBg: '#f8f9fa',
  separator: '#ecf0f1',
  white: '#ffffff',
};

const STATUS_STYLE = {
  確定前: { color: UI_COLORS.textLight, icon: '⏳' },
  確定済: { color: UI_COLORS.info, icon: '✅' },
  支払済: { color: UI_COLORS.payerC, icon: '💸' },
};

const PAYER_ICON = { c: '👤', a: '🌸' };

const SHEET_CONSTANTS = {
  HEADER_ROW: 1,
  DATA_START_ROW: 2,
  COLUMN_COUNT: 4,
  // 2026-07-30〜、DB主体化に伴いE列に行の同一性を表すID（entries.id）を追加。
  // sortAllMonthlySheetsIfNeededの並び替え範囲はこちらを使い、IDが物理行と一緒に移動するようにする
  // （COLUMN_COUNTのままだとID列だけ取り残されデータとの対応が壊れるバグになるため分離）。
  COLUMN_COUNT_WITH_ID: 5,
  COLUMNS: {
    DATE: 1,
    SUBJECT: 2,
    PRICE: 3,
    PAYER: 4,
    ID: 5,
  },
  STATUS_CELL: 'G1',
};

const STEP = {
  IDLE: 'IDLE',
  ASK_DATE: 'ASK_DATE',
  WAIT_SUBJECT: 'WAIT_SUBJECT',
  WAIT_PRICE: 'WAIT_PRICE',
  ASK_PAYER: 'ASK_PAYER',
  CONFIRM: 'CONFIRM',
  ASK_MONTH: 'ASK_MONTH',
  ASK_MONTH_DELETE: 'ASK_MONTH_DELETE',
  CONFIRM_DELETE: 'CONFIRM_DELETE',
  ASK_EDIT_MONTH: 'ASK_EDIT_MONTH',
  ASK_EDIT_ROW: 'ASK_EDIT_ROW',
  ASK_EDIT_COLUMN: 'ASK_EDIT_COLUMN',
  WAIT_EDIT_VALUE: 'WAIT_EDIT_VALUE',
  CONFIRM_EDIT: 'CONFIRM_EDIT',
};

const ACT = {
  START_ADD: 'start_add',
  START_CHECK: 'start_check',
  START_EDIT: 'start_edit',
  START_DELETE: 'start_delete',
  CANCEL: 'cancel',
  DATE_TODAY: 'date_today',
  DATE_YESTERDAY: 'date_yesterday',
  DATE_PICK: 'date_pick',
  PAYER: 'payer',
  SAVE: 'save',
  EDIT: 'edit',
  MONTH: 'month',
  DELETE_MONTH: 'delete_month',
  DELETE_ROW: 'delete_row',
  EDIT_ROW: 'edit_row',
  EDIT_COLUMN: 'edit_column',
  EDIT_VALUE: 'edit_value',
  SAVE_EDIT: 'save_edit',
  SET_STATUS: 'set_status',
  UPDATE_STATUS: 'update_status',
  SHOW_MENU: 'show_menu',
  SHOW_GUIDE: 'show_guide',
  SHOW_MONTH_PICKER: 'show_month_picker',
};

module.exports = {
  TZ,
  MONTH_HEADER,
  PAYER_CHOICE,
  PAYMENT_STATUS,
  PAGE_SIZE,
  UI_COLORS,
  STATUS_STYLE,
  PAYER_ICON,
  SHEET_CONSTANTS,
  STEP,
  ACT,
  LINE_CHANNEL_ACCESS_TOKEN: process.env.LINE_CHANNEL_ACCESS_TOKEN,
  LINE_CHANNEL_SECRET: process.env.LINE_CHANNEL_SECRET,
  SPREADSHEET_ID: process.env.SPREADSHEET_ID,
  GOOGLE_SERVICE_ACCOUNT_KEY_PATH: process.env.GOOGLE_SERVICE_ACCOUNT_KEY_PATH,
  GDRIVE_BACKUP_FOLDER_ID: process.env.GDRIVE_BACKUP_FOLDER_ID || '',
  GDRIVE_OAUTH_CLIENT_ID: process.env.GDRIVE_OAUTH_CLIENT_ID || '',
  GDRIVE_OAUTH_CLIENT_SECRET: process.env.GDRIVE_OAUTH_CLIENT_SECRET || '',
  GDRIVE_OAUTH_REFRESH_TOKEN: process.env.GDRIVE_OAUTH_REFRESH_TOKEN || '',
  PORT: process.env.PORT || 3000,
  // 「支払済」確認済みの月次シート一覧の永続化先（reminder.jsが以後チェックをスキップするために使用）
  SETTLED_MONTHS_FILE_PATH: process.env.SETTLED_MONTHS_FILE_PATH || './data/settledMonths.json',
  // 主データストア（SQLite）のファイルパス（2026-07-30〜、DB主体化）
  DB_FILE_PATH: process.env.DB_FILE_PATH || './data/kakeibo.db',
  // スプレッドシート直接編集の同期用エンドポイント（/sheets-sync）の共有シークレット
  SHEETS_SYNC_SHARED_SECRET: process.env.SHEETS_SYNC_SHARED_SECRET || '',
  REMINDER_USER_IDS: (process.env.REMINDER_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
  // リマインドの本番送信先（利用者2人を明示指定。usersシートのgetAllUserIds()は
  // 開発時のテスト用IDが紛れ込む可能性があるため使わない、2026-07-29追加）
  NOTIFY_USER_IDS: (process.env.NOTIFY_USER_IDS || '')
    .split(',')
    .map((id) => id.trim())
    .filter(Boolean),
};
