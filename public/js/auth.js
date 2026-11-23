/**
 * hakonushi - Firebase Authentication Helper (public/js/auth.js)
 */

window.HakonushiAuth = (function () {
  var initialized = false;
  var currentOwner = null;

  function init() {
    if (initialized) return true;

    var cfg = window.HAKONUSHI_CONFIG;
    if (window.__HAKONUSHI_CONFIG_MISSING__ || !cfg || !cfg.firebaseConfig || !cfg.firebaseConfig.apiKey) {
      var warn = document.getElementById('config-warning');
      if (warn) warn.classList.remove('hidden');
      return false;
    }

    if (!window.firebase) {
      return false;
    }

    if (!firebase.apps.length) {
      firebase.initializeApp(cfg.firebaseConfig);
    }
    initialized = true;
    return true;
  }

  /**
   * Googleアカウントでログインし、GAS側で許可リスト照合まで行う
   * @param {HTMLElement=} triggerButton
   * @return {Promise<{ email: string, displayName: string }>}
   */
  async function signInWithGoogle(triggerButton) {
    if (!init()) {
      throw new Error('Firebase設定が読み込まれていません。public/config.js を確認してください。');
    }

    var provider = new firebase.auth.GoogleAuthProvider();
    provider.setCustomParameters({ prompt: 'select_account' });

    if (triggerButton) triggerButton.disabled = true;
    try {
      var cred = await firebase.auth().signInWithPopup(provider);
      var idToken = await cred.user.getIdToken(true);

      var data = await window.HakonushiApi.callGas(
        'verifyOwner',
        { idToken: idToken },
        { loadingText: '箱主アカウントを確認中...' }
      );

      currentOwner = data.owner;
      return currentOwner;
    } catch (err) {
      // 許可リスト外などGAS側で拒否された場合はFirebase側もサインアウトする
      if (firebase.auth().currentUser) {
        await firebase.auth().signOut();
      }
      currentOwner = null;
      throw err;
    } finally {
      if (triggerButton) triggerButton.disabled = false;
    }
  }

  /**
   * 現在のログインユーザーの最新 Firebase ID トークンを取得する
   * @return {Promise<string>}
   */
  async function getIdToken() {
    if (!init()) {
      throw new Error('Firebase設定が読み込まれていません。');
    }
    var user = firebase.auth().currentUser;
    if (!user) {
      throw new Error('ログインセッションが切れています。再ログインしてください。');
    }
    return user.getIdToken(false);
  }

  /**
   * ログアウト
   */
  async function signOut() {
    currentOwner = null;
    if (initialized && window.firebase && firebase.auth().currentUser) {
      await firebase.auth().signOut();
    }
  }

  /**
   * 認証状態変更リスナーを登録する
   * @param {function(Object|null): void} callback
   */
  function onAuthStateChanged(callback) {
    if (!init()) {
      callback(null);
      return;
    }
    firebase.auth().onAuthStateChanged(callback);
  }

  function getCurrentOwner() {
    return currentOwner;
  }

  function setCurrentOwner(owner) {
    currentOwner = owner;
  }

  return {
    init: init,
    signInWithGoogle: signInWithGoogle,
    getIdToken: getIdToken,
    signOut: signOut,
    onAuthStateChanged: onAuthStateChanged,
    getCurrentOwner: getCurrentOwner,
    setCurrentOwner: setCurrentOwner
  };
})();
