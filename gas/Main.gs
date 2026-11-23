/**
 * hakonushi - GAS Web App Entrypoint & Router (gas/Main.gs)
 */

/**
 * 疎通確認用エンドポイント
 */
function doGet() {
  return buildJsonResponse_({
    ok: true,
    service: 'hakonushi',
    timestamp: new Date().toISOString()
  });
}

/**
 * JSON API エンドポイント
 * CORSプリフライト回避のため、フロントエンドから Content-Type: text/plain で送信された
 * JSON文字列をパースして action ごとにルーティングする。
 *
 * @param {GoogleAppsScript.Events.DoPost} e
 */
function doPost(e) {
  try {
    var rawBody = e && e.postData && e.postData.contents ? e.postData.contents : '';
    if (!rawBody) {
      throw createAppError('BAD_REQUEST', 'リクエストボディが空です。');
    }

    var payload;
    try {
      payload = JSON.parse(rawBody);
    } catch (parseErr) {
      throw createAppError('BAD_REQUEST', 'JSONの形式が正しくありません。');
    }

    if (!payload || typeof payload !== 'object') {
      throw createAppError('BAD_REQUEST', 'リクエスト形式が不正です。');
    }

    var action = String(payload.action || '').trim();
    if (!action) {
      throw createAppError('BAD_REQUEST', 'action が指定されていません。');
    }

    var data = routeAction_(action, payload);
    return buildJsonResponse_({
      ok: true,
      data: data
    });
  } catch (err) {
    Logger.log('API Error: ' + (err && err.stack ? err.stack : err));
    var code = (err && err.appCode) ? err.appCode : 'INTERNAL_ERROR';
    var message = (err && err.message) ? err.message : '予期しないエラーが発生しました。';
    var errorObj = {
      code: code,
      message: message
    };
    if (err && err.details) {
      errorObj.details = err.details;
    }
    return buildJsonResponse_({
      ok: false,
      error: errorObj
    });
  }
}

/**
 * action ごとのルーティング
 * @param {string} action
 * @param {Object} payload
 * @return {Object}
 */
function routeAction_(action, payload) {
  // 箱主向けAPI（Firebase IDトークン＋許可メールリスト照合が必須）
  var ownerActions = {
    verifyOwner: function (owner) {
      return { owner: owner };
    },
    listBoxes: handleListBoxes,
    createBox: handleCreateBox,
    extendBox: handleExtendBox,
    disableBox: handleDisableBox,
    deleteBox: handleDeleteBox,
    initUploadSession: handleInitUploadSession,
    completeUpload: handleCompleteUpload,
    getOwnerDownloadUrl: handleGetOwnerDownloadUrl
  };

  if (ownerActions[action]) {
    var owner = verifyOwnerToken(payload.idToken);
    return ownerActions[action](owner, payload);
  }

  // ゲスト向けAPI（ログイン不要）
  var guestActions = {
    verifyBox: handleVerifyBox,
    getGuestDownloadUrl: handleGetGuestDownloadUrl,
    initGuestUploadSession: handleInitGuestUploadSession,
    completeGuestUpload: handleCompleteGuestUpload,
    deleteGuestFile: handleDeleteGuestFile
  };

  if (guestActions[action]) {
    return guestActions[action](payload);
  }

  throw createAppError('UNKNOWN_ACTION', '未対応のアクションです: ' + action);
}

/**
 * JSONレスポンスを生成する
 * @param {Object} obj
 * @return {GoogleAppsScript.Content.TextOutput}
 */
function buildJsonResponse_(obj) {
  return ContentService
    .createTextOutput(JSON.stringify(obj))
    .setMimeType(ContentService.MimeType.JSON);
}
