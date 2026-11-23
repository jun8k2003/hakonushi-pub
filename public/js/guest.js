/**
 * hakonushi - Guest Box View (public/js/guest.js)
 */

window.HakonushiGuest = (function () {
  var currentBoxId = '';
  var currentPasscode = '';
  var currentBox = null;
  var selectedFiles = [];
  var isUploading = false;

  function init() {
    var formPasscode = document.getElementById('form-guest-passcode');
    var formUpload = document.getElementById('form-guest-upload');
    var btnBack = document.getElementById('btn-guest-back-entry');
    var btnRefresh = document.getElementById('btn-guest-refresh');
    var btnCopyUrl = document.getElementById('btn-guest-copy-url');

    if (formPasscode) {
      formPasscode.addEventListener('submit', handlePasscodeSubmit);
    }
    if (formUpload) {
      formUpload.addEventListener('submit', handleGuestUploadSubmit);
    }
    if (btnBack) {
      btnBack.addEventListener('click', function () {
        window.HakonushiRouter.navigateToEntry();
      });
    }
    if (btnRefresh) {
      btnRefresh.addEventListener('click', function () {
        if (currentBoxId) {
          verifyAndRender(currentBoxId, currentPasscode, btnRefresh);
        }
      });
    }
    if (btnCopyUrl) {
      btnCopyUrl.addEventListener('click', handleCopyCurrentBoxUrl);
    }

    setupDropzone();
  }

  function setupDropzone() {
    var dropzone = document.getElementById('guest-dropzone');
    var fileInput = document.getElementById('input-guest-files');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', function () {
      if (!isUploading) fileInput.click();
    });
    dropzone.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && !isUploading) {
        e.preventDefault();
        fileInput.click();
      }
    });
    fileInput.addEventListener('change', function () {
      addSelectedFiles(fileInput.files);
      fileInput.value = '';
    });

    dropzone.addEventListener('dragover', function (e) {
      e.preventDefault();
      dropzone.classList.add('drag-over');
    });
    dropzone.addEventListener('dragleave', function () {
      dropzone.classList.remove('drag-over');
    });
    dropzone.addEventListener('drop', function (e) {
      e.preventDefault();
      dropzone.classList.remove('drag-over');
      if (!isUploading && e.dataTransfer && e.dataTransfer.files) {
        addSelectedFiles(e.dataTransfer.files);
      }
    });
  }

  function addSelectedFiles(fileList) {
    if (!fileList || !fileList.length) return;
    for (var i = 0; i < fileList.length; i++) {
      selectedFiles.push(fileList[i]);
    }
    renderSelectedFiles();
  }

  function renderSelectedFiles() {
    var ul = document.getElementById('guest-selected-files');
    var submitBtn = document.getElementById('btn-guest-upload-submit');
    if (!ul) return;

    ul.innerHTML = '';
    selectedFiles.forEach(function (file, idx) {
      var li = document.createElement('li');
      li.className = 'selected-file-item';
      li.innerHTML =
        '<span class="selected-file-name">' +
        window.HakonushiApi.escapeHtml(file.name) +
        ' <span class="muted text-xs">(' + window.HakonushiApi.formatFileSize(file.size) + ')</span>' +
        '</span>' +
        '<button type="button" class="btn-icon" aria-label="削除">✕</button>';

      li.querySelector('button').addEventListener('click', function () {
        if (isUploading) return;
        selectedFiles.splice(idx, 1);
        renderSelectedFiles();
      });
      ul.appendChild(li);
    });

    if (submitBtn) {
      submitBtn.disabled = isUploading || selectedFiles.length === 0;
    }
  }

  function hideAllPanels() {
    ['guest-passcode-panel', 'guest-error-panel', 'guest-box-panel'].forEach(function (id) {
      var el = document.getElementById(id);
      if (el) el.classList.add('hidden');
    });
  }

  function showErrorPanel(title, message) {
    hideAllPanels();
    var panel = document.getElementById('guest-error-panel');
    var titleEl = document.getElementById('guest-error-title');
    var msgEl = document.getElementById('guest-error-message');
    if (titleEl) titleEl.textContent = title || 'この箱は開けません';
    if (msgEl) msgEl.textContent = message || 'URLまたは有効期限をご確認ください。';
    if (panel) panel.classList.remove('hidden');
  }

  function openBox(boxId) {
    currentBoxId = String(boxId || '').trim();
    currentPasscode = '';
    currentBox = null;
    selectedFiles = [];
    renderSelectedFiles();

    var passcodeInput = document.getElementById('input-guest-passcode');
    var passcodeErr = document.getElementById('guest-passcode-error');
    if (passcodeInput) passcodeInput.value = '';
    if (passcodeErr) {
      passcodeErr.textContent = '';
      passcodeErr.classList.add('hidden');
    }

    verifyAndRender(currentBoxId, '');
  }

  async function verifyAndRender(boxId, passcode, triggerButton) {
    try {
      var data = await window.HakonushiApi.callGas(
        'verifyBox',
        { boxId: boxId, passcode: passcode || '' },
        { loadingText: '箱を確認中...', triggerButton: triggerButton }
      );

      if (data.requiresPasscode) {
        hideAllPanels();
        var panel = document.getElementById('guest-passcode-panel');
        if (panel) panel.classList.remove('hidden');
        var input = document.getElementById('input-guest-passcode');
        if (input) input.focus();
        return;
      }

      currentPasscode = passcode || '';
      currentBox = data.box;
      renderBoxContent(data.box, data.files || []);
    } catch (err) {
      if (err && err.code === 'INVALID_PASSCODE') {
        var passcodeErr = document.getElementById('guest-passcode-error');
        if (passcodeErr) {
          passcodeErr.textContent = err.message;
          passcodeErr.classList.remove('hidden');
        }
        return;
      }

      var titleMap = {
        BOX_NOT_FOUND: '箱が見つかりません',
        BOX_DISABLED: '共有が終了しています',
        BOX_EXPIRED: '有効期限が切れています',
        BOX_LOCKED: 'この箱はロックされています'
      };
      showErrorPanel(titleMap[err && err.code] || 'この箱は開けません', err && err.message);
    }
  }

  async function handlePasscodeSubmit(e) {
    e.preventDefault();
    var input = document.getElementById('input-guest-passcode');
    var errEl = document.getElementById('guest-passcode-error');
    var passcode = (input ? input.value : '').trim();

    if (!/^\d{6}$/.test(passcode)) {
      if (errEl) {
        errEl.textContent = '6桁の数字で入力してください。';
        errEl.classList.remove('hidden');
      }
      return;
    }

    if (errEl) errEl.classList.add('hidden');
    var submitBtn = e.target.querySelector('button[type="submit"]');
    await verifyAndRender(currentBoxId, passcode, submitBtn);
  }

  function renderBoxContent(box, files) {
    hideAllPanels();
    var panel = document.getElementById('guest-box-panel');
    var badgeEl = document.getElementById('guest-box-direction-badge');
    var expiresEl = document.getElementById('guest-box-expires');
    var nameEl = document.getElementById('guest-box-name');
    var subtitleEl = document.getElementById('guest-box-subtitle');
    var sendSection = document.getElementById('guest-send-section');
    var receiveSection = document.getElementById('guest-receive-section');

    if (nameEl) nameEl.textContent = box.box_name || box.box_id;
    if (expiresEl) expiresEl.textContent = '有効期限: ' + window.HakonushiApi.formatDateTime(box.expires_at);

    if (box.direction === 'SEND') {
      if (badgeEl) {
        badgeEl.className = 'pill pill-send';
        badgeEl.textContent = '箱主→ゲスト（ダウンロード）';
      }
      if (subtitleEl) subtitleEl.textContent = '箱主から届いたファイルをダウンロードできます。';
      sendSection.classList.remove('hidden');
      receiveSection.classList.add('hidden');
      renderSendFiles(files);
      renderGuestQrCode(box.box_id);
    } else {
      if (badgeEl) {
        badgeEl.className = 'pill pill-receive';
        badgeEl.textContent = '箱主←ゲスト（ファイル送信）';
      }
      if (subtitleEl) subtitleEl.textContent = '有効期限内であれば、箱主へファイルを複数回追加して送ることができます。';
      sendSection.classList.add('hidden');
      receiveSection.classList.remove('hidden');
      renderReceiveFiles(files);
    }

    if (panel) panel.classList.remove('hidden');
  }

  function buildCurrentBoxShareUrl(boxId) {
    return window.location.origin + window.location.pathname + '#box=' + encodeURIComponent(boxId);
  }

  function renderGuestQrCode(boxId) {
    var qrContainer = document.getElementById('guest-send-qr-container');
    if (!qrContainer) return;
    qrContainer.innerHTML = '';

    var shareUrl = buildCurrentBoxShareUrl(boxId);
    if (typeof window.qrcode === 'function') {
      var qr = window.qrcode(0, 'M');
      qr.addData(shareUrl);
      qr.make();
      qrContainer.innerHTML = qr.createSvgTag({ scalable: true, margin: 2 });
    } else {
      qrContainer.textContent = 'QRコードを表示できませんでした。URLコピーをご利用ください。';
    }
  }

  async function handleCopyCurrentBoxUrl() {
    if (!currentBoxId) return;
    var url = buildCurrentBoxShareUrl(currentBoxId);
    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(url);
      } else {
        var tmp = document.createElement('input');
        tmp.value = url;
        document.body.appendChild(tmp);
        tmp.select();
        document.execCommand('copy');
        document.body.removeChild(tmp);
      }
      window.HakonushiApi.showToast('この箱のURLをコピーしました。', 'success');
    } catch (e) {
      window.HakonushiApi.showToast('URLのコピーに失敗しました。', 'error');
    }
  }

  function renderSendFiles(files) {
    var api = window.HakonushiApi;
    var container = document.getElementById('guest-send-files');
    if (!container) return;
    container.innerHTML = '';

    if (files.length === 0) {
      container.innerHTML = '<p class="muted text-sm">この箱にはファイルが入っていません。</p>';
      return;
    }

    files.forEach(function (file) {
      var row = document.createElement('div');
      row.className = 'file-row';
      row.innerHTML =
        '<div class="file-info">' +
          '<div class="file-name">' + api.escapeHtml(file.file_name) + '</div>' +
          '<div class="file-meta">' + api.formatFileSize(file.file_size) + '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-primary btn-sm">ダウンロード</button>';

      var dlBtn = row.querySelector('button');
      dlBtn.addEventListener('click', function () {
        handleGuestDownload(file.file_id, dlBtn);
      });
      container.appendChild(row);
    });
  }

  async function handleGuestDownload(fileId, triggerButton) {
    try {
      var data = await window.HakonushiApi.callGas(
        'getGuestDownloadUrl',
        {
          boxId: currentBoxId,
          passcode: currentPasscode,
          fileId: fileId
        },
        { loadingText: 'ダウンロードを準備中...', triggerButton: triggerButton }
      );
      window.HakonushiApi.triggerBrowserDownload(data.downloadUrl, data.fileName);
    } catch (err) {
      window.HakonushiApi.showToast(err.message || 'ダウンロードに失敗しました。', 'error', 5000);
    }
  }

  function renderReceiveFiles(files) {
    var api = window.HakonushiApi;
    var container = document.getElementById('guest-receive-files');
    if (!container) return;
    container.innerHTML = '';

    if (files.length === 0) {
      container.innerHTML = '<p class="muted text-sm">まだファイルは送信されていません。</p>';
      return;
    }

    files.forEach(function (file) {
      var row = document.createElement('div');
      row.className = 'file-row';

      var metaParts = [
        api.formatFileSize(file.file_size),
        api.formatDateTime(file.uploaded_at)
      ];
      if (file.uploader_name) {
        metaParts.unshift('投稿者: ' + file.uploader_name);
      }

      // RECEIVE箱のゲスト一覧は閲覧・取消のみ可能（ダウンロード不可）
      row.innerHTML =
        '<div class="file-info">' +
          '<div class="file-name">' + api.escapeHtml(file.file_name) + '</div>' +
          '<div class="file-meta">' + api.escapeHtml(metaParts.join(' ・ ')) + '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-danger-ghost btn-sm">取り消す</button>';

      var delBtn = row.querySelector('button');
      delBtn.addEventListener('click', function () {
        handleGuestDeleteFile(file, delBtn);
      });
      container.appendChild(row);
    });
  }

  async function handleGuestUploadSubmit(e) {
    e.preventDefault();
    if (isUploading || selectedFiles.length === 0) return;

    var uploaderName = (document.getElementById('input-guest-uploader').value || '').trim();
    var submitBtn = document.getElementById('btn-guest-upload-submit');
    var panel = document.getElementById('guest-upload-progress');
    var statusText = document.getElementById('guest-upload-status-text');
    var countText = document.getElementById('guest-upload-count-text');
    var bar = document.getElementById('guest-upload-bar');
    var fileText = document.getElementById('guest-upload-file-text');

    isUploading = true;
    submitBtn.disabled = true;
    panel.classList.remove('hidden');
    window.HakonushiApi.beginTransferWakeLock();

    try {
      for (var i = 0; i < selectedFiles.length; i++) {
        var file = selectedFiles[i];
        var currentNum = i + 1;
        countText.textContent = currentNum + ' / ' + selectedFiles.length;
        statusText.textContent = 'セッション準備中...';
        fileText.textContent = file.name + ' (' + window.HakonushiApi.formatFileSize(file.size) + ')';
        bar.style.width = '0%';

        var session = await window.HakonushiApi.callGas(
          'initGuestUploadSession',
          {
            boxId: currentBoxId,
            passcode: currentPasscode,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            fileSize: file.size,
            origin: window.location.origin
          },
          { silent: true }
        );

        var uploaded = await window.HakonushiApi.uploadFileDirectPut(
          session.uploadUrl,
          file,
          function (pct) {
            statusText.textContent = 'アップロード中... ' + pct + '%';
            bar.style.width = pct + '%';
          }
        );

        statusText.textContent = '登録を確定中...';
        await window.HakonushiApi.callGas(
          'completeGuestUpload',
          {
            boxId: currentBoxId,
            passcode: currentPasscode,
            fileId: uploaded.id,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream',
            uploaderName: uploaderName
          },
          { silent: true }
        );
      }

      selectedFiles = [];
      renderSelectedFiles();
      window.HakonushiApi.showToast('ファイルを箱に入れました！', 'success');
      await verifyAndRender(currentBoxId, currentPasscode);
    } catch (err) {
      window.HakonushiApi.showToast(err.message || 'アップロードに失敗しました。', 'error', 6000);
    } finally {
      window.HakonushiApi.endTransferWakeLock();
      isUploading = false;
      panel.classList.add('hidden');
      renderSelectedFiles();
    }
  }

  async function handleGuestDeleteFile(file, triggerButton) {
    if (!window.confirm('「' + file.file_name + '」を取り消して削除しますか？')) {
      return;
    }

    try {
      await window.HakonushiApi.callGas(
        'deleteGuestFile',
        {
          boxId: currentBoxId,
          passcode: currentPasscode,
          fileId: file.file_id
        },
        { loadingText: 'ファイルを取り消し中...', triggerButton: triggerButton }
      );
      window.HakonushiApi.showToast('ファイルを取り消しました。', 'success');
      await verifyAndRender(currentBoxId, currentPasscode);
    } catch (err) {
      window.HakonushiApi.showToast(err.message || 'ファイルの取り消しに失敗しました。', 'error', 5000);
    }
  }

  return {
    init: init,
    openBox: openBox
  };
})();
