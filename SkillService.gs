function getAvailableSkills(runState, battleState) {
  var ownedSkills = normalizeOwnedSkills_(runState.skills || safeJsonParse_(runState.skillsJson, []));
  var skillRows = readTableCached_(DB_SHEETS.SKILLS, 600);
  return ownedSkills.map(function(ownedSkill) {
    var skill = skillRows.filter(function(row) {
      return row.skillId === ownedSkill.skillId;
    })[0];
    if (!skill) {
      return null;
    }

    var hydrated = hydrateSkill_(skill, ownedSkill.level);
    var reason = getSkillUnavailableReason(hydrated, runState, battleState);
    var actionPointCost = getActionPointCostForAction_(ACTION_TYPES.SKILL, hydrated, battleState);
    var unavailableReasonType = getSkillUnavailableReasonType_(hydrated, runState, battleState, reason, actionPointCost);
    return {
      skillId: hydrated.skillId,
      name: hydrated.name,
      type: hydrated.type,
      target: hydrated.target,
      level: hydrated.level,
      baseValue: Number(hydrated.baseValue || 0),
      cooldown: hydrated.cooldown || '',
      conditionJson: hydrated.conditionJson || '{}',
      cooldownText: buildSkillCooldownText_(hydrated),
      useLimitText: buildSkillUseLimitText_(hydrated, battleState),
      difficultyBonus: Number(hydrated.difficultyBonus || 0),
      actionPointCost: actionPointCost,
      baseActionPointCost: hydrated.actionPointCost,
      rarity: hydrated.rarity,
      rarityLabel: getRarityLabel_(hydrated.rarity),
      tags: hydrated.tags,
      description: hydrated.description,
      effectJson: hydrated.effectJson || '',
      upgradeJson: hydrated.upgradeJson || '{}',
      effectDetails: buildSkillEffectDetails_(hydrated),
      clientEffects: buildClientSkillEffects_(hydrated),
      attackEffect: hydrated.attackEffect || '',
      previewText: buildSkillPreviewText_(hydrated, battleState),
      available: !reason,
      unavailableReason: reason,
      unavailableReasonType: unavailableReasonType,
    };
  }).filter(Boolean);
}

function getSkillUnavailableReasonType_(skill, runState, battleState, reason, actionPointCost) {
  if (!reason || !battleState || !battleState.player || hasEnoughActionPoint_(battleState, actionPointCost)) {
    return '';
  }
  var previousActionPoint = battleState.player.currentActionPoint;
  battleState.player.currentActionPoint = Math.max(Number(previousActionPoint || 0), Number(actionPointCost || 0));
  var reasonWithEnoughActionPoint = getSkillUnavailableReason(skill, runState, battleState);
  battleState.player.currentActionPoint = previousActionPoint;
  normalizePlayerActionPoints_(battleState, false);
  return reasonWithEnoughActionPoint ? '' : 'actionPoint';
}

function buildClientSkillEffects_(skill) {
  var rule = getSkillExecutionRule_(skill);
  var context = buildSkillFormulaContext_({player:{stats:getConfiguredBasePlayerStats_(),effects:[]},monsters:[]},skill,null,1);
  var effects = [];
  if (rule.effectId) {
    effects.push(rule);
  }
  if (Array.isArray(rule.applyEffects)) {
    effects = effects.concat(rule.applyEffects);
  }
  if (rule.efficiencyBonus && Array.isArray(rule.efficiencyBonus.applyEffects)) {
    effects = effects.concat(rule.efficiencyBonus.applyEffects);
  }
  effects=effects.concat((rule.actions || []).concat(rule.combat && rule.combat.onEachHit || []).filter(function(a){return a.operation==='applyEffect';}));
  return effects.map(function(effectRule) {
    var effect = effectRule.effectId ? findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effectRule.effectId, 600) : null;
    if (!effect) {
      return null;
    }
    var value = effectRule.valueFormula !== undefined ? evaluateSkillFormula_(effectRule.valueFormula,context,null,skill)
      : (effectRule.value !== undefined ? Number(effectRule.value || 0) : Number(effect.value || 0));
    if (effectRule.value === undefined && effect.effectType === EFFECT_TYPES.FLAT) {
      value += getSkillUpgradeValue(skill, effect.category === EFFECT_CATEGORIES.BUFF ? 'buffValue' : 'effect');
    }
    var chance = effectRule.chanceFormula !== undefined ? evaluateSkillFormula_(effectRule.chanceFormula,context,null,skill)
      : (effectRule.chance !== undefined ? Number(effectRule.chance || 0) : Number(rule.chance !== undefined ? rule.chance : 100));
    if (effect.category === EFFECT_CATEGORIES.DEBUFF) {
      chance += getSkillUpgradeValue(skill, 'debuffChance');
    } else {
      chance += getSkillUpgradeValue(skill, 'chance');
    }
    return {
      target: effectRule.target || (skill.target === 'self' ? 'self' : 'enemy'),
      effectId: effect.effectId || '',
      name: effect.name || '',
      category: effect.category || '',
      statKey: effect.statKey || '',
      effectType: effect.effectType || '',
      value: value,
      durationType: effectRule.durationType || effect.durationType || '',
      durationTurns: effectRule.durationTurns !== undefined ? effectRule.durationTurns : effect.durationTurns,
      stackable: effectRule.stackable !== undefined ? isTruthy_(effectRule.stackable) : isTruthy_(effect.stackable),
      maxStacks: Number(effectRule.maxStacks || effect.maxStacks || 1),
      triggerTiming: effect.triggerTiming || '',
      description: effect.description || '',
      chance: Math.min(100, Math.max(0, chance)),
    };
  }).filter(Boolean);
}

function buildSkillEffectDetails_(skill) {
  var rule = getSkillExecutionRule_(skill);
  var previewBattleState = {
    player: { stats: getConfiguredBasePlayerStats_(), effects: [] },
    monsters: [],
    usedSkillCountByTagThisBattle: {},
    usedSkillCountByTagThisTurn: {},
  };
  var context = buildSkillFormulaContext_(previewBattleState, skill, null, 1);
  var effects = [];
  if (rule.effectId) {
    effects.push(rule);
  }
  if (Array.isArray(rule.applyEffects)) {
    effects = effects.concat(rule.applyEffects);
  }
  if (rule.efficiencyBonus && Array.isArray(rule.efficiencyBonus.applyEffects)) {
    effects = effects.concat(rule.efficiencyBonus.applyEffects);
  }
  effects=effects.concat((rule.actions || []).concat(rule.combat && rule.combat.onEachHit || []).filter(function(a){return a.operation==='applyEffect';}));
  return effects.map(function(effectRule) {
    var effect = effectRule.effectId ? findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effectRule.effectId, 600) : null;
    var value = effectRule.valueFormula !== undefined && effectRule.valueFormula !== null && effectRule.valueFormula !== ''
      ? evaluateSkillFormula_(effectRule.valueFormula, context, null, skill)
      : (effectRule.value !== undefined ? Number(effectRule.value || 0) : Number(effect && effect.value || 0));
    if (effect && effect.effectType === EFFECT_TYPES.FLAT) {
      value += getSkillUpgradeValue(skill, effect.category === EFFECT_CATEGORIES.BUFF ? 'buffValue' : 'effect');
    }
    var category = effectRule.category || effect && effect.category || '';
    var chance = effectRule.chanceFormula !== undefined ? evaluateSkillFormula_(effectRule.chanceFormula,context,null,skill)
      : Number(effectRule.chance !== undefined ? effectRule.chance : 100);
    chance += String(category).toLowerCase() === String(EFFECT_CATEGORIES.DEBUFF).toLowerCase()
      ? getSkillUpgradeValue(skill, 'debuffChance')
      : getSkillUpgradeValue(skill, 'chance');
    return {
      effectId: effectRule.effectId || '',
      name: effectRule.name || effectRule.effectName || effect && effect.name || effectRule.effectId || '',
      value: value,
      effectType: effectRule.effectType || effect && effect.effectType || '',
      category: category,
      chance: Math.min(100, Math.max(0, chance)),
      durationTurns: effectRule.durationTurns !== undefined ? effectRule.durationTurns : effect && effect.durationTurns || '',
    };
  });
}

function canUseSkill(skill, runState, battleState) {
  return !getSkillUnavailableReason(skill, runState, battleState);
}

function getSkillUnavailableReason(skill, runState, battleState) {
  if (!skill) {
    return '보유하지 않은 스킬입니다.';
  }

  var conditions = safeJsonParse_(skill.conditionJson, {});
  var skillRule = getSkillExecutionRule_(skill);
  var player = battleState.player;
  var target = getSkillTarget_(battleState, skill, skill.targetId || conditions.targetId || '');
  var effectiveStats = calculateEffectiveStats(player.stats || {}, player.effects || []);
  normalizePlayerActionPoints_(battleState, false);

  if (hasControlEffect_(player, 'debuff_stun')) {
    return '기절 상태입니다.';
  }
  if (hasControlEffect_(player, 'debuff_freeze')) {
    return '빙결 상태입니다.';
  }
  if (hasControlEffect_(player, 'debuff_sleep')) return '수면 상태입니다.';
  if (getSharedRuleEngine_().hasActionBlock(player)) return '행동할 수 없는 상태입니다.';
  if (conditions.afterTurn && Number(battleState.turn || 1) < Number(conditions.afterTurn)) {
    return Number(conditions.afterTurn) + '턴 이후 사용할 수 있습니다.';
  }
  if (conditions.selfHpBelowPercent && getHpPercent_(player) >= Number(conditions.selfHpBelowPercent)) {
    return '체력이 ' + conditions.selfHpBelowPercent + '% 미만이어야 합니다.';
  }
  if (conditions.selfHpAbovePercent && getHpPercent_(player) <= Number(conditions.selfHpAbovePercent)) {
    return '체력이 ' + conditions.selfHpAbovePercent + '% 초과여야 합니다.';
  }
  if (target) {
    if (conditions.targetHpBelowPercent && getHpPercent_(target) >= Number(conditions.targetHpBelowPercent)) {
      return '대상 체력이 ' + conditions.targetHpBelowPercent + '% 미만이어야 합니다.';
    }
    if (conditions.targetHpAbovePercent && getHpPercent_(target) <= Number(conditions.targetHpAbovePercent)) {
      return '대상 체력이 ' + conditions.targetHpAbovePercent + '% 초과여야 합니다.';
    }
  }
  if (conditions.perStageLimit) {
    var count = getSkillUseCount_(battleState, skill.skillId);
    if (count >= Number(conditions.perStageLimit)) {
      return '이 스테이지에서 더 사용할 수 없습니다.';
    }
  }
  if (conditions.perBattleLimit) {
    var battleCount = getSkillUseCount_(battleState, skill.skillId);
    if (battleCount >= Number(conditions.perBattleLimit)) {
      return '이번 전투에서 더 이상 사용할 수 없습니다.';
    }
  }
  if (conditions.requiredStat) {
    var statKey = conditions.requiredStat.statKey || conditions.requiredStat.key;
    var minValue = Number(conditions.requiredStat.min || conditions.requiredStat.value || 0);
    if (Number(effectiveStats[statKey] || 0) < minValue) {
      return statKey + ' ' + minValue + ' 이상 필요합니다.';
    }
  }
  if (conditions.requiredEffect && !hasEffect_(player, conditions.requiredEffect)) {
    return '필요 효과가 없습니다: ' + conditions.requiredEffect;
  }
  if (Number(battleState.skillCooldowns && battleState.skillCooldowns[skill.skillId] || 0) > 0) {
    return '쿨타임 ' + Number(battleState.skillCooldowns[skill.skillId] || 0) + '턴 남았습니다.';
  }
  var ruleReason = checkSkillConditions_(skillRule, skill, battleState, target);
  if (ruleReason) {
    return ruleReason;
  }

  var actionPointCost = getActionPointCostForAction_(ACTION_TYPES.SKILL, skill, battleState);
  if (!hasEnoughActionPoint_(battleState, actionPointCost)) {
    return '행동력이 부족합니다.';
  }

  return '';
}

function isTruthy_(value) {
  return getSharedRuleEngine_().isTruthy(value);
}

function useSkill(runId, skillId, targetId, answerPayload) {
  var payload = answerPayload || {};
  var player = getCurrentPlayer_(payload.authToken);
  var run = requireRun_(runId);
  if (run.playerId !== player.playerId) {
    throw new Error('현재 플레이어의 런이 아닙니다.');
  }

  var stageState = getStageState_(run);
  var battleState = requireActiveBattle_(stageState);
  battleState.runId = battleState.runId || run.runId;
  normalizeUsedQuestionIds_(stageState, battleState);
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  normalizePlayerActionPoints_(battleState, false);

  var runState = buildRunState_(run);
  var skill = getOwnedSkillForRun_(runState, skillId);
  if (!skill) {
    throw new Error('보유하지 않은 스킬입니다.');
  }

  var reason = getSkillUnavailableReason(Object.assign({}, skill, { targetId: targetId || '' }), runState, battleState);
  if (reason) {
    throw new Error(reason);
  }

  var pendingAction = battleState.pendingAction;
  if (!pendingAction && payload.questionId) {
    pendingAction = createPendingActionFromCachedPayload_(
      stageState,
      battleState,
      payload,
      ACTION_TYPES.SKILL,
      skill.skillId,
      targetId || payload.targetId || '',
      player.playerId
    );
    pendingAction.actionPointCost = getActionPointCostForAction_(ACTION_TYPES.SKILL, skill, battleState);
    battleState.pendingAction = pendingAction;
    markQuestionUsedForRun_(stageState, battleState, pendingAction.questionId);
    markCachedQuestionShown_(stageState, pendingAction);
  }
  if (!payload.questionId) {
    if (pendingAction) {
      return buildQuestionView_(pendingAction.question, pendingAction);
    }

    var activeEffects = getActiveEffectsForQuestion_(battleState);
    var questionResult = pickQuestion_(run.playerId, battleState.stage, stageState.otherStudentQuestionShown, getForcedQuestionCreatorId_(battleState), getItemQuestionModifiers_(battleState, null), stageState.usedQuestionIds);
    var baseDifficulty = applyStageQuestionDifficultyBonus_(battleState.stage, Number(questionResult.question.difficulty || battleState.stage.baseDifficulty) + Number(skill.difficultyBonus || 0) + getSkillRuleQuestionDifficultyBonus_(skill));
    var questionModifiers = getItemQuestionModifiers_(battleState, questionResult.question);
    var finalDifficulty = calculateFinalQuestionDifficulty(baseDifficulty, activeEffects, questionModifiers);
    var maxMs = calculateFinalQuestionTimeLimitForQuestion_(finalDifficulty, activeEffects, questionResult.question, questionModifiers);
    pendingAction = {
      actionType: ACTION_TYPES.SKILL,
      skillId: skill.skillId,
      targetId: targetId || '',
      secondaryTargetId:payload.secondaryTargetId || '',
      cooldownTargetSkillId:payload.cooldownTargetSkillId || '',
      actionPointCost: getActionPointCostForAction_(ACTION_TYPES.SKILL, skill, battleState),
      questionId: questionResult.question.questionId,
      question: sanitizeQuestionForBattleCache_(questionResult.question, player.playerId),
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
        actionType: ACTION_TYPES.SKILL,
        skillId: skill.skillId,
        reason: questionResult.fallbackReason,
        createdAt: new Date().toISOString(),
      });
    }
    saveStageState_(runId, stageState, battleState);
    return buildQuestionView_(pendingAction.question, pendingAction);
  }

  if (!pendingAction || pendingAction.actionType !== ACTION_TYPES.SKILL || pendingAction.skillId !== skill.skillId || pendingAction.questionId !== payload.questionId) {
    throw new Error('풀이 중인 스킬 문제가 없습니다.');
  }

  var question = findRunQuestionById_(run, pendingAction.questionId);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  markQuestionUsedForRun_(stageState, battleState, pendingAction.questionId);
  var elapsedMs = Math.max(0, Number(payload.elapsedMs || 0));
  var maxMs = Number(pendingAction.maxMs || calculateFinalQuestionTimeLimitForQuestion_(pendingAction.finalDifficulty, getActiveEffectsForQuestion_(battleState), pendingAction.question || question, getItemQuestionModifiers_(battleState, question)));
  var remainingMs = Math.max(0, maxMs - elapsedMs);
  var gaveUp = !!payload.giveUp;
  var isCorrect = gaveUp ? false : isCorrectAnswer_(question, payload.selectedAnswer, payload.selectedChoiceIndex, payload.selectedAnswerText);
  var efficiency = gaveUp ? 0 : calculateEfficiency(isCorrect, remainingMs, maxMs, Math.max(0, Number(payload.wrongCountAfterTimeout || 0) - getSharedRuleEngine_().consumeWrongProtection(battleState, payload.wrongCountAfterTimeout)), getItemQuestionModifiers_(battleState, question), question);

  battleState.lastTurnEvents = [];
  recordExperienceQuestion_(battleState,{question:question,efficiency:efficiency,isCorrect:isCorrect,wrongCount:Number(payload.wrongCountAfterTimeout || 0)});
  consumeActionPoint_(battleState, Number(pendingAction.actionPointCost !== undefined && pendingAction.actionPointCost !== '' ? pendingAction.actionPointCost : getActionPointCostForAction_(ACTION_TYPES.SKILL, skill)));
  getSharedRuleEngine_().consumeSkillCostEffects(battleState.player, skill);
  if (gaveUp) {
    battleState.lastPlayerAction = { type: ACTION_TYPES.SKILL, skillId: skill.skillId, value: 0, efficiency: 0, gaveUp: true };
    battleState.lastMessage = '문제를 포기했습니다. 행동력만 소모했습니다.';
    battleState.lastTurnEvents.push({ actor: 'player', type: 'giveUp', skillId: skill.skillId, message: battleState.lastMessage });
  }
  if (!gaveUp) {
    tickEffectsOnPlayerAction(battleState);
    if (battleState.player.hp <= 0) {
      battleState.status = STATUS.BATTLE_DEFEAT;
      battleState.lastMessage = '지속 피해로 쓰러졌습니다.';
    }
  }
  var skillWasUsed = !gaveUp && battleState.player.hp > 0 && battleState.status === STATUS.BATTLE_ACTIVE;
  if (skillWasUsed) {
    getSharedRuleEngine_().applyPerfectAnswerItems(battleState, efficiency, false);
    setActiveMonsterScoreContext_(battleState, pendingAction.questionId, efficiency);
    processSkillTriggers_(battleState, isCorrect ? 'onCorrect' : 'onWrong', { isCorrect: isCorrect, efficiency: efficiency });
    var blockedByPenalty = processSkillFailPenaltyAfterAnswer_(battleState, skill, isCorrect);
    if (!blockedByPenalty && battleState.player.hp > 0 && battleState.status === STATUS.BATTLE_ACTIVE) {
      applySkillEffect(battleState, Object.assign({}, skill, { targetId: pendingAction.targetId || '',secondaryTargetId:pendingAction.secondaryTargetId || payload.secondaryTargetId || '',cooldownTargetSkillId:pendingAction.cooldownTargetSkillId || payload.cooldownTargetSkillId || '' }), efficiency, isCorrect);
    }
    clearActiveMonsterScoreContext_(battleState);
  }
  if (battleState.player.hp > 0 && areAllMonstersDefeated_(battleState)) {
    battleState.status = STATUS.BATTLE_VICTORY;
    battleState.lastMessage = '몬스터를 처치했습니다.';
    logBattleEvent_(run, STATUS.BATTLE_VICTORY, { battleId: battleState.battleId });
  }
  if (skillWasUsed && !shouldUseSkillRuleEngine_(getSkillExecutionRule_(skill))) {
    trackSkillTagsForUse_(battleState, skill);
  }
  if (skillWasUsed) {
    setSkillCooldownAfterUse_(battleState, skill);
    incrementSkillUseCount_(battleState, skill.skillId);
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
    actionType: ACTION_TYPES.SKILL,
    selectedAnswer: gaveUp ? '[giveUp]' : payload.selectedAnswerText || payload.selectedAnswer || '',
    isCorrect: isCorrect,
    elapsedMs: elapsedMs,
    maxTimeMs: maxMs,
    efficiency: efficiency,
    finalDifficulty: pendingAction.finalDifficulty,
    isOtherPlayerQuestion: pendingAction.isOtherPlayerQuestion,
  });
  if (battleState.status !== STATUS.BATTLE_ACTIVE) {
    flushQueuedBattleAnswerLogs_(battleState);
  }
  saveStageState_(run.runId, stageState, battleState);

  return buildBattleStateView_(requireRun_(run.runId), getStageState_(requireRun_(run.runId)));
}

function applySkillEffect(battleState, skill, efficiency, isCorrect) {
  var skillRule = getSkillExecutionRule_(skill);
  if (shouldUseSkillRuleEngine_(skillRule)) {
    return executeSkillByRule_(battleState, skill, skillRule, efficiency, isCorrect);
  }
  getSharedRuleEngine_().beginCombatAction(battleState, skill);

  normalizeBattleStateEffects_(battleState);
  var effectiveStats = calculateEffectiveStats(battleState.player.stats || {}, battleState.player.effects || []);
  var isRandomTargetSkill = isRandomEnemiesSkill_(skill);
  var target = isRandomTargetSkill ? null : getSkillTarget_(battleState, skill, skill.targetId || '');
  var value = Math.max(0, Math.round((Number(skill.baseValue || 0) + getSkillUpgradeValue(skill, 'damage') + getSkillUpgradeValue(skill, 'effect')) * Number(efficiency || 0)));
  var hitCount = Math.max(1, Number(skill.hitCount || 1));
  var events = battleState.lastTurnEvents || [];

  if (skill.type === SKILL_TYPES.DAMAGE && isAllEnemiesSkill_(skill)) {
    var areaBaseDamage = Math.max(0, Math.round((Number(skill.baseValue || 0) + getSkillUpgradeValue(skill, 'damage') + Number(effectiveStats.attack || 0)) * Number(efficiency || 0)));
    for (var areaHit = 0; areaHit < hitCount; areaHit += 1) {
      getAliveMonsters_(battleState).forEach(function(damageTarget) {
        var targetStats = calculateEffectiveStats({
          attack: damageTarget.attack,
          defense: damageTarget.defense,
          hp: damageTarget.maxHp,
          evasion: damageTarget.evasion,
          accuracy: 100,
        }, damageTarget.effects || []);
        var hit = rollHit_(effectiveStats, targetStats);
        if (!hit.hit) {
          events.push({
            actor: 'player',
            type: ACTION_TYPES.SKILL,
            skillId: skill.skillId,
            targetMonsterId: damageTarget.instanceId || damageTarget.monsterId,
            damage: 0,
            missed: true,
            hitChance: hit.chance,
            simultaneousGroupId: skill.skillId + ':allEnemies:' + areaHit,
            message: skill.name + '이 빗나갔습니다.',
          });
          return;
        }
        var critical = rollCriticalDamage_(areaBaseDamage, effectiveStats, skillRule.criticalBonus);
        var damage = applyFrozenBonusIfNeeded_(damageTarget, critical.damage);
        damage = applyOutgoingItemDamageModifiers_(battleState, damage, { actionType: ACTION_TYPES.SKILL, skill: skill });
        var damageResult = dealDamageToMonster_(battleState, damageTarget, damage, {damageKind:'direct',sourceSkillId:skill.skillId,isCritical:critical.isCritical});
        getSharedRuleEngine_().applyCriticalItemHealing(battleState, critical.isCritical, damageResult.damage);
        events.splice(Number.isInteger(damageResult.eventIndex) ? damageResult.eventIndex : events.length, 0, {
          actor: 'player',
          type: ACTION_TYPES.SKILL,
          skillId: skill.skillId,
          attackEffect: skill.attackEffect || '',
          targetMonsterId: damageTarget.instanceId || damageTarget.monsterId,
          damage: damageResult.damage,
          shieldDamage: damageResult.shieldDamage,
          hpDamage: damageResult.hpDamage,
          isCritical: critical.isCritical,
          criticalMultiplier: critical.multiplier,
          simultaneousGroupId: skill.skillId + ':allEnemies:' + areaHit,
          message: critical.isCritical
            ? skill.name + ' 치명타! ' + damageResult.damage + ' 피해!'
            : skill.name + '으로 ' + damageResult.damage + ' 피해!',
        });
      });
    }
    syncPrimaryMonster_(battleState);
    battleState.lastMessage = skill.name + '을 사용했습니다.';
    battleState.lastTurnEvents = events;
    return battleState;
  }

  if (skill.type === SKILL_TYPES.DAMAGE) {
    var baseDamage = Math.max(0, Math.round((Number(skill.baseValue || 0) + getSkillUpgradeValue(skill, 'damage') + Number(effectiveStats.attack || 0)) * Number(efficiency || 0)));
    for (var i = 0; i < hitCount; i += 1) {
      target = isRandomTargetSkill
        ? selectRandomAliveEnemy_(battleState)
        : getSkillTarget_(battleState, skill, skill.targetId || '');
      if (!target) break;
      var targetStats = calculateEffectiveStats({
        attack: target.attack,
        defense: target.defense,
        hp: target.maxHp,
        evasion: target.evasion,
        accuracy: 100,
      }, target.effects || []);
      var hit = rollHit_(effectiveStats, targetStats);
      if (!hit.hit) {
        events.push({
          actor: 'player',
          type: ACTION_TYPES.SKILL,
          skillId: skill.skillId,
          targetMonsterId: target.instanceId || target.monsterId,
          damage: 0,
          missed: true,
          hitChance: hit.chance,
          simultaneousGroupId: hitCount > 1 ? skill.skillId + ':multiHit' : '',
          message: skill.name + '이 빗나갔습니다.',
        });
        continue;
      }
      var critical = rollCriticalDamage_(baseDamage, effectiveStats, skillRule.criticalBonus);
      var damage = applyFrozenBonusIfNeeded_(target, critical.damage);
      damage = applyOutgoingItemDamageModifiers_(battleState, damage, { actionType: ACTION_TYPES.SKILL, skill: skill });
      var damageResult = dealDamageToMonster_(battleState, target, damage, {damageKind:'direct',sourceSkillId:skill.skillId,isCritical:critical.isCritical});
      getSharedRuleEngine_().applyCriticalItemHealing(battleState, critical.isCritical, damageResult.damage);
      events.splice(Number.isInteger(damageResult.eventIndex) ? damageResult.eventIndex : events.length, 0, {
        actor: 'player',
        type: ACTION_TYPES.SKILL,
        skillId: skill.skillId,
        attackEffect: skill.attackEffect || '',
        targetMonsterId: target.instanceId || target.monsterId,
        damage: damageResult.damage,
        shieldDamage: damageResult.shieldDamage,
        hpDamage: damageResult.hpDamage,
        isCritical: critical.isCritical,
        criticalMultiplier: critical.multiplier,
        simultaneousGroupId: hitCount > 1 ? skill.skillId + ':multiHit' : '',
        message: skill.name + '으로 ' + damage + ' 피해!',
      });
      events[events.length - 1].message = critical.isCritical
        ? skill.name + ' 치명타! ' + damageResult.damage + ' 피해!'
        : skill.name + '으로 ' + damageResult.damage + ' 피해!';
    }
    syncPrimaryMonster_(battleState);
    battleState.lastMessage = skill.name + '을 사용했습니다.';
  } else if (skill.type === SKILL_TYPES.SHIELD) {
    var shield = Math.max(0, Math.round((Number(skill.baseValue || 0) + Number(effectiveStats.defense || 0)) * Number(efficiency || 0)));
    if(combatShieldBlocked_(battleState.player))shield=0;
    battleState.player.shield = Number(battleState.player.shield || 0) + shield;
    events.push({ actor: 'player', type: ACTION_TYPES.GUARD, shield: shield, message: skill.name + '으로 방어막 ' + shield + ' 생성!' });
    applySkillLinkedEffect_(battleState.player, skill, 'self', battleState);
    battleState.lastMessage = skill.name + '으로 방어막을 만들었습니다.';
  } else if (skill.type === SKILL_TYPES.HEAL) {
    var heal = value;
    battleState.player.hp = Math.min(Number(battleState.player.maxHp || battleState.player.stats.hp || 1), Number(battleState.player.hp || 0) + heal);
    events.push({ actor: 'player', type: 'heal', heal: heal, message: skill.name + '으로 ' + heal + ' 회복!' });
    battleState.lastMessage = skill.name + '으로 회복했습니다.';
  } else if (skill.type === SKILL_TYPES.BUFF) {
    applySkillLinkedEffect_(battleState.player, skill, 'self', battleState);
    events.push({ actor: 'player', type: 'buff', statusSnapshot: { effects: JSON.parse(JSON.stringify(battleState.player.effects || [])) }, message: skill.name + ' 효과를 얻었습니다.' });
    battleState.lastMessage = skill.name + ' 효과를 얻었습니다.';
  } else if (skill.type === SKILL_TYPES.DEBUFF) {
    if (target) {
      var appliedDebuff = applySkillLinkedEffect_(target, skill, 'enemy', battleState);
      events.push({ actor: 'player', type: 'debuff', statusSnapshot: { effects: JSON.parse(JSON.stringify(target.effects || [])) }, targetMonsterId: target.instanceId || target.monsterId, message: target.name + '에게 ' + skill.name + ' 효과!' });
    }
    battleState.lastMessage = skill.name + '을 사용했습니다.';
  }

  battleState.lastTurnEvents = events;
  return battleState;
}

function getSkillExecutionRule_(skill) {
  var rule = safeJsonParse_(skill && skill.effectJson, {});
  if (!rule || typeof rule !== 'object' || Array.isArray(rule)) {
    return {};
  }
  var ids=rule.combat && rule.combat.effectRuleIds;
  if(ids && ids.length){
    var parameters={};
    ids.forEach(function(id){
      var effect=findCachedRowByKey_(DB_SHEETS.EFFECTS,'effectId',id,600);
      if(!effect)throw new Error('Missing combat effect: '+id);
      var rows=readTableCached_(DB_SHEETS.EFFECT_RULES,600).filter(function(r){return r.effectId===id && r.operation==='combatParameter';});
      if(!rows.length)throw new Error('Missing combat EffectRules: '+id);
      rows.forEach(function(r){
        var path=String(r.statKey).split('.'),out=parameters;
        path.forEach(function(key,i){
          if(!key || ['__proto__','constructor','prototype'].indexOf(key)>=0)throw new Error('Invalid combat parameter: '+r.statKey);
          if(i===path.length-1)out[key]=r.valueMode==='json'?JSON.parse(r.valueFormula):String(r.valueFormula);
          else out=out[key] || (out[key]={});
        });
      });
    });
    rule.combat=Object.assign({},rule.combat,{effectRules:parameters});
  }
  return rule;
}

function getSkillRuleQuestionDifficultyBonus_(skill) {
  var rule = getSkillExecutionRule_(skill);
  return Number(rule && rule.failPenalty && rule.failPenalty.increaseQuestionDifficulty || 0);
}

function shouldUseSkillRuleEngine_(rule) {
  return getSharedRuleEngine_().shouldUseSkillRuleEngine(rule);
}

function getSkillRuleEngineKeys_() {
  return getSharedRuleEngine_().getSkillRuleEngineKeys();
}

function getSupportedSkillRuleKeys_() {
  return getSharedRuleEngine_().getSupportedSkillRuleKeys();
}

function warnSkillRule_(battleState, skill, message, data) {
  var warning = {
    skillId: skill && skill.skillId || '',
    message: String(message || 'Unsupported skill rule'),
    data: data || {},
    createdAt: new Date().toISOString(),
  };
  if (battleState) {
    battleState.skillRuleWarnings = battleState.skillRuleWarnings || [];
    battleState.skillRuleWarnings.push(warning);
    if (battleState.skillRuleWarnings.length > 50) {
      battleState.skillRuleWarnings = battleState.skillRuleWarnings.slice(-50);
    }
  }
  try {
    console.warn('[SkillRuleWarning] ' + warning.skillId + ': ' + warning.message, warning.data);
  } catch (error) {}
}

function validateSkillRuleKeys_(battleState, skill, rule) {
  if (!rule || typeof rule !== 'object') {
    return;
  }
  var supported = getSupportedSkillRuleKeys_();
  Object.keys(rule).forEach(function(key) {
    if (supported.indexOf(key) === -1) {
      warnSkillRule_(battleState, skill, 'Unsupported effectJson key: ' + key, { key: key });
    }
  });
  validateSkillEfficiencyBonusRule_(battleState, skill, rule.efficiencyBonus);
}

function validateSkillEfficiencyBonusRule_(battleState, skill, efficiencyBonus) {
  if (!efficiencyBonus || typeof efficiencyBonus !== 'object') {
    return;
  }
  var supported = ['threshold', 'damageMultiplier', 'damageAdd', 'shieldMultiplier', 'shieldAdd', 'healMultiplier', 'healAdd', 'applyEffects'];
  Object.keys(efficiencyBonus).forEach(function(key) {
    if (supported.indexOf(key) === -1) {
      warnSkillRule_(battleState, skill, 'Unsupported efficiencyBonus key: ' + key, { key: key });
    }
  });
}

function executeSkillByRule_(battleState, skill, rule, efficiency, isCorrect) {
  validateSkillRuleKeys_(battleState, skill, rule);
  getSharedRuleEngine_().validateSkillRule(rule);
  getSharedRuleEngine_().validateCombatActions(rule.actions);
  var combatTarget=getSkillTarget_(battleState,skill,skill.targetId || '');
  var combatReason=checkCombatSkillConditions_(battleState,skill,rule,combatTarget);
  if(combatReason)throw new Error(combatReason);
  (rule.actions || []).forEach(function(a){if(a.operation!=='cooldownSelect')return;var choices=combatCooldownCandidates_(battleState,skill,a.tag,a.excludeCooldownSkills);if(!skill.cooldownTargetSkillId && choices.length===1)skill.cooldownTargetSkillId=choices[0].skillId;if(!choices.some(function(s){return s.skillId===skill.cooldownTargetSkillId;}))throw new Error('쿨타임을 줄일 스킬을 선택하세요.');});
  if ((rule.actions || []).some(function(action) { return action.target === 'secondary' || action.operation === 'moveStacks' || action.operation === 'copyStacks'; })) {
    var secondary = (battleState.monsters || []).filter(function(monster) { return Number(monster.currentHp) > 0 && (monster.instanceId || monster.monsterId) === skill.secondaryTargetId; })[0];
    if (!secondary) throw new Error('살아 있는 보조 대상을 선택해야 합니다.');
  }
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  normalizePlayerActionPoints_(battleState, false);
  battleState.lastTurnEvents = battleState.lastTurnEvents || [];
  getSharedRuleEngine_().beginCombatAction(battleState, skill);
  rule = prepareCombatSkill_(battleState, skill, rule);
  if (rule.consumeEffect && getSkillEffectTotal_(battleState.player, rule.consumeEffect.effectId) < Number(rule.consumeEffect.minValue || 1)) return battleState;
  if (rule.requireCondition && rule.requireCondition.requireEfficiencyAtLeast && Number(efficiency || 0) < Number(rule.requireCondition.requireEfficiencyAtLeast)) {
    battleState.lastTurnEvents.push({ actor: 'player', type: ACTION_TYPES.SKILL, skillId: skill.skillId, message: skill.name + ' 사용 조건을 만족하지 못했습니다.' });
    battleState.lastMessage = skill.name + ' 사용 조건을 만족하지 못했습니다.';
    return battleState;
  }

  var context = buildSkillFormulaContext_(battleState, skill, null, efficiency);
  applySkillActionPointModify_(battleState, skill, rule.actionPointModify, context);
  registerSkillTriggers_(battleState, skill, rule);

  var targets = selectSkillTargets_(rule, battleState, skill, skill.targetId || '');
  if (rule.requireCondition && Array.isArray(rule.requireCondition.targetEffects)) {
    targets = targets.filter(function(target) { return rule.requireCondition.targetEffects.some(function(id) { return hasEffect_(target, id); }); });
    if (!targets.length) return battleState;
  }
  if (rule.removeDebuffs) {
    battleState.player.effects = (battleState.player.effects || []).filter(function(effect) { return normalizeEffectCategory_(effect) !== 'debuff'; });
    battleState.player.buffs = []; battleState.player.debuffs = [];
    normalizeBattleStateEffects_(battleState);
    battleState.lastTurnEvents.push({actor:'player',type:'cleanse',skillId:skill.skillId,message:skill.name + '으로 모든 디버프를 해제했습니다.'});
  }
  if (rule.consumeEffect) {
    var consumed = getSkillEffectTotal_(battleState.player, rule.consumeEffect.effectId);
    var restored = Math.min(Math.max(0, Number(battleState.player.maxHp || battleState.player.stats.hp || 1) - Number(battleState.player.hp || 0)), Math.max(0, consumed * Number(rule.consumeEffect.healPerValue || 0)));
    battleState.player.hp += restored;
    battleState.player.effects = (battleState.player.effects || []).filter(function(effect) { return effect.effectId !== rule.consumeEffect.effectId; });
    battleState.player.buffs = []; battleState.player.debuffs = [];
    normalizeBattleStateEffects_(battleState);
    battleState.lastTurnEvents.push({actor:'player',type:'heal',skillId:skill.skillId,heal:restored,consumedEffectValue:consumed,message:skill.name + '으로 체력을 ' + restored + ' 회복했습니다.'});
  }
  var hitCount = Math.max(1, Math.round(evaluateSkillFormulaValue_(rule.hitCount, context, Math.max(1, Number(skill.hitCount || 1)), battleState, skill)));
  var normalizedTargetMode = normalizeSkillTargetMode_(rule.targetMode || (skill.target === 'self' ? 'self' : 'singleEnemy'));
  var randomPerHit = normalizedTargetMode === 'randomEnemies' || (normalizedTargetMode === 'randomEnemy' && hitCount > 1);
  if (randomPerHit) {
    targets = [];
    var usedRandomTargetIds = {};
    for (var randomHit = 0; randomHit < hitCount; randomHit += 1) {
      var randomTarget = selectRandomAliveEnemyAvoiding_(battleState, usedRandomTargetIds);
      if (randomTarget) {
        targets.push(randomTarget);
      }
    }
  }
  if (!targets.length && normalizedTargetMode !== 'self') {
    warnSkillRule_(battleState, skill, 'No valid skill target.', { targetMode: rule.targetMode || skill.target });
  }

  applySkillRuleCopyActions_(battleState, skill, rule, targets);
  applySkillRuleShield_(battleState, skill, rule, context, efficiency);
  applySkillRuleHeal_(battleState, skill, rule, context);
  applySkillRuleSelfDamage_(battleState, skill, rule, context);

  var criticalStats = calculateEffectiveStats(battleState.player.stats || {}, battleState.player.effects || []);
  var damageEvents = 0;
  var totalDamageDealt = 0;
  targets.forEach(function(target) {
    if (!target || target.currentHp === undefined) {
      return;
    }
    var targetHitCount = randomPerHit ? 1 : rule.hitCount === undefined ? hitCount : Math.max(0, Math.round(evaluateSkillFormula_(rule.hitCount, buildSkillFormulaContext_(battleState, skill, target, efficiency), battleState, skill)));
    for (var i = 0; i < targetHitCount; i += 1) {
      var damageTarget = target;
      if (Number(damageTarget.currentHp || 0) <= 0 && normalizedTargetMode !== 'allEnemies') {
        damageTarget = randomPerHit ? selectRandomAliveEnemy_(battleState) : getSkillTarget_(battleState, skill, skill.targetId || '');
      }
      if (!damageTarget || damageTarget.currentHp === undefined || Number(damageTarget.currentHp || 0) <= 0) {
        continue;
      }
      var targetContext = buildSkillFormulaContext_(battleState, skill, damageTarget, efficiency);
      var damage = calculateSkillRuleDamage_(battleState, skill, rule, targetContext, efficiency);
      if (damage <= 0) {
        continue;
      }
      var targetStats = calculateEffectiveStats({
        attack: damageTarget.attack,
        defense: damageTarget.defense,
        hp: damageTarget.maxHp,
        evasion: damageTarget.evasion,
        accuracy: 100,
      }, damageTarget.effects || []);
      var hitStats = prepareCombatHit_(battleState, skill, criticalStats);
      if (rule.combat && rule.combat.ignoreEvasion) targetStats.evasion = 0;
      var hit = rollHit_(hitStats, targetStats);
      if (!hit.hit) {
        processSkillTriggers_(battleState, 'onMiss', {actor:'player',target:damageTarget,damageKind:'direct',sourceSkillId:skill.skillId});
        battleState.lastTurnEvents.push({
          actor: 'player',
          type: ACTION_TYPES.SKILL,
          skillId: skill.skillId,
          attackEffect: skill.attackEffect || '',
          targetMonsterId: damageTarget.instanceId || damageTarget.monsterId,
          damage: 0,
          missed: true,
          hitChance: hit.chance,
          simultaneousGroupId: normalizedTargetMode === 'allEnemies' ? skill.skillId + ':allEnemies:' + i : (targetHitCount > 1 ? skill.skillId + ':multiHit' : ''),
          message: skill.name + '이 빗나갔습니다.',
        });
        continue;
      }
      var criticalRule = rule.criticalBonus;
      if (criticalRule && Array.isArray(criticalRule.targetEffects) && !criticalRule.targetEffects.some(function(id) { return hasEffect_(damageTarget, id); })) criticalRule = null;
      var critical = rollCriticalDamage_(damage, hitStats, criticalRule);
      var assassinRule=rule.combat && rule.combat.effectRules || {};
      if(assassinRule.fixedDamage)critical={damage:Math.round(damage),isCritical:false,multiplier:1};
      damage = applyFrozenBonusIfNeeded_(damageTarget, critical.damage);
      damage = applyOutgoingItemDamageModifiers_(battleState, damage, { actionType: ACTION_TYPES.SKILL, skill: skill });
      var damageResult = dealDamageToMonster_(battleState, damageTarget, damage, {damageKind:'direct', sourceSkillId:skill.skillId, isCritical:critical.isCritical,fixedDamage:!!assassinRule.fixedDamage,bypassShield:!!assassinRule.bypassShield, shatterMultiplier:rule.combat && rule.combat.shatterMultiplier, shieldOnlyDamage:rule.combat && rule.combat.shieldDamageFormula ? evaluateSkillFormula_(rule.combat.shieldDamageFormula,targetContext,battleState,skill) : 0});
      getSharedRuleEngine_().applyCriticalItemHealing(battleState, critical.isCritical, damageResult.damage);
      damageEvents += 1;
      totalDamageDealt += Number(damageResult.damage || 0);
      targetContext.hitDamage = Number(damageResult.damage || 0);
      applyConfiguredCombatHit_(battleState,skill,assassinRule,damageTarget,targetContext);
      if (rule.combat && rule.combat.onEachHit) executeCombatActions_(battleState,skill,rule.combat.onEachHit,[damageTarget],targetContext);
      if (critical.isCritical && criticalRule && Array.isArray(criticalRule.applyEffects)) {
        applySkillRuleEffects_(battleState, skill, {applyEffects:criticalRule.applyEffects}, [damageTarget], targetContext);
      }
      battleState.lastTurnEvents.splice(Number.isInteger(damageResult.eventIndex) ? damageResult.eventIndex : battleState.lastTurnEvents.length, 0, {
        actor: 'player',
        type: ACTION_TYPES.SKILL,
        skillId: skill.skillId,
        attackEffect: skill.attackEffect || '',
        targetMonsterId: damageTarget.instanceId || damageTarget.monsterId,
        damage: damageResult.damage,
        displayDamage: damageResult.displayDamage,
        shieldDamage: damageResult.shieldDamage,
        hpDamage: damageResult.hpDamage,
        isCritical: critical.isCritical,
        criticalMultiplier: critical.multiplier,
        simultaneousGroupId: normalizedTargetMode === 'allEnemies' ? skill.skillId + ':allEnemies:' + i : (targetHitCount > 1 ? skill.skillId + ':multiHit' : ''),
        message: critical.isCritical
          ? skill.name + ' 치명타! ' + damageResult.displayDamage + ' 피해!'
          : skill.name + '으로 ' + damageResult.displayDamage + ' 피해!',
      });
    }
  });

  applySkillRuleDamageHeal_(battleState, skill, rule, context, totalDamageDealt);
  applySkillRuleEffects_(battleState, skill, rule, targets, context);
  executeCombatActions_(battleState, skill, rule.actions, targets, context);
  context.landedHits=damageEvents;
  context.totalDamageDealt=totalDamageDealt;
  finishCombatSkill_(battleState,skill,rule,targets,context);
  if (rule.efficiencyBonus && Number(efficiency || 0) >= Number(rule.efficiencyBonus.threshold || 0) && Array.isArray(rule.efficiencyBonus.applyEffects)) {
    applySkillRuleEffects_(battleState, skill, { applyEffects: rule.efficiencyBonus.applyEffects }, targets, context);
  }
  processImmediateSkillRuleActions_(battleState, skill, rule.onUse, targets, context);
  if (isCorrect === true) {
    processImmediateSkillRuleActions_(battleState, skill, rule.onCorrect, targets, context);
  } else if (isCorrect === false) {
    processImmediateSkillRuleActions_(battleState, skill, rule.onWrong, targets, context);
  }
  if (!battleState.suppressSkillUseBookkeeping) {
    applyCooldownModify_(battleState, skill, rule.cooldownModify);
    trackSkillTagsForUse_(battleState, skill);
    trackCombatAttack_(battleState,skill,rule);
  }
  syncPrimaryMonster_(battleState);
  battleState.lastMessage = skill.name + '을 사용했습니다.';
  if (!damageEvents && !collectSkillRuleShieldFormulas_(rule).length && !rule.healFormula && !rule.healFromDamageFormula && !rule.healFromDamagePercentFormula && !(rule.applyEffects || []).length) {
    battleState.lastTurnEvents.push({ actor: 'player', type: skill.type || ACTION_TYPES.SKILL, skillId: skill.skillId, message: skill.name + ' 효과가 발동했습니다.' });
  }
  return battleState;
}

function buildSkillRulePreviewText_(skill, battleState, rule) {
  var context = buildSkillFormulaContext_(battleState, skill, getFirstAliveMonster_(battleState), 1);
  var parts = [];
  var previewDamage = 0;
  if (rule.damageFormula) {
    previewDamage = evaluateSkillFormula_(rule.damageFormula, context, battleState, skill);
    if (rule.randomMin !== undefined || rule.randomMax !== undefined) {
      previewDamage += Number(rule.randomMax !== undefined ? rule.randomMax : rule.randomMin || 0);
    }
    if (rule.extraDamageFormula) {
      previewDamage += evaluateSkillFormula_(rule.extraDamageFormula, context, battleState, skill);
    }
    previewDamage = Math.max(0, Math.round(previewDamage));
    var randomRange=getSharedRuleEngine_().randomDamageRange(rule,context);
    parts.push('Damage ' + (randomRange?randomRange.min+'-'+randomRange.max:previewDamage));
  }
  var shield = getSkillRuleDisplayShield_(battleState, skill, rule, context);
  if (shield > 0) {
    parts.push('Shield ' + shield);
  }
  if (rule.healFormula) {
    parts.push('Heal ' + Math.max(0, Math.round(evaluateSkillFormula_(rule.healFormula, context, battleState, skill))));
  }
  if (rule.healFromDamageFormula || rule.healFromDamagePercentFormula) {
    var previewHitCount = Math.max(1, Math.round(evaluateSkillFormulaValue_(rule.hitCount, context, Math.max(1, Number(skill.hitCount || 1)), battleState, skill)));
    var previewDamageDealt = previewDamage * previewHitCount;
    var damageHealContext = Object.assign({}, context, {
      damageDealt: previewDamageDealt,
      totalDamageDealt: previewDamageDealt,
    });
    var previewDamageHeal = rule.healFromDamagePercentFormula
      ? previewDamageDealt * evaluateSkillFormula_(rule.healFromDamagePercentFormula, damageHealContext, battleState, skill) / 100
      : evaluateSkillFormula_(rule.healFromDamageFormula, damageHealContext, battleState, skill);
    parts.push('Heal ' + Math.max(0, Math.round(previewDamageHeal)));
  }
  if (Array.isArray(rule.applyEffects) && rule.applyEffects.length) {
    parts.push('Effects ' + rule.applyEffects.length);
  } else if (rule.effectId) {
    parts.push('Effect ' + rule.effectId);
  }
  if (rule.efficiencyBonus && rule.efficiencyBonus.threshold) {
    parts.push('Bonus at ' + Math.round(Number(rule.efficiencyBonus.threshold || 0) * 100) + '%');
  }
  return parts.length ? parts.join(' / ') : 'Rule skill';
}

function getSkillRuleDisplayShield_(battleState, skill, rule, context) {
  var formulas = collectSkillRuleShieldFormulas_(rule);
  if (!formulas.length) {
    return 0;
  }
  return Math.max(0, Math.round(formulas.reduce(function(total, formula) {
    return total + Number(evaluateSkillFormula_(formula, context, battleState, skill) || 0);
  }, 0)));
}

function collectSkillRuleShieldFormulas_(rule) {
  var formulas = [];
  (rule && rule.actions || []).forEach(function(a){if(a.operation==='shield' && a.amountFormula)formulas.push(a.amountFormula);});
  if(rule && rule.combat && rule.combat.randomShield)formulas.push(rule.combat.randomShield.high);
  appendSkillRuleShieldFormula_(formulas, rule);
  appendSkillRuleShieldFormula_(formulas, rule && rule.onUse);
  appendSkillRuleShieldFormula_(formulas, rule && rule.onCorrect);
  if (!formulas.length) {
    appendSkillRuleShieldFormula_(formulas, rule && rule.onWrong);
  }
  return formulas;
}

function appendSkillRuleShieldFormula_(formulas, rule) {
  if (rule && rule.shieldFormula !== undefined && rule.shieldFormula !== null && rule.shieldFormula !== '') {
    formulas.push(rule.shieldFormula);
  }
}

function calculateSkillRuleDamage_(battleState, skill, rule, context, efficiency) {
  var hasDamageFormula = rule.damageFormula !== undefined && rule.damageFormula !== null && rule.damageFormula !== '';
  var damage = hasDamageFormula ? evaluateSkillFormula_(rule.damageFormula, context, battleState, skill) : 0;
  var assassin=rule.combat && rule.combat.effectRules;
  if(assassin && assassin.fullHealthDamageBonusPercentFormula && Number(context.enemyHp)>=Number(context.enemyMaxHp))damage*=1+evaluateSkillFormula_(assassin.fullHealthDamageBonusPercentFormula,context,battleState,skill)/100;
  if (rule.randomMin !== undefined || rule.randomMax !== undefined) {
    damage += randomSkillInt_(Number(rule.randomMin || 0), Number(rule.randomMax || rule.randomMin || 0));
  }
  if (rule.extraDamageFormula) {
    damage += evaluateSkillFormula_(rule.extraDamageFormula, context, battleState, skill);
  }
  if (rule.tagBonus) {
    damage = applySkillTagBonusToValue_(battleState, skill, rule.tagBonus, damage);
  }
  if (rule.conditionalDamage && Number(context.enemyMaxHp || 0) > 0 && Number(context.enemyHp || 0) / Number(context.enemyMaxHp) * 100 < Number(rule.conditionalDamage.targetHpBelowPercent || 0)) {
    damage *= Math.max(0, evaluateSkillFormula_(rule.conditionalDamage.damageMultiplierFormula, context, battleState, skill));
  }
  if (rule.scaleByEfficiency !== false) {
    damage *= Number(efficiency || 0);
  }
  if (rule.efficiencyBonus && Number(efficiency || 0) >= Number(rule.efficiencyBonus.threshold || 0)) {
    damage *= Number(rule.efficiencyBonus.damageMultiplier || 1);
    damage += Number(rule.efficiencyBonus.damageAdd || 0);
  }
  return applyActiveSkillTagBonuses_(battleState, skill, damage, context);
}

function applySkillRuleShield_(battleState, skill, rule, context, efficiency) {
  if (combatShieldBlocked_(battleState.player)) return;
  if (rule.shieldFormula === undefined || rule.shieldFormula === null || rule.shieldFormula === '') {
    return;
  }
  var shield = evaluateSkillFormula_(rule.shieldFormula, context, battleState, skill);
  if (rule.scaleByEfficiency !== false) {
    shield *= Number(efficiency || 0);
  }
  if (rule.efficiencyBonus && Number(efficiency || 0) >= Number(rule.efficiencyBonus.threshold || 0)) {
    shield *= Number(rule.efficiencyBonus.shieldMultiplier || 1);
    shield += Number(rule.efficiencyBonus.shieldAdd || 0);
  }
  shield = Math.max(0, Math.round(shield));
  battleState.player.shield = Number(battleState.player.shield || 0) + shield;
  battleState.lastTurnEvents.push({ actor: 'player', type: ACTION_TYPES.GUARD, skillId: skill.skillId, shield: shield, message: skill.name + '으로 방어막 ' + shield + '을 얻었습니다.' });
}

function applySkillRuleCopyActions_(battleState, skill, rule, targets) {
  if (!battleState || !battleState.player || !rule || !targets || !targets.length) {
    return;
  }
  var source = targets.filter(function(target) {
    return target && target.currentHp !== undefined;
  })[0];
  if (!source) {
    return;
  }
  var skillId = skill && skill.skillId || '';
  var skillName = skill && skill.name || '스킬';
  var copyShield = rule.copyTargetShield === true || String(rule.copyTargetShield).toLowerCase() === 'true' || String(rule.copyTargetShield) === '1';
  var copyBuffs = rule.copyTargetBuffs === true || String(rule.copyTargetBuffs).toLowerCase() === 'true' || String(rule.copyTargetBuffs) === '1';

  if (copyShield && !combatShieldBlocked_(battleState.player)) {
    var copiedShield = Math.max(0, Math.round(Number(source.shield || 0)));
    if (copiedShield > 0) {
      battleState.player.shield = Number(battleState.player.shield || 0) + copiedShield;
      battleState.lastTurnEvents.push({
        actor: 'player',
        type: ACTION_TYPES.GUARD,
        skillId: skillId,
        shield: copiedShield,
        message: skillName + '으로 적의 방어막 ' + copiedShield + '을 흉내냈습니다.'
      });
    }
  }

  if (copyBuffs) {
    var sourceBuffs = (source.effects || []).filter(function(effect) {
      return normalizeEffectCategory_(effect, '') === EFFECT_CATEGORIES.BUFF;
    });
    if (!sourceBuffs.length) {
      sourceBuffs = source.buffs || [];
    }
    sourceBuffs.forEach(function(sourceEffect) {
      if (!sourceEffect || !sourceEffect.effectId) {
        return;
      }
      var copiedEffect = applyEffect(
        battleState.player,
        Object.assign({}, sourceEffect, sourceEffect.durationType === 'turn' ? {durationTurns:sourceEffect.remainingTurns} : {}),
        { source: 'skillCopy', skillId: skillId, turn: battleState.turn }
      );
      if (copiedEffect) {
        battleState.lastTurnEvents.push({
          actor: 'player',
          type: ACTION_TYPES.BUFF,
          skillId: skillId,
          message: skillName + '으로 ' + (copiedEffect.name || copiedEffect.effectId) + ' 버프를 흉내냈습니다.'
        });
      }
    });
    normalizeBattleStateEffects_(battleState);
  }
}

function applySkillRuleHeal_(battleState, skill, rule, context) {
  if (rule.healFormula === undefined || rule.healFormula === null || rule.healFormula === '') {
    return;
  }
  var heal = evaluateSkillFormula_(rule.healFormula, context, battleState, skill);
  if (rule.scaleByEfficiency !== false) {
    heal *= Number(context.efficiency || 0);
  }
  if (rule.efficiencyBonus && Number(context.efficiency || 0) >= Number(rule.efficiencyBonus.threshold || 0)) {
    heal *= Number(rule.efficiencyBonus.healMultiplier || 1);
    heal += Number(rule.efficiencyBonus.healAdd || 0);
  }
  heal = Math.max(0, Math.round(heal));
  battleState.player.hp = Math.min(Number(battleState.player.maxHp || battleState.player.stats.hp || 1), Number(battleState.player.hp || 0) + heal);
  battleState.lastTurnEvents.push({ actor: 'player', type: 'heal', skillId: skill.skillId, heal: heal, message: skill.name + '으로 체력을 ' + heal + ' 회복했습니다.' });
}

function applySkillRuleDamageHeal_(battleState, skill, rule, context, totalDamageDealt) {
  var hasDamageHealFormula = rule.healFromDamageFormula !== undefined && rule.healFromDamageFormula !== null && rule.healFromDamageFormula !== '';
  var hasDamageHealPercentFormula = rule.healFromDamagePercentFormula !== undefined && rule.healFromDamagePercentFormula !== null && rule.healFromDamagePercentFormula !== '';
  if (!hasDamageHealFormula && !hasDamageHealPercentFormula) {
    return;
  }
  var damageHealContext = Object.assign({}, context, {
    damageDealt: Number(totalDamageDealt || 0),
    totalDamageDealt: Number(totalDamageDealt || 0),
  });
  // damageDealt already includes efficiency, critical hits, shields, and item modifiers.
  var heal = hasDamageHealPercentFormula
    ? Number(totalDamageDealt || 0) * evaluateSkillFormula_(rule.healFromDamagePercentFormula, damageHealContext, battleState, skill) / 100
    : evaluateSkillFormula_(rule.healFromDamageFormula, damageHealContext, battleState, skill);
  if (rule.efficiencyBonus && Number(context.efficiency || 0) >= Number(rule.efficiencyBonus.threshold || 0)) {
    heal *= Number(rule.efficiencyBonus.healMultiplier || 1);
    heal += Number(rule.efficiencyBonus.healAdd || 0);
  }
  heal = Math.max(0, Math.round(heal));
  battleState.player.hp = Math.min(Number(battleState.player.maxHp || battleState.player.stats && battleState.player.stats.hp || 1), Number(battleState.player.hp || 0) + heal);
  battleState.lastTurnEvents.push({ actor: 'player', type: 'heal', skillId: skill.skillId, heal: heal, damageDealt: Number(totalDamageDealt || 0), message: skill.name + '으로 체력을 ' + heal + ' 회복했습니다.' });
}

function applySkillRuleSelfDamage_(battleState, skill, rule, context) {
  var selfDamage = Number(rule.selfDamage || 0);
  if (rule.failPenalty && rule.failPenalty.selfDamageOnUse) {
    selfDamage += Number(rule.failPenalty.selfDamageOnUse || 0);
  }
  if (selfDamage <= 0) {
    return;
  }
  var damage = Math.max(0, Math.round(evaluateSkillFormulaValue_(selfDamage, context, selfDamage, battleState, skill)));
  battleState.player.hp = Math.max(0, Number(battleState.player.hp || 0) - damage);
  battleState.lastTurnEvents.push({ actor: 'player', type: 'selfDamage', skillId: skill.skillId, damage: damage, hpDamage: damage, message: skill.name + '의 반동으로 ' + damage + ' 피해를 받았습니다.' });
  getSharedRuleEngine_().reviveAfterDamage(battleState.player, battleState);
  if (damage > 0) processSkillTriggers_(battleState, 'onDamaged', {hpDamage:damage, damage:damage, actor:'player', selfTurn:true});
}

function selectSkillTargets_(rule, battleState, skill, explicitTargetId) {
  var mode = normalizeSkillTargetMode_(rule.targetMode || (skill.target === 'self' ? 'self' : 'singleEnemy'));
  if (mode === 'self') {
    return [battleState.player];
  }
  if (mode === 'singleEnemy') {
    var target = getSkillTarget_(battleState, skill, explicitTargetId);
    return target ? [target] : [];
  }
  if (mode === 'allEnemies') {
    return getAliveMonsters_(battleState);
  }
  if (mode === 'randomEnemy' || mode === 'randomEnemies') {
    var randomTarget = selectRandomAliveEnemy_(battleState);
    return randomTarget ? [randomTarget] : [];
  }
  if (mode === 'enemyWithShield') {
    var shielded = getAliveMonsters_(battleState).filter(function(monster) {
      return Number(monster.shield || 0) > 0;
    })[0];
    return shielded ? [shielded] : [];
  }
  warnSkillRule_(battleState, skill, 'Unsupported targetMode: ' + mode, { targetMode: mode });
  var fallback = getSkillTarget_(battleState, skill, explicitTargetId);
  return fallback ? [fallback] : [];
}

function normalizeSkillTargetMode_(mode) {
  var value = String(mode || '').trim().toLowerCase().replace(/[_-]/g, '');
  if (value === 'self') return 'self';
  if (value === 'allenemies' || value === 'enemies') return 'allEnemies';
  if (value === 'randomenemy') return 'randomEnemy';
  if (value === 'randomenemies') return 'randomEnemies';
  if (value === 'enemywithshield') return 'enemyWithShield';
  return value === 'singleenemy' || value === 'enemy' ? 'singleEnemy' : String(mode || 'singleEnemy');
}

function selectRandomAliveEnemy_(battleState) {
  var alive = getAliveMonsters_(battleState);
  if (!alive.length) {
    return null;
  }
  return alive[Math.floor(Math.random() * alive.length)];
}

function getMonsterRuntimeId_(monster) {
  return String(monster && (monster.instanceId || monster.monsterId) || '');
}

function selectRandomAliveEnemyAvoiding_(battleState, usedTargetIds) {
  var alive = getAliveMonsters_(battleState);
  if (!alive.length) {
    return null;
  }
  usedTargetIds = usedTargetIds || {};
  var unused = alive.filter(function(monster) {
    var id = getMonsterRuntimeId_(monster);
    return !id || !usedTargetIds[id];
  });
  var pool = unused.length ? unused : alive;
  var picked = pool[Math.floor(Math.random() * pool.length)];
  var pickedId = getMonsterRuntimeId_(picked);
  if (pickedId) {
    usedTargetIds[pickedId] = true;
  }
  return picked;
}

function checkSkillConditions_(rule, skill, battleState, target) {
  if (!rule || typeof rule !== 'object') {
    return '';
  }
  normalizeSkillRuntimeState_(battleState);
  var condition = rule.requireCondition || {};
  var combatReason = checkCombatSkillConditions_(battleState,skill,rule,target);
  if (combatReason) return combatReason;
  if (Array.isArray(condition.targetEffects)) {
    var candidates = skill.targetId ? [target].filter(Boolean) : getAliveMonsters_(battleState);
    if (!candidates.some(function(candidate) { return condition.targetEffects.some(function(id) { return hasEffect_(candidate, id); }); })) return '기절 또는 수면 상태의 대상이 필요합니다.';
  }
  if (rule.consumeEffect && getSkillEffectTotal_(battleState.player, rule.consumeEffect.effectId) < Number(rule.consumeEffect.minValue || 1)) return '필요한 버프 수치가 부족합니다.';
  validateSkillRequireCondition_(battleState, skill, condition);
  if (condition.oncePerBattle) {
    condition.perBattleLimit = 1;
  }
  if (condition.afterTurn && Number(battleState.turn || 1) < Number(condition.afterTurn)) {
    return 'Turn ' + condition.afterTurn + ' required.';
  }
  if (condition.perBattleLimit && getSkillUseCount_(battleState, skill.skillId) >= Number(condition.perBattleLimit)) {
    return 'Battle use limit reached.';
  }
  if (condition.perStageLimit && getSkillUseCount_(battleState, skill.skillId) >= Number(condition.perStageLimit)) {
    return 'Stage use limit reached.';
  }
  if (condition.requireShield && Number(battleState.player.shield || 0) <= 0) {
    return 'Shield required.';
  }
  if (condition.requireEnemyShield) {
    var hasShieldedEnemy = getAliveMonsters_(battleState).some(function(monster) {
      return Number(monster.shield || 0) > 0;
    });
    if (!hasShieldedEnemy) {
      return 'Enemy shield required.';
    }
  }
  if (condition.requireTag && !hasSkillTag_(skill, condition.requireTag)) {
    return 'Skill tag required: ' + condition.requireTag;
  }
  if (condition.requireHpBelowPercent && getHpPercent_(battleState.player) >= Number(condition.requireHpBelowPercent)) {
    return 'HP must be below ' + condition.requireHpBelowPercent + '%.';
  }
  if (condition.requireHpAbovePercent && getHpPercent_(battleState.player) <= Number(condition.requireHpAbovePercent)) {
    return 'HP must be above ' + condition.requireHpAbovePercent + '%.';
  }
  if (Number(battleState.skillCooldowns[skill.skillId] || 0) > 0) {
    return '쿨타임 ' + Number(battleState.skillCooldowns[skill.skillId] || 0) + '턴 남았습니다.';
  }

  return '';
}

function validateSkillRequireCondition_(battleState, skill, condition) {
  if (!condition || typeof condition !== 'object') {
    return;
  }
  var supported = ['afterTurn', 'perStageLimit', 'perBattleLimit', 'requireShield', 'requireEnemyShield', 'requireTag', 'requireEfficiencyAtLeast', 'requireHpBelowPercent', 'requireHpAbovePercent', 'oncePerBattle', 'notUpgradable', 'targetEffects'];
  Object.keys(condition).forEach(function(key) {
    if (supported.indexOf(key) === -1) {
      warnSkillRule_(battleState, skill, 'Unsupported requireCondition key: ' + key, { key: key });
    }
  });
}

function buildSkillFormulaContext_(battleState, skill, target, efficiency) {
  var effectiveStats = calculateEffectiveStats(battleState.player.stats || {}, battleState.player.effects || []);
  var level = Math.max(1, Number(skill.level || 1));
  var upgradeLevel = Math.max(0, level - 1);
  var tagCounts = battleState.usedSkillCountByTagThisBattle || {};
  var turnTagCounts = battleState.usedSkillCountByTagThisTurn || {};
  return Object.assign({
    n: upgradeLevel,
    upgrade: upgradeLevel,
    level: level,
    skillLevel: level,
    base: Number(skill.baseValue || 0),
    baseValue: Number(skill.baseValue || 0),
    skillBaseValue: Number(skill.baseValue || 0),
    damageUpgrade: getSkillUpgradeValue(skill, 'damage'),
    effectUpgrade: getSkillUpgradeValue(skill, 'effect'),
    buffValueUpgrade: getSkillUpgradeValue(skill, 'buffValue'),
    debuffChanceUpgrade: getSkillUpgradeValue(skill, 'debuffChance'),
    atk: Number(effectiveStats.attack || 0),
    attack: Number(effectiveStats.attack || 0),
    def: Number(effectiveStats.defense || 0),
    defense: Number(effectiveStats.defense || 0),
    hp: Number(battleState.player.hp || 0),
    maxHp: Number(battleState.player.maxHp || battleState.player.stats && battleState.player.stats.hp || 1),
    shield: Number(battleState.player.shield || 0),
    defaultShield: Number(skill.baseValue || 0) + Number(effectiveStats.defense || 0),
    skillShield: Number(skill.baseValue || 0) + Number(effectiveStats.defense || 0),
    enemyHp: Number(target && target.currentHp || 0),
    enemyMaxHp: Number(target && target.maxHp || 0),
    enemyShield: Number(target && target.shield || 0),
    efficiency: Number(efficiency || 0),
    usedStrikeSkillCountThisBattle: Number(tagCounts.strike || tagCounts['타격'] || 0),
    usedStrikeSkillCountThisTurn: Number(turnTagCounts.strike || turnTagCounts['타격'] || 0),
  }, combatFormulaContext_(battleState,skill,target));
}

function evaluateSkillFormulaValue_(value, context, fallback, battleState, skill) {
  if (value === undefined || value === null || value === '') {
    return Number(fallback || 0);
  }
  if (typeof value === 'number') {
    return value;
  }
  return evaluateSkillFormula_(String(value), context, battleState, skill);
}

function evaluateSkillFormula_(formula, context, battleState, skill) {
  return getSharedRuleEngine_().evaluateFormula(formula, context || {}, {
    random: Math.random,
    warn: function(message, data) {
      warnSkillRule_(battleState, skill, message, data || {});
    },
  });
}

function randomSkillInt_(min, max) {
  return getSharedRuleEngine_().randomInt(min, max, Math.random);
}

function createSkillFormulaParser_(source, context, battleState, skill) {
  return {
    source: source,
    index: 0,
    hasRemaining: function() {
      return this.index < this.source.length;
    },
    peek: function() {
      return this.source.charAt(this.index);
    },
    take: function() {
      return this.source.charAt(this.index++);
    },
    parseExpression: function() {
      var value = this.parseTerm();
      while (this.hasRemaining()) {
        var op = this.peek();
        if (op !== '+' && op !== '-') break;
        this.take();
        var rhs = this.parseTerm();
        value = op === '+' ? value + rhs : value - rhs;
      }
      return value;
    },
    parseTerm: function() {
      var value = this.parseFactor();
      while (this.hasRemaining()) {
        var op = this.peek();
        if (op !== '*' && op !== '/' && op !== '%') break;
        this.take();
        var rhs = this.parseFactor();
        if (op === '*') value *= rhs;
        if (op === '/') value = rhs === 0 ? 0 : value / rhs;
        if (op === '%') value = rhs === 0 ? 0 : value % rhs;
      }
      return value;
    },
    parseFactor: function() {
      var op = this.peek();
      if (op === '+') {
        this.take();
        return this.parseFactor();
      }
      if (op === '-') {
        this.take();
        return -this.parseFactor();
      }
      if (op === '(') {
        this.take();
        var nested = this.parseExpression();
        if (this.peek() === ')') {
          this.take();
        }
        return nested;
      }
      return this.parseAtom();
    },
    parseAtom: function() {
      var start = this.index;
      while (this.hasRemaining() && /[0-9.]/.test(this.peek())) {
        this.take();
      }
      if (this.index > start) {
        return Number(this.source.slice(start, this.index) || 0);
      }
      start = this.index;
      while (this.hasRemaining() && /[A-Za-z_.]/.test(this.peek())) {
        this.take();
      }
      if (this.index > start) {
        var name = this.source.slice(start, this.index);
        if (Object.prototype.hasOwnProperty.call(context, name)) {
          return Number(context[name] || 0);
        }
        warnSkillRule_(battleState, skill, 'Unknown formula variable: ' + name, { variable: name });
        return 0;
      }
      warnSkillRule_(battleState, skill, 'Unexpected formula token: ' + this.peek(), { formula: this.source, at: this.index });
      this.take();
      return 0;
    },
  };
}

function applySkillRuleEffects_(battleState, skill, rule, targets, context) {
  var effects = [];
  if (Array.isArray(rule.applyEffects)) {
    effects = effects.concat(rule.applyEffects);
  }
  if (rule.effectId) {
    effects.push({ target: skill.target === 'self' ? 'self' : 'enemy', effectId: rule.effectId, chance: rule.chance });
  }
  effects.forEach(function(effectRule) {
    applySkillEffectRule_(battleState, skill, effectRule, targets, context);
  });
}

function applySkillEffectRule_(battleState, skill, effectRule, targets, context) {
  if (!effectRule || !effectRule.effectId) {
    warnSkillRule_(battleState, skill, 'applyEffects entry missing effectId.', { effectRule: effectRule });
    return;
  }
  var supportedEffectKeys = ['target', 'effectId', 'value', 'valueFormula', 'durationType', 'durationTurns', 'stackable', 'maxStacks', 'stacks', 'stacksFormula', 'stacksRounding', 'chance', 'chanceFormula', 'requireEfficiencyAtLeast', 'requireCondition'];
  Object.keys(effectRule).forEach(function(key) {
    if (supportedEffectKeys.indexOf(key) === -1) {
      warnSkillRule_(battleState, skill, 'Unsupported applyEffects key: ' + key, { key: key });
    }
  });
  var requiredEfficiency = effectRule.requireEfficiencyAtLeast || (effectRule.requireCondition && effectRule.requireCondition.requireEfficiencyAtLeast);
  if (requiredEfficiency && Number(context.efficiency || 0) < Number(requiredEfficiency)) {
    return;
  }
  var chance = effectRule.chanceFormula !== undefined
    ? evaluateSkillFormula_(effectRule.chanceFormula, context, battleState, skill)
    : (effectRule.chance === undefined ? 100 : Number(effectRule.chance || 0));
  chance = Math.max(0, Math.min(100, chance));
  if (chance <= 0 || (chance < 100 && Math.random() * 100 >= chance)) {
    return;
  }
  var effect = findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effectRule.effectId, 600);
  if (!effect) {
    warnSkillRule_(battleState, skill, 'Effect not found: ' + effectRule.effectId, { effectId: effectRule.effectId });
    return;
  }
  var applied = Object.assign({}, effect);
  if (applied.behavior && applied.behavior.combat && applied.behavior.combat.skillCost) applied.sourceSkillId = skill.skillId;
  if (effectRule.value !== undefined) {
    applied.value = Number(effectRule.value || 0);
  }
  if (effectRule.valueFormula) {
    applied.value = evaluateSkillFormula_(effectRule.valueFormula, context, battleState, skill);
  }
  if (effectRule.durationType) applied.durationType = effectRule.durationType;
  if (effectRule.durationTurns !== undefined) applied.durationTurns = Number(effectRule.durationTurns || 0);
  if (effectRule.stackable !== undefined) applied.stackable = effectRule.stackable;
  if (effectRule.maxStacks !== undefined) applied.maxStacks = Number(effectRule.maxStacks || 1);
  if (effectRule.stacks !== undefined) applied.stacks = Number(effectRule.stacks || 1);
  if (effectRule.stacksFormula !== undefined) {
    applied.stacks = Math.max(0, (effectRule.stacksRounding==='floor'?Math.floor:Math.round)(evaluateSkillFormula_(effectRule.stacksFormula, context, battleState, skill)));
    if (!applied.stacks) return;
  }

  getTargetsForEffectRule_(battleState, effectRule, targets).forEach(function(target) {
    if (target.currentHp!==undefined && target.currentHp<=0) return;
    if (getSharedRuleEngine_().hasActionBlock({effects:[applied]}) && (target.controlImmune || target.stunImmune || (target.immunities || []).indexOf(applied.effectId)>=0)) return;
    var sourceSkill={skillId:skill.skillId,name:skill.name,level:Number(skill.level || 1),baseValue:Number(skill.baseValue || 0),
      description:skill.description || '',upgradeJson:skill.upgradeJson || '{}',tags:normalizeSkillTags_(skill.tags),
      target:skill.target,targetId:skill.targetId || '',attackEffect:skill.attackEffect || '',effectJson:skill.effectJson || '{}'};
    var configured=Object.assign({},applied,{sourceSkill:sourceSkill});
    if(configured.stackMode==='add')configured.stacks=modifyAppliedEffectStacks_(battleState,skill,target,configured,context);
    if(configured.stackMode==='add' && configured.stacks<=0)return;
    var appliedEffect = applyEffect(target, configured, { source: effectRule.target || 'rule', skillId: skill.skillId, turn: battleState && battleState.turn });
    var effectType = String(appliedEffect && appliedEffect.category || applied.category || '').toLowerCase() === 'debuff' ? 'debuff' : 'buff';
    battleState.lastTurnEvents = battleState.lastTurnEvents || [];
    if (target && target.currentHp !== undefined) {
      battleState.lastTurnEvents.push({
        actor: 'player',
        type: effectType,
        skillId: skill.skillId,
        effectId: effectRule.effectId,
        statusSnapshot: {effects:JSON.parse(JSON.stringify(target.effects || []))},
        targetMonsterId: target.instanceId || target.monsterId,
        message: (target.name || '적') + '에게 ' + (skill.name || '스킬') + ' 효과!',
      });
      return;
    }
    battleState.lastTurnEvents.push({
      actor: 'player',
      type: effectType,
      skillId: skill.skillId,
      effectId: effectRule.effectId,
      statusSnapshot: {effects:JSON.parse(JSON.stringify(target.effects || []))},
      message: (skill.name || '스킬') + ' 효과를 얻었습니다.',
    });
  });
}

function getTargetsForEffectRule_(battleState, effectRule, targets) {
  var target = effectRule.target || 'enemy';
  if (target === 'self') {
    return [battleState.player];
  }
  if (target === 'allEnemies') {
    return getAliveMonsters_(battleState);
  }
  return (targets || []).filter(function(candidate) {
    return candidate && candidate.currentHp !== undefined;
  });
}

function applySkillActionPointModify_(battleState, skill, apRule, context) {
  if (!apRule) {
    return;
  }
  if (typeof apRule !== 'object') {
    warnSkillRule_(battleState, skill, 'actionPointModify must be an object.', { actionPointModify: apRule });
    return;
  }
  var supportedKeys = ['currentActionPointAdd', 'currentActionPointSub', 'maxActionPointAdd', 'maxActionPointSub', 'nextTurnActionPointAdd', 'nextTurnActionPointSub'];
  var allowedKeys = supportedKeys.concat(supportedKeys.map(function(key) { return key + 'Formula'; }), ['durationType']);
  Object.keys(apRule).forEach(function(key) {
    if (allowedKeys.indexOf(key) === -1) {
      warnSkillRule_(battleState, skill, 'Unsupported actionPointModify key: ' + key, { key: key });
    }
  });
  var config = {};
  supportedKeys.forEach(function(key) {
    var formula = apRule[key + 'Formula'];
    if (formula !== undefined || apRule[key] !== undefined) {
      config[key] = evaluateSkillFormulaValue_(formula !== undefined ? formula : apRule[key], context, Number(apRule[key] || 0), battleState, skill);
    }
  });
  applyActionPointEffectConfig_(battleState.player, config);
}

function registerSkillTriggers_(battleState, skill, rule) {
  var triggerKeys = ['onDamaged', 'onBlock', 'onTurnStart', 'onTurnEnd', 'onHit', 'onCritical', 'onMiss', 'onEvade', 'onKill', 'onEffectRemoved', 'onDamage', 'onBeforeMonsterTurn', 'onExplosion'];
  triggerKeys.forEach(function(key) {
    if (!rule[key]) {
      return;
    }
    validateSkillTriggerRule_(battleState, skill, key, rule[key]);
    battleState.activeTriggers = battleState.activeTriggers || [];
    if (rule[key].replaceExisting || rule[key].maxActivations || rule[key].maxActivationsPerTurn || rule[key].oncePerAction || rule[key].oncePerTarget) {
      battleState.activeTriggers = battleState.activeTriggers.filter(function(trigger) { return trigger.timing !== key || trigger.sourceSkillId !== skill.skillId; });
    }
    battleState.activeTriggers.push({
      timing: key,
      rule: rule[key],
      sourceSkillId: skill.skillId,
      sourceSkillName: skill.name,
      sourceSkill: Object.assign({}, skill),
      durationType: rule[key].durationType || 'battle',
      remainingTurns: Number(rule[key].durationTurns || 0),
      createdAtTurn: Number(battleState.turn || 1),
    });
  });
  if (rule.failPenalty && (rule.failPenalty.loseBattleOnDamageTaken || rule.failPenalty.loseBattleOnWrongAnswer)) {
    battleState.activeTriggers = battleState.activeTriggers || [];
    battleState.activeTriggers.push({
      timing: 'failPenalty',
      rule: rule.failPenalty,
      sourceSkillId: skill.skillId,
      sourceSkillName: skill.name,
      durationType: rule.failPenalty.durationType || (skill.skillId === 'skill_emergency_escape' ? 'turn' : 'battle'),
      remainingTurns: Number(rule.failPenalty.durationTurns || (skill.skillId === 'skill_emergency_escape' ? 1 : 0)),
      createdAtTurn: Number(battleState.turn || 1),
    });
  }
}

function validateSkillTriggerRule_(battleState, skill, key, triggerRule) {
  if (!triggerRule || typeof triggerRule !== 'object') {
    warnSkillRule_(battleState, skill, key + ' must be an object.', { value: triggerRule });
    return;
  }
  var supported = ['durationType', 'durationTurns', 'selfTurnOnly', 'reflectBlockedDamage', 'damageFormula', 'applyEffects', 'actionPointModify', 'tagBonus', 'actions', 'maxActivations', 'maxActivationsPerTurn', 'oncePerTarget', 'oncePerAction', 'replaceExisting', 'damageKind', 'actor', 'targetId', 'requireTargetEffect'];
  Object.keys(triggerRule).forEach(function(ruleKey) {
    if (supported.indexOf(ruleKey) === -1) {
      warnSkillRule_(battleState, skill, 'Unsupported ' + key + ' key: ' + ruleKey, { key: ruleKey });
    }
  });
}

function processImmediateSkillRuleActions_(battleState, skill, actionRule, targets, context) {
  if (!actionRule) {
    return;
  }
  executeCombatActions_(battleState, skill, actionRule.actions, targets, context);
  if (actionRule.shieldFormula !== undefined && actionRule.shieldFormula !== null && actionRule.shieldFormula !== '' && !combatShieldBlocked_(battleState.player)) {
    var shield = Math.max(0, Math.round(evaluateSkillFormula_(actionRule.shieldFormula, context, battleState, skill)));
    battleState.player.shield = Number(battleState.player.shield || 0) + shield;
    battleState.lastTurnEvents = battleState.lastTurnEvents || [];
    battleState.lastTurnEvents.push({ actor: 'player', type: ACTION_TYPES.GUARD, skillId: skill.skillId, shield: shield, message: skill.name + ' 효과로 방어막 ' + shield + '을 얻었습니다.' });
  }
  if (actionRule.damageFormula) {
    var target = (targets || []).filter(function(candidate) {
      return candidate && candidate.currentHp !== undefined;
    })[0] || getFirstAliveMonster_(battleState);
    if (target) {
      var targetContext = buildSkillFormulaContext_(battleState, skill, target, context.efficiency || 1);
      var damage = Math.max(0, Math.round(evaluateSkillFormula_(actionRule.damageFormula, targetContext, battleState, skill)));
      if (damage > 0) {
        var result = dealDamageToMonster_(battleState, target, damage);
        battleState.lastTurnEvents = battleState.lastTurnEvents || [];
        battleState.lastTurnEvents.splice(Number.isInteger(result.eventIndex) ? result.eventIndex : battleState.lastTurnEvents.length, 0, { actor: 'effect', type: 'ruleDamage', target: 'monster', attackEffect: skill.attackEffect || (skill.skillId === 'skill_ignite' ? 'fire' : ''), targetMonsterId: target.instanceId || target.monsterId, damage: result.damage, shieldDamage: result.shieldDamage, hpDamage: result.hpDamage, message: skill.name + ' 효과로 ' + result.damage + ' 피해를 주었습니다.' });
      }
    }
  }
  if (actionRule.actionPointModify) {
    applySkillActionPointModify_(battleState, skill, actionRule.actionPointModify, context);
  }
  if (actionRule.applyEffects) {
    applySkillRuleEffects_(battleState, skill, { applyEffects: actionRule.applyEffects }, targets, context);
  }
  if (actionRule.tagBonus) {
    registerActiveSkillTagBonus_(battleState, skill, actionRule.tagBonus, context);
  }
}

function processSkillFailPenaltyAfterAnswer_(battleState, skill, isCorrect) {
  var rule = getSkillExecutionRule_(skill);
  var failPenalty = rule.failPenalty || {};
  validateSkillFailPenaltyRule_(battleState, skill, failPenalty);
  if (!isCorrect && failPenalty.loseBattleOnWrongAnswer) {
    markBattleDefeatBySkillRule_(battleState, skill, 'Wrong answer penalty.');
    return true;
  }
  if (!isCorrect && failPenalty.reduceActionPoint) {
    applyActionPointEffectConfig_(battleState.player, { currentActionPointSub: Number(failPenalty.reduceActionPoint || 0) });
  }
  return false;
}

function validateSkillFailPenaltyRule_(battleState, skill, failPenalty) {
  if (!failPenalty || typeof failPenalty !== 'object') {
    return;
  }
  var supported = ['loseBattleOnWrongAnswer', 'loseBattleOnDamageTaken', 'selfDamageOnUse', 'increaseQuestionDifficulty', 'reduceActionPoint', 'durationType', 'durationTurns'];
  Object.keys(failPenalty).forEach(function(key) {
    if (supported.indexOf(key) === -1) {
      warnSkillRule_(battleState, skill, 'Unsupported failPenalty key: ' + key, { key: key });
    }
  });
}

function markBattleDefeatBySkillRule_(battleState, skill, reason) {
  battleState.player.hp = 0;
  battleState.status = STATUS.BATTLE_DEFEAT || 'defeat';
  battleState.lastMessage = reason || '스킬 패널티로 패배했습니다.';
  battleState.lastTurnEvents = battleState.lastTurnEvents || [];
  battleState.lastTurnEvents.push({ actor: 'effect', type: 'defeat', skillId: skill && skill.skillId || '', target: 'player', message: battleState.lastMessage });
}

function processSkillTriggers_(battleState, timing, payload) {
  if (!battleState || Number(battleState.combatDispatchDepth || 0) >= 8) return;
  var event = getSharedRuleEngine_().recordCombatEvent(battleState, timing, payload);
  processCombatStatusEvent_(battleState,timing,payload || {});
  var triggers = (battleState.activeTriggers || []).slice();
  battleState.combatDispatchDepth = Number(battleState.combatDispatchDepth || 0) + 1;
  try {
    if (timing === 'onMiss' && payload && payload.actor === 'player' && payload.target && payload.target.currentHp > 0) {
      dispatchMonsterKitTrigger_(battleState, payload.target, 'onEvade', payload);
    }
    triggers.forEach(function(trigger) {
      if (trigger.timing !== timing && trigger.timing !== 'failPenalty') return;
      if (trigger.rule && trigger.rule.selfTurnOnly && !(payload && payload.selfTurn)) return;
      if (trigger.rule && trigger.rule.requireTargetEffect && !getSharedRuleEngine_().effectStacks(payload && payload.target,trigger.rule.requireTargetEffect)) return;
      if (trigger.timing !== 'failPenalty' && !getSharedRuleEngine_().claimCombatTrigger(trigger, event)) return;
      processSingleSkillTrigger_(battleState, trigger, timing, payload || {});
    });
  } finally {
    battleState.combatDispatchDepth -= 1;
    if (!battleState.combatDispatchDepth) delete battleState.combatDispatchDepth;
    battleState.activeTriggers = (battleState.activeTriggers || []).filter(function(trigger) { return !trigger.exhausted; });
  }
}

function processSingleSkillTrigger_(battleState, trigger, timing, payload) {
  var rule = trigger.rule || {};
  var sourceSkill = trigger.sourceSkill || { skillId: trigger.sourceSkillId || '', name: trigger.sourceSkillName || trigger.sourceSkillId || 'trigger' };
  if (rule.selfTurnOnly && !payload.selfTurn) return;
  var context = buildSkillFormulaContext_(battleState, sourceSkill, payload.target || null, payload.efficiency !== undefined ? payload.efficiency : 1);
  context.blockedDamage = Number(payload.shieldDamage || 0);
  context.damageTaken = Number(payload.hpDamage || 0);
  context.eventDamage = Number(payload.damage || 0);
  context.eventIsEnemy = payload.target && payload.target.currentHp !== undefined && context.eventDamage > 0 ? 1 : 0;
  context.eventIsPlayer = payload.target === battleState.player && context.eventDamage > 0 ? 1 : 0;
  context.targetStacks = payload.effectId ? getSharedRuleEngine_().effectStacks(payload.target, payload.effectId) : 0;
  context.eventEffectId = payload.effectId || '';
  context.defeatedEffects = payload.defeatedEffects || [];

  if (trigger.timing === 'failPenalty') {
    if (timing === 'onWrong' && rule.loseBattleOnWrongAnswer) {
      markBattleDefeatBySkillRule_(battleState, sourceSkill, '오답 패널티로 패배했습니다.');
    }
    if (timing === 'onDamaged' && rule.loseBattleOnDamageTaken && Number(payload.hpDamage || 0) > 0) {
      markBattleDefeatBySkillRule_(battleState, sourceSkill, '피격 패널티로 패배했습니다.');
    }
    return;
  }
  executeCombatActions_(battleState, sourceSkill, rule.actions, [payload.target || getFirstAliveMonster_(battleState)], context);
  if (rule.reflectBlockedDamage && Number(payload.shieldDamage || 0) > 0) {
    var target = payload.target || getFirstAliveMonster_(battleState);
    if (target) {
      var result = dealDamageToMonster_(battleState, target, Number(payload.shieldDamage || 0));
      battleState.lastTurnEvents = battleState.lastTurnEvents || [];
      battleState.lastTurnEvents.splice(Number.isInteger(result.eventIndex) ? result.eventIndex : battleState.lastTurnEvents.length, 0, { actor: 'effect', type: 'reflect', target: 'monster', targetMonsterId: target.instanceId || target.monsterId, damage: result.damage, hpDamage: result.hpDamage, shieldDamage: result.shieldDamage, message: sourceSkill.name + ' 효과로 ' + result.damage + ' 피해를 반사했습니다.' });
    }
  }
  if (rule.damageFormula) {
    var damage = Math.max(0, Math.round(evaluateSkillFormula_(rule.damageFormula, context, battleState, sourceSkill)));
    var damageTarget = payload.target || getFirstAliveMonster_(battleState);
    if (damageTarget && damage > 0) {
      dealDamageToMonster_(battleState, damageTarget, damage);
    }
  }
  if (rule.applyEffects) {
    applySkillRuleEffects_(battleState, sourceSkill, { applyEffects: rule.applyEffects }, [payload.target || getFirstAliveMonster_(battleState)], context);
  }
  if (rule.actionPointModify) {
    applySkillActionPointModify_(battleState, sourceSkill, rule.actionPointModify, context);
  }
}

// Ordered, data-authored operations. All callers (including local browser rules)
// use the same operations and the same EffectRules definitions.
function executeCombatActions_(battleState, skill, actions, targets, context) {
  if (!actions) return;
  getSharedRuleEngine_().validateCombatActions(actions);
  context = Object.assign({}, context || {});
  var targetContexts = {};
  actions.forEach(function(action) {
    var selected = action.target === 'self' ? [battleState.player]
      : action.target === 'allEnemies' ? getAliveMonsters_(battleState)
      : action.target === 'secondary' ? [getSkillTarget_(battleState, skill, skill.secondaryTargetId || '')]
      : (targets || []);
    if (action.target === 'secondary' && !skill.secondaryTargetId) throw new Error('보조 대상을 선택해야 합니다.');
    selected.filter(Boolean).forEach(function(target) {
      if (action.excludeSelected && target === getSkillTarget_(battleState, skill, skill.targetId || '')) return;
      var targetKey = target === battleState.player ? 'player' : String(target.instanceId || target.monsterId);
      var targetContext = targetContexts[targetKey] || (targetContexts[targetKey] = {});
      if (action.requireEffect && !getSharedRuleEngine_().effectStacks(target, action.requireEffect)) return;
      if (action.excludeEffect && getSharedRuleEngine_().effectStacks(target, action.excludeEffect)) return;
      if (action.requireStacks && getSharedRuleEngine_().effectStacks(target, action.requireStacks.effectId) < Number(action.requireStacks.min || 1)) return;
      targetContext.targetStacks = getSharedRuleEngine_().effectStacks(target, action.effectId);
      var operationContext = Object.assign({}, context, buildSkillFormulaContext_(battleState,skill,target,context.efficiency === undefined ? 1 : context.efficiency), targetContext);
      // Earlier hits/operations may change stacks. Keep the caller's initial
      // counts separately for effects that explicitly use the pre-hit state.
      operationContext.initialTargetBurn = Number(context.targetBurn || 0);
      if (action.when) {
        var tested = evaluateSkillFormula_(action.when.formula, operationContext, battleState, skill);
        var minimum = evaluateSkillFormulaValue_(action.when.minFormula !== undefined ? action.when.minFormula : action.when.min, operationContext, 1, battleState, skill);
        if (tested < minimum) return;
      }
      var amount = evaluateSkillFormulaValue_(action.amountFormula !== undefined ? action.amountFormula : action.amount, operationContext, 0, battleState, skill);
      amount = Math.max(0, Math.round(amount));
      if (action.operation === 'consumeStacks') {
        targetContext.consumedStacks = getSharedRuleEngine_().consumeEffectStacks(target, action.effectId, amount);
        context.totalConsumedStacks = Number(context.totalConsumedStacks || 0) + targetContext.consumedStacks;
      } else if (action.operation === 'moveStacks' || action.operation === 'copyStacks') {
        var destination = getSkillTarget_(battleState, skill, skill.secondaryTargetId || '');
        if (!skill.secondaryTargetId || !destination) throw new Error('보조 대상을 선택해야 합니다.');
        targetContext.movedStacks = getSharedRuleEngine_().transferEffectStacks(target, destination, action.effectId, amount, action.operation === 'copyStacks');
      } else if (action.operation === 'removeEffect') {
        var removed = getSharedRuleEngine_().removeCombatEffect(target, action.effectId, 'skill');
        targetContext.removedEffectCount = removed.length;
        removed.forEach(function(effect) { processSkillTriggers_(battleState, 'onEffectRemoved', {target:target, effectId:effect.effectId, sourceSkillId:skill.skillId, reason:'skill'}); });
      } else if (action.operation === 'applyEffect') {
        var effectAction = {};
        ['effectId','value','valueFormula','durationType','durationTurns','stacks','stacksFormula','stacksRounding','chance','chanceFormula'].forEach(function(key) { if (action[key] !== undefined) effectAction[key] = action[key]; });
        effectAction.target = target === battleState.player ? 'self' : 'enemy';
        applySkillEffectRule_(battleState, skill, effectAction, [target], operationContext);
      } else if (action.operation === 'damage' && target.currentHp !== undefined) {
        var repeats = action.repeatFormula === undefined ? 1 : Math.max(0, Math.floor(evaluateSkillFormula_(action.repeatFormula, operationContext, battleState, skill)));
        for (var repeat = 0; repeat < repeats && target.currentHp > 0; repeat += 1) {
          var result = dealDamageToMonster_(battleState, target, amount, {damageKind:action.damageKind || 'effect', sourceSkillId:skill.skillId});
          if(action.damageKind==='explosion')processSkillTriggers_(battleState,'onExplosion',{target:target,damageKind:'explosion',sourceSkillId:skill.skillId});
          battleState.lastTurnEvents.splice(Number.isInteger(result.eventIndex) ? result.eventIndex : battleState.lastTurnEvents.length, 0, {actor:'effect',type:'effectDamage',target:'monster',targetMonsterId:target.instanceId || target.monsterId,damage:result.damage,hpDamage:result.hpDamage,shieldDamage:result.shieldDamage,damageKind:action.damageKind || 'effect',effectId:action.effectId || '',attackEffect:skill.attackEffect || '',sourceSkillId:skill.skillId});
        }
      } else if (action.operation === 'damage' && target === battleState.player) {
        var selfResult = dealDamageToPlayer_(battleState, amount, null, {damageKind:action.damageKind || 'effect',actor:'player',sourceSkillId:skill.skillId});
        battleState.lastTurnEvents.splice(selfResult.eventIndex, 0, Object.assign({actor:'effect',type:'effectDamage',target:'player',skillId:skill.skillId,effectId:action.effectId || '',damageKind:action.damageKind || 'effect'},selfResult));
      } else if (action.operation === 'actionPoint' && target === battleState.player) {
        applyActionPointEffectConfig_(target, {currentActionPointAdd:amount});
      } else if (action.operation === 'shield' && target.currentHp === undefined) {
        if (combatShieldBlocked_(target)) return;
        var retained = action.retainEffectId && (target.effects || []).filter(function(e) { return e.effectId === action.retainEffectId && e.behavior && e.behavior.retainShield; })[0];
        if (action.retainEffectId && !retained) throw new Error('유지할 방어막 효과가 없습니다.');
        target.shield = Number(target.shield || 0) + amount;
        if (retained) retained.retainedShield = Number(retained.retainedShield || 0) + amount;
        battleState.lastTurnEvents.push({actor:'player',type:'guard',shield:amount,skillId:skill.skillId,message:skill.name+'으로 방어막 '+amount+'을 만들었습니다.'});
      } else if (action.operation === 'heal' && target.currentHp === undefined) {
        var previousHp=Number(target.hp || 0);
        target.hp = Math.min(Number(target.maxHp || target.stats.hp || 1), Number(target.hp || 0) + amount);
        battleState.lastTurnEvents.push({actor:'effect',type:'heal',heal:target.hp-previousHp,skillId:skill.skillId});
      } else {
        executeExtendedCombatAction_(battleState,skill,action,target,operationContext,context);
      }
    });
  });
}

function beginCombatActorTurn_(battleState, target) {
  var hpBefore = Number(target.hp || 0);
  var outcome = getSharedRuleEngine_().beginActorTurn(battleState, target);
  outcome.removed.forEach(function(effect) {
    processSkillTriggers_(battleState, 'onEffectRemoved', {target:target,effectId:effect.effectId,reason:'natural'});
  });
  if (target !== battleState.player) prepareMonsterKit_(battleState, target, 'ownerTurnStart');
  if (target === battleState.player && Number(target.hp || 0) > hpBefore) {
    battleState.lastTurnEvents.push({actor:'effect',type:'heal',heal:Number(target.hp)-hpBefore,message:'빙결 해제 효과로 체력을 회복했습니다.'});
  }
  outcome.blocked = getSharedRuleEngine_().hasActionBlock(target);
  if (outcome.blocked && target === battleState.player) target.currentActionPoint = 0;
  return outcome;
}

// Sheet-authored parameters use ordinary effect instances. Legacy state field
// names remain stable for battle checkpoints created before this migration.
function applyConfiguredCombatEffect_(battle,skill,target,suffix,state,turns) {
  if(!skill.effectJson)skill=Object.assign({},findCachedRowByKey_(DB_SHEETS.SKILLS,'skillId',skill.skillId,600),skill);
  var rule=getSkillExecutionRule_(skill),id=rule.combat && rule.combat.effectRuleIds && rule.combat.effectRuleIds[0];
  var definition=id && findCachedRowByKey_(DB_SHEETS.EFFECTS,'effectId',id,600);
  if(!definition)throw new Error('Missing combat effect definition: '+id);
  var effect=Object.assign({},definition,{effectId:skill.skillId+'_'+suffix,definitionEffectId:id,
    durationType:turns?'turn':'stage',durationTurns:turns || 0,rules:[],assassinState:state});
  applyEffect(target,effect,{skillId:skill.skillId,turn:battle.turn});
  battle.lastTurnEvents.push({actor:'player',type:target===battle.player?'buff':'debuff',skillId:skill.skillId,
    targetMonsterId:target===battle.player?'':target.instanceId || target.monsterId,
    statusSnapshot:{effects:JSON.parse(JSON.stringify(target.effects || []))},message:skill.name+' 효과!'});
}

function syncConfiguredCombatStats_(battle) {
  if(!battle || !battle.player)return;
  var player=battle.player;
  (player.effects || []).forEach(function(e){var a=e.assassinState;if(!a)return;
    a.active=!a.activeFromTurn || Number(battle.turn)>=a.activeFromTurn;
    a.unshielded=Number(player.shield || 0)===0;
    if(a.maxHpReduction)player.assassinMaxHpManaged=true;
  });
  if(player.assassinMaxHpManaged){
    var stats=calculateEffectiveStats(player.stats || {},player.effects || []);
    player.maxHp=Math.max(1,Number(stats.hp || 1));player.hp=Math.min(player.maxHp,Number(player.hp || 0));
  }
}

function applyConfiguredCombatHit_(battle,skill,config,target,context) {
  if(!config.onEachHitAccuracyDown || target.currentHp<=0)return;
  var value=-Math.max(0,evaluateSkillFormula_(config.onEachHitAccuracyDown.valueFormula,context,battle,skill));
  applySkillEffectRule_(battle,skill,{effectId:'effect_v2_accuracy_down',value:value,durationType:'turn',durationTurns:Number(config.onEachHitAccuracyDown.durationTurns || 2)},[target],context);
}

function finishConfiguredCombatSkill_(battle,skill,c,targets,context) {
  var player=battle.player,turn=Number(battle.turn || 1),state={sourceSkill:{skillId:skill.skillId,name:skill.name,level:Number(skill.level || 1),
    baseValue:Number(skill.baseValue || 0),upgradeJson:skill.upgradeJson || '{}',tags:normalizeSkillTags_(skill.tags),description:skill.description || ''}};
  function value(f){return Math.max(0,evaluateSkillFormula_(f,context,battle,skill));}
  if(c.evasion){
    var offset=c.evasion.duration==='nextTurn'?1:0,turns=Number(c.evasion.durationTurns || 1);
    state.evasion=value(c.evasion.valueFormula);state.unshieldedExtra=value(c.evasion.unshieldedExtraFormula || '0');state.activeFromTurn=turn+offset;
    if(c.counterOnEvade)state.counterFormula=c.counterOnEvade.damageFormula;
    if(c.reflectOnEvade)state.reflectEvadeMultiplier=Number(c.reflectOnEvade.damageMultiplier);
    applyConfiguredCombatEffect_(battle,skill,player,'evasion',state,turns+offset);
  }
  if(c.guaranteedEvade)applyConfiguredCombatEffect_(battle,skill,player,'stealth',Object.assign({},state,{guaranteedEvadeCharges:Number(c.guaranteedEvade.charges || 1)}),0);
  if(c.reflectBlockedDamage)applyConfiguredCombatEffect_(battle,skill,player,'reflection',Object.assign({},state,{reflectBlockedPercent:value(c.reflectBlockedDamage.percentFormula)}),1);
  if(c.duelMark && targets[0] && targets[0].currentHp>0)applyConfiguredCombatEffect_(battle,skill,targets[0],'duel',{
    outgoingBonus:value(c.duelMark.outgoingBonusPercentFormula),incomingBonus:value(c.duelMark.incomingBonusPercentFormula)},0);
  if(c.glassCannon){
    var id=skill.skillId+'_glass',effects=(player.effects || []).filter(function(e){return e.effectId!==id;});
    var base=calculateEffectiveStats(player.stats,effects),lost=Math.max(0,Math.round(Number(base.hp)*Number(c.glassCannon.maxHpReductionPercent)/100));
    applyConfiguredCombatEffect_(battle,skill,player,'glass',Object.assign({},state,{maxHpReduction:lost,attackBonus:lost*value(c.glassCannon.attackFromLostMaxHpPercentFormula)/100}),Number(c.glassCannon.durationTurns));
  }
  if(c.reserveAction)applyConfiguredCombatEffect_(battle,skill,player,'reserve',Object.assign({},state,{maxApBonus:Number(c.reserveAction.maxActionPointBonus),unusedApEvasion:value(c.reserveAction.evasionPerUnusedApFormula)}),Number(c.reserveAction.durationTurns));
  if(c.killReward)applyConfiguredCombatEffect_(battle,skill,player,'execution',Object.assign({},state,{killReward:c.killReward}),0);
  if(c.shieldFromDamageIfUnshielded && Number(player.shield || 0)===0 && !combatShieldBlocked_(player)){
    var gain=Math.round(Number(context.totalDamageDealt || 0)*Number(c.shieldFromDamageIfUnshielded.percent)/100);
    player.shield+=gain;battle.lastTurnEvents.push({actor:'player',type:'guard',shield:gain,skillId:skill.skillId,message:skill.name+' 방어막 +'+gain});
  }
  if(c.selfDamageIfTargetSurvives && targets[0] && targets[0].currentHp>0){
    var recoil=Math.round(value(c.selfDamageIfTargetSurvives.amountFormula));
    var result=dealDamageToPlayer_(battle,recoil,null,{actor:'player',damageKind:'self',shieldPiercePercent:100});
    battle.lastTurnEvents.splice(result.eventIndex,0,Object.assign({actor:'effect',target:'player',type:'effectDamage',skillId:skill.skillId,message:skill.name+' 반동 피해!'},result));
  }
  syncConfiguredCombatStats_(battle);normalizePlayerActionPoints_(battle,false);
}

function configuredReactionDamage_(battle,skill,target,amount,kind) {
  if(!target || target.currentHp<=0 || amount<=0)return;
  var result=dealDamageToMonster_(battle,target,amount,{actor:'player',damageKind:kind,sourceSkillId:skill.skillId});
  battle.lastTurnEvents.splice(result.eventIndex,0,Object.assign({actor:'effect',target:'monster',targetMonsterId:target.instanceId || target.monsterId,
    type:'effectDamage',damageKind:kind,skillId:skill.skillId,message:skill.name+' '+Math.round(amount)+' 피해!'},result));
}

function configuredAvoidedDamage_(battle,attacker,damage) {
  damage=modifyIncomingEffectRuleDamage_(battle,attacker,damage);
  (battle.player.effects || []).forEach(function(e){damage*=Number(combatEffectConfig_(e).incomingMultiplier || 1);});
  (attacker && attacker.effects || []).forEach(function(e){damage*=Number(combatEffectConfig_(e).retaliationMultiplier || 1);if(e.assassinState)damage*=1+Number(e.assassinState.incomingBonus || 0)/100;});
  return getSharedRuleEngine_().isCombatInvulnerable(battle.player)?0:applyIncomingItemDamageModifiers_(battle,damage);
}

function processConfiguredCombatEvent_(battle,timing,payload) {
  syncConfiguredCombatStats_(battle);
  var player=battle.player,engine=getSharedRuleEngine_(),turn=Number(battle.turn || 1);
  if(timing==='onKill' && payload.sourceSkillId){
    var row=findCachedRowByKey_(DB_SHEETS.SKILLS,'skillId',payload.sourceSkillId,600),a=row && getSkillExecutionRule_(row).combat;
    if(a && a.effectRules && a.effectRules.resetOwnCooldownOnKill){var runtime=engine.combatRuntime(battle);runtime.assassinCooldownResets=runtime.assassinCooldownResets || {};runtime.assassinCooldownResets[payload.sourceSkillId]=true;battle.skillCooldowns[payload.sourceSkillId]=0;}
  }
  (player.effects || []).slice().forEach(function(effect){
    var a=effect.assassinState;if(!a || a.active===false)return;
    var skill=a.sourceSkill || {},target=payload.target;
    if(timing==='onEvade' && payload.actor==='player'){
      if(a.guaranteedEvadeCharges>0){a.guaranteedEvadeCharges--;if(!a.guaranteedEvadeCharges)engine.removeCombatEffect(player,effect.effectId,'consumed');}
      if(a.counterFormula){var ctx=buildSkillFormulaContext_(battle,skill,target,1);ctx.evasion=calculateEffectiveStats(player.stats,player.effects).evasion || 0;configuredReactionDamage_(battle,skill,target,Math.round(evaluateSkillFormula_(a.counterFormula,ctx,battle,skill)),'counter');}
      if(a.reflectEvadeMultiplier && payload.originalDamage!==undefined)configuredReactionDamage_(battle,skill,target,Math.round(configuredAvoidedDamage_(battle,target,Number(payload.originalDamage))*a.reflectEvadeMultiplier),'reflect');
    }
    if(timing==='onBlock' && a.reflectBlockedPercent && payload.damageKind==='direct')configuredReactionDamage_(battle,skill,target,Math.round(Number(payload.shieldDamage)*a.reflectBlockedPercent/100),'reflect');
    if(timing==='onBeforeMonsterTurn' && a.unusedApEvasion){
      var unused=Number(player.assassinUnusedActionPoint || 0);
      if(unused>0)applyConfiguredCombatEffect_(battle,skill,player,'reserve_evasion',{evasion:unused*a.unusedApEvasion,sourceSkill:skill},1);
    }
    if(timing==='onKill' && a.killReward){
      var progress=ensureLevelProgress_(player),id=String(target.instanceId || target.monsterId);
      progress.assassinKills=progress.assassinKills || {};
      if(progress.assassinKills[id])return;
      progress.assassinKills[id]={sourceSkillId:skill.skillId,level:Number(skill.level || 1)};
      progress.points+=Number(a.killReward.statPointsPerKill || 1);
      var heal=Math.min(player.maxHp-player.hp,Math.floor(Number(payload.overkill || 0)*Number(a.killReward.healFromOverkillPercent)/100));
      if(heal>0){player.hp+=heal;battle.lastTurnEvents.push({actor:'player',type:'heal',heal:heal,skillId:skill.skillId,message:skill.name+' 체력 +'+heal});}
    }
  });
  if(timing==='onBeforeMonsterTurn')delete player.assassinUnusedActionPoint;
}

// Data-authored combat extensions. These functions never inspect a particular skill ID.
function combatChain_(battle) {
  var runtime=getSharedRuleEngine_().combatRuntime(battle);
  if (!runtime.combo) runtime.combo={turn:battle.turn,count:0,total:0,distinct:[],stored:0,storedTurn:0};
  var chain=runtime.combo;
  if (chain.turn!==battle.turn) {chain.turn=battle.turn;chain.count=0;chain.distinct=[];}
  return chain;
}

function combatFormulaContext_(battle,skill,target) {
  var chain=combatChain_(battle),engine=getSharedRuleEngine_();
  var stored=chain.storedTurn===Number(battle.turn)-1 ? chain.stored : 0;
  var poison=getAliveMonsters_(battle).reduce(function(sum,m){return sum+engine.effectStacks(m,'effect_v2_poison');},0);
  var prepared=engine.combatRuntime(battle).prepared || {};
  var selected = (battle.monsters || []).filter(function(m) { return (m.instanceId || m.monsterId) === (skill && skill.targetId); })[0] || getFirstAliveMonster_(battle);
  var enemyBurnTotal = getAliveMonsters_(battle).reduce(function(sum,m) { return sum + engine.effectStacks(m,'effect_v2_burn'); },0);
  return {comboCount:chain.count+stored,comboDistinct:chain.distinct.length,comboBattleBonus:Math.min(12,chain.total),
    targetBurn:engine.effectStacks(target,'effect_v2_burn'),selfBurn:engine.effectStacks(battle.player,'effect_v2_burn'),
    enemyBurnTotal:enemyBurnTotal,allBurnTotal:enemyBurnTotal+engine.effectStacks(battle.player,'effect_v2_burn'),
    selectedBurn:engine.effectStacks(selected,'effect_v2_burn'),selectedMaxHp:Number(selected && selected.maxHp || 0),
    poisonShield:Math.min(30,poison),poisonWeakPercent:-Math.min(30,2*engine.effectStacks(target,'effect_v2_poison')),targetPoison:engine.effectStacks(target,'effect_v2_poison'),
    targetCold:engine.effectStacks(target,'effect_v2_chill'),targetShock:engine.effectStacks(target,'effect_v2_shock'),
    enemyShockTotal:getAliveMonsters_(battle).reduce(function(sum,m){return sum+engine.effectStacks(m,'effect_v2_shock');},0),
    lowHpBonus:Math.min(1,Math.max(0,(1-getHpPercent_(battle.player)/100)/0.7)),
    randomPower:Number(prepared.randomPower || 0),randomDoubles:prepared.doubles?1:0,
    unhurtMultiplier:engine.combatRuntime(battle).playerWasDamaged?1:1.5};
}

function checkCombatSkillConditions_(battle,skill,rule,target) {
  var c=rule.combat || {},chain=combatChain_(battle),e=getSharedRuleEngine_();
  var candidates=skill.targetId ? [target].filter(Boolean) : getAliveMonsters_(battle);
  if (c.minBattleAttacks && chain.total<c.minBattleAttacks) return '타격 공격 사용 '+c.minBattleAttacks+'회가 필요합니다.';
  if (c.minTurnAttacks && chain.count<c.minTurnAttacks) return '이번 턴 타격 공격 '+c.minTurnAttacks+'회가 필요합니다.';
  if (c.oncePerTurn && Number(battle.skillLastUsedTurn && battle.skillLastUsedTurn[skill.skillId])===Number(battle.turn)) return '이번 턴 이미 사용했습니다.';
  if (c.hpCost && battle.player.hp<=c.hpCost) return '체력이 '+c.hpCost+'보다 많아야 합니다.';
  if (c.hpCostPercent && battle.player.hp<2) return '체력이 2 이상 필요합니다.';
  if (c.maxHpCostPercent && battle.player.hp<=Math.ceil(battle.player.maxHp*c.maxHpCostPercent)) return '체력 소모 후 1 이상 남아야 합니다.';
  if (c.eitherHpBelow && getHpPercent_(battle.player)>c.eitherHpBelow && !candidates.some(function(m){return getHpPercent_(m)<=c.eitherHpBelow;})) return '자신 또는 대상이 저체력이어야 합니다.';
  if (c.requireStacks && !candidates.some(function(m){return e.effectStacks(m,c.requireStacks.effectId)>=c.requireStacks.min;})) return '대상의 상태 스택이 부족합니다.';
  if (c.requireAnyEffect && !getAliveMonsters_(battle).some(function(m){return e.effectStacks(m,c.requireAnyEffect)>0;})) return '해당 상태의 적이 필요합니다.';
  if (c.requireOtherEnemy && getAliveMonsters_(battle).length<2) return '다른 생존 대상이 필요합니다.';
  if (c.requireTargetShield && !candidates.some(function(m){return m.shield>0;})) return '방어막이 있는 대상을 선택하세요.';
  if (c.requireCleanseable && !(battle.player.effects || []).some(function(e){return normalizeEffectCategory_(e)==='debuff'&&!e.uncleansable;})) return '해제 가능한 디버프가 없습니다.';
  if (c.cooldownTag && !combatCooldownCandidates_(battle,skill,c.cooldownTag).length) return '쿨타임 중인 다른 해당 컨셉 스킬이 필요합니다.';
  return '';
}

function combatEffectConfig_(effect) {return effect && effect.behavior && effect.behavior.combat || {};}
function combatShieldBlocked_(target) {return (target.effects || []).some(function(e){return combatEffectConfig_(e).blockShield;});}
function combatConsumeModifier_(battle,target,e,config) {
  var actionId=getSharedRuleEngine_().combatRuntime(battle).actionId;
  if (!config.uses || e.combatActionId===actionId) return;
  e.combatUses=e.combatUses===undefined?Number(config.uses):e.combatUses;
  e.combatUses-=1;e.combatActionId=actionId;
}
function combatModifierAvailable_(battle,e,config) {
  return !config.uses || e.combatUses===undefined || e.combatUses>0 || e.combatActionId===getSharedRuleEngine_().combatRuntime(battle).actionId;
}

function prepareCombatSkill_(battle,skill,original) {
  var rule=JSON.parse(JSON.stringify(original)),c=rule.combat || {},chain=combatChain_(battle),runtime=getSharedRuleEngine_().combatRuntime(battle);
  var chosen=getSkillTarget_(battle,skill,skill.targetId || '');
  syncConfiguredCombatStats_(battle);
  if(c.effectRules && c.effectRules.extraHitIfPlayerHpBelowPercentFormula && getHpPercent_(battle.player)<evaluateSkillFormula_(c.effectRules.extraHitIfPlayerHpBelowPercentFormula,buildSkillFormulaContext_(battle,skill,chosen,1),battle,skill))rule.hitCount=Number(rule.hitCount || skill.hitCount || 1)+Number(c.effectRules.extraHits || 1);
  runtime.prepared={sourceSkillId:skill.skillId,wasFrozen:!!(chosen && (chosen.effects || []).some(function(e){return e.behavior && e.behavior.control && e.behavior.control.breakOnDirectHit;}))};
  if (c.combo) {
    var stored=chain.storedTurn===Number(battle.turn)-1?chain.stored:0;
    var count=chain.count+stored;
    if (c.combo.extraHitIfPrior && count>0) rule.hitCount=Number(rule.hitCount || skill.hitCount)+c.combo.extraHitIfPrior;
    if (c.combo.hitPerPrior) rule.hitCount=Math.min(c.combo.maxHits,Number(rule.hitCount || skill.hitCount)+count*c.combo.hitPerPrior);
    if (c.combo.requiredDistinct && chain.distinct.length>=c.combo.requiredDistinct) rule.hitCount=c.combo.distinctHitCount;
  }
  if (c.hpCost || c.hpCostPercent || c.maxHpCostPercent) {
    var cost=c.hpCost || Math.max(1,Math.ceil(c.maxHpCostPercent ? battle.player.maxHp*c.maxHpCostPercent : battle.player.hp*c.hpCostPercent));
    battle.player.hp=Math.max(1,battle.player.hp-cost);
    runtime.playerWasDamaged=true;
    battle.lastTurnEvents.push({actor:'player',type:'selfDamage',hpDamage:cost,damage:cost,skillId:skill.skillId});
  }
  if (c.clearShield) {battle.player.shield=0;(battle.player.effects || []).forEach(function(e){e.retainedShield=0;});}
  if (c.random) {
    var random=c.random,rolls=[],mods=(battle.player.effects || []).filter(function(e){return combatModifierAvailable_(battle,e,combatEffectConfig_(e).random || {});});
    var minimum=1,reroll=false,floorRatio=0,rangeMin=1,rangeMax=1;
    mods.forEach(function(e){var m=combatEffectConfig_(e).random;if(!m)return;
      if(m.badLuck && e.badLuck>0){minimum=Math.min(random.sides,2);e.badLuck-=1;}
      if(m.reroll){reroll=true;combatConsumeModifier_(battle,battle.player,e,m);}
      floorRatio=Math.max(floorRatio,Number(m.floorRatio || 0));rangeMin*=Number(m.minMultiplier || 1);rangeMax*=Number(m.maxMultiplier || 1);
    });
    function draw(){var start=Number(random.dice || 1)>1?1:minimum;return start+Math.floor(Math.random()*(random.sides-start+1));}
    for(var i=0;i<Number(random.dice || 1);i++)rolls.push(draw());
    if(minimum>1 && rolls.length>1 && rolls.every(function(v){return v===1;}))rolls[0]=2;
    var rollContext=buildSkillFormulaContext_(battle,skill,chosen,1);
    function score(values){var sum=values.reduce(function(a,b){return a+b;},0),p=random.multipliers?random.multipliers[values[0]-1]:sum*random.attackPerPoint;
      var lo=random.multipliers?Math.min.apply(null,random.multipliers):Number(random.dice || 1)*random.attackPerPoint;
      var hi=random.multipliers?Math.max.apply(null,random.multipliers):random.sides*Number(random.dice || 1)*random.attackPerPoint;
      function at(power){return evaluateSkillFormula_(original.damageFormula,Object.assign({},rollContext,{randomPower:power}),battle,skill);}
      var min=at(lo),max=at(hi),t=(at(p)-min)/Math.max(0.0001,max-min);
      return (min*rangeMin+(max*rangeMax-min*rangeMin)*t)*(random.doublesMultiplier && values.length===2 && values[0]===values[1]?random.doublesMultiplier:1);
    }
    if(reroll){var other=rolls.map(draw);if(minimum>1 && other.length>1 && other.every(function(v){return v===1;}))other[0]=2;if(score(other)>score(rolls))rolls=other;}
    var sum=rolls.reduce(function(a,b){return a+b;},0),power=random.multipliers?random.multipliers[rolls[0]-1]:sum*Number(random.attackPerPoint || 0);
    var maxPower=random.multipliers?Math.max.apply(null,random.multipliers):random.sides*Number(random.dice || 1)*random.attackPerPoint;
    var lowResult=rolls.every(function(v){return v===1;});
    if (random.multipliers) {if(rolls[0]===1)power*=rangeMin;else if(rolls[0]===random.sides)power*=rangeMax;}
    else {var minPower=Number(random.dice || 1)*random.attackPerPoint;var t=(sum-Number(random.dice || 1))/Math.max(1,(random.sides-1)*Number(random.dice || 1));power=minPower*rangeMin+(maxPower*rangeMax-minPower*rangeMin)*t;}
    var doubles=rolls.length===2&&rolls[0]===rolls[1];
    runtime.prepared={sourceSkillId:skill.skillId,randomPower:power,rolls:rolls,doubles:doubles,lowResult:lowResult};
    var randomContext=buildSkillFormulaContext_(battle,skill,chosen,1);
    var naturalPower=random.multipliers?random.multipliers[rolls[0]-1]:sum*Number(random.attackPerPoint || 0);
    var minPower=random.multipliers?Math.min.apply(null,random.multipliers):Number(random.dice || 1)*random.attackPerPoint;
    function formulaAt(p){return evaluateSkillFormula_(original.damageFormula,Object.assign({},randomContext,{randomPower:p}),battle,skill);}
    var minDamage=formulaAt(minPower),maxDamage=formulaAt(maxPower),naturalDamage=formulaAt(naturalPower);
    var proportion=(naturalDamage-minDamage)/Math.max(0.0001,maxDamage-minDamage);
    var randomDamage=minDamage*rangeMin+(maxDamage*rangeMax-minDamage*rangeMin)*proportion;
    if(doubles)randomDamage*=Number(random.doublesMultiplier || 1);
    randomDamage=Math.max(maxDamage*rangeMax*Number(random.doublesMultiplier || 1)*floorRatio,randomDamage);
    rule.damageFormula=String(randomDamage);
    mods.forEach(function(e){var m=combatEffectConfig_(e).random;if(m&&m.badLuck&&lowResult)e.badLuck=Math.min(m.badLuck,Number(e.badLuck || 0)+1);});
    battle.lastTurnEvents.push({actor:'player',type:'randomRoll',skillId:skill.skillId,rolls:rolls,resultMultiplier:power,message:skill.name+' 결과: '+rolls.join(', ')});
  }
  return rule;
}

function prepareCombatHit_(battle,skill,stats) {
  var result=Object.assign({},stats),c=skill && getSkillExecutionRule_(skill).combat || {};
  result.accuracy=Number(result.accuracy || 0)+Number(c.accuracyAdd || 0);
  result.criticalRate=Number(result.criticalRate || 0)+Number(c.criticalChanceAdd || 0);
  (battle.player.effects || []).slice().forEach(function(e){var cfg=combatEffectConfig_(e),m=cfg.critical;
    if(m){var charges=e.criticalCharges===undefined?Number(m.charges || 1):e.criticalCharges;
      if(charges>0){result.criticalRate+=Number(m.add || 0);e.criticalCharges=charges-1;if(!e.criticalCharges)getSharedRuleEngine_().removeCombatEffect(battle.player,e.effectId,'consumed');}}
    if(cfg.criticalBank)result.criticalRate+=Number(e.criticalBank || 0)*Number(cfg.criticalBank.perStack || 0);
  });
  result.criticalRate=Math.max(0,Math.min(100,result.criticalRate));return result;
}

function modifyCombatOutgoing_(battle,target,damage,context) {
  if(context.damageKind!=='direct' && context.damageKind!=='explosion')return damage;
  var skill=context.sourceSkillId?findCachedRowByKey_(DB_SHEETS.SKILLS,'skillId',context.sourceSkillId,600):null;
  var c=skill && getSkillExecutionRule_(skill).combat || {};
  if(c.unhurtBonus && !getSharedRuleEngine_().combatRuntime(battle).playerWasDamaged)damage*=1+c.unhurtBonus;
  if(c.lowHpBonus)damage*=1+c.lowHpBonus*Math.min(1,Math.max(0,(1-getHpPercent_(battle.player)/100)/0.7));
  if(c.bothLowBonus && getHpPercent_(battle.player)<=30 && getHpPercent_(target)<=30)damage*=1+c.bothLowBonus;
  [battle.player,target].forEach(function(owner){(owner.effects || []).forEach(function(e){var m=combatEffectConfig_(e).outgoing;if(!m||!combatModifierAvailable_(battle,e,m))return;
    if(m.kind && m.kind!==context.damageKind)return;
    if(m.skillOnly && !skill)return;
    if(m.tag && (!skill||!hasSkillTag_(skill,m.tag)))return;
    if(m.targetOnly && owner!==target)return;
    if(m.requireTargetEffect && !getSharedRuleEngine_().effectStacks(target,m.requireTargetEffect))return;
    damage=damage*Number(m.multiplier || 1)+(m.addValue?Number(e.value || 0):Number(m.add || 0));combatConsumeModifier_(battle,owner,e,m);
  });});
  return Math.max(0,Math.round(damage));
}

function finishCombatSkill_(battle,skill,rule,targets,context) {
  var c=rule.combat || {},runtime=getSharedRuleEngine_().combatRuntime(battle),prepared=runtime.prepared || {};
  if(c.effectRules)finishConfiguredCombatSkill_(battle,skill,c.effectRules,targets,context);
  if(c.random && c.random.criticalOnMax && prepared.rolls && prepared.rolls[0]===c.random.sides)executeCombatActions_(battle,skill,[{operation:'applyEffect',effectId:c.random.criticalOnMax,target:'self'}],[battle.player],context);
  if(c.afterNotFrozenEffect && !prepared.wasFrozen && context.landedHits>0)executeCombatActions_(battle,skill,[{operation:'applyEffect',effectId:c.afterNotFrozenEffect,stacks:c.afterNotFrozenStacks || 1}],targets,context);
  if(c.randomShield){var high=Math.random()>=0.5;var amount=evaluateSkillFormula_(high?c.randomShield.high:c.randomShield.low,context,battle,skill);if(!combatShieldBlocked_(battle.player))battle.player.shield+=Math.round(amount*context.efficiency);if(!high)runtime.delayedShield={turn:Number(battle.turn)+1,amount:6};}
  if(c.recoilIfSurvives && targets[0] && targets[0].currentHp>0){var recoil=Math.round(battle.player.maxHp*c.recoilIfSurvives);battle.player.hp=Math.max(0,battle.player.hp-recoil);runtime.playerWasDamaged=true;}
  getSharedRuleEngine_().reviveAfterDamage(battle.player,battle);
  if(battle.player.hp<=0)battle.status=STATUS.BATTLE_DEFEAT;
  if(c.combo && c.combo.resetAfter){var chain=combatChain_(battle);chain.count=0;chain.distinct=[];chain.stored=0;}
  if(c.oncePerTurn){battle.skillLastUsedTurn=battle.skillLastUsedTurn || {};battle.skillLastUsedTurn[skill.skillId]=battle.turn;}
  [battle.player].concat(battle.monsters || []).forEach(function(target){(target.effects || []).slice().forEach(function(e){var cfg=combatEffectConfig_(e),simple=Object.keys(cfg).length===1 && !(e.rules || []).length;
    if(simple && ((cfg.outgoing && cfg.outgoing.uses && e.combatUses<=0)||(cfg.random && cfg.random.uses && e.combatUses<=0)))getSharedRuleEngine_().removeCombatEffect(target,e.effectId,'consumed');
  });});
}

function trackCombatAttack_(battle,skill,rule) {
  if(!rule.damageFormula || !hasSkillTag_(skill,'strike'))return;
  var chain=combatChain_(battle);
  if(chain.storedTurn===Number(battle.turn)-1)chain.stored=0;
  chain.total+=1;
  if(rule.combat && rule.combat.combo && rule.combat.combo.resetAfter)return;
  chain.count+=1;if(chain.distinct.indexOf(skill.skillId)<0)chain.distinct.push(skill.skillId);
}

function combatCooldownCandidates_(battle,skill,tag,excludeCooldownSkills) {
  return readTableCached_(DB_SHEETS.SKILLS,600).filter(function(s){return s.skillId!==skill.skillId&&(!tag || hasSkillTag_(s,tag))&&(!excludeCooldownSkills || !getSharedRuleEngine_().isCooldownReductionSkill(s))&&Number(battle.skillCooldowns && battle.skillCooldowns[s.skillId])>0;});
}

function executeExtendedCombatAction_(battle,skill,a,target,ctx,aggregate) {
  var engine=getSharedRuleEngine_(),runtime=engine.combatRuntime(battle),alive=getAliveMonsters_(battle),other=alive.filter(function(m){return m!==target;});
  function amount(formula,fallback){return Math.max(0,Math.round(evaluateSkillFormulaValue_(formula,ctx,fallback,battle,skill)));}
  if(a.operation==='storeCombo'){var chain=combatChain_(battle);chain.stored=Math.min(Number(a.max || 2),chain.count);chain.storedTurn=Number(battle.turn);}
  if(a.operation==='resetCombo'){combatChain_(battle).count=0;combatChain_(battle).distinct=[];}
  if(a.operation==='clearShield'){target.shield=0;(target.effects || []).forEach(function(e){e.retainedShield=0;});}
  if(a.operation==='cooldownSelect'){
    var candidates=combatCooldownCandidates_(battle,skill,a.tag,a.excludeCooldownSkills);var selected=candidates.filter(function(s){return s.skillId===skill.cooldownTargetSkillId;})[0];
    if(!selected)throw new Error('쿨타임을 줄일 스킬을 선택하세요.');
    battle.skillCooldowns[selected.skillId]=Math.max(0,battle.skillCooldowns[selected.skillId]-Number(a.amount || 1));
  }
  if(a.operation==='cooldownAll')combatCooldownCandidates_(battle,skill,a.tag,a.excludeCooldownSkills).forEach(function(s){battle.skillCooldowns[s.skillId]=Math.max(0,battle.skillCooldowns[s.skillId]-Number(a.amount || 1));});
  if(a.operation==='cleanseLongest'){
    var effects=(target.effects || []).filter(function(e){return normalizeEffectCategory_(e)==='debuff'&&!e.uncleansable;});
    effects.sort(function(x,y){return (y.durationType==='stage'?Infinity:Number(y.remainingTurns || 0))-(x.durationType==='stage'?Infinity:Number(x.remainingTurns || 0))||Number(x.appliedAtTurn || 0)-Number(y.appliedAtTurn || 0);});
    if(effects[0]){engine.removeCombatEffect(target,effects[0].effectId,'cleanse');processSkillTriggers_(battle,'onEffectRemoved',{target:target,effectId:effects[0].effectId,reason:'cleanse',sourceSkillId:skill.skillId});}
  }
  if(a.operation==='spreadStacks'){
    var source=(target.effects || []).filter(function(e){return e.effectId===a.effectId;})[0];if(!source)return;
    var count=Math.min(Number(a.max || 999),Math.floor(engine.effectStacks(target,a.effectId)*Number(a.fraction || 1)));
    other.forEach(function(m){var payload=Object.assign({},source,{stacks:count});if(count)applyEffect(m,payload,{turn:battle.turn,skillId:skill.skillId});});
  }
  if(a.operation==='gatherStacks')other.forEach(function(m){engine.transferEffectStacks(m,target,a.effectId,Math.floor(engine.effectStacks(m,a.effectId)*Number(a.fraction || 0.5)),false);});
  if(a.operation==='distributeStacks'){
    var source=(target.effects || []).filter(function(e){return e.effectId===a.effectId;})[0];
    if(!source && ctx.defeatedEffects)source=ctx.defeatedEffects.filter(function(e){return e.effectId===a.effectId;})[0];
    if(!source||!other.length)return;
    var remaining=Math.min(Number(a.max || 999),Number(source.stacks || 0));other.sort(function(x,y){return Number(x.currentHp)-Number(y.currentHp);});
    while(remaining>0){var moved=0;other.forEach(function(m){if(!remaining)return;var before=engine.effectStacks(m,a.effectId);if(before>=Number(source.maxStacks || 1))return;engine.transferEffectStacks(target,m,a.effectId,1,false);var delta=engine.effectStacks(m,a.effectId)-before;remaining-=delta;moved+=delta;});if(!moved)break;}
    if(a.copyOnKill)engine.removeCombatEffect(target,a.effectId,'deathTransfer');
  }
  if(a.operation==='counterAttack'){
    for(var i=0;i<Number(a.hitCount || 1)&&target.currentHp>0;i++){var result=dealDamageToMonster_(battle,target,amount(a.amountFormula,0),{damageKind:'counter',sourceSkillId:skill.skillId});battle.lastTurnEvents.push(Object.assign({actor:'effect',type:'counter',targetMonsterId:target.instanceId,damageKind:'counter'},result));}
  }
  if(a.operation==='breakControl'){
    var frozen=(target.effects || []).some(function(e){return e.behavior && e.behavior.control && e.behavior.control.breakOnDirectHit;});
    if(frozen){var reactions=engine.directHitReactions(target);reactions.removed.forEach(function(e){processSkillTriggers_(battle,'onEffectRemoved',{target:target,effectId:e.effectId,reason:'remoteBreak',sourceSkillId:skill.skillId});});reactions.packets.filter(function(p){return p.damageKind==='shatter';}).forEach(function(p){var r=dealDamageToMonster_(battle,target,p.amount,{damageKind:'shatter',sourceSkillId:skill.skillId});pushCombatDamageEvent_(battle,target,r,'shatter',skill.skillId);});}
    else if(a.otherwiseEffectId)executeCombatActions_(battle,skill,[{operation:'applyEffect',effectId:a.otherwiseEffectId,stacks:a.otherwiseStacks || 1}],[target],ctx);
  }
  if(a.operation==='explosion'){
    var stacks=Math.min(Number(a.max || 999),Number(ctx.consumedStacks || 0));
    var result=dealDamageToMonster_(battle,target,target.maxHp*stacks*Number(a.centerRate || 0)+amount(a.centerAddFormula,0),{damageKind:'explosion',sourceSkillId:skill.skillId});
    pushCombatDamageEvent_(battle,target,result,'explosion',skill.skillId);
    other.forEach(function(m){var r=dealDamageToMonster_(battle,m,m.maxHp*stacks*Number(a.otherRate || 0),{damageKind:'explosion',sourceSkillId:skill.skillId});pushCombatDamageEvent_(battle,m,r,'explosion',skill.skillId);});
    processSkillTriggers_(battle,'onExplosion',{target:target,damage:result.damage,sourceSkillId:skill.skillId,damageKind:'explosion'});
  }
  if(a.operation==='rewardBonus'){
    runtime.reward=runtime.reward || {};
    if(a.currencyPercent)runtime.reward.currencyPercent=Number(runtime.reward.currencyPercent || 0)+Number(a.currencyPercent);
    if(a.extraChoices)runtime.reward.extraChoices=Number(runtime.reward.extraChoices || 0)+Number(a.extraChoices);
    if(a.jackpot)runtime.reward.jackpot={turn:Number(battle.turn),hits:0};
  }
}

// Generic sheet operations: stack application, conditional mitigation, and
// effect-owned triggers. Values and action sequences live in EffectRules.
function modifyAppliedEffectStacks_(battle,skill,target,definition,context) {
  var engine=getSharedRuleEngine_(),runtime=engine.combatRuntime(battle);
  var group=String(context && context.effectTriggerGroup || runtime.actionId || '')+':'+Number(battle.turn)+':'+skill.skillId;
  var cache=runtime.stackApplicationBonus;
  if(!cache || cache.group!==group)cache=runtime.stackApplicationBonus={group:group,values:{}};
  var id=definition.effectId,bonus=Number(cache.values[id] || 0),consumed=[];
  (battle.player.effects || []).slice().forEach(function(effect){
    var matching=(effect.rules || []).filter(function(r){return r.operation==='modifyAppliedStacks' && r.triggerTiming==='onApplyEffect' && r.statKey===id;});
    if(!matching.length)return;
    var gain=matching.reduce(function(sum,r){return sum+engine.getEffectRuleValue(effect,r,battle.player);},0);
    var consume=(effect.rules || []).filter(function(r){return r.operation==='consumeOnApply' && r.triggerTiming==='onApplyEffect' && r.statKey===id;});
    bonus+=gain;
    if(consume.length){cache.values[id]=Number(cache.values[id] || 0)+gain;consumed.push({effect:effect,count:consume.reduce(function(sum,r){return sum+engine.getEffectRuleValue(effect,r,battle.player);},0)});}
  });
  var received=(target.effects || []).reduce(function(sum,e){return sum+(e.rules || []).filter(function(r){return r.operation==='modifyReceivedStacks' && r.triggerTiming==='onApplyEffect' && r.statKey===id;}).reduce(function(n,r){return n+engine.getEffectRuleValue(e,r,target);},0);},0);
  var count=Math.max(0,Math.round(Number(definition.stacks || 1)*(1+bonus/100)*(1+received/100)));
  if(count>0)consumed.forEach(function(entry){engine.consumeEffectStacks(battle.player,entry.effect.effectId,entry.count);});
  return count;
}

function modifyIncomingEffectRuleDamage_(battle,attacker,damage) {
  var engine=getSharedRuleEngine_();
  (battle.player.effects || []).forEach(function(effect){
    (effect.rules || []).forEach(function(rule){
      if(rule.operation==='incomingReductionIfEffect' && rule.triggerTiming==='passive' && engine.effectStacks(attacker,rule.statKey)>0)
        damage*=Math.max(0,1-Math.max(0,Math.min(100,engine.getEffectRuleValue(effect,rule,battle.player)))/100);
    });
  });
  return damage;
}

function processEffectRuleTriggers_(battle,timing,payload) {
  var engine=getSharedRuleEngine_(),player=battle.player;
  if(!player)return;
  (player.effects || []).slice().forEach(function(effect){
    (effect.rules || []).forEach(function(rule){
      if(rule.operation!=='triggerActions' || rule.triggerTiming!==timing)return;
      if(timing==='onBlock' && !(payload.shieldDamage>0 && payload.target && payload.target.currentHp>0))return;
      var config=safeJsonParse_(rule.valueFormula,{}),source=effect.sourceSkill;
      if(!source || Number(battle.turn)-Number(effect.appliedAtTurn || 0)<Number(config.minTurnOffset || 0))return;
      var counts=effect.ruleActivations || (effect.ruleActivations={}),key=String(rule.ruleOrder);
      if(config.maxActivations && Number(counts[key] || 0)>=Number(config.maxActivations))return;
      counts[key]=Number(counts[key] || 0)+1;
      if(config.maxActivations && counts[key]>=Number(config.maxActivations))engine.removeCombatEffect(player,effect.effectId,'consumed');
      var target=payload.target || getFirstAliveMonster_(battle),context=buildSkillFormulaContext_(battle,source,target,1);
      context.effectTriggerGroup='effect:'+engine.combatRuntime(battle).sequence+':'+effect.effectId;
      context.blockedDamage=Number(payload.shieldDamage || 0);
      executeCombatActions_(battle,source,config.actions,[target],context);
    });
  });
}

function processCombatStatusEvent_(battle,timing,payload) {
  processEffectRuleTriggers_(battle,timing,payload);
  processConfiguredCombatEvent_(battle,timing,payload);
  var runtime=getSharedRuleEngine_().combatRuntime(battle);
  if(timing==='onDamage'&&payload.target===battle.player&&payload.hpDamage>0)runtime.playerWasDamaged=true;
  if(timing==='onCritical'&&payload.actor==='player'&&runtime.reward&&runtime.reward.jackpot&&runtime.reward.jackpot.turn===Number(battle.turn))runtime.reward.jackpot.hits+=1;
  if(timing==='onTurnStart'&&runtime.delayedShield&&runtime.delayedShield.turn<=battle.turn){if(!combatShieldBlocked_(battle.player))battle.player.shield+=runtime.delayedShield.amount;delete runtime.delayedShield;}
  if(timing==='onHit'&&payload.actor==='player'){
    (battle.player.effects || []).forEach(function(e){var bank=combatEffectConfig_(e).criticalBank;if(bank)e.criticalBank=payload.isCritical?0:Math.min(bank.max,Number(e.criticalBank || 0)+1);});
  }
}

function modifyCombatAdditional_(battle,target,damage,context) {
  if(context.damageKind!=='additional')return damage;
  var bonus=0,shieldMultiplier=1;
  (target.effects || []).slice().forEach(function(e){var c=combatEffectConfig_(e).additional;
    if(!c || (c.effectId && c.effectId!==context.effectId))return;
    if(c.uses && Number(e.additionalUses || 0)>=c.uses)return;
    bonus+=Number(c.multiplier || 1)-1;
    if(c.shieldMultiplier)shieldMultiplier*=c.shieldMultiplier;
    e.additionalUses=Number(e.additionalUses || 0)+1;
    if(c.uses && e.additionalUses>=c.uses)getSharedRuleEngine_().removeCombatEffect(target,e.effectId,'consumed');
  });
  damage=Math.round(damage*(1+bonus));
  context.shieldOnlyDamage=damage*(shieldMultiplier-1);
  return damage;
}

function relayCombatAdditional_(battle,target,damage,context) {
  if(context.damageKind!=='additional')return;
  (target.effects || []).forEach(function(e){var c=combatEffectConfig_(e).relay;if(!c || c.effectId!==context.effectId)return;
    var alive=getAliveMonsters_(battle);
    var others=alive.filter(function(m){return m!==target && (c.requireOtherEffect===false || getSharedRuleEngine_().effectStacks(m,c.effectId)>0);});
    var recipients=c.allOthers ? others : others.slice(0,1);
    if(c.sameTargetIfAlone && alive.length===1 && alive[0]===target)recipients=[target];
    recipients.forEach(function(other){
      var amount=Number(c.useAppliedDamage ? damage : context.baseAdditionalDamage || 0)*Number(c.ratio === undefined ? 1 : c.ratio);
      // Relay is effect damage internally so it cannot recursively trigger shock.
      var r=dealDamageToMonster_(battle,other,amount,{damageKind:'effect',sourceSkillId:context.sourceSkillId});
      r.effectId=context.effectId;
      pushCombatDamageEvent_(battle,other,r,'additional',context.sourceSkillId);
    });
  });
}

function pushCombatDamageEvent_(battle,target,result,kind,skillId) {
  battle.lastTurnEvents.splice(Number.isInteger(result.eventIndex) ? result.eventIndex : battle.lastTurnEvents.length,0,Object.assign({actor:'effect',type:'effectDamage',target:'monster',targetMonsterId:target.instanceId || target.monsterId,damageKind:kind,skillId:skillId || ''},result));
}

function combatDotModifiers_(battle,target,effect,base,damageRule) {
  var result={damage:base,preserve:false,reapply:0},engine=getSharedRuleEngine_(),bonus=0,add=0;
  (target.effects || []).slice().forEach(function(marker){var c=combatEffectConfig_(marker).dot;
    if(!c || c.effectId!==effect.effectId)return;
    if(c.onNaturalZero){if(Number(effect.stacks)>Number(effect.decayStacks || 1))return;result.reapply=Number(c.onNaturalZero);}
    if(c.extraStacksFromValue && damageRule)result.damage+=engine.getEffectRuleValue(Object.assign({},effect,{stacks:Number(effect.stacks)+Number(marker.value || 0)}),damageRule,target)-engine.getEffectRuleValue(effect,damageRule,target);
    bonus+=Number(c.multiplier || 1)-1;add+=c.addValue?Number(marker.value || 0):0;
    if(c.preserveDecay)result.preserve=true;
    if(c.uses){marker.dotUses=Number(marker.dotUses || 0)+1;if(marker.dotUses>=c.uses)engine.removeCombatEffect(target,marker.effectId,'consumed');}
  });
  result.damage=Math.max(0,Math.round(result.damage*Math.min(2,Math.max(0,1+bonus))+add));return result;
}

function applyCooldownModify_(battleState, skill, cooldownRule) {
  if (!cooldownRule) {
    return;
  }
  if (typeof cooldownRule !== 'object') {
    warnSkillRule_(battleState, skill, 'cooldownModify must be an object.', { cooldownModify: cooldownRule });
    return;
  }
  var supportedKeys = ['target', 'amount', 'skillId', 'targetSkillId', 'tag'];
  Object.keys(cooldownRule).forEach(function(key) {
    if (supportedKeys.indexOf(key) === -1) {
      warnSkillRule_(battleState, skill, 'Unsupported cooldownModify key: ' + key, { key: key });
    }
  });
  battleState.skillCooldowns = battleState.skillCooldowns || {};
  var amount = Number(cooldownRule.amount || 0);
  var targetSkillId = cooldownRule.skillId || cooldownRule.targetSkillId || '';
  if (cooldownRule.target === 'randomOwnSkill') {
    var ids = Object.keys(battleState.skillCooldowns).filter(function(skillId) {
      return Number(battleState.skillCooldowns[skillId] || 0) > 0 && skillId !== skill.skillId;
    });
    targetSkillId = ids.length ? ids[Math.floor(Math.random() * ids.length)] : '';
  }
  if (!targetSkillId) {
    warnSkillRule_(battleState, skill, 'cooldownModify had no target skill.', { cooldownModify: cooldownRule });
    return;
  }
  battleState.skillCooldowns[targetSkillId] = Math.max(0, Number(battleState.skillCooldowns[targetSkillId] || 0) + amount);
}

function applySkillTagBonusToValue_(battleState, skill, tagBonus, value) {
  if (!tagBonus) {
    return value;
  }
  var tag = tagBonus.tag || tagBonus.requireTag || '';
  if (tag && !hasSkillTag_(skill, tag)) {
    return value;
  }
  var next = Number(value || 0);
  if (tagBonus.damageMultiplier) {
    next *= Number(tagBonus.damageMultiplier || 1);
  }
  if (tagBonus.percent) {
    next *= 1 + (Number(tagBonus.percent || 0) / 100);
  }
  if (tagBonus.add) {
    next += Number(tagBonus.add || 0);
  }
  return next;
}

function registerActiveSkillTagBonus_(battleState, skill, tagBonus, context) {
  if (!battleState || !skill || !tagBonus) {
    return;
  }

  var normalized = normalizeActiveSkillTagBonus_(battleState, skill, tagBonus, context || {});
  if (!normalized) {
    return;
  }

  battleState.activeTagBonuses = (battleState.activeTagBonuses || []).filter(function(existing) {
    return existing && existing.sourceSkillId !== normalized.sourceSkillId;
  });
  battleState.activeTagBonuses.push(normalized);
  battleState.lastTurnEvents = battleState.lastTurnEvents || [];
  battleState.lastTurnEvents.push({
    actor: 'player',
    type: 'buff',
    skillId: skill.skillId,
    message: (skill.name || '스킬') + ' 효과로 ' + normalized.tag + ' 스킬 피해가 증가했습니다.',
  });
  upsertActiveTagBonusBuffIcon_(battleState, normalized);
}

function normalizeActiveSkillTagBonus_(battleState, skill, tagBonus, context) {
  var tag = String(tagBonus.tag || tagBonus.requireTag || tagBonus.skillTag || '').trim();
  if (!tag) {
    return null;
  }

  var damageMultiplier = tagBonus.damageMultiplier !== undefined ? Number(tagBonus.damageMultiplier || 1) : 1;
  if (tagBonus.damageMultiplierFormula) {
    damageMultiplier = evaluateSkillFormulaValue_(tagBonus.damageMultiplierFormula, context, damageMultiplier, battleState, skill);
  }

  var damageAdd = tagBonus.damageAdd !== undefined ? Number(tagBonus.damageAdd || 0) : Number(tagBonus.add || 0);
  if (tagBonus.damageAddFormula) {
    damageAdd = evaluateSkillFormulaValue_(tagBonus.damageAddFormula, context, damageAdd, battleState, skill);
  }

  return {
    sourceSkillId: skill.skillId || '',
    sourceSkillName: skill.name || skill.skillId || '',
    tag: tag,
    damageMultiplier: isFinite(damageMultiplier) ? Number(damageMultiplier || 1) : 1,
    damageAdd: isFinite(damageAdd) ? Number(damageAdd || 0) : 0,
    durationType: tagBonus.durationType || 'battle',
    remainingTurns: Number(tagBonus.durationTurns || 0),
    createdAtTurn: Number(battleState.turn || 1),
  };
}

function applyActiveSkillTagBonuses_(battleState, skill, damage, context) {
  var result = Number(damage || 0);
  var bonuses = battleState && battleState.activeTagBonuses || [];
  if (!bonuses.length || result <= 0) {
    return Math.max(0, Math.round(result));
  }

  var tags = normalizeSkillTags_(skill && skill.tags);
  bonuses.forEach(function(bonus) {
    if (!bonus || tags.indexOf(bonus.tag) === -1) {
      return;
    }
    if (bonus.sourceSkillId && skill && bonus.sourceSkillId === skill.skillId) {
      return;
    }
    result *= Number(bonus.damageMultiplier || 1);
    result += Number(bonus.damageAdd || 0);
  });

  return Math.max(0, Math.round(result));
}

function upsertActiveTagBonusBuffIcon_(battleState, bonus) {
  if (!battleState || !battleState.player || !bonus) {
    return;
  }

  var effectId = buildActiveTagBonusEffectId_(bonus);
  var effect = {
    effectId: effectId,
    name: bonus.sourceSkillName || '태그 강화',
    category: EFFECT_CATEGORIES.BUFF,
    statKey: '',
    effectType: EFFECT_TYPES.CONTROL,
    value: 0,
    description: buildActiveTagBonusDescription_(bonus),
    durationType: bonus.durationType || 'battle',
    remainingTurns: bonus.remainingTurns || '',
    stackable: false,
    maxStacks: 1,
    triggerTiming: TRIGGER_TIMINGS.PASSIVE,
    stacks: 1,
    source: {
      source: 'skillTagBonus',
      skillId: bonus.sourceSkillId || '',
      tag: bonus.tag || '',
    },
  };

  battleState.player.effects = (battleState.player.effects || []).filter(function(existing) {
    return existing && existing.effectId !== effectId;
  });
  battleState.player.effects.push(effect);
  battleState.player.buffs = battleState.player.effects.filter(function(existing) {
    return existing && existing.category === EFFECT_CATEGORIES.BUFF;
  });
  battleState.player.debuffs = battleState.player.effects.filter(function(existing) {
    return existing && existing.category === EFFECT_CATEGORIES.DEBUFF;
  });
}

function buildActiveTagBonusEffectId_(bonus) {
  return 'buff_skill_tag_bonus_' + String(bonus && bonus.sourceSkillId || 'unknown').replace(/[^0-9A-Za-z_-]/g, '_');
}

function buildActiveTagBonusDescription_(bonus) {
  var tag = String(bonus && bonus.tag || '태그');
  var parts = [];
  if (bonus && bonus.damageMultiplier && Number(bonus.damageMultiplier) !== 1) {
    parts.push(tag + ' 스킬 피해 ' + Math.round((Number(bonus.damageMultiplier || 1) - 1) * 100) + '% 증가');
  }
  if (bonus && Number(bonus.damageAdd || 0)) {
    parts.push(tag + ' 스킬 추가 피해 +' + Number(bonus.damageAdd || 0));
  }
  return parts.length ? parts.join(', ') : tag + ' 스킬 강화';
}

function trackSkillTagsForUse_(battleState, skill) {
  normalizeSkillRuntimeState_(battleState);
  var tags = normalizeSkillTags_(skill.tags);
  tags.forEach(function(tag) {
    if (battleState.usedSkillTagsThisBattle.indexOf(tag) === -1) battleState.usedSkillTagsThisBattle.push(tag);
    if (battleState.usedSkillTagsThisTurn.indexOf(tag) === -1) battleState.usedSkillTagsThisTurn.push(tag);
    battleState.usedSkillCountByTagThisBattle[tag] = Number(battleState.usedSkillCountByTagThisBattle[tag] || 0) + 1;
    battleState.usedSkillCountByTagThisTurn[tag] = Number(battleState.usedSkillCountByTagThisTurn[tag] || 0) + 1;
  });
}

function setSkillCooldownAfterUse_(battleState, skill) {
  normalizeSkillRuntimeState_(battleState);
  var reset=battleState.combatRuntime && battleState.combatRuntime.assassinCooldownResets || {};
  if(reset[skill.skillId]){battleState.skillCooldowns[skill.skillId]=0;delete reset[skill.skillId];return;}
  var cooldown = parseSkillCooldown_(skill && skill.cooldown);
  if (cooldown <= 0) {
    return;
  }
  battleState.skillCooldowns[skill.skillId] = Math.max(0, cooldown);
  battleState.skillCooldownStartedTurns[skill.skillId] = Number(battleState.turn || 1);
}

function decrementSkillCooldowns_(battleState) {
  normalizeSkillRuntimeState_(battleState);
  var currentTurn = Number(battleState.turn || 1);
  Object.keys(battleState.skillCooldowns).forEach(function(skillId) {
    var startedTurn = Number(battleState.skillCooldownStartedTurns[skillId] || 0);
    // The use turn counts toward the cooldown: 1 is ready next turn.
    if (startedTurn && currentTurn <= startedTurn) {
      return;
    }
    battleState.skillCooldowns[skillId] = Math.max(0, Number(battleState.skillCooldowns[skillId] || 0) - 1);
    if (Number(battleState.skillCooldowns[skillId] || 0) <= 0) {
      delete battleState.skillCooldownStartedTurns[skillId];
    }
  });
  return battleState.skillCooldowns;
}

function parseSkillCooldown_(value) {
  if (value === '' || value === null || value === undefined) {
    return 0;
  }
  var match = String(value).match(/-?\d+(?:\.\d+)?/);
  return Math.max(0, Math.round(Number(match ? match[0] : value || 0)));
}

function cleanupSkillTriggersForTurn_(battleState) {
  battleState.activeTriggers = (battleState.activeTriggers || []).map(function(trigger) {
    if (trigger.durationType === 'turn') {
      trigger.remainingTurns = Number(trigger.remainingTurns || 1) - 1;
    }
    return trigger;
  }).filter(function(trigger) {
    return trigger.durationType !== 'turn' || Number(trigger.remainingTurns || 0) > 0;
  });
  return battleState.activeTriggers;
}

function applyEffect(target, effect, source) {
  return getSharedRuleEngine_().applyEffect(target, effect, source || {}, source && source.turn);
}

function tickEffectsAtTurnStart(battleState) {
  var firstTurnStartEvent = (battleState.lastTurnEvents || []).length;
  normalizeBattleStateEffects_(battleState);
  beginCombatActorTurn_(battleState, battleState.player);
  processSkillTriggers_(battleState, 'onTurnStart', {});
  applyStackedDamageEffects_(battleState.player, 'turnStart', battleState, 'player');
  applyTimedEffectDamage_(battleState.player, TRIGGER_TIMINGS.TURN_START, battleState, 'player');
  getAliveMonsters_(battleState).forEach(function(monster) {
    getSharedRuleEngine_().decayCombatStacks(monster, 'turnStart', battleState.turn);
    applyStackedDamageEffects_(monster, 'turnStart', battleState, 'monster');
    applyTimedEffectDamage_(monster, TRIGGER_TIMINGS.TURN_START, battleState, 'monster');
  });
  (battleState.lastTurnEvents || []).slice(firstTurnStartEvent).forEach(function(event) {
    event.turnPhase = 'playerTurnStart';
  });
  return battleState;
}

function tickEffectsOnPlayerAction(battleState) {
  normalizeBattleStateEffects_(battleState);
  applyStackedDamageEffects_(battleState.player, 'beforeAction', battleState, 'player');
  applyStackedDamageEffects_(battleState.player, 'onAction', battleState, 'player');
  applyTimedEffectDamage_(battleState.player, TRIGGER_TIMINGS.ON_ACTION, battleState, 'player');
  return battleState;
}

function tickEffectsAtTurnEnd(battleState) {
  normalizeBattleStateEffects_(battleState);
  processSkillTriggers_(battleState, 'onTurnEnd', {});
  applyTimedEffectDamage_(battleState.player, TRIGGER_TIMINGS.TURN_END, battleState, 'player');
  getAliveMonsters_(battleState).forEach(function(monster) {
    applyStackedDamageEffects_(monster, 'turnEnd', battleState, 'monster');
    applyTimedEffectDamage_(monster, TRIGGER_TIMINGS.TURN_END, battleState, 'monster');
    decrementTurnEffects_(monster, battleState);
  });
  applyStackedDamageEffects_(battleState.player, 'turnEnd', battleState, 'player');
  decrementTurnEffects_(battleState.player, battleState);
  syncConfiguredCombatStats_(battleState);
  normalizePlayerActionPoints_(battleState,false);
  cleanupSkillTriggersForTurn_(battleState);
  return battleState;
}

function clearStageDurationEffects(battleState) {
  normalizeBattleStateEffects_(battleState);
  battleState.player.effects = filterNonStageEffects_(battleState.player.effects);
  (battleState.monsters || []).forEach(function(monster) {
    monster.effects = filterNonStageEffects_(monster.effects);
  });
  return battleState;
}

function calculateEffectiveStats(baseStats, activeEffects) {
  return getSharedRuleEngine_().calculateEffectiveStats(baseStats, activeEffects);
}

function calculateFinalQuestionTimeLimit(baseDifficulty, activeEffects, questionModifiers) {
  var finalDifficulty = clampDifficulty_(Number(baseDifficulty || GAME_RULES.MIN_DIFFICULTY));
  var extraSeconds = getEffectFlatBonus_(activeEffects, STAT_KEYS.QUESTION_TIME);
  extraSeconds += (activeEffects || []).reduce(function(total, effect) {
    return total + (!effect.rules && effect.statKey === 'caffeine' ? Math.max(1, Number(effect.stacks || 1)) * 0.3 : 0);
  }, 0);
  extraSeconds += Number(questionModifiers && questionModifiers.questionTimeSeconds || 0);
  var timeSettings = getQuestionTimeSettings_();
  var seconds = timeSettings.baseQuestionTimeSec + ((finalDifficulty - 1) * timeSettings.questionTimePerDifficultySec) + extraSeconds;
  return clampQuestionTimeMs_(seconds * 1000, timeSettings);
}

function calculateFinalQuestionTimeLimitForQuestion_(baseDifficulty, activeEffects, question, questionModifiers) {
  var maxMs = calculateFinalQuestionTimeLimit(baseDifficulty, activeEffects, questionModifiers);
  if (isShortAnswerQuestion_(question)) {
    return clampQuestionTimeMs_(Math.round(maxMs * Number(GAME_RULES.SHORT_ANSWER_TIME_MULTIPLIER || 1.2)), getQuestionTimeSettings_());
  }
  return maxMs;
}

function getQuestionTimeSettings_() {
  var settings = {};
  try {
    settings = getAppSettings();
  } catch (error) {
    settings = {};
  }
  return {
    baseQuestionTimeSec: getNumberSettingByKeys_(settings, ['baseQuestionTimeSec', 'questionBaseTimeSec', '기본문제시간', '기본 문제 시간', '기본 문제 시간(초)'], GAME_RULES.BASE_QUESTION_TIME_SEC),
    questionTimePerDifficultySec: getNumberSettingByKeys_(settings, ['questionTimePerDifficultySec', 'questionTimePerDifficulty', '난이도당문제시간', '난이도당 문제 시간', '난이도당 문제 시간(초)'], GAME_RULES.QUESTION_TIME_PER_DIFFICULTY_SEC),
    maxQuestionTimeSec: getNumberSettingByKeys_(settings, ['maxQuestionTimeSec', 'questionMaxTimeSec', 'maximumQuestionTimeSec', 'maxQuestionTime', 'questionTimeMaxSec', '최대문제시간', '최대 문제 시간', '최대 문제 시간(초)'], 0),
  };
}

function getNumberSettingByKeys_(settings, keys, fallback) {
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    if (settings && settings[key] !== undefined && settings[key] !== '') {
      var number = Number(settings[key]);
      if (isFinite(number)) {
        return number;
      }
    }
  }
  return Number(fallback || 0);
}

function clampQuestionTimeMs_(ms, timeSettings) {
  var value = Math.max(3000, Math.round(Number(ms || 0)));
  var maxSeconds = Number(timeSettings && timeSettings.maxQuestionTimeSec || 0);
  if (isFinite(maxSeconds) && maxSeconds > 0) {
    value = Math.min(value, Math.max(3000, Math.round(maxSeconds * 1000)));
  }
  return value;
}

function isShortAnswerQuestion_(question) {
  return question && question.type === QUESTION_TYPES.SHORT_ANSWER;
}

function getSkillUpgradeValue(skill, key) {
  var upgrade = safeJsonParse_(skill.upgradeJson, {});
  var level = Math.max(1, Number(skill.level || 1));
  var upgradeLevel = Math.max(0, level - 1);
  var raw = upgrade[key];
  if (raw === undefined || raw === null || raw === '') {
    return 0;
  }
  if (typeof raw === 'number' || /^-?\d+(?:\.\d+)?$/.test(String(raw).trim())) {
    return Number(raw || 0) * upgradeLevel;
  }
  return getSharedRuleEngine_().evaluateFormula(String(raw), {
    n: upgradeLevel,
    upgrade: upgradeLevel,
    level: level,
    skillLevel: level,
    base: Number(skill.baseValue || 0),
    baseValue: Number(skill.baseValue || 0),
    skillBaseValue: Number(skill.baseValue || 0),
  }, {
    warn: function(message, data) {
      warnSkillRule_(null, skill, 'Invalid upgradeJson formula for ' + key + ': ' + message, data || {});
    },
  });
}

function buildSkillPreviewText_(skill, battleState) {
  var rule = getSkillExecutionRule_(skill);
  if (shouldUseSkillRuleEngine_(rule)) {
    return buildSkillRulePreviewText_(skill, battleState, rule);
  }

  var effectiveStats = calculateEffectiveStats((battleState.player && battleState.player.stats) || {}, (battleState.player && battleState.player.effects) || []);
  var baseValue = Number(skill.baseValue || 0);
  var hitCount = Math.max(1, Number(skill.hitCount || 1));
  var effectBonus = getSkillUpgradeValue(skill, 'effect');
  var damageBonus = getSkillUpgradeValue(skill, 'damage');

  if (skill.type === SKILL_TYPES.DAMAGE) {
    var damage = Math.max(0, Math.round(baseValue + damageBonus + Number(effectiveStats.attack || 0)));
    return hitCount > 1 ? '피해 ' + damage + ' x ' + hitCount + ' x 효율' : '피해 ' + damage + ' x 효율';
  }
  if (skill.type === SKILL_TYPES.SHIELD) {
    var shield = Math.max(0, Math.round(baseValue + Number(effectiveStats.defense || 0)));
    return '방어막 ' + shield + ' x 효율';
  }
  if (skill.type === SKILL_TYPES.HEAL) {
    return '회복 ' + Math.max(0, Math.round(baseValue + damageBonus + effectBonus)) + ' x 효율';
  }

  var config = safeJsonParse_(skill.effectJson, {});
  if (config.effectId) {
    var effect = findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', config.effectId, 600);
    if (effect) {
      var value = Number(effect.value || 0);
      if (effect.effectType === EFFECT_TYPES.FLAT) {
        value += getSkillUpgradeValue(skill, 'buffValue');
      }
      var chance = Number(config.chance || 100) + (skill.type === SKILL_TYPES.DEBUFF ? getSkillUpgradeValue(skill, 'debuffChance') : getSkillUpgradeValue(skill, 'chance'));
      var sign = value > 0 ? '+' : '';
      return effect.name + ' ' + sign + value + (effect.effectType === EFFECT_TYPES.PERCENT ? '%' : '') + ' / ' + Math.min(100, Math.max(0, chance)) + '%';
    }
  }

  return '효율 적용';
}

function buildSkillCooldownText_(skill) {
  if (skill.cooldown !== '' && skill.cooldown !== null && skill.cooldown !== undefined) {
    var cooldown = parseSkillCooldown_(skill.cooldown);
    return cooldown > 0 ? '쿨타임 ' + cooldown + '턴' : '쿨타임 없음';
  }

  var conditions = safeJsonParse_(skill.conditionJson, {});
  if (conditions.perStageLimit) {
    return '스테이지 ' + Number(conditions.perStageLimit || 0) + '회';
  }
  return '쿨타임 없음';
}

function buildSkillUseLimitText_(skill, battleState) {
  var conditions = safeJsonParse_(skill.conditionJson, {});
  var limit = 0;
  var scope = '';
  if (conditions.perStageLimit) {
    limit = Number(conditions.perStageLimit || 0);
    scope = '스테이지';
  } else if (conditions.perBattleLimit) {
    limit = Number(conditions.perBattleLimit || 0);
    scope = '전투';
  }
  if (!limit) {
    return '';
  }
  var used = getSkillUseCount_(battleState, skill.skillId);
  var remaining = Math.max(0, limit - used);
  return scope + ' ' + remaining + '/' + limit + '회';
}

function buildRunState_(run) {
  return {
    runId: run.runId,
    playerId: run.playerId,
    currentFloor: Number(run.currentFloor || 1),
    currentStage: Number(run.currentStage || 1),
    stats: safeJsonParse_(run.statsJson, getConfiguredBasePlayerStats_()),
    skills: normalizeOwnedSkills_(safeJsonParse_(run.skillsJson, [])),
    skillsJson: run.skillsJson,
    items: safeJsonParse_(run.itemsJson, []),
  };
}

function getOwnedSkillForRun_(runState, skillId) {
  var owned = normalizeOwnedSkills_(runState.skills).filter(function(skill) {
    return skill.skillId === skillId;
  })[0];
  if (!owned) {
    throw new Error('보유하지 않은 스킬입니다.');
  }
  var row = findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', skillId, 600);
  if (!row) {
    throw new Error('스킬을 찾을 수 없습니다: ' + skillId);
  }
  return hydrateSkill_(row, owned.level);
}

function hydrateSkill_(skill, level) {
  // Compatibility for the malformed legacy row observed in the Skills sheet.
  // Valid edited definitions always take precedence over these defaults.
  if (skill.skillId === 'skill_multi_attack') {
    skill = Object.assign({}, skill);
    if (!safeJsonParse_(skill.effectJson, null)) {
      skill.effectJson = '{"targetMode":"singleEnemy","hitCount":3,"damageFormula":"attack*0.4"}';
    }
    if (!safeJsonParse_(skill.conditionJson, null)) {
      skill.conditionJson = '{"afterTurn":1,"perStageLimit":3}';
    }
  }
  var rarity = normalizeRarity_(skill.rarity || RARITIES.COMMON);
  var conditions = safeJsonParse_(skill.conditionJson, {});
  if (conditions.perBattleLimitFormula) {
    conditions.perBattleLimit = Math.max(1, Math.floor(getSharedRuleEngine_().evaluateFormula(conditions.perBattleLimitFormula, {level:Math.max(1,Number(level || skill.level || 1))}, {})));
    skill = Object.assign({}, skill, {conditionJson:JSON.stringify(conditions)});
  }
  return Object.assign({}, skill, {
    level: Math.max(1, Number(level || skill.level || 1)),
    baseValue: Number(skill.baseValue || 0),
    hitCount: Number(skill.hitCount || 1),
    difficultyBonus: Number(skill.difficultyBonus || 0),
    actionPointCost: Math.max(0, Math.min(3, Number(skill.actionPointCost !== undefined && skill.actionPointCost !== '' ? skill.actionPointCost : 1))),
    rarity: rarity,
    tags: normalizeSkillTags_(skill.tags),
  });
}

function normalizeSkillTags_(tagsValue) {
  if (Array.isArray(tagsValue)) {
    return tagsValue.map(function(tag) {
      return String(tag || '').trim();
    }).filter(Boolean);
  }

  var value = String(tagsValue || '').trim();
  if (!value) {
    return [];
  }

  var parsed = safeJsonParse_(value, null);
  if (Array.isArray(parsed)) {
    return normalizeSkillTags_(parsed);
  }

  return value.split(',').map(function(tag) {
    return tag.trim();
  }).filter(Boolean);
}

function hasSkillTag_(skill, tag) {
  var targetTag = String(tag || '').trim();
  if (!targetTag) {
    return false;
  }
  return normalizeSkillTags_(skill && skill.tags).indexOf(targetTag) !== -1;
}

function getSkillTagList(skillId) {
  var row = findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', skillId, 600);
  return row ? normalizeSkillTags_(row.tags) : [];
}

function normalizeOwnedSkills_(skills) {
  return (skills || []).map(function(skill) {
    if (typeof skill === 'string') {
      return { skillId: skill, level: 1 };
    }
    return {
      skillId: String(skill.skillId || '').trim(),
      level: Math.max(1, Number(skill.level || 1)),
    };
  }).filter(function(skill) {
    return !!skill.skillId;
  });
}

function normalizeBattleStateEffects_(battleState) {
  normalizeSkillRuntimeState_(battleState);
  if (!battleState || !battleState.player) return;
  normalizeBattleMonsters_(battleState);
  (battleState.monsters || []).forEach(function(monster) {
    normalizeTargetStatusBuckets_(monster);
  });
  normalizeTargetStatusBuckets_(battleState.player);
}

function normalizeTargetStatusBuckets_(target) {
  if (!target) return target;
  var merged = [];
  var seen = {};
  function fillMissingStatusFields_(targetEffect, sourceEffect) {
    Object.keys(sourceEffect).forEach(function(key) {
      if (targetEffect[key] === undefined || targetEffect[key] === null || targetEffect[key] === '') {
        targetEffect[key] = sourceEffect[key];
      }
    });
  }
  function addEffect(effect, fallbackCategory) {
    if (!effect) return;
    var next = Object.assign({}, effect);
    next.category = normalizeEffectCategory_(next, fallbackCategory);
    next = hydrateEffectDisplayFields_(next);
    next.category = normalizeEffectCategory_(next, fallbackCategory);
    var key = String(next.effectId || next.id || next.name || merged.length);
    if (seen[key]) {
      fillMissingStatusFields_(seen[key], next);
      return;
    }
    seen[key] = next;
    merged.push(next);
  }
  (target.effects || []).forEach(function(effect) { addEffect(effect, ''); });
  (target.buffs || []).forEach(function(effect) { addEffect(effect, EFFECT_CATEGORIES.BUFF); });
  (target.debuffs || []).forEach(function(effect) { addEffect(effect, EFFECT_CATEGORIES.DEBUFF); });
  target.effects = merged;
  target.buffs = merged.filter(function(effect) {
    return normalizeEffectCategory_(effect, '') === EFFECT_CATEGORIES.BUFF;
  });
  target.debuffs = merged.filter(function(effect) {
    return normalizeEffectCategory_(effect, '') === EFFECT_CATEGORIES.DEBUFF;
  });
  return target;
}

function normalizeEffectCategory_(effect, fallbackCategory) {
  var category = String(effect && effect.category || fallbackCategory || '').toLowerCase();
  if (!category && /^buff_/i.test(String(effect && effect.effectId || ''))) {
    category = EFFECT_CATEGORIES.BUFF;
  }
  if (!category && /^debuff_/i.test(String(effect && effect.effectId || ''))) {
    category = EFFECT_CATEGORIES.DEBUFF;
  }
  return category;
}

function hydrateEffectDisplayFields_(effect) {
  // Keep the existing saved-state normalization for legacy IDs. The rules
  // below control behavior; new effects need no ID-specific normalization.
  if (effect && effect.effectId === 'debuff_burn') {
    effect.durationType = DURATION_TYPES.TURN;
    effect.stackable = true;
    effect.maxStacks = Math.max(1, Number(effect.maxStacks || 99));
    effect.triggerTiming = TRIGGER_TIMINGS.TURN_START;
    effect.description = '턴 시작 시 스택당 최대 체력의 1% 피해를 받고 스택 1을 소모한다. 보호막이 먼저 피해를 흡수한다.';
  }
  if (effect && effect.effectId === 'debuff_bleed') {
    effect.durationType = DURATION_TYPES.TURN;
    effect.stackable = true;
    effect.maxStacks = Math.max(1, Number(effect.maxStacks || 99));
    effect.triggerTiming = TRIGGER_TIMINGS.ON_ACTION;
    effect.description = '대상이 행동할 때 스택당 최대 체력의 0.7% 피해를 받고 스택 1을 소모한다. 보호막을 무시한다.';
  }
  if (effect && effect.effectId === 'debuff_poison') {
    effect.durationType = DURATION_TYPES.TURN;
    effect.stackable = true;
    effect.maxStacks = Math.max(1, Number(effect.maxStacks || 99));
    effect.triggerTiming = TRIGGER_TIMINGS.TURN_END;
    effect.description = '턴 종료 시 스택당 1 피해를 받고 스택 1을 소모한다. 보호막을 무시한다.';
  }
  if (effect && effect.effectId === 'debuff_foolish') {
    effect.name = effect.name || '멍청해짐';
    effect.category = EFFECT_CATEGORIES.DEBUFF;
    effect.statKey = STAT_KEYS.QUESTION_DIFFICULTY;
    effect.effectType = EFFECT_TYPES.FLAT;
    effect.value = 1;
    effect.stackable = true;
    effect.maxStacks = Math.max(1, Number(effect.maxStacks || 99));
    effect.description = 'N턴간 문제 난이도 +1.';
  }
  if (!effect || !effect.effectId) {
    return effect;
  }
  var master = findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effect.effectId, 600);
  if (!master) {
    return effect;
  }
  if (master.rules) {
    ['rules', 'rulesVersion', 'stackMode', 'reapplyDurationPolicy', 'durationClock', 'decayTiming', 'decayStacks', 'decrementOnApplyTurn'].forEach(function(key) { effect[key] = master[key]; });
  }
  effect.name = effect.name || master.name || '';
  effect.description = effect.description || master.description || '';
  effect.category = effect.category || master.category || '';
  effect.statKey = effect.statKey || master.statKey || '';
  effect.effectType = effect.effectType || master.effectType || '';
  effect.value = effect.value !== undefined && effect.value !== '' ? effect.value : master.value;
  effect.durationType = effect.durationType || master.durationType || '';
  effect.durationTurns = effect.durationTurns !== undefined && effect.durationTurns !== '' ? effect.durationTurns : master.durationTurns;
  effect.stackable = effect.stackable !== undefined && effect.stackable !== '' ? effect.stackable : master.stackable;
  effect.maxStacks = effect.maxStacks || master.maxStacks || 1;
  effect.triggerTiming = effect.triggerTiming || master.triggerTiming || '';
  return effect;
}

function normalizeSkillRuntimeState_(battleState) {
  if (!battleState) {
    return battleState;
  }
  battleState.skillCooldowns = battleState.skillCooldowns || {};
  battleState.skillCooldownStartedTurns = battleState.skillCooldownStartedTurns || {};
  battleState.skillUseCounts = battleState.skillUseCounts || {};
  battleState.usedSkillTagsThisBattle = battleState.usedSkillTagsThisBattle || [];
  battleState.usedSkillTagsThisTurn = battleState.usedSkillTagsThisTurn || [];
  battleState.usedSkillCountByTagThisBattle = battleState.usedSkillCountByTagThisBattle || {};
  battleState.usedSkillCountByTagThisTurn = battleState.usedSkillCountByTagThisTurn || {};
  battleState.activeTriggers = battleState.activeTriggers || [];
  Object.keys(battleState.skillCooldowns).forEach(function(skillId) {
    battleState.skillCooldowns[skillId] = Math.max(0, Number(battleState.skillCooldowns[skillId] || 0));
  });
  return battleState;
}

function getActiveEffectsForQuestion_(battleState) {
  normalizeBattleStateEffects_(battleState);
  return battleState.player.effects || [];
}

function getSkillTarget_(battleState, skill, explicitTargetId) {
  if (skill.target === 'self') {
    return battleState.player;
  }
  if (explicitTargetId) {
    return getAliveMonsterById_(battleState, explicitTargetId) || getFirstAliveMonster_(battleState);
  }
  return getFirstAliveMonster_(battleState);
}

function isAllEnemiesSkill_(skill) {
  var target = String(skill && skill.target || '').toLowerCase();
  return target === 'allenemies' || target === 'all_enemies' || target === 'all-enemies' || target === 'enemies';
}

function isRandomEnemiesSkill_(skill) {
  var target = String(skill && skill.target || '').toLowerCase();
  if (target === 'randomenemy' || target === 'random_enemy' || target === 'random-enemy' || target === 'randomenemies' || target === 'random_enemies' || target === 'random-enemies') {
    return true;
  }
  var rule = getSkillExecutionRule_(skill);
  var targetMode = String(rule && rule.targetMode || '').toLowerCase();
  return targetMode === 'randomenemy' || targetMode === 'random_enemy' || targetMode === 'random-enemy'
    || targetMode === 'randomenemies' || targetMode === 'random_enemies' || targetMode === 'random-enemies';
}

function applySkillLinkedEffect_(target, skill, source, battleState) {
  var config = safeJsonParse_(skill.effectJson, {});
  applyActionPointEffectConfig_(target, config);
  if (!config.effectId) {
    return null;
  }
  var chance = Number(config.chance || 100);
  if (skill.type === SKILL_TYPES.DEBUFF) {
    chance += getSkillUpgradeValue(skill, 'debuffChance');
  } else {
    chance += getSkillUpgradeValue(skill, 'chance');
  }
  if (Math.random() * 100 > chance) {
    return null;
  }
  var effect = findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', config.effectId, 600);
  if (!effect) {
    throw new Error('효과를 찾을 수 없습니다: ' + config.effectId);
  }
  var upgraded = Object.assign({}, effect);
  if (config.value !== undefined) {
    upgraded.value = Number(config.value || 0);
  } else if (upgraded.effectType === EFFECT_TYPES.FLAT) {
    upgraded.value = Number(upgraded.value || 0) + getSkillUpgradeValue(skill, upgraded.category === EFFECT_CATEGORIES.BUFF ? 'buffValue' : 'effect');
  }
  if (config.durationType) {
    upgraded.durationType = config.durationType;
  }
  if (config.durationTurns !== undefined) {
    upgraded.durationTurns = config.durationTurns;
  }
  if (config.stackable !== undefined) {
    upgraded.stackable = config.stackable;
  }
  if (config.maxStacks !== undefined) {
    upgraded.maxStacks = Number(config.maxStacks || 1);
  }
  return applyEffect(target, upgraded, { source: source, skillId: skill.skillId, turn: battleState && battleState.turn });
}

function buildEffectInstance_(effect, source) {
  return Object.assign({}, effect, {
    effectId: effect.effectId,
    name: effect.name,
    category: effect.category,
    statKey: effect.statKey,
    effectType: effect.effectType,
    value: Number(effect.value || 0),
    description: effect.description || '',
    durationType: effect.durationType,
    remainingTurns: effect.durationType === DURATION_TYPES.TURN ? Number(effect.durationTurns || 1) : '',
    stackable: isTruthy_(effect.stackable),
    maxStacks: Number(effect.maxStacks || 1),
    triggerTiming: effect.triggerTiming,
    stacks: 1,
    source: source || {},
  });
}

function applyTimedEffectDamage_(target, timing, battleState, actor) {
  var hpBefore = Number(target && (target.currentHp !== undefined ? target.currentHp : target.hp) || 0);
  var result = getSharedRuleEngine_().applyTimedEffectDamage(target, timing, battleState, actor, battleState && battleState.turn);
  var hpDamage = hpBefore - Number(target && (target.currentHp !== undefined ? target.currentHp : target.hp) || 0);
  if (actor === 'player' && hpDamage > 0) {
    processSkillTriggers_(battleState, 'onDamaged', {hpDamage:hpDamage, damage:hpDamage, actor:'player', selfTurn:timing !== TRIGGER_TIMINGS.TURN_END});
  }
  return result;
  target.effects = target.effects || [];
  target.effects.forEach(function(effect) {
    if (effect.triggerTiming !== timing || effect.statKey !== STAT_KEYS.HP || effect.effectType !== EFFECT_TYPES.FLAT || Number(effect.value || 0) >= 0) {
      return;
    }
    var damage = Math.abs(Number(effect.value || 0)) * Math.max(1, Number(effect.stacks || 1));
    var currentHp = target.currentHp !== undefined ? Number(target.currentHp || 0) : Number(target.hp || 0);
    target.hp = Math.max(0, currentHp - damage);
    if (target.currentHp !== undefined) {
      target.currentHp = target.hp;
    }
    battleState.lastTurnEvents = battleState.lastTurnEvents || [];
    battleState.lastTurnEvents.push({
      actor: 'effect',
      type: 'effectDamage',
      target: actor === 'monster' ? 'monster' : 'player',
      targetMonsterId: actor === 'monster' ? (target.instanceId || target.monsterId) : '',
      damage: damage,
      message: effect.name + '으로 ' + damage + ' 피해!',
    });
  });
}

function applyMonsterBurnDamage_(monster, battleState) {
  return applyStackedDamageEffects_(monster, 'beforeMonsterTurn', battleState, 'monster');
}

function applyStackedDamageEffects_(target, timing, battleState, actor) {
  if (!target) return 0;
  normalizeTargetStatusBuckets_(target);
  var total = 0;
  (target.effects || []).slice().forEach(function(effect) {
    if (effect.rules) {
      if (effect.durationClock !== 'stacks') return;
      var rules = effect.rules.filter(function(rule) { return rule.operation === 'damage' && rule.triggerTiming === timing; });
      rules.forEach(function(rule, index) { total += applyStackedDamageEffect_(target, effect.effectId, battleState, actor, rule, index === rules.length - 1); });
    } else {
      var legacyTiming = {debuff_burn:'beforeMonsterTurn', debuff_bleed:'beforeAction', debuff_poison:'turnEnd'};
      if (legacyTiming[effect.effectId] === timing) total += applyStackedDamageEffect_(target, effect.effectId, battleState, actor);
    }
  });
  return total;
}

function applyStackedDamageEffect_(target, effectId, battleState, actor, ruleOverride, consumeStacks) {
  if (!target) return 0;
  var isMonster = actor === 'monster';
  var currentHp = Number(isMonster ? target.currentHp || 0 : target.hp || 0);
  if (currentHp <= 0) return 0;
  normalizeTargetStatusBuckets_(target);
  var effect = (target.effects || []).filter(function(candidate) { return candidate.effectId === effectId; })[0];
  if (!effect) return 0;

  var stacks = Math.max(1, Math.floor(Number(effect.stacks || 1)));
  var maxHp = Math.max(1, Number(isMonster ? target.maxHp || 1 : target.maxHp || target.stats && target.stats.hp || 1));
  var effectDefinition = findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effectId, 600);
  var rawDamage;
  var damageRule = ruleOverride || (effect.rules || []).filter(function(rule) { return rule.operation === 'damage'; })[0];
  if (damageRule) {
    rawDamage = Math.max(1, Math.round(getSharedRuleEngine_().getEffectRuleValue(effect, damageRule, target)));
  } else if (effectDefinition && String(effectDefinition.damageFormula || '').trim()) {
    // Effects.damageFormula supports maxHp, stacks, and value; the result is rounded and clamped to at least 1.
    rawDamage = Math.max(1, Math.round(evaluateSkillFormula_(effectDefinition.damageFormula, {
      maxHp: maxHp,
      stacks: stacks,
      value: Number(effect.value !== undefined ? effect.value : effectDefinition.value || 0),
    }, battleState, null)));
  } else {
    rawDamage = effectId === 'debuff_poison'
      ? stacks
      : Math.max(1, Math.round(maxHp * stacks * (effectId === 'debuff_burn' ? 0.01 : 0.007)));
  }
  var dotModifiers=combatDotModifiers_(battleState,target,effect,rawDamage,damageRule);
  effect=(target.effects || []).filter(function(e){return e.effectId===effectId;})[0] || effect;
  rawDamage=dotModifiers.damage;
  var bypassesShield = damageRule ? damageRule.shieldPolicy === 'bypass' : effectId === 'debuff_poison' || effectId === 'debuff_bleed';
  if (!isMonster && getSharedRuleEngine_().isCombatInvulnerable(target)) rawDamage = 0;
  var previousShield = Number(target.shield || 0);
  var shieldDamage = bypassesShield ? 0 : Math.min(Math.max(0, Number(target.shield || 0)), rawDamage);
  var hpDamage = Math.min(currentHp, rawDamage - shieldDamage);
  if (!bypassesShield) target.shield = Math.max(0, Number(target.shield || 0) - shieldDamage);
  getSharedRuleEngine_().spendRetainedShield(target, shieldDamage, previousShield);
  if (isMonster) target.currentHp = Math.max(0, currentHp - hpDamage);
  else target.hp = Math.max(0, currentHp - hpDamage);
  var revivalEventIndex = (battleState && battleState.lastTurnEvents || []).length;
  var revived = getSharedRuleEngine_().reviveAfterDamage(target, battleState);

  var decay = damageRule ? (effect.decayTiming === 'onTrigger' ? Number(effect.decayStacks || 0) : 0) : 1;
  effect.stacks = stacks - (consumeStacks === false || dotModifiers.preserve ? 0 : decay);
  if(effect.stacks<=0 && dotModifiers.reapply && Number(isMonster?target.currentHp:target.hp)>0)effect.stacks=dotModifiers.reapply;
  effect.remainingTurns = effect.stacks;
  if (effect.stacks <= 0) {
    target.effects = (target.effects || []).filter(function(candidate) { return candidate.effectId !== effectId; });
  }
  target.buffs = []; target.debuffs = [];
  normalizeTargetStatusBuckets_(target);
  if (battleState) {
    var combatPayload = {target:target,actor:'effect',damageKind:'dot',effectId:effectId,damage:shieldDamage+hpDamage,hpDamage:hpDamage,shieldDamage:shieldDamage,overkill:Math.max(0,rawDamage-shieldDamage-currentHp)};
    processSkillTriggers_(battleState, 'onDamage', combatPayload);
    if (!isMonster && hpDamage > 0) processSkillTriggers_(battleState, 'onDamaged', Object.assign({},combatPayload,{selfTurn:effectId === 'debuff_bleed' || !!(damageRule && ['onAction','beforeAction'].indexOf(damageRule.triggerTiming) >= 0)}));
    if (effect.stacks <= 0) processSkillTriggers_(battleState, 'onEffectRemoved', Object.assign({},combatPayload,{reason:'decay'}));
    if (isMonster && currentHp > 0 && target.currentHp <= 0) emitCombatKill_(battleState, target, combatPayload);
    normalizeBattleStateEffects_(battleState);
    syncPrimaryMonster_(battleState);
    battleState.lastTurnEvents = battleState.lastTurnEvents || [];
    battleState.lastTurnEvents.splice(revived ? revivalEventIndex : battleState.lastTurnEvents.length, 0, {
      actor: 'effect',
      type: 'effectDamage',
      target: isMonster ? 'monster' : 'player',
      effectId: effectId,
      targetMonsterId: isMonster ? (target.instanceId || target.monsterId) : '',
      damage: shieldDamage + hpDamage,
      hpDamage: hpDamage,
      shieldDamage: shieldDamage,
      message: (effect.name || effectId) + ' 피해! (' + stacks + '스택)',
    });
  }
  return shieldDamage + hpDamage;
}

function decrementTurnEffects_(target, battleState) {
  var previousEffects = (target.effects || []).slice();
  var result = getSharedRuleEngine_().decrementTurnEffects(target, battleState && battleState.turn);
  if (battleState) previousEffects.forEach(function(effect) {
    if (!(target.effects || []).some(function(e) { return e.effectId === effect.effectId; })) {
      processSkillTriggers_(battleState, 'onEffectRemoved', {target:target,effectId:effect.effectId,reason:'expired'});
    }
  });
  return result;
  target.effects = (target.effects || []).map(function(effect) {
    if (effect.durationType === DURATION_TYPES.TURN) {
      effect.remainingTurns = Number(effect.remainingTurns || 0) - 1;
    }
    return effect;
  }).filter(function(effect) {
    return effect.durationType !== DURATION_TYPES.TURN || Number(effect.remainingTurns || 0) > 0;
  });
}

function filterNonStageEffects_(effects) {
  return (effects || []).filter(function(effect) {
    return effect.durationType !== DURATION_TYPES.STAGE;
  });
}

function applyFrozenBonusIfNeeded_(target, damage) {
  var hitEffect = (target.effects || []).filter(function(effect) {
    return effect.rules && effect.rules.some(function(rule) { return rule.triggerTiming === 'onHit' && (rule.operation === 'damageTakenMultiplier' || rule.operation === 'removeOnHit'); });
  })[0];
  if (hitEffect) {
    var rule = hitEffect.rules.filter(function(candidate) { return candidate.triggerTiming === 'onHit' && candidate.operation === 'damageTakenMultiplier'; })[0];
    if (hitEffect.rules.some(function(candidate) { return candidate.triggerTiming === 'onHit' && candidate.operation === 'removeOnHit'; })) {
      target.effects = target.effects.filter(function(effect) { return effect.effectId !== hitEffect.effectId; });
    }
    return Math.round(Number(damage || 0) * (rule ? getSharedRuleEngine_().getEffectRuleValue(hitEffect, rule, target) : 1));
  }
  var frozen = (target.effects || []).filter(function(effect) {
    return !effect.rules && effect.effectId === 'debuff_freeze';
  })[0];
  if (!frozen) {
    return damage;
  }
  target.effects = (target.effects || []).filter(function(effect) {
    return effect.effectId !== 'debuff_freeze';
  });
  return Math.round(Number(damage || 0) * 1.5);
}

function hasControlEffect_(target, effectId) {
  return hasEffect_(target, effectId);
}

function hasEffect_(target, effectId) {
  return getSharedRuleEngine_().hasEffect(target, effectId);
  return (target.effects || []).some(function(effect) {
    return effect.effectId === effectId;
  });
}

function getSkillEffectTotal_(target, effectId) {
  normalizeTargetStatusBuckets_(target);
  return (target.effects || []).reduce(function(total, effect) {
    return total + (effect.effectId === effectId ? Number(effect.value || 0) * Math.max(1, Number(effect.stacks || 1)) : 0);
  }, 0);
}

function getHpPercent_(target) {
  var current = Number(target.currentHp !== undefined ? target.currentHp : target.hp || 0);
  var max = Math.max(1, Number(target.maxHp || target.stats && target.stats.hp || 1));
  return (current / max) * 100;
}

function getSkillUseCount_(battleState, skillId) {
  normalizeSkillRuntimeState_(battleState);
  return Number(battleState.skillUseCounts[skillId] || 0);
}

function incrementSkillUseCount_(battleState, skillId) {
  normalizeSkillRuntimeState_(battleState);
  battleState.skillUseCounts[skillId] = getSkillUseCount_(battleState, skillId) + 1;
}
