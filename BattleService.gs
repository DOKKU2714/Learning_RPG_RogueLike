function canStartGame(playerId, authToken) {
  var player = getCurrentPlayer_(authToken);
  if (player.playerId !== playerId) {
    throw new Error('현재 로그인한 학생 정보와 요청한 플레이어가 다릅니다.');
  }

  var settings = getAppSettings();
  var reasons = [];
  if (!settings.gameEnabled) {
    reasons.push('선생님이 아직 게임 시작을 활성화하지 않았습니다.');
  }

  var myQuestionCount = getQuestionsByCreator_(playerId).length;
  if (myQuestionCount < 1) {
    reasons.push('게임 시작 전 문제를 1개 이상 만들어야 합니다.');
  }
  var latestCompletedRunEndedAt = getLatestCompletedRunEndedAtMs_(playerId);
  if (latestCompletedRunEndedAt > 0 && getLatestCreatedQuestionAtMs_(playerId) <= latestCompletedRunEndedAt) {
    reasons.push('지난 게임이 끝난 뒤 새 문제를 1개 만들어야 다음 게임을 시작할 수 있습니다.');
  }

  return {
    canStart: reasons.length === 0,
    reasons: reasons,
  };
}

function getLatestCompletedRunEndedAtMs_(playerId) {
  return readTable_(DB_SHEETS.RUNS).reduce(function(latest, run) {
    if (run.playerId !== playerId || (run.status !== STATUS.RUN_FAILED && run.status !== STATUS.RUN_CLEARED)) {
      return latest;
    }
    var endedAt = parseDateMs_(run.endedAt || run.updatedAt || run.startedAt);
    return Math.max(latest, endedAt);
  }, 0);
}

function getLatestCreatedQuestionAtMs_(playerId) {
  return getQuestionsByCreator_(playerId).reduce(function(latest, question) {
    return Math.max(latest, parseDateMs_(question.createdAt || question.updatedAt));
  }, 0);
}

function parseDateMs_(value) {
  if (!value) {
    return 0;
  }
  var ms = new Date(value).getTime();
  return isNaN(ms) ? 0 : ms;
}

function startRun(playerId, authToken) {
  return withRunStartLock_(function() {
    validatePlayerRequest_(playerId, authToken);
    var existingRun = getActiveRun(playerId);
    if (existingRun) {
      return toClientObject_(existingRun);
    }

    var check = canStartGame(playerId, authToken);
    if (!check.canStart) {
      throw new Error(check.reasons.join('\n'));
    }

    return createNewRun_(playerId);
  });
}

function getActiveRunSummary(playerId, authToken) {
  validatePlayerRequest_(playerId, authToken);
  var existingRun = getActiveRun(playerId);
  if (existingRun) {
    return toClientObject_({
      hasActiveRun: true,
      run: buildRunResumeSummary_(existingRun),
    });
  }

  var check = canStartGame(playerId, authToken);
  if (!check.canStart) {
    throw new Error(check.reasons.join('\n'));
  }

  return toClientObject_({
    hasActiveRun: false,
    run: null,
  });
}

function restartRun(playerId, authToken) {
  return withRunStartLock_(function() {
    validatePlayerRequest_(playerId, authToken);
    var check = canStartGame(playerId, authToken);
    if (!check.canStart) {
      throw new Error(check.reasons.join('\n'));
    }

    getActiveRunsForPlayer_(playerId).forEach(function(run) {
      abandonActiveRun_(run);
    });
    return createNewRun_(playerId);
  });
}

function validatePlayerRequest_(playerId, authToken) {
  var player = getCurrentPlayer_(authToken);
  if (player.playerId !== playerId) {
    throw new Error('Invalid player request.');
  }
  return player;
}

function withRunStartLock_(callback) {
  var lock = LockService.getScriptLock();
  lock.waitLock(5000);
  try {
    return callback();
  } finally {
    lock.releaseLock();
  }
}

function createNewRun_(playerId) {
  ensureTableColumns_(DB_SHEETS.RUNS, DB_COLUMNS.RUNS);
  var now = new Date();
  var stats = Object.assign({}, BASE_PLAYER_STATS);
  var startingScore = typeof calculateQuestionLikeStartingScore_ === 'function'
    ? calculateQuestionLikeStartingScore_(playerId)
    : 0;
  var run = {
    runId: generateId_('run'),
    playerId: playerId,
    status: STATUS.RUN_ACTIVE,
    currentFloor: 1,
    currentStage: 1,
    currentHp: stats.hp,
    currentShield: 0,
    statsJson: safeJsonStringify_(stats),
    skillsJson: safeJsonStringify_([]),
    itemsJson: safeJsonStringify_([]),
    stageStateJson: safeJsonStringify_({
      stageId: buildStageId_(1, 1),
      otherStudentQuestionShown: false,
      fallbackEvents: [],
      usedQuestionIds: [],
      scoreState: {
        floorStartedAtByFloor: {
          1: now.toISOString(),
        },
      },
    }),
    startedAt: now,
    updatedAt: now,
    endedAt: '',
    clearTimeMs: '',
    currency: 0,
    score: Math.max(0, Math.round(Number(startingScore || 0))),
  };

  appendRowObject_(DB_SHEETS.RUNS, run);
  cacheRun_(run);
  return startBattle(run.runId);
}

function buildRunResumeSummary_(run) {
  var stageName = '';
  try {
    var stageState = getStageState_(run);
    var stage = loadStage(stageState.stageId || buildStageId_(run.currentFloor, run.currentStage));
    stageName = stage.name || '';
  } catch (error) {
    stageName = '';
  }
  return {
    runId: run.runId,
    currentFloor: Number(run.currentFloor || 1),
    currentStage: Number(run.currentStage || 1),
    stageName: stageName,
    currentHp: Number(run.currentHp || 0),
    currentShield: Number(run.currentShield || 0),
    currency: Number(run.currency || 0),
    score: Number(run.score || 0),
    startedAt: run.startedAt || '',
    updatedAt: run.updatedAt || '',
  };
}

function abandonActiveRun_(run) {
  var now = new Date();
  return updateRowByKey_(DB_SHEETS.RUNS, 'runId', run.runId, {
    status: STATUS.RUN_FAILED,
    updatedAt: now,
    endedAt: now,
  });
}

function getActiveRun(playerId) {
  var activeRun = getActiveRunsForPlayer_(playerId)[0] || null;
  if (!activeRun) {
    return null;
  }

  var cachedRun = getCachedRun_(activeRun.runId);
  if (isCachedRunFreshForRow_(cachedRun, activeRun)) {
    return cachedRun;
  }
  return cacheRun_(activeRun);
}

function getActiveRunsForPlayer_(playerId) {
  return readTable_(DB_SHEETS.RUNS).map(function(run, index) {
    return { run: run, index: index };
  }).filter(function(entry) {
    return entry.run.playerId === playerId && entry.run.status === STATUS.RUN_ACTIVE;
  }).sort(function(a, b) {
    return (getRunUpdatedAtMs_(b.run) - getRunUpdatedAtMs_(a.run)) || (b.index - a.index);
  }).map(function(entry) {
    return entry.run;
  });
}

function getRunUpdatedAtMs_(run) {
  return parseDateMs_(run && (run.updatedAt || run.startedAt)) || 0;
}

function isCachedRunFreshForRow_(cachedRun, sheetRun) {
  if (!cachedRun || !sheetRun || cachedRun.status !== sheetRun.status) {
    return false;
  }
  var sheetUpdatedAt = getRunUpdatedAtMs_(sheetRun);
  var cachedUpdatedAt = getRunUpdatedAtMs_(cachedRun);
  return !sheetUpdatedAt || cachedUpdatedAt >= sheetUpdatedAt;
}

function loadStage(stageId) {
  ensureTableColumns_(DB_SHEETS.STAGES, DB_COLUMNS.STAGES);
  var stage = findCachedRowByKey_(DB_SHEETS.STAGES, 'stageId', stageId, 600);
  if (!stage) {
    throw new Error('스테이지를 찾을 수 없습니다: ' + stageId);
  }
  return normalizeStageDifficulty_(stage);
}

function normalizeStageDifficulty_(stage) {
  var normalized = Object.assign({}, stage || {});
  var seededBaseDifficulty = getSeededStageBaseDifficulty_(normalized);
  var baseDifficulty = getStageDifficultyNumber_(normalized.baseDifficulty, seededBaseDifficulty);
  var minDifficulty = getStageDifficultyNumber_(normalized.minDifficulty, baseDifficulty);
  var maxDifficulty = getStageDifficultyNumber_(normalized.maxDifficulty, baseDifficulty);
  if (minDifficulty > maxDifficulty) {
    minDifficulty = maxDifficulty;
  }
  normalized.baseDifficulty = baseDifficulty;
  normalized.minDifficulty = minDifficulty;
  normalized.maxDifficulty = maxDifficulty;
  normalized.questionDifficultyBonus = getStageDifficultyBonusNumber_(normalized.questionDifficultyBonus, 0);
  return normalized;
}

function getStageDifficultyNumber_(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return clampDifficulty_(fallback || GAME_RULES.MIN_DIFFICULTY);
  }
  var number = Number(value);
  if (!isFinite(number)) {
    return clampDifficulty_(fallback || GAME_RULES.MIN_DIFFICULTY);
  }
  return clampDifficulty_(number);
}

function getStageDifficultyBonusNumber_(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return Number(fallback || 0);
  }
  var number = Number(value);
  if (!isFinite(number)) {
    return Number(fallback || 0);
  }
  return Math.max(-GAME_RULES.MAX_DIFFICULTY, Math.min(GAME_RULES.MAX_DIFFICULTY, Math.round(number)));
}

function getSeededStageBaseDifficulty_(stage) {
  var floor = Number(stage && stage.floor || 0);
  var stageNumber = Number(stage && stage.stage || 0);
  if (!floor || !stageNumber || stageNumber > Number(GAME_RULES.STAGES_PER_FLOOR || 5)) {
    return GAME_RULES.MIN_DIFFICULTY;
  }
  var globalStage = ((floor - 1) * Number(GAME_RULES.STAGES_PER_FLOOR || 5)) + stageNumber;
  return Math.min(GAME_RULES.MAX_DIFFICULTY, Math.max(GAME_RULES.MIN_DIFFICULTY, Math.ceil(globalStage / 3)));
}

function getStageDifficultyRange_(stage) {
  var normalized = normalizeStageDifficulty_(stage || {});
  return {
    minDifficulty: Number(normalized.minDifficulty || GAME_RULES.MIN_DIFFICULTY),
    maxDifficulty: Number(normalized.maxDifficulty || GAME_RULES.MAX_DIFFICULTY),
  };
}

function normalizePlayerActionPoints_(battleState, resetForTurn) {
  if (!battleState || !battleState.player) {
    return null;
  }
  var player = battleState.player;
  player.baseMaxActionPoint = Math.max(0, Number(player.baseMaxActionPoint || GAME_RULES.DEFAULT_MAX_ACTION_POINT));
  var maxDelta = Number(player.actionPointMaxDelta || 0);
  var maxActionPoint = Math.max(0, player.baseMaxActionPoint + maxDelta);
  player.maxActionPoint = maxActionPoint;
  if (resetForTurn || player.currentActionPoint === undefined || player.currentActionPoint === null || player.currentActionPoint === '') {
    var nextDelta = Number(player.nextTurnActionPointDelta || 0);
    player.currentActionPoint = Math.max(0, Math.min(maxActionPoint, maxActionPoint + nextDelta));
    player.nextTurnActionPointDelta = 0;
  } else {
    player.currentActionPoint = Math.max(0, Math.min(maxActionPoint, Number(player.currentActionPoint || 0)));
  }
  return player;
}

function getActionPointCostForAction_(actionType, skill) {
  if (actionType === ACTION_TYPES.SKILL) {
    return Math.max(0, Math.min(3, Number(skill && skill.actionPointCost !== undefined && skill.actionPointCost !== '' ? skill.actionPointCost : 1)));
  }
  return 1;
}

function hasEnoughActionPoint_(battleState, cost) {
  var player = normalizePlayerActionPoints_(battleState, false);
  return Number(player.currentActionPoint || 0) >= Number(cost || 0);
}

function consumeActionPoint_(battleState, cost) {
  var player = normalizePlayerActionPoints_(battleState, false);
  var actionCost = Math.max(0, Number(cost || 0));
  if (Number(player.currentActionPoint || 0) < actionCost) {
    throw new Error('행동력이 부족합니다.');
  }
  player.currentActionPoint = Math.max(0, Number(player.currentActionPoint || 0) - actionCost);
  return player.currentActionPoint;
}

function applyActionPointEffectConfig_(target, config) {
  if (!target || !config) {
    return target;
  }
  if (target.currentHp !== undefined) {
    return target;
  }
  normalizePlayerActionPointFields_(target);
  var maxDelta = Number(config.maxActionPointAdd || 0) - Number(config.maxActionPointSub || 0);
  if (maxDelta) {
    target.actionPointMaxDelta = Number(target.actionPointMaxDelta || 0) + maxDelta;
  }
  var currentDelta = Number(config.currentActionPointAdd || 0) - Number(config.currentActionPointSub || 0);
  if (currentDelta) {
    target.currentActionPoint = Number(target.currentActionPoint || 0) + currentDelta;
  }
  var nextDelta = Number(config.nextTurnActionPointAdd || 0) - Number(config.nextTurnActionPointSub || 0);
  if (nextDelta) {
    target.nextTurnActionPointDelta = Number(target.nextTurnActionPointDelta || 0) + nextDelta;
  }
  normalizePlayerActionPointFields_(target);
  return target;
}

function normalizePlayerActionPointFields_(player) {
  player.baseMaxActionPoint = Math.max(0, Number(player.baseMaxActionPoint || GAME_RULES.DEFAULT_MAX_ACTION_POINT));
  player.actionPointMaxDelta = Number(player.actionPointMaxDelta || 0);
  player.nextTurnActionPointDelta = Number(player.nextTurnActionPointDelta || 0);
  player.maxActionPoint = Math.max(0, player.baseMaxActionPoint + player.actionPointMaxDelta);
  player.currentActionPoint = Math.max(0, Math.min(player.maxActionPoint, Number(player.currentActionPoint !== undefined && player.currentActionPoint !== '' ? player.currentActionPoint : player.maxActionPoint)));
  return player;
}

function startBattle(runId) {
  var run = requireRun_(runId);
  var stageState = getStageState_(run);
  var stage = loadStage(stageState.stageId || buildStageId_(run.currentFloor, run.currentStage));
  stageState.usedQuestionStageId = stage.stageId;
  stageState.usedQuestionIds = [];
  var usedQuestionIds = normalizeUsedQuestionIds_(stageState, null);
  if (Number(stage.stage || 0) === GAME_RULES.FLOOR_REST_STAGE && typeof buildFloorRestRewardViewForRun_ === 'function') {
    return buildFloorRestRewardViewForRun_(run, stageState);
  }
  var battleId = generateId_('battle');
  var playerGhostSelection = selectPlayerGhostForBattle_(run, stage, stageState, battleId);
  var monsters = createMonstersForStage_(stage, playerGhostSelection.monster);
  var baseStats = safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS));
  var items = normalizeOwnedItems_(safeJsonParse_(run.itemsJson, []));
  var stats = calculateStatsWithItemEffects_(baseStats, items);
  var battleState = {
    runId: run.runId,
    battleId: battleId,
    status: STATUS.BATTLE_ACTIVE,
    turn: 1,
    stage: {
      stageId: stage.stageId,
      floor: Number(stage.floor),
      stage: Number(stage.stage),
      name: stage.name,
      baseDifficulty: Number(stage.baseDifficulty),
      minDifficulty: Number(stage.minDifficulty),
      maxDifficulty: Number(stage.maxDifficulty),
      questionDifficultyBonus: Number(stage.questionDifficultyBonus || 0),
      monsterGroupId: stage.monsterGroupId || '',
      bossMonsterId: stage.bossMonsterId || '',
      bossConfig: {},
      rewardGroupId: stage.rewardGroupId,
    },
    player: {
      hp: Number(run.currentHp || stats.hp),
      maxHp: Number(stats.hp),
      shield: Number(run.currentShield || 0),
      baseMaxActionPoint: GAME_RULES.DEFAULT_MAX_ACTION_POINT,
      maxActionPoint: GAME_RULES.DEFAULT_MAX_ACTION_POINT,
      currentActionPoint: GAME_RULES.DEFAULT_MAX_ACTION_POINT,
      actionPointMaxDelta: 0,
      nextTurnActionPointDelta: 0,
      baseStats: baseStats,
      stats: stats,
      items: items,
      itemModifiers: buildItemModifiers_(items),
      effects: [],
    },
    monsters: monsters,
    monster: monsters[0],
    playerGhost: playerGhostSelection.context,
    forcedQuestionCreatorId: playerGhostSelection.questionCreatorId || '',
    pendingAction: null,
    pendingAnswerLogs: [],
    monsterScoreState: {
      battleId: battleId,
      monsterScore: 0,
      byMonsterId: {},
    },
    usedQuestionIds: usedQuestionIds.slice(),
    usedQuestionStageId: stage.stageId,
    lastMessage: '전투가 시작되었습니다.',
    lastTurnEvents: [],
    skillCooldowns: {},
    skillUseCounts: {},
    usedSkillTagsThisBattle: [],
    usedSkillTagsThisTurn: [],
    usedSkillCountByTagThisBattle: {},
    usedSkillCountByTagThisTurn: {},
    activeTriggers: [],
  };
  applyBattleStartItemEffects_(battleState);
  decideMonsterIntents(battleState);

  stageState.battle = battleState;
  stageState.stageId = stage.stageId;
  stageState.otherStudentQuestionShown = !!stageState.otherStudentQuestionShown;
  stageState.playerGhost = playerGhostSelection.context;
  stageState.scoreState = stageState.scoreState || {};
  stageState.scoreState.monsterScoreBattleId = battleId;
  stageState.scoreState.monsterScore = 0;
  stageState.scoreState.answerScore = 0;
  normalizeUsedQuestionIds_(stageState, battleState);
  saveStageState_(runId, stageState, battleState);
  return toClientObject_(getRunWithStageState_(runId));
}

function getBattleView(authToken) {
  var player = getCurrentPlayer_(authToken);
  var run = getActiveRun(player.playerId);
  if (!run) {
    throw new Error('진행 중인 런이 없습니다. 메인 화면에서 게임을 시작해 주세요.');
  }

  var stageState = getStageState_(run);
  if (!stageState.battle) {
    startBattle(run.runId);
    run = requireRun_(run.runId);
    stageState = getStageState_(run);
  }

  return buildBattleView_(run, stageState);
}

function surrenderBattle(runId, authToken) {
  var player = getCurrentPlayer_(authToken);
  var run = requireRun_(runId);
  if (run.playerId !== player.playerId || run.status !== STATUS.RUN_ACTIVE) {
    throw new Error('진행 중인 전투를 찾을 수 없습니다.');
  }

  var stageState = getStageState_(run);
  var battleState = requireActiveBattle_(stageState);
  battleState.runId = battleState.runId || run.runId;
  normalizeUsedQuestionIds_(stageState, battleState);
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  battleState.player.hp = 0;
  battleState.player.shield = 0;
  battleState.status = STATUS.BATTLE_DEFEAT;
  battleState.lastMessage = '전투를 포기했습니다.';
  battleState.lastTurnEvents = [{
    actor: 'player',
    type: 'surrender',
    message: battleState.lastMessage,
  }];
  stageState.battle = battleState;
  saveStageState_(runId, stageState, battleState);

  var updatedRun = requireRun_(runId);
  return buildBattleView_(updatedRun, getStageState_(updatedRun));
}

function passPlayerTurn(runId, authToken) {
  var player = getCurrentPlayer_(authToken);
  var run = requireRun_(runId);
  if (run.playerId !== player.playerId || run.status !== STATUS.RUN_ACTIVE) {
    throw new Error('진행 중인 전투를 찾을 수 없습니다.');
  }

  var stageState = getStageState_(run);
  var battleState = requireActiveBattle_(stageState);
  normalizeUsedQuestionIds_(stageState, battleState);
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  normalizePlayerActionPoints_(battleState, false);
  battleState.pendingAction = null;
  battleState.player.currentActionPoint = 0;
  battleState.lastTurnEvents = [];

  if (battleState.player.hp > 0 && battleState.status === STATUS.BATTLE_ACTIVE) {
    if (areAllMonstersDefeated_(battleState)) {
      battleState.status = STATUS.BATTLE_VICTORY;
      battleState.lastMessage = '몬스터를 처치했습니다.';
      logBattleEvent_(run, STATUS.BATTLE_VICTORY, { battleId: battleState.battleId });
    } else {
      clearMonsterTurnShields_(battleState);
      applyMonsterTurn(battleState);
      clearPlayerTurnShield_(battleState);
      tickEffectsAtTurnEnd(battleState);
    }
  }

  battleState.turn = Number(battleState.turn || 1) + 1;
  if (battleState.player.hp <= 0) {
    battleState.status = STATUS.BATTLE_DEFEAT;
    battleState.lastMessage = '몬스터의 공격으로 쓰러졌습니다.';
  }
  if (battleState.status === STATUS.BATTLE_ACTIVE) {
    normalizePlayerActionPoints_(battleState, true);
    decrementSkillCooldowns_(battleState);
    battleState.usedSkillTagsThisTurn = [];
    battleState.usedSkillCountByTagThisTurn = {};
    tickEffectsAtTurnStart(battleState);
    if (areAllMonstersDefeated_(battleState)) {
      battleState.status = STATUS.BATTLE_VICTORY;
      battleState.lastMessage = '몬스터를 처치했습니다.';
      logBattleEvent_(run, STATUS.BATTLE_VICTORY, { battleId: battleState.battleId });
    } else if (battleState.player.hp <= 0) {
      battleState.status = STATUS.BATTLE_DEFEAT;
      battleState.lastMessage = '지속 피해로 쓰러졌습니다.';
    } else {
      decideMonsterIntents(battleState);
      battleState.lastMessage = '내 턴입니다. 행동을 선택하세요.';
    }
  }

  flushQueuedBattleAnswerLogs_(battleState);
  stageState.battle = battleState;
  saveStageState_(run.runId, stageState, battleState);
  return buildBattleView_(requireRun_(run.runId), getStageState_(requireRun_(run.runId)));
}

function selectQuestionForAction(playerId, runId, actionType, difficultyBonus, authToken, targetId, skillId) {
  var player = getCurrentPlayer_(authToken);
  if (player.playerId !== playerId) {
    throw new Error('현재 로그인한 학생 정보와 요청한 플레이어가 다릅니다.');
  }

  var normalizedAction = normalizeActionType_(actionType);
  var run = requireRun_(runId);
  if (run.playerId !== playerId || run.status !== STATUS.RUN_ACTIVE) {
    throw new Error('진행 중인 런을 찾을 수 없습니다.');
  }

  var stageState = getStageState_(run);
  var battleState = requireActiveBattle_(stageState);
  normalizeUsedQuestionIds_(stageState, battleState);
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  normalizePlayerActionPoints_(battleState, false);
  if (hasEffect_(battleState.player, 'debuff_stun') || hasEffect_(battleState.player, 'debuff_freeze')) {
    throw new Error('행동할 수 없는 상태입니다.');
  }
  var skill = normalizedAction === ACTION_TYPES.SKILL && skillId ? findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', skillId, 600) : null;
  var actionCost = getActionPointCostForAction_(normalizedAction, skill);
  if (!hasEnoughActionPoint_(battleState, actionCost)) {
    throw new Error('행동력이 부족합니다.');
  }
  if (battleState.pendingAction) {
    markQuestionUsedForRun_(stageState, battleState, battleState.pendingAction.questionId);
    saveStageState_(runId, stageState, battleState);
    return buildQuestionView_(battleState.pendingAction.question, battleState.pendingAction, playerId);
  }

  var activeEffects = getActiveEffectsForQuestion_(battleState);
  var questionModifiersForPick = getItemQuestionModifiers_(battleState, null);
  var effectiveDifficultyBonus = normalizedAction === ACTION_TYPES.SKILL ? Number(skill && skill.difficultyBonus || 0) : Number(difficultyBonus || 0);
  var targetDifficulty = calculateRequiredQuestionDifficulty_(battleState.stage, effectiveDifficultyBonus, activeEffects, questionModifiersForPick);
  var questionResult = pickQuestion_(playerId, battleState.stage, stageState.otherStudentQuestionShown, getForcedQuestionCreatorId_(battleState), questionModifiersForPick, stageState.usedQuestionIds, targetDifficulty);
  var questionModifiers = getItemQuestionModifiers_(battleState, questionResult.question);
  var finalDifficulty = targetDifficulty;
  var maxMs = calculateFinalQuestionTimeLimitForQuestion_(finalDifficulty, activeEffects, questionResult.question, questionModifiers);
  var pendingAction = {
    actionType: normalizedAction,
    skillId: normalizedAction === ACTION_TYPES.SKILL ? skillId || '' : '',
    targetId: normalizedAction === ACTION_TYPES.ATTACK || normalizedAction === ACTION_TYPES.SKILL ? targetId || '' : '',
    actionPointCost: actionCost,
    questionId: questionResult.question.questionId,
    question: sanitizeQuestionForClient_(questionResult.question, playerId),
    issuedAt: new Date().getTime(),
    maxMs: maxMs,
    finalDifficulty: finalDifficulty,
    maxAnswerEfficiency: calculateMaxAnswerEfficiency_(questionModifiers),
    questionModifiers: questionModifiers,
    isOtherPlayerQuestion: questionResult.isOtherPlayerQuestion,
    fallbackReason: questionResult.fallbackReason,
  };

  battleState.pendingAction = pendingAction;
  markQuestionUsedForRun_(stageState, battleState, pendingAction.questionId);
  if (questionResult.isOtherPlayerQuestion) {
    stageState.otherStudentQuestionShown = true;
  }
  if (questionResult.fallbackReason) {
    stageState.fallbackEvents = stageState.fallbackEvents || [];
    stageState.fallbackEvents.push({
      battleId: battleState.battleId,
      actionType: normalizedAction,
      reason: questionResult.fallbackReason,
      createdAt: new Date().toISOString(),
    });
  }

  saveStageState_(runId, stageState, battleState);
  return buildQuestionView_(pendingAction.question, pendingAction, playerId);
}

function submitActionAnswer(answerPayload) {
  var payload = answerPayload || {};
  var player = getCurrentPlayer_(payload.authToken);
  var run = requireRun_(payload.runId);
  if (run.playerId !== player.playerId) {
    throw new Error('현재 플레이어의 런이 아닙니다.');
  }

  var stageState = getStageState_(run);
  var battleState = requireActiveBattle_(stageState);
  normalizeUsedQuestionIds_(stageState, battleState);
  normalizeBattleStateEffects_(battleState);
  var pendingAction = battleState.pendingAction;
  if (!pendingAction && payload.questionId) {
    pendingAction = createPendingActionFromCachedPayload_(
      stageState,
      battleState,
      payload,
      normalizeActionType_(payload.actionType || ACTION_TYPES.ATTACK),
      payload.skillId || '',
      payload.targetId || '',
      player.playerId
    );
    battleState.pendingAction = pendingAction;
    markQuestionUsedForRun_(stageState, battleState, pendingAction.questionId);
    markCachedQuestionShown_(stageState, pendingAction);
  }
  if (!pendingAction || pendingAction.questionId !== payload.questionId) {
    throw new Error('풀이 중인 문제가 없습니다.');
  }

  var question = findCachedRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', pendingAction.questionId, 120);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  markQuestionUsedForRun_(stageState, battleState, pendingAction.questionId);
  var elapsedMs = Math.max(0, Number(payload.elapsedMs || 0));
  var maxMs = Number(pendingAction.maxMs || calculateFinalQuestionTimeLimitForQuestion_(pendingAction.finalDifficulty, getActiveEffectsForQuestion_(battleState), pendingAction.question || question, getItemQuestionModifiers_(battleState, question)));
  var remainingMs = Math.max(0, maxMs - elapsedMs);
  var gaveUp = !!payload.giveUp;
  var isCorrect = gaveUp ? false : isCorrectAnswer_(question, payload.selectedAnswer, payload.selectedChoiceIndex, payload.selectedAnswerText);
  var wrongCountAfterTimeout = Number(payload.wrongCountAfterTimeout || 0);
  var efficiency = gaveUp ? 0 : calculateEfficiency(isCorrect, remainingMs, maxMs, wrongCountAfterTimeout, getItemQuestionModifiers_(battleState, question), question);

  battleState.lastTurnEvents = [];
  consumeActionPoint_(battleState, Number(pendingAction.actionPointCost !== undefined && pendingAction.actionPointCost !== '' ? pendingAction.actionPointCost : getActionPointCostForAction_(pendingAction.actionType, null)));
  if (gaveUp) {
    battleState.lastPlayerAction = { type: pendingAction.actionType, value: 0, efficiency: 0, gaveUp: true };
    battleState.lastMessage = '문제를 포기했습니다. 행동력만 소모했습니다.';
    battleState.lastTurnEvents.push({ actor: 'player', type: 'giveUp', message: battleState.lastMessage });
  }
  if (!gaveUp) {
    tickEffectsOnPlayerAction(battleState);
    if (battleState.player.hp <= 0) {
      battleState.status = STATUS.BATTLE_DEFEAT;
      battleState.lastMessage = '지속 피해로 쓰러졌습니다.';
    }
  }
  if (!gaveUp && battleState.player.hp > 0 && battleState.status === STATUS.BATTLE_ACTIVE) {
    setActiveMonsterScoreContext_(battleState, pendingAction.questionId, efficiency);
    if (pendingAction.actionType === ACTION_TYPES.GUARD) {
      applyGuard(battleState, efficiency);
    } else {
      applyAttack(battleState, efficiency, pendingAction.targetId || payload.targetId || '');
    }
    clearActiveMonsterScoreContext_(battleState);
  }
  if (areAllMonstersDefeated_(battleState)) {
    battleState.status = STATUS.BATTLE_VICTORY;
    battleState.lastMessage = '몬스터를 처치했습니다.';
    logBattleEvent_(run, STATUS.BATTLE_VICTORY, { battleId: battleState.battleId });
  }
  battleState.pendingAction = null;
  stageState.battle = battleState;

  queueBattleAnswerLog_(battleState, {
    questionId: question.questionId,
    playerId: player.playerId,
    creatorId: question.creatorId,
    runId: run.runId,
    battleId: battleState.battleId,
    floor: battleState.stage.floor,
    stage: battleState.stage.stage,
    actionType: pendingAction.actionType,
    selectedAnswer: gaveUp ? '[giveUp]' : payload.selectedAnswerText || payload.selectedAnswer || '',
    isCorrect: isCorrect,
    elapsedMs: elapsedMs,
    maxTimeMs: maxMs,
    efficiency: efficiency,
    finalDifficulty: pendingAction.finalDifficulty,
    isOtherPlayerQuestion: pendingAction.isOtherPlayerQuestion,
    scoreDelta: 0,
  });
  if (battleState.status !== STATUS.BATTLE_ACTIVE) {
    flushQueuedBattleAnswerLogs_(battleState);
  }
  saveStageState_(run.runId, stageState, battleState);

  return buildBattleView_(requireRun_(run.runId), getStageState_(requireRun_(run.runId)));
}

function calculateQuestionTimeLimit(difficulty, activeEffects) {
  return calculateFinalQuestionTimeLimit(difficulty, activeEffects);
}

function calculateFinalQuestionDifficulty(baseDifficulty, activeEffects, questionModifiers) {
  var difficultyBonus = getEffectFlatBonus_(activeEffects, STAT_KEYS.QUESTION_DIFFICULTY);
  difficultyBonus += Number(questionModifiers && questionModifiers.questionDifficulty || 0);
  return clampDifficulty_(Number(baseDifficulty || GAME_RULES.MIN_DIFFICULTY) + difficultyBonus);
}

function calculateRequiredQuestionDifficulty_(stage, difficultyBonus, activeEffects, questionModifiers) {
  var stageBase = Number(stage && stage.baseDifficulty || GAME_RULES.MIN_DIFFICULTY);
  var stageBonus = getStageQuestionDifficultyBonus_(stage);
  var adjustedBase = stageBase + stageBonus + Number(difficultyBonus || 0);
  return clampDifficultyToStageRange_(calculateFinalQuestionDifficulty(adjustedBase, activeEffects, questionModifiers), stage);
}

function clampDifficultyToStageRange_(difficulty, stage) {
  var range = getStageDifficultyRange_(stage || {});
  var value = clampDifficulty_(difficulty);
  return Math.max(Number(range.minDifficulty || GAME_RULES.MIN_DIFFICULTY), Math.min(Number(range.maxDifficulty || GAME_RULES.MAX_DIFFICULTY), value));
}

function calculateEfficiency(isCorrect, remainingMs, maxMs, wrongCountAfterTimeout, questionModifiers, question) {
  var efficiencyRules = getAnswerEfficiencyRules_();
  var minEfficiency = efficiencyRules.minAnswerEfficiency;
  var maxEfficiency = calculateMaxAnswerEfficiency_(questionModifiers, efficiencyRules.maxAnswerEfficiency);
  var extraPenalty = efficiencyRules.extraWrongEfficiencyPenalty;
  var penaltyCount = Math.max(0, Number(wrongCountAfterTimeout || 0));
  if (penaltyCount > 0) {
    return roundTo_(Math.max(0, minEfficiency - (extraPenalty * (penaltyCount - 1))), 3);
  }

  if (isCorrect) {
    var correctEfficiencyBonus = getQuestionCorrectEfficiencyBonusPercent_(questionModifiers, question) / 100;
    var ratio = Math.max(0, Math.min(1, Number(remainingMs || 0) / Math.max(1, Number(maxMs || 1))));
    if (ratio >= 0.5) {
      var highEfficiency = 1 + ((ratio - 0.5) * ((maxEfficiency - 1) / 0.5));
      highEfficiency += correctEfficiencyBonus;
      return roundTo_(Math.min(maxEfficiency, highEfficiency), 3);
    }
    var lowEfficiency = minEfficiency + (ratio * ((1 - minEfficiency) / 0.5));
    lowEfficiency += correctEfficiencyBonus;
    return roundTo_(Math.min(maxEfficiency, lowEfficiency), 3);
  }

  return roundTo_(minEfficiency, 3);
}

function calculateMaxAnswerEfficiency_(questionModifiers, baseMaxEfficiency) {
  var base = Number(baseMaxEfficiency || getAnswerEfficiencyRules_().maxAnswerEfficiency);
  return Math.max(0, roundTo_(base * (1 + (Number(questionModifiers && questionModifiers.questionMaxEfficiencyPercent || 0) / 100)), 3));
}

function getQuestionCorrectEfficiencyBonusPercent_(questionModifiers, question) {
  var bonus = Number(questionModifiers && questionModifiers.answerCorrectEfficiencyPercent || 0);
  var byType = questionModifiers && questionModifiers.answerCorrectEfficiencyByType || {};
  if (question && question.type && byType[question.type] !== undefined) {
    bonus += Number(byType[question.type] || 0);
  }
  if (question && question.type === QUESTION_TYPES.SHORT_ANSWER) {
    bonus += Number(questionModifiers && questionModifiers.shortAnswerCorrectEfficiencyPercent || 0);
  }
  return bonus;
}

function getAnswerEfficiencyRules_() {
  var settings = {};
  try {
    settings = getAppSettings();
  } catch (error) {
    settings = {};
  }
  var minEfficiency = Number(settings.minAnswerEfficiency !== undefined && settings.minAnswerEfficiency !== '' ? settings.minAnswerEfficiency : GAME_RULES.MIN_ANSWER_EFFICIENCY);
  var maxEfficiency = Number(settings.maxAnswerEfficiency !== undefined && settings.maxAnswerEfficiency !== '' ? settings.maxAnswerEfficiency : GAME_RULES.MAX_ANSWER_EFFICIENCY);
  var extraPenalty = Number(settings.extraWrongEfficiencyPenalty !== undefined && settings.extraWrongEfficiencyPenalty !== '' ? settings.extraWrongEfficiencyPenalty : GAME_RULES.EXTRA_WRONG_EFFICIENCY_PENALTY);
  if (!isFinite(minEfficiency)) minEfficiency = GAME_RULES.MIN_ANSWER_EFFICIENCY;
  if (!isFinite(maxEfficiency)) maxEfficiency = GAME_RULES.MAX_ANSWER_EFFICIENCY;
  if (!isFinite(extraPenalty)) extraPenalty = GAME_RULES.EXTRA_WRONG_EFFICIENCY_PENALTY;
  minEfficiency = Math.max(0, Math.min(1, minEfficiency));
  maxEfficiency = Math.max(1, maxEfficiency);
  return {
    minAnswerEfficiency: minEfficiency,
    maxAnswerEfficiency: maxEfficiency,
    extraWrongEfficiencyPenalty: Math.max(0, extraPenalty),
  };
}

function applyAttack(battleState, efficiency, targetId) {
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  var effectiveStats = calculateEffectiveStats(battleState.player.stats || BASE_PLAYER_STATS, battleState.player.effects || []);
  var attack = Number(effectiveStats.attack || BASE_PLAYER_STATS.attack);
  var baseDamage = Math.max(0, Math.round(attack * Number(efficiency || 0)));
  var target = getAliveMonsterById_(battleState, targetId) || getFirstAliveMonster_(battleState);
  if (!target) {
    return battleState;
  }
  var targetStats = calculateEffectiveStats({
    attack: target.attack,
    defense: target.defense,
    hp: target.maxHp,
    evasion: target.evasion,
    accuracy: 100,
  }, target.effects || []);
  var hit = rollHit_(effectiveStats, targetStats);
  if (!hit.hit) {
    battleState.lastMessage = target.name + '에게 공격했지만 빗나갔습니다.';
    battleState.lastPlayerAction = { type: ACTION_TYPES.ATTACK, value: 0, efficiency: efficiency, targetMonsterId: target.instanceId || target.monsterId, missed: true, hitChance: hit.chance };
    battleState.lastTurnEvents = battleState.lastTurnEvents || [];
    battleState.lastTurnEvents.push({
      actor: 'player',
      type: ACTION_TYPES.ATTACK,
      targetMonsterId: target.instanceId || target.monsterId,
      targetName: target.name,
      damage: 0,
      missed: true,
      hitChance: hit.chance,
      message: battleState.lastMessage,
    });
    return battleState;
  }
  var critical = rollCriticalDamage_(baseDamage, effectiveStats);
  var damage = applyFrozenBonusIfNeeded_(target, critical.damage);
  damage = applyOutgoingItemDamageModifiers_(battleState, damage, { actionType: ACTION_TYPES.ATTACK });
  var damageResult = dealDamageToMonster_(battleState, target, damage);
  syncPrimaryMonster_(battleState);
  battleState.lastMessage = target.name + '에게 ' + damage + ' 피해를 주었습니다.';
  battleState.lastPlayerAction = { type: ACTION_TYPES.ATTACK, value: damage, efficiency: efficiency, targetMonsterId: target.instanceId || target.monsterId };
  battleState.lastMessage = critical.isCritical
    ? target.name + '에게 치명타! ' + damageResult.damage + ' 피해를 주었습니다.'
    : target.name + '에게 ' + damageResult.damage + ' 피해를 주었습니다.';
  battleState.lastPlayerAction = { type: ACTION_TYPES.ATTACK, value: damageResult.damage, efficiency: efficiency, targetMonsterId: target.instanceId || target.monsterId, isCritical: critical.isCritical, criticalMultiplier: critical.multiplier };
  battleState.lastTurnEvents = battleState.lastTurnEvents || [];
  battleState.lastTurnEvents.push({
    actor: 'player',
    type: ACTION_TYPES.ATTACK,
    targetMonsterId: target.instanceId || target.monsterId,
    targetName: target.name,
    damage: damageResult.damage,
    shieldDamage: damageResult.shieldDamage,
    hpDamage: damageResult.hpDamage,
    isCritical: critical.isCritical,
    criticalMultiplier: critical.multiplier,
    message: battleState.lastMessage,
  });
  return battleState;
}

function rollCriticalDamage_(damage, stats) {
  var baseDamage = Math.max(0, Math.round(Number(damage || 0)));
  var criticalRate = clampPercent_(Number(stats && stats.criticalRate || 0));
  var criticalDamage = Math.max(0, Number(stats && stats.criticalDamage || 100));
  var isCritical = baseDamage > 0 && criticalRate > 0 && Math.random() * 100 < criticalRate;
  var multiplier = isCritical ? criticalDamage / 100 : 1;
  return {
    damage: isCritical ? Math.max(0, Math.round(baseDamage * multiplier)) : baseDamage,
    isCritical: isCritical,
    multiplier: multiplier,
  };
}

function rollHit_(attackerStats, defenderStats) {
  var accuracy = attackerStats && attackerStats.accuracy !== undefined ? Number(attackerStats.accuracy || 0) : 100;
  var evasion = defenderStats && defenderStats.evasion !== undefined ? Number(defenderStats.evasion || 0) : 0;
  var chance = clampPercent_(accuracy - evasion);
  return {
    hit: chance >= 100 || Math.random() * 100 < chance,
    chance: chance,
  };
}

function applyGuard(battleState, efficiency) {
  normalizeBattleStateEffects_(battleState);
  var effectiveStats = calculateEffectiveStats(battleState.player.stats || BASE_PLAYER_STATS, battleState.player.effects || []);
  var defense = Number(effectiveStats.defense || 0);
  var shield = Math.max(0, Math.round((GAME_RULES.BASE_GUARD_SHIELD + defense) * Number(efficiency || 0)));
  battleState.player.shield = Number(battleState.player.shield || 0) + shield;
  battleState.lastMessage = '수비로 방어막 ' + shield + '을 만들었습니다.';
  battleState.lastPlayerAction = { type: ACTION_TYPES.GUARD, value: shield, efficiency: efficiency };
  battleState.lastTurnEvents = battleState.lastTurnEvents || [];
  battleState.lastTurnEvents.push({
    actor: 'player',
    type: ACTION_TYPES.GUARD,
    shield: shield,
    message: battleState.lastMessage,
  });
  return battleState;
}

function applyMonsterTurn(battleState) {
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  var events = battleState.lastTurnEvents || [];
  battleState.lastTurnEvents = events;
  getAliveMonsters_(battleState).forEach(function(monster) {
    if (battleState.player.hp <= 0) {
      return;
    }
    if (hasEffect_(monster, 'debuff_stun') || hasEffect_(monster, 'debuff_freeze')) {
      events.push({
        actor: 'monster',
        type: 'skip',
        monsterId: monster.instanceId || monster.monsterId,
        monsterName: monster.name,
        message: monster.name + '은 행동할 수 없습니다.',
      });
      return;
    }
    applyTimedEffectDamage_(monster, TRIGGER_TIMINGS.ON_ACTION, battleState, 'monster');
    if (Number(monster.currentHp || 0) <= 0) {
      return;
    }
    executeMonsterIntent(battleState, monster.instanceId || monster.monsterId);
    return;
    var monsterStats = calculateEffectiveStats({
      attack: monster.attack,
      defense: monster.defense,
      hp: monster.maxHp,
    }, monster.effects || []);
    var damage = Math.max(0, Math.round(Number(monsterStats.attack || 0)));
    var shieldBefore = Number(battleState.player.shield || 0);
    var shieldDamage = Math.min(shieldBefore, damage);
    var hpDamage = damage - shieldDamage;
    battleState.player.shield = Math.max(0, shieldBefore - shieldDamage);
    battleState.player.hp = Math.max(0, Number(battleState.player.hp || 0) - hpDamage);
    battleState.lastMonsterAction = {
      type: ACTION_TYPES.ATTACK,
      monsterId: monster.instanceId || monster.monsterId,
      monsterName: monster.name,
      damage: damage,
      shieldDamage: shieldDamage,
      hpDamage: hpDamage,
    };
    events.push({
      actor: 'monster',
      type: ACTION_TYPES.ATTACK,
      monsterId: monster.instanceId || monster.monsterId,
      monsterName: monster.name,
      damage: damage,
      shieldDamage: shieldDamage,
      hpDamage: hpDamage,
      message: monster.name + '의 공격!',
    });
  });
  battleState.lastTurnEvents = events;

  if (battleState.player.hp <= 0) {
    battleState.status = STATUS.BATTLE_DEFEAT;
    battleState.lastMessage += ' 몬스터의 공격으로 쓰러졌습니다.';
  } else {
    battleState.lastMessage += ' 몬스터의 턴이 끝났습니다.';
  }

  return battleState;
}

function decideMonsterIntents(battleState) {
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  var aiRows = readTableCached_(DB_SHEETS.MONSTER_AI, 600).concat(getPlayerGhostAiRows_());
  getAliveMonsters_(battleState).forEach(function(monster) {
    monster.intent = selectMonsterAction(monster, aiRows, battleState);
  });
  return battleState;
}

function selectMonsterAction(monster, aiRows, battleState) {
  var candidates = (aiRows || []).filter(function(row) {
    var conditions = safeJsonParse_(row.conditionJson, {});
    var actionType = normalizeMonsterAiActionType_(row.actionType, row.skillId);
    var aiAllowed = !row.aiId || row.aiId === monster.aiId;
    var bossAllowed = !conditions.bossOnly || monster.type === 'boss' || monster.type === 'finalBoss';
    var hpPercent = getHpPercent_(monster);
    var hpBelowAllowed = !conditions.hpBelowPercent || hpPercent < Number(conditions.hpBelowPercent);
    var hpAboveAllowed = !conditions.hpAbovePercent || hpPercent > Number(conditions.hpAbovePercent);
    var turnMin = conditions.turnMin || conditions.afterTurn;
    var turnAllowed = !turnMin || Number(battleState.turn || 1) >= Number(turnMin);
    var turnMaxAllowed = !conditions.turnMax || Number(battleState.turn || 1) <= Number(conditions.turnMax);
    var skillAllowed = isMonsterAiSkillAllowed_(monster, row, actionType);
    return aiAllowed && bossAllowed && hpBelowAllowed && hpAboveAllowed && turnAllowed && turnMaxAllowed && skillAllowed;
  });
  if (!candidates.length) {
    candidates = [{ actionType: ACTION_TYPES.ATTACK, probability: 100, skillId: '', intentIcon: 'sword', intentTextTemplate: '' }];
  }

  var row = pickWeightedAiRow_(candidates);
  var normalizedActionType = normalizeMonsterAiActionType_(row.actionType, row.skillId);
  var skill = row.skillId ? findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', row.skillId, 600) : null;
  var action = {
    actionType: normalizedActionType,
    skillId: row.skillId || '',
    skillType: skill ? skill.type || '' : '',
    skillName: skill ? skill.name || '' : '',
    intentIcon: row.intentIcon || 'sword',
    intentTextTemplate: row.intentTextTemplate || '',
  };
  action.value = calculateMonsterIntentValue_(action, monster);
  action.intentText = buildIntentText(action, monster, battleState);
  return action;
}

function normalizeMonsterAiActionType_(actionType, skillId) {
  var normalized = String(actionType || '').trim().toLowerCase();
  if (normalized === ACTION_TYPES.ATTACK || normalized === ACTION_TYPES.GUARD || normalized === ACTION_TYPES.SKILL) {
    return normalized;
  }
  if (skillId && isMonsterSkillTypeAction_(normalized)) {
    return ACTION_TYPES.SKILL;
  }
  return normalized || ACTION_TYPES.ATTACK;
}

function isMonsterSkillTypeAction_(actionType) {
  return actionType === SKILL_TYPES.DAMAGE ||
    actionType === SKILL_TYPES.SHIELD ||
    actionType === SKILL_TYPES.HEAL ||
    actionType === SKILL_TYPES.BUFF ||
    actionType === SKILL_TYPES.DEBUFF;
}

function isMonsterAiSkillAllowed_(monster, row, actionType) {
  if (actionType !== ACTION_TYPES.SKILL) {
    return true;
  }

  var skillId = String(row.skillId || '').trim();
  if (!skillId) {
    return false;
  }

  var skill = findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', skillId, 600);
  if (!skill) {
    return false;
  }

  var skillIds = getMonsterSkillIds_(monster);
  return !skillIds.length || skillIds.indexOf(skillId) !== -1;
}

function getMonsterSkillIds_(monster) {
  var value = monster && monster.skillIds || [];
  if (!Array.isArray(value)) {
    value = safeJsonParse_(value, []);
  }
  return (value || []).map(function(skillId) {
    return String(skillId || '').trim();
  }).filter(function(skillId) {
    return !!skillId;
  });
}

function buildIntentText(action, monster, battleState) {
  var monsterStats = calculateEffectiveStats({
    attack: monster.attack,
    defense: monster.defense,
    hp: monster.maxHp,
  }, monster.effects || []);
  if (!action || action.actionType === 'unknown') {
    return '행동 대기';
  }
  if (action.actionType === ACTION_TYPES.ATTACK) {
    return '다음턴 공격 (' + Math.max(0, Math.round(Number(monsterStats.attack || 0))) + ' 피해)';
  }
  if (action.actionType === ACTION_TYPES.GUARD || action.actionType === 'shield') {
    return '다음턴 방어 (방어막 ' + calculateMonsterShieldValue_(monster) + ')';
  }
  if (action.actionType === ACTION_TYPES.SKILL && action.skillId) {
    var skill = findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', action.skillId, 600);
    if (!skill) {
      return '행동 대기';
    }
    var label = skill.name || '스킬';
    if (skill.type === SKILL_TYPES.DAMAGE) {
      return '다음턴 ' + label + ' (' + Math.max(0, Math.round(Number(skill.baseValue || 0) + Number(monsterStats.attack || 0))) + ' 피해)';
    }
    if (skill.type === SKILL_TYPES.DEBUFF) {
      var effectConfig = safeJsonParse_(skill.effectJson, {});
      var effect = effectConfig.effectId ? findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effectConfig.effectId, 600) : null;
      return label + ' / ' + (effect ? effect.name : '디버프') + ' 가능';
    }
    if (skill.type === SKILL_TYPES.BUFF) {
      return label + ' / 강화 효과';
    }
    if (skill.type === SKILL_TYPES.SHIELD) {
      return '다음턴 ' + label + ' (방어막 ' + Math.max(0, Math.round(Number(skill.baseValue || 0) + Number(monsterStats.defense || 0))) + ')';
    }
    if (skill.type === SKILL_TYPES.HEAL) {
      return label + ' / 회복 ' + Math.max(0, Math.round(Number(skill.baseValue || 0)));
    }
  }
  return action.intentTextTemplate || '행동 대기';
}

function calculateMonsterIntentValue_(action, monster) {
  var monsterStats = calculateEffectiveStats({
    attack: monster.attack,
    defense: monster.defense,
    hp: monster.maxHp,
  }, monster.effects || []);
  if (!action || action.actionType === ACTION_TYPES.ATTACK) {
    return Math.max(0, Math.round(Number(monsterStats.attack || 0)));
  }
  if (action.actionType === ACTION_TYPES.GUARD || action.actionType === 'shield') {
    return calculateMonsterShieldValue_(monster);
  }
  if (action.actionType === ACTION_TYPES.SKILL && action.skillId) {
    var skill = findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', action.skillId, 600);
    if (!skill) {
      return 0;
    }
    if (skill.type === SKILL_TYPES.DAMAGE) {
      return Math.max(0, Math.round(Number(skill.baseValue || 0) + Number(monsterStats.attack || 0)));
    }
    if (skill.type === SKILL_TYPES.SHIELD) {
      return Math.max(0, Math.round(Number(skill.baseValue || 0) + Number(monsterStats.defense || 0)));
    }
    if (skill.type === SKILL_TYPES.HEAL) {
      return Math.max(0, Math.round(Number(skill.baseValue || 0)));
    }
  }
  return 0;
}

function executeMonsterIntent(battleState, monsterId) {
  var monster = (battleState.monsters || []).filter(function(candidate) {
    return (candidate.instanceId || candidate.monsterId) === monsterId || candidate.monsterId === monsterId;
  })[0];
  if (!monster || Number(monster.currentHp || 0) <= 0 || battleState.player.hp <= 0) {
    return battleState;
  }

  var intent = monster.intent || { actionType: ACTION_TYPES.ATTACK };
  if (intent.actionType === ACTION_TYPES.GUARD || intent.actionType === 'shield') {
    return applyMonsterGuardIntent_(battleState, monster, intent);
  }
  if (intent.actionType === ACTION_TYPES.SKILL && intent.skillId) {
    return applyMonsterSkillIntent_(battleState, monster, intent);
  }
  return applyMonsterAttackIntent_(battleState, monster, intent);
}

function applyMonsterAttackIntent_(battleState, monster, intent) {
  var monsterStats = calculateEffectiveStats({
    attack: monster.attack,
    defense: monster.defense,
    hp: monster.maxHp,
    evasion: monster.evasion,
    accuracy: 100,
  }, monster.effects || []);
  var playerStats = calculateEffectiveStats(battleState.player.stats || BASE_PLAYER_STATS, battleState.player.effects || []);
  var hit = rollHit_(monsterStats, playerStats);
  if (!hit.hit) {
    battleState.lastMonsterAction = {
      type: ACTION_TYPES.ATTACK,
      monsterId: monster.instanceId || monster.monsterId,
      monsterName: monster.name,
      damage: 0,
      missed: true,
      hitChance: hit.chance,
    };
    battleState.lastTurnEvents.push({
      actor: 'monster',
      type: ACTION_TYPES.ATTACK,
      monsterId: monster.instanceId || monster.monsterId,
      monsterName: monster.name,
      damage: 0,
      missed: true,
      hitChance: hit.chance,
      message: monster.name + '의 공격이 빗나갔습니다.',
    });
    monster.intent = null;
    return battleState;
  }
  var result = dealDamageToPlayer_(battleState, Math.max(0, Math.round(Number(monsterStats.attack || 0))));
  battleState.lastMonsterAction = {
    type: ACTION_TYPES.ATTACK,
    monsterId: monster.instanceId || monster.monsterId,
    monsterName: monster.name,
    damage: result.damage,
    shieldDamage: result.shieldDamage,
    hpDamage: result.hpDamage,
  };
  battleState.lastTurnEvents.push({
    actor: 'monster',
    type: ACTION_TYPES.ATTACK,
    monsterId: monster.instanceId || monster.monsterId,
    monsterName: monster.name,
    damage: result.damage,
    shieldDamage: result.shieldDamage,
    hpDamage: result.hpDamage,
    message: monster.name + '의 공격!',
  });
  monster.intent = null;
  return battleState;
}

function applyMonsterGuardIntent_(battleState, monster, intent) {
  var shield = calculateMonsterShieldValue_(monster);
  monster.shield = Number(monster.shield || 0) + shield;
  battleState.lastTurnEvents.push({
    actor: 'monster',
    type: ACTION_TYPES.GUARD,
    monsterId: monster.instanceId || monster.monsterId,
    monsterName: monster.name,
    shield: shield,
    damage: 0,
    message: monster.name + '이 방어 자세를 취했습니다.',
  });
  monster.intent = null;
  return battleState;
}

function applyMonsterSkillIntent_(battleState, monster, intent) {
  var skill = findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', intent.skillId, 600);
  if (!skill) {
    return applyMonsterAttackIntent_(battleState, monster, intent);
  }
  var monsterStats = calculateEffectiveStats({
    attack: monster.attack,
    defense: monster.defense,
    hp: monster.maxHp,
    evasion: monster.evasion,
    accuracy: 100,
  }, monster.effects || []);
  if (skill.type === SKILL_TYPES.DAMAGE) {
    var playerStats = calculateEffectiveStats(battleState.player.stats || BASE_PLAYER_STATS, battleState.player.effects || []);
    var hit = rollHit_(monsterStats, playerStats);
    if (!hit.hit) {
      battleState.lastTurnEvents.push({
        actor: 'monster',
        type: ACTION_TYPES.SKILL,
        skillId: skill.skillId,
        monsterId: monster.instanceId || monster.monsterId,
        monsterName: monster.name,
        damage: 0,
        missed: true,
        hitChance: hit.chance,
        message: monster.name + '의 ' + skill.name + '이 빗나갔습니다.',
      });
      monster.intent = null;
      return battleState;
    }
    var result = dealDamageToPlayer_(battleState, Math.max(0, Math.round(Number(skill.baseValue || 0) + Number(monsterStats.attack || 0))));
    battleState.lastTurnEvents.push({
      actor: 'monster',
      type: ACTION_TYPES.SKILL,
      skillId: skill.skillId,
      monsterId: monster.instanceId || monster.monsterId,
      monsterName: monster.name,
      damage: result.damage,
      shieldDamage: result.shieldDamage,
      hpDamage: result.hpDamage,
      message: monster.name + '이 ' + skill.name + ' 사용!',
    });
  } else if (skill.type === SKILL_TYPES.DEBUFF) {
    applyMonsterSkillEffect_(battleState.player, skill, 'player', battleState);
    normalizeBattleStateEffects_(battleState);
    battleState.lastTurnEvents.push({ actor: 'monster', type: 'debuff', skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, damage: 0, message: monster.name + '이 ' + skill.name + ' 사용!' });
  } else if (skill.type === SKILL_TYPES.BUFF) {
    applyMonsterSkillEffect_(monster, skill, 'monster', battleState);
    normalizeBattleStateEffects_(battleState);
    syncPrimaryMonster_(battleState);
    battleState.lastTurnEvents.push({ actor: 'monster', type: 'buff', skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, damage: 0, message: monster.name + '이 ' + skill.name + ' 사용!' });
  } else if (skill.type === SKILL_TYPES.SHIELD) {
    var shield = Math.max(0, Math.round(Number(skill.baseValue || 0) + Number(monsterStats.defense || 0)));
    monster.shield = Number(monster.shield || 0) + shield;
    applyMonsterSkillEffect_(monster, skill, 'monster', battleState);
    normalizeBattleStateEffects_(battleState);
    syncPrimaryMonster_(battleState);
    battleState.lastTurnEvents.push({ actor: 'monster', type: ACTION_TYPES.GUARD, skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, shield: shield, damage: 0, message: monster.name + '이 ' + skill.name + ' 사용!' });
  } else if (skill.type === SKILL_TYPES.HEAL) {
    var heal = Math.max(0, Math.round(Number(skill.baseValue || 0)));
    monster.currentHp = Math.min(Number(monster.maxHp || 1), Number(monster.currentHp || 0) + heal);
    battleState.lastTurnEvents.push({ actor: 'monster', type: 'heal', skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, heal: heal, damage: 0, message: monster.name + '이 ' + skill.name + ' 사용!' });
  }
  normalizeBattleStateEffects_(battleState);
  syncPrimaryMonster_(battleState);
  monster.intent = null;
  return battleState;
}

function applyMonsterSkillEffect_(target, skill, source, battleState) {
  var config = safeJsonParse_(skill.effectJson, {});
  applyActionPointEffectConfig_(target, config);
  if (!config.effectId || Math.random() * 100 > Number(config.chance || 100)) {
    return null;
  }
  var effect = findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', config.effectId, 600);
  if (!effect) {
    return null;
  }
  var configured = Object.assign({}, effect);
  if (config.value !== undefined) {
    configured.value = Number(config.value || 0);
  } else if (configured.effectType === EFFECT_TYPES.FLAT) {
    configured.value = Number(configured.value || 0) + getSkillUpgradeValue(skill, configured.category === EFFECT_CATEGORIES.BUFF ? 'buffValue' : 'effect');
  }
  if (config.durationType) {
    configured.durationType = config.durationType;
  }
  if (config.durationTurns !== undefined) {
    configured.durationTurns = config.durationTurns;
  }
  if (config.stackable !== undefined) {
    configured.stackable = config.stackable;
  }
  if (config.maxStacks !== undefined) {
    configured.maxStacks = Number(config.maxStacks || 1);
  }
  return applyEffect(target, configured, { source: source, skillId: skill.skillId, turn: battleState && battleState.turn });
}

function dealDamageToPlayer_(battleState, damage) {
  var effectiveStats = calculateEffectiveStats(battleState.player.stats || BASE_PLAYER_STATS, battleState.player.effects || []);
  var modifiedDamage = applyIncomingItemDamageModifiers_(battleState, damage);
  var totalDamage = Math.max(0, Math.round(Number(modifiedDamage || 0) - Number(effectiveStats.defense || 0)));
  var shieldBefore = Number(battleState.player.shield || 0);
  var shieldDamage = Math.min(shieldBefore, totalDamage);
  var hpDamage = totalDamage - shieldDamage;
  battleState.player.shield = Math.max(0, shieldBefore - shieldDamage);
  battleState.player.hp = Math.max(0, Number(battleState.player.hp || 0) - hpDamage);
  if (shieldDamage > 0) {
    processSkillTriggers_(battleState, 'onBlock', { damage: totalDamage, shieldDamage: shieldDamage, hpDamage: hpDamage });
  }
  if (hpDamage > 0) {
    processSkillTriggers_(battleState, 'onDamaged', { damage: totalDamage, shieldDamage: shieldDamage, hpDamage: hpDamage });
  }
  return { damage: totalDamage, shieldDamage: shieldDamage, hpDamage: hpDamage };
}

function dealDamageToMonster_(battleState, monster, damage) {
  var monsterStats = calculateEffectiveStats({
    attack: monster.attack,
    defense: monster.defense,
    hp: monster.maxHp,
    evasion: monster.evasion,
    accuracy: 100,
  }, monster.effects || []);
  var totalDamage = Math.max(0, Math.round(Number(damage || 0) - Number(monsterStats.defense || 0)));
  var shieldBefore = Number(monster.shield || 0);
  var hpBefore = Number(monster.currentHp || 0);
  var shieldDamage = Math.min(shieldBefore, totalDamage);
  var hpDamage = totalDamage - shieldDamage;
  monster.shield = Math.max(0, shieldBefore - shieldDamage);
  monster.currentHp = Math.max(0, hpBefore - hpDamage);
  var killScore = recordMonsterScoreContribution_(battleState, monster, hpBefore, monster.currentHp, totalDamage);
  syncPrimaryMonster_(battleState);
  return { damage: totalDamage, shieldDamage: shieldDamage, hpDamage: hpDamage, killScore: killScore };
}

function setActiveMonsterScoreContext_(battleState, questionId, efficiency) {
  if (!battleState) return;
  battleState.activeMonsterScoreContext = {
    questionId: String(questionId || '').trim(),
    efficiency: Math.max(0, Number(efficiency || 0)),
  };
}

function clearActiveMonsterScoreContext_(battleState) {
  if (battleState && battleState.activeMonsterScoreContext) {
    delete battleState.activeMonsterScoreContext;
  }
}

function recordMonsterScoreContribution_(battleState, monster, hpBefore, hpAfter, damageAmount) {
  if (!battleState || !monster) return 0;
  var monsterKey = String(monster.instanceId || monster.monsterId || '').trim();
  if (!monsterKey) return 0;
  var state = ensureMonsterScoreState_(battleState);
  var entry = state.byMonsterId[monsterKey] || {
    monsterId: monsterKey,
    monsterName: monster.name || '',
    efficiencyByQuestion: {},
    efficiencyTotal: 0,
    questionCount: 0,
    scoreAwarded: 0,
  };
  var context = battleState.activeMonsterScoreContext || {};
  var questionKey = String(context.questionId || '').trim();
  var efficiency = Math.max(0, Number(context.efficiency || 0));
  if (Number(damageAmount || 0) > 0 && questionKey && efficiency > 0 && entry.efficiencyByQuestion[questionKey] === undefined) {
    entry.efficiencyByQuestion[questionKey] = efficiency;
    entry.efficiencyTotal = Number(entry.efficiencyTotal || 0) + efficiency;
    entry.questionCount = Number(entry.questionCount || 0) + 1;
  }
  var killScore = 0;
  if (Number(hpBefore || 0) > 0 && Number(hpAfter || 0) <= 0 && !entry.scoreAwarded) {
    var averageEfficiency = entry.questionCount > 0 ? Number(entry.efficiencyTotal || 0) / Number(entry.questionCount || 1) : 0;
    killScore = calculateMonsterKillScore_(battleState.stage, averageEfficiency);
    if (killScore > 0 && battleState.runId) {
      awardRunScore_(battleState.runId, killScore);
      state.scoreAwardedToRun = Number(state.scoreAwardedToRun || 0) + killScore;
    }
    entry.averageEfficiency = roundTo_(averageEfficiency, 3);
    entry.scoreAwarded = killScore;
    state.monsterScore = Number(state.monsterScore || 0) + killScore;
  }
  state.byMonsterId[monsterKey] = entry;
  battleState.monsterScoreState = state;
  return killScore;
}

function ensureMonsterScoreState_(battleState) {
  var state = battleState.monsterScoreState || {};
  if (state.battleId !== battleState.battleId) {
    state = { battleId: battleState.battleId || '', monsterScore: 0, byMonsterId: {}, scoreAwardedToRun: 0 };
  }
  state.byMonsterId = state.byMonsterId || {};
  state.monsterScore = Number(state.monsterScore || 0);
  state.scoreAwardedToRun = Number(state.scoreAwardedToRun || 0);
  battleState.monsterScoreState = state;
  return state;
}

function calculateMonsterKillScore_(stage, averageEfficiency) {
  var stageIndex = getGlobalStageIndexForScore_(stage);
  var baseScore = 100 + (10 * stageIndex);
  return Math.max(0, Math.round(baseScore * Math.max(0, Number(averageEfficiency || 0))));
}

function getGlobalStageIndexForScore_(stage) {
  var floor = Math.max(1, Math.min(Number(GAME_RULES.FLOOR_COUNT || 5), Number(stage && stage.floor || 1)));
  var stageNumber = Math.max(1, Math.min(Number(GAME_RULES.STAGES_PER_FLOOR || 5), Number(stage && stage.stage || 1)));
  return ((floor - 1) * Number(GAME_RULES.STAGES_PER_FLOOR || 5)) + stageNumber;
}

function clearPlayerTurnShield_(battleState) {
  if (!battleState || !battleState.player) {
    return battleState;
  }
  battleState.player.shield = 0;
  return battleState;
}

function clearMonsterTurnShields_(battleState) {
  normalizeBattleMonsters_(battleState);
  (battleState.monsters || []).forEach(function(monster) {
    monster.shield = 0;
  });
  syncPrimaryMonster_(battleState);
  return battleState;
}

function calculateMonsterShieldValue_(monster) {
  var stats = calculateEffectiveStats({
    attack: monster.attack,
    defense: monster.defense,
    hp: monster.maxHp,
  }, monster.effects || []);
  return Math.max(0, Math.round(GAME_RULES.BASE_GUARD_SHIELD + Number(stats.defense || 0)));
}

function pickWeightedAiRow_(rows) {
  var total = rows.reduce(function(sum, row) {
    return sum + Math.max(0, Number(row.probability || 0));
  }, 0);
  if (total <= 0) {
    return pickRandom_(rows);
  }
  var cursor = Math.random() * total;
  for (var i = 0; i < rows.length; i += 1) {
    cursor -= Math.max(0, Number(rows[i].probability || 0));
    if (cursor <= 0) {
      return rows[i];
    }
  }
  return rows[rows.length - 1];
}

function getStageQuestionDifficultyBonus_(stage) {
  return getStageDifficultyBonusNumber_(stage && stage.questionDifficultyBonus, 0);
}

function applyStageQuestionDifficultyBonus_(stage, questionDifficulty) {
  return Number(questionDifficulty || GAME_RULES.MIN_DIFFICULTY) + getStageQuestionDifficultyBonus_(stage);
}

function saveRunState(runId, battleState) {
  var run = requireRun_(runId);
  var stageState = getStageState_(run);
  battleState.runId = battleState.runId || runId;
  stageState.battle = battleState;
  return saveStageState_(runId, stageState, battleState);
}

function commitStageResult(stagePayload, authToken) {
  ensureTableColumns_(DB_SHEETS.RUNS, DB_COLUMNS.RUNS);
  ensureTableColumns_(DB_SHEETS.ANSWER_LOGS, DB_COLUMNS.ANSWER_LOGS);
  var payload = stagePayload || {};
  var player = getCurrentPlayer_(authToken);
  var run = requireRun_(payload.runId);
  if (run.playerId !== player.playerId) {
    throw new Error('현재 플레이어의 런이 아닙니다.');
  }
  if (run.status !== STATUS.RUN_ACTIVE) {
    throw new Error('진행 중인 런만 저장할 수 있습니다.');
  }

  var battleState = payload.battle || {};
  battleState.runId = battleState.runId || run.runId;
  if (battleState.status !== STATUS.BATTLE_VICTORY && battleState.status !== STATUS.BATTLE_DEFEAT) {
    throw new Error('종료된 전투 결과만 저장할 수 있습니다.');
  }

  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  var queuedServerAnswerLogs = (battleState.pendingAnswerLogs || []).slice();
  battleState.pendingAction = null;
  battleState.pendingAnswerLogs = [];

  var stageState = getStageState_(run);
  var serverBattleState = stageState.battle || {};
  var clientStageState = payload.stageState || {};
  mergeMonsterScoreStateForCommit_(battleState, serverBattleState, stageState.scoreState || {});
  mergeQuestionReactionScoreStateForCommit_(battleState, serverBattleState, stageState.scoreState || {});
  normalizeUsedQuestionIds_(stageState, battleState);
  stageState.usedQuestionIds = mergeUsedQuestionIds_(stageState.usedQuestionIds, clientStageState.usedQuestionIds);
  normalizeUsedQuestionIds_(stageState, battleState);
  stageState.otherStudentQuestionShown = !!(stageState.otherStudentQuestionShown || clientStageState.otherStudentQuestionShown);
  stageState.fallbackEvents = mergeStageFallbackEvents_(stageState.fallbackEvents, clientStageState.fallbackEvents);
  stageState.playerGhost = stageState.playerGhost || clientStageState.playerGhost || battleState.playerGhost || null;
  if (clientStageState.reward && clientStageState.reward.choices && clientStageState.reward.choices.length) {
    stageState.reward = clientStageState.reward;
  }
  stageState.battle = battleState;
  stageState.scoreState = stageState.scoreState || {};
  awardCommittedMonsterScoreIfNeeded_(run, stageState, battleState);

  var battleIdForScore = String(battleState.battleId || '');
  var answerScoreAlreadyAwarded = !!(battleIdForScore && stageState.scoreState.answerScoreBattleId === battleIdForScore);
  var answerScoreDelta = 0;
  if (battleIdForScore) {
    stageState.scoreState.battleClearedAtByBattleId = stageState.scoreState.battleClearedAtByBattleId || {};
    if (!stageState.scoreState.battleClearedAtByBattleId[battleIdForScore]) {
      stageState.scoreState.battleClearedAtByBattleId[battleIdForScore] = new Date().toISOString();
    }
  }

  queuedServerAnswerLogs.forEach(function(answerPayload) {
    if (!answerScoreAlreadyAwarded) {
      answerPayload.scoreDelta = 0;
      answerScoreDelta += Number(answerPayload.scoreDelta || 0);
    } else {
      answerPayload.scoreDelta = 0;
    }
    queueBattleAnswerLog_(battleState, answerPayload);
    markQuestionUsedForRun_(stageState, battleState, answerPayload.questionId);
  });

  (Array.isArray(payload.answerLogs) ? payload.answerLogs : []).forEach(function(answerPayload) {
    var question = findCachedRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', answerPayload.questionId, 120);
    if (!question) {
      throw new Error('문제를 찾을 수 없습니다: ' + answerPayload.questionId);
    }
    var elapsedMs = Math.max(0, Number(answerPayload.elapsedMs || 0));
    var maxMs = Math.max(1, Number(answerPayload.maxTimeMs || answerPayload.maxMs || 1));
    var isCorrect = isCorrectAnswer_(question, answerPayload.selectedAnswer, answerPayload.selectedChoiceIndex, answerPayload.selectedAnswerText);
    var efficiency = calculateEfficiency(isCorrect, Math.max(0, maxMs - elapsedMs), maxMs, Number(answerPayload.wrongCountAfterTimeout || 0), getItemQuestionModifiers_(battleState, question), question);
    var scoreDelta = 0;
    answerScoreDelta += scoreDelta;
    queueBattleAnswerLog_(battleState, {
      questionId: question.questionId,
      playerId: player.playerId,
      creatorId: question.creatorId,
      runId: run.runId,
      battleId: battleState.battleId || answerPayload.battleId || '',
      floor: battleState.stage ? battleState.stage.floor : answerPayload.floor,
      stage: battleState.stage ? battleState.stage.stage : answerPayload.stage,
      actionType: answerPayload.actionType,
      selectedAnswer: answerPayload.selectedAnswerText || answerPayload.selectedAnswer || '',
      isCorrect: isCorrect,
      elapsedMs: elapsedMs,
      maxTimeMs: maxMs,
      efficiency: efficiency,
      finalDifficulty: answerPayload.finalDifficulty,
      isOtherPlayerQuestion: answerPayload.isOtherPlayerQuestion,
      scoreDelta: scoreDelta,
    });
    markQuestionUsedForRun_(stageState, battleState, question.questionId);
  });

  if (!answerScoreAlreadyAwarded) {
    stageState.scoreState.answerScoreBattleId = battleIdForScore;
    stageState.scoreState.answerScore = answerScoreDelta;
    stageState.scoreState.answerScoreAwardedAt = new Date().toISOString();
  }
  flushQueuedBattleAnswerLogs_(battleState);

  if (battleState.status === STATUS.BATTLE_VICTORY) {
    logBattleEvent_(run, STATUS.BATTLE_VICTORY, { battleId: battleState.battleId });
  }

  var updatedRun = saveStageState_(run.runId, stageState, battleState);
  return buildBattleView_(updatedRun, getStageState_(updatedRun));
}

function mergeMonsterScoreStateForCommit_(clientBattleState, serverBattleState, scoreState) {
  clientBattleState = clientBattleState || {};
  serverBattleState = serverBattleState || {};
  scoreState = scoreState || {};
  var battleId = String(clientBattleState.battleId || serverBattleState.battleId || '');
  var clientState = normalizeMonsterScoreStateForMerge_(clientBattleState.monsterScoreState, battleId);
  var serverState = normalizeMonsterScoreStateForMerge_(serverBattleState.monsterScoreState, battleId);
  var storedState = normalizeMonsterScoreStateForMerge_({
    battleId: scoreState.monsterScoreBattleId || battleId,
    monsterScore: scoreState.monsterScore || 0,
    byMonsterId: scoreState.monsterScoreDetails || {},
    scoreAwardedToRun: scoreState.monsterScoreAwardedToRun || 0,
  }, battleId);
  var bestState = [clientState, serverState, storedState].reduce(function(best, candidate) {
    if (!candidate) return best;
    if (!best || Number(candidate.monsterScore || 0) > Number(best.monsterScore || 0)) {
      return candidate;
    }
    return best;
  }, null);
  if (bestState && Number(bestState.monsterScore || 0) > 0) {
    clientBattleState.monsterScoreState = bestState;
  }
  return clientBattleState.monsterScoreState || null;
}

function normalizeMonsterScoreStateForMerge_(state, battleId) {
  if (!state) return null;
  var stateBattleId = String(state.battleId || battleId || '');
  if (battleId && stateBattleId && stateBattleId !== battleId) {
    return null;
  }
  return {
    battleId: stateBattleId || battleId || '',
    monsterScore: Number(state.monsterScore || 0),
    byMonsterId: state.byMonsterId || state.monsterScoreDetails || {},
    scoreAwardedToRun: Number(state.scoreAwardedToRun || state.monsterScoreAwardedToRun || 0),
  };
}

function awardCommittedMonsterScoreIfNeeded_(run, stageState, battleState) {
  if (!run || !battleState || !battleState.monsterScoreState) {
    return;
  }
  var battleId = String(battleState.battleId || battleState.monsterScoreState.battleId || '');
  if (!battleId || typeof awardRunScore_ !== 'function') {
    return;
  }
  stageState.scoreState = stageState.scoreState || {};
  var scoreState = stageState.scoreState;
  var totalMonsterScore = Number(battleState.monsterScoreState.monsterScore || 0);
  var storedAwarded = scoreState.monsterScoreAwardedBattleId === battleId
    ? Number(scoreState.monsterScoreAwardedToRun || 0)
    : 0;
  var stateAwarded = Number(battleState.monsterScoreState.scoreAwardedToRun || 0);
  var alreadyAwarded = Math.max(storedAwarded, stateAwarded);
  var pendingScore = Math.max(0, totalMonsterScore - alreadyAwarded);
  if (pendingScore > 0) {
    awardRunScore_(run.runId, pendingScore);
    alreadyAwarded += pendingScore;
  }
  battleState.monsterScoreState.scoreAwardedToRun = alreadyAwarded;
  scoreState.monsterScoreAwardedBattleId = battleId;
  scoreState.monsterScoreAwardedToRun = alreadyAwarded;
}

function mergeQuestionReactionScoreStateForCommit_(clientBattleState, serverBattleState, scoreState) {
  clientBattleState = clientBattleState || {};
  serverBattleState = serverBattleState || {};
  scoreState = scoreState || {};
  var battleId = String(clientBattleState.battleId || serverBattleState.battleId || '');
  var clientState = normalizeQuestionReactionScoreStateForMerge_(clientBattleState.questionReactionScoreState, battleId);
  var serverState = normalizeQuestionReactionScoreStateForMerge_(serverBattleState.questionReactionScoreState, battleId);
  var storedState = normalizeQuestionReactionScoreStateForMerge_({
    battleId: scoreState.questionReactionScoreBattleId || battleId,
    score: scoreState.questionReactionScore || 0,
  }, battleId);
  var bestState = [clientState, serverState, storedState].reduce(function(best, candidate) {
    if (!candidate) return best;
    if (!best || Number(candidate.score || 0) > Number(best.score || 0)) {
      return candidate;
    }
    return best;
  }, null);
  if (bestState && Number(bestState.score || 0) > 0) {
    clientBattleState.questionReactionScoreState = bestState;
  }
  return clientBattleState.questionReactionScoreState || null;
}

function normalizeQuestionReactionScoreStateForMerge_(state, battleId) {
  if (!state) return null;
  var stateBattleId = String(state.battleId || battleId || '');
  if (battleId && stateBattleId && stateBattleId !== battleId) {
    return null;
  }
  return {
    battleId: stateBattleId || battleId || '',
    score: Number(state.score || state.questionReactionScore || 0),
  };
}

function mergeStageFallbackEvents_(serverEvents, clientEvents) {
  var merged = [];
  var seen = {};
  (serverEvents || []).concat(clientEvents || []).forEach(function(event) {
    if (!event) {
      return;
    }
    var key = [
      event.battleId || '',
      event.actionType || '',
      event.skillId || '',
      event.reason || '',
      event.questionId || '',
      event.createdAt || '',
    ].join('|');
    if (seen[key]) {
      return;
    }
    seen[key] = true;
    merged.push(event);
  });
  return merged;
}

var BATTLE_RUN_CACHE_TTL_SECONDS_ = 21600;

function getRunCacheKey_(runId) {
  return 'runState:' + String(runId || '').trim();
}

function getCachedRun_(runId) {
  var key = getRunCacheKey_(runId);
  if (!key) {
    return null;
  }
  try {
    return safeJsonParse_(CacheService.getScriptCache().get(key), null);
  } catch (error) {
    return null;
  }
}

function cacheRun_(run) {
  if (!run || !run.runId) {
    return run;
  }
  var key = getRunCacheKey_(run.runId);
  try {
    if (run.status === STATUS.RUN_ACTIVE) {
      CacheService.getScriptCache().put(key, safeJsonStringify_(run), BATTLE_RUN_CACHE_TTL_SECONDS_);
    } else {
      CacheService.getScriptCache().remove(key);
    }
  } catch (error) {
    // Cache is an optimization only; sheet writes remain the source of truth.
  }
  return run;
}

function patchCachedRun_(runId, patch) {
  var run = requireRun_(runId);
  return cacheRun_(Object.assign({}, run, patch || {}));
}

function queueBattleAnswerLog_(battleState, answerPayload) {
  battleState.pendingAnswerLogs = battleState.pendingAnswerLogs || [];
  battleState.pendingAnswerLogs.push(Object.assign({}, answerPayload || {}));
  return battleState.pendingAnswerLogs;
}

function flushQueuedBattleAnswerLogs_(battleState) {
  ensureTableColumns_(DB_SHEETS.ANSWER_LOGS, DB_COLUMNS.ANSWER_LOGS);
  var queuedLogs = (battleState.pendingAnswerLogs || []).slice();
  battleState.pendingAnswerLogs = [];
  var scoreByRunId = {};
  queuedLogs.forEach(function(answerPayload) {
    if (!answerPayload) {
      return;
    }
    answerPayload.scoreDelta = 0;
    if (answerPayload.runId) {
      scoreByRunId[answerPayload.runId] = Number(scoreByRunId[answerPayload.runId] || 0) + Number(answerPayload.scoreDelta || 0);
    }
  });
  var answerLogs = queuedLogs.map(function(answerPayload) {
    return buildAnswerLog_(answerPayload);
  });
  if (answerLogs.length) {
    appendRowObjects_(DB_SHEETS.ANSWER_LOGS, answerLogs);
  }
  Object.keys(scoreByRunId).forEach(function(runId) {
    if (Number(scoreByRunId[runId] || 0) > 0) {
      awardRunScore_(runId, scoreByRunId[runId]);
    }
  });
  queuedLogs.forEach(function(answerPayload) {
    updatePlayerAnswerCache_(answerPayload);
    if (answerPayload.questionId) {
      updateQuestionStats(answerPayload.questionId, answerPayload.isCorrect);
    }
  });
  return queuedLogs.length;
}

function logAnswer(answerPayload) {
  ensureTableColumns_(DB_SHEETS.ANSWER_LOGS, DB_COLUMNS.ANSWER_LOGS);
  var payload = answerPayload || {};
  var answerLog = buildAnswerLog_(payload);
  appendRowObject_(DB_SHEETS.ANSWER_LOGS, answerLog);
  updatePlayerAnswerCache_(payload);
  return answerLog;
}

function buildAnswerLog_(answerPayload) {
  var payload = answerPayload || {};
  return {
    answerLogId: generateId_('answerLog'),
    questionId: payload.questionId,
    playerId: payload.playerId,
    creatorId: payload.creatorId,
    runId: payload.runId,
    battleId: payload.battleId,
    floor: payload.floor,
    stage: payload.stage,
    actionType: payload.actionType,
    selectedAnswer: payload.selectedAnswer,
    isCorrect: !!payload.isCorrect,
    elapsedMs: payload.elapsedMs,
    maxTimeMs: payload.maxTimeMs,
    efficiency: payload.efficiency,
    finalDifficulty: payload.finalDifficulty,
    isOtherPlayerQuestion: !!payload.isOtherPlayerQuestion,
    scoreDelta: Number(payload.scoreDelta || 0),
    createdAt: new Date(),
  };
}

function calculateAnswerScore_(answerPayload) {
  return 0;
}

function awardRunScore_(runId, scoreDelta) {
  ensureTableColumns_(DB_SHEETS.RUNS, DB_COLUMNS.RUNS);
  var delta = Math.max(0, Math.round(Number(scoreDelta || 0)));
  var run = requireRun_(runId);
  if (delta <= 0) {
    return {
      run: run,
      previousScore: Number(run.score || 0),
      scoreDelta: 0,
      totalScore: Number(run.score || 0),
    };
  }
  var previousScore = Number(run.score || 0);
  var updated = updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
    score: previousScore + delta,
    updatedAt: new Date(),
  });
  return {
    run: updated,
    previousScore: previousScore,
    scoreDelta: delta,
    totalScore: Number(updated && updated.score || previousScore + delta),
  };
}

function updateQuestionStats(questionId, isCorrect) {
  var question = findRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', questionId);
  if (!question) {
    return null;
  }

  var updated = updateRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', questionId, {
    correctCount: Number(question.correctCount || 0) + (isCorrect ? 1 : 0),
    totalCount: Number(question.totalCount || 0) + 1,
    updatedAt: new Date(),
  });
  clearTableCache_(DB_SHEETS.QUESTIONS);
  return updated;
}

function buildBattleView_(run, stageState) {
  var battleState = stageState.battle;
  if (battleState) {
    syncBattlePlayerItemsFromRun_(battleState, run);
    normalizeBattleStateEffects_(battleState);
    normalizeBattleMonsters_(battleState);
    normalizePlayerActionPoints_(battleState, false);
    if (battleState.legacyMonsterMigrated) {
      delete battleState.legacyMonsterMigrated;
      stageState.battle = battleState;
      saveStageState_(run.runId, stageState, battleState);
    }
  }
  var runState = buildRunState_(run);
  return toClientObject_({
    runId: run.runId,
    playerId: run.playerId,
    currency: Number(run.currency || 0),
    score: Number(run.score || 0),
    battle: battleState,
    clientConfig: getBattleClientConfig_(),
    availableSkills: battleState ? getAvailableSkills(runState, battleState) : [],
    monsterAiRules: battleState ? buildClientMonsterAiRules_(battleState) : [],
    questionCache: battleState ? buildBattleQuestionCache_(run, stageState, battleState) : [],
    stageState: {
      otherStudentQuestionShown: !!stageState.otherStudentQuestionShown,
      fallbackEvents: stageState.fallbackEvents || [],
      usedQuestionIds: stageState.usedQuestionIds || [],
      usedQuestionStageId: stageState.usedQuestionStageId || '',
      reward: stageState.reward || null,
      playerGhost: stageState.playerGhost || null,
    },
  });
}

function getBattleClientConfig_() {
  var settings = {};
  try {
    settings = getAppSettings();
  } catch (error) {
    settings = {};
  }
  return {
    questionResultHoldMs: clampClientDelay_(settings.questionResultHoldMs, 900, 0, 5000),
    questionActionStartDelayMs: clampClientDelay_(settings.questionActionStartDelayMs, 0, 0, 2000),
    firstStageIntroLines: getFirstStageIntroLines_(settings),
    minAnswerEfficiency: getClientNumberSetting_(settings.minAnswerEfficiency, GAME_RULES.MIN_ANSWER_EFFICIENCY),
    maxAnswerEfficiency: getClientNumberSetting_(settings.maxAnswerEfficiency, GAME_RULES.MAX_ANSWER_EFFICIENCY),
    extraWrongEfficiencyPenalty: getClientNumberSetting_(settings.extraWrongEfficiencyPenalty, GAME_RULES.EXTRA_WRONG_EFFICIENCY_PENALTY),
  };
}

function getClientNumberSetting_(value, fallback) {
  var number = Number(value);
  if (!isFinite(number)) {
    return Number(fallback || 0);
  }
  return number;
}

function getFirstStageIntroLines_(settings) {
  var configured = settings && settings.firstStageIntroLinesJson;
  var normalized = normalizeNarrationLines_(configured);
  if (normalized.length) {
    return normalized;
  }
  return [
    { text: '눈을 떠보니 학교 옥상이다 .', sparkleDot: true },
    { text: '일단 여기서 나가야겠다.' },
    { text: '눈앞에 무언가 나타났다!' },
  ];
}

function normalizeNarrationLines_(value) {
  var rawLines = value;
  if (typeof rawLines === 'string') {
    rawLines = safeJsonParse_(rawLines, null) || rawLines.split(/\r?\n/);
  }
  if (!Array.isArray(rawLines)) {
    return [];
  }
  return rawLines.map(function(line) {
    if (typeof line === 'string') {
      return { text: String(line || '').trim(), sparkleDot: false };
    }
    if (!line || typeof line !== 'object') {
      return null;
    }
    return {
      text: String(line.text || '').trim(),
      sparkleDot: !!line.sparkleDot,
    };
  }).filter(function(line) {
    return line && line.text;
  });
}

function buildClientMonsterAiRules_(battleState) {
  var aiIds = {};
  (battleState.monsters || []).forEach(function(monster) {
    if (monster && monster.aiId) {
      aiIds[monster.aiId] = true;
    }
  });
  return readTableCached_(DB_SHEETS.MONSTER_AI, 600).concat(getPlayerGhostAiRows_()).filter(function(row) {
    return !row.aiId || aiIds[row.aiId];
  }).map(function(row) {
    var skill = row.skillId ? findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', row.skillId, 600) : null;
    var effectConfig = skill ? safeJsonParse_(skill.effectJson, {}) : {};
    var effect = effectConfig.effectId ? findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effectConfig.effectId, 600) : null;
    return {
      aiId: row.aiId || '',
      actionType: normalizeMonsterAiActionType_(row.actionType, row.skillId),
      conditionJson: row.conditionJson || '{}',
      probability: Number(row.probability || 0),
      skillId: row.skillId || '',
      skillType: skill ? skill.type || '' : '',
      skillName: skill ? skill.name || '' : '',
      skillBaseValue: skill ? Number(skill.baseValue || 0) : 0,
      skillEffectChance: effectConfig.chance !== undefined ? Number(effectConfig.chance || 0) : 100,
      skillEffect: effect ? {
        effectId: effect.effectId || '',
        name: effect.name || '',
        category: effect.category || '',
        statKey: effect.statKey || '',
        effectType: effect.effectType || '',
        value: Number(effect.value || 0),
        durationType: effect.durationType || '',
        durationTurns: effect.durationTurns,
        stackable: effect.stackable === true || String(effect.stackable || '').toLowerCase() === 'true',
        maxStacks: Number(effect.maxStacks || 1),
        triggerTiming: effect.triggerTiming || '',
        description: effect.description || '',
      } : null,
      intentIcon: row.intentIcon || 'sword',
      intentTextTemplate: row.intentTextTemplate || '',
    };
  });
}

function clampClientDelay_(value, fallback, min, max) {
  var number = Number(value);
  if (!isFinite(number)) {
    number = Number(fallback || 0);
  }
  return Math.max(Number(min || 0), Math.min(Number(max || number), Math.round(number)));
}

function buildQuestionView_(question, pendingAction, playerId) {
  return toClientObject_({
    actionType: pendingAction ? pendingAction.actionType : '',
    skillId: pendingAction ? pendingAction.skillId || '' : '',
    targetId: pendingAction ? pendingAction.targetId || '' : '',
    actionPointCost: pendingAction ? Number(pendingAction.actionPointCost !== undefined && pendingAction.actionPointCost !== '' ? pendingAction.actionPointCost : getActionPointCostForAction_(pendingAction.actionType, null)) : '',
    question: hydrateQuestionReactionForClient_(question, playerId),
    maxMs: pendingAction ? pendingAction.maxMs : '',
    finalDifficulty: pendingAction ? pendingAction.finalDifficulty : '',
    maxAnswerEfficiency: pendingAction ? pendingAction.maxAnswerEfficiency || '' : '',
    questionModifiers: pendingAction ? pendingAction.questionModifiers || {} : {},
    isOtherPlayerQuestion: pendingAction ? pendingAction.isOtherPlayerQuestion : false,
    fallbackReason: pendingAction ? pendingAction.fallbackReason : '',
  });
}

function preloadBattleQuestions(runId, authToken) {
  var player = getCurrentPlayer_(authToken);
  var run = requireRun_(runId);
  if (run.playerId !== player.playerId || run.status !== STATUS.RUN_ACTIVE) {
    throw new Error('진행 중인 런을 찾을 수 없습니다.');
  }

  var stageState = getStageState_(run);
  var battleState = requireActiveBattle_(stageState);
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  return buildBattleQuestionCache_(run, stageState, battleState);
}

function buildBattleQuestionCache_(run, stageState, battleState) {
  try {
    normalizeUsedQuestionIds_(stageState, battleState);
    var activeEffects = getActiveEffectsForQuestion_(battleState);
    var usedIdMap = getUsedQuestionIdMap_(stageState, battleState);
    var questionModifiersForPick = getItemQuestionModifiers_(battleState, null);
    var targetDifficulty = calculateRequiredQuestionDifficulty_(battleState.stage, 0, activeEffects, questionModifiersForPick);
    var selectedQuestions = selectQuestionCacheRows_(run.playerId, battleState.stage, stageState.otherStudentQuestionShown, getForcedQuestionCreatorId_(battleState), questionModifiersForPick, stageState.usedQuestionIds, targetDifficulty);
    return selectedQuestions.map(function(question) {
      var questionModifiers = getItemQuestionModifiers_(battleState, question);
      var finalDifficulty = targetDifficulty;
      var maxMs = calculateFinalQuestionTimeLimitForQuestion_(finalDifficulty, activeEffects, question, questionModifiers);
      return {
        question: sanitizeQuestionForBattleCache_(question, run.playerId),
        maxMs: maxMs,
        finalDifficulty: finalDifficulty,
        maxAnswerEfficiency: calculateMaxAnswerEfficiency_(questionModifiers),
        questionModifiers: questionModifiers,
        isOtherPlayerQuestion: question.creatorId !== run.playerId,
        fallbackReason: usedIdMap[String(question.questionId || '')] ? 'exhaustedUnusedQuestions' : '',
      };
    });
  } catch (error) {
    return [];
  }
}

function selectQuestionCacheRows_(playerId, stage, otherStudentQuestionShown, forcedCreatorId, questionModifiers, usedQuestionIds, targetDifficulty) {
  var limit = 30;
  var requiredDifficulty = clampDifficultyToStageRange_(targetDifficulty || calculateRequiredQuestionDifficulty_(stage, 0, [], questionModifiers), stage);
  var approvedQuestions = readTableCached_(DB_SHEETS.QUESTIONS, 120).filter(function(question) {
    return question.status === STATUS.QUESTION_APPROVED;
  });
  var allowedQuestions = approvedQuestions.filter(function(question) {
    if (question.creatorId === playerId) {
      return false;
    }
    return !forcedCreatorId || question.creatorId === forcedCreatorId;
  });
  var rangedQuestions = allowedQuestions.filter(function(question) {
    return isQuestionAtDifficulty_(question, requiredDifficulty);
  });
  var usedIdMap = buildQuestionIdMap_(usedQuestionIds);
  var unusedRangedQuestions = filterUnusedQuestions_(rangedQuestions, usedIdMap);
  var primaryRangedQuestions = unusedRangedQuestions.length ? unusedRangedQuestions : rangedQuestions;
  var selected = [];
  var selectedIds = {};

  function pushQuestion(question) {
    if (!question || selectedIds[question.questionId]) {
      return;
    }
    selectedIds[question.questionId] = true;
    selected.push(question);
  }

  function pushRandomFrom(pool) {
    var candidates = pool.slice();
    while (selected.length < limit && candidates.length > 0) {
      var picked = pickQuestionWithTypeBias_(candidates, questionModifiers, (usedQuestionIds || []).concat(selected.map(function(question) {
        return question.questionId;
      })));
      pushQuestion(picked);
      candidates = candidates.filter(function(candidate) {
        return candidate.questionId !== picked.questionId;
      });
    }
  }

  if (!otherStudentQuestionShown && primaryRangedQuestions.length > 0) {
    pushQuestion(pickQuestionWithTypeBias_(primaryRangedQuestions, questionModifiers, usedQuestionIds));
  }
  pushRandomFrom(primaryRangedQuestions);
  return selected;
}

function sanitizeQuestionForBattleCache_(question, playerId) {
  var sanitized = sanitizeQuestionForClient_(question, playerId);
  sanitized.answer = question.answer;
  sanitized.answerAliases = question.answerAliases || '[]';
  return sanitized;
}

function createPendingActionFromCachedPayload_(stageState, battleState, payload, actionType, skillId, targetId, playerId) {
  var question = findCachedRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', payload.questionId, 120);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  var activeEffects = getActiveEffectsForQuestion_(battleState);
  var skill = skillId ? findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', skillId, 600) : null;
  var difficultyBonus = skill ? Number(skill.difficultyBonus || 0) : 0;
  var questionModifiersForPick = getItemQuestionModifiers_(battleState, null);
  var targetDifficulty = calculateRequiredQuestionDifficulty_(battleState.stage, difficultyBonus, activeEffects, questionModifiersForPick);
  validateQuestionAllowedForBattle_(question, playerId, battleState, targetDifficulty);
  normalizeUsedQuestionIds_(stageState, battleState);
  var reusedQuestion = isQuestionUsedInRun_(stageState, battleState, question.questionId);
  if (reusedQuestion && hasUnusedQuestionForBattle_(playerId, stageState, battleState, targetDifficulty)) {
    throw new Error('This question has already appeared in this battle.');
  }
  var actionPointCost = getActionPointCostForAction_(actionType, skill);
  var questionModifiers = getItemQuestionModifiers_(battleState, question);
  var finalDifficulty = targetDifficulty;
  return {
    actionType: actionType,
    skillId: skillId || payload.skillId || '',
    targetId: targetId || payload.targetId || '',
    actionPointCost: actionPointCost,
    questionId: question.questionId,
    question: sanitizeQuestionForClient_(question, playerId),
    issuedAt: new Date().getTime() - Math.max(0, Number(payload.elapsedMs || 0)),
    maxMs: calculateFinalQuestionTimeLimitForQuestion_(finalDifficulty, activeEffects, question, questionModifiers),
    finalDifficulty: finalDifficulty,
    maxAnswerEfficiency: calculateMaxAnswerEfficiency_(questionModifiers),
    questionModifiers: questionModifiers,
    isOtherPlayerQuestion: question.creatorId !== playerId,
    fallbackReason: reusedQuestion ? 'exhaustedUnusedQuestions' : payload.fallbackReason || '',
    fromCache: true,
  };
}

function getForcedQuestionCreatorId_(battleState) {
  if (!battleState) {
    return '';
  }
  if (battleState.forcedQuestionCreatorId) {
    return battleState.forcedQuestionCreatorId;
  }
  var playerGhost = battleState.playerGhost || {};
  return playerGhost.sourcePlayerId || '';
}

function validateQuestionAllowedForBattle_(question, playerId, battleState, targetDifficulty) {
  if (!question) {
    throw new Error('Question is required.');
  }
  if (question.creatorId === playerId) {
    throw new Error('Your own questions cannot appear in battle.');
  }
  var forcedCreatorId = getForcedQuestionCreatorId_(battleState);
  if (forcedCreatorId && question.creatorId !== forcedCreatorId) {
    throw new Error('Only the player monster creator questions can appear in this battle.');
  }
  var requiredDifficulty = clampDifficultyToStageRange_(targetDifficulty || calculateRequiredQuestionDifficulty_(battleState && battleState.stage || {}, 0, getActiveEffectsForQuestion_(battleState), getItemQuestionModifiers_(battleState, null)), battleState && battleState.stage || {});
  if (!isQuestionAtDifficulty_(question, requiredDifficulty)) {
    throw new Error('This question is outside the current required difficulty.');
  }
}

function markCachedQuestionShown_(stageState, pendingAction) {
  if (pendingAction && pendingAction.isOtherPlayerQuestion) {
    stageState.otherStudentQuestionShown = true;
  }
}

function normalizeUsedQuestionIds_(stageState, battleState) {
  stageState = stageState || {};
  var usageStageId = getQuestionUsageStageId_(stageState, battleState);
  if (usageStageId && stageState.usedQuestionStageId !== usageStageId) {
    stageState.usedQuestionIds = [];
    if (battleState) {
      battleState.usedQuestionIds = [];
    }
    stageState.usedQuestionStageId = usageStageId;
  }
  var merged = mergeUsedQuestionIds_(stageState.usedQuestionIds, battleState && battleState.usedQuestionIds);
  stageState.usedQuestionIds = merged;
  if (battleState) {
    battleState.usedQuestionIds = merged.slice();
    battleState.usedQuestionStageId = usageStageId;
  }
  return stageState.usedQuestionIds;
}

function getQuestionUsageStageId_(stageState, battleState) {
  return String(battleState && battleState.stage && battleState.stage.stageId || stageState && stageState.stageId || '');
}

function mergeUsedQuestionIds_(existing, newIds) {
  var map = {};
  var merged = [];
  function add(questionId) {
    questionId = String(questionId || '');
    if (!questionId || map[questionId]) {
      return;
    }
    map[questionId] = true;
    merged.push(questionId);
  }
  (existing || []).forEach(add);
  (newIds || []).forEach(add);
  return merged;
}

function getUsedQuestionIdsFromAnswerLogs_(runId) {
  runId = String(runId || '');
  if (!runId) {
    return [];
  }
  return readTable_(DB_SHEETS.ANSWER_LOGS).filter(function(log) {
    return String(log.runId || '') === runId && log.questionId;
  }).map(function(log) {
    return log.questionId;
  });
}

function getUsedQuestionIdMap_(stageState, battleState) {
  return buildQuestionIdMap_(normalizeUsedQuestionIds_(stageState, battleState));
}

function markQuestionUsedForRun_(stageState, battleState, questionId) {
  questionId = String(questionId || '');
  if (!questionId) {
    return;
  }
  var usedQuestionIds = normalizeUsedQuestionIds_(stageState, battleState);
  if (!buildQuestionIdMap_(usedQuestionIds)[questionId]) {
    usedQuestionIds.push(questionId);
  }
  if (battleState) {
    battleState.usedQuestionIds = usedQuestionIds.slice();
  }
}

function isQuestionUsedInRun_(stageState, battleState, questionId) {
  return !!getUsedQuestionIdMap_(stageState, battleState)[String(questionId || '')];
}

function buildQuestionIdMap_(questionIds) {
  var map = {};
  (questionIds || []).forEach(function(questionId) {
    questionId = String(questionId || '');
    if (questionId) {
      map[questionId] = true;
    }
  });
  return map;
}

function filterUnusedQuestions_(questions, usedIdMap) {
  return (questions || []).filter(function(question) {
    return question && !usedIdMap[String(question.questionId || '')];
  });
}

function hasUnusedQuestionForBattle_(playerId, stageState, battleState, targetDifficulty) {
  if (!battleState || !battleState.stage) {
    return false;
  }
  var forcedCreatorId = getForcedQuestionCreatorId_(battleState);
  var requiredDifficulty = targetDifficulty || calculateRequiredQuestionDifficulty_(battleState.stage, 0, getActiveEffectsForQuestion_(battleState), getItemQuestionModifiers_(battleState, null));
  var usedIdMap = getUsedQuestionIdMap_(stageState, battleState);
  return readTableCached_(DB_SHEETS.QUESTIONS, 120).some(function(question) {
    if (question.status !== STATUS.QUESTION_APPROVED || question.creatorId === playerId) {
      return false;
    }
    if (forcedCreatorId && question.creatorId !== forcedCreatorId) {
      return false;
    }
    if (!isQuestionAtDifficulty_(question, requiredDifficulty)) {
      return false;
    }
    return !usedIdMap[String(question.questionId || '')];
  });
}

function pickQuestion_(playerId, stage, otherStudentQuestionShown, forcedCreatorId, questionModifiers, usedQuestionIds, targetDifficulty) {
  var requiredDifficulty = clampDifficultyToStageRange_(targetDifficulty || calculateRequiredQuestionDifficulty_(stage, 0, [], questionModifiers), stage);
  var approvedQuestions = readTableCached_(DB_SHEETS.QUESTIONS, 120).filter(function(question) {
    return question.status === STATUS.QUESTION_APPROVED;
  });
  var questionPool = approvedQuestions.filter(function(question) {
    if (question.creatorId === playerId) {
      return false;
    }
    return !forcedCreatorId || question.creatorId === forcedCreatorId;
  });
  var rangedQuestions = questionPool.filter(function(question) {
    return isQuestionAtDifficulty_(question, requiredDifficulty);
  });
  var usedIdMap = buildQuestionIdMap_(usedQuestionIds);
  var unusedRangedQuestions = filterUnusedQuestions_(rangedQuestions, usedIdMap);

  if (unusedRangedQuestions.length > 0) {
    return questionPickResult_(pickQuestionWithTypeBias_(unusedRangedQuestions, questionModifiers, usedQuestionIds), true, '');
  }
  if (rangedQuestions.length > 0) {
    return questionPickResult_(pickQuestionWithTypeBias_(rangedQuestions, questionModifiers, usedQuestionIds), true, 'exhaustedUnusedQuestions');
  }

  throw new Error('No approved question is available at difficulty ' + requiredDifficulty + '.');
}

function isQuestionAtDifficulty_(question, difficulty) {
  return Number(question && question.difficulty || 0) === Number(difficulty || GAME_RULES.MIN_DIFFICULTY);
}

function isQuestionInStageDifficultyRange_(question, minDifficulty, maxDifficulty) {
  var difficulty = Number(question && question.difficulty || 0);
  return difficulty >= Number(minDifficulty || GAME_RULES.MIN_DIFFICULTY)
    && difficulty <= Number(maxDifficulty || GAME_RULES.MAX_DIFFICULTY);
}

function pickQuestionWithTypeBias_(questions, questionModifiers, recentQuestionIds) {
  var pool = questions || [];
  if (!pool.length) {
    return null;
  }
  var varietyPick = pickQuestionForTypeVariety_(pool, recentQuestionIds);
  if (varietyPick) {
    return varietyPick;
  }
  var shortAnswerBonus = Number(questionModifiers && questionModifiers.shortAnswerChancePercent || 0);
  var chanceByType = questionModifiers && questionModifiers.questionChanceByType || {};
  var multipleChoiceBonus = Number(chanceByType[QUESTION_TYPES.MULTIPLE_CHOICE] || 0);
  shortAnswerBonus += Number(chanceByType[QUESTION_TYPES.SHORT_ANSWER] || 0);
  if (!shortAnswerBonus && !multipleChoiceBonus) {
    return pickRandom_(pool);
  }
  var shortAnswers = pool.filter(function(question) {
    return question.type === QUESTION_TYPES.SHORT_ANSWER;
  });
  var multipleChoices = pool.filter(function(question) {
    return question.type === QUESTION_TYPES.MULTIPLE_CHOICE;
  });
  if (!shortAnswers.length || !multipleChoices.length) {
    return pickRandom_(pool);
  }
  var shortWeight = Math.max(0, (shortAnswers.length / pool.length) * 100 + shortAnswerBonus);
  var multipleChoiceWeight = Math.max(0, (multipleChoices.length / pool.length) * 100 + multipleChoiceBonus);
  var totalWeight = shortWeight + multipleChoiceWeight;
  if (totalWeight <= 0) {
    return pickRandom_(pool);
  }
  if (Math.random() * totalWeight < shortWeight) {
    return pickRandom_(shortAnswers);
  }
  return pickRandom_(multipleChoices);
}

function pickQuestionForTypeVariety_(pool, recentQuestionIds) {
  var shortAnswers = (pool || []).filter(function(question) {
    return question.type === QUESTION_TYPES.SHORT_ANSWER;
  });
  var multipleChoices = (pool || []).filter(function(question) {
    return question.type === QUESTION_TYPES.MULTIPLE_CHOICE;
  });
  if (!shortAnswers.length || !multipleChoices.length) {
    return null;
  }
  var recentTypes = getRecentQuestionTypes_(recentQuestionIds, 2);
  if (recentTypes.length < 2 || recentTypes[0] !== recentTypes[1]) {
    return null;
  }
  if (recentTypes[0] === QUESTION_TYPES.SHORT_ANSWER) {
    return pickRandom_(multipleChoices);
  }
  if (recentTypes[0] === QUESTION_TYPES.MULTIPLE_CHOICE) {
    return pickRandom_(shortAnswers);
  }
  return null;
}

function getRecentQuestionTypes_(questionIds, limit) {
  var ids = (questionIds || []).map(function(questionId) {
    return String(questionId || '');
  }).filter(Boolean);
  if (!ids.length) {
    return [];
  }
  var questionTypeById = {};
  readTableCached_(DB_SHEETS.QUESTIONS, 120).forEach(function(question) {
    questionTypeById[String(question.questionId || '')] = question.type || '';
  });
  var types = [];
  for (var i = ids.length - 1; i >= 0 && types.length < Number(limit || 2); i -= 1) {
    var type = questionTypeById[ids[i]];
    if (type) {
      types.push(type);
    }
  }
  return types;
}

function questionPickResult_(question, isOtherPlayerQuestion, fallbackReason) {
  return {
    question: question,
    isOtherPlayerQuestion: !!isOtherPlayerQuestion,
    fallbackReason: fallbackReason || '',
  };
}

function sanitizeQuestionForClient_(question, playerId) {
  return {
    questionId: question.questionId,
    type: question.type,
    prompt: question.prompt,
    choice1: question.choice1,
    choice2: question.choice2,
    choice3: question.choice3,
    choice4: question.choice4,
    difficulty: question.difficulty,
    creatorId: question.creatorId,
    creatorName: question.creatorName,
    subject: question.subject,
    unit: question.unit,
    tags: question.tags,
    likeCount: Number(question.likeCount || 0),
    dislikeCount: Number(question.dislikeCount || 0),
    myReaction: getQuestionReactionForPlayer_(question, playerId),
  };
}

function hydrateQuestionReactionForClient_(question, playerId) {
  var clientQuestion = Object.assign({}, question || {});
  if (!clientQuestion.questionId) {
    return clientQuestion;
  }
  if (clientQuestion.myReaction === undefined || clientQuestion.myReaction === '') {
    var sourceQuestion = question || {};
    if (sourceQuestion.reactionJson === undefined) {
      sourceQuestion = findCachedRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', clientQuestion.questionId, 120) || sourceQuestion;
    }
    clientQuestion.myReaction = getQuestionReactionForPlayer_(sourceQuestion, playerId);
  }
  clientQuestion.likeCount = Number(clientQuestion.likeCount || 0);
  clientQuestion.dislikeCount = Number(clientQuestion.dislikeCount || 0);
  return clientQuestion;
}

function getQuestionReactionForPlayer_(question, playerId) {
  var targetPlayerId = String(playerId || '').trim();
  if (!targetPlayerId) {
    return '';
  }
  var reactions = safeJsonParse_(question && question.reactionJson, {});
  if (!reactions || Array.isArray(reactions) || typeof reactions !== 'object') {
    return '';
  }
  return normalizeQuestionReaction_(reactions[targetPlayerId]);
}

function saveStageState_(runId, stageState, battleState) {
  normalizeUsedQuestionIds_(stageState, battleState);
  normalizeBattleStateEffects_(battleState);
  battleState.runId = battleState.runId || runId;
  if (battleState.monsterScoreState) {
    stageState.scoreState = stageState.scoreState || {};
    stageState.scoreState.monsterScoreBattleId = battleState.battleId || '';
    stageState.scoreState.monsterScore = Number(battleState.monsterScoreState.monsterScore || 0);
    stageState.scoreState.monsterScoreDetails = battleState.monsterScoreState.byMonsterId || {};
    stageState.scoreState.monsterScoreAwardedBattleId = battleState.monsterScoreState.battleId || battleState.battleId || '';
    stageState.scoreState.monsterScoreAwardedToRun = Number(battleState.monsterScoreState.scoreAwardedToRun || 0);
  }
  if (battleState.questionReactionScoreState) {
    stageState.scoreState = stageState.scoreState || {};
    stageState.scoreState.questionReactionScoreBattleId = battleState.questionReactionScoreState.battleId || battleState.battleId || '';
    stageState.scoreState.questionReactionScore = Number(battleState.questionReactionScoreState.score || 0);
  }
  var patch = {
    currentHp: battleState.player.hp,
    currentShield: battleState.player.shield,
    statsJson: safeJsonStringify_(battleState.player.baseStats || battleState.player.stats),
    stageStateJson: safeJsonStringify_(stageState),
    updatedAt: new Date(),
  };

  if (battleState.status === STATUS.BATTLE_DEFEAT) {
    patch.status = STATUS.RUN_FAILED;
    patch.endedAt = new Date();
    createPlayerGhostForDefeat_(runId, battleState);
  }

  var updatedRun = updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, patch);
  if (battleState.status === STATUS.BATTLE_DEFEAT && typeof updatePlayerProgressFromRun_ === 'function') {
    updatePlayerProgressFromRun_(updatedRun);
  }
  return updatedRun;
}

function createPlayerGhostForDefeat_(runId, battleState) {
  ensurePlayerGhostSheet_();
  if (findRowByKey_(DB_SHEETS.PLAYER_GHOSTS, 'sourceRunId', runId)) {
    return null;
  }

  var run = requireRun_(runId);
  var player = findRowByKey_(DB_SHEETS.PLAYERS, 'playerId', run.playerId) || {};
  var ghost = {
    ghostId: generateId_('ghost'),
    sourceRunId: runId,
    sourcePlayerId: run.playerId,
    sourceDisplayName: player.displayName || player.studentName || run.playerId,
    sourceAvatarType: player.avatarType || AVATAR_TYPES.INITIAL,
    sourceAvatarKey: player.avatarKey || '',
    floor: battleState && battleState.stage ? Number(battleState.stage.floor || run.currentFloor || 1) : Number(run.currentFloor || 1),
    stage: battleState && battleState.stage ? Number(battleState.stage.stage || run.currentStage || 1) : Number(run.currentStage || 1),
    status: STATUS.GHOST_ACTIVE,
    spawnedRunId: '',
    spawnedPlayerId: '',
    spawnedBattleId: '',
    spawnedAt: '',
    createdAt: new Date(),
  };
  appendRowObject_(DB_SHEETS.PLAYER_GHOSTS, ghost);
  return ghost;
}

function selectPlayerGhostForBattle_(run, stage, stageState, battleId) {
  var emptySelection = { monster: null, context: null, questionCreatorId: '' };
  if (!stage || !run || !run.playerId) {
    return emptySelection;
  }
  var stageId = stage.stageId || buildStageId_(stage.floor, stage.stage);
  if (stageState.playerGhostRollStageId === stageId) {
    return emptySelection;
  }

  stageState.playerGhostRollStageId = stageId;
  stageState.playerGhostRollDone = true;

  var lock = LockService.getScriptLock();
  try {
    lock.waitLock(3000);
  } catch (error) {
    return emptySelection;
  }

  try {
    ensurePlayerGhostSheet_();
    var approvedQuestionCreators = getApprovedQuestionCreatorMap_();
    var activeGhosts = readTable_(DB_SHEETS.PLAYER_GHOSTS).filter(function(ghost) {
      return ghost.status === STATUS.GHOST_ACTIVE &&
        ghost.sourcePlayerId &&
        ghost.sourcePlayerId !== run.playerId &&
        !!approvedQuestionCreators[ghost.sourcePlayerId];
    });
    if (!activeGhosts.length) {
      return emptySelection;
    }

    var sameFloorGhosts = activeGhosts.filter(function(ghost) {
      return Number(ghost.floor || 0) === Number(stage.floor || 0);
    });
    var selectedGhost = sameFloorGhosts.length ? pickRandom_(sameFloorGhosts) : null;
    var spawnReason = selectedGhost ? 'sameFloor' : '';

    if (!selectedGhost && Math.random() * 100 < GAME_RULES.PLAYER_GHOST_OFF_FLOOR_CHANCE) {
      selectedGhost = pickRandom_(activeGhosts);
      spawnReason = 'offFloorChance';
    }
    if (!selectedGhost) {
      return emptySelection;
    }

    var consumed = updateRowByKey_(DB_SHEETS.PLAYER_GHOSTS, 'ghostId', selectedGhost.ghostId, {
      status: STATUS.GHOST_CONSUMED,
      spawnedRunId: run.runId,
      spawnedPlayerId: run.playerId,
      spawnedBattleId: battleId,
      spawnedAt: new Date(),
    });
    if (!consumed || consumed.status !== STATUS.GHOST_CONSUMED) {
      return emptySelection;
    }

    selectedGhost = Object.assign({}, selectedGhost, consumed);
    var monster = buildPlayerGhostMonster_(selectedGhost, stage);
    var context = {
      ghostId: selectedGhost.ghostId,
      sourceRunId: selectedGhost.sourceRunId,
      sourcePlayerId: selectedGhost.sourcePlayerId,
      sourceDisplayName: selectedGhost.sourceDisplayName,
      floor: Number(selectedGhost.floor || 0),
      stage: Number(selectedGhost.stage || 0),
      spawnReason: spawnReason,
    };
    return {
      monster: monster,
      context: context,
      questionCreatorId: selectedGhost.sourcePlayerId,
    };
  } finally {
    try {
      lock.releaseLock();
    } catch (error) {
      // Lock release is best-effort.
    }
  }
}

function ensurePlayerGhostSheet_() {
  ensureSheet_(DB_SHEETS.PLAYER_GHOSTS, DB_COLUMNS.PLAYER_GHOSTS);
}

function getApprovedQuestionCreatorMap_() {
  return readTableCached_(DB_SHEETS.QUESTIONS, 120).reduce(function(map, question) {
    if (question.status === STATUS.QUESTION_APPROVED && question.creatorId) {
      map[question.creatorId] = true;
    }
    return map;
  }, {});
}

function buildPlayerGhostMonster_(ghost, stage) {
  var floor = Number(stage.floor || ghost.floor || 1);
  var config = PLAYER_GHOST_FLOOR_CONFIGS[floor] || PLAYER_GHOST_FLOOR_CONFIGS[1];
  var name = String(ghost.sourceDisplayName || 'Player Ghost') + ' Echo';
  return {
    instanceId: 'player_ghost_' + ghost.ghostId,
    monsterId: 'player_ghost_' + ghost.sourcePlayerId,
    name: name,
    type: 'playerGhost',
    avatarType: ghost.sourceAvatarType || AVATAR_TYPES.INITIAL,
    avatarKey: ghost.sourceAvatarKey || '',
    currentHp: Number(config.hp || 1),
    maxHp: Number(config.hp || 1),
    attack: Number(config.attack || 1),
    defense: Number(config.defense || 0),
    aiId: config.aiId || 'ai_player_ghost_floor_1',
    skillIds: safeJsonParse_(config.skillIds, []),
    ghostPlayerId: ghost.sourcePlayerId,
    questionCreatorId: ghost.sourcePlayerId,
    shield: 0,
    intent: null,
    effects: [],
    buffs: [],
    debuffs: [],
  };
}

function getPlayerGhostAiRows_() {
  return [
    { aiId: 'ai_player_ghost_floor_1', actionType: ACTION_TYPES.ATTACK, conditionJson: '{}', probability: 100, skillId: '', intentIcon: 'sword', intentTextTemplate: 'Attack next.' },
    { aiId: 'ai_player_ghost_floor_2', actionType: ACTION_TYPES.ATTACK, conditionJson: '{}', probability: 70, skillId: '', intentIcon: 'sword', intentTextTemplate: 'Attack next.' },
    { aiId: 'ai_player_ghost_floor_2', actionType: ACTION_TYPES.GUARD, conditionJson: '{"afterTurn":2}', probability: 30, skillId: '', intentIcon: 'shield', intentTextTemplate: 'Guard next.' },
    { aiId: 'ai_player_ghost_floor_3', actionType: ACTION_TYPES.ATTACK, conditionJson: '{}', probability: 55, skillId: '', intentIcon: 'sword', intentTextTemplate: 'Attack next.' },
    { aiId: 'ai_player_ghost_floor_3', actionType: 'skill', conditionJson: '{"afterTurn":2}', probability: 45, skillId: 'skill_bleeding_mark', intentIcon: 'drop', intentTextTemplate: 'Use a debuff next.' },
    { aiId: 'ai_player_ghost_floor_4', actionType: ACTION_TYPES.ATTACK, conditionJson: '{}', probability: 45, skillId: '', intentIcon: 'sword', intentTextTemplate: 'Attack next.' },
    { aiId: 'ai_player_ghost_floor_4', actionType: ACTION_TYPES.GUARD, conditionJson: '{"afterTurn":2}', probability: 25, skillId: '', intentIcon: 'shield', intentTextTemplate: 'Guard next.' },
    { aiId: 'ai_player_ghost_floor_4', actionType: 'skill', conditionJson: '{"afterTurn":2}', probability: 30, skillId: 'skill_bleeding_mark', intentIcon: 'drop', intentTextTemplate: 'Use a debuff next.' },
    { aiId: 'ai_player_ghost_floor_5', actionType: ACTION_TYPES.ATTACK, conditionJson: '{}', probability: 40, skillId: '', intentIcon: 'sword', intentTextTemplate: 'Attack next.' },
    { aiId: 'ai_player_ghost_floor_5', actionType: ACTION_TYPES.GUARD, conditionJson: '{"hpBelowPercent":55}', probability: 25, skillId: '', intentIcon: 'shield', intentTextTemplate: 'Guard next.' },
    { aiId: 'ai_player_ghost_floor_5', actionType: 'skill', conditionJson: '{"afterTurn":2}', probability: 35, skillId: 'skill_bleeding_mark', intentIcon: 'drop', intentTextTemplate: 'Use a debuff next.' },
  ];
}

function createMonstersForStage_(stage, playerGhostMonster) {
  var monsters = [];
  if (playerGhostMonster) {
    monsters.push(playerGhostMonster);
  }
  if (stage.bossMonsterId) {
    var bossMonster = findMonsterRowById_(stage.bossMonsterId);
    if (bossMonster) {
      monsters.push(buildBattleMonster_(bossMonster, monsters.length));
      return applyMultiMonsterStatScaling_(monsters.slice(0, 3));
    }
    var fallbackBoss = findMonsterRowById_('boss_floor_' + Number(stage.floor || 1));
    if (fallbackBoss) {
      monsters.push(buildBattleMonster_(fallbackBoss, monsters.length));
      return applyMultiMonsterStatScaling_(monsters.slice(0, 3));
    }
  }

  if (!stage.monsterGroupId) {
    var defaultMonster = findMonsterRowById_('monster_shadow_problem');
    if (!defaultMonster) {
      throw new Error('몬스터를 찾을 수 없습니다.');
    }
    monsters.push(buildBattleMonster_(defaultMonster, monsters.length));
    return applyMultiMonsterStatScaling_(monsters.slice(0, 3));
  }

  var group = findCachedRowByKey_(DB_SHEETS.MONSTER_GROUPS, 'monsterGroupId', stage.monsterGroupId, 600);
  if (!group) {
    throw new Error('몬스터 그룹을 찾을 수 없습니다: ' + stage.monsterGroupId);
  }

  var monsterIds = safeJsonParse_(group.monsterIds, []);
  if (!Array.isArray(monsterIds)) {
    monsterIds = [];
  }
  var weights = safeJsonParse_(group.weights, []);
  if (!Array.isArray(weights)) {
    weights = [];
  }
  var fixedMonsterIds = safeJsonParse_(group.fixedMonsterIds, []);
  if (!Array.isArray(fixedMonsterIds)) {
    fixedMonsterIds = [];
  }
  var requestedMonsterCount = Math.round(Number(group.monsterCount || 1));
  if (!isFinite(requestedMonsterCount)) {
    requestedMonsterCount = 1;
  }
  var monsterCount = Math.min(3, Math.max(1, requestedMonsterCount, monsters.length + fixedMonsterIds.length));

  for (var fixedIndex = 0; fixedIndex < fixedMonsterIds.length && monsters.length < monsterCount; fixedIndex += 1) {
    var fixedMonsterId = String(fixedMonsterIds[fixedIndex] || '').trim();
    if (!fixedMonsterId) {
      continue;
    }
    var fixedMonster = findMonsterRowById_(fixedMonsterId);
    if (!fixedMonster) {
      throw new Error('Fixed monster not found in group ' + stage.monsterGroupId + ': ' + fixedMonsterId);
    }
    monsters.push(buildBattleMonster_(fixedMonster, monsters.length));
  }
  var monsterOptions = monsterIds.map(function(monsterId, index) {
    var monster = findMonsterRowById_(monsterId);
    return monster ? { monster: monster, weight: Number(weights[index] || 0) } : null;
  }).filter(function(option) {
    return !!option;
  });
  if (!monsterOptions.length && monsters.length < monsterCount) {
    throw new Error('몬스터 그룹에 사용 가능한 몬스터가 없습니다: ' + stage.monsterGroupId);
  }

  for (var i = monsters.length; i < monsterCount; i += 1) {
    var selectedOption = pickWeighted_(monsterOptions, monsterOptions.map(function(option) { return option.weight; }));
    monsters.push(buildBattleMonster_(selectedOption.monster, i));
  }
  return applyMultiMonsterStatScaling_(monsters);
}

function applyMultiMonsterStatScaling_(monsters) {
  var list = (monsters || []).slice(0, 3);
  var scalableMonsters = list.filter(function(monster) {
    return !isBossBattleMonster_(monster);
  });
  var count = scalableMonsters.length;
  if (count < 2) {
    return list;
  }
  var hpMultiplier = count >= 3 ? 0.5 : 0.67;
  var attackMultiplier = count >= 3 ? 0.67 : 0.75;
  scalableMonsters.forEach(function(monster) {
    var originalMaxHp = Math.max(1, Number(monster.maxHp || monster.currentHp || 1));
    var currentRatio = Math.max(0, Math.min(1, Number(monster.currentHp || originalMaxHp) / originalMaxHp));
    monster.originalMaxHp = originalMaxHp;
    monster.originalAttack = Number(monster.attack || 0);
    monster.maxHp = Math.max(1, Math.round(originalMaxHp * hpMultiplier));
    monster.currentHp = Math.max(1, Math.round(monster.maxHp * currentRatio));
    monster.attack = Math.max(1, Math.round(Number(monster.attack || 0) * attackMultiplier));
    monster.multiMonsterScale = {
      monsterCount: count,
      hpMultiplier: hpMultiplier,
      attackMultiplier: attackMultiplier,
    };
  });
  return list;
}

function isBossBattleMonster_(monster) {
  var type = String(monster && monster.type || '').toLowerCase();
  var monsterId = String(monster && monster.monsterId || '').toLowerCase();
  return type === 'boss' || type === 'finalboss' || monsterId.indexOf('boss_') === 0;
}

function findMonsterRowById_(monsterId) {
  var id = String(monsterId || '').trim();
  if (!id) {
    return null;
  }

  var exact = findCachedRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', id, 600);
  if (exact) {
    return exact;
  }

  var rows = [];
  try {
    rows = readTableCached_(DB_SHEETS.MONSTERS, 600);
  } catch (error) {
    rows = [];
  }
  var trimmed = rows.filter(function(monster) {
    return String(monster.monsterId || '').trim() === id;
  })[0];
  if (trimmed) {
    return trimmed;
  }

  return (MASTER_MONSTERS || []).filter(function(monster) {
    return String(monster.monsterId || '').trim() === id;
  })[0] || null;
}

function buildBattleMonster_(monster, index) {
  if (!monster) {
    throw new Error('몬스터를 찾을 수 없습니다.');
  }

  return {
    instanceId: monster.monsterId + '_' + Number(index || 0),
    monsterId: monster.monsterId,
    name: monster.name,
    type: monster.type,
    currentHp: Number(monster.hp),
    maxHp: Number(monster.hp),
    attack: Number(monster.attack),
    defense: Number(monster.defense || 0),
    aiId: monster.aiId || 'ai_basic_attack',
    skillIds: safeJsonParse_(monster.skillIds, []),
    shield: 0,
    intent: null,
    effects: [],
    buffs: [],
    debuffs: [],
  };
}

function normalizeBattleMonsters_(battleState) {
  if (!battleState.monsters || !battleState.monsters.length) {
    battleState.monsters = battleState.monster ? [battleState.monster] : [];
  }
  battleState.monsters = battleState.monsters.slice(0, 3).map(function(monster, index) {
    monster = migrateLegacyBattleMonster_(battleState, monster, index);
    if (!monster.instanceId) {
      monster.instanceId = String(monster.monsterId || 'monster') + '_' + index;
    }
    monster.aiId = monster.aiId || 'ai_basic_attack';
    monster.skillIds = monster.skillIds || [];
    monster.shield = Number(monster.shield || 0);
    monster.intent = monster.intent || null;
    normalizeTargetStatusBuckets_(monster);
    return monster;
  });
  syncPrimaryMonster_(battleState);
  return battleState.monsters;
}

function migrateLegacyBattleMonster_(battleState, monster, index) {
  if (!monster || monster.monsterId !== 'monster_training_dummy') {
    return monster || {};
  }

  var replacement = findReplacementMonsterForLegacy_(battleState);
  if (!replacement) {
    monster.monsterId = 'monster_shadow_problem';
    monster.name = monster.name === '훈련 더미' ? '그림자 문제' : monster.name;
    battleState.legacyMonsterMigrated = true;
    return monster;
  }

  var hpRatio = Number(monster.maxHp || 0) > 0
    ? Math.max(0, Number(monster.currentHp || 0)) / Number(monster.maxHp || 1)
    : 1;
  var migrated = buildBattleMonster_(replacement, index);
  migrated.currentHp = Number(monster.currentHp || 0) <= 0 ? 0 : Math.max(1, Math.round(Number(migrated.maxHp || 1) * hpRatio));
  migrated.shield = Number(monster.shield || 0);
  migrated.intent = monster.intent || migrated.intent;
  migrated.effects = monster.effects || migrated.effects;
  migrated.buffs = monster.buffs || migrated.buffs;
  migrated.debuffs = monster.debuffs || migrated.debuffs;
  battleState.legacyMonsterMigrated = true;
  return migrated;
}

function findReplacementMonsterForLegacy_(battleState) {
  var stage = battleState.stage || {};
  var groupId = stage.monsterGroupId || '';
  if (!groupId && stage.stageId) {
    try {
      var stageRow = loadStage(stage.stageId);
      groupId = stageRow.monsterGroupId || '';
      stage.monsterGroupId = groupId;
    } catch (error) {
      groupId = '';
    }
  }

  if (groupId) {
    var group = findCachedRowByKey_(DB_SHEETS.MONSTER_GROUPS, 'monsterGroupId', groupId, 600);
    var fixedMonsterIds = safeJsonParse_(group && group.fixedMonsterIds, []);
    var monsterIds = safeJsonParse_(group && group.monsterIds, []);
    if (!Array.isArray(fixedMonsterIds)) {
      fixedMonsterIds = [];
    }
    if (!Array.isArray(monsterIds)) {
      monsterIds = [];
    }
    var candidateMonsterIds = fixedMonsterIds.concat(monsterIds).filter(function(monsterId) {
      return monsterId && monsterId !== 'monster_training_dummy';
    });
    for (var i = 0; i < candidateMonsterIds.length; i += 1) {
      var groupedMonster = findCachedRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', candidateMonsterIds[i], 600);
      if (groupedMonster) {
        return groupedMonster;
      }
    }
  }

  return findCachedRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', 'monster_shadow_problem', 600) ||
    readTableCached_(DB_SHEETS.MONSTERS, 600).filter(function(row) {
      return row.monsterId && row.monsterId !== 'monster_training_dummy';
    })[0] ||
    null;
}

function syncPrimaryMonster_(battleState) {
  battleState.monster = getFirstAliveMonster_(battleState) || battleState.monsters[0] || null;
  return battleState.monster;
}

function getAliveMonsters_(battleState) {
  normalizeBattleMonsters_(battleState);
  return battleState.monsters.filter(function(monster) {
    return Number(monster.currentHp || 0) > 0;
  });
}

function getFirstAliveMonster_(battleState) {
  return (battleState.monsters || []).filter(function(monster) {
    return Number(monster.currentHp || 0) > 0;
  })[0] || null;
}

function getAliveMonsterById_(battleState, targetId) {
  if (!targetId) {
    return null;
  }
  return (battleState.monsters || []).filter(function(monster) {
    return Number(monster.currentHp || 0) > 0 &&
      ((monster.instanceId || monster.monsterId) === targetId || monster.monsterId === targetId);
  })[0] || null;
}

function areAllMonstersDefeated_(battleState) {
  normalizeBattleMonsters_(battleState);
  return getAliveMonsters_(battleState).length === 0;
}

function requireRun_(runId) {
  var cachedRun = getCachedRun_(runId);
  if (cachedRun) {
    return cachedRun;
  }
  var run = findRowByKey_(DB_SHEETS.RUNS, 'runId', runId);
  if (!run) {
    throw new Error('런을 찾을 수 없습니다: ' + runId);
  }
  return cacheRun_(run);
}

function getRunWithStageState_(runId) {
  return requireRun_(runId);
}

function getStageState_(run) {
  var stageState = safeJsonParse_(run.stageStateJson, {
    stageId: buildStageId_(run.currentFloor, run.currentStage),
    otherStudentQuestionShown: false,
    fallbackEvents: [],
    usedQuestionIds: [],
  });
  if (!Array.isArray(stageState.usedQuestionIds)) {
    stageState.usedQuestionIds = [];
  }
  normalizeUsedQuestionIds_(stageState, stageState.battle);
  return stageState;
}

function requireActiveBattle_(stageState) {
  if (!stageState.battle) {
    throw new Error('전투 상태가 없습니다.');
  }
  if (stageState.battle.status !== STATUS.BATTLE_ACTIVE) {
    throw new Error('이미 종료된 전투입니다.');
  }
  return stageState.battle;
}

function normalizeActionType_(actionType) {
  if (actionType === ACTION_TYPES.ATTACK || actionType === ACTION_TYPES.GUARD || actionType === ACTION_TYPES.SKILL) {
    return actionType;
  }
  throw new Error('지원하지 않는 행동입니다.');
}

function buildStageId_(floor, stage) {
  return 'floor_' + Number(floor || 1) + '_stage_' + Number(stage || 1);
}

function getEffectFlatBonus_(activeEffects, statKey) {
  return (activeEffects || []).reduce(function(total, effect) {
    if (effect.effectId === 'debuff_foolish' && statKey === STAT_KEYS.QUESTION_DIFFICULTY) {
      return total;
    }
    if (effect.statKey === statKey && effect.effectType === EFFECT_TYPES.FLAT) {
      return total + (Number(effect.value || 0) * Math.max(1, Number(effect.stacks || 1)));
    }
    return total;
  }, 0);
}

function clampDifficulty_(difficulty) {
  return Math.max(GAME_RULES.MIN_DIFFICULTY, Math.min(GAME_RULES.MAX_DIFFICULTY, Math.round(difficulty)));
}

function pickRandom_(items) {
  return items[Math.floor(Math.random() * items.length)];
}

function pickWeighted_(ids, weights) {
  if (!ids.length) {
    throw new Error('몬스터 후보가 없습니다.');
  }

  var totalWeight = weights.reduce(function(total, weight) {
    return total + Number(weight || 0);
  }, 0);
  if (totalWeight <= 0) {
    return pickRandom_(ids);
  }

  var cursor = Math.random() * totalWeight;
  for (var i = 0; i < ids.length; i += 1) {
    cursor -= Number(weights[i] || 0);
    if (cursor <= 0) {
      return ids[i];
    }
  }
  return ids[ids.length - 1];
}

function isCorrectAnswer_(question, selectedAnswer, selectedChoiceIndex, selectedAnswerText) {
  var answer = normalizeAnswer_(question.answer);
  var aliases = safeJsonParse_(question.answerAliases, []).map(normalizeAnswer_);
  var candidates = [
    normalizeAnswer_(selectedAnswer),
    normalizeAnswer_(selectedChoiceIndex),
    normalizeAnswer_(selectedAnswerText),
  ].filter(Boolean);

  if (question.type === QUESTION_TYPES.MULTIPLE_CHOICE) {
    var answerAsNumber = Number(question.answer);
    if (answerAsNumber >= 1 && answerAsNumber <= 4 && String(answerAsNumber) === String(selectedChoiceIndex)) {
      return true;
    }
  }

  return candidates.some(function(candidate) {
    return candidate === answer || aliases.indexOf(candidate) !== -1;
  });
}

function normalizeAnswer_(value) {
  return String(value || '').trim().toLowerCase().replace(/\s+/g, ' ');
}

function logBattleEvent_(run, result, summary) {
  appendRowObject_(DB_SHEETS.BATTLE_LOGS, {
    battleLogId: generateId_('battleLog'),
    runId: run.runId,
    playerId: run.playerId,
    floor: run.currentFloor,
    stage: run.currentStage,
    result: result,
    summaryJson: safeJsonStringify_(summary || {}),
    createdAt: new Date(),
  });
}

function roundTo_(value, digits) {
  var unit = Math.pow(10, digits || 0);
  return Math.round(value * unit) / unit;
}
