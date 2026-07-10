function getActiveNotices(authToken) {
  getCurrentPlayer_(authToken);
  ensureNoticeSheet_();
  var nowMs = new Date().getTime();
  return readTableCached_(DB_SHEETS.NOTICES, 120)
    .filter(function(row) {
      return isNoticeActive_(row, nowMs);
    })
    .sort(function(a, b) {
      var priorityDiff = Number(b.priority || 0) - Number(a.priority || 0);
      if (priorityDiff) return priorityDiff;
      return getNoticeTimeMs_(b.updatedAt) - getNoticeTimeMs_(a.updatedAt);
    })
    .map(function(row, index) {
      var id = String(row.noticeId || '').trim() || ('notice_' + (index + 1));
      return {
        noticeId: id,
        title: String(row.title || '').trim() || '공지사항',
        body: String(row.body || '').trim(),
        priority: Number(row.priority || 0),
        updatedAt: row.updatedAt || '',
      };
    })
    .filter(function(notice) {
      return !!notice.body;
    });
}

function ensureNoticeSheet_() {
  var spreadsheet = getSpreadsheet_();
  if (!spreadsheet.getSheetByName(DB_SHEETS.NOTICES)) {
    ensureSheet_(DB_SHEETS.NOTICES, DB_COLUMNS.NOTICES);
    return;
  }
  ensureTableColumns_(DB_SHEETS.NOTICES, DB_COLUMNS.NOTICES);
}

function isNoticeActive_(row, nowMs) {
  if (!row || !isTruthy_(row.active)) {
    return false;
  }
  var startMs = getNoticeTimeMs_(row.startAt);
  var endMs = getNoticeTimeMs_(row.endAt);
  if (startMs && nowMs < startMs) {
    return false;
  }
  if (endMs && nowMs > endMs) {
    return false;
  }
  return true;
}

function getNoticeTimeMs_(value) {
  if (value === '' || value === null || value === undefined) {
    return 0;
  }
  var ms = new Date(value).getTime();
  return isNaN(ms) ? 0 : ms;
}
