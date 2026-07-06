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

  return {
    canStart: reasons.length === 0,
    reasons: reasons,
  };
}

function startRun(playerId, authToken) {
  var check = canStartGame(playerId, authToken);
  if (!check.canStart) {
    throw new Error(check.reasons.join('\n'));
  }

  var existingRun = getActiveRun(playerId);
  if (existingRun) {
    return toClientObject_(existingRun);
  }

  var now = new Date();
  var stats = Object.assign({}, BASE_PLAYER_STATS);
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
    }),
    startedAt: now,
    updatedAt: now,
    endedAt: '',
    clearTimeMs: '',
    currency: 0,
  };

  appendRowObject_(DB_SHEETS.RUNS, run);
  return startBattle(run.runId);
}

function getActiveRun(playerId) {
  return readTable_(DB_SHEETS.RUNS).filter(function(run) {
    return run.playerId === playerId && run.status === STATUS.RUN_ACTIVE;
  })[0] || null;
}

function loadStage(stageId) {
  var stage = findCachedRowByKey_(DB_SHEETS.STAGES, 'stageId', stageId, 600);
  if (!stage) {
    throw new Error('스테이지를 찾을 수 없습니다: ' + stageId);
  }
  return stage;
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
  var battleId = generateId_('battle');
  var playerGhostSelection = selectPlayerGhostForBattle_(run, stage, stageState, battleId);
  var monsters = createMonstersForStage_(stage, playerGhostSelection.monster);
  var stats = safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS));
  var battleState = {
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
      monsterGroupId: stage.monsterGroupId || '',
      bossMonsterId: stage.bossMonsterId || '',
      bossConfig: {
        shortQuestionChance: stage.bossMonsterId ? 15 : 0,
      },
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
      stats: stats,
      effects: [],
    },
    monsters: monsters,
    monster: monsters[0],
    playerGhost: playerGhostSelection.context,
    forcedQuestionCreatorId: playerGhostSelection.questionCreatorId || '',
    pendingAction: null,
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
  decideMonsterIntents(battleState);

  stageState.battle = battleState;
  stageState.stageId = stage.stageId;
  stageState.otherStudentQuestionShown = !!stageState.otherStudentQuestionShown;
  stageState.playerGhost = playerGhostSelection.context;
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
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  normalizePlayerActionPoints_(battleState, false);
  battleState.pendingAction = null;
  battleState.player.currentActionPoint = 0;
  battleState.lastTurnEvents = [];

  if (battleState.player.hp > 0 && battleState.status === STATUS.BATTLE_ACTIVE) {
    clearMonsterTurnShields_(battleState);
    applyMonsterTurn(battleState);
    clearPlayerTurnShield_(battleState);
    tickEffectsAtTurnEnd(battleState);
  }

  battleState.turn = Number(battleState.turn || 1) + 1;
  if (battleState.player.hp <= 0) {
    battleState.status = STATUS.BATTLE_DEFEAT;
    battleState.lastMessage = '몬스터의 공격으로 쓰러졌습니다.';
  }
  if (battleState.status === STATUS.BATTLE_ACTIVE) {
    decideMonsterIntents(battleState);
    normalizePlayerActionPoints_(battleState, true);
    decrementSkillCooldowns_(battleState);
    battleState.usedSkillTagsThisTurn = [];
    battleState.usedSkillCountByTagThisTurn = {};
    battleState.lastMessage = '내 턴입니다. 행동을 선택하세요.';
  }

  stageState.battle = battleState;
  saveStageState_(run.runId, stageState, battleState);
  return buildBattleView_(requireRun_(run.runId), getStageState_(requireRun_(run.runId)));
}

function selectQuestionForAction(playerId, runId, actionType, difficultyBonus, authToken) {
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
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  normalizePlayerActionPoints_(battleState, false);
  if (hasEffect_(battleState.player, 'debuff_stun') || hasEffect_(battleState.player, 'debuff_freeze')) {
    throw new Error('행동할 수 없는 상태입니다.');
  }
  var actionCost = getActionPointCostForAction_(normalizedAction, null);
  if (!hasEnoughActionPoint_(battleState, actionCost)) {
    throw new Error('행동력이 부족합니다.');
  }
  if (battleState.pendingAction) {
    return buildQuestionView_(battleState.pendingAction.question, battleState.pendingAction);
  }

  var activeEffects = getActiveEffectsForQuestion_(battleState);
  var preferredQuestionType = shouldUseShortQuestionInBoss(battleState.stage.bossConfig) ? QUESTION_TYPES.SHORT_ANSWER : '';
  var questionResult = pickQuestion_(playerId, battleState.stage, stageState.otherStudentQuestionShown, preferredQuestionType, getForcedQuestionCreatorId_(battleState));
  var baseDifficulty = applyBossDifficultyBonus(battleState.stage, Number(questionResult.question.difficulty || battleState.stage.baseDifficulty) + Number(difficultyBonus || 0));
  var finalDifficulty = calculateFinalQuestionDifficulty(baseDifficulty, activeEffects);
  var maxMs = calculateFinalQuestionTimeLimit(finalDifficulty, activeEffects);
  var pendingAction = {
    actionType: normalizedAction,
    actionPointCost: actionCost,
    questionId: questionResult.question.questionId,
    question: sanitizeQuestionForClient_(questionResult.question),
    issuedAt: new Date().getTime(),
    maxMs: maxMs,
    finalDifficulty: finalDifficulty,
    isOtherPlayerQuestion: questionResult.isOtherPlayerQuestion,
    fallbackReason: questionResult.fallbackReason,
  };

  battleState.pendingAction = pendingAction;
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
    logBattleEvent_(run, 'questionFallback', {
      reason: questionResult.fallbackReason,
      actionType: normalizedAction,
      stageId: battleState.stage.stageId,
      questionId: questionResult.question.questionId,
    });
  }

  saveStageState_(runId, stageState, battleState);
  return buildQuestionView_(pendingAction.question, pendingAction);
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
  normalizeBattleStateEffects_(battleState);
  var pendingAction = battleState.pendingAction;
  if (!pendingAction && payload.questionId) {
    battleState.player.shield = 0;
    pendingAction = createPendingActionFromCachedPayload_(
      battleState,
      payload,
      normalizeActionType_(payload.actionType || ACTION_TYPES.ATTACK),
      '',
      '',
      player.playerId
    );
    battleState.pendingAction = pendingAction;
    markCachedQuestionShown_(stageState, pendingAction);
  }
  if (!pendingAction || pendingAction.questionId !== payload.questionId) {
    throw new Error('풀이 중인 문제가 없습니다.');
  }

  var question = findRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', pendingAction.questionId);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  var elapsedMs = Math.max(0, Number(payload.elapsedMs || 0));
  var maxMs = Number(pendingAction.maxMs || calculateFinalQuestionTimeLimit(pendingAction.finalDifficulty, getActiveEffectsForQuestion_(battleState)));
  var remainingMs = Math.max(0, maxMs - elapsedMs);
  var isCorrect = isCorrectAnswer_(question, payload.selectedAnswer, payload.selectedChoiceIndex, payload.selectedAnswerText);
  var wrongCountAfterTimeout = Number(payload.wrongCountAfterTimeout || 0);
  var efficiency = calculateEfficiency(isCorrect, remainingMs, maxMs, wrongCountAfterTimeout);

  battleState.lastTurnEvents = [];
  consumeActionPoint_(battleState, Number(pendingAction.actionPointCost || getActionPointCostForAction_(pendingAction.actionType, null)));
  tickEffectsAtTurnStart(battleState);
  if (battleState.player.hp > 0) {
    if (pendingAction.actionType === ACTION_TYPES.ATTACK) {
      applyAttack(battleState, efficiency);
    } else {
      applyGuard(battleState, efficiency);
    }
  }

  if (areAllMonstersDefeated_(battleState)) {
    battleState.status = STATUS.BATTLE_VICTORY;
    battleState.lastMessage = '몬스터를 처치했습니다.';
    logBattleEvent_(run, STATUS.BATTLE_VICTORY, { battleId: battleState.battleId });
  }

  battleState.pendingAction = null;
  stageState.battle = battleState;

  logAnswer({
    questionId: question.questionId,
    playerId: player.playerId,
    creatorId: question.creatorId,
    runId: run.runId,
    battleId: battleState.battleId,
    floor: battleState.stage.floor,
    stage: battleState.stage.stage,
    actionType: pendingAction.actionType,
    selectedAnswer: payload.selectedAnswerText || payload.selectedAnswer || '',
    isCorrect: isCorrect,
    elapsedMs: elapsedMs,
    maxTimeMs: maxMs,
    efficiency: efficiency,
    finalDifficulty: pendingAction.finalDifficulty,
    isOtherPlayerQuestion: pendingAction.isOtherPlayerQuestion,
  });
  updateQuestionStats(question.questionId, isCorrect);
  saveStageState_(run.runId, stageState, battleState);

  return buildBattleView_(requireRun_(run.runId), getStageState_(requireRun_(run.runId)));
}

function calculateQuestionTimeLimit(difficulty, activeEffects) {
  return calculateFinalQuestionTimeLimit(difficulty, activeEffects);
}

function calculateFinalQuestionDifficulty(baseDifficulty, activeEffects) {
  var difficultyBonus = getEffectFlatBonus_(activeEffects, STAT_KEYS.QUESTION_DIFFICULTY);
  return clampDifficulty_(Number(baseDifficulty || GAME_RULES.MIN_DIFFICULTY) + difficultyBonus);
}

function calculateEfficiency(isCorrect, remainingMs, maxMs, wrongCountAfterTimeout) {
  var penaltyCount = Math.max(0, Number(wrongCountAfterTimeout || 0));
  if (penaltyCount > 0) {
    return roundTo_(Math.max(0, GAME_RULES.MIN_ANSWER_EFFICIENCY - (GAME_RULES.EXTRA_WRONG_EFFICIENCY_PENALTY * (penaltyCount - 1))), 3);
  }

  if (isCorrect) {
    var ratio = Math.max(0, Math.min(1, Number(remainingMs || 0) / Math.max(1, Number(maxMs || 1))));
    if (ratio >= 0.5) {
      return roundTo_(1 + ((ratio - 0.5) * 0.5), 3);
    }
    return roundTo_(GAME_RULES.MIN_ANSWER_EFFICIENCY + ratio, 3);
  }

  return roundTo_(GAME_RULES.MIN_ANSWER_EFFICIENCY, 3);
}

function applyAttack(battleState, efficiency) {
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  var effectiveStats = calculateEffectiveStats(battleState.player.stats || BASE_PLAYER_STATS, battleState.player.effects || []);
  var attack = Number(effectiveStats.attack || BASE_PLAYER_STATS.attack);
  var damage = Math.max(0, Math.round(attack * Number(efficiency || 0)));
  var target = getFirstAliveMonster_(battleState);
  if (!target) {
    return battleState;
  }
  damage = applyFrozenBonusIfNeeded_(target, damage);
  var damageResult = dealDamageToMonster_(battleState, target, damage);
  syncPrimaryMonster_(battleState);
  battleState.lastMessage = target.name + '에게 ' + damage + ' 피해를 주었습니다.';
  battleState.lastPlayerAction = { type: ACTION_TYPES.ATTACK, value: damage, efficiency: efficiency, targetMonsterId: target.instanceId || target.monsterId };
  battleState.lastTurnEvents = battleState.lastTurnEvents || [];
  battleState.lastTurnEvents.push({
    actor: 'player',
    type: ACTION_TYPES.ATTACK,
    targetMonsterId: target.instanceId || target.monsterId,
    targetName: target.name,
    damage: damageResult.damage,
    shieldDamage: damageResult.shieldDamage,
    hpDamage: damageResult.hpDamage,
    message: battleState.lastMessage,
  });
  return battleState;
}

function applyGuard(battleState, efficiency) {
  normalizeBattleStateEffects_(battleState);
  var effectiveStats = calculateEffectiveStats(battleState.player.stats || BASE_PLAYER_STATS, battleState.player.effects || []);
  var defense = Number(effectiveStats.defense || 0);
  var shield = Math.max(0, Math.round((GAME_RULES.BASE_GUARD_SHIELD + defense) * Number(efficiency || 0)));
  battleState.player.shield = shield;
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
    var aiAllowed = !row.aiId || row.aiId === monster.aiId;
    var bossAllowed = !conditions.bossOnly || monster.type === 'boss' || monster.type === 'finalBoss';
    var hpPercent = getHpPercent_(monster);
    var hpBelowAllowed = !conditions.hpBelowPercent || hpPercent < Number(conditions.hpBelowPercent);
    var hpAboveAllowed = !conditions.hpAbovePercent || hpPercent > Number(conditions.hpAbovePercent);
    var turnAllowed = !conditions.afterTurn || Number(battleState.turn || 1) >= Number(conditions.afterTurn);
    return aiAllowed && bossAllowed && hpBelowAllowed && hpAboveAllowed && turnAllowed;
  });
  if (!candidates.length) {
    candidates = [{ actionType: ACTION_TYPES.ATTACK, probability: 100, skillId: '', intentIcon: 'sword', intentTextTemplate: '' }];
  }

  var row = pickWeightedAiRow_(candidates);
  var action = {
    actionType: row.actionType || ACTION_TYPES.ATTACK,
    skillId: row.skillId || '',
    intentIcon: row.intentIcon || 'sword',
    intentTextTemplate: row.intentTextTemplate || '',
  };
  action.intentText = buildIntentText(action, monster, battleState);
  return action;
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
  }, monster.effects || []);
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
  }, monster.effects || []);
  if (skill.type === SKILL_TYPES.DAMAGE) {
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
    applyMonsterSkillEffect_(battleState.player, skill, 'player');
    battleState.lastTurnEvents.push({ actor: 'monster', type: 'debuff', skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, damage: 0, message: monster.name + '이 ' + skill.name + ' 사용!' });
  } else if (skill.type === SKILL_TYPES.BUFF) {
    applyMonsterSkillEffect_(monster, skill, 'monster');
    battleState.lastTurnEvents.push({ actor: 'monster', type: 'buff', skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, damage: 0, message: monster.name + '이 ' + skill.name + ' 사용!' });
  } else if (skill.type === SKILL_TYPES.SHIELD) {
    var shield = Math.max(0, Math.round(Number(skill.baseValue || 0) + Number(monsterStats.defense || 0)));
    monster.shield = Number(monster.shield || 0) + shield;
    battleState.lastTurnEvents.push({ actor: 'monster', type: ACTION_TYPES.GUARD, skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, shield: shield, damage: 0, message: monster.name + '이 ' + skill.name + ' 사용!' });
  } else if (skill.type === SKILL_TYPES.HEAL) {
    var heal = Math.max(0, Math.round(Number(skill.baseValue || 0)));
    monster.currentHp = Math.min(Number(monster.maxHp || 1), Number(monster.currentHp || 0) + heal);
    battleState.lastTurnEvents.push({ actor: 'monster', type: 'heal', skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, heal: heal, damage: 0, message: monster.name + '이 ' + skill.name + ' 사용!' });
  }
  monster.intent = null;
  return battleState;
}

function applyMonsterSkillEffect_(target, skill, source) {
  var config = safeJsonParse_(skill.effectJson, {});
  applyActionPointEffectConfig_(target, config);
  if (!config.effectId || Math.random() * 100 > Number(config.chance || 100)) {
    return null;
  }
  var effect = findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', config.effectId, 600);
  return effect ? applyEffect(target, effect, { source: source, skillId: skill.skillId }) : null;
}

function dealDamageToPlayer_(battleState, damage) {
  var totalDamage = Math.max(0, Math.round(Number(damage || 0)));
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
  var totalDamage = Math.max(0, Math.round(Number(damage || 0)));
  var shieldBefore = Number(monster.shield || 0);
  var shieldDamage = Math.min(shieldBefore, totalDamage);
  var hpDamage = totalDamage - shieldDamage;
  monster.shield = Math.max(0, shieldBefore - shieldDamage);
  monster.currentHp = Math.max(0, Number(monster.currentHp || 0) - hpDamage);
  syncPrimaryMonster_(battleState);
  return { damage: totalDamage, shieldDamage: shieldDamage, hpDamage: hpDamage };
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
  return Math.max(0, Math.round(10 + Number(stats.defense || 0)));
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

function applyBossDifficultyBonus(stage, questionDifficulty) {
  return Number(questionDifficulty || GAME_RULES.MIN_DIFFICULTY) + (stage && stage.bossMonsterId ? 1 : 0);
}

function shouldUseShortQuestionInBoss(bossConfig) {
  var config = bossConfig || {};
  var chance = Math.max(0, Math.min(100, Number(config.shortQuestionChance || 0)));
  return chance > 0 && Math.random() * 100 < chance;
}

function saveRunState(runId, battleState) {
  var run = requireRun_(runId);
  var stageState = getStageState_(run);
  stageState.battle = battleState;
  return saveStageState_(runId, stageState, battleState);
}

function logAnswer(answerPayload) {
  var payload = answerPayload || {};
  var answerLog = {
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
    createdAt: new Date(),
  };

  appendRowObject_(DB_SHEETS.ANSWER_LOGS, answerLog);
  updatePlayerAnswerCache_(payload);
  return answerLog;
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
    battle: battleState,
    availableSkills: battleState ? getAvailableSkills(runState, battleState) : [],
    questionCache: battleState ? buildBattleQuestionCache_(run, stageState, battleState) : [],
    stageState: {
      otherStudentQuestionShown: !!stageState.otherStudentQuestionShown,
      fallbackEvents: stageState.fallbackEvents || [],
      reward: stageState.reward || null,
      playerGhost: stageState.playerGhost || null,
    },
  });
}

function buildQuestionView_(question, pendingAction) {
  return toClientObject_({
    actionType: pendingAction ? pendingAction.actionType : '',
    skillId: pendingAction ? pendingAction.skillId || '' : '',
    targetId: pendingAction ? pendingAction.targetId || '' : '',
    actionPointCost: pendingAction ? Number(pendingAction.actionPointCost || getActionPointCostForAction_(pendingAction.actionType, null)) : '',
    question: question,
    maxMs: pendingAction ? pendingAction.maxMs : '',
    finalDifficulty: pendingAction ? pendingAction.finalDifficulty : '',
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
    var activeEffects = getActiveEffectsForQuestion_(battleState);
    var selectedQuestions = selectQuestionCacheRows_(run.playerId, battleState.stage, stageState.otherStudentQuestionShown, getForcedQuestionCreatorId_(battleState));
    return selectedQuestions.map(function(question) {
      var baseDifficulty = applyBossDifficultyBonus(battleState.stage, Number(question.difficulty || battleState.stage.baseDifficulty));
      var finalDifficulty = calculateFinalQuestionDifficulty(baseDifficulty, activeEffects);
      var maxMs = calculateFinalQuestionTimeLimit(finalDifficulty, activeEffects);
      return {
        question: sanitizeQuestionForBattleCache_(question),
        maxMs: maxMs,
        finalDifficulty: finalDifficulty,
        isOtherPlayerQuestion: question.creatorId !== run.playerId,
        fallbackReason: '',
      };
    });
  } catch (error) {
    return [];
  }
}

function selectQuestionCacheRows_(playerId, stage, otherStudentQuestionShown, forcedCreatorId) {
  var limit = 8;
  var minDifficulty = Number(stage.minDifficulty || GAME_RULES.MIN_DIFFICULTY);
  var maxDifficulty = Number(stage.maxDifficulty || GAME_RULES.MAX_DIFFICULTY);
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
    var difficulty = Number(question.difficulty || 0);
    return difficulty >= minDifficulty && difficulty <= maxDifficulty;
  });
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
      var picked = pickRandom_(candidates);
      pushQuestion(picked);
      candidates = candidates.filter(function(candidate) {
        return candidate.questionId !== picked.questionId;
      });
    }
  }

  if (!otherStudentQuestionShown && rangedQuestions.length > 0) {
    pushQuestion(pickRandom_(rangedQuestions));
  }
  pushRandomFrom(rangedQuestions);
  pushRandomFrom(allowedQuestions);
  return selected;
}

function sanitizeQuestionForBattleCache_(question) {
  var sanitized = sanitizeQuestionForClient_(question);
  sanitized.answer = question.answer;
  sanitized.answerAliases = question.answerAliases || '[]';
  return sanitized;
}

function createPendingActionFromCachedPayload_(battleState, payload, actionType, skillId, targetId, playerId) {
  var question = findRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', payload.questionId);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  validateQuestionAllowedForBattle_(question, playerId, battleState);
  var activeEffects = getActiveEffectsForQuestion_(battleState);
  var skill = skillId ? findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', skillId, 600) : null;
  var difficultyBonus = skill ? Number(skill.difficultyBonus || 0) : 0;
  var actionPointCost = getActionPointCostForAction_(actionType, skill);
  var baseDifficulty = applyBossDifficultyBonus(battleState.stage, Number(question.difficulty || battleState.stage.baseDifficulty) + difficultyBonus);
  var finalDifficulty = calculateFinalQuestionDifficulty(baseDifficulty, activeEffects);
  return {
    actionType: actionType,
    skillId: skillId || payload.skillId || '',
    targetId: targetId || payload.targetId || '',
    actionPointCost: actionPointCost,
    questionId: question.questionId,
    question: sanitizeQuestionForClient_(question),
    issuedAt: new Date().getTime() - Math.max(0, Number(payload.elapsedMs || 0)),
    maxMs: calculateFinalQuestionTimeLimit(finalDifficulty, activeEffects),
    finalDifficulty: finalDifficulty,
    isOtherPlayerQuestion: question.creatorId !== playerId,
    fallbackReason: payload.fallbackReason || '',
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

function validateQuestionAllowedForBattle_(question, playerId, battleState) {
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
}

function markCachedQuestionShown_(stageState, pendingAction) {
  if (pendingAction && pendingAction.isOtherPlayerQuestion) {
    stageState.otherStudentQuestionShown = true;
  }
}

function pickQuestion_(playerId, stage, otherStudentQuestionShown, preferredQuestionType, forcedCreatorId) {
  var minDifficulty = Number(stage.minDifficulty || GAME_RULES.MIN_DIFFICULTY);
  var maxDifficulty = Number(stage.maxDifficulty || GAME_RULES.MAX_DIFFICULTY);
  var approvedQuestions = readTableCached_(DB_SHEETS.QUESTIONS, 120).filter(function(question) {
    return question.status === STATUS.QUESTION_APPROVED;
  });
  var preferredQuestions = preferredQuestionType ? approvedQuestions.filter(function(question) {
    return question.type === preferredQuestionType;
  }) : [];
  var questionPool = (preferredQuestions.length ? preferredQuestions : approvedQuestions).filter(function(question) {
    if (question.creatorId === playerId) {
      return false;
    }
    return !forcedCreatorId || question.creatorId === forcedCreatorId;
  });
  var rangedQuestions = questionPool.filter(function(question) {
    var difficulty = Number(question.difficulty || 0);
    return difficulty >= minDifficulty && difficulty <= maxDifficulty;
  });

  if (rangedQuestions.length > 0) {
    return questionPickResult_(pickRandom_(rangedQuestions), true, '');
  }
  if (questionPool.length > 0) {
    return questionPickResult_(pickRandom_(questionPool), true, 'noQuestionInDifficultyRange');
  }

  throw new Error('No approved question is available from another player.');
}

function questionPickResult_(question, isOtherPlayerQuestion, fallbackReason) {
  return {
    question: question,
    isOtherPlayerQuestion: !!isOtherPlayerQuestion,
    fallbackReason: fallbackReason || '',
  };
}

function sanitizeQuestionForClient_(question) {
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
  };
}

function saveStageState_(runId, stageState, battleState) {
  normalizeBattleStateEffects_(battleState);
  var patch = {
    currentHp: battleState.player.hp,
    currentShield: battleState.player.shield,
    statsJson: safeJsonStringify_(battleState.player.stats),
    stageStateJson: safeJsonStringify_(stageState),
    updatedAt: new Date(),
  };

  if (battleState.status === STATUS.BATTLE_DEFEAT) {
    patch.status = STATUS.RUN_FAILED;
    patch.endedAt = new Date();
    createPlayerGhostForDefeat_(runId, battleState);
  }

  return updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, patch);
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
    monsters.push(buildBattleMonster_(findCachedRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', stage.bossMonsterId, 600), monsters.length));
    return monsters.slice(0, 3);
  }

  var group = findCachedRowByKey_(DB_SHEETS.MONSTER_GROUPS, 'monsterGroupId', stage.monsterGroupId, 600);
  if (!group) {
    throw new Error('몬스터 그룹을 찾을 수 없습니다: ' + stage.monsterGroupId);
  }

  var monsterIds = safeJsonParse_(group.monsterIds, []);
  var weights = safeJsonParse_(group.weights, []);
  var monsterOptions = monsterIds.map(function(monsterId, index) {
    var monster = findCachedRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', monsterId, 600);
    return monster ? { monster: monster, weight: Number(weights[index] || 0) } : null;
  }).filter(function(option) {
    return !!option;
  });
  if (!monsterOptions.length) {
    throw new Error('몬스터 그룹에 사용 가능한 몬스터가 없습니다: ' + stage.monsterGroupId);
  }

  var monsterCount = Math.min(3, Math.max(1, Math.ceil(Number(stage.floor || 1) / 2)));
  for (var i = monsters.length; i < monsterCount; i += 1) {
    var selectedOption = pickWeighted_(monsterOptions, monsterOptions.map(function(option) { return option.weight; }));
    monsters.push(buildBattleMonster_(selectedOption.monster, i));
  }
  return monsters;
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
    monster.buffs = monster.buffs || [];
    monster.debuffs = monster.debuffs || [];
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
    var monsterIds = safeJsonParse_(group && group.monsterIds, []).filter(function(monsterId) {
      return monsterId && monsterId !== 'monster_training_dummy';
    });
    for (var i = 0; i < monsterIds.length; i += 1) {
      var groupedMonster = findCachedRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', monsterIds[i], 600);
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

function areAllMonstersDefeated_(battleState) {
  normalizeBattleMonsters_(battleState);
  return getAliveMonsters_(battleState).length === 0;
}

function requireRun_(runId) {
  var run = findRowByKey_(DB_SHEETS.RUNS, 'runId', runId);
  if (!run) {
    throw new Error('런을 찾을 수 없습니다: ' + runId);
  }
  return run;
}

function getRunWithStageState_(runId) {
  return requireRun_(runId);
}

function getStageState_(run) {
  return safeJsonParse_(run.stageStateJson, {
    stageId: buildStageId_(run.currentFloor, run.currentStage),
    otherStudentQuestionShown: false,
    fallbackEvents: [],
  });
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
  if (actionType === ACTION_TYPES.ATTACK || actionType === ACTION_TYPES.GUARD) {
    return actionType;
  }
  throw new Error('지원하지 않는 행동입니다.');
}

function buildStageId_(floor, stage) {
  return 'floor_' + Number(floor || 1) + '_stage_' + Number(stage || 1);
}

function getEffectFlatBonus_(activeEffects, statKey) {
  return (activeEffects || []).reduce(function(total, effect) {
    if (effect.statKey === statKey && effect.effectType === EFFECT_TYPES.FLAT) {
      return total + Number(effect.value || 0);
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
