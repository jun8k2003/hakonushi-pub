/**
 * hakonushi - Google Drive Helpers (gas/DriveHelper.gs)
 */

/**
 * Drive API v3 Resumable Upload セッションを開始し、PUT先URIを返す
 * ブラウザからの直接PUT時にCORSエラーを防ぐため、必ず Origin ヘッダを付与する
 *
 * @param {string} folderId
 * @param {string} fileName
 * @param {string} mimeType
 * @param {number} fileSize
 * @param {string} origin リクエスト元フロントエンドの Origin (例: https://xxx.web.app)
 * @return {string} Resumable Upload Session URI
 */
function createResumableUploadSession(folderId, fileName, mimeType, fileSize, origin) {
  var safeName = String(fileName || '').trim();
  if (!safeName) {
    throw createAppError('INVALID_ARGUMENT', 'ファイル名が指定されていません。');
  }
  var safeOrigin = String(origin || '').trim().replace(/\/+$/, '');
  if (!safeOrigin || !/^https?:\/\/[^/\s]+$/i.test(safeOrigin)) {
    throw createAppError('INVALID_ARGUMENT', 'Origin ヘッダの値が不正です。');
  }

  // 許可されたフロントエンド Origin のみ受け入れる（任意ドメインからのCORS発行を防止）
  var allowedOrigins = getAllowedOrigins();
  if (allowedOrigins.indexOf(safeOrigin.toLowerCase()) === -1) {
    throw createAppError('FORBIDDEN', '許可されていないオリジンからのアップロード要求です。');
  }

  var isLocalDev = /^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(safeOrigin);
  if (!/^https:\/\//i.test(safeOrigin) && !isLocalDev) {
    throw createAppError('FORBIDDEN', 'HTTPS以外のオリジンは許可されていません。');
  }

  var safeMime = String(mimeType || 'application/octet-stream').trim() || 'application/octet-stream';
  var url = 'https://www.googleapis.com/upload/drive/v3/files?uploadType=resumable&fields=id,name,size,mimeType';

  var headers = {
    Authorization: 'Bearer ' + ScriptApp.getOAuthToken(),
    Origin: safeOrigin,
    'X-Upload-Content-Type': safeMime
  };
  if (typeof fileSize === 'number' && !isNaN(fileSize) && fileSize >= 0) {
    headers['X-Upload-Content-Length'] = String(Math.floor(fileSize));
  }

  var metadata = {
    name: safeName,
    parents: [folderId]
  };

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json; charset=UTF-8',
    headers: headers,
    payload: JSON.stringify(metadata),
    muteHttpExceptions: true
  });

  var code = res.getResponseCode();
  if (code !== 200 && code !== 201) {
    Logger.log('Drive resumable init failed (' + code + '): ' + res.getContentText());
    throw createAppError('DRIVE_ERROR', 'アップロードセッションの開始に失敗しました（HTTP ' + code + '）。');
  }

  var resHeaders = res.getAllHeaders();
  var uploadUrl = resHeaders.Location || resHeaders.location;
  if (!uploadUrl) {
    throw createAppError('DRIVE_ERROR', 'アップロード先URIを取得できませんでした。');
  }

  return String(uploadUrl);
}

/**
 * フォルダが存在しゴミ箱に入っていないか確認する
 * @param {string} folderId
 * @return {boolean}
 */
function isFolderAlive(folderId) {
  if (!folderId) return false;
  try {
    var folder = DriveApp.getFolderById(folderId);
    return !folder.isTrashed();
  } catch (e) {
    return false;
  }
}

/**
 * ファイルが存在しゴミ箱に入っていないか確認する
 * @param {string} fileId
 * @return {boolean}
 */
function isFileAlive(fileId) {
  if (!fileId) return false;
  try {
    var file = DriveApp.getFileById(fileId);
    return !file.isTrashed();
  } catch (e) {
    return false;
  }
}

/**
 * フォルダを安全にゴミ箱へ移動する
 * @param {string} folderId
 * @return {boolean}
 */
function trashFolderSafe(folderId) {
  if (!folderId) return false;
  try {
    var folder = DriveApp.getFolderById(folderId);
    if (!folder.isTrashed()) {
      folder.setTrashed(true);
    }
    return true;
  } catch (e) {
    Logger.log('trashFolderSafe skipped (' + folderId + '): ' + e.message);
    return false;
  }
}

/**
 * フォルダ（配下ファイル含む）をGoogle Driveから完全削除する
 * Drive API v3 (Drive.Files.remove) を優先し、利用不可時はゴミ箱へフォールバックする
 * @param {string} folderId
 * @return {boolean}
 */
function permanentlyDeleteFolderSafe(folderId) {
  if (!folderId) return false;
  try {
    if (typeof Drive !== 'undefined' && Drive.Files && typeof Drive.Files.remove === 'function') {
      Drive.Files.remove(folderId);
      return true;
    }
  } catch (e) {
    Logger.log('Drive.Files.remove skipped (' + folderId + '): ' + e.message);
  }
  return trashFolderSafe(folderId);
}

/**
 * ファイルを安全にゴミ箱へ移動する
 * @param {string} fileId
 * @return {boolean}
 */
function trashFileSafe(fileId) {
  if (!fileId) return false;
  try {
    var file = DriveApp.getFileById(fileId);
    if (!file.isTrashed()) {
      file.setTrashed(true);
    }
    return true;
  } catch (e) {
    Logger.log('trashFileSafe skipped (' + fileId + '): ' + e.message);
    return false;
  }
}

/**
 * アップロード完了したファイルが指定フォルダ配下に存在することを検証し、メタデータを返す
 * @param {string} fileId
 * @param {string} expectedFolderId
 * @return {{ fileId: string, fileName: string, fileSize: number, mimeType: string }}
 */
function verifyUploadedDriveFile(fileId, expectedFolderId) {
  var safeId = String(fileId || '').trim();
  if (!safeId) {
    throw createAppError('INVALID_ARGUMENT', 'ファイルIDが指定されていません。');
  }

  var file;
  try {
    file = DriveApp.getFileById(safeId);
  } catch (e) {
    throw createAppError('FILE_NOT_FOUND', 'Google Drive上にアップロード済みファイルが見つかりません。');
  }

  if (file.isTrashed()) {
    throw createAppError('FILE_NOT_FOUND', '対象ファイルはすでに削除されています。');
  }

  var parents = file.getParents();
  var matched = false;
  while (parents.hasNext()) {
    if (parents.next().getId() === expectedFolderId) {
      matched = true;
      break;
    }
  }
  if (!matched) {
    throw createAppError('FORBIDDEN', 'ファイルがこの箱のフォルダに属していません。');
  }

  return {
    fileId: file.getId(),
    fileName: file.getName(),
    fileSize: file.getSize(),
    mimeType: file.getMimeType() || 'application/octet-stream'
  };
}

/**
 * 箱主向けのダウンロードURLを返す（ANYONE_WITH_LINK は一切付与しない）
 * - GAS実行者（Driveオーナー）本人の場合：非公開のまま直URLを返却
 * - 別の許可メールアドレス（家族等）の場合：その箱主本人のみに閲覧権限を限定付与
 *
 * @param {string} fileId
 * @param {string} ownerEmail
 * @return {string}
 */
function createOwnerDownloadUrl(fileId, ownerEmail) {
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    throw createAppError('FILE_NOT_FOUND', '対象ファイルが見つかりません。');
  }

  if (file.isTrashed()) {
    throw createAppError('FILE_NOT_FOUND', '対象ファイルは削除されています。');
  }

  var normalizedOwner = String(ownerEmail || '').trim().toLowerCase();
  var driveOwnerEmail = '';
  try {
    var driveOwner = file.getOwner();
    if (driveOwner) {
      driveOwnerEmail = String(driveOwner.getEmail() || '').trim().toLowerCase();
    }
  } catch (e) {
    // ignore
  }

  if (normalizedOwner && normalizedOwner !== driveOwnerEmail) {
    try {
      file.addViewer(normalizedOwner);
    } catch (e) {
      Logger.log('addViewer skipped (' + fileId + ', ' + normalizedOwner + '): ' + e.message);
    }
  }

  return 'https://drive.google.com/uc?export=download&id=' + encodeURIComponent(fileId);
}

/**
 * ゲスト向け（SEND箱のみ・呼び出し元が withScriptLock を保持している前提）：
 * 1. 解除予定を先に PropertiesService へ記録（Write-Ahead）
 * 2. その後に「リンクを知っている全員（閲覧者）」を設定して直ダウンロードURLを返す
 *
 * @param {string} fileId
 * @param {string} boxId
 * @return {string}
 */
function createGuestDownloadUrlUnlocked_(fileId, boxId) {
  var file;
  try {
    file = DriveApp.getFileById(fileId);
  } catch (e) {
    throw createAppError('FILE_NOT_FOUND', '対象ファイルが見つかりません。');
  }

  if (file.isTrashed()) {
    throw createAppError('FILE_NOT_FOUND', '対象ファイルは削除されています。');
  }

  // 保存失敗時の追跡漏れを防ぐため、公開前に解除予定を記録する
  registerTempSharedFileUnlocked_(fileId, boxId);
  file.setSharing(DriveApp.Access.ANYONE_WITH_LINK, DriveApp.Permission.VIEW);

  // スマホでGoogleドライブアプリに横取り（アカウント選択・MP4直接再生）されないよう
  // ファイル配信専用ドメイン drive.usercontent.google.com を返す
  return 'https://drive.usercontent.google.com/download?id=' + encodeURIComponent(fileId) + '&export=download&confirm=t';
}

/**
 * 対象ファイルのリンク共有（type === 'anyone'）のみを削除する
 * - Drive API v3 (Drive.Permissions.list / remove) を使用し、箱主個人の閲覧権限は維持する
 * - ゴミ箱内のファイルに対してもそのまま公開権限の削除を実行する
 * - 戻り値:
 *   - 'REVOKED': 公開権限の削除完了（または元々公開権限なし）
 *   - 'UNVERIFIABLE': 404（完全削除済み、または実行アカウントから参照不可）のため解除確認不可として追跡終了
 *   - 'FAILED': 一時エラー・レート制限等で失敗（呼び出し元で記録を残し次回再試行）
 *
 * @param {string} fileId
 * @return {'REVOKED'|'UNVERIFIABLE'|'FAILED'}
 */
function revokeFileSharingSafe(fileId) {
  if (!fileId) return 'REVOKED';

  try {
    var listRes = Drive.Permissions.list(fileId, {
      fields: 'permissions(id,type)'
    });
    var permissions = (listRes && listRes.permissions) ? listRes.permissions : [];
    for (var i = 0; i < permissions.length; i++) {
      var perm = permissions[i];
      if (perm && perm.type === 'anyone' && perm.id) {
        Drive.Permissions.remove(fileId, perm.id);
      }
    }
    return 'REVOKED';
  } catch (e) {
    var msg = String(e && e.message ? e.message : e);
    var statusCode = e && e.details && e.details.code ? Number(e.details.code) : 0;
    if (statusCode === 404 || /File not found|\b404\b/i.test(msg)) {
      Logger.log('revokeFileSharingSafe: 解除確認不可 (404: 完全削除または参照不可のため追跡終了) fileId=' + fileId);
      return 'UNVERIFIABLE';
    }
    Logger.log('revokeFileSharingSafe failed (' + fileId + '): ' + msg);
    return 'FAILED';
  }
}

/**
 * 指定された箱配下のファイルの公開権限をすべて削除し、終了確認できた記録のみ一時共有リストから除外する
 * @param {string} boxId
 */
function revokeBoxFilesSharingSafe(boxId) {
  var safeBoxId = String(boxId || '').trim();
  if (!safeBoxId) return;

  var files = findFilesByBoxId(safeBoxId, true);
  var targetIds = {};
  for (var i = 0; i < files.length; i++) {
    targetIds[files[i].file_id] = true;
  }

  var map = readTempSharedMap_();
  Object.keys(map).forEach(function (fid) {
    if (map[fid] && map[fid].boxId === safeBoxId) {
      targetIds[fid] = true;
    }
  });

  var changed = false;
  Object.keys(targetIds).forEach(function (fid) {
    var status = revokeFileSharingSafe(fid);
    if ((status === 'REVOKED' || status === 'UNVERIFIABLE') && map[fid]) {
      delete map[fid];
      changed = true;
    }
  });

  if (changed) {
    writeTempSharedMap_(map);
  }
}

/**
 * 一時共有リストへファイルIDと解除予定時刻を記録する（ロック保持中用）
 * @param {string} fileId
 * @param {string} boxId
 */
function registerTempSharedFileUnlocked_(fileId, boxId) {
  var map = readTempSharedMap_();
  map[String(fileId)] = {
    boxId: String(boxId || ''),
    revokeAfterMs: new Date().getTime() + TEMP_SHARE_TTL_MS
  };
  writeTempSharedMap_(map);
}

/**
 * 猶予時間（デフォルト6時間）を過ぎた一時共有ファイルの公開権限を削除する
 * - 一時共有リストが空の場合は Drive API を呼ばず即終了する
 * - 解除完了（REVOKED）または解除確認不可（UNVERIFIABLE）時のみ記録を削除し、FAILED時は次回再試行する
 * @return {{ revokedCount: number, unverifiableCount: number }}
 */
function revokeExpiredTempSharedFiles() {
  var map = readTempSharedMap_();
  var fileIds = Object.keys(map);
  if (fileIds.length === 0) {
    return { revokedCount: 0, unverifiableCount: 0 };
  }

  var nowMs = new Date().getTime();
  var revokedCount = 0;
  var unverifiableCount = 0;
  var changed = false;

  for (var i = 0; i < fileIds.length; i++) {
    var fid = fileIds[i];
    var entry = map[fid];
    if (!entry || !entry.revokeAfterMs || entry.revokeAfterMs <= nowMs) {
      var status = revokeFileSharingSafe(fid);
      if (status === 'REVOKED') {
        delete map[fid];
        revokedCount++;
        changed = true;
      } else if (status === 'UNVERIFIABLE') {
        delete map[fid];
        unverifiableCount++;
        changed = true;
      }
    }
  }

  if (changed) {
    writeTempSharedMap_(map);
  }
  return {
    revokedCount: revokedCount,
    unverifiableCount: unverifiableCount
  };
}

function readTempSharedMap_() {
  var raw = PropertiesService.getScriptProperties().getProperty(TEMP_SHARED_FILES_PROP_KEY);
  if (!raw) return {};
  try {
    var parsed = JSON.parse(raw);
    return (parsed && typeof parsed === 'object') ? parsed : {};
  } catch (e) {
    return {};
  }
}

function writeTempSharedMap_(map) {
  var props = PropertiesService.getScriptProperties();
  var keys = Object.keys(map || {});
  if (keys.length === 0) {
    props.deleteProperty(TEMP_SHARED_FILES_PROP_KEY);
  } else {
    props.setProperty(TEMP_SHARED_FILES_PROP_KEY, JSON.stringify(map));
  }
}

/**
 * Google Driveフォルダの閲覧用URLを返す
 * @param {string} folderId
 * @return {string}
 */
function getDriveFolderUrl(folderId) {
  return 'https://drive.google.com/drive/folders/' + encodeURIComponent(folderId);
}
