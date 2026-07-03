function getLeaderboard() {
  var players = readTable_(DB_SHEETS.PLAYERS);
  var playerDataRows = readTable_(DB_SHEETS.PLAYER_DATA);
  var playerMap = {};

  players.forEach(function(player) {
    if (String(player.isActive) === 'false') {
      return;
    }
    playerMap[player.playerId] = player;
  });

  var rows = playerDataRows.map(function(playerData) {
    var player = playerMap[playerData.playerId] || {};
    var accuracyRate = calculateAccuracyRate(playerData);
    var clearTimeMs = normalizeClearTimeForSort_(playerData.bestClearTimeMs);
    var displayName = player.displayName || player.studentName || player.email || '이름 없음';
    var maxFloor = Number(playerData.maxFloor || 0);
    var maxStage = Number(playerData.maxStage || 0);

    return {
      rank: 0,
      playerId: playerData.playerId,
      displayName: displayName,
      progressText: formatDisplayProgressText_(maxFloor, maxStage),
      maxFloor: maxFloor,
      maxStage: maxStage,
      progressScore: calculateProgressScore(playerData),
      clearTimeMs: clearTimeMs,
      clearTimeText: formatClearTime(playerData.bestClearTimeMs),
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
  var floorNames = {
    1: '5층 옥상',
    2: '4층 1학년 교실층',
    3: '3층 3학년 교실층',
    4: '2층 2학년 교실층',
    5: '1층 특별실/현관',
  };
  var floor = Number(progressFloor || 1);
  return (floorNames[floor] || (floor + '층')) + ' ' + Number(stage || 1) + '스테이지';
}

function formatClearTime(clearTimeMs) {
  var value = Number(clearTimeMs || 0);
  if (!value || value >= getMissingClearTimeMs_()) {
    return '없음';
  }

  var totalSeconds = Math.floor(value / 1000);
  var minutes = Math.floor(totalSeconds / 60);
  var seconds = totalSeconds % 60;
  var milliseconds = value % 1000;
  if (minutes > 0) {
    return minutes + '분 ' + seconds + '초';
  }
  return seconds + '.' + String(milliseconds).padStart(3, '0').slice(0, 1) + '초';
}

function sortLeaderboardRows(rows) {
  return rows.sort(function(a, b) {
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
