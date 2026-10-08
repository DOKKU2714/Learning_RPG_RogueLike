// Personal understanding is independent of the shared question statistics.
function getQuestionUnderstandingRatings(workbookId, authToken) {
  var player = getCurrentPlayer_(authToken);
  var workbook = requireQuestionWorkbook_(workbookId);
  return getPlayerQuestionUnderstanding_(player.playerId, workbook.workbookId);
}

function getPlayerQuestionUnderstanding_(playerId, workbookId) {
  var data = getPlayerData_(playerId) || {};
  var ratings = safeJsonParse_(data.questionUnderstandingJson, {});
  var workbookRatings = ratings[String(workbookId || '')] || {};
  var result = {};
  Object.keys(workbookRatings).forEach(function(id) {
    var entry = workbookRatings[id];
    result[id] = Number(entry && typeof entry === 'object' ? entry.rating : entry);
  });
  return result;
}

// The caller already holds the progress request's script lock.
function syncQuestionUnderstandingForRun_(runId, entries, authToken, response) {
  if (!Array.isArray(entries) || !entries.length) return response;
  var player = getCurrentPlayer_(authToken);
  var run = findRowByKey_(DB_SHEETS.RUNS, 'runId', runId);
  if (!run || String(run.playerId) !== String(player.playerId)) throw new Error('현재 플레이어의 런이 아닙니다.');
  var workbookId = String(getRunWorkbookContext_(run).workbookId);
  var questions = {};
  readWorkbookQuestionTable_(workbookId).forEach(function(question) { questions[question.questionId] = question; });
  var normalized = entries.map(function(entry) {
    var value = Number(entry && entry.rating);
    var updatedAtMs = Number(entry && entry.updatedAtMs);
    if (!Number.isInteger(value) || value < 1 || value > 5 || !Number.isFinite(updatedAtMs) || updatedAtMs < 0
        || !entry.revision || typeof entry.revision !== 'string') throw new Error('문제 이해도 기록이 올바르지 않습니다.');
    return { questionId: String(entry.questionId || ''), rating: value, updatedAtMs: updatedAtMs, revision: entry.revision };
  });
  ensureTableColumns_(DB_SHEETS.PLAYER_DATA, DB_COLUMNS.PLAYER_DATA);
  var data = getPlayerData_(player.playerId) || ensurePlayerData_(player.playerId);
  var ratings = safeJsonParse_(data.questionUnderstandingJson, {});
  ratings[workbookId] = ratings[workbookId] || {};
  var changed = false;
  var acknowledged = normalized.map(function(entry) {
    var question = questions[entry.questionId];
    var previous = ratings[workbookId][entry.questionId];
    if (question && question.status === STATUS.QUESTION_APPROVED
        && (!previous || !previous.updatedAtMs || previous.updatedAtMs < entry.updatedAtMs)) {
      ratings[workbookId][entry.questionId] = entry;
      previous = entry;
      changed = true;
    }
    // Removed questions are acknowledged as discarded, so they cannot block game saves.
    return { questionId: entry.questionId, revision: entry.revision,
      rating: Number(previous && typeof previous === 'object' ? previous.rating : previous || 0) };
  });
  if (changed) updateRowByKey_(DB_SHEETS.PLAYER_DATA, 'playerId', player.playerId, {
    questionUnderstandingJson: safeJsonStringify_(ratings), updatedAt: new Date(),
  });
  response = response || {};
  response.acknowledgedQuestionUnderstanding = { playerId: player.playerId, workbookId: workbookId, entries: acknowledged };
  return response;
}

function applyQuestionUnderstandingForSelection_(questions, run, playerId) {
  var ratingValues = getPlayerQuestionUnderstanding_(playerId, getRunWorkbookContext_(run).workbookId);
  var data = getPlayerData_(playerId) || {};
  var ratings = safeJsonParse_(data.questionUnderstandingJson, {})[String(getRunWorkbookContext_(run).workbookId)] || {};
  var state = getStageState_(run).questionSelectionState || {};
  return questions.map(function(question) {
    var rating = ratings[question.questionId];
    var updatedAtMs = Number(rating && rating.updatedAtMs || 0);
    var exposure = state[question.questionId] || {};
    return Object.assign({}, question, {
      understandingRating: Number(ratingValues[question.questionId] || 0),
      selectionUpdatedAtMs: updatedAtMs,
      selectionExposureCount: Number(exposure.updatedAtMs || 0) < updatedAtMs ? 0 : Number(exposure.count || 0),
    });
  });
}

function recordServerQuestionExposure_(stageState, question) {
  stageState.questionSelectionState = stageState.questionSelectionState || {};
  stageState.questionSelectionState[question.questionId] = {
    count: Number(question.selectionExposureCount || 0) + 1,
    updatedAtMs: Number(question.selectionUpdatedAtMs || 0),
  };
}

function mergeQuestionSelectionState_(existing, incoming) {
  var result = Object.assign({}, existing || {});
  Object.keys(incoming || {}).forEach(function(id) {
    var next = incoming[id] || {};
    var previous = result[id] || {};
    var updatedAtMs = Math.max(0, Number(next.updatedAtMs || 0));
    if (!Number.isFinite(updatedAtMs) || updatedAtMs < Number(previous.updatedAtMs || 0)) return;
    var count = Math.max(0, Math.floor(Number(next.count || 0)));
    if (!Number.isFinite(count)) return;
    result[id] = { count: updatedAtMs === Number(previous.updatedAtMs || 0) ? Math.max(count, Number(previous.count || 0)) : count, updatedAtMs: updatedAtMs };
  });
  return result;
}
