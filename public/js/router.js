/**
 * hakonushi - Hash Router & App Bootstrap (public/js/router.js)
 */

window.HakonushiRouter = (function () {
  var activeView = null;

  /**
   * URLフラグメント `#box=<GUID>` から boxId を抽出する
   * @return {string|null}
   */
  function getBoxIdFromHash() {
    var hash = window.location.hash || '';
    var match = hash.match(/^#box=([^&]+)/i);
    if (!match || !match[1]) return null;
    try {
      return decodeURIComponent(match[1]).trim();
    } catch (e) {
      return match[1].trim();
    }
  }

  /**
   * 表示ビューを切り替える
   * @param {'entry'|'owner'|'guest'} viewName
   */
  function showView(viewName) {
    activeView = viewName;
    var views = ['entry', 'owner', 'guest'];
    views.forEach(function (name) {
      var el = document.getElementById('view-' + name);
      if (el) {
        el.classList.toggle('hidden', name !== viewName);
      }
    });

    var headerUser = document.getElementById('header-user');
    if (headerUser) {
      var owner = window.HakonushiAuth.getCurrentOwner();
      headerUser.classList.toggle('hidden', viewName !== 'owner' || !owner);
      if (owner) {
        var emailEl = document.getElementById('header-user-email');
        if (emailEl) emailEl.textContent = owner.email;
      }
    }
  }

  /**
   * ゲスト画面へ遷移する（URLフラグメントを更新）
   * @param {string} boxId
   */
  function navigateToBox(boxId) {
    var trimmed = String(boxId || '').trim();
    if (!trimmed) return;
    window.location.hash = 'box=' + encodeURIComponent(trimmed);
  }

  /**
   * エントリ画面へ戻る
   */
  function navigateToEntry() {
    if (window.location.hash) {
      history.replaceState(null, '', window.location.pathname + window.location.search);
    }
    if (window.HakonushiAuth.getCurrentOwner()) {
      showView('owner');
      window.HakonushiOwner.loadBoxes();
    } else {
      showView('entry');
    }
  }

  /**
   * 現在のURLフラグメントと認証状態に応じてルーティングする
   */
  function resolveRoute() {
    var boxId = getBoxIdFromHash();
    if (boxId) {
      showView('guest');
      window.HakonushiGuest.openBox(boxId);
      return;
    }

    if (window.HakonushiAuth.getCurrentOwner()) {
      showView('owner');
      window.HakonushiOwner.loadBoxes();
    } else {
      showView('entry');
    }
  }

  function bindGlobalEvents() {
    // ブランドリンク
    var brandLink = document.getElementById('brand-link');
    if (brandLink) {
      brandLink.addEventListener('click', function (e) {
        e.preventDefault();
        navigateToEntry();
      });
    }

    // 箱主 Google ログイン
    var btnLogin = document.getElementById('btn-google-login');
    if (btnLogin) {
      btnLogin.addEventListener('click', async function () {
        try {
          await window.HakonushiAuth.signInWithGoogle(btnLogin);
          window.HakonushiApi.showToast('箱主としてログインしました。', 'success');
          showView('owner');
          await window.HakonushiOwner.loadBoxes();
        } catch (err) {
          if (err && err.code === 'auth/popup-closed-by-user') return;
          window.HakonushiApi.showToast(err.message || 'ログインに失敗しました。', 'error', 5500);
        }
      });
    }

    // ログアウト
    var btnLogout = document.getElementById('btn-logout');
    if (btnLogout) {
      btnLogout.addEventListener('click', async function () {
        await window.HakonushiAuth.signOut();
        window.HakonushiApi.showToast('ログアウトしました。', 'info');
        showView('entry');
      });
    }

    // エントリ画面からのゲストGUID手入力
    var formEntryGuest = document.getElementById('form-entry-guest');
    if (formEntryGuest) {
      formEntryGuest.addEventListener('submit', function (e) {
        e.preventDefault();
        var input = document.getElementById('input-entry-box-id');
        var raw = (input ? input.value : '').trim();
        if (!raw) return;

        // URL全体を貼り付けた場合でも #box=<GUID> を抽出する親切設計
        var match = raw.match(/#box=([^&\s]+)/i);
        var boxId = match ? decodeURIComponent(match[1]) : raw;
        if (input) input.value = '';
        navigateToBox(boxId);
      });
    }

    // 共通モーダル閉じるボタン
    document.querySelectorAll('[data-close-modal]').forEach(function (btn) {
      btn.addEventListener('click', function () {
        var modalId = btn.getAttribute('data-close-modal');
        var modal = document.getElementById(modalId);
        if (modal) modal.classList.add('hidden');
      });
    });

    // ハッシュ変更監視
    window.addEventListener('hashchange', function () {
      resolveRoute();
    });
  }

  function bootstrap() {
    window.HakonushiApi.initWakeLockToggles();
    bindGlobalEvents();
    window.HakonushiOwner.init();
    window.HakonushiGuest.init();

    // #box=<GUID> がある場合は認証待機せず即座にゲスト画面へ遷移
    var initialBoxId = getBoxIdFromHash();
    if (initialBoxId) {
      showView('guest');
      window.HakonushiGuest.openBox(initialBoxId);
      return;
    }

    // 既存のFirebaseログインセッションを復元
    var handledInitialAuth = false;
    window.HakonushiAuth.onAuthStateChanged(async function (firebaseUser) {
      if (handledInitialAuth) return;
      handledInitialAuth = true;

      if (firebaseUser) {
        try {
          var idToken = await firebaseUser.getIdToken(false);
          var data = await window.HakonushiApi.callGas(
            'verifyOwner',
            { idToken: idToken },
            { loadingText: 'セッションを確認中...' }
          );
          window.HakonushiAuth.setCurrentOwner(data.owner);
          resolveRoute();
          return;
        } catch (err) {
          await window.HakonushiAuth.signOut();
        }
      }
      resolveRoute();
    });
  }

  document.addEventListener('DOMContentLoaded', bootstrap);

  return {
    getBoxIdFromHash: getBoxIdFromHash,
    showView: showView,
    navigateToBox: navigateToBox,
    navigateToEntry: navigateToEntry,
    resolveRoute: resolveRoute
  };
})();
