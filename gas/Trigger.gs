/**
 * hakonushi - Time-driven Cleanup Trigger (gas/Trigger.gs)
 */

/**
 * 時間主導型トリガーから定期実行する自動クリーンアップ関数
 * - expires_at を超過した ACTIVE 箱を EXPIRED に更新
 * - SEND 箱のDriveフォルダはゴミ箱へ移動
 * - RECEIVE 箱の受取ファイル・フォルダは保持
 */
function cleanupExpiredBoxes() {
  var nowMs = new Date().getTime();
  var expiredCount = 0;
  var trashedDetectedCount = 0;
  var tempShareResult = { revokedCount: 0, unverifiableCount: 0 };

  withScriptLock(function () {
    // 猶予時間（デフォルト6時間）を過ぎたゲスト一時共有ファイルを非公開へ戻す
    tempShareResult = revokeExpiredTempSharedFiles();

    var boxes = findAllBoxes();
    for (var i = 0; i < boxes.length; i++) {
      var box = boxes[i];
      if (box.status !== BOX_STATUS.ACTIVE) {
        continue;
      }

      // Google Drive 上で手動でゴミ箱移動／削除された箱を検知して無効化＋公開権限を即時解除
      if (!isFolderAlive(box.folder_id)) {
        updateBoxByRowIndex(box._rowIndex, {
          status: BOX_STATUS.DISABLED
        });
        revokeBoxFilesSharingSafe(box.box_id);
        trashedDetectedCount++;
        continue;
      }

      if (!isExpiredIso_(box.expires_at, nowMs)) {
        continue;
      }

      updateBoxByRowIndex(box._rowIndex, {
        status: BOX_STATUS.EXPIRED
      });
      expiredCount++;

      // 期限切れ時は公開権限のみ即時解除し、Driveフォルダ自体は保持（箱主の削除操作でゴミ箱へ移動）
      revokeBoxFilesSharingSafe(box.box_id);
    }
  });

  Logger.log(
    'cleanupExpiredBoxes completed: expired=' + expiredCount +
    ', trashedDetected=' + trashedDetectedCount +
    ', revokedTempShares=' + tempShareResult.revokedCount +
    ', unverifiableTempShares=' + tempShareResult.unverifiableCount
  );

  return {
    expiredCount: expiredCount,
    trashedDetectedCount: trashedDetectedCount,
    revokedTempShares: tempShareResult.revokedCount,
    unverifiableTempShares: tempShareResult.unverifiableCount
  };
}

/**
 * 【1回限りの手動実行用】
 * ルートフォルダ配下の全ファイル（{owner_email}/{box_id}/*）を走査し、
 * 残っている不要なリンク共有（type === 'anyone'）をすべて削除する。
 * 管理用スプレッドシート自体は対象外。
 */
function auditAndRevokeAllAnyoneShares() {
  var rootFolder = getRootFolder();
  var ssId = getActiveSpreadsheet().getId();
  var scannedFiles = 0;
  var revokedFiles = 0;
  var unverifiableFiles = 0;
  var failedFiles = 0;

  function scanFolder_(folder) {
    var files = folder.getFiles();
    while (files.hasNext()) {
      var f = files.next();
      if (f.isTrashed() || f.getId() === ssId) continue;
      scannedFiles++;
      var status = revokeFileSharingSafe(f.getId());
      if (status === 'REVOKED') {
        revokedFiles++;
      } else if (status === 'UNVERIFIABLE') {
        unverifiableFiles++;
      } else {
        failedFiles++;
      }
    }

    var subFolders = folder.getFolders();
    while (subFolders.hasNext()) {
      var sub = subFolders.next();
      if (!sub.isTrashed()) {
        scanFolder_(sub);
      }
    }
  }

  scanFolder_(rootFolder);
  Logger.log(
    'auditAndRevokeAllAnyoneShares completed: scanned=' + scannedFiles +
    ', revoked=' + revokedFiles +
    ', unverifiable=' + unverifiableFiles +
    ', failed=' + failedFiles
  );
  return {
    scannedFiles: scannedFiles,
    revokedFiles: revokedFiles,
    unverifiableFiles: unverifiableFiles,
    failedFiles: failedFiles
  };
}
