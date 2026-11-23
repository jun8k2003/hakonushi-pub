/**
 * hakonushi - Owner Dashboard & Box Management (public/js/owner.js)
 */

window.HakonushiOwner = (function () {
  var boxesCache = [];
  var selectedFiles = [];
  var isSubmitting = false;
  var pendingDeleteBox = null;
  var pendingExtendBox = null;

  function init() {
    var btnCreateSend = document.getElementById('btn-create-send');
    var btnCreateReceive = document.getElementById('btn-create-receive');
    var btnRefresh = document.getElementById('btn-refresh-boxes');
    var btnGenPasscode = document.getElementById('btn-gen-passcode');
    var formCreate = document.getElementById('form-create-box');
    var formExtend = document.getElementById('form-extend-box');
    var btnCopyUrl = document.getElementById('btn-copy-share-url');
    var checkConfirmDelete = document.getElementById('checkbox-confirm-delete');
    var btnConfirmDelete = document.getElementById('btn-confirm-delete-box');

    if (btnCreateSend) {
      btnCreateSend.addEventListener('click', function () {
        openCreateModal('SEND');
      });
    }
    if (btnCreateReceive) {
      btnCreateReceive.addEventListener('click', function () {
        openCreateModal('RECEIVE');
      });
    }
    if (btnRefresh) {
      btnRefresh.addEventListener('click', function () {
        loadBoxes(btnRefresh);
      });
    }
    if (btnGenPasscode) {
      btnGenPasscode.addEventListener('click', function () {
        var code = String(Math.floor(100000 + Math.random() * 900000));
        var input = document.getElementById('input-create-passcode');
        if (input) input.value = code;
      });
    }
    if (formCreate) {
      formCreate.addEventListener('submit', handleCreateSubmit);
    }
    if (formExtend) {
      formExtend.addEventListener('submit', handleConfirmExtendBox);
    }
    if (btnCopyUrl) {
      btnCopyUrl.addEventListener('click', handleCopyShareUrl);
    }
    if (checkConfirmDelete && btnConfirmDelete) {
      checkConfirmDelete.addEventListener('change', function () {
        btnConfirmDelete.disabled = !checkConfirmDelete.checked;
      });
      btnConfirmDelete.addEventListener('click', function () {
        handleConfirmDeleteBox(btnConfirmDelete);
      });
    }

    setupDropzone();
  }

  function setupDropzone() {
    var dropzone = document.getElementById('owner-dropzone');
    var fileInput = document.getElementById('input-owner-files');
    if (!dropzone || !fileInput) return;

    dropzone.addEventListener('click', function () {
      if (!isSubmitting) fileInput.click();
    });
    dropzone.addEventListener('keydown', function (e) {
      if ((e.key === 'Enter' || e.key === ' ') && !isSubmitting) {
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
      if (!isSubmitting && e.dataTransfer && e.dataTransfer.files) {
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
    var ul = document.getElementById('owner-selected-files');
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
        '<button type="button" class="btn-icon" data-remove-idx="' + idx + '" aria-label="削除">✕</button>';

      li.querySelector('button').addEventListener('click', function () {
        if (isSubmitting) return;
        selectedFiles.splice(idx, 1);
        renderSelectedFiles();
      });
      ul.appendChild(li);
    });
  }

  function openCreateModal(direction) {
    selectedFiles = [];
    renderSelectedFiles();

    var modal = document.getElementById('modal-create-box');
    var titleEl = document.getElementById('modal-create-title');
    var dirInput = document.getElementById('input-create-direction');
    var nameInput = document.getElementById('input-create-box-name');
    var passcodeInput = document.getElementById('input-create-passcode');
    var expiresSelect = document.getElementById('input-create-expires');
    var filesArea = document.getElementById('create-send-files-area');
    var progressPanel = document.getElementById('owner-upload-progress');
    var submitBtn = document.getElementById('btn-create-box-submit');

    if (dirInput) dirInput.value = direction;
    if (nameInput) nameInput.value = '';
    if (passcodeInput) passcodeInput.value = '';
    if (expiresSelect) expiresSelect.value = '72';
    if (progressPanel) progressPanel.classList.add('hidden');

    if (direction === 'SEND') {
      if (titleEl) titleEl.textContent = '箱をつくる（箱主→ゲスト）';
      if (filesArea) filesArea.classList.remove('hidden');
      if (submitBtn) submitBtn.textContent = '箱を作成してアップロード';
    } else {
      if (titleEl) titleEl.textContent = '箱をつくる（箱主←ゲスト）';
      if (filesArea) filesArea.classList.add('hidden');
      if (submitBtn) submitBtn.textContent = '空の箱を作成する';
    }

    if (modal) modal.classList.remove('hidden');
    if (nameInput) nameInput.focus();
  }

  async function loadBoxes(triggerButton) {
    try {
      var idToken = await window.HakonushiAuth.getIdToken();
      var data = await window.HakonushiApi.callGas(
        'listBoxes',
        { idToken: idToken },
        { loadingText: '箱一覧を読み込み中...', triggerButton: triggerButton }
      );
      boxesCache = data.boxes || [];
      renderBoxes();
    } catch (err) {
      window.HakonushiApi.showToast(err.message || '箱一覧の取得に失敗しました。', 'error', 5000);
    }
  }

  function renderBoxes() {
    var listEl = document.getElementById('owner-boxes-list');
    var emptyEl = document.getElementById('owner-boxes-empty');
    if (!listEl || !emptyEl) return;

    listEl.innerHTML = '';
    if (boxesCache.length === 0) {
      emptyEl.classList.remove('hidden');
      return;
    }
    emptyEl.classList.add('hidden');

    boxesCache.forEach(function (box) {
      listEl.appendChild(buildBoxCard(box));
    });
  }

  function buildBoxCard(box) {
    var api = window.HakonushiApi;
    var isActive = box.status === 'ACTIVE';
    var card = document.createElement('article');
    card.className = 'card box-card' + (isActive ? '' : ' box-inactive');

    var directionLabel = box.direction === 'SEND' ? '箱主→ゲスト' : '箱主←ゲスト';
    var directionClass = box.direction === 'SEND' ? 'pill-send' : 'pill-receive';
    var statusMap = {
      ACTIVE: { label: '有効', cls: 'pill-active' },
      DISABLED: { label: '終了', cls: 'pill-disabled' },
      LOCKED: { label: 'ロック済', cls: 'pill-locked' },
      EXPIRED: { label: '期限切れ', cls: 'pill-expired' }
    };
    var st = statusMap[box.status] || { label: box.status, cls: 'pill-disabled' };
    var files = box.files || [];

    var canExtend = isActive || box.direction === 'RECEIVE' || box.status === 'LOCKED';

    card.innerHTML =
      '<div class="box-card-top">' +
        '<div class="box-title-group">' +
          '<div class="box-badges">' +
            '<span class="pill ' + directionClass + '">' + directionLabel + '</span>' +
            '<span class="pill ' + st.cls + '">' + st.label + '</span>' +
            (box.has_passcode ? '<span class="pill pill-passcode">🔒 パスコードあり</span>' : '') +
          '</div>' +
          '<h3 class="box-name">' + api.escapeHtml(box.box_name || box.box_id) + '</h3>' +
        '</div>' +
        '<div class="box-actions">' +
          (isActive ? '<button type="button" class="btn btn-primary btn-sm" data-action="share">共有URL・QR</button>' : '') +
          (canExtend ? '<button type="button" class="btn btn-ghost btn-sm" data-action="extend">' + (isActive ? '期限延長' : '再開・延長') + '</button>' : '') +
          '<button type="button" class="btn btn-ghost btn-sm" data-action="toggle-files">ファイル (' + files.length + ')</button>' +
          (box.folder_url ? '<a class="btn btn-ghost btn-sm" href="' + api.escapeHtml(box.folder_url) + '" target="_blank" rel="noopener noreferrer">Driveで開く</a>' : '') +
          (isActive ? '<button type="button" class="btn btn-ghost btn-sm" data-action="disable">無効化</button>' : '') +
          '<button type="button" class="btn btn-danger-ghost btn-sm" data-action="delete">完全削除</button>' +
        '</div>' +
      '</div>' +
      '<div class="box-meta">' +
        '<span>作成: ' + api.formatDateTime(box.created_at) + '</span>' +
        '<span>期限: ' + api.formatDateTime(box.expires_at) + '</span>' +
        '<span>ID: <code>' + api.escapeHtml(box.box_id.slice(0, 8)) + '…</code></span>' +
      '</div>' +
      '<div class="box-files-drawer hidden"></div>';

    var btnShare = card.querySelector('[data-action="share"]');
    if (btnShare) {
      btnShare.addEventListener('click', function () {
        openShareModal(box, null);
      });
    }

    var btnExtend = card.querySelector('[data-action="extend"]');
    if (btnExtend) {
      btnExtend.addEventListener('click', function () {
        openExtendModal(box);
      });
    }

    var drawer = card.querySelector('.box-files-drawer');
    var btnToggle = card.querySelector('[data-action="toggle-files"]');
    if (btnToggle && drawer) {
      btnToggle.addEventListener('click', function () {
        var willOpen = drawer.classList.contains('hidden');
        if (willOpen) {
          renderOwnerFileDrawer(drawer, box);
        }
        drawer.classList.toggle('hidden');
      });
    }

    var btnDisable = card.querySelector('[data-action="disable"]');
    if (btnDisable) {
      btnDisable.addEventListener('click', function () {
        handleDisableBox(box, btnDisable);
      });
    }

    var btnDelete = card.querySelector('[data-action="delete"]');
    if (btnDelete) {
      btnDelete.addEventListener('click', function () {
        openDeleteModal(box);
      });
    }

    return card;
  }

  function renderOwnerFileDrawer(container, box) {
    var api = window.HakonushiApi;
    var files = box.files || [];
    container.innerHTML = '';

    if (files.length === 0) {
      container.innerHTML = '<p class="muted text-sm" style="margin:0;">ファイルはまだありません。</p>';
      return;
    }

    var list = document.createElement('div');
    list.className = 'file-list';

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

      row.innerHTML =
        '<div class="file-info">' +
          '<div class="file-name">' + api.escapeHtml(file.file_name) + '</div>' +
          '<div class="file-meta">' + api.escapeHtml(metaParts.join(' ・ ')) + '</div>' +
        '</div>' +
        '<button type="button" class="btn btn-secondary btn-sm">ダウンロード</button>';

      var dlBtn = row.querySelector('button');
      dlBtn.addEventListener('click', function () {
        handleOwnerDownload(box.box_id, file.file_id, dlBtn);
      });
      list.appendChild(row);
    });

    container.appendChild(list);
  }

  async function handleOwnerDownload(boxId, fileId, triggerButton) {
    try {
      var idToken = await window.HakonushiAuth.getIdToken();
      var data = await window.HakonushiApi.callGas(
        'getOwnerDownloadUrl',
        { idToken: idToken, boxId: boxId, fileId: fileId },
        { loadingText: 'ダウンロードリンクを準備中...', triggerButton: triggerButton }
      );
      window.HakonushiApi.triggerBrowserDownload(data.downloadUrl, data.fileName);
    } catch (err) {
      window.HakonushiApi.showToast(err.message || 'ダウンロードの準備に失敗しました。', 'error', 5000);
    }
  }

  async function handleDisableBox(box, triggerButton) {
    var msg = box.direction === 'SEND'
      ? '「' + (box.box_name || box.box_id) + '」を無効化しますか？\n箱主→ゲストの箱のため、Google Drive上の箱フォルダもゴミ箱へ移動されます。'
      : '「' + (box.box_name || box.box_id) + '」を無効化しますか？\n以降ゲストからの投稿はできなくなりますが、受け取ったファイルはDriveに残ります。';

    if (!window.confirm(msg)) return;

    try {
      var idToken = await window.HakonushiAuth.getIdToken();
      await window.HakonushiApi.callGas(
        'disableBox',
        { idToken: idToken, boxId: box.box_id },
        { loadingText: '箱を無効化中...', triggerButton: triggerButton }
      );
      window.HakonushiApi.showToast('箱を無効化しました。', 'success');
      await loadBoxes();
    } catch (err) {
      window.HakonushiApi.showToast(err.message || '箱の無効化に失敗しました。', 'error', 5000);
    }
  }

  function openExtendModal(box) {
    pendingExtendBox = box;
    var modal = document.getElementById('modal-extend-box');
    var nameEl = document.getElementById('extend-box-name');
    var currentEl = document.getElementById('extend-box-current');
    var selectEl = document.getElementById('input-extend-expires');

    var dirLabel = box.direction === 'SEND' ? '箱主→ゲスト' : '箱主←ゲスト';
    if (nameEl) nameEl.textContent = box.box_name || box.box_id;
    if (currentEl) {
      currentEl.textContent = dirLabel + ' ・ 現在の期限: ' + window.HakonushiApi.formatDateTime(box.expires_at);
    }
    if (selectEl) selectEl.value = '72';
    if (modal) modal.classList.remove('hidden');
  }

  async function handleConfirmExtendBox(e) {
    e.preventDefault();
    if (!pendingExtendBox) return;
    var targetBox = pendingExtendBox;
    var selectEl = document.getElementById('input-extend-expires');
    var submitBtn = document.getElementById('btn-confirm-extend-box');
    var expiresHours = Number((selectEl && selectEl.value) || 72);

    try {
      var idToken = await window.HakonushiAuth.getIdToken();
      await window.HakonushiApi.callGas(
        'extendBox',
        { idToken: idToken, boxId: targetBox.box_id, expiresHours: expiresHours },
        { loadingText: '有効期限を延長中...', triggerButton: submitBtn }
      );
      document.getElementById('modal-extend-box').classList.add('hidden');
      pendingExtendBox = null;
      window.HakonushiApi.showToast('箱の有効期限を延長しました。', 'success');
      await loadBoxes();
    } catch (err) {
      window.HakonushiApi.showToast(err.message || '有効期限の延長に失敗しました。', 'error', 5500);
    }
  }

  function openDeleteModal(box) {
    pendingDeleteBox = box;
    var modal = document.getElementById('modal-delete-box');
    var nameEl = document.getElementById('delete-box-name');
    var metaEl = document.getElementById('delete-box-meta');
    var checkEl = document.getElementById('checkbox-confirm-delete');
    var confirmBtn = document.getElementById('btn-confirm-delete-box');

    var dirLabel = box.direction === 'SEND' ? '箱主→ゲスト' : '箱主←ゲスト';
    var fileCount = (box.files || []).length;

    if (nameEl) nameEl.textContent = box.box_name || box.box_id;
    if (metaEl) metaEl.textContent = dirLabel + ' ・ ファイル ' + fileCount + ' 件';
    if (checkEl) checkEl.checked = false;
    if (confirmBtn) confirmBtn.disabled = true;
    if (modal) modal.classList.remove('hidden');
  }

  async function handleConfirmDeleteBox(triggerButton) {
    if (!pendingDeleteBox) return;
    var targetBox = pendingDeleteBox;

    try {
      var idToken = await window.HakonushiAuth.getIdToken();
      await window.HakonushiApi.callGas(
        'deleteBox',
        { idToken: idToken, boxId: targetBox.box_id },
        { loadingText: '箱を完全削除中...', triggerButton: triggerButton }
      );
      document.getElementById('modal-delete-box').classList.add('hidden');
      pendingDeleteBox = null;
      window.HakonushiApi.showToast('箱を完全に削除しました。', 'success');
      await loadBoxes();
    } catch (err) {
      window.HakonushiApi.showToast(err.message || '箱の削除に失敗しました。', 'error', 5500);
    }
  }

  async function handleCreateSubmit(e) {
    e.preventDefault();
    if (isSubmitting) return;

    var direction = document.getElementById('input-create-direction').value;
    var boxName = document.getElementById('input-create-box-name').value.trim();
    var expiresHours = Number(document.getElementById('input-create-expires').value || 72);
    var passcode = document.getElementById('input-create-passcode').value.trim();
    var submitBtn = document.getElementById('btn-create-box-submit');

    if (passcode && !/^\d{6}$/.test(passcode)) {
      window.HakonushiApi.showToast('パスコードは6桁の数字で入力してください。', 'error');
      return;
    }

    if (direction === 'SEND' && selectedFiles.length === 0) {
      window.HakonushiApi.showToast('箱主→ゲストの箱に入れるファイルを1つ以上選択してください。', 'error');
      return;
    }

    isSubmitting = true;
    submitBtn.disabled = true;

    try {
      var idToken = await window.HakonushiAuth.getIdToken();
      var created = await window.HakonushiApi.callGas(
        'createBox',
        {
          idToken: idToken,
          direction: direction,
          boxName: boxName,
          expiresHours: expiresHours,
          passcode: passcode
        },
        { loadingText: '箱を作成中...' }
      );

      var box = created.box;

      if (direction === 'SEND' && selectedFiles.length > 0) {
        await uploadOwnerFilesSequentially(idToken, box.box_id, selectedFiles);
      }

      document.getElementById('modal-create-box').classList.add('hidden');
      window.HakonushiApi.showToast('箱を作成しました！', 'success');
      await loadBoxes();
      openShareModal(box, passcode || null);
    } catch (err) {
      window.HakonushiApi.showToast(err.message || '箱の作成に失敗しました。', 'error', 6000);
    } finally {
      isSubmitting = false;
      submitBtn.disabled = false;
      var progressPanel = document.getElementById('owner-upload-progress');
      if (progressPanel) progressPanel.classList.add('hidden');
    }
  }

  async function uploadOwnerFilesSequentially(idToken, boxId, files) {
    var panel = document.getElementById('owner-upload-progress');
    var statusText = document.getElementById('owner-upload-status-text');
    var countText = document.getElementById('owner-upload-count-text');
    var bar = document.getElementById('owner-upload-bar');
    var fileText = document.getElementById('owner-upload-file-text');

    panel.classList.remove('hidden');
    window.HakonushiApi.beginTransferWakeLock();

    try {
      for (var i = 0; i < files.length; i++) {
        var file = files[i];
        var currentNum = i + 1;
        countText.textContent = currentNum + ' / ' + files.length;
        statusText.textContent = 'セッション準備中...';
        fileText.textContent = file.name + ' (' + window.HakonushiApi.formatFileSize(file.size) + ')';
        bar.style.width = '0%';

        var session = await window.HakonushiApi.callGas(
          'initUploadSession',
          {
            idToken: idToken,
            boxId: boxId,
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
          'completeUpload',
          {
            idToken: idToken,
            boxId: boxId,
            fileId: uploaded.id,
            fileName: file.name,
            mimeType: file.type || 'application/octet-stream'
          },
          { silent: true }
        );
      }
    } finally {
      window.HakonushiApi.endTransferWakeLock();
    }
  }

  function buildShareUrl(boxId) {
    var base = window.location.origin + window.location.pathname;
    return base + '#box=' + encodeURIComponent(boxId);
  }

  function openShareModal(box, plainPasscode) {
    var modal = document.getElementById('modal-share-box');
    var nameEl = document.getElementById('share-box-name');
    var urlInput = document.getElementById('input-share-url');
    var qrContainer = document.getElementById('share-qr-container');
    var noticeBox = document.getElementById('share-passcode-notice');
    var passcodeValueEl = document.getElementById('share-passcode-value');

    var shareUrl = buildShareUrl(box.box_id);
    if (nameEl) nameEl.textContent = box.box_name || box.box_id;
    if (urlInput) urlInput.value = shareUrl;

    // 外部APIへURLを送らずブラウザ内でQRコードをローカル生成する
    if (qrContainer) {
      qrContainer.innerHTML = '';
      if (typeof window.qrcode === 'function') {
        var qr = window.qrcode(0, 'M');
        qr.addData(shareUrl);
        qr.make();
        qrContainer.innerHTML = qr.createSvgTag({ scalable: true, margin: 2 });
      } else {
        qrContainer.textContent = 'QRコードライブラリの読み込みに失敗しました。URLを直接コピーしてください。';
      }
    }

    if (noticeBox) {
      var hasPasscode = Boolean(box.has_passcode || plainPasscode);
      noticeBox.classList.toggle('hidden', !hasPasscode);
      if (passcodeValueEl) {
        if (plainPasscode) {
          passcodeValueEl.textContent = plainPasscode;
          passcodeValueEl.classList.remove('hidden');
        } else {
          passcodeValueEl.textContent = '';
          passcodeValueEl.classList.add('hidden');
        }
      }
    }

    if (modal) modal.classList.remove('hidden');
  }

  async function handleCopyShareUrl() {
    var urlInput = document.getElementById('input-share-url');
    if (!urlInput || !urlInput.value) return;

    try {
      if (navigator.clipboard && navigator.clipboard.writeText) {
        await navigator.clipboard.writeText(urlInput.value);
      } else {
        urlInput.select();
        document.execCommand('copy');
      }
      window.HakonushiApi.showToast('共有URLをコピーしました。', 'success');
    } catch (e) {
      window.HakonushiApi.showToast('コピーに失敗しました。URLを手動で選択してください。', 'error');
    }
  }

  return {
    init: init,
    loadBoxes: loadBoxes
  };
})();
