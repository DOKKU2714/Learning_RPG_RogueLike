// Ship the existing rules, rather than maintaining a second reward/battle implementation.
function getLocalRunEngineSource_() {
  var adapters = getLocalRunEngineAdapters_();
  var overridden = {};
  (adapters.match(/function\s+([A-Za-z_$][\w$]*)\s*\(/g) || []).forEach(function(declaration) {
    overridden[declaration.match(/function\s+(\w+)/)[1]] = true;
  });
  var sources = [];
  var seen = {};
  function collect(fn) {
    var name = fn.name;
    if (seen[name] || overridden[name]) return;
    seen[name] = true;
    var source = String(fn);
    if (/\[native code\]/.test(source)) return;
    sources.push(source);
    // Include named callbacks as well as direct calls. Only project functions are exported.
    (source.replace(/\/\/[^\n]*|\/\*[\s\S]*?\*\//g, '').match(/\b[A-Za-z_$][\w$]*\b/g) || []).forEach(function(identifier) {
      if (seen[identifier] || overridden[identifier]) return;
      var candidate;
      try { candidate = eval(identifier); } catch (error) { return; }
      if (typeof candidate === 'function' && candidate.name === identifier && !/\[native code\]/.test(String(candidate))) collect(candidate);
    });
  }
  [commitStageResultUnlocked_, selectRewardUnlocked_, startBattle, buildBattleStateView_,
    applySkillEffect, processSkillTriggers_, processSkillFailPenaltyAfterAnswer_,
    tickEffectsAtTurnStart, tickEffectsAtTurnEnd, tickEffectsOnPlayerAction,
    getAvailableSkills, normalizePlayerActionPoints_].forEach(collect);
  var constants = { DB_SHEETS: DB_SHEETS, DB_COLUMNS: DB_COLUMNS, STATUS: STATUS, AVATAR_TYPES: AVATAR_TYPES,
    QUESTION_TYPES: QUESTION_TYPES, ACTION_TYPES: ACTION_TYPES, SKILL_TYPES: SKILL_TYPES, REWARD_TYPES: REWARD_TYPES,
    RARITIES: RARITIES, RARITY_LABELS: RARITY_LABELS, EFFECT_CATEGORIES: EFFECT_CATEGORIES, EFFECT_TYPES: EFFECT_TYPES,
    DURATION_TYPES: DURATION_TYPES, TRIGGER_TIMINGS: TRIGGER_TIMINGS, STAT_KEYS: STAT_KEYS,
    DEFAULT_BASE_PLAYER_STATS: DEFAULT_BASE_PLAYER_STATS, ITEM_EFFECT_TYPES: ITEM_EFFECT_TYPES,
    ITEM_REWARD_CONFIG: ITEM_REWARD_CONFIG, SKILL_REWARD_CONFIG: SKILL_REWARD_CONFIG,
    SKILL_UPGRADE_REWARD_CONFIG: SKILL_UPGRADE_REWARD_CONFIG, REWARD_CONFIG: REWARD_CONFIG,
    GAME_RULES: GAME_RULES, PLAYER_GHOST_FLOOR_CONFIGS: PLAYER_GHOST_FLOOR_CONFIGS,
    ALLOWED_REWARD_STAT_KEYS_: ALLOWED_REWARD_STAT_KEYS_, MASTER_ITEMS: MASTER_ITEMS,
    MASTER_EFFECTS: MASTER_EFFECTS, MASTER_MONSTERS: MASTER_MONSTERS, MASTER_SETTINGS: MASTER_SETTINGS };
  var declarations = Object.keys(constants).map(function(name) { return 'var ' + name + '=' + JSON.stringify(constants[name]) + ';'; }).join('\n');
  var source = '(function(nativeDate,nativeMath){\n' + declarations + '\n' + adapters + '\n' + getSharedRuleEngineSource_() + '\n' + sources.join('\n') + '\nreturn {advance: advanceLocalRun, skill: applyLocalBattleSkill, trigger: processLocalBattleTrigger, tick: tickLocalBattleEffects, skills: getLocalBattleSkills};\n})(Date,Math)';
  if (/\b(?:SpreadsheetApp|PropertiesService|CacheService|LockService|UrlFetchApp|ScriptApp)\b/.test(source)) throw new Error('클라이언트 전투 규칙에 서버 의존성이 남아 있습니다.');
  return source;
}

function getLocalRunEngineScript_() {
  return '<script>window.LearningRpgLocalRunEngine=' + getLocalRunEngineSource_().replace(/<\/script/gi, '<\\/script') + ';</script>';
}

function getLocalRunEngineAdapters_() {
  return String.raw`
  var Date = nativeDate, Math = Object.create(nativeMath);
  var localRun, localSnapshot, localPermit, localPlayWindow, localIdCounter, localSeed;
  function cloneLocal(value) { return JSON.parse(JSON.stringify(value)); }
  // The browser uses the same skill implementation as Apps Script. Reads are
  // resolved from the downloaded snapshot; scoring remains owned by the HUD.
  function withLocalBattleRules(snapshot, battle, callback) {
    localSnapshot = snapshot;
    Math.random = nativeMath.random;
    var previous = battle.suppressMonsterScoreBookkeeping;
    battle.suppressMonsterScoreBookkeeping = true;
    try { return callback(); }
    finally {
      if (previous === undefined) delete battle.suppressMonsterScoreBookkeeping;
      else battle.suppressMonsterScoreBookkeeping = previous;
    }
  }
  function applyLocalBattleSkill(snapshot, battle, skill, targetId, efficiency, isCorrect) {
    return withLocalBattleRules(snapshot, battle, function() {
      var master = findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', skill.skillId);
      var hydrated = hydrateSkill_(master || skill, skill.level);
      if (!processSkillFailPenaltyAfterAnswer_(battle, hydrated, isCorrect)) {
        applySkillEffect(battle, Object.assign({}, hydrated, {targetId:targetId || ''}), efficiency, isCorrect);
      }
      return battle;
    });
  }
  function processLocalBattleTrigger(snapshot, battle, timing, payload) {
    return withLocalBattleRules(snapshot, battle, function() { processSkillTriggers_(battle, timing, payload || {}); });
  }
  function tickLocalBattleEffects(snapshot, battle, timing) {
    return withLocalBattleRules(snapshot, battle, function() {
      if (timing === 'turnStart') { normalizePlayerActionPoints_(battle, true); return tickEffectsAtTurnStart(battle); }
      if (timing === 'turnEnd') return tickEffectsAtTurnEnd(battle);
      return tickEffectsOnPlayerAction(battle);
    });
  }
  function getLocalBattleSkills(snapshot, battle, skills) {
    return withLocalBattleRules(snapshot, battle, function() { return getAvailableSkills({skills:skills || []}, battle); });
  }
  function advanceLocalRun(run, snapshot, payload, rewardId, rewardView, options) {
    options = options || {};
    localRun = cloneLocal(run); localSnapshot = snapshot; localPermit = cloneLocal(rewardView.localTransition);
    if (!localPermit || localPermit.runId !== localRun.runId) throw new Error('로컬 전투 준비 정보가 없습니다.');
    localPermit.selectedRewardId = rewardId;
    localPlayWindow = options.playWindow || {}; localIdCounter = 0; localSeed = Number(localPermit.seed) >>> 0;
    var now = Number(options.selectedAtMs || nativeDate.now());
    Date = class extends nativeDate { constructor(...args) { super(...(args.length ? args : [now])); } static now() { return now; } };
    Math.random = function() { localSeed = (Math.imul(1664525, localSeed) + 1013904223) >>> 0; return localSeed / 4294967296; };
    try {
      if (!options.committed) {
        var resultPayload = cloneLocal(payload); resultPayload.answerLogs = [];
        commitStageResultUnlocked_(resultPayload, 'local');
      }
      var response = selectRewardUnlocked_(localRun.runId, rewardId, 'local', rewardView);
      if (response.nextBattlePending) {
        startBattle(localRun.runId);
        response = Object.assign({}, response, buildBattleStateView_(localRun, getStageState_(localRun)), { nextBattlePending: false, run: cloneLocal(localRun) });
      }
      // Rest options remain server-issued; selectReward uses these instead of drawing locally.
      if (response.showReward && response.rewardView && localPermit.restViews) {
        var restView = localPermit.restViews[rewardId];
        if (!restView) throw new Error('층 정비 선택지가 없습니다.');
        var state = getStageState_(localRun); state.reward = cloneLocal(restView);
        localRun.stageStateJson = safeJsonStringify_(state);
        response.rewardView = cloneLocal(restView); response.stageState.reward = cloneLocal(restView);
      }
      response.localRunState = cloneLocal(localRun);
      return response;
    } finally { Date = nativeDate; }
  }
  function readTable_(name) {
    var keys = {}; keys[DB_SHEETS.STAGES]='stages'; keys[DB_SHEETS.MONSTER_GROUPS]='monsterGroups';
    keys[DB_SHEETS.MONSTERS]='monsters'; keys[DB_SHEETS.MONSTER_AI]='monsterAi'; keys[DB_SHEETS.SKILLS]='skills';
    keys[DB_SHEETS.EFFECTS]='effects'; keys[DB_SHEETS.ITEMS]='items'; keys[DB_SHEETS.REWARDS]='rewards';
    if (name === DB_SHEETS.ANSWER_LOGS) return [];
    if (!keys[name]) throw new Error('전투 스냅샷에 없는 테이블: ' + name);
    return cloneLocal(localSnapshot[keys[name]] || []);
  }
  function readTableCached_(name) { return readTable_(name); }
  function findRowByKey_(name, key, value) { return name === DB_SHEETS.RUNS ? requireRun_(value) : readTable_(name).filter(function(row){return String(row[key]) === String(value);})[0] || null; }
  function findCachedRowByKey_(name, key, value) { return findRowByKey_(name,key,value); }
  function ensureTableColumns_() {}
  function requireRun_(id) { if (!localRun || id !== localRun.runId) throw new Error('게임 진행 정보가 다릅니다.'); return localRun; }
  function updateRowByKey_(name, key, id, patch) { if (name !== DB_SHEETS.RUNS) throw new Error('로컬 전투의 외부 저장 요청'); localRun=Object.assign({},requireRun_(id),patch); return localRun; }
  function getCurrentPlayer_() { return {playerId:localRun.playerId}; }
  function requireRewardRunOwner_() {}
  function getRunWorkbookContext_() { return {workbookId:localRun.workbookId,workbookName:localRun.workbookName}; }
  function getWorkbookPlayWindow_() { return localPlayWindow; }
  function requireRunBeforeWorkbookDeadline_() { if (localPlayWindow.endsAtMs && Date.now() >= localPlayWindow.endsAtMs) throw new Error('문제집 플레이 가능 시간이 종료되었습니다.'); }
  function getBattleClientConfig_() { return localSnapshot.clientConfig || {}; }
  function getConfiguredBasePlayerStats_() { return localSnapshot.basePlayerStats || DEFAULT_BASE_PLAYER_STATS; }
  function getSharedRuleEngine_() { return RULE_ENGINE_SHARED; }
  function updatePlayerProgressFromRun_() {}
  function flushQueuedBattleAnswerLogs_(battle) { battle.pendingAnswerLogs=[]; }
  function logBattleEvent_() {}
  function createPlayerGhostForDefeat_() {}
  function verifyLocalQuestionSnapshot_(question) { return question; }
  function getVerifiedBattleCompletionMs_(receipt, run, battleId) { return receipt && receipt.battleId === battleId ? Number(receipt.completedAtMs || 0) : 0; }
  function generateId_(prefix) { return prefix + '_local_' + localPermit.seed + '_' + (++localIdCounter); }
  function selectPlayerGhostForBattle_(run, stage, state) { state.playerGhostRollStageId=stage.stageId; state.playerGhostRollDone=true; return cloneLocal(localPermit.ghostSelection || {monster:null,context:null,questionCreatorId:''}); }
  function consumePreloadedStageMonsters_() { return null; }
  function toClientObject_(value) { return cloneLocal(value); }
  function toClientValue_(value) { return cloneLocal(value); }
  function buildBattleQuestionCache_() { return []; }
  function buildCommitQuestionMap_() { return {}; }
  function buildFloorRestRewardViewForRun_(run, state) {
    var view=localPermit.restViews && localPermit.restViews[localPermit.selectedRewardId];
    if (!view) throw new Error('서버에서 준비한 층 정비 보상이 없습니다.');
    state.reward=cloneLocal(view); localRun.stageStateJson=safeJsonStringify_(state);
    return {showReward:true,runId:run.runId,workbookId:run.workbookId,workbookName:run.workbookName,
      currency:run.currency,score:run.score,battle:state.battle || {battleId:generateId_('rest'),status:'victory',stage:view.intermissionStage,player:{hp:run.currentHp,stats:calculateStatsWithItemEffects_(safeJsonParse_(run.statsJson,{}),safeJsonParse_(run.itemsJson,[])),baseStats:safeJsonParse_(run.statsJson,{})},monsters:[]},
      rewardView:cloneLocal(view),stageState:cloneLocal(state),clientConfig:getBattleClientConfig_()};
  }
  `;
}

var LOCAL_RUN_RULE_ENGINE_ = null;
var ACTIVE_LOCAL_REPLAY_TIME_ = 0;
function getLocalRunRuleEngine_() {
  if (!LOCAL_RUN_RULE_ENGINE_) LOCAL_RUN_RULE_ENGINE_ = eval(getLocalRunEngineSource_());
  return LOCAL_RUN_RULE_ENGINE_;
}
function signLocalRewardView_(view) {
  var signed = cloneGameDataRows_(view);
  delete signed.localRunState;
  delete signed.localTransitionToken;
  var payload = Utilities.base64EncodeWebSafe(Utilities.newBlob(safeJsonStringify_(signed), 'application/json').getBytes());
  var signature = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('local-reward-v1:' + payload, getLocalQuestionSigningKey_(), Utilities.Charset.UTF_8));
  view.localTransitionToken = payload + '.' + signature;
  return view;
}
function verifyLocalRewardView_(token) {
  var parts = String(token || '').split('.');
  if (parts.length !== 2) throw new Error('보상 진행 정보가 올바르지 않습니다.');
  var expected = Utilities.base64EncodeWebSafe(Utilities.computeHmacSha256Signature('local-reward-v1:' + parts[0], getLocalQuestionSigningKey_(), Utilities.Charset.UTF_8));
  if (!constantTimeStringEquals_(expected, parts[1])) throw new Error('보상 진행 정보 검증에 실패했습니다.');
  return JSON.parse(Utilities.newBlob(Utilities.base64DecodeWebSafe(parts[0]), 'application/json').getDataAsString('UTF-8'));
}
function buildLocalTransitionPermit_(run, stageId, battleId, ghostSelection) {
  return { runId: run.runId, stageId: stageId, battleId: battleId || '',
    seed: parseInt(Utilities.getUuid().replace(/-/g, '').slice(-8), 16) >>> 0,
    issuedAtMs: new Date().getTime(), ghostSelection: ghostSelection || { monster: null, context: null, questionCreatorId: '' } };
}
function prepareLocalRewardTransitions_(view, stagePayload, authToken) {
  var run = requireRun_(stagePayload.runId);
  var snapshot = ACTIVE_GAME_DATA_SNAPSHOT_;
  var battle = stagePayload.battle || {};
  var state = getStageState_(run);
  var moved = buildNextStageMoveForRun_(run, state).run;
  var nextStage = moved.status === STATUS.RUN_CLEARED ? null : loadStage(buildStageId_(moved.currentFloor, moved.currentStage));
  var permit = buildLocalTransitionPermit_(run, view.stageId, battle.battleId);
  view.localTransition = permit;
  // Draw the extra drop with the normal item rules before signing the choices.
  // Each branch excludes the item selected as the ordinary reward.
  if (isBossVictoryReward_(view.stageId, battle)) {
    view.bossItemRewards = {};
    view.choices.forEach(function(choice) {
      var items = safeJsonParse_(run.itemsJson, []);
      var selected = choice.claimReward || choice;
      if (selected.type === REWARD_TYPES.ITEM) items = addItemToOwnedItems_(items, selected.targetId);
      view.bossItemRewards[choice.rewardId] = pickAutoItemReward_(items);
    });
  }
  if (nextStage && !isFloorRestStage_(nextStage)) {
    permit.ghostSelection = selectPlayerGhostForBattle_(moved, nextStage, getStageState_(moved), 'battle_local_' + permit.seed + '_1');
  }
  if (nextStage && isFloorRestStage_(nextStage)) {
    permit.restViews = {};
    // Draw rest choices on the server for each possible selection; only the chosen branch is used.
    var nextCombatRun = buildNextStageMoveForRun_(moved, getStageState_(moved)).run;
    var nextCombatStage = loadStage(buildStageId_(nextCombatRun.currentFloor, nextCombatRun.currentStage));
    var childSeed = buildLocalTransitionPermit_(moved, nextStage.stageId, '');
    var ghost = selectPlayerGhostForBattle_(nextCombatRun, nextCombatStage, getStageState_(nextCombatRun), 'battle_local_' + childSeed.seed + '_1');
    view.choices.forEach(function(choice) {
      var previousSession = ACTIVE_RUN_SESSION_;
      ACTIVE_RUN_SESSION_ = cloneGameDataRows_(previousSession);
      try {
        var payload = cloneGameDataRows_(stagePayload); payload.answerLogs = [];
        payload.stageState = payload.stageState || {}; payload.stageState.reward = cloneGameDataRows_(view);
        commitStageResultUnlocked_(payload, authToken);
        var response = selectRewardUnlocked_(run.runId, choice.rewardId, authToken, view);
        var restView = response.rewardView;
        restView.localTransition = Object.assign({}, childSeed, { ghostSelection: ghost });
        permit.restViews[choice.rewardId] = signLocalRewardView_(restView);
      } finally { ACTIVE_RUN_SESSION_ = previousSession; }
    });
  }
  view.localRunState = cloneGameDataRows_(run);
  return signLocalRewardView_(view);
}
function replayLocalRunTransitions_(transitions, authToken) {
  if (!Array.isArray(transitions) || !transitions.length) return;
  if (!ACTIVE_RUN_SESSION_ || transitions.length > 30) throw new Error('게임 진행 기록이 올바르지 않습니다.');
  ACTIVE_RUN_SESSION_.localAdvanceEnabled = true;
  var completed = ACTIVE_RUN_SESSION_.localTransitionIds || [];
  var expired = false;
  transitions.forEach(function(event) {
    if (expired) return;
    var rewardView = verifyLocalRewardView_(event.rewardToken);
    var permit = rewardView.localTransition;
    var id = String(event.rewardToken).split('.')[1];
    if (completed.indexOf(id) !== -1) return;
    var run = requireRun_(permit.runId);
    var state = getStageState_(run);
    var expectedStageId = state.stageId || buildStageId_(run.currentFloor, run.currentStage);
    var payload = cloneGameDataRows_(event.payload || {});
    if (permit.runId !== run.runId || payload.runId !== run.runId || run.status !== STATUS.RUN_ACTIVE
      || permit.stageId !== expectedStageId || !payload.battle || payload.battle.status !== STATUS.BATTLE_VICTORY
      || payload.battle.stage.stageId !== expectedStageId
      || permit.battleId && permit.battleId !== payload.battle.battleId
      || state.battle && state.battle.battleId !== payload.battle.battleId) throw new Error('스테이지 진행 순서가 올바르지 않습니다.');
    var expectedStats = safeJsonParse_(run.statsJson, {});
    var receivedStats = payload.battle.player && payload.battle.player.baseStats || {};
    if (Object.keys(expectedStats).some(function(key) { return Number(receivedStats[key]) !== Number(expectedStats[key]); })) throw new Error('플레이어 능력치가 게임 진행 기록과 다릅니다.');
    var selectedAt = Number(event.selectedAtMs || 0);
    var now = new Date().getTime();
    if (!isFinite(selectedAt) || selectedAt < permit.issuedAtMs || selectedAt > now + 1000) throw new Error('보상 선택 시간이 올바르지 않습니다.');
    var previousReplayTime = ACTIVE_LOCAL_REPLAY_TIME_;
    ACTIVE_LOCAL_REPLAY_TIME_ = selectedAt;
    try {
      if (getWorkbookPlayWindow_(run.workbookId).expired) {
        commitStageResultUnlocked_(payload, authToken);
        expired = true;
        completed.push(id);
        ACTIVE_RUN_SESSION_.localTransitionIds = completed;
        return;
      }
      payload.stageState = payload.stageState || {};
      payload.stageState.reward = rewardView;
      commitStageResultUnlocked_(payload, authToken);
      var response = getLocalRunRuleEngine_().advance(requireRun_(run.runId), ACTIVE_GAME_DATA_SNAPSHOT_, payload,
        event.rewardId, rewardView, { committed: true, selectedAtMs: selectedAt, playWindow: getWorkbookPlayWindow_(run.workbookId) });
      ACTIVE_RUN_SESSION_.run = cloneGameDataRows_(response.localRunState);
      completed.push(id);
      ACTIVE_RUN_SESSION_.localTransitionIds = completed;
    } finally { ACTIVE_LOCAL_REPLAY_TIME_ = previousReplayTime; }
  });
  return expired;
}
function finishLocalRun(runId, runSessionToken, transitions, authToken) {
  var lock = LockService.getScriptLock(); lock.waitLock(10000);
  try {
    return withRunSession_(runId, runSessionToken, authToken, function() {
      replayLocalRunTransitions_(transitions, authToken);
      var run = requireRun_(runId);
      if (run.status === STATUS.RUN_FAILED) return buildStageResultCommitView_(run, getStageState_(run));
      if (run.status !== STATUS.RUN_CLEARED) throw new Error('최종 승리한 게임만 완료할 수 있습니다.');
      return { cleared: true, run: toClientObject_(run), score: Number(run.score || 0) };
    });
  } finally { lock.releaseLock(); }
}
