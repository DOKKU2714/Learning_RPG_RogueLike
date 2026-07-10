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

  var rows = readTable_(DB_SHEETS.WORKBOOK_PLAYER_DATA).filter(function(playerData) {
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
  return formatCompactStageText_(progressFloor, stage);
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
