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

function startBattle(runId) {
  var run = requireRun_(runId);
  var stageState = getStageState_(run);
  var stage = loadStage(stageState.stageId || buildStageId_(run.currentFloor, run.currentStage));
  var monsters = createMonstersForStage_(stage);
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
      stats: stats,
      effects: [],
    },
    monsters: monsters,
    monster: monsters[0],
    pendingAction: null,
    lastMessage: '전투가 시작되었습니다.',
    lastTurnEvents: [],
    skillUseCounts: {},
  };
  decideMonsterIntents(battleState);

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
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  if (hasEffect_(battleState.player, 'debuff_stun') || hasEffect_(battleState.player, 'debuff_freeze')) {
    throw new Error('행동할 수 없는 상태입니다.');
  }
  if (battleState.pendingAction) {
    return buildQuestionView_(battleState.pendingAction.question, battleState.pendingAction);
  }

  battleState.player.shield = 0;
  var activeEffects = getActiveEffectsForQuestion_(battleState);
  var preferredQuestionType = shouldUseShortQuestionInBoss(battleState.stage.bossConfig) ? QUESTION_TYPES.SHORT_ANSWER : '';
  var questionResult = pickQuestion_(playerId, battleState.stage, stageState.otherStudentQuestionShown, preferredQuestionType);
  var baseDifficulty = applyBossDifficultyBonus(battleState.stage, Number(questionResult.question.difficulty || battleState.stage.baseDifficulty) + Number(difficultyBonus || 0));
  var finalDifficulty = calculateFinalQuestionDifficulty(baseDifficulty, activeEffects);
  var maxMs = calculateFinalQuestionTimeLimit(finalDifficulty, activeEffects);
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
  normalizeBattleStateEffects_(battleState);
  var pendingAction = battleState.pendingAction;
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
  } else {
    applyMonsterTurn(battleState);
  }
  tickEffectsAtTurnEnd(battleState);

  battleState.pendingAction = null;
  battleState.turn += 1;
  if (battleState.status === STATUS.BATTLE_ACTIVE) {
    decideMonsterIntents(battleState);
  }
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
  if (isCorrect) {
    var ratio = Math.max(0, Math.min(1, Number(remainingMs || 0) / Math.max(1, Number(maxMs || 1))));
    return roundTo_(GAME_RULES.MIN_ANSWER_EFFICIENCY + 0.75 * ratio, 3);
  }

  var penaltyCount = Math.max(0, Number(wrongCountAfterTimeout || 0));
  return roundTo_(Math.max(0, GAME_RULES.MIN_ANSWER_EFFICIENCY - (GAME_RULES.EXTRA_WRONG_EFFICIENCY_PENALTY * penaltyCount)), 3);
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
  var aiRows = readTableCached_(DB_SHEETS.MONSTER_AI, 600);
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
    candidates = [{ actionType: ACTION_TYPES.ATTACK, probability: 100, skillId: '', intentIcon: '???', intentTextTemplate: '' }];
  }

  var row = pickWeightedAiRow_(candidates);
  var action = {
    actionType: row.actionType || ACTION_TYPES.ATTACK,
    skillId: row.skillId || '',
    intentIcon: row.intentIcon || '???',
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
    return '???';
  }
  if (action.actionType === ACTION_TYPES.ATTACK) {
    return '예상 피해 ' + Math.max(0, Math.round(Number(monsterStats.attack || 0)));
  }
  if (action.actionType === ACTION_TYPES.GUARD || action.actionType === 'shield') {
    return '예상 방어막 ' + calculateMonsterShieldValue_(monster);
  }
  if (action.actionType === ACTION_TYPES.SKILL && action.skillId) {
    var skill = findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', action.skillId, 600);
    if (!skill) {
      return '???';
    }
    var label = skill.name || '스킬';
    if (skill.type === SKILL_TYPES.DAMAGE) {
      return label + ' / 예상 피해 ' + Math.max(0, Math.round(Number(skill.baseValue || 0) + Number(monsterStats.attack || 0)));
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
      return label + ' / 예상 방어막 ' + Math.max(0, Math.round(Number(skill.baseValue || 0) + Number(monsterStats.defense || 0)));
    }
    if (skill.type === SKILL_TYPES.HEAL) {
      return label + ' / 예상 회복 ' + Math.max(0, Math.round(Number(skill.baseValue || 0)));
    }
  }
  return action.intentTextTemplate || '???';
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
    message: monster.name + '??怨듦꺽!',
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
    message: monster.name + '??諛⑹뼱?먯꽭瑜?痍⑺뻽?듬땲??',
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
      message: monster.name + '??' + skill.name + '?ъ슜!',
    });
  } else if (skill.type === SKILL_TYPES.DEBUFF) {
    applyMonsterSkillEffect_(battleState.player, skill, 'player');
    battleState.lastTurnEvents.push({ actor: 'monster', type: 'debuff', skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, damage: 0, message: monster.name + '??' + skill.name + '?ъ슜!' });
  } else if (skill.type === SKILL_TYPES.BUFF) {
    applyMonsterSkillEffect_(monster, skill, 'monster');
    battleState.lastTurnEvents.push({ actor: 'monster', type: 'buff', skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, damage: 0, message: monster.name + '??' + skill.name + '?ъ슜!' });
  } else if (skill.type === SKILL_TYPES.SHIELD) {
    var shield = Math.max(0, Math.round(Number(skill.baseValue || 0) + Number(monsterStats.defense || 0)));
    monster.shield = Number(monster.shield || 0) + shield;
    battleState.lastTurnEvents.push({ actor: 'monster', type: ACTION_TYPES.GUARD, skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, shield: shield, damage: 0, message: monster.name + '??' + skill.name + '?ъ슜!' });
  } else if (skill.type === SKILL_TYPES.HEAL) {
    var heal = Math.max(0, Math.round(Number(skill.baseValue || 0)));
    monster.currentHp = Math.min(Number(monster.maxHp || 1), Number(monster.currentHp || 0) + heal);
    battleState.lastTurnEvents.push({ actor: 'monster', type: 'heal', skillId: skill.skillId, monsterId: monster.instanceId || monster.monsterId, monsterName: monster.name, heal: heal, damage: 0, message: monster.name + '??' + skill.name + '?ъ슜!' });
  }
  monster.intent = null;
  return battleState;
}

function applyMonsterSkillEffect_(target, skill, source) {
  var config = safeJsonParse_(skill.effectJson, {});
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
  }
  var runState = buildRunState_(run);
  return toClientObject_({
    runId: run.runId,
    playerId: run.playerId,
    currency: Number(run.currency || 0),
    battle: battleState,
    availableSkills: battleState ? getAvailableSkills(runState, battleState) : [],
    stageState: {
      otherStudentQuestionShown: !!stageState.otherStudentQuestionShown,
      fallbackEvents: stageState.fallbackEvents || [],
      reward: stageState.reward || null,
    },
  });
}

function buildQuestionView_(question, pendingAction) {
  return toClientObject_({
    actionType: pendingAction ? pendingAction.actionType : '',
    skillId: pendingAction ? pendingAction.skillId || '' : '',
    targetId: pendingAction ? pendingAction.targetId || '' : '',
    question: question,
    maxMs: pendingAction ? pendingAction.maxMs : '',
    finalDifficulty: pendingAction ? pendingAction.finalDifficulty : '',
    isOtherPlayerQuestion: pendingAction ? pendingAction.isOtherPlayerQuestion : false,
    fallbackReason: pendingAction ? pendingAction.fallbackReason : '',
  });
}

function pickQuestion_(playerId, stage, otherStudentQuestionShown, preferredQuestionType) {
  var minDifficulty = Number(stage.minDifficulty || GAME_RULES.MIN_DIFFICULTY);
  var maxDifficulty = Number(stage.maxDifficulty || GAME_RULES.MAX_DIFFICULTY);
  var approvedQuestions = readTableCached_(DB_SHEETS.QUESTIONS, 120).filter(function(question) {
    return question.status === STATUS.QUESTION_APPROVED;
  });
  var preferredQuestions = preferredQuestionType ? approvedQuestions.filter(function(question) {
    return question.type === preferredQuestionType;
  }) : [];
  var questionPool = preferredQuestions.length ? preferredQuestions : approvedQuestions;
  var rangedQuestions = questionPool.filter(function(question) {
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

  var approvedOtherQuestions = questionPool.filter(function(question) {
    return question.creatorId !== playerId;
  });
  if (approvedOtherQuestions.length > 0) {
    return questionPickResult_(pickRandom_(approvedOtherQuestions), true, 'noQuestionInDifficultyRange');
  }
  if (questionPool.length > 0) {
    var approvedFallback = pickRandom_(questionPool);
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
  }

  return updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, patch);
}

function createMonstersForStage_(stage) {
  if (stage.bossMonsterId) {
    return [buildBattleMonster_(findCachedRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', stage.bossMonsterId, 600), 0)];
  }

  var group = findCachedRowByKey_(DB_SHEETS.MONSTER_GROUPS, 'monsterGroupId', stage.monsterGroupId, 600);
  if (!group) {
    throw new Error('몬스터 그룹을 찾을 수 없습니다: ' + stage.monsterGroupId);
  }

  var monsterIds = safeJsonParse_(group.monsterIds, []);
  var weights = safeJsonParse_(group.weights, []);
  var monsterCount = Math.min(3, Math.max(1, Math.ceil(Number(stage.floor || 1) / 2)));
  var monsters = [];
  for (var i = 0; i < monsterCount; i += 1) {
    var selectedMonsterId = pickWeighted_(monsterIds, weights);
    monsters.push(buildBattleMonster_(findCachedRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', selectedMonsterId, 600), i));
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
    imageKey: monster.imageKey,
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
