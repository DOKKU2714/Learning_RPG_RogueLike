function getLeaderboard(workbookId) {
  var workbook = requireActiveLeaderboardWorkbook_(workbookId);
  ensureTableColumns_(DB_SHEETS.WORKBOOK_PLAYER_DATA, DB_COLUMNS.WORKBOOK_PLAYER_DATA);
  ensureTableColumns_(DB_SHEETS.PLAYERS, DB_COLUMNS.PLAYERS);

  var playerMap = {};
  readTable_(DB_SHEETS.PLAYERS).forEach(function(player) {
    if (String(player.isActive) === 'false') {
      return;
    }
    playerMap[player.playerId] = player;
  });

  var leaderboardData = buildLeaderboardStats_(workbook.workbookId);
  var rows = leaderboardData.filter(function(playerData) {
    return String(playerData.workbookId || '').trim() === workbook.workbookId;
  }).map(function(playerData) {
    var player = playerMap[playerData.playerId] || {};
    var accuracyRate = calculateAccuracyRate(playerData);
    var clearTimeMs = normalizeClearTimeForSort_(playerData.bestClearTimeMs);
    var displayName = player.displayName || player.studentName || player.email || '\uC774\uB984 \uC5C6\uC74C';
    var maxFloor = Number(playerData.maxFloor || 0);
    var maxStage = Number(playerData.maxStage || 0);
    var bestScore = Number(playerData.bestScore || 0);

    return {
      rank: 0,
      workbookId: workbook.workbookId,
      workbookName: workbook.workbookName || workbook.workbookId,
      playerId: playerData.playerId,
      displayName: displayName,
      bestScore: bestScore,
      scoreText: formatScore_(bestScore),
      progressText: formatDisplayProgressText_(maxFloor, maxStage),
      maxFloor: maxFloor,
      maxStage: maxStage,
      progressScore: calculateProgressScore(playerData),
      clearTimeMs: clearTimeMs,
      clearTimeText: formatClearTime(clearTimeMs),
      accuracyRate: accuracyRate,
      accuracyText: accuracyRate.toFixed(1).replace(/\.0$/, '') + '%',
    };
  }).filter(function(row) {
    return !!row.playerId && !!playerMap[row.playerId];
  });

  sortLeaderboardRows(rows);
  rows.forEach(function(row, index) {
    row.rank = index + 1;
  });
  return rows;
}

function resetLeaderboard(workbookId, authToken) {
  requireLeaderboardManager_(authToken);
  var workbook = requireActiveLeaderboardWorkbook_(workbookId);

  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    ensureTableColumns_(DB_SHEETS.WORKBOOK_PLAYER_DATA, DB_COLUMNS.WORKBOOK_PLAYER_DATA);
    var sheet = getSheet_(DB_SHEETS.WORKBOOK_PLAYER_DATA);
    var headers = getHeaderRow_(sheet);
    var workbookIdIndex = headers.indexOf('workbookId');
    if (workbookIdIndex === -1) {
      throw new Error('\uB9AC\uB354\uBCF4\uB4DC \uB370\uC774\uD130\uC5D0 workbookId \uC5F4\uC774 \uC5C6\uC2B5\uB2C8\uB2E4.');
    }

    var lastRow = sheet.getLastRow();
    var deletedCount = 0;
    if (lastRow >= 2) {
      var workbookIds = sheet.getRange(2, workbookIdIndex + 1, lastRow - 1, 1).getValues();
      for (var i = workbookIds.length - 1; i >= 0; i -= 1) {
        if (String(workbookIds[i][0] || '').trim() !== workbook.workbookId) {
          continue;
        }
        sheet.deleteRow(i + 2);
        deletedCount += 1;
      }
    }

    PropertiesService.getScriptProperties().setProperty('leaderboardResetAt:' + workbook.workbookId, String(Date.now()));
    clearTableCache_(DB_SHEETS.WORKBOOK_PLAYER_DATA);
    return {
      ok: true,
      workbookId: workbook.workbookId,
      workbookName: workbook.workbookName || workbook.workbookId,
      deletedCount: deletedCount,
    };
  } finally {
    lock.releaseLock();
  }
}

function requireLeaderboardManager_(authToken) {
  var player = getCurrentPlayer_(authToken);
  if (String(player.role || '').trim() !== 'teacher') {
    throw new Error('\uC120\uC0DD\uB2D8 \uACC4\uC815\uB9CC \uB9AC\uB354\uBCF4\uB4DC\uB97C \uCD08\uAE30\uD654\uD560 \uC218 \uC788\uC2B5\uB2C8\uB2E4.');
  }
  return player;
}

function requireActiveLeaderboardWorkbook_(workbookId) {
  var targetWorkbookId = String(workbookId || '').trim();
  if (!targetWorkbookId) {
    throw new Error('Select a workbook before opening the leaderboard.');
  }
  var workbook = requireWorkbook_(targetWorkbookId);
  if (String(workbook.status || STATUS.WORKBOOK_ACTIVE) !== STATUS.WORKBOOK_ACTIVE) {
    throw new Error('Only active workbook leaderboards can be viewed.');
  }
  return workbook;
}

function calculateProgressScore(playerData) {
  var maxFloor = Number((playerData && playerData.maxFloor) || 0);
  var maxStage = Number((playerData && playerData.maxStage) || 0);
  return (maxFloor * 100) + maxStage;
}

function calculateAccuracyRate(playerData) {
  var total = Number((playerData && playerData.totalAnswerCount) || 0);
  if (total <= 0) {
    return 0;
  }
  var correct = Number((playerData && playerData.correctAnswerCount) || 0);
  return Math.max(0, Math.min(100, (correct / total) * 100));
}

function formatDisplayProgressText_(progressFloor, stage) {
  var displayFloor = Math.max(1, 6 - Number(progressFloor || 1));
  return displayFloor + '층 ' + Number(stage || 1) + '스테이지';
}

function formatCompactStageText_(progressFloor, stage) {
  var displayFloor = Math.max(1, 6 - Number(progressFloor || 1));
  return displayFloor + '-' + Number(stage || 1);
}

function formatClearTime(clearTimeMs) {
  var value = Number(clearTimeMs || 0);
  if (!value || value >= getMissingClearTimeMs_()) {
    return '\uC5C6\uC74C';
  }

  var totalSeconds = Math.floor(value / 1000);
  var minutes = Math.floor(totalSeconds / 60);
  var seconds = totalSeconds % 60;
  var milliseconds = value % 1000;
  if (minutes > 0) {
    return minutes + '\uBD84 ' + seconds + '\uCD08';
  }
  return seconds + '.' + String(milliseconds).padStart(3, '0').slice(0, 1) + '\uCD08';
}

function sortLeaderboardRows(rows) {
  return rows.sort(function(a, b) {
    if (Number(b.bestScore || 0) !== Number(a.bestScore || 0)) {
      return Number(b.bestScore || 0) - Number(a.bestScore || 0);
    }
    if (Number(b.progressScore || 0) !== Number(a.progressScore || 0)) {
      return Number(b.progressScore || 0) - Number(a.progressScore || 0);
    }
    if (Number(a.clearTimeMs || getMissingClearTimeMs_()) !== Number(b.clearTimeMs || getMissingClearTimeMs_())) {
      return Number(a.clearTimeMs || getMissingClearTimeMs_()) - Number(b.clearTimeMs || getMissingClearTimeMs_());
    }
    if (Number(b.accuracyRate || 0) !== Number(a.accuracyRate || 0)) {
      return Number(b.accuracyRate || 0) - Number(a.accuracyRate || 0);
    }
    return String(a.displayName || '').localeCompare(String(b.displayName || ''));
  });
}

function normalizeClearTimeForSort_(clearTimeMs) {
  var value = Number(clearTimeMs || 0);
  return value > 0 ? value : getMissingClearTimeMs_();
}

function getMissingClearTimeMs_() {
  return 999999999999;
}

function formatScore_(score) {
  return Number(score || 0).toLocaleString('ko-KR') + '\uC810';
}

// Merge durable terminal records and pending answers without waiting for the stats trigger.
// Processed answers are already included in WorkbookPlayerData and must not count twice.
function buildLeaderboardStats_(workbookId) {
  var byPlayer = {};
  readTable_(DB_SHEETS.WORKBOOK_PLAYER_DATA).forEach(function(row) {
    if (String(row.workbookId || '').trim() === workbookId) byPlayer[row.playerId] = Object.assign({}, row);
  });
  var resetAt = Number(PropertiesService.getScriptProperties().getProperty('leaderboardResetAt:' + workbookId) || 0);
  var terminalRuns = {};
  readTable_(DB_SHEETS.RUNS).forEach(function(run) {
    if (getRunWorkbookId_(run) !== workbookId || [STATUS.RUN_FAILED, STATUS.RUN_CLEARED].indexOf(run.status) === -1) return;
    if (resetAt && new Date(run.endedAt || run.updatedAt || run.startedAt).getTime() <= resetAt) return;
    terminalRuns[run.runId] = run;
    var row = byPlayer[run.playerId] || { workbookId: workbookId, playerId: run.playerId };
    if (calculateProgressScore(runProgressForLeaderboard_(run)) > calculateProgressScore(row)) {
      row.maxFloor = Number(run.currentFloor || 1);
      row.maxStage = Number(run.currentStage || 1);
    }
    row.bestScore = Math.max(Number(row.bestScore || 0), Number(run.score || 0));
    if (run.status === STATUS.RUN_CLEARED) {
      var elapsed = Number(run.clearTimeMs || 0);
      if (!elapsed && run.startedAt && run.endedAt) elapsed = new Date(run.endedAt).getTime() - new Date(run.startedAt).getTime();
      if (elapsed > 0 && elapsed < normalizeClearTimeForSort_(row.bestClearTimeMs)) row.bestClearTimeMs = elapsed;
    }
    byPlayer[run.playerId] = row;
  });
  var seen = {};
  function addPending(log) {
    var run = terminalRuns[log.runId];
    if (!run || String(log.playerId) !== String(run.playerId)) return;
    var row = byPlayer[run.playerId];
    row.totalAnswerCount = Number(row.totalAnswerCount || 0) + 1;
    row.correctAnswerCount = Number(row.correctAnswerCount || 0) + (normalizeBattleStatBoolean_(log.isCorrect) ? 1 : 0);
  }
  readTable_(DB_SHEETS.ANSWER_LOGS).forEach(function(log) {
    if (!log.answerLogId || seen[log.answerLogId]) return;
    seen[log.answerLogId] = true;
    if (isPendingBattleStatLog_(log)) addPending(log);
  });
  readTable_(DB_SHEETS.BATTLE_ANSWER_LOG_QUEUE).forEach(function(batch) {
    if (normalizeBattleStatBoolean_(batch.processed)) return;
    var logs = safeJsonParse_(batch.logsJson, []);
    if (!Array.isArray(logs)) return;
    logs.forEach(function(log) {
      if (!log.answerLogId || seen[log.answerLogId]) return;
      seen[log.answerLogId] = true;
      addPending(log);
    });
  });
  return Object.keys(byPlayer).map(function(id) { return byPlayer[id]; });
}
function runProgressForLeaderboard_(run) {
  return { maxFloor: run.currentFloor, maxStage: run.currentStage };
}
