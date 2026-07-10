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
  return readTable_(DB_SHEETS.QUESTIONS).filter(function(question) {
    return question.creatorId === playerId;
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
  return readTable_(DB_SHEETS.QUESTIONS).map(function(question) {
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

  readTable_(DB_SHEETS.QUESTIONS).forEach(function(question) {
    var summary = questionSummary[question.questionId] || { total: 0, correct: 0 };
    updateRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', question.questionId, {
      correctCount: summary.correct,
      totalCount: summary.total,
      updatedAt: new Date(),
    });
  });
  clearTableCache_(DB_SHEETS.QUESTIONS);
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
