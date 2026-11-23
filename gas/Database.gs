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

/**
 * 初期化関数: `boxes` / `files` シートとヘッダー行を自動生成する
 * GASエディタから1クリックで実行可能
 */
function setupDatabase() {
  var ss = SpreadsheetApp.getActiveSpreadsheet() || getActiveSpreadsheet();
  PropertiesService.getScriptProperties().setProperty(SPREADSHEET_ID_PROP_KEY, ss.getId());

  ensureSheetWithHeaders_(ss, SHEET_BOXES, BOXES_HEADERS);
  ensureSheetWithHeaders_(ss, SHEET_FILES, FILES_HEADERS);

  Logger.log('hakonushi database setup completed: boxes, files (SPREADSHEET_ID=' + ss.getId() + ')');
  return {
    ok: true,
    spreadsheetId: ss.getId(),
    sheets: [SHEET_BOXES, SHEET_FILES]
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
