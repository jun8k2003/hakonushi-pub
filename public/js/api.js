/**
 * hakonushi - API Client, Loading UI & Resumable Upload Handler (public/js/api.js)
 */

window.HakonushiApi = (function () {
  var loadingDepth = 0;
  var WAKE_LOCK_STORAGE_KEY = 'hakonushi_prevent_sleep';
  var wakeLockSentinel = null;
  var activeTransfers = 0;
  var wakeLockInitialized = false;

  function isWakeLockSupported() {
    return Boolean(navigator.wakeLock && typeof navigator.wakeLock.request === 'function');
  }

  function getPreventSleepEnabled() {
    if (!isWakeLockSupported()) return false;
    try {
      var saved = window.localStorage.getItem(WAKE_LOCK_STORAGE_KEY);
      if (saved === null) return true; // デフォルトON
      return saved === '1';
    } catch (e) {
      return true;
    }
  }

  function setPreventSleepEnabled(enabled) {
    try {
      window.localStorage.setItem(WAKE_LOCK_STORAGE_KEY, enabled ? '1' : '0');
    } catch (e) {
      // ignore storage errors
    }
    syncWakeLockToggleUI(enabled);
    if (enabled && activeTransfers > 0) {
      acquireWakeLock();
    } else if (!enabled) {
      releaseWakeLock();
    }
  }

  function syncWakeLockToggleUI(enabled) {
    var supported = isWakeLockSupported();
    document.querySelectorAll('[data-wakelock-toggle]').forEach(function (input) {
      input.disabled = !supported;
      input.checked = supported && Boolean(enabled);
    });
    if (!supported) {
      document.querySelectorAll('[data-wakelock-hint]').forEach(function (el) {
        el.textContent = 'このブラウザ（または接続環境）は画面ロック防止（Wake Lock API）に非対応です';
      });
    }
  }

  async function acquireWakeLock() {
    if (!isWakeLockSupported() || !getPreventSleepEnabled()) return;
    if (wakeLockSentinel && !wakeLockSentinel.released) return;
    if (document.visibilityState !== 'visible') return;
    try {
      wakeLockSentinel = await navigator.wakeLock.request('screen');
      wakeLockSentinel.addEventListener('release', function () {
        wakeLockSentinel = null;
      });
    } catch (e) {
      // バッテリー節約モード等で取得できない場合は転送自体は継続する
      wakeLockSentinel = null;
    }
  }

  async function releaseWakeLock() {
    if (!wakeLockSentinel) return;
    try {
      await wakeLockSentinel.release();
    } catch (e) {
      // ignore
    } finally {
      wakeLockSentinel = null;
    }
  }

  function initWakeLockToggles() {
    if (wakeLockInitialized) return;
    wakeLockInitialized = true;

    var initial = getPreventSleepEnabled();
    syncWakeLockToggleUI(initial);

    document.querySelectorAll('[data-wakelock-toggle]').forEach(function (input) {
      input.addEventListener('change', function () {
        setPreventSleepEnabled(input.checked);
      });
    });

    document.addEventListener('visibilitychange', function () {
      if (document.visibilityState === 'visible' && activeTransfers > 0 && getPreventSleepEnabled()) {
        acquireWakeLock();
      }
    });
  }

  function beginTransferWakeLock() {
    activeTransfers++;
    acquireWakeLock();
  }

  function endTransferWakeLock() {
    activeTransfers = Math.max(0, activeTransfers - 1);
    if (activeTransfers === 0) {
      releaseWakeLock();
    }
  }

  function getGasUrl() {
    var cfg = window.HAKONUSHI_CONFIG;
    if (!cfg || !cfg.gasApiUrl) {
      throw new Error('public/config.js の gasApiUrl が設定されていません。');
    }
    return cfg.gasApiUrl;
  }

  /**
   * 共通ローディングリングの表示
   * @param {string=} message
   */
  function showLoading(message) {
    loadingDepth++;
    var overlay = document.getElementById('loading-overlay');
    var textEl = document.getElementById('loading-text');
    if (textEl && message) {
      textEl.textContent = message;
    }
    if (overlay) {
      overlay.classList.remove('hidden');
    }
  }

  /**
   * 共通ローディングリングの非表示
   */
  function hideLoading() {
    loadingDepth = Math.max(0, loadingDepth - 1);
    if (loadingDepth === 0) {
      var overlay = document.getElementById('loading-overlay');
      if (overlay) {
        overlay.classList.add('hidden');
      }
    }
  }

  /**
   * トースト通知を表示する
   * @param {string} message
   * @param {'info'|'success'|'error'=} type
   * @param {number=} durationMs
   */
  function showToast(message, type, durationMs) {
    var container = document.getElementById('toast-container');
    if (!container) return;

    var el = document.createElement('div');
    el.className = 'toast' + (type ? ' toast-' + type : '');
    el.textContent = message;
    container.appendChild(el);

    setTimeout(function () {
      if (el.parentNode) {
        el.parentNode.removeChild(el);
      }
    }, durationMs || 4000);
  }

  /**
   * GAS doPost API を呼び出す（CORSプリフライト回避のため Content-Type: text/plain で送信）
   * @param {string} action
   * @param {Object=} params
   * @param {{ loadingText?: string, silent?: boolean, triggerButton?: HTMLElement }=} options
   * @return {Promise<Object>}
   */
  async function callGas(action, params, options) {
    var opts = options || {};
    var bodyObj = Object.assign({}, params || {}, { action: action });

    if (opts.triggerButton) {
      opts.triggerButton.disabled = true;
    }
    if (!opts.silent) {
      showLoading(opts.loadingText || '通信中です...');
    }

    try {
      var res = await fetch(getGasUrl(), {
        method: 'POST',
        headers: {
          'Content-Type': 'text/plain;charset=utf-8'
        },
        body: JSON.stringify(bodyObj)
      });

      var text = await res.text();
      var json;
      try {
        json = JSON.parse(text);
      } catch (e) {
        throw new Error('サーバーからの応答を解析できませんでした。GASのデプロイ設定を確認してください。');
      }

      if (!json || json.ok !== true) {
        var errMsg = (json && json.error && json.error.message) || 'APIエラーが発生しました。';
        var err = new Error(errMsg);
        err.code = (json && json.error && json.error.code) || 'API_ERROR';
        err.details = (json && json.error && json.error.details) || null;
        throw err;
      }

      return json.data;
    } finally {
      if (!opts.silent) {
        hideLoading();
      }
      if (opts.triggerButton) {
        opts.triggerButton.disabled = false;
      }
    }
  }

  // Drive Resumable Upload チャンクサイズ（256KB の倍数である必要あり: 16MB）
  var UPLOAD_CHUNK_SIZE = 16 * 1024 * 1024;
  var MAX_CHUNK_RETRIES = 5;

  function sleepMs(ms) {
    return new Promise(function (resolve) { setTimeout(resolve, ms); });
  }

  function parseRangeHeaderLastByte(rangeHeader) {
    if (!rangeHeader) return null;
    var match = String(rangeHeader).match(/bytes=\d+-(\d+)/i);
    if (!match) return null;
    var lastByte = Number(match[1]);
    return isNaN(lastByte) ? null : lastByte;
  }

  function sendChunkPut(uploadUrl, chunk, contentType, contentRange, onChunkProgress) {
    return new Promise(function (resolve, reject) {
      var xhr = new XMLHttpRequest();
      xhr.open('PUT', uploadUrl, true);
      if (contentType) {
        xhr.setRequestHeader('Content-Type', contentType);
      }
      if (contentRange) {
        xhr.setRequestHeader('Content-Range', contentRange);
      }

      xhr.upload.onprogress = function (evt) {
        if (evt.lengthComputable && typeof onChunkProgress === 'function') {
          onChunkProgress(evt.loaded);
        }
      };

      xhr.onload = function () {
        var rangeHeader = null;
        try {
          rangeHeader = xhr.getResponseHeader('Range');
        } catch (e) {
          rangeHeader = null;
        }
        resolve({
          status: xhr.status,
          responseText: xhr.responseText,
          rangeHeader: rangeHeader
        });
      };

      xhr.onerror = function () {
        reject({ transient: true, message: 'アップロード中にネットワークエラーが発生しました。' });
      };

      xhr.onabort = function () {
        reject(new Error('アップロードが中断されました。'));
      };

      xhr.send(chunk);
    });
  }

  function isTransientHttpStatus(status) {
    return status === 0 || status === 408 || status === 429 || (status >= 500 && status < 600);
  }

  /**
   * Drive API v3 Resumable Upload URI へブラウザから直接 PUT し、進捗率(%)をコールバックする
   * 16MB チャンク分割送信＋一時エラー時の自動リトライに対応（最大15GBクラスの大容量動画に対応）
   *
   * @param {string} uploadUrl
   * @param {File} file
   * @param {function(number): void} onProgress 0〜100
   * @return {Promise<{ id: string, name?: string, size?: string, mimeType?: string }>}
   */
  async function uploadFileDirectPut(uploadUrl, file, onProgress) {
    var totalSize = file.size;
    var contentType = file.type || 'application/octet-stream';

    // 0バイトの空ファイルは単発PUTで送信
    if (totalSize === 0) {
      var emptyRes = await sendChunkPut(uploadUrl, file, contentType, null, null);
      if (emptyRes.status >= 200 && emptyRes.status < 300) {
        if (typeof onProgress === 'function') onProgress(100);
        var emptyParsed = JSON.parse(emptyRes.responseText);
        if (!emptyParsed || !emptyParsed.id) {
          throw new Error('アップロード結果の取得に失敗しました。');
        }
        return emptyParsed;
      }
      throw new Error('ファイルのアップロードに失敗しました（HTTP ' + emptyRes.status + '）。');
    }

    var offset = 0;
    var retryCount = 0;

    while (offset < totalSize) {
      var end = Math.min(offset + UPLOAD_CHUNK_SIZE, totalSize);
      var chunk = file.slice(offset, end);
      var contentRange = 'bytes ' + offset + '-' + (end - 1) + '/' + totalSize;

      try {
        var res = await sendChunkPut(uploadUrl, chunk, contentType, contentRange, function (loadedInChunk) {
          if (typeof onProgress === 'function') {
            var pct = Math.min(100, Math.round(((offset + loadedInChunk) / totalSize) * 100));
            onProgress(pct);
          }
        });

        // 完了（200 / 201）
        if (res.status >= 200 && res.status < 300) {
          if (typeof onProgress === 'function') onProgress(100);
          var parsed;
          try {
            parsed = JSON.parse(res.responseText);
          } catch (e) {
            throw new Error('アップロード応答の解析に失敗しました。');
          }
          if (!parsed || !parsed.id) {
            throw new Error('アップロード結果の取得に失敗しました。');
          }
          return parsed;
        }

        // チャンク受信完了・継続（308 Resume Incomplete）
        if (res.status === 308) {
          var lastByte = parseRangeHeaderLastByte(res.rangeHeader);
          offset = (lastByte !== null && lastByte + 1 > offset) ? (lastByte + 1) : end;
          retryCount = 0;
          if (typeof onProgress === 'function') {
            onProgress(Math.min(99, Math.round((offset / totalSize) * 100)));
          }
          continue;
        }

        // 一時エラーは指数バックオフでリトライ
        if (isTransientHttpStatus(res.status) && retryCount < MAX_CHUNK_RETRIES) {
          retryCount++;
          await sleepMs(Math.pow(2, retryCount) * 1000);
          // サーバー側の受信済みオフセットを照会して途中再開を試みる
          try {
            var probe = await sendChunkPut(uploadUrl, null, null, 'bytes */' + totalSize, null);
            if (probe.status >= 200 && probe.status < 300) {
              if (typeof onProgress === 'function') onProgress(100);
              return JSON.parse(probe.responseText);
            }
            if (probe.status === 308) {
              var probedLast = parseRangeHeaderLastByte(probe.rangeHeader);
              if (probedLast !== null) {
                offset = probedLast + 1;
              }
            }
          } catch (probeErr) {
            // 照会失敗時は現在オフセットから再送
          }
          continue;
        }

        throw new Error('ファイルのアップロードに失敗しました（HTTP ' + res.status + '）。');
      } catch (err) {
        if (err && err.transient && retryCount < MAX_CHUNK_RETRIES) {
          retryCount++;
          await sleepMs(Math.pow(2, retryCount) * 1000);
          continue;
        }
        throw new Error((err && err.message) || 'ファイルのアップロードに失敗しました。');
      }
    }

    throw new Error('ファイルのアップロードが完了しませんでした。');
  }

  /**
   * ブラウザ標準ダウンロードを開始する
   * @param {string} downloadUrl
   * @param {string} fileName
   */
  function triggerBrowserDownload(downloadUrl, fileName) {
    var link = document.createElement('a');
    link.href = downloadUrl;
    link.target = '_blank';
    link.rel = 'noopener noreferrer';
    if (fileName) {
      link.download = fileName;
    }
    document.body.appendChild(link);
    link.click();
    document.body.removeChild(link);

    showToast('ダウンロードを開始しました。ブラウザのダウンロード欄をご確認ください。', 'success', 5000);
  }

  /**
   * バイト数を読みやすい単位に整形する
   * @param {number} bytes
   * @return {string}
   */
  function formatFileSize(bytes) {
    var size = Number(bytes || 0);
    if (size < 1024) return size + ' B';
    if (size < 1024 * 1024) return (size / 1024).toFixed(1) + ' KB';
    if (size < 1024 * 1024 * 1024) return (size / (1024 * 1024)).toFixed(1) + ' MB';
    return (size / (1024 * 1024 * 1024)).toFixed(2) + ' GB';
  }

  /**
   * ISO日時をローカル日時文字列に整形する
   * @param {string} iso
   * @return {string}
   */
  function formatDateTime(iso) {
    if (!iso) return '-';
    var d = new Date(iso);
    if (isNaN(d.getTime())) return iso;
    var pad = function (n) { return ('0' + n).slice(-2); };
    return d.getFullYear() + '/' + pad(d.getMonth() + 1) + '/' + pad(d.getDate()) +
      ' ' + pad(d.getHours()) + ':' + pad(d.getMinutes());
  }

  /**
   * HTMLエスケープ
   * @param {string} str
   * @return {string}
   */
  function escapeHtml(str) {
    return String(str === undefined || str === null ? '' : str)
      .replace(/&/g, '&amp;')
      .replace(/</g, '&lt;')
      .replace(/>/g, '&gt;')
      .replace(/"/g, '&quot;')
      .replace(/'/g, '&#39;');
  }

  /**
   * QRコードをローカル生成して描画し、タップ/クリックでPNG画像を保存できるようにする
   * @param {HTMLElement} container
   * @param {string} targetUrl
   * @param {string=} fileLabel ファイル名用の箱名など
   */
  function renderClickableQrCode(container, targetUrl, fileLabel) {
    if (!container) return;
    container.innerHTML = '';
    container.classList.remove('qr-clickable');
    container.onclick = null;
    container.onkeydown = null;
    container.removeAttribute('role');
    container.removeAttribute('tabindex');
    container.removeAttribute('title');

    if (typeof window.qrcode !== 'function') {
      container.textContent = 'QRコードを表示できませんでした。URLコピーをご利用ください。';
      return;
    }

    var qr = window.qrcode(0, 'M');
    qr.addData(targetUrl);
    qr.make();
    container.innerHTML =
      qr.createSvgTag({ scalable: true, margin: 2 }) +
      '<span class="qr-tap-hint">タップしてQR画像を保存</span>';

    var downloadPng = function () {
      var moduleCount = qr.getModuleCount();
      var marginModules = 4;
      var totalModules = moduleCount + marginModules * 2;
      var cellSize = Math.max(8, Math.floor(400 / totalModules));
      var size = totalModules * cellSize;

      var canvas = document.createElement('canvas');
      canvas.width = size;
      canvas.height = size;
      var ctx = canvas.getContext('2d');
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, size, size);
      ctx.fillStyle = '#000000';
      for (var r = 0; r < moduleCount; r++) {
        for (var c = 0; c < moduleCount; c++) {
          if (qr.isDark(r, c)) {
            ctx.fillRect((c + marginModules) * cellSize, (r + marginModules) * cellSize, cellSize, cellSize);
          }
        }
      }

      var safeName = String(fileLabel || 'box')
        .replace(/[\\/:*?"<>|\s]+/g, '_')
        .slice(0, 40) || 'box';
      var dataUrl = canvas.toDataURL('image/png');
      var a = document.createElement('a');
      a.href = dataUrl;
      a.download = 'hakonushi-qr-' + safeName + '.png';
      document.body.appendChild(a);
      a.click();
      document.body.removeChild(a);

      showToast('QRコード画像を保存しました。', 'success');
    };

    container.classList.add('qr-clickable');
    container.setAttribute('role', 'button');
    container.setAttribute('tabindex', '0');
    container.setAttribute('title', 'タップしてQRコード画像を保存');
    container.onclick = downloadPng;
    container.onkeydown = function (e) {
      if (e.key === 'Enter' || e.key === ' ') {
        e.preventDefault();
        downloadPng();
      }
    };
  }

  var DROPZONE_FILE_SVG =
    '<svg width="44" height="44" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8l-6-6z"/>' +
      '<path d="M14 2v6h6" fill="none" stroke="#ffffff" stroke-width="1.5"/>' +
    '</svg>';

  var DROPZONE_FOLDER_SVG =
    '<svg width="60" height="60" viewBox="0 0 24 24" fill="currentColor">' +
      '<path d="M10 4H4a2 2 0 0 0-2 2v12a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2V8a2 2 0 0 0-2-2h-8l-2-2z"/>' +
    '</svg>';

  /**
   * 選択中ファイル数に応じてドロップエリアの視覚状態（半透明化＋左寄せ背景アイコン＋件数バッジ）を更新する
   * @param {HTMLElement} dropzoneEl
   * @param {number} count
   * @param {string} defaultSubText
   */
  function updateDropzoneVisual(dropzoneEl, count, defaultSubText) {
    if (!dropzoneEl) return;
    var bgEl = dropzoneEl.querySelector('.dropzone-bg-icons');
    var badgeEl = dropzoneEl.querySelector('.dropzone-count-badge');
    var titleEl = dropzoneEl.querySelector('.dropzone-title');
    var subEl = dropzoneEl.querySelector('.dropzone-sub');

    if (bgEl) bgEl.innerHTML = '';

    if (!count || count <= 0) {
      dropzoneEl.classList.remove('has-files');
      if (badgeEl) badgeEl.classList.add('hidden');
      if (titleEl) titleEl.textContent = 'クリックしてファイルを選択、またはここにドロップ';
      if (subEl && defaultSubText) subEl.textContent = defaultSubText;
      return;
    }

    dropzoneEl.classList.add('has-files');
    if (badgeEl) {
      badgeEl.textContent = '✓ ' + count + ' 件のファイルを選択中';
      badgeEl.classList.remove('hidden');
    }
    if (titleEl) titleEl.textContent = 'クリックまたはドロップでさらに追加できます';
    if (subEl) subEl.textContent = '下のリストから不要なファイルを個別に取り消せます';

    if (bgEl) {
      if (count <= 5) {
        for (var i = 0; i < count; i++) {
          var w = document.createElement('span');
          w.innerHTML = DROPZONE_FILE_SVG;
          bgEl.appendChild(w);
        }
      } else {
        var fw = document.createElement('span');
        fw.innerHTML = DROPZONE_FOLDER_SVG;
        bgEl.appendChild(fw);
        for (var j = 0; j < 2; j++) {
          var sw = document.createElement('span');
          sw.style.opacity = '0.75';
          sw.innerHTML = DROPZONE_FILE_SVG;
          bgEl.appendChild(sw);
        }
      }
    }
  }

  return {
    showLoading: showLoading,
    hideLoading: hideLoading,
    showToast: showToast,
    callGas: callGas,
    uploadFileDirectPut: uploadFileDirectPut,
    triggerBrowserDownload: triggerBrowserDownload,
    renderClickableQrCode: renderClickableQrCode,
    updateDropzoneVisual: updateDropzoneVisual,
    formatFileSize: formatFileSize,
    formatDateTime: formatDateTime,
    escapeHtml: escapeHtml,
    initWakeLockToggles: initWakeLockToggles,
    beginTransferWakeLock: beginTransferWakeLock,
    endTransferWakeLock: endTransferWakeLock
  };
})();
