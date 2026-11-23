/**
 * hakonushi - Owner API Handlers (gas/OwnerApi.gs)
 */

/**
 * 指定メールアドレスが GAS 実行者（Drive オーナー）本人か判定する
 * @param {string} email
 * @return {boolean}
 */
function isDriveOwnerEmail_(email) {
  var target = String(email || '').trim().toLowerCase();
  if (!target) return false;
  try {
    var effective = String(Session.getEffectiveUser().getEmail() || '').trim().toLowerCase();
    return Boolean(effective && effective === target);
  } catch (e) {
    return false;
  }
}

/**
 * 箱主の箱一覧を取得する
 * @param {{ email: string, displayName: string }} owner
 */
function handleListBoxes(owner) {
  var boxes = findBoxesByOwner(owner.email);
  var allFiles = findAllFiles();
  var nowMs = new Date().getTime();
  var isDriveOwner = isDriveOwnerEmail_(owner.email);

  var filesByBox = {};
  for (var i = 0; i < allFiles.length; i++) {
    var f = allFiles[i];
    if (f.status !== FILE_STATUS.ACTIVE) continue;
    if (!filesByBox[f.box_id]) {
      filesByBox[f.box_id] = [];
    }
    filesByBox[f.box_id].push(toPublicFileDto_(f));
  }

  var items = boxes.map(function (box) {
    var effectiveStatus = box.status;
    if (effectiveStatus === BOX_STATUS.ACTIVE && isExpiredIso_(box.expires_at, nowMs)) {
      effectiveStatus = BOX_STATUS.EXPIRED;
    }
    var boxFiles = filesByBox[box.box_id] || [];
    return {
      box_id: box.box_id,
      box_name: box.box_name || box.box_id,
      direction: box.direction,
      status: effectiveStatus,
      has_passcode: Boolean(box.passcode_hash),
      fail_count: box.fail_count,
      expires_at: box.expires_at,
      created_at: box.created_at,
      folder_url: (isDriveOwner && box.folder_id) ? getDriveFolderUrl(box.folder_id) : '',
      files: boxFiles
    };
  });

  return { boxes: items };
}

/**
 * 新しい箱（SEND / RECEIVE）を作成する
 * @param {{ email: string }} owner
 * @param {Object} payload
 */
function handleCreateBox(owner, payload) {
  var direction = String(payload.direction || '').toUpperCase();
  if (direction !== BOX_DIRECTION.SEND && direction !== BOX_DIRECTION.RECEIVE) {
    throw createAppError('INVALID_ARGUMENT', 'direction は SEND または RECEIVE を指定してください。');
  }

  var now = new Date();
  var rawBoxName = String(payload.boxName === undefined || payload.boxName === null ? '' : payload.boxName).trim();
  var boxName = rawBoxName ? rawBoxName.slice(0, 100) : formatDefaultBoxName(now);

  var passcode = normalizeAndValidatePasscode(payload.passcode);

  var expiresHours = Number(payload.expiresHours);
  if (isNaN(expiresHours) || !isFinite(expiresHours) || expiresHours <= 0) {
    expiresHours = DEFAULT_EXPIRES_HOURS;
  }
  // 最小 0.5時間（30分）〜 最大 MAX_EXPIRES_HOURS（30日）
  expiresHours = Math.min(Math.max(expiresHours, 0.5), MAX_EXPIRES_HOURS);

  var expiresAt = new Date(now.getTime() + Math.round(expiresHours * 60) * 60 * 1000);
  var boxId = Utilities.getUuid();
  var passcodeHash = passcode ? hashPasscode(passcode, boxId) : '';
  var boxFolder = getBoxFolder(owner.email, boxId);

  var record = {
    box_id: boxId,
    box_name: boxName,
    owner_email: owner.email,
    direction: direction,
    status: BOX_STATUS.ACTIVE,
    folder_id: boxFolder.getId(),
    passcode_hash: passcodeHash,
    fail_count: 0,
    expires_at: expiresAt.toISOString(),
    created_at: now.toISOString()
  };

  withScriptLock(function () {
    insertBox(record);
  });

  return {
    box: {
      box_id: record.box_id,
      box_name: record.box_name,
      direction: record.direction,
      status: record.status,
      has_passcode: Boolean(record.passcode_hash),
      fail_count: 0,
      expires_at: record.expires_at,
      created_at: record.created_at,
      folder_url: isDriveOwnerEmail_(owner.email) ? getDriveFolderUrl(record.folder_id) : '',
      files: []
    }
  };
}

/**
 * 箱を無効化する（SEND箱の場合はDriveフォルダもゴミ箱へ移動）
 * @param {{ email: string }} owner
 * @param {Object} payload
 */
function handleDisableBox(owner, payload) {
  var boxId = String(payload.boxId || '').trim();
  if (!boxId) {
    throw createAppError('INVALID_ARGUMENT', 'boxId が指定されていません。');
  }

  var updated = withScriptLock(function () {
    var box = findBoxById(boxId);
    if (!box) {
      throw createAppError('BOX_NOT_FOUND', '指定された箱が見つかりません。');
    }
    if (box.owner_email !== owner.email) {
      throw createAppError('FORBIDDEN', 'この箱を操作する権限がありません。');
    }

    updateBoxByRowIndex(box._rowIndex, {
      status: BOX_STATUS.DISABLED
    });

    revokeBoxFilesSharingSafe(box.box_id);

    if (box.direction === BOX_DIRECTION.SEND && box.folder_id) {
      trashFolderSafe(box.folder_id);
    }

    return box;
  });

  return {
    box_id: updated.box_id,
    status: BOX_STATUS.DISABLED
  };
}

/**
 * 箱を完全削除する（Driveフォルダ完全削除＋スプレッドシートのboxes/files行を削除）
 * @param {{ email: string }} owner
 * @param {Object} payload
 */
function handleDeleteBox(owner, payload) {
  var boxId = String(payload.boxId || '').trim();
  if (!boxId) {
    throw createAppError('INVALID_ARGUMENT', 'boxId が指定されていません。');
  }

  var result = withScriptLock(function () {
    var box = findBoxById(boxId);
    if (!box) {
      throw createAppError('BOX_NOT_FOUND', '指定された箱が見つかりません。');
    }
    if (box.owner_email !== owner.email) {
      throw createAppError('FORBIDDEN', 'この箱を削除する権限がありません。');
    }

    revokeBoxFilesSharingSafe(box.box_id);

    if (box.folder_id) {
      permanentlyDeleteFolderSafe(box.folder_id);
    }

    var deletedFiles = deleteFilesByBoxId(box.box_id);
    deleteBoxByRowIndex(box._rowIndex);

    return {
      box_id: box.box_id,
      deleted_files: deletedFiles
    };
  });

  return {
    deleted: true,
    box_id: result.box_id,
    deleted_files: result.deleted_files
  };
}

/**
 * 箱主が SEND 箱へアップロードするための Resumable Upload セッションを開始する
 * @param {{ email: string }} owner
 * @param {Object} payload
 */
function handleInitUploadSession(owner, payload) {
  var box = assertOwnedActiveBox_(owner.email, payload.boxId);
  if (box.direction !== BOX_DIRECTION.SEND) {
    throw createAppError('INVALID_STATE', 'もらう箱には箱主からアップロードできません。');
  }

  var uploadUrl = createResumableUploadSession(
    box.folder_id,
    payload.fileName,
    payload.mimeType,
    Number(payload.fileSize),
    payload.origin
  );

  return { uploadUrl: uploadUrl };
}

/**
 * 箱主のファイルアップロード完了を `files` シートに記録する
 * @param {{ email: string }} owner
 * @param {Object} payload
 */
function handleCompleteUpload(owner, payload) {
  var box = assertOwnedActiveBox_(owner.email, payload.boxId);
  if (box.direction !== BOX_DIRECTION.SEND) {
    throw createAppError('INVALID_STATE', 'もらう箱には箱主からアップロードできません。');
  }

  var meta = verifyUploadedDriveFile(payload.fileId, box.folder_id);
  var nowIso = new Date().toISOString();

  // Google Drive 上の確定メタデータを優先する
  var fileRecord = {
    file_id: meta.fileId,
    box_id: box.box_id,
    file_name: meta.fileName,
    file_size: meta.fileSize,
    mime_type: meta.mimeType,
    uploader_name: '',
    status: FILE_STATUS.ACTIVE,
    uploaded_at: nowIso
  };

  withScriptLock(function () {
    if (findFileById(meta.fileId)) {
      throw createAppError('DUPLICATE_FILE', 'このファイルはすでに登録されています。');
    }
    insertFile(fileRecord);
  });

  return { file: toPublicFileDto_(fileRecord) };
}

/**
 * 箱主が対象ファイルの直ダウンロードURLを取得する
 * @param {{ email: string }} owner
 * @param {Object} payload
 */
function handleGetOwnerDownloadUrl(owner, payload) {
  var boxId = String(payload.boxId || '').trim();
  var fileId = String(payload.fileId || '').trim();
  if (!boxId || !fileId) {
    throw createAppError('INVALID_ARGUMENT', 'boxId と fileId を指定してください。');
  }

  var box = findBoxById(boxId);
  if (!box) {
    throw createAppError('BOX_NOT_FOUND', '指定された箱が見つかりません。');
  }
  if (box.owner_email !== owner.email) {
    throw createAppError('FORBIDDEN', 'この箱のファイルへアクセスする権限がありません。');
  }

  var file = findFileById(fileId);
  if (!file || file.box_id !== box.box_id || file.status !== FILE_STATUS.ACTIVE) {
    throw createAppError('FILE_NOT_FOUND', '対象ファイルが見つかりません。');
  }

  var downloadUrl = createOwnerDownloadUrl(file.file_id, owner.email);
  return {
    downloadUrl: downloadUrl,
    fileName: file.file_name
  };
}

/**
 * 箱主所有かつ有効な箱であることを検証する
 * @param {string} ownerEmail
 * @param {string} boxId
 * @return {Object}
 */
function assertOwnedActiveBox_(ownerEmail, boxId) {
  var box = findBoxById(boxId);
  if (!box) {
    throw createAppError('BOX_NOT_FOUND', '指定された箱が見つかりません。');
  }
  if (box.owner_email !== ownerEmail) {
    throw createAppError('FORBIDDEN', 'この箱を操作する権限がありません。');
  }
  if (box.status !== BOX_STATUS.ACTIVE) {
    throw createAppError('BOX_NOT_ACTIVE', 'この箱は現在利用できません（ステータス: ' + box.status + '）。');
  }
  if (isExpiredIso_(box.expires_at, new Date().getTime())) {
    throw createAppError('BOX_EXPIRED', 'この箱は有効期限を過ぎています。');
  }
  if (!isFolderAlive(box.folder_id)) {
    throw createAppError('DRIVE_ERROR', 'Google Drive上の箱フォルダが見つかりません。');
  }
  return box;
}

/**
 * ISO日時文字列が現在時刻より過去か判定する
 * @param {string} isoString
 * @param {number} nowMs
 * @return {boolean}
 */
function isExpiredIso_(isoString, nowMs) {
  if (!isoString) return false;
  var ts = new Date(isoString).getTime();
  if (isNaN(ts)) return false;
  return ts <= nowMs;
}

/**
 * クライアント返却用のファイルDTOを生成する
 * @param {Object} file
 * @return {Object}
 */
function toPublicFileDto_(file) {
  return {
    file_id: file.file_id,
    box_id: file.box_id,
    file_name: file.file_name,
    file_size: file.file_size,
    mime_type: file.mime_type,
    uploader_name: file.uploader_name,
    status: file.status,
    uploaded_at: file.uploaded_at
  };
}
