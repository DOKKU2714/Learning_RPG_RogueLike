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
  var stage = findRowByKey_(DB_SHEETS.STAGES, 'stageId', stageId);
  if (!stage) {
    throw new Error('스테이지를 찾을 수 없습니다: ' + stageId);
  }
  return stage;
}

function startBattle(runId) {
  var run = requireRun_(runId);
  var stageState = getStageState_(run);
  var stage = loadStage(stageState.stageId || buildStageId_(run.currentFloor, run.currentStage));
  var monster = createMonsterForStage_(stage);
  var stats = safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS));
  var battleState = {
    battleId: generateId_('battle'),
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
    },
    player: {
      hp: Number(run.currentHp || stats.hp),
      maxHp: Number(stats.hp),
      shield: Number(run.currentShield || 0),
      stats: stats,
    },
    monster: monster,
    pendingAction: null,
    lastMessage: '전투가 시작되었습니다.',
  };

  stageState.battle = battleState;
  stageState.stageId = stage.stageId;
  stageState.otherStudentQuestionShown = !!stageState.otherStudentQuestionShown;
  saveRunState(runId, battleState);
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
  if (battleState.pendingAction) {
    return buildQuestionView_(battleState.pendingAction.question, battleState.pendingAction);
  }

  battleState.player.shield = 0;
  var questionResult = pickQuestion_(playerId, battleState.stage, stageState.otherStudentQuestionShown);
  var finalDifficulty = calculateFinalQuestionDifficulty(Number(questionResult.question.difficulty || battleState.stage.baseDifficulty) + Number(difficultyBonus || 0), []);
  var maxMs = calculateQuestionTimeLimit(finalDifficulty, []);
  var pendingAction = {
    actionType: normalizedAction,
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
  var pendingAction = battleState.pendingAction;
  if (!pendingAction || pendingAction.questionId !== payload.questionId) {
    throw new Error('풀이 중인 문제가 없습니다.');
  }

  var question = findRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', pendingAction.questionId);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  var elapsedMs = Math.max(0, Number(payload.elapsedMs || 0));
  var maxMs = Number(pendingAction.maxMs || calculateQuestionTimeLimit(pendingAction.finalDifficulty, []));
  var remainingMs = Math.max(0, maxMs - elapsedMs);
  var isCorrect = isCorrectAnswer_(question, payload.selectedAnswer, payload.selectedChoiceIndex, payload.selectedAnswerText);
  var wrongCountAfterTimeout = Number(payload.wrongCountAfterTimeout || 0);
  var efficiency = calculateEfficiency(isCorrect, remainingMs, maxMs, wrongCountAfterTimeout);

  if (pendingAction.actionType === ACTION_TYPES.ATTACK) {
    applyAttack(battleState, efficiency);
  } else {
    applyGuard(battleState, efficiency);
  }

  if (battleState.monster.currentHp <= 0) {
    battleState.status = STATUS.BATTLE_VICTORY;
    battleState.lastMessage = '몬스터를 처치했습니다.';
    logBattleEvent_(run, STATUS.BATTLE_VICTORY, { battleId: battleState.battleId });
  } else {
    applyMonsterTurn(battleState);
  }

  battleState.pendingAction = null;
  battleState.turn += 1;
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
  var finalDifficulty = clampDifficulty_(Number(difficulty || GAME_RULES.MIN_DIFFICULTY));
  var extraSeconds = getEffectFlatBonus_(activeEffects, STAT_KEYS.QUESTION_TIME);
  var seconds = GAME_RULES.BASE_QUESTION_TIME_SEC + ((finalDifficulty - 1) * GAME_RULES.QUESTION_TIME_PER_DIFFICULTY_SEC) + extraSeconds;
  return Math.max(1000, seconds * 1000);
}

function calculateFinalQuestionDifficulty(baseDifficulty, activeEffects) {
  var difficultyBonus = getEffectFlatBonus_(activeEffects, STAT_KEYS.QUESTION_DIFFICULTY);
  return clampDifficulty_(Number(baseDifficulty || GAME_RULES.MIN_DIFFICULTY) + difficultyBonus);
}

function calculateEfficiency(isCorrect, remainingMs, maxMs, wrongCountAfterTimeout) {
  if (isCorrect) {
    var ratio = Math.max(0, Math.min(1, Number(remainingMs || 0) / Math.max(1, Number(maxMs || 1))));
    return roundTo_(GAME_RULES.MIN_ANSWER_EFFICIENCY + 0.75 * ratio, 3);
  }

  var penaltyCount = Math.max(0, Number(wrongCountAfterTimeout || 0));
  return roundTo_(Math.max(0, GAME_RULES.MIN_ANSWER_EFFICIENCY - (GAME_RULES.EXTRA_WRONG_EFFICIENCY_PENALTY * penaltyCount)), 3);
}

function applyAttack(battleState, efficiency) {
  var attack = Number(battleState.player.stats.attack || BASE_PLAYER_STATS.attack);
  var damage = Math.max(0, Math.round(attack * Number(efficiency || 0)));
  battleState.monster.currentHp = Math.max(0, Number(battleState.monster.currentHp) - damage);
  battleState.lastMessage = '공격으로 ' + damage + ' 피해를 주었습니다.';
  battleState.lastPlayerAction = { type: ACTION_TYPES.ATTACK, value: damage, efficiency: efficiency };
  return battleState;
}

function applyGuard(battleState, efficiency) {
  var defense = Number(battleState.player.stats.defense || 0);
  var shield = Math.max(0, Math.round((GAME_RULES.BASE_GUARD_SHIELD + defense) * Number(efficiency || 0)));
  battleState.player.shield = shield;
  battleState.lastMessage = '수비로 방어막 ' + shield + '을 만들었습니다.';
  battleState.lastPlayerAction = { type: ACTION_TYPES.GUARD, value: shield, efficiency: efficiency };
  return battleState;
}

function applyMonsterTurn(battleState) {
  var damage = Math.max(0, Math.round(Number(battleState.monster.attack || 0)));
  var shieldBefore = Number(battleState.player.shield || 0);
  var shieldDamage = Math.min(shieldBefore, damage);
  var hpDamage = damage - shieldDamage;
  battleState.player.shield = Math.max(0, shieldBefore - shieldDamage);
  battleState.player.hp = Math.max(0, Number(battleState.player.hp || 0) - hpDamage);
  battleState.lastMonsterAction = { type: ACTION_TYPES.ATTACK, damage: damage, shieldDamage: shieldDamage, hpDamage: hpDamage };

  if (battleState.player.hp <= 0) {
    battleState.status = STATUS.BATTLE_DEFEAT;
    battleState.lastMessage += ' 몬스터의 공격으로 쓰러졌습니다.';
  } else {
    battleState.lastMessage += ' 몬스터가 ' + damage + ' 공격을 했습니다.';
  }

  return battleState;
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
  return answerLog;
}

function updateQuestionStats(questionId, isCorrect) {
  var question = findRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', questionId);
  if (!question) {
    return null;
  }

  return updateRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', questionId, {
    correctCount: Number(question.correctCount || 0) + (isCorrect ? 1 : 0),
    totalCount: Number(question.totalCount || 0) + 1,
    updatedAt: new Date(),
  });
}

function buildBattleView_(run, stageState) {
  var battleState = stageState.battle;
  return toClientObject_({
    runId: run.runId,
    playerId: run.playerId,
    battle: battleState,
    stageState: {
      otherStudentQuestionShown: !!stageState.otherStudentQuestionShown,
      fallbackEvents: stageState.fallbackEvents || [],
    },
  });
}

function buildQuestionView_(question, pendingAction) {
  return toClientObject_({
    actionType: pendingAction ? pendingAction.actionType : '',
    question: question,
    maxMs: pendingAction ? pendingAction.maxMs : '',
    finalDifficulty: pendingAction ? pendingAction.finalDifficulty : '',
    isOtherPlayerQuestion: pendingAction ? pendingAction.isOtherPlayerQuestion : false,
    fallbackReason: pendingAction ? pendingAction.fallbackReason : '',
  });
}

function pickQuestion_(playerId, stage, otherStudentQuestionShown) {
  var minDifficulty = Number(stage.minDifficulty || GAME_RULES.MIN_DIFFICULTY);
  var maxDifficulty = Number(stage.maxDifficulty || GAME_RULES.MAX_DIFFICULTY);
  var approvedQuestions = readTable_(DB_SHEETS.QUESTIONS).filter(function(question) {
    return question.status === STATUS.QUESTION_APPROVED;
  });
  var rangedQuestions = approvedQuestions.filter(function(question) {
    var difficulty = Number(question.difficulty || 0);
    return difficulty >= minDifficulty && difficulty <= maxDifficulty;
  });
  var rangedOtherQuestions = rangedQuestions.filter(function(question) {
    return question.creatorId !== playerId;
  });

  if (!otherStudentQuestionShown && rangedOtherQuestions.length > 0) {
    return questionPickResult_(pickRandom_(rangedOtherQuestions), true, '');
  }
  if (rangedOtherQuestions.length > 0) {
    return questionPickResult_(pickRandom_(rangedOtherQuestions), true, '');
  }
  if (rangedQuestions.length > 0) {
    var rangedFallback = pickRandom_(rangedQuestions);
    return questionPickResult_(rangedFallback, rangedFallback.creatorId !== playerId, 'difficultyRangeNoOtherQuestion');
  }

  var approvedOtherQuestions = approvedQuestions.filter(function(question) {
    return question.creatorId !== playerId;
  });
  if (approvedOtherQuestions.length > 0) {
    return questionPickResult_(pickRandom_(approvedOtherQuestions), true, 'noQuestionInDifficultyRange');
  }
  if (approvedQuestions.length > 0) {
    var approvedFallback = pickRandom_(approvedQuestions);
    return questionPickResult_(approvedFallback, approvedFallback.creatorId !== playerId, 'approvedQuestionFallback');
  }

  throw new Error('승인된 문제가 없습니다. 선생님이 문제를 승인한 뒤 시작해 주세요.');
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
  }

  return updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, patch);
}

function createMonsterForStage_(stage) {
  if (stage.bossMonsterId) {
    return buildBattleMonster_(findRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', stage.bossMonsterId));
  }

  var group = findRowByKey_(DB_SHEETS.MONSTER_GROUPS, 'monsterGroupId', stage.monsterGroupId);
  if (!group) {
    throw new Error('몬스터 그룹을 찾을 수 없습니다: ' + stage.monsterGroupId);
  }

  var monsterIds = safeJsonParse_(group.monsterIds, []);
  var weights = safeJsonParse_(group.weights, []);
  var selectedMonsterId = pickWeighted_(monsterIds, weights);
  return buildBattleMonster_(findRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', selectedMonsterId));
}

function buildBattleMonster_(monster) {
  if (!monster) {
    throw new Error('몬스터를 찾을 수 없습니다.');
  }

  return {
    monsterId: monster.monsterId,
    name: monster.name,
    type: monster.type,
    imageKey: monster.imageKey,
    currentHp: Number(monster.hp),
    maxHp: Number(monster.hp),
    attack: Number(monster.attack),
    defense: Number(monster.defense || 0),
  };
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
