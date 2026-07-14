function getActiveWorkbooks(authToken) {
  getCurrentPlayer_(authToken);
  return getActiveWorkbooksForClient_();
}

function getAdminQuestionWorkbooks() {
  requireAdmin_();
  return getActiveWorkbooksForClient_();
}

function checkWorkbookSystemSettings() {
  requireAdmin_();
  var checks = [];
  var summary = {
    ok: true,
    checkedAt: new Date(),
    checks: checks,
    activeWorkbookCount: 0,
    defaultWorkbookId: getDefaultWorkbookId_(),
  };

  var questionsSpreadsheet = null;
  var questionsSpreadsheetId = '';
  try {
    questionsSpreadsheetId = getQuestionsSpreadsheetId_();
    questionsSpreadsheet = SpreadsheetApp.openById(questionsSpreadsheetId);
    pushWorkbookSystemCheck_(checks, 'questionsSpreadsheetId', 'ok', 'Question spreadsheet is configured.', questionsSpreadsheetId);
  } catch (error) {
    pushWorkbookSystemCheck_(checks, 'questionsSpreadsheetId', 'error', 'Question spreadsheet is not configured or cannot be opened.', error.message);
  }

  pushMainSheetCheck_(checks, DB_SHEETS.WORKBOOKS, DB_COLUMNS.WORKBOOKS);
  pushMainSheetCheck_(checks, DB_SHEETS.WORKBOOK_PLAYER_DATA, DB_COLUMNS.WORKBOOK_PLAYER_DATA);

  var activeWorkbooks = [];
  try {
    activeWorkbooks = getActiveWorkbooks_();
    summary.activeWorkbookCount = activeWorkbooks.length;
    pushWorkbookSystemCheck_(checks, 'activeWorkbooks', activeWorkbooks.length ? 'ok' : 'warning', activeWorkbooks.length ? 'Active workbooks found.' : 'No active workbooks found.', String(activeWorkbooks.length));
  } catch (error) {
    pushWorkbookSystemCheck_(checks, 'activeWorkbooks', 'error', 'Could not read active workbooks.', error.message);
  }

  activeWorkbooks.forEach(function(workbook) {
    pushWorkbookQuestionSheetCheck_(checks, questionsSpreadsheet, workbook);
  });

  pushDefaultWorkbookCheck_(checks, summary.defaultWorkbookId);

  summary.ok = checks.every(function(check) {
    return check.status !== 'error';
  });
  return toClientObject_(summary);
}

function createWorkbook(authToken, workbookPayload) {
  var actor = requireWorkbookManager_(authToken);
  var payload = normalizeWorkbookPayload_(workbookPayload);
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    ensureTableColumns_(DB_SHEETS.WORKBOOKS, DB_COLUMNS.WORKBOOKS);
    var now = new Date();
    var workbookId = generateId_('workbook');
    var workbook = {
      workbookId: workbookId,
      workbookName: payload.workbookName,
      description: payload.description,
      subject: payload.subject,
      questionSheetName: buildQuestionSheetNameForWorkbook_(workbookId),
      createdBy: actor.player.playerId,
      createdByName: actor.player.displayName || actor.player.studentName || '',
      status: STATUS.WORKBOOK_ACTIVE,
      sortOrder: getNextWorkbookSortOrder_(),
      createdAt: now,
      updatedAt: now,
    };

    ensureWorkbookQuestionSheet_(workbook);
    appendRowObject_(DB_SHEETS.WORKBOOKS, workbook);
    clearTableCache_(DB_SHEETS.WORKBOOKS);

    return {
      ok: true,
      workbook: toClientObject_(workbook),
      activeWorkbooks: getActiveWorkbooksForClient_(),
    };
  } finally {
    lock.releaseLock();
  }
}

function archiveWorkbook(authToken, workbookId) {
  var player = getCurrentPlayer_(authToken);
  var targetWorkbookId = String(workbookId || '').trim();
  if (!targetWorkbookId) {
    throw new Error('삭제할 문제집을 선택해 주세요.');
  }

  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    var workbook = requireWorkbook_(targetWorkbookId);
    if (String(workbook.createdBy || '').trim() !== String(player.playerId || '').trim()) {
      throw new Error('자신이 만든 문제집만 삭제할 수 있습니다.');
    }
    if (String(workbook.status || STATUS.WORKBOOK_ACTIVE) !== STATUS.WORKBOOK_ACTIVE) {
      throw new Error('이미 삭제되었거나 비활성화된 문제집입니다.');
    }

    var archivedWorkbook = updateRowByKey_(DB_SHEETS.WORKBOOKS, 'workbookId', targetWorkbookId, {
      status: STATUS.WORKBOOK_ARCHIVED,
      updatedAt: new Date(),
    });
    if (!archivedWorkbook) {
      throw new Error('삭제할 문제집을 찾을 수 없습니다.');
    }
    clearTableCache_(DB_SHEETS.WORKBOOKS);

    return {
      ok: true,
      workbookId: targetWorkbookId,
      activeWorkbooks: getActiveWorkbooksForClient_(),
    };
  } finally {
    lock.releaseLock();
  }
}

function getActiveWorkbooksForClient_() {
  return getActiveWorkbooks_().map(function(workbook) {
    return toClientObject_({
      workbookId: workbook.workbookId,
      workbookName: workbook.workbookName,
      description: workbook.description,
      subject: workbook.subject,
      questionSheetName: workbook.questionSheetName,
      status: workbook.status || STATUS.WORKBOOK_ACTIVE,
      sortOrder: workbook.sortOrder || 0,
      createdBy: workbook.createdBy || '',
      createdByName: workbook.createdByName || '',
      createdAt: workbook.createdAt || '',
      updatedAt: workbook.updatedAt || '',
    });
  });
}

function requireWorkbookManager_(authToken) {
  var player = getCurrentPlayer_(authToken);
  var isTeacher = String(player.role || '').trim() === 'teacher';
  var isAdminUser = isAdmin(getCurrentUserEmail_());
  if (!isTeacher) {
    throw new Error('교사 또는 관리자만 문제집을 생성할 수 있습니다.');
  }
  return {
    player: player,
    isAdmin: isAdminUser,
  };
}

function normalizeWorkbookPayload_(payload) {
  payload = payload || {};
  return {
    workbookName: normalizeWorkbookText_('문제집 이름', payload.workbookName, 60, true),
    subject: normalizeWorkbookText_('과목', payload.subject, 40, false),
    description: normalizeWorkbookText_('설명', payload.description, 300, false),
  };
}

function normalizeWorkbookText_(label, value, maxLength, required) {
  var normalized = String(value || '').trim();
  if (required && !normalized) {
    throw new Error(label + '을 입력해 주세요.');
  }
  if (normalized.length > maxLength) {
    throw new Error(label + '은(는) ' + maxLength + '자 이하로 입력해 주세요.');
  }
  return normalized;
}

function getNextWorkbookSortOrder_() {
  return getWorkbooks_().reduce(function(maxSortOrder, workbook) {
    return Math.max(maxSortOrder, Number(workbook.sortOrder || 0));
  }, 0) + 1;
}

function pushWorkbookSystemCheck_(checks, key, status, message, detail) {
  checks.push({
    key: key,
    status: status,
    message: message,
    detail: detail || '',
  });
}

function pushMainSheetCheck_(checks, sheetName, expectedHeaders) {
  try {
    var sheet = getSheet_(sheetName);
    var headers = getHeaderRow_(sheet);
    var missing = expectedHeaders.filter(function(header) {
      return headers.indexOf(header) === -1;
    });
    pushWorkbookSystemCheck_(
      checks,
      'sheet:' + sheetName,
      missing.length ? 'error' : 'ok',
      missing.length ? sheetName + ' sheet is missing required headers.' : sheetName + ' sheet exists.',
      missing.length ? missing.join(', ') : ''
    );
  } catch (error) {
    pushWorkbookSystemCheck_(checks, 'sheet:' + sheetName, 'error', sheetName + ' sheet does not exist.', error.message);
  }
}

function pushWorkbookQuestionSheetCheck_(checks, questionsSpreadsheet, workbook) {
  var workbookId = String(workbook.workbookId || '').trim();
  var expectedSheetName = String(workbook.questionSheetName || '').trim() || buildQuestionSheetNameForWorkbook_(workbookId);
  if (!questionsSpreadsheet) {
    pushWorkbookSystemCheck_(checks, 'questionSheet:' + workbookId, 'error', 'Question spreadsheet is unavailable, so workbook sheet cannot be checked.', expectedSheetName);
    return;
  }

  var sheet = questionsSpreadsheet.getSheetByName(expectedSheetName);
  if (!sheet) {
    pushWorkbookSystemCheck_(checks, 'questionSheet:' + workbookId, 'error', 'Workbook question sheet is missing.', expectedSheetName);
    return;
  }

  var metadata = sheet.getRange(1, 1, 1, Math.max(8, sheet.getLastColumn())).getValues()[0];
  var metadataOk = String(metadata[0] || '') === 'workbookId' && String(metadata[1] || '') === workbookId;
  var headers = getHeaderRowAt_(sheet, 2);
  var missingHeaders = DB_COLUMNS.QUESTIONS.filter(function(header) {
    return headers.indexOf(header) === -1;
  });

  if (!metadataOk) {
    pushWorkbookSystemCheck_(checks, 'questionSheetMeta:' + workbookId, 'error', 'Workbook question sheet metadata row is invalid.', expectedSheetName);
  } else {
    pushWorkbookSystemCheck_(checks, 'questionSheetMeta:' + workbookId, 'ok', 'Workbook question sheet metadata row is valid.', expectedSheetName);
  }

  pushWorkbookSystemCheck_(
    checks,
    'questionSheetHeader:' + workbookId,
    missingHeaders.length ? 'error' : 'ok',
    missingHeaders.length ? 'Workbook question sheet header row is missing columns.' : 'Workbook question sheet header row is valid.',
    missingHeaders.length ? expectedSheetName + ': ' + missingHeaders.join(', ') : expectedSheetName
  );
}

function pushDefaultWorkbookCheck_(checks, defaultWorkbookId) {
  var targetWorkbookId = String(defaultWorkbookId || '').trim();
  if (!targetWorkbookId) {
    pushWorkbookSystemCheck_(checks, 'defaultWorkbookId', 'warning', 'defaultWorkbookId is empty. Legacy runs without workbookId will not have a fallback.', '');
    return;
  }

  try {
    var workbook = requireWorkbook_(targetWorkbookId);
    var status = String(workbook.status || STATUS.WORKBOOK_ACTIVE);
    pushWorkbookSystemCheck_(
      checks,
      'defaultWorkbookId',
      status === STATUS.WORKBOOK_ACTIVE ? 'ok' : 'warning',
      status === STATUS.WORKBOOK_ACTIVE ? 'defaultWorkbookId points to an active workbook.' : 'defaultWorkbookId points to a non-active workbook.',
      targetWorkbookId
    );
  } catch (error) {
    pushWorkbookSystemCheck_(checks, 'defaultWorkbookId', 'error', 'defaultWorkbookId points to a missing workbook.', targetWorkbookId);
  }
}
