/**
 * hakonushi - Config & Drive Folder Helpers (gas/Config.gs)
 */

var SHEET_BOXES = 'boxes';
var SHEET_FILES = 'files';

var MAX_PASSCODE_FAILURES = 5;
var DEFAULT_EXPIRES_HOURS = 72;
var MAX_EXPIRES_HOURS = 24 * 30; // 最大30日

// 一時共有の自動解除までの猶予時間（ミリ秒: デフォルト6時間 / 低速モバイル回線での大容量DLを想定）
var TEMP_SHARE_TTL_MS = 6 * 60 * 60 * 1000;
var TEMP_SHARED_FILES_PROP_KEY = 'TEMP_SHARED_FILES_JSON';
var SPREADSHEET_ID_PROP_KEY = 'SPREADSHEET_ID';

// ゲストアップロードの上限（デフォルト値・スクリプトプロパティで上書き可能）
var DEFAULT_GUEST_MAX_FILE_SIZE_MB = 15 * 1024;  // 1ファイル最大 15GB (15,360MB)
var DEFAULT_GUEST_MAX_FILES_PER_BOX = 50;        // 1箱あたり最大 50件
var DEFAULT_GUEST_MAX_TOTAL_SIZE_MB = 50 * 1024; // 1箱あたり合計最大 50GB (51,200MB)

var BOX_STATUS = {
  ACTIVE: 'ACTIVE',
  DISABLED: 'DISABLED',
  LOCKED: 'LOCKED',
  EXPIRED: 'EXPIRED'
};

var BOX_DIRECTION = {
  SEND: 'SEND',
  RECEIVE: 'RECEIVE'
};

var FILE_STATUS = {
  ACTIVE: 'ACTIVE',
  DELETED: 'DELETED'
};

/**
 * スクリプトプロパティから設定を取得する
 * @return {{ allowedEmails: string[], firebaseApiKey: string }}
 */
function getConfig() {
  var props = PropertiesService.getScriptProperties();
  var rawEmails = (props.getProperty('ALLOWED_EMAILS') || '').trim();
  var firebaseApiKey = (props.getProperty('FIREBASE_API_KEY') || '').trim();

  if (!rawEmails) {
    throw createAppError('CONFIG_ERROR', 'スクリプトプロパティ ALLOWED_EMAILS が設定されていません。');
  }
  if (!firebaseApiKey) {
    throw createAppError('CONFIG_ERROR', 'スクリプトプロパティ FIREBASE_API_KEY が設定されていません。');
  }

  var allowedEmails = rawEmails
    .split(',')
    .map(function (e) { return e.trim().toLowerCase(); })
    .filter(function (e) { return e.length > 0; });

  if (allowedEmails.length === 0) {
    throw createAppError('CONFIG_ERROR', 'ALLOWED_EMAILS に有効なメールアドレスが設定されていません。');
  }

  return {
    allowedEmails: allowedEmails,
    firebaseApiKey: firebaseApiKey
  };
}

/**
 * 許可された箱主メールアドレス一覧を取得する
 * @return {string[]}
 */
function getAllowedEmails() {
  return getConfig().allowedEmails;
}

/**
 * Firebase Web API Key を取得する
 * @return {string}
 */
function getFirebaseApiKey() {
  return getConfig().firebaseApiKey;
}

/**
 * 許可されたフロントエンド Origin 一覧を取得する
 * スクリプトプロパティ ALLOWED_ORIGINS（カンマ区切り 例: https://example.web.app）が必須
 * @return {string[]}
 */
function getAllowedOrigins() {
  var props = PropertiesService.getScriptProperties();
  var raw = (props.getProperty('ALLOWED_ORIGINS') || '').trim();
  if (!raw) {
    throw createAppError(
      'CONFIG_ERROR',
      'スクリプトプロパティ ALLOWED_ORIGINS が設定されていません（例: https://<project-id>.web.app）。'
    );
  }

  var origins = raw
    .split(',')
    .map(function (o) { return o.trim().replace(/\/+$/, '').toLowerCase(); })
    .filter(function (o) { return o.length > 0; });

  if (origins.length === 0) {
    throw createAppError('CONFIG_ERROR', 'ALLOWED_ORIGINS に有効なオリジンが設定されていません。');
  }
  return origins;
}

/**
 * ゲストアップロードの容量・件数上限設定を取得する
 * @return {{ maxFileSizeBytes: number, maxFilesPerBox: number, maxTotalBytesPerBox: number }}
 */
function getGuestUploadLimits() {
  var props = PropertiesService.getScriptProperties();
  var maxFileMb = Number(props.getProperty('GUEST_MAX_FILE_SIZE_MB'));
  var maxFiles = Number(props.getProperty('GUEST_MAX_FILES_PER_BOX'));
  var maxTotalMb = Number(props.getProperty('GUEST_MAX_TOTAL_SIZE_MB'));

  if (isNaN(maxFileMb) || maxFileMb <= 0) maxFileMb = DEFAULT_GUEST_MAX_FILE_SIZE_MB;
  if (isNaN(maxFiles) || maxFiles <= 0) maxFiles = DEFAULT_GUEST_MAX_FILES_PER_BOX;
  if (isNaN(maxTotalMb) || maxTotalMb <= 0) maxTotalMb = DEFAULT_GUEST_MAX_TOTAL_SIZE_MB;

  return {
    maxFileSizeBytes: Math.floor(maxFileMb * 1024 * 1024),
    maxFilesPerBox: Math.floor(maxFiles),
    maxTotalBytesPerBox: Math.floor(maxTotalMb * 1024 * 1024)
  };
}

/**
 * 管理用スプレッドシートを取得する
 * - 優先: スクリプトプロパティ SPREADSHEET_ID から openById() で取得（Webアプリ/トリガー実行に安全）
 * - 未保存時: getActiveSpreadsheet() にフォールバックし、取得できたIDを自動保存する
 * @return {GoogleAppsScript.Spreadsheet.Spreadsheet}
 */
function getActiveSpreadsheet() {
  var props = PropertiesService.getScriptProperties();
  var savedId = (props.getProperty(SPREADSHEET_ID_PROP_KEY) || '').trim();
  if (savedId) {
    try {
      return SpreadsheetApp.openById(savedId);
    } catch (e) {
      Logger.log('openById failed for saved SPREADSHEET_ID (' + savedId + '): ' + e.message);
    }
  }

  var ss = SpreadsheetApp.getActiveSpreadsheet();
  if (!ss) {
    throw createAppError(
      'CONFIG_ERROR',
      '管理用スプレッドシートを取得できませんでした。コンテナバインドGASとして setupDatabase() を実行するか、スクリプトプロパティ SPREADSHEET_ID を設定してください。'
    );
  }

  // 次回以降の Web アプリ / トリガー実行で openById() を使えるよう自動キャッシュ
  try {
    props.setProperty(SPREADSHEET_ID_PROP_KEY, ss.getId());
  } catch (e) {
    // ignore
  }
  return ss;
}

/**
 * スプレッドシートの親フォルダ（格納ルートフォルダ）を相対解決で取得する
 * @return {GoogleAppsScript.Drive.Folder}
 */
function getRootFolder() {
  var ss = getActiveSpreadsheet();
  var ssFile = DriveApp.getFileById(ss.getId());
  var parents = ssFile.getParents();
  if (!parents.hasNext()) {
    throw createAppError('DRIVE_ERROR', 'スプレッドシートの親フォルダが見つかりません。専用フォルダ内に配置してください。');
  }
  return parents.next();
}

/**
 * 指定親フォルダ配下から同名サブフォルダを取得（なければ作成）する
 * @param {GoogleAppsScript.Drive.Folder} parentFolder
 * @param {string} folderName
 * @return {GoogleAppsScript.Drive.Folder}
 */
function getOrCreateSubFolder(parentFolder, folderName) {
  var iter = parentFolder.getFoldersByName(folderName);
  while (iter.hasNext()) {
    var folder = iter.next();
    if (!folder.isTrashed()) {
      return folder;
    }
  }
  return parentFolder.createFolder(folderName);
}

/**
 * 箱主メールアドレスごとのフォルダを取得（なければ作成）する
 * @param {string} email
 * @return {GoogleAppsScript.Drive.Folder}
 */
function getUserFolder(email) {
  var normalizedEmail = String(email || '').trim().toLowerCase();
  if (!normalizedEmail) {
    throw createAppError('INVALID_ARGUMENT', 'メールアドレスが指定されていません。');
  }
  var rootFolder = getRootFolder();
  return getOrCreateSubFolder(rootFolder, normalizedEmail);
}

/**
 * 箱ごとのフォルダを取得（なければ作成）する
 * @param {string} email
 * @param {string} boxId
 * @return {GoogleAppsScript.Drive.Folder}
 */
function getBoxFolder(email, boxId) {
  var userFolder = getUserFolder(email);
  return getOrCreateSubFolder(userFolder, String(boxId));
}

/**
 * デフォルトの箱名（日時テキスト）を生成する
 * @param {Date=} date
 * @return {string}
 */
function formatDefaultBoxName(date) {
  var target = date || new Date();
  return Utilities.formatDate(target, 'Asia/Tokyo', 'yyyy/MM/dd HH:mm');
}

/**
 * アプリケーション共通エラーを生成する
 * @param {string} code
 * @param {string} message
 * @return {Error}
 */
function createAppError(code, message) {
  var err = new Error(message);
  err.appCode = code;
  return err;
}
