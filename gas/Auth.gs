/**
 * hakonushi - Authentication & Crypto Helpers (gas/Auth.gs)
 */

/**
 * Firebase IDトークンを検証し、許可リストに含まれる箱主であることを確認する
 * @param {string} idToken
 * @return {{ email: string, displayName: string, uid: string }}
 */
function verifyOwnerToken(idToken) {
  if (!idToken || typeof idToken !== 'string') {
    throw createAppError('UNAUTHORIZED', '認証トークンが不足しています。再ログインしてください。');
  }

  var config = getConfig();
  var url = 'https://identitytoolkit.googleapis.com/v1/accounts:lookup?key=' +
    encodeURIComponent(config.firebaseApiKey);

  var res = UrlFetchApp.fetch(url, {
    method: 'post',
    contentType: 'application/json',
    payload: JSON.stringify({ idToken: idToken }),
    muteHttpExceptions: true
  });

  var statusCode = res.getResponseCode();
  var bodyText = res.getContentText();
  if (statusCode !== 200) {
    throw createAppError('UNAUTHORIZED', '認証トークンの検証に失敗しました。再ログインしてください。');
  }

  var parsed;
  try {
    parsed = JSON.parse(bodyText);
  } catch (e) {
    throw createAppError('UNAUTHORIZED', '認証レスポンスの解析に失敗しました。');
  }

  var users = parsed && parsed.users;
  if (!users || users.length === 0) {
    throw createAppError('UNAUTHORIZED', 'ユーザー情報が取得できませんでした。');
  }

  var user = users[0];
  if (user.disabled === true) {
    throw createAppError('FORBIDDEN', 'このアカウントは無効化されています。');
  }

  var providers = Array.isArray(user.providerUserInfo) ? user.providerUserInfo : [];
  var hasGoogleProvider = providers.some(function (p) {
    return p && p.providerId === 'google.com';
  });
  if (providers.length > 0 && !hasGoogleProvider) {
    throw createAppError('FORBIDDEN', 'Googleアカウントでログインしてください。');
  }

  var email = String(user.email || '').trim().toLowerCase();
  var isVerified = user.emailVerified === true || user.email_verified === true;

  if (!email || !isVerified) {
    throw createAppError('FORBIDDEN', 'メールアドレスが確認済みのGoogleアカウントでログインしてください。');
  }

  if (config.allowedEmails.indexOf(email) === -1) {
    throw createAppError('FORBIDDEN', 'このアカウントには箱主としての利用権限がありません。');
  }

  return {
    email: email,
    displayName: String(user.displayName || ''),
    uid: String(user.localId || '')
  };
}

/**
 * パスコード形式（空欄 または 6桁数字）を検証する
 * @param {string} passcode
 * @return {string} 正規化済みパスコード（未設定時は空文字）
 */
function normalizeAndValidatePasscode(passcode) {
  var raw = String(passcode === undefined || passcode === null ? '' : passcode).trim();
  if (raw === '') {
    return '';
  }
  if (!/^\d{6}$/.test(raw)) {
    throw createAppError('INVALID_ARGUMENT', 'パスコードは6桁の数字で入力してください。');
  }
  return raw;
}

/**
 * パスコード用ペッパー（秘密鍵）を取得する（未設定時は自動生成して保存）
 * @return {string}
 */
function getOrCreatePasscodePepper_() {
  var props = PropertiesService.getScriptProperties();
  var pepper = (props.getProperty('PASSCODE_PEPPER') || '').trim();
  if (pepper) {
    return pepper;
  }
  return withScriptLock(function () {
    var current = (props.getProperty('PASSCODE_PEPPER') || '').trim();
    if (current) {
      return current;
    }
    var generated = Utilities.getUuid() + '-' + Utilities.getUuid();
    props.setProperty('PASSCODE_PEPPER', generated);
    return generated;
  });
}

/**
 * バイト配列を小文字HEX文字列へ変換する
 * @param {number[]} bytes
 * @return {string}
 */
function bytesToHex_(bytes) {
  return bytes.map(function (b) {
    var unsigned = b < 0 ? b + 256 : b;
    return ('0' + unsigned.toString(16)).slice(-2);
  }).join('');
}

/**
 * 文字列のSHA-256ハッシュ（小文字HEX）を生成する（後方互換用）
 * @param {string} text
 * @return {string}
 */
function sha256Hex(text) {
  var bytes = Utilities.computeDigest(
    Utilities.DigestAlgorithm.SHA_256,
    String(text),
    Utilities.Charset.UTF_8
  );
  return bytesToHex_(bytes);
}

/**
 * boxId（ソルト）とペッパーを用いた HMAC-SHA256 でパスコードをハッシュ化する
 * @param {string} passcode
 * @param {string} boxId
 * @return {string} "v2:<hex>" 形式
 */
function hashPasscode(passcode, boxId) {
  var pepper = getOrCreatePasscodePepper_();
  var message = String(boxId || '') + ':' + String(passcode || '');
  var bytes = Utilities.computeHmacSha256Signature(
    message,
    pepper,
    Utilities.Charset.UTF_8
  );
  return 'v2:' + bytesToHex_(bytes);
}

/**
 * タイミング差を抑えた文字列比較
 * @param {string} a
 * @param {string} b
 * @return {boolean}
 */
function safeEqualString(a, b) {
  var strA = String(a || '');
  var strB = String(b || '');
  if (strA.length !== strB.length) {
    return false;
  }
  var diff = 0;
  for (var i = 0; i < strA.length; i++) {
    diff |= strA.charCodeAt(i) ^ strB.charCodeAt(i);
  }
  return diff === 0;
}

/**
 * パスコードをハッシュ値と照合する（v2 HMAC-SHA256 / 旧SHA-256 両対応）
 * @param {string} passcode
 * @param {string} expectedHash
 * @param {string=} boxId
 * @return {boolean}
 */
function verifyPasscodeHash(passcode, expectedHash, boxId) {
  if (!expectedHash) {
    return true;
  }
  var raw = String(passcode || '').trim();
  if (!raw) {
    return false;
  }
  var expected = String(expectedHash);
  if (expected.indexOf('v2:') === 0) {
    return safeEqualString(hashPasscode(raw, boxId), expected);
  }
  return safeEqualString(sha256Hex(raw), expected);
}

/**
 * GASエディタから実行できる簡易動作確認関数（設定・親フォルダ解決・ハッシュ検証）
 */
function testBackendSetup() {
  var config = getConfig();
  var rootFolder = getRootFolder();
  var hash = sha256Hex('123456');
  Logger.log('Allowed emails count: ' + config.allowedEmails.length);
  Logger.log('Root folder: ' + rootFolder.getName() + ' (' + rootFolder.getId() + ')');
  Logger.log('SHA-256("123456"): ' + hash);
  return {
    ok: true,
    rootFolderName: rootFolder.getName(),
    rootFolderId: rootFolder.getId(),
    allowedEmailsCount: config.allowedEmails.length
  };
}
