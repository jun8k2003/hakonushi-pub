/**
 * hakonushi - Spreadsheet Database Helpers (gas/Database.gs)
 */

var BOXES_HEADERS = [
  'box_id',
  'box_name',
  'owner_email',
  'direction',
  'status',
  'folder_id',
  'passcode_hash',
  'fail_count',
  'expires_at',
  'created_at'
];

var FILES_HEADERS = [
  'file_id',
  'box_id',
  'file_name',
  'file_size',
  'mime_type',
  'uploader_name',
  'status',
  'uploaded_at'
];

var BOXES_JOURNAL_HEADERS = [
  'logged_at',
  'event_type',
  'actor_type',
  'actor_id',
  'box_id',
  'box_name',
  'direction',
  'status_before',
  'status_after',
  'expires_at',
  'note'
];

var FILES_JOURNAL_HEADERS = [
  'logged_at',
  'event_type',
  'actor_type',
  'actor_id',
  'box_id',
  'file_id',
  'file_name',
  'file_size',
  'mime_type',
  'note'
];

var DOWNLOAD_JOURNAL_HEADERS = [
  'logged_at',
  'actor_type',
  'actor_id',
  'box_id',
  'box_name',
  'direction',
  'file_id',
  'file_name',
  'file_size'
];

/**
 * 初期化関数: `boxes` / `files` および3つのジャーナルシートとヘッダー行を自動生成する
 * GASエディタから1クリックで実行可能
 */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty(SPREADSHEET_ID_PROP_KEY, ss.getId());

  ensureSheetWithHeaders_(ss, SHEET_BOXES, BOXES_HEADERS);
  ensureSheetWithHeaders_(ss, SHEET_FILES, FILES_HEADERS);
  ensureSheetWithHeaders_(ss, SHEET_BOXES_JOURNAL, BOXES_JOURNAL_HEADERS);
  ensureSheetWithHeaders_(ss, SHEET_FILES_JOURNAL, FILES_JOURNAL_HEADERS);
  ensureSheetWithHeaders_(ss, SHEET_DOWNLOAD_JOURNAL, DOWNLOAD_JOURNAL_HEADERS);

  Logger.log(
    'hakonushi database setup completed: boxes, files, boxes_journal, files_journal, download_journal (SPREADSHEET_ID=' +
    ss.getId() + ')'
  );
  return {
    ok: true,
    spreadsheetId: ss.getId(),
    sheets: [SHEET_BOXES, SHEET_FILES, SHEET_BOXES_JOURNAL, SHEET_FILES_JOURNAL, SHEET_DOWNLOAD_JOURNAL]
  };
}

/**
 * シートを作成（既存の場合は不足ヘッダーを補完）する
 * @param {GoogleAppsScript.Spreadsheet.Spreadsheet} ss
 * @param {string} sheetName
 * @param {string[]} headers
 */
function ensureSheetWithHeaders_(ss, sheetName, headers) {
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    sheet = ss.insertSheet(sheetName);
  }

  if (sheet.getLastRow() === 0) {
    sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  } else {
    var existing = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getValues()[0]
      .map(function (v) { return String(v).trim(); });
    for (var i = 0; i < headers.length; i++) {
      if (existing.indexOf(headers[i]) === -1) {
        existing.push(headers[i]);
        sheet.getRange(1, existing.length).setValue(headers[i]);
      }
    }
  }

  sheet.setFrozenRows(1);
  sheet.getRange(1, 1, 1, Math.max(headers.length, sheet.getLastColumn()))
    .setFontWeight('bold')
    .setBackground('#f1f5f9');
}

/**
 * LockService.getScriptLock() で排他制御して処理を実行する
 * @param {Function} fn
 * @param {number=} timeoutMs
 * @return {*}
 */
function withScriptLock(fn, timeoutMs) {
  var lock = LockService.getScriptLock();
  var waitMs = timeoutMs || 30000;
  try {
    lock.waitLock(waitMs);
  } catch (e) {
    throw createAppError('LOCK_TIMEOUT', 'サーバーが混み合っています。少し待ってから再度お試しください。');
  }

  try {
    return fn();
  } finally {
    lock.releaseLock();
  }
}

/**
 * シートを取得する（未初期化の場合はエラー）
 * @param {string} sheetName
 * @return {GoogleAppsScript.Spreadsheet.Sheet}
 */
function getSheetOrThrow_(sheetName) {
  var ss = getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    throw createAppError(
      'DB_NOT_INITIALIZED',
      'シート "' + sheetName + '" が見つかりません。GASエディタで setupDatabase() を実行してください。'
    );
  }
  return sheet;
}

/**
 * シートの全行をヘッダー名キーのオブジェクト配列として読み込む
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @return {{ headers: string[], rows: Object[] }}
 */
function readSheetObjects_(sheet) {
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow === 0 || lastCol === 0) {
    return { headers: [], rows: [] };
  }

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var rows = [];

  for (var r = 1; r < values.length; r++) {
    var rowValues = values[r];
    var isEmpty = true;
    var obj = { _rowIndex: r + 1 };
    for (var c = 0; c < headers.length; c++) {
      var key = headers[c];
      if (!key) continue;
      var val = rowValues[c];
      if (val !== '' && val !== null && val !== undefined) {
        isEmpty = false;
      }
      if (val instanceof Date) {
        obj[key] = val.toISOString();
      } else {
        obj[key] = val;
      }
    }
    if (!isEmpty) {
      rows.push(obj);
    }
  }

  return { headers: headers, rows: rows };
}

/**
 * スプレッドシート数式インジェクション対策：
 * 先頭が =, +, -, @, タブ, CR で始まる文字列にシングルクォートを付与し、
 * 数式として評価されるのを防ぐ。
 * @param {*} value
 * @return {*}
 */
function sanitizeSheetCellValue_(value) {
  if (value === undefined || value === null) {
    return '';
  }
  if (typeof value === 'string' && /^[=+\-@\t\r]/.test(value)) {
    return "'" + value;
  }
  return value;
}

/**
 * オブジェクトをシートのヘッダー順に並べて1行追加する
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {string[]} defaultHeaders
 * @param {Object} record
 */
function appendSheetObject_(sheet, defaultHeaders, record) {
  var lastCol = sheet.getLastColumn();
  var headers = lastCol > 0
    ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); })
    : defaultHeaders;

  var row = headers.map(function (key) {
    return sanitizeSheetCellValue_(record[key]);
  });
  sheet.appendRow(row);
}

/**
 * 指定行の特定列を更新する
 * @param {GoogleAppsScript.Spreadsheet.Sheet} sheet
 * @param {number} rowIndex 1始まりの行番号
 * @param {Object} updates 更新する { 列名: 値 }
 */
function updateSheetRow_(sheet, rowIndex, updates) {
  var lastCol = sheet.getLastColumn();
  var headers = sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) {
    return String(h).trim();
  });

  Object.keys(updates).forEach(function (key) {
    var colIdx = headers.indexOf(key);
    if (colIdx !== -1) {
      sheet.getRange(rowIndex, colIdx + 1).setValue(sanitizeSheetCellValue_(updates[key]));
    }
  });
}

/* ===========================
 * boxes CRUD
 * =========================== */

function findAllBoxes() {
  var sheet = getSheetOrThrow_(SHEET_BOXES);
  return readSheetObjects_(sheet).rows.map(normalizeBoxRecord_);
}

function findBoxById(boxId) {
  var target = String(boxId || '').trim();
  if (!target) return null;
  var boxes = findAllBoxes();
  for (var i = 0; i < boxes.length; i++) {
    if (boxes[i].box_id === target) {
      return boxes[i];
    }
  }
  return null;
}

function findBoxesByOwner(ownerEmail) {
  var target = String(ownerEmail || '').trim().toLowerCase();
  var boxes = findAllBoxes().filter(function (b) {
    return String(b.owner_email || '').trim().toLowerCase() === target;
  });
  boxes.sort(function (a, b) {
    return String(b.created_at || '').localeCompare(String(a.created_at || ''));
  });
  return boxes;
}

function insertBox(boxRecord) {
  var sheet = getSheetOrThrow_(SHEET_BOXES);
  appendSheetObject_(sheet, BOXES_HEADERS, boxRecord);
}

function updateBoxByRowIndex(rowIndex, updates) {
  var sheet = getSheetOrThrow_(SHEET_BOXES);
  updateSheetRow_(sheet, rowIndex, updates);
}

function deleteBoxByRowIndex(rowIndex) {
  var sheet = getSheetOrThrow_(SHEET_BOXES);
  sheet.deleteRow(rowIndex);
}

function normalizeBoxRecord_(row) {
  return {
    _rowIndex: row._rowIndex,
    box_id: String(row.box_id || ''),
    box_name: String(row.box_name || ''),
    owner_email: String(row.owner_email || '').trim().toLowerCase(),
    direction: String(row.direction || ''),
    status: String(row.status || ''),
    folder_id: String(row.folder_id || ''),
    passcode_hash: String(row.passcode_hash || ''),
    fail_count: Number(row.fail_count || 0),
    expires_at: String(row.expires_at || ''),
    created_at: String(row.created_at || '')
  };
}

/* ===========================
 * files CRUD
 * =========================== */

function findAllFiles() {
  var sheet = getSheetOrThrow_(SHEET_FILES);
  return readSheetObjects_(sheet).rows.map(normalizeFileRecord_);
}

function findFilesByBoxId(boxId, activeOnly) {
  var target = String(boxId || '').trim();
  var files = findAllFiles().filter(function (f) {
    if (f.box_id !== target) return false;
    if (activeOnly && f.status !== FILE_STATUS.ACTIVE) return false;
    return true;
  });
  files.sort(function (a, b) {
    return String(a.uploaded_at || '').localeCompare(String(b.uploaded_at || ''));
  });
  return files;
}

function findFileById(fileId) {
  var target = String(fileId || '').trim();
  if (!target) return null;
  var files = findAllFiles();
  for (var i = 0; i < files.length; i++) {
    if (files[i].file_id === target) {
      return files[i];
    }
  }
  return null;
}

function insertFile(fileRecord) {
  var sheet = getSheetOrThrow_(SHEET_FILES);
  appendSheetObject_(sheet, FILES_HEADERS, fileRecord);
}

function updateFileByRowIndex(rowIndex, updates) {
  var sheet = getSheetOrThrow_(SHEET_FILES);
  updateSheetRow_(sheet, rowIndex, updates);
}

function deleteFilesByBoxId(boxId) {
  var target = String(boxId || '').trim();
  if (!target) return 0;
  var sheet = getSheetOrThrow_(SHEET_FILES);
  var lastRow = sheet.getLastRow();
  var lastCol = sheet.getLastColumn();
  if (lastRow <= 1 || lastCol === 0) return 0;

  var values = sheet.getRange(1, 1, lastRow, lastCol).getValues();
  var headers = values[0].map(function (h) { return String(h).trim(); });
  var boxIdCol = headers.indexOf('box_id');
  if (boxIdCol === -1) return 0;

  // 1000件超でもタイムアウトしないよう、メモリ上で絞り込んで一括書き戻しする
  var keptRows = [];
  var deletedCount = 0;
  for (var r = 1; r < values.length; r++) {
    if (String(values[r][boxIdCol] || '').trim() === target) {
      deletedCount++;
    } else {
      keptRows.push(values[r].map(sanitizeSheetCellValue_));
    }
  }

  if (deletedCount === 0) return 0;

  // 既存データ行をクリアし、残存行を一括で書き込む
  sheet.getRange(2, 1, lastRow - 1, lastCol).clearContent();
  if (keptRows.length > 0) {
    sheet.getRange(2, 1, keptRows.length, lastCol).setValues(keptRows);
  }
  // 末尾の余分な空行を削除してシートを綺麗に保つ
  var extraRows = (lastRow - 1) - keptRows.length;
  if (extraRows > 0) {
    sheet.deleteRows(2 + keptRows.length, extraRows);
  }
  return deletedCount;
}

function normalizeFileRecord_(row) {
  return {
    _rowIndex: row._rowIndex,
    file_id: String(row.file_id || ''),
    box_id: String(row.box_id || ''),
    file_name: String(row.file_name || ''),
    file_size: Number(row.file_size || 0),
    mime_type: String(row.mime_type || 'application/octet-stream'),
    uploader_name: String(row.uploader_name || ''),
    status: String(row.status || FILE_STATUS.ACTIVE),
    uploaded_at: String(row.uploaded_at || '')
  };
}

/* ===========================
 * Journal (Append-Only) Helpers
 * =========================== */

function getOrCreateJournalSheet_(sheetName, headers) {
  var ss = getActiveSpreadsheet();
  var sheet = ss.getSheetByName(sheetName);
  if (!sheet) {
    ensureSheetWithHeaders_(ss, sheetName, headers);
    sheet = ss.getSheetByName(sheetName);
  }
  return sheet;
}

function normalizeJournalEvent_(eventType, allowedEnum, note) {
  var raw = String(eventType || '').trim();
  var validValues = Object.keys(allowedEnum).map(function (k) { return allowedEnum[k]; });
  if (validValues.indexOf(raw) !== -1) {
    return { eventType: raw, note: String(note || '') };
  }
  var fallbackNote = 'raw_event=' + (raw || '(empty)');
  var mergedNote = note ? (String(note) + '; ' + fallbackNote) : fallbackNote;
  return { eventType: 'OTHER', note: mergedNote };
}

/**
 * boxes_journal へ追記する（例外時は本体処理を止めずログ出力のみ行う）
 * @param {Object} entry
 */
function appendBoxJournal(entry) {
  try {
    var sheet = getOrCreateJournalSheet_(SHEET_BOXES_JOURNAL, BOXES_JOURNAL_HEADERS);
    var normalized = normalizeJournalEvent_(entry.event_type, BOX_JOURNAL_EVENT, entry.note);
    appendSheetObject_(sheet, BOXES_JOURNAL_HEADERS, {
      logged_at: entry.logged_at || new Date().toISOString(),
      event_type: normalized.eventType,
      actor_type: String(entry.actor_type || ''),
      actor_id: String(entry.actor_id || ''),
      box_id: String(entry.box_id || ''),
      box_name: String(entry.box_name || ''),
      direction: String(entry.direction || ''),
      status_before: String(entry.status_before || ''),
      status_after: String(entry.status_after || ''),
      expires_at: String(entry.expires_at || ''),
      note: normalized.note
    });
  } catch (e) {
    Logger.log('appendBoxJournal failed: ' + (e && e.message ? e.message : e));
  }
}

/**
 * files_journal へ1件追記する（例外時は本体処理を止めずログ出力のみ行う）
 * @param {Object} entry
 */
function appendFileJournal(entry) {
  appendFileJournalsBatch([entry]);
}

/**
 * files_journal へ複数件を一括追記する（箱削除時の大量ファイルにも対応）
 * @param {Object[]} entries
 */
function appendFileJournalsBatch(entries) {
  if (!entries || entries.length === 0) return;
  try {
    var sheet = getOrCreateJournalSheet_(SHEET_FILES_JOURNAL, FILES_JOURNAL_HEADERS);
    var lastCol = sheet.getLastColumn();
    var headers = lastCol > 0
      ? sheet.getRange(1, 1, 1, lastCol).getValues()[0].map(function (h) { return String(h).trim(); })
      : FILES_JOURNAL_HEADERS;

    var nowIso = new Date().toISOString();
    var rows = entries.map(function (entry) {
      var normalized = normalizeJournalEvent_(entry.event_type, FILE_JOURNAL_EVENT, entry.note);
      var record = {
        logged_at: entry.logged_at || nowIso,
        event_type: normalized.eventType,
        actor_type: String(entry.actor_type || ''),
        actor_id: String(entry.actor_id || ''),
        box_id: String(entry.box_id || ''),
        file_id: String(entry.file_id || ''),
        file_name: String(entry.file_name || ''),
        file_size: Number(entry.file_size || 0),
        mime_type: String(entry.mime_type || ''),
        note: normalized.note
      };
      return headers.map(function (key) {
        return sanitizeSheetCellValue_(record[key]);
      });
    });

    var startRow = sheet.getLastRow() + 1;
    sheet.getRange(startRow, 1, rows.length, headers.length).setValues(rows);
  } catch (e) {
    Logger.log('appendFileJournalsBatch failed: ' + (e && e.message ? e.message : e));
  }
}

/**
 * download_journal へ追記する（ダウンロードURL発行時。例外時は本体処理を止めずログ出力のみ行う）
 * @param {Object} entry
 */
function appendDownloadJournal(entry) {
  try {
    var sheet = getOrCreateJournalSheet_(SHEET_DOWNLOAD_JOURNAL, DOWNLOAD_JOURNAL_HEADERS);
    appendSheetObject_(sheet, DOWNLOAD_JOURNAL_HEADERS, {
      logged_at: entry.logged_at || new Date().toISOString(),
      actor_type: String(entry.actor_type || ''),
      actor_id: String(entry.actor_id || ''),
      box_id: String(entry.box_id || ''),
      box_name: String(entry.box_name || ''),
      direction: String(entry.direction || ''),
      file_id: String(entry.file_id || ''),
      file_name: String(entry.file_name || ''),
      file_size: Number(entry.file_size || 0)
    });
  } catch (e) {
    Logger.log('appendDownloadJournal failed: ' + (e && e.message ? e.message : e));
  }
}
