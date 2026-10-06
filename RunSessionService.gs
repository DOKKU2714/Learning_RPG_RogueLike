// Immutable battle definitions are pinned once per run. Mutable progress travels
// in a server-signed checkpoint until a normal defeat or final victory.
var ACTIVE_GAME_DATA_SNAPSHOT_ = null;
var ACTIVE_RUN_SESSION_ = null;
var RUN_SESSION_LOCK_HELD_ = false;

function cloneGameDataRows_(rows) { return JSON.parse(JSON.stringify(rows)); }
function getPinnedGameDataTable_(sheetName) {
  if (!ACTIVE_GAME_DATA_SNAPSHOT_) return null;
  var names = {};
  names[DB_SHEETS.STAGES] = 'stages';
  names[DB_SHEETS.MONSTER_GROUPS] = 'monsterGroups';
  names[DB_SHEETS.MONSTERS] = 'monsters';
  names[DB_SHEETS.MONSTER_AI] = 'monsterAi';
  names[DB_SHEETS.SKILLS] = 'skills';
  names[DB_SHEETS.EFFECTS] = 'effects';
  names[DB_SHEETS.ITEMS] = 'items';
  names[DB_SHEETS.REWARDS] = 'rewards';
  return names[sheetName] ? ACTIVE_GAME_DATA_SNAPSHOT_[names[sheetName]] || [] : null;
}
function withGameDataSnapshot_(snapshot, callback) {
  var previous = ACTIVE_GAME_DATA_SNAPSHOT_;
  ACTIVE_GAME_DATA_SNAPSHOT_ = snapshot;
  try { return callback(); } finally { ACTIVE_GAME_DATA_SNAPSHOT_ = previous; }
}
function putChunkedRunCache_(key, value) {
  try {
    var cache = CacheService.getScriptCache();
    var hash = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, value, Utilities.Charset.UTF_8));
    var versionKey = key + ':' + hash;
    var parts = Math.ceil(value.length / 20000);
    for (var i = 0; i < parts; i++) cache.put(versionKey + ':' + i, value.slice(i * 20000, (i + 1) * 20000), 21600);
    cache.put(versionKey + ':count', String(parts), 21600);
    // Publish only after all chunks exist; concurrent readers see a whole checkpoint.
    cache.put(key + ':head', versionKey, 21600);
  } catch (error) { /* Signed client checkpoints and stored definitions survive eviction. */ }
}
function getChunkedRunCache_(key) {
  try {
    var cache = CacheService.getScriptCache();
    var versionKey = cache.get(key + ':head');
    if (!versionKey) return null;
    var count = Number(cache.get(versionKey + ':count') || 0);
    if (!count) return null;
    var value = '';
    for (var i = 0; i < count; i++) {
      var part = cache.get(versionKey + ':' + i);
      if (part === null) return null;
      value += part;
    }
    return value;
  } catch (error) { return null; }
}
function storeRunGameDataSnapshot_(snapshot) {
  var data = Object.assign({}, snapshot);
  delete data.loadedAt;
  delete data.snapshotKey;
  var json = safeJsonStringify_(data);
  var id = Utilities.base64EncodeWebSafe(Utilities.computeDigest(Utilities.DigestAlgorithm.SHA_256, json, Utilities.Charset.UTF_8));
  var key = 'run-definitions:' + id;
  if (!getChunkedRunCache_(key)) {
    var spreadsheet = getSpreadsheet_();
    var sheet = spreadsheet.getSheetByName(DB_SHEETS.GAME_DATA_SNAPSHOTS);
    if (!sheet) {
      sheet = spreadsheet.insertSheet(DB_SHEETS.GAME_DATA_SNAPSHOTS);
      sheet.getRange(1, 1, 1, DB_COLUMNS.GAME_DATA_SNAPSHOTS.length).setValues([DB_COLUMNS.GAME_DATA_SNAPSHOTS]);
      sheet.setFrozenRows(1);
    }
    var existing = readTableUncached_(DB_SHEETS.GAME_DATA_SNAPSHOTS).some(function(row) { return row.snapshotId === id; });
    if (!existing) {
      var rows = [];
      var count = Math.ceil(json.length / 20000);
      for (var i = 0; i < count; i++) rows.push({ snapshotId: id, partIndex: i, partCount: count, jsonChunk: json.slice(i * 20000, (i + 1) * 20000), createdAt: new Date() });
      appendRowObjects_(DB_SHEETS.GAME_DATA_SNAPSHOTS, rows);
    }
    putChunkedRunCache_(key, json);
  }
  return id;
}
function loadRunGameDataSnapshot_(id) {
  var key = 'run-definitions:' + id;
  var json = getChunkedRunCache_(key);
  if (!json) {
    var parts = readTableUncached_(DB_SHEETS.GAME_DATA_SNAPSHOTS).filter(function(row) { return String(row.snapshotId) === String(id); }).sort(function(a, b) { return Number(a.partIndex) - Number(b.partIndex); });
    if (!parts.length || parts.length !== Number(parts[0].partCount)) throw new Error('시작할 때 준비한 전투 데이터를 찾을 수 없습니다.');
    json = parts.map(function(row) { return row.jsonChunk; }).join('');
    putChunkedRunCache_(key, json);
  }
  return JSON.parse(json);
}
function encodeRunSession_(session) {
  var jsonBlob = Utilities.newBlob(safeJsonStringify_(session), 'application/json', 'run-session.json');
  var payload = Utilities.base64EncodeWebSafe(Utilities.gzip(jsonBlob, 'run-session.json.gz').getBytes());
  var signature = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('run-session-v1:' + payload, getLocalQuestionSigningKey_(), Utilities.Charset.UTF_8));
  return payload + '.' + signature;
}
function decodeRunSession_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('게임 진행 정보가 올바르지 않습니다.');
  var expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('run-session-v1:' + parts[0], getLocalQuestionSigningKey_(), Utilities.Charset.UTF_8));
  if (!constantTimeStringEquals_(expected, parts[1])) throw new Error('게임 진행 정보 검증에 실패했습니다.');
  var gzipBlob = Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0]), 'application/gzip', 'run-session.json.gz');
  return JSON.parse(Utilities.ungzip(gzipBlob).getDataAsString('UTF-8'));
}
function checkpointRunSession_(session) {
  var token = encodeRunSession_(session);
  putChunkedRunCache_('run-session:' + session.run.runId, token);
  return token;
}
function beginRunSession_(run) {
  return checkpointRunSession_({ version: 1, revision: 0, run: cloneGameDataRows_(run), answerBatches: [], battleLogs: [] });
}
function isDeferredRunTable_(sheetName) {
  return !!ACTIVE_RUN_SESSION_ && [DB_SHEETS.RUNS, DB_SHEETS.PLAYER_DATA, DB_SHEETS.WORKBOOK_PLAYER_DATA, DB_SHEETS.ANSWER_LOGS, DB_SHEETS.BATTLE_LOGS].indexOf(sheetName) !== -1;
}
function patchDeferredRun_(runId, patch) {
  if (!ACTIVE_RUN_SESSION_ || String(ACTIVE_RUN_SESSION_.run.runId) !== String(runId)) return null;
  ACTIVE_RUN_SESSION_.run = Object.assign({}, ACTIVE_RUN_SESSION_.run, patch);
  return ACTIVE_RUN_SESSION_.run;
}
function saveRunSettlementCheckpoint_(session) {
  var name = DB_SHEETS.RUN_SETTLEMENTS;
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(name);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(name);
    sheet.getRange(1, 1, 1, DB_COLUMNS.RUN_SETTLEMENTS.length).setValues([DB_COLUMNS.RUN_SETTLEMENTS]);
    sheet.setFrozenRows(1);
  }
  if (findRowByKeyUncached_(name, 'runId', session.run.runId)) return;
  var token = encodeRunSession_(session);
  var count = Math.ceil(token.length / 20000);
  var rows = [];
  for (var i = 0; i < count; i++) rows.push({ runId: session.run.runId, partIndex: i, partCount: count, checkpointChunk: token.slice(i * 20000, (i + 1) * 20000), createdAt: new Date() });
  appendRowObjects_(name, rows);
}
function loadRunSettlementCheckpoint_(runId) {
  if (!getSpreadsheet_().getSheetByName(DB_SHEETS.RUN_SETTLEMENTS)) return null;
  var parts = readTableUncached_(DB_SHEETS.RUN_SETTLEMENTS).filter(function(row) { return String(row.runId) === String(runId); }).sort(function(a, b) { return Number(a.partIndex) - Number(b.partIndex); });
  if (!parts.length || parts.length !== Number(parts[0].partCount)) return null;
  return decodeRunSession_(parts.map(function(row) { return row.checkpointChunk; }).join(''));
}
function finishRunSession_(session) {
  var run = session.run;
  var stored = findRowByKeyUncached_(DB_SHEETS.RUNS, 'runId', run.runId);
  if (stored && toBoolean_(stored.sessionSettled)) return stored;
  saveRunSettlementCheckpoint_(session);
  // A terminal run row also prevents a duplicate completion from granting rewards.
  ['startedAt', 'updatedAt', 'endedAt'].forEach(function(key) {
    if (run[key]) run[key] = new Date(run[key]);
  });
  run = updateRowByKey_(DB_SHEETS.RUNS, 'runId', run.runId, run);
  (session.answerBatches || []).forEach(function(batch) {
    enqueueBattleAnswerLogsForBatch_(batch.battle, batch.logs);
  });
  var logged = readTable_(DB_SHEETS.BATTLE_LOGS).filter(function(row) { return String(row.runId) === String(run.runId); });
  var remainingLogs = (session.battleLogs || []).filter(function(row) {
    return !logged.some(function(existing) { return existing.battleLogId === row.battleLogId || existing.result === row.result && safeJsonParse_(existing.summaryJson, {}).battleId === safeJsonParse_(row.summaryJson, {}).battleId; });
  });
  appendRowObjects_(DB_SHEETS.BATTLE_LOGS, remainingLogs);
  updatePlayerProgressFromRun_(run, Number(run.currency || 0));
  if (run.status === STATUS.RUN_FAILED && session.defeatBattle) createPlayerGhostForDefeat_(run.runId, session.defeatBattle);
  return updateRowByKey_(DB_SHEETS.RUNS, 'runId', run.runId, { sessionSettled: true });
}
function withRunSession_(runId, token, authToken, callback, readOnly) {
  if (ACTIVE_RUN_SESSION_) return callback();
  var player = getCurrentPlayer_(authToken);
  var cachedToken = getChunkedRunCache_('run-session:' + runId);
  var session = token ? decodeRunSession_(token) : cachedToken ? decodeRunSession_(cachedToken) : null;
  if (session && (String(session.run.runId) !== String(runId) || String(session.run.playerId) !== String(player.playerId))) throw new Error('현재 플레이어의 게임 진행 정보가 아닙니다.');
  if (cachedToken && cachedToken !== token) {
    var cached = decodeRunSession_(cachedToken);
    if (String(cached.run.playerId) !== String(player.playerId)) throw new Error('현재 플레이어의 런이 아닙니다.');
    if (!session || Number(cached.revision) > Number(session.revision)) session = cached;
  }
  var stored = findRowByKeyUncached_(DB_SHEETS.RUNS, 'runId', runId);
  if (!stored || String(stored.playerId) !== String(player.playerId)) throw new Error('현재 플레이어의 런이 아닙니다.');
  if (!session) {
    if (!stored.gameDataSnapshotId) return callback(); // Older battles retain their existing API contract.
    session = { version: 1, revision: 0, run: cloneGameDataRows_(stored), answerBatches: [], battleLogs: [] };
  }
  if (stored.status !== STATUS.RUN_ACTIVE) {
    // Never reopen a completed or abandoned run using an older browser checkpoint.
    if (toBoolean_(stored.sessionSettled)) {
      if (session.localAdvanceEnabled && session.run.status === STATUS.RUN_ACTIVE) {
        var settledSession = loadRunSettlementCheckpoint_(runId);
        if (settledSession) session = settledSession;
      }
      session.run = cloneGameDataRows_(stored);
    }
    else if (session.run.status === STATUS.RUN_ACTIVE) {
      var pendingSettlement = loadRunSettlementCheckpoint_(runId);
      if (pendingSettlement) session = pendingSettlement;
      else {
        if (!readOnly) throw new Error('이미 종료된 게임입니다.');
        session.run = cloneGameDataRows_(stored);
      }
    }
  }
  var snapshot = loadRunGameDataSnapshot_(session.run.gameDataSnapshotId);
  var response;
  ACTIVE_RUN_SESSION_ = session;
  try { response = withGameDataSnapshot_(snapshot, callback); }
  finally { ACTIVE_RUN_SESSION_ = null; }
  if (!readOnly) {
    session.revision = Number(session.revision || 0) + 1;
    // Keep the signed terminal checkpoint available if settlement must be retried.
    var checkpoint = checkpointRunSession_(session);
    if (session.run.status === STATUS.RUN_FAILED || session.run.status === STATUS.RUN_CLEARED) {
      session.run = cloneGameDataRows_(finishRunSession_(session));
      checkpoint = checkpointRunSession_(session);
    }
    if (response) {
      response.runSessionToken = checkpoint; response.runSessionRevision = session.revision;
      if (session.localAdvanceEnabled) {
        response.localRunState = cloneGameDataRows_(session.run);
        response.acknowledgedLocalTransitions = (session.localTransitionIds || []).slice();
      }
    }
  }
  return response;
}
function advanceRunStage(stagePayload, rewardId, authToken, rewardView) {
  var lock = LockService.getScriptLock();
  lock.waitLock(10000);
  RUN_SESSION_LOCK_HELD_ = true;
  try {
    return withRunSession_(stagePayload.runId, stagePayload.runSessionToken, authToken, function() {
      var run = requireRun_(stagePayload.runId);
      if (run.status !== STATUS.RUN_ACTIVE) return { cleared: run.status === STATUS.RUN_CLEARED, run: cloneGameDataRows_(run), score: run.score };
      var currentBattle = getStageState_(run).battle;
      // Network retries return the already prepared next battle without applying twice.
      if (currentBattle && currentBattle.battleId !== stagePayload.battle.battleId && !getWorkbookPlayWindow_(getRunWorkbookContext_(run).workbookId).expired) return buildBattleStateView_(run, getStageState_(run));
      var committed = commitStageResultUnlocked_(stagePayload, authToken);
      if (committed.battle && committed.battle.status === STATUS.BATTLE_DEFEAT) return committed;
      var response = selectRewardUnlocked_(stagePayload.runId, rewardId, authToken, rewardView);
      if (!response.nextBattlePending) return response;
      startBattle(stagePayload.runId);
      var nextRun = requireRun_(stagePayload.runId);
      return Object.assign({}, response, buildBattleStateView_(nextRun, getStageState_(nextRun)), { nextBattlePending: false, run: toClientObject_(nextRun) });
    });
  } finally { RUN_SESSION_LOCK_HELD_ = false; lock.releaseLock(); }
}

// Capture the battle completion time before reward selection. Deferring a sheet
// save must not add reward-selection time to the existing floor-speed calculation.
function signBattleCompletionReceipt_(receipt) {
  var payload = safeJsonStringify_([receipt.runId, receipt.battleId, Number(receipt.completedAtMs)]);
  return Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('battle-completed-v1:' + payload, getLocalQuestionSigningKey_(), Utilities.Charset.UTF_8));
}
function getVerifiedBattleCompletionMs_(receipt, run, battleId) {
  if (!receipt || String(receipt.runId) !== String(run.runId) || String(receipt.battleId) !== String(battleId)) return 0;
  if (!constantTimeStringEquals_(signBattleCompletionReceipt_(receipt), receipt.signature)) throw new Error('전투 종료 시각 검증에 실패했습니다.');
  var ms = Number(receipt.completedAtMs || 0);
  return ms >= new Date(run.startedAt).getTime() && ms <= new Date().getTime() ? ms : 0;
}
function createBattleCompletionReceipt_(run, battleId) {
  var receipt = { runId: String(run.runId), battleId: String(battleId || ''), completedAtMs: new Date().getTime() };
  receipt.signature = signBattleCompletionReceipt_(receipt);
  return receipt;
}
