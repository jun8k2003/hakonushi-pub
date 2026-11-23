/**
 * hakonushi - Guest API Handlers (gas/GuestApi.gs)
 */

/**
 * ゲスト向けの箱アクセス検証を行う
 * - 存在確認 / ステータス確認 / 有効期限確認 / Driveフォルダ生存確認
 * - パスコード照合（5回連続失敗で LOCKED）
 *
 * @param {string} boxId
 * @param {string} passcode
 * @param {{ allowPasscodePrompt?: boolean }=} options
 * @return {{ requiresPasscode: boolean, box: Object }}
 */
function assertGuestBoxAccess_(boxId, passcode, options) {
  var safeBoxId = String(boxId || '').trim();
  if (!safeBoxId) {
    throw createAppError('INVALID_ARGUMENT', '箱ID（GUID）を入力してください。');
  }

  var opts = options || {};
  var box = findBoxById(safeBoxId);
  if (!box) {
    throw createAppError('BOX_NOT_FOUND', '指定された箱が見つかりません。URLまたは箱IDをご確認ください。');
  }

  if (box.status === BOX_STATUS.DISABLED) {
    throw createAppError('BOX_DISABLED', 'この箱は共有が終了しています。');
  }
  if (box.status === BOX_STATUS.LOCKED) {
    throw createAppError('BOX_LOCKED', 'パスコードの入力失敗上限に達したため、この箱はロックされています。');
  }
  if (box.status === BOX_STATUS.EXPIRED) {
    throw createAppError('BOX_EXPIRED', 'この箱は有効期限が切れています。');
  }

  // 有効期限チェック（トリガー実行前の期限切れを即時反映）
  if (isExpiredIso_(box.expires_at, new Date().getTime())) {
    withScriptLock(function () {
      var latest = findBoxById(safeBoxId);
      if (latest && latest.status === BOX_STATUS.ACTIVE) {
        updateBoxByRowIndex(latest._rowIndex, { status: BOX_STATUS.EXPIRED });
        revokeBoxFilesSharingSafe(latest.box_id);
      }
    });
    throw createAppError('BOX_EXPIRED', 'この箱は有効期限が切れています。');
  }

  // Drive上の箱フォルダが手動削除（ゴミ箱移動）されていないか確認
  if (!isFolderAlive(box.folder_id)) {
    withScriptLock(function () {
      var latest = findBoxById(safeBoxId);
      if (latest && latest.status === BOX_STATUS.ACTIVE) {
        updateBoxByRowIndex(latest._rowIndex, { status: BOX_STATUS.DISABLED });
      }
    });
    throw createAppError('BOX_DISABLED', 'この箱は共有が終了しています。');
  }

  // パスコード検証（TOCTOU防止のため、最新状態確認〜照合〜回数更新を1つのロック内で直列化）
  if (box.passcode_hash) {
    var rawPasscode = String(passcode === undefined || passcode === null ? '' : passcode).trim();
    if (!rawPasscode) {
      if (opts.allowPasscodePrompt) {
        return { requiresPasscode: true, box: box };
      }
      throw createAppError('PASSCODE_REQUIRED', 'パスコードの入力が必要です。');
    }

    var verifyResult = withScriptLock(function () {
      var latest = findBoxById(safeBoxId);
      if (!latest) {
        throw createAppError('BOX_NOT_FOUND', '指定された箱が見つかりません。URLまたは箱IDをご確認ください。');
      }
      if (latest.status === BOX_STATUS.DISABLED) {
        throw createAppError('BOX_DISABLED', 'この箱は共有が終了しています。');
      }
      if (latest.status === BOX_STATUS.LOCKED) {
        throw createAppError('BOX_LOCKED', 'パスコードの入力失敗上限に達したため、この箱はロックされています。');
      }
      if (latest.status === BOX_STATUS.EXPIRED) {
        throw createAppError('BOX_EXPIRED', 'この箱は有効期限が切れています。');
      }

      if (!verifyPasscodeHash(rawPasscode, latest.passcode_hash, latest.box_id)) {
        var nextFail = Number(latest.fail_count || 0) + 1;
        var isLocked = nextFail >= MAX_PASSCODE_FAILURES;
        var updates = { fail_count: nextFail };
        if (isLocked) {
          updates.status = BOX_STATUS.LOCKED;
        }
        updateBoxByRowIndex(latest._rowIndex, updates);
        if (isLocked) {
          revokeBoxFilesSharingSafe(latest.box_id);
        }
        return {
          ok: false,
          locked: isLocked,
          remaining: Math.max(0, MAX_PASSCODE_FAILURES - nextFail)
        };
      }

      // 照合成功時に失敗回数をリセット
      if (latest.fail_count > 0) {
        updateBoxByRowIndex(latest._rowIndex, { fail_count: 0 });
        latest.fail_count = 0;
      }

      return { ok: true, box: latest };
    });

    if (!verifyResult.ok) {
      if (verifyResult.locked) {
        throw createAppError(
          'BOX_LOCKED',
          'パスコードを5回連続で間違えたため、この箱はロックされました。'
        );
      }

      var err = createAppError(
        'INVALID_PASSCODE',
        'パスコードが正しくありません（残り ' + verifyResult.remaining + ' 回）。'
      );
      err.details = { remainingAttempts: verifyResult.remaining };
      throw err;
    }

    box = verifyResult.box;
  }

  return { requiresPasscode: false, box: box };
}

/**
 * ゲストによる箱の検証・情報取得
 * @param {Object} payload
 */
function handleVerifyBox(payload) {
  var result = assertGuestBoxAccess_(payload.boxId, payload.passcode, {
    allowPasscodePrompt: true
  });

  if (result.requiresPasscode) {
    return {
      requiresPasscode: true,
      box: {
        box_id: result.box.box_id,
        direction: result.box.direction
      }
    };
  }

  var box = result.box;
  var files = findFilesByBoxId(box.box_id, true).map(toPublicFileDto_);

  return {
    requiresPasscode: false,
    box: {
      box_id: box.box_id,
      box_name: box.box_name || box.box_id,
      direction: box.direction,
      status: box.status,
      expires_at: box.expires_at,
      created_at: box.created_at
    },
    files: files
  };
}

/**
 * ゲストが SEND 箱のファイルダウンロードURLを取得する
 * 押下時のみ一時的に対象ファイルを「リンクを知っている全員（閲覧者）」へ変更する
 * @param {Object} payload
 */
function handleGetGuestDownloadUrl(payload) {
  var access = assertGuestBoxAccess_(payload.boxId, payload.passcode, {
    allowPasscodePrompt: false
  });
  var box = access.box;

  if (box.direction !== BOX_DIRECTION.SEND) {
    throw createAppError('FORBIDDEN', 'もらう箱のファイルはゲストからダウンロードできません。');
  }

  var fileId = String(payload.fileId || '').trim();
  if (!fileId) {
    throw createAppError('INVALID_ARGUMENT', 'fileId が指定されていません。');
  }

  return withScriptLock(function () {
    var latestBox = findBoxById(box.box_id);
    if (!latestBox) {
      throw createAppError('BOX_NOT_FOUND', '指定された箱が見つかりません。');
    }
    if (latestBox.status === BOX_STATUS.DISABLED) {
      throw createAppError('BOX_DISABLED', 'この箱は共有が終了しています。');
    }
    if (latestBox.status === BOX_STATUS.LOCKED) {
      throw createAppError('BOX_LOCKED', 'パスコードの入力失敗上限に達したため、この箱はロックされています。');
    }
    if (latestBox.status === BOX_STATUS.EXPIRED || isExpiredIso_(latestBox.expires_at, new Date().getTime())) {
      throw createAppError('BOX_EXPIRED', 'この箱は有効期限が切れています。');
    }

    var file = findFileById(fileId);
    if (!file || file.box_id !== latestBox.box_id || file.status !== FILE_STATUS.ACTIVE) {
      throw createAppError('FILE_NOT_FOUND', '対象ファイルが見つかりません。');
    }

    var downloadUrl = createGuestDownloadUrlUnlocked_(file.file_id, latestBox.box_id);
    return {
      downloadUrl: downloadUrl,
      fileName: file.file_name
    };
  });
}

/**
 * ゲストが RECEIVE 箱へアップロードするための Resumable Upload セッションを開始する
 * @param {Object} payload
 */
function handleInitGuestUploadSession(payload) {
  var access = assertGuestBoxAccess_(payload.boxId, payload.passcode, {
    allowPasscodePrompt: false
  });
  var box = access.box;

  if (box.direction !== BOX_DIRECTION.RECEIVE) {
    throw createAppError('FORBIDDEN', 'あげる箱にはファイルをアップロードできません。');
  }

  var fileSize = Number(payload.fileSize);
  if (isNaN(fileSize) || !isFinite(fileSize) || fileSize < 0) {
    throw createAppError('INVALID_ARGUMENT', 'ファイルサイズが不正です。');
  }

  var limits = getGuestUploadLimits();
  var formatLimitLabel = function (bytes) {
    var mb = Math.round(bytes / (1024 * 1024));
    if (mb >= 1024 && mb % 1024 === 0) return (mb / 1024) + 'GB';
    if (mb >= 1024) return (mb / 1024).toFixed(1) + 'GB';
    return mb + 'MB';
  };
  if (fileSize > limits.maxFileSizeBytes) {
    throw createAppError(
      'FILE_TOO_LARGE',
      '1ファイルあたりの上限サイズ（' + formatLimitLabel(limits.maxFileSizeBytes) + '）を超えています。'
    );
  }

  var existingFiles = findFilesByBoxId(box.box_id, true);
  if (existingFiles.length >= limits.maxFilesPerBox) {
    throw createAppError(
      'BOX_FILE_LIMIT_EXCEEDED',
      'この箱に送信できるファイル数の上限（' + limits.maxFilesPerBox + '件）に達しています。'
    );
  }

  var currentTotalBytes = existingFiles.reduce(function (sum, f) {
    return sum + Number(f.file_size || 0);
  }, 0);
  if (currentTotalBytes + fileSize > limits.maxTotalBytesPerBox) {
    throw createAppError(
      'BOX_STORAGE_LIMIT_EXCEEDED',
      'この箱の合計容量上限（' + formatLimitLabel(limits.maxTotalBytesPerBox) + '）を超えています。'
    );
  }

  var uploadUrl = createResumableUploadSession(
    box.folder_id,
    payload.fileName,
    payload.mimeType,
    fileSize,
    payload.origin
  );

  return { uploadUrl: uploadUrl };
}

/**
 * ゲストのファイルアップロード完了を `files` シートに記録する
 * @param {Object} payload
 */
function handleCompleteGuestUpload(payload) {
  var access = assertGuestBoxAccess_(payload.boxId, payload.passcode, {
    allowPasscodePrompt: false
  });
  var box = access.box;

  if (box.direction !== BOX_DIRECTION.RECEIVE) {
    throw createAppError('FORBIDDEN', 'あげる箱にはファイルをアップロードできません。');
  }

  var meta = verifyUploadedDriveFile(payload.fileId, box.folder_id);
  var limits = getGuestUploadLimits();
  var uploaderName = String(payload.uploaderName || '').trim().slice(0, 60);
  var nowIso = new Date().toISOString();

  // クライアント自己申告ではなく Google Drive 上の確定メタデータを優先する
  var fileRecord = {
    file_id: meta.fileId,
    box_id: box.box_id,
    file_name: meta.fileName,
    file_size: meta.fileSize,
    mime_type: meta.mimeType,
    uploader_name: uploaderName,
    status: FILE_STATUS.ACTIVE,
    uploaded_at: nowIso
  };

  withScriptLock(function () {
    if (findFileById(meta.fileId)) {
      throw createAppError('DUPLICATE_FILE', 'このファイルはすでに登録されています。');
    }

    // 実ファイルサイズおよび箱の合計容量・件数を再検証（サイズ偽装による上限回避を防止）
    var existingFiles = findFilesByBoxId(box.box_id, true);
    var currentTotalBytes = existingFiles.reduce(function (sum, f) {
      return sum + Number(f.file_size || 0);
    }, 0);

    if (
      meta.fileSize > limits.maxFileSizeBytes ||
      existingFiles.length >= limits.maxFilesPerBox ||
      currentTotalBytes + meta.fileSize > limits.maxTotalBytesPerBox
    ) {
      trashFileSafe(meta.fileId);
      throw createAppError(
        'BOX_STORAGE_LIMIT_EXCEEDED',
        'ファイルサイズまたは箱の容量・件数上限を超えたため、アップロードを取り消しました。'
      );
    }

    insertFile(fileRecord);
  });

  return { file: toPublicFileDto_(fileRecord) };
}

/**
 * ゲストが RECEIVE 箱へ投稿したファイルを取り消す（論理削除＋Driveゴミ箱移動）
 * @param {Object} payload
 */
function handleDeleteGuestFile(payload) {
  var access = assertGuestBoxAccess_(payload.boxId, payload.passcode, {
    allowPasscodePrompt: false
  });
  var box = access.box;

  if (box.direction !== BOX_DIRECTION.RECEIVE) {
    throw createAppError('FORBIDDEN', 'この箱のファイルは削除できません。');
  }

  var fileId = String(payload.fileId || '').trim();
  if (!fileId) {
    throw createAppError('INVALID_ARGUMENT', 'fileId が指定されていません。');
  }

  withScriptLock(function () {
    var file = findFileById(fileId);
    if (!file || file.box_id !== box.box_id || file.status !== FILE_STATUS.ACTIVE) {
      throw createAppError('FILE_NOT_FOUND', '対象ファイルが見つかりません。');
    }

    updateFileByRowIndex(file._rowIndex, {
      status: FILE_STATUS.DELETED
    });
    trashFileSafe(file.file_id);
  });

  return {
    deleted: true,
    file_id: fileId
  };
}
