function getMyInfo(playerId, authToken) {
  var player = authToken ? getCurrentPlayer_(authToken) : findRowByKey_(DB_SHEETS.PLAYERS, 'playerId', playerId);
  if (!player || player.playerId !== playerId) {
    throw new Error('내 정보를 확인할 수 없습니다.');
  }

  var playerData = getPlayerData_(playerId) || ensurePlayerData_(playerId);
  var summary = getPlayerAnswerSummary(playerId);
  return toClientObject_({
    player: player,
    playerData: playerData,
    summary: summary,
    questionStats: getMyQuestionStats(playerId),
  });
}

function getMyQuestionStats(playerId) {
  return readAllActiveWorkbookQuestions_().filter(function(question) {
    return String(question.creatorId || '') === String(playerId || '');
  }).map(function(question) {
    var total = Number(question.totalCount || 0);
    var correct = Number(question.correctCount || 0);
    return {
      questionId: question.questionId,
      prompt: question.prompt,
      type: question.type,
      subject: question.subject,
      unit: question.unit,
      status: question.status,
      difficulty: question.difficulty,
      correctCount: correct,
      totalCount: total,
      likeCount: Number(question.likeCount || 0),
      dislikeCount: Number(question.dislikeCount || 0),
      correctRate: calculateRate_(correct, total),
      createdAt: question.createdAt,
    };
  });
}

function getPlayerAnswerSummary(playerId) {
  var playerData = getPlayerData_(playerId) || ensurePlayerData_(playerId);
  var total = Number(playerData.totalAnswerCount || 0);
  var correct = Number(playerData.correctAnswerCount || 0);
  return {
    playerId: playerId,
    totalAnswerCount: total,
    correctAnswerCount: correct,
    correctRate: calculateRate_(correct, total),
    averageAnswerTimeMs: Math.round(Number(playerData.averageAnswerTimeMs || 0)),
    maxFloor: Number(playerData.maxFloor || 1),
    maxStage: Number(playerData.maxStage || 1),
    currency: Number(playerData.currency || 0),
    bestScore: Number(playerData.bestScore || 0),
  };
}

function getAdminPlayerStats() {
  requireAdmin_();
  var playerDataById = indexBy_(readTable_(DB_SHEETS.PLAYER_DATA), 'playerId');
  return readTable_(DB_SHEETS.PLAYERS).map(function(player) {
    var data = playerDataById[player.playerId] || {};
    var total = Number(data.totalAnswerCount || 0);
    var correct = Number(data.correctAnswerCount || 0);
    return {
      playerId: player.playerId,
      studentId: player.studentId,
      studentName: player.studentName,
      displayName: player.displayName,
      totalAnswerCount: total,
      correctAnswerCount: correct,
      correctRate: calculateRate_(correct, total),
      averageAnswerTimeMs: Math.round(Number(data.averageAnswerTimeMs || 0)),
      maxFloor: Number(data.maxFloor || 1),
      maxStage: Number(data.maxStage || 1),
      currency: Number(data.currency || 0),
      lastLoginAt: player.lastLoginAt,
    };
  }).sort(function(a, b) {
    return String(a.studentId).localeCompare(String(b.studentId));
  });
}

function getAdminQuestionStats() {
  requireAdmin_();
  var playerById = indexBy_(readTable_(DB_SHEETS.PLAYERS), 'playerId');
  return readAllActiveWorkbookQuestions_().map(function(question) {
    var total = Number(question.totalCount || 0);
    var correct = Number(question.correctCount || 0);
    var creator = playerById[question.creatorId] || {};
    return {
      questionId: question.questionId,
      prompt: question.prompt,
      type: question.type,
      creatorId: question.creatorId,
      creatorName: question.creatorName || creator.displayName || '',
      subject: question.subject,
      unit: question.unit,
      status: question.status,
      difficulty: question.difficulty,
      correctCount: correct,
      totalCount: total,
      likeCount: Number(question.likeCount || 0),
      dislikeCount: Number(question.dislikeCount || 0),
      correctRate: calculateRate_(correct, total),
      createdAt: question.createdAt,
    };
  }).sort(function(a, b) {
    return Number(b.totalCount || 0) - Number(a.totalCount || 0);
  });
}

function recalculateStatsForDev() {
  requireAdmin_();
  var logs = readTable_(DB_SHEETS.ANSWER_LOGS);
  var players = readTable_(DB_SHEETS.PLAYERS);
  var playerSummary = {};
  var questionSummary = {};

  logs.forEach(function(log) {
    var playerId = log.playerId;
    var questionId = log.questionId;
    var elapsed = Number(log.elapsedMs || 0);
    var correct = isTruthy_(log.isCorrect);

    if (playerId) {
      playerSummary[playerId] = playerSummary[playerId] || { total: 0, correct: 0, elapsedTotal: 0 };
      playerSummary[playerId].total += 1;
      playerSummary[playerId].correct += correct ? 1 : 0;
      playerSummary[playerId].elapsedTotal += elapsed;
    }

    if (questionId) {
      questionSummary[questionId] = questionSummary[questionId] || { total: 0, correct: 0 };
      questionSummary[questionId].total += 1;
      questionSummary[questionId].correct += correct ? 1 : 0;
    }
  });

  players.forEach(function(player) {
    var currentData = getPlayerData_(player.playerId) || ensurePlayerData_(player.playerId);
    var summary = playerSummary[player.playerId] || { total: 0, correct: 0, elapsedTotal: 0 };
    updateRowByKey_(DB_SHEETS.PLAYER_DATA, 'playerId', player.playerId, {
      totalAnswerCount: summary.total,
      correctAnswerCount: summary.correct,
      averageAnswerTimeMs: summary.total > 0 ? Math.round(summary.elapsedTotal / summary.total) : 0,
      maxFloor: Number(currentData.maxFloor || 1),
      maxStage: Number(currentData.maxStage || 1),
      updatedAt: new Date(),
    });
  });

  var touchedWorkbookIds = {};
  readAllActiveWorkbookQuestions_().forEach(function(question) {
    var summary = questionSummary[question.questionId] || { total: 0, correct: 0 };
    updateWorkbookQuestionById_(question.workbookId, question.questionId, {
      correctCount: summary.correct,
      totalCount: summary.total,
      updatedAt: new Date(),
    });
    touchedWorkbookIds[question.workbookId] = true;
  });
  Object.keys(touchedWorkbookIds).forEach(clearWorkbookQuestionCache_);
  return { ok: true, playerCount: players.length, answerLogCount: logs.length };
}

function updatePlayerAnswerCache_(answerPayload) {
  var playerId = answerPayload.playerId;
  if (!playerId) {
    return null;
  }
  var playerData = getPlayerData_(playerId) || ensurePlayerData_(playerId);
  var total = Number(playerData.totalAnswerCount || 0);
  var correct = Number(playerData.correctAnswerCount || 0);
  var average = Number(playerData.averageAnswerTimeMs || 0);
  var elapsed = Number(answerPayload.elapsedMs || 0);
  var nextTotal = total + 1;
  var updatedPlayerData = updateRowByKey_(DB_SHEETS.PLAYER_DATA, 'playerId', playerId, {
    totalAnswerCount: nextTotal,
    correctAnswerCount: correct + (answerPayload.isCorrect ? 1 : 0),
    averageAnswerTimeMs: Math.round(((average * total) + elapsed) / nextTotal),
    updatedAt: new Date(),
  });
  updateWorkbookPlayerAnswerCache_(answerPayload);
  return updatedPlayerData;
}

function updateWorkbookPlayerAnswerCache_(answerPayload) {
  var payload = answerPayload || {};
  if (!payload.runId || typeof requireRun_ !== 'function') {
    return null;
  }

  var run = requireRun_(payload.runId);
  var workbookId = getRunWorkbookId_(run);
  if (!workbookId) {
    return null;
  }
  if (payload.playerId && String(payload.playerId) !== String(run.playerId)) {
    throw new Error('Answer player does not match the run player.');
  }

  var playerId = run.playerId;
  var workbookData = getWorkbookPlayerData_(workbookId, playerId) || ensureWorkbookPlayerData_(workbookId, playerId);
  var total = Number(workbookData.totalAnswerCount || 0);
  var correct = Number(workbookData.correctAnswerCount || 0);
  var average = Number(workbookData.averageAnswerTimeMs || 0);
  var elapsed = Number(payload.elapsedMs || 0);
  var nextTotal = total + 1;
  return updateWorkbookPlayerData_(workbookId, playerId, {
    totalAnswerCount: nextTotal,
    correctAnswerCount: correct + (payload.isCorrect ? 1 : 0),
    averageAnswerTimeMs: Math.round(((average * total) + elapsed) / nextTotal),
    updatedAt: new Date(),
  });
}

function getWorkbookPlayerData_(workbookId, playerId) {
  var rowInfo = findWorkbookPlayerDataRow_(workbookId, playerId);
  return rowInfo ? rowInfo.data : null;
}

function ensureWorkbookPlayerData_(workbookId, playerId) {
  var existing = getWorkbookPlayerData_(workbookId, playerId);
  if (existing) {
    return existing;
  }
  var initialData = buildInitialWorkbookPlayerData_(workbookId, playerId);
  appendRowObject_(DB_SHEETS.WORKBOOK_PLAYER_DATA, initialData);
  return initialData;
}

function updateWorkbookPlayerData_(workbookId, playerId, patchObject) {
  ensureTableColumns_(DB_SHEETS.WORKBOOK_PLAYER_DATA, DB_COLUMNS.WORKBOOK_PLAYER_DATA);
  var sheet = getSheet_(DB_SHEETS.WORKBOOK_PLAYER_DATA);
  var headers = getHeaderRow_(sheet);
  var rowInfo = findWorkbookPlayerDataRow_(workbookId, playerId, sheet, headers);
  var updatedObject;

  if (!rowInfo) {
    updatedObject = Object.assign(buildInitialWorkbookPlayerData_(workbookId, playerId), patchObject || {});
    appendRowObject_(DB_SHEETS.WORKBOOK_PLAYER_DATA, updatedObject);
    return updatedObject;
  }

  updatedObject = Object.assign({}, rowInfo.data, patchObject || {});
  var updatedRow = headers.map(function(header) {
    return updatedObject[header] !== undefined ? updatedObject[header] : '';
  });
  sheet.getRange(rowInfo.rowNumber, 1, 1, headers.length).setValues([updatedRow]);
  return updatedObject;
}

function findWorkbookPlayerDataRow_(workbookId, playerId, sheet, headers) {
  ensureTableColumns_(DB_SHEETS.WORKBOOK_PLAYER_DATA, DB_COLUMNS.WORKBOOK_PLAYER_DATA);
  sheet = sheet || getSheet_(DB_SHEETS.WORKBOOK_PLAYER_DATA);
  headers = headers || getHeaderRow_(sheet);
  var workbookIndex = headers.indexOf('workbookId');
  var playerIndex = headers.indexOf('playerId');
  if (workbookIndex === -1 || playerIndex === -1) {
    throw new Error('WorkbookPlayerData sheet is missing workbookId or playerId.');
  }

  var targetWorkbookId = String(workbookId || '').trim();
  var targetPlayerId = String(playerId || '').trim();
  if (!targetWorkbookId || !targetPlayerId) {
    return null;
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  for (var i = 0; i < values.length; i += 1) {
    if (String(values[i][workbookIndex] || '').trim() === targetWorkbookId &&
        String(values[i][playerIndex] || '').trim() === targetPlayerId) {
      return {
        rowNumber: i + 2,
        data: rowToObject_(headers, values[i]),
      };
    }
  }
  return null;
}

function buildInitialWorkbookPlayerData_(workbookId, playerId) {
  return {
    workbookId: String(workbookId || '').trim(),
    playerId: String(playerId || '').trim(),
    maxFloor: 1,
    maxStage: 1,
    bestClearTimeMs: '',
    totalAnswerCount: 0,
    correctAnswerCount: 0,
    averageAnswerTimeMs: 0,
    currency: 0,
    bestScore: 0,
    bestScoreRunId: '',
    bestScoreUpdatedAt: '',
    updatedAt: new Date(),
  };
}

function processPendingBattleStats(maxRows) {
  var lock = LockService.getScriptLock();
  if (!lock.tryLock(30000)) {
    return { ok: false, locked: true, processedCount: 0 };
  }

  try {
    return processPendingBattleStatsLocked_(maxRows);
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {}
  }
}

function installBattleStatsTrigger() {
  var handlerName = 'processPendingBattleStats';
  ScriptApp.getProjectTriggers().forEach(function(trigger) {
    if (trigger.getHandlerFunction && trigger.getHandlerFunction() === handlerName) {
      ScriptApp.deleteTrigger(trigger);
    }
  });
  ScriptApp.newTrigger(handlerName).timeBased().everyMinutes(5).create();
  return {
    ok: true,
    handler: handlerName,
    schedule: 'every 5 minutes',
  };
}

function processPendingBattleStatsLocked_(maxRows) {
  var queuedLogResult = drainPendingBattleAnswerLogQueue_(maxRows);
  ensureTableColumns_(DB_SHEETS.ANSWER_LOGS, DB_COLUMNS.ANSWER_LOGS);
  ensureTableColumns_(DB_SHEETS.PLAYER_DATA, DB_COLUMNS.PLAYER_DATA);
  ensureTableColumns_(DB_SHEETS.WORKBOOK_PLAYER_DATA, DB_COLUMNS.WORKBOOK_PLAYER_DATA);

  var limit = Math.max(1, Math.min(1000, Math.round(Number(maxRows || 200))));
  var sheet = getSheet_(DB_SHEETS.ANSWER_LOGS);
  var headers = getHeaderRow_(sheet);
  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return {
      ok: true,
      queuedLogBatchCount: Number(queuedLogResult.processedQueueCount || 0),
      queuedAnswerLogCount: Number(queuedLogResult.appendedAnswerLogCount || 0),
      processedCount: 0,
      errorCount: Number(queuedLogResult.errorQueueCount || 0),
    };
  }

  var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
  var pendingRows = [];
  var answerLogIdIndex = headers.indexOf('answerLogId');
  var seenAnswerLogIds = {};
  for (var i = 0; i < values.length; i += 1) {
    var log = rowToObject_(headers, values[i]);
    var answerLogId = answerLogIdIndex >= 0 ? String(values[i][answerLogIdIndex] || '').trim() : '';
    var duplicateAnswerLogId = !!(answerLogId && seenAnswerLogIds[answerLogId]);
    if (answerLogId) {
      seenAnswerLogIds[answerLogId] = true;
    }
    if (!isPendingBattleStatLog_(log)) {
      continue;
    }
    pendingRows.push({
      rowNumber: i + 2,
      log: log,
      duplicateAnswerLogId: duplicateAnswerLogId,
    });
    if (pendingRows.length >= limit) {
      break;
    }
  }

  if (!pendingRows.length) {
    return {
      ok: true,
      queuedLogBatchCount: Number(queuedLogResult.processedQueueCount || 0),
      queuedAnswerLogCount: Number(queuedLogResult.appendedAnswerLogCount || 0),
      processedCount: 0,
      errorCount: Number(queuedLogResult.errorQueueCount || 0),
    };
  }

  var prepared = prepareBattleStatsBatch_(pendingRows);
  markBattleStatErrorRows_(sheet, headers, prepared.errorRows);

  if (prepared.rows.length) {
    // Deferred stats work: update question/player aggregates once per question/player,
    // then invalidate workbook question caches once per affected workbook.
    applyBattleQuestionStatsBatch_(prepared.questionSummaryByWorkbook);
    applyBattlePlayerStatsBatch_(prepared.playerSummaryById);
    applyBattleWorkbookPlayerStatsBatch_(prepared.workbookPlayerSummaryByKey);
    markBattleStatSuccessRows_(sheet, headers, prepared.rows);
  }

  return {
    ok: true,
    queuedLogBatchCount: Number(queuedLogResult.processedQueueCount || 0),
    queuedAnswerLogCount: Number(queuedLogResult.appendedAnswerLogCount || 0),
    processedCount: prepared.rows.length,
    errorCount: prepared.errorRows.length + Number(queuedLogResult.errorQueueCount || 0),
    requestedCount: pendingRows.length,
  };
}

function drainPendingBattleAnswerLogQueue_(maxRows) {
  ensureBattleAnswerLogQueueSheet_();
  ensureTableColumns_(DB_SHEETS.ANSWER_LOGS, DB_COLUMNS.ANSWER_LOGS);
  var limit = Math.max(1, Math.min(1000, Math.round(Number(maxRows || 200))));
  var queueSheet = getSheet_(DB_SHEETS.BATTLE_ANSWER_LOG_QUEUE);
  var queueHeaders = getHeaderRow_(queueSheet);
  var lastRow = queueSheet.getLastRow();
  if (lastRow < 2) {
    return { processedQueueCount: 0, appendedAnswerLogCount: 0, errorQueueCount: 0 };
  }

  var values = queueSheet.getRange(2, 1, lastRow - 1, queueHeaders.length).getValues();
  var pendingQueueRows = [];
  var queuedAnswerLogCount = 0;
  for (var i = 0; i < values.length; i += 1) {
    var queueRow = rowToObject_(queueHeaders, values[i]);
    if (!isPendingBattleAnswerLogQueueRow_(queueRow)) {
      continue;
    }
    var logs = safeJsonParse_(queueRow.logsJson, []);
    if (!Array.isArray(logs)) {
      pendingQueueRows.push({
        rowNumber: i + 2,
        row: queueRow,
        logs: [],
        error: 'logsJson is not an array.',
      });
      continue;
    }
    pendingQueueRows.push({
      rowNumber: i + 2,
      row: queueRow,
      logs: logs,
      error: '',
    });
    queuedAnswerLogCount += logs.length;
    if (queuedAnswerLogCount >= limit) {
      break;
    }
  }

  if (!pendingQueueRows.length) {
    return { processedQueueCount: 0, appendedAnswerLogCount: 0, errorQueueCount: 0 };
  }

  var existingAnswerLogIds = getExistingAnswerLogIdMap_();
  var answerLogsToAppend = [];
  var successRows = [];
  var errorRows = [];
  pendingQueueRows.forEach(function(entry) {
    if (entry.error) {
      errorRows.push(entry);
      return;
    }
    entry.logs.forEach(function(log) {
      var answerLogId = String(log && log.answerLogId || '').trim();
      if (!answerLogId || existingAnswerLogIds[answerLogId]) {
        return;
      }
      existingAnswerLogIds[answerLogId] = true;
      answerLogsToAppend.push(log);
    });
    successRows.push(entry);
  });

  if (answerLogsToAppend.length) {
    appendRowObjects_(DB_SHEETS.ANSWER_LOGS, answerLogsToAppend);
  }
  markBattleAnswerLogQueueRows_(queueSheet, queueHeaders, successRows, true, new Date(), '');
  markBattleAnswerLogQueueRows_(queueSheet, queueHeaders, errorRows, false, '', 'logsJson is not an array.');

  return {
    processedQueueCount: successRows.length,
    appendedAnswerLogCount: answerLogsToAppend.length,
    errorQueueCount: errorRows.length,
  };
}

function isPendingBattleAnswerLogQueueRow_(row) {
  var value = row && row.processed;
  var normalized = String(value).trim().toLowerCase();
  return value === false || normalized === '' || normalized === 'false' || normalized === 'pending';
}

function getExistingAnswerLogIdMap_() {
  ensureTableColumns_(DB_SHEETS.ANSWER_LOGS, DB_COLUMNS.ANSWER_LOGS);
  var sheet = getSheet_(DB_SHEETS.ANSWER_LOGS);
  var headers = getHeaderRow_(sheet);
  var answerLogIdIndex = headers.indexOf('answerLogId');
  var map = {};
  var lastRow = sheet.getLastRow();
  if (answerLogIdIndex === -1 || lastRow < 2) {
    return map;
  }
  var values = sheet.getRange(2, answerLogIdIndex + 1, lastRow - 1, 1).getValues();
  values.forEach(function(row) {
    var answerLogId = String(row[0] || '').trim();
    if (answerLogId) {
      map[answerLogId] = true;
    }
  });
  return map;
}

function markBattleAnswerLogQueueRows_(sheet, headers, rows, processed, processedAt, errorMessage) {
  if (!rows || !rows.length) {
    return;
  }
  var processedIndex = headers.indexOf('processed');
  var processedAtIndex = headers.indexOf('processedAt');
  var errorIndex = headers.indexOf('processError');
  if (processedIndex === -1 || processedAtIndex === -1 || errorIndex === -1) {
    throw new Error('BattleAnswerLogQueue sheet is missing processing columns.');
  }
  rows.forEach(function(row) {
    sheet.getRange(row.rowNumber, processedIndex + 1, 1, 1).setValue(processed);
    sheet.getRange(row.rowNumber, processedAtIndex + 1, 1, 1).setValue(processedAt || '');
    sheet.getRange(row.rowNumber, errorIndex + 1, 1, 1).setValue(errorMessage || '');
  });
}

function isPendingBattleStatLog_(log) {
  var value = log && log.statsProcessed;
  var normalized = String(value).trim().toLowerCase();
  // Blank legacy rows were already processed by the old synchronous path.
  return value === false || normalized === 'false' || normalized === 'pending';
}

function prepareBattleStatsBatch_(pendingRows) {
  var runCache = {};
  var rows = [];
  var errorRows = [];
  var questionSummaryByWorkbook = {};
  var playerSummaryById = {};
  var workbookPlayerSummaryByKey = {};

  pendingRows.forEach(function(entry) {
    var log = entry.log || {};
    var answerLogId = String(log.answerLogId || '').trim();
    var runId = String(log.runId || '').trim();
    var playerId = String(log.playerId || '').trim();
    var questionId = String(log.questionId || '').trim();
    if (!answerLogId || !runId || !playerId || !questionId) {
      errorRows.push(Object.assign({}, entry, { error: 'Missing answerLogId, runId, playerId, or questionId.' }));
      return;
    }
    if (entry.duplicateAnswerLogId) {
      errorRows.push(Object.assign({}, entry, { error: 'Duplicate answerLogId; skipped to avoid double-counting stats.' }));
      return;
    }

    var run;
    try {
      run = runCache[runId] || requireRun_(runId);
      runCache[runId] = run;
    } catch (error) {
      errorRows.push(Object.assign({}, entry, { error: 'Run not found: ' + runId }));
      return;
    }

    var workbookId = getRunWorkbookId_(run);
    if (!workbookId) {
      errorRows.push(Object.assign({}, entry, { error: 'Run has no workbookId: ' + runId }));
      return;
    }
    if (String(run.playerId || '').trim() !== playerId) {
      errorRows.push(Object.assign({}, entry, { error: 'Answer player does not match run player.' }));
      return;
    }
    if (!findWorkbookQuestionById_(workbookId, questionId)) {
      errorRows.push(Object.assign({}, entry, { error: 'Question not found in workbook: ' + questionId }));
      return;
    }

    var correct = normalizeBattleStatBoolean_(log.isCorrect);
    var elapsed = Math.max(0, Number(log.elapsedMs || 0));
    addBattleQuestionSummary_(questionSummaryByWorkbook, workbookId, questionId, correct);
    addBattlePlayerSummary_(playerSummaryById, playerId, correct, elapsed);
    addBattleWorkbookPlayerSummary_(workbookPlayerSummaryByKey, workbookId, playerId, correct, elapsed);
    rows.push(entry);
  });

  return {
    rows: rows,
    errorRows: errorRows,
    questionSummaryByWorkbook: questionSummaryByWorkbook,
    playerSummaryById: playerSummaryById,
    workbookPlayerSummaryByKey: workbookPlayerSummaryByKey,
  };
}

function addBattleQuestionSummary_(summaryByWorkbook, workbookId, questionId, correct) {
  summaryByWorkbook[workbookId] = summaryByWorkbook[workbookId] || {};
  summaryByWorkbook[workbookId][questionId] = summaryByWorkbook[workbookId][questionId] || { total: 0, correct: 0 };
  summaryByWorkbook[workbookId][questionId].total += 1;
  summaryByWorkbook[workbookId][questionId].correct += correct ? 1 : 0;
}

function addBattlePlayerSummary_(summaryById, playerId, correct, elapsed) {
  summaryById[playerId] = summaryById[playerId] || { total: 0, correct: 0, elapsedTotal: 0 };
  summaryById[playerId].total += 1;
  summaryById[playerId].correct += correct ? 1 : 0;
  summaryById[playerId].elapsedTotal += elapsed;
}

function addBattleWorkbookPlayerSummary_(summaryByKey, workbookId, playerId, correct, elapsed) {
  var key = workbookId + '\u0001' + playerId;
  summaryByKey[key] = summaryByKey[key] || {
    workbookId: workbookId,
    playerId: playerId,
    total: 0,
    correct: 0,
    elapsedTotal: 0,
  };
  summaryByKey[key].total += 1;
  summaryByKey[key].correct += correct ? 1 : 0;
  summaryByKey[key].elapsedTotal += elapsed;
}

function applyBattleQuestionStatsBatch_(summaryByWorkbook) {
  Object.keys(summaryByWorkbook || {}).forEach(function(workbookId) {
    var summaryByQuestion = summaryByWorkbook[workbookId] || {};
    var questionIds = Object.keys(summaryByQuestion);
    if (!questionIds.length) {
      return;
    }

    var sheet = getWorkbookQuestionSheet_(workbookId);
    var headers = getHeaderRowAt_(sheet, 2);
    var questionIdIndex = headers.indexOf('questionId');
    if (questionIdIndex === -1) {
      throw new Error('Question sheet header is missing questionId.');
    }

    var lastRow = sheet.getLastRow();
    if (lastRow < 3) {
      throw new Error('Question sheet has no data rows: ' + workbookId);
    }

    var values = sheet.getRange(3, 1, lastRow - 2, headers.length).getValues();
    var rowByQuestionId = {};
    values.forEach(function(row, index) {
      rowByQuestionId[String(row[questionIdIndex] || '').trim()] = {
        rowNumber: index + 3,
        row: row,
      };
    });

    questionIds.forEach(function(questionId) {
      var rowInfo = rowByQuestionId[questionId];
      if (!rowInfo) {
        throw new Error('Question not found while applying stats: ' + questionId);
      }
      var current = rowToObject_(headers, rowInfo.row);
      var delta = summaryByQuestion[questionId];
      var updated = Object.assign({}, current, {
        correctCount: Number(current.correctCount || 0) + Number(delta.correct || 0),
        totalCount: Number(current.totalCount || 0) + Number(delta.total || 0),
        updatedAt: new Date(),
      });
      var updatedRow = headers.map(function(header) {
        return updated[header] !== undefined ? updated[header] : '';
      });
      sheet.getRange(rowInfo.rowNumber, 1, 1, headers.length).setValues([updatedRow]);
    });

    clearWorkbookQuestionCache_(workbookId);
  });
}

function applyBattlePlayerStatsBatch_(summaryById) {
  var playerIds = Object.keys(summaryById || {});
  if (!playerIds.length) {
    return;
  }

  var sheet = getSheet_(DB_SHEETS.PLAYER_DATA);
  var headers = getHeaderRow_(sheet);
  var playerIdIndex = headers.indexOf('playerId');
  if (playerIdIndex === -1) {
    throw new Error('PlayerData sheet is missing playerId.');
  }

  var rowByPlayerId = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    values.forEach(function(row, index) {
      rowByPlayerId[String(row[playerIdIndex] || '').trim()] = {
        rowNumber: index + 2,
        row: row,
      };
    });
  }

  var rowsToAppend = [];
  playerIds.forEach(function(playerId) {
    var rowInfo = rowByPlayerId[playerId];
    var current = rowInfo ? rowToObject_(headers, rowInfo.row) : buildInitialBattleStatsPlayerData_(playerId);
    var updated = applyAnswerSummaryToStatsRow_(current, summaryById[playerId]);
    var updatedRow = headers.map(function(header) {
      return updated[header] !== undefined ? updated[header] : '';
    });
    if (rowInfo) {
      sheet.getRange(rowInfo.rowNumber, 1, 1, headers.length).setValues([updatedRow]);
    } else {
      rowsToAppend.push(updated);
    }
  });

  if (rowsToAppend.length) {
    appendRowObjects_(DB_SHEETS.PLAYER_DATA, rowsToAppend);
  }
}

function applyBattleWorkbookPlayerStatsBatch_(summaryByKey) {
  var keys = Object.keys(summaryByKey || {});
  if (!keys.length) {
    return;
  }

  var sheet = getSheet_(DB_SHEETS.WORKBOOK_PLAYER_DATA);
  var headers = getHeaderRow_(sheet);
  var workbookIdIndex = headers.indexOf('workbookId');
  var playerIdIndex = headers.indexOf('playerId');
  if (workbookIdIndex === -1 || playerIdIndex === -1) {
    throw new Error('WorkbookPlayerData sheet is missing workbookId or playerId.');
  }

  var rowByKey = {};
  var lastRow = sheet.getLastRow();
  if (lastRow >= 2) {
    var values = sheet.getRange(2, 1, lastRow - 1, headers.length).getValues();
    values.forEach(function(row, index) {
      var key = String(row[workbookIdIndex] || '').trim() + '\u0001' + String(row[playerIdIndex] || '').trim();
      rowByKey[key] = {
        rowNumber: index + 2,
        row: row,
      };
    });
  }

  var rowsToAppend = [];
  keys.forEach(function(key) {
    var summary = summaryByKey[key];
    var rowInfo = rowByKey[key];
    var current = rowInfo ? rowToObject_(headers, rowInfo.row) : buildInitialWorkbookPlayerData_(summary.workbookId, summary.playerId);
    var updated = applyAnswerSummaryToStatsRow_(current, summary);
    var updatedRow = headers.map(function(header) {
      return updated[header] !== undefined ? updated[header] : '';
    });
    if (rowInfo) {
      sheet.getRange(rowInfo.rowNumber, 1, 1, headers.length).setValues([updatedRow]);
    } else {
      rowsToAppend.push(updated);
    }
  });

  if (rowsToAppend.length) {
    appendRowObjects_(DB_SHEETS.WORKBOOK_PLAYER_DATA, rowsToAppend);
  }
}

function applyAnswerSummaryToStatsRow_(current, summary) {
  var total = Number(current.totalAnswerCount || 0);
  var correct = Number(current.correctAnswerCount || 0);
  var average = Number(current.averageAnswerTimeMs || 0);
  var deltaTotal = Number(summary.total || 0);
  var nextTotal = total + deltaTotal;
  return Object.assign({}, current, {
    totalAnswerCount: nextTotal,
    correctAnswerCount: correct + Number(summary.correct || 0),
    averageAnswerTimeMs: nextTotal > 0
      ? Math.round(((average * total) + Number(summary.elapsedTotal || 0)) / nextTotal)
      : 0,
    updatedAt: new Date(),
  });
}

function buildInitialBattleStatsPlayerData_(playerId) {
  return {
    playerId: playerId,
    maxFloor: 1,
    maxStage: 1,
    bestClearTimeMs: '',
    totalAnswerCount: 0,
    correctAnswerCount: 0,
    averageAnswerTimeMs: 0,
    currency: 0,
    baseStatsJson: safeJsonStringify_(BASE_PLAYER_STATS),
    ownedSkillsJson: safeJsonStringify_([]),
    ownedItemsJson: safeJsonStringify_([]),
    bestScore: 0,
    bestScoreRunId: '',
    bestScoreUpdatedAt: '',
    updatedAt: new Date(),
  };
}

function markBattleStatSuccessRows_(sheet, headers, rows) {
  markBattleStatRows_(sheet, headers, rows, true, new Date(), '');
}

function markBattleStatErrorRows_(sheet, headers, rows) {
  (rows || []).forEach(function(row) {
    markBattleStatRows_(sheet, headers, [row], false, '', truncateBattleStatError_(row.error || 'Unknown stats processing error.'));
  });
}

function markBattleStatRows_(sheet, headers, rows, processed, processedAt, errorMessage) {
  if (!rows || !rows.length) {
    return;
  }
  var processedIndex = headers.indexOf('statsProcessed');
  var processedAtIndex = headers.indexOf('statsProcessedAt');
  var errorIndex = headers.indexOf('statsProcessError');
  if (processedIndex === -1 || processedAtIndex === -1 || errorIndex === -1) {
    throw new Error('AnswerLogs sheet is missing stats processing columns.');
  }

  rows.forEach(function(row) {
    sheet.getRange(row.rowNumber, processedIndex + 1, 1, 1).setValue(processed);
    sheet.getRange(row.rowNumber, processedAtIndex + 1, 1, 1).setValue(processedAt || '');
    sheet.getRange(row.rowNumber, errorIndex + 1, 1, 1).setValue(errorMessage || '');
  });
}

function normalizeBattleStatBoolean_(value) {
  if (value === true) {
    return true;
  }
  var text = String(value).trim().toLowerCase();
  return text === 'true' || text === 'yes' || text === '1';
}

function truncateBattleStatError_(errorMessage) {
  return String(errorMessage || '').slice(0, 500);
}

function calculateRate_(correct, total) {
  var denominator = Number(total || 0);
  if (denominator <= 0) {
    return 0;
  }
  return Math.round((Number(correct || 0) / denominator) * 1000) / 10;
}

function indexBy_(rows, key) {
  return (rows || []).reduce(function(index, row) {
    index[row[key]] = row;
    return index;
  }, {});
}
