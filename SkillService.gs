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
    return {
      skillId: hydrated.skillId,
      name: hydrated.name,
      type: hydrated.type,
      target: hydrated.target,
      level: hydrated.level,
      baseValue: Number(hydrated.baseValue || 0),
      cooldown: hydrated.cooldown || '',
      cooldownText: buildSkillCooldownText_(hydrated),
      useLimitText: buildSkillUseLimitText_(hydrated, battleState),
      difficultyBonus: Number(hydrated.difficultyBonus || 0),
      actionPointCost: Number(hydrated.actionPointCost || 1),
      rarity: hydrated.rarity,
      rarityLabel: getRarityLabel_(hydrated.rarity),
      tags: hydrated.tags,
      description: hydrated.description,
      effectJson: hydrated.effectJson || '',
      effectDetails: buildSkillEffectDetails_(hydrated),
      clientEffects: buildClientSkillEffects_(hydrated),
      previewText: buildSkillPreviewText_(hydrated, battleState),
      available: !reason,
      unavailableReason: reason,
    };
  }).filter(Boolean);
}

function buildClientSkillEffects_(skill) {
  var rule = getSkillExecutionRule_(skill);
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
  return effects.map(function(effectRule) {
    var effect = effectRule.effectId ? findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effectRule.effectId, 600) : null;
    if (!effect) {
      return null;
    }
    var value = effectRule.value !== undefined ? Number(effectRule.value || 0) : Number(effect.value || 0);
    if (effectRule.value === undefined && effect.effectType === EFFECT_TYPES.FLAT) {
      value += getSkillUpgradeValue(skill, effect.category === EFFECT_CATEGORIES.BUFF ? 'buffValue' : 'effect');
    }
    var chance = effectRule.chance !== undefined ? Number(effectRule.chance || 0) : Number(rule.chance !== undefined ? rule.chance : 100);
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
  return effects.map(function(effectRule) {
    var effect = effectRule.effectId ? findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effectRule.effectId, 600) : null;
    var value = effectRule.value !== undefined ? Number(effectRule.value || 0) : Number(effect && effect.value || 0);
    if (effect && effect.effectType === EFFECT_TYPES.FLAT) {
      value += getSkillUpgradeValue(skill, effect.category === EFFECT_CATEGORIES.BUFF ? 'buffValue' : 'effect');
    }
    return {
      effectId: effectRule.effectId || '',
      name: effectRule.name || effectRule.effectName || effect && effect.name || effectRule.effectId || '',
      value: value,
      effectType: effectRule.effectType || effect && effect.effectType || '',
      category: effectRule.category || effect && effect.category || '',
      chance: Math.min(100, Math.max(0, Number(effectRule.chance !== undefined ? effectRule.chance : 100))),
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

  var actionPointCost = getActionPointCostForAction_(ACTION_TYPES.SKILL, skill);
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
      battleState,
      payload,
      ACTION_TYPES.SKILL,
      skill.skillId,
      targetId || payload.targetId || '',
      player.playerId
    );
    pendingAction.actionPointCost = getActionPointCostForAction_(ACTION_TYPES.SKILL, skill);
    battleState.pendingAction = pendingAction;
    markCachedQuestionShown_(stageState, pendingAction);
  }
  if (!payload.questionId) {
    if (pendingAction) {
      return buildQuestionView_(pendingAction.question, pendingAction);
    }

    var activeEffects = getActiveEffectsForQuestion_(battleState);
    var questionResult = pickQuestion_(run.playerId, battleState.stage, stageState.otherStudentQuestionShown, getForcedQuestionCreatorId_(battleState), getItemQuestionModifiers_(battleState, null));
    var baseDifficulty = applyBossDifficultyBonus(battleState.stage, Number(questionResult.question.difficulty || battleState.stage.baseDifficulty) + Number(skill.difficultyBonus || 0) + getSkillRuleQuestionDifficultyBonus_(skill));
    var questionModifiers = getItemQuestionModifiers_(battleState, questionResult.question);
    var finalDifficulty = calculateFinalQuestionDifficulty(baseDifficulty, activeEffects, questionModifiers);
    var maxMs = calculateFinalQuestionTimeLimitForQuestion_(finalDifficulty, activeEffects, questionResult.question, questionModifiers);
    pendingAction = {
      actionType: ACTION_TYPES.SKILL,
      skillId: skill.skillId,
      targetId: targetId || '',
      actionPointCost: getActionPointCostForAction_(ACTION_TYPES.SKILL, skill),
      questionId: questionResult.question.questionId,
      question: sanitizeQuestionForClient_(questionResult.question),
      issuedAt: new Date().getTime(),
      maxMs: maxMs,
      finalDifficulty: finalDifficulty,
      maxAnswerEfficiency: calculateMaxAnswerEfficiency_(questionModifiers),
      questionModifiers: questionModifiers,
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

  var question = findCachedRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', pendingAction.questionId, 120);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  var elapsedMs = Math.max(0, Number(payload.elapsedMs || 0));
  var maxMs = Number(pendingAction.maxMs || calculateFinalQuestionTimeLimitForQuestion_(pendingAction.finalDifficulty, getActiveEffectsForQuestion_(battleState), pendingAction.question || question, getItemQuestionModifiers_(battleState, question)));
  var remainingMs = Math.max(0, maxMs - elapsedMs);
  var isCorrect = isCorrectAnswer_(question, payload.selectedAnswer, payload.selectedChoiceIndex, payload.selectedAnswerText);
  var efficiency = calculateEfficiency(isCorrect, remainingMs, maxMs, Number(payload.wrongCountAfterTimeout || 0), getItemQuestionModifiers_(battleState, question), question);

  battleState.lastTurnEvents = [];
  consumeActionPoint_(battleState, Number(pendingAction.actionPointCost || getActionPointCostForAction_(ACTION_TYPES.SKILL, skill)));
  tickEffectsOnPlayerAction(battleState);
  if (battleState.player.hp <= 0) {
    battleState.status = STATUS.BATTLE_DEFEAT;
    battleState.lastMessage = '지속 피해로 쓰러졌습니다.';
  }
  var skillWasUsed = battleState.player.hp > 0 && battleState.status === STATUS.BATTLE_ACTIVE;
  if (skillWasUsed) {
    processSkillTriggers_(battleState, isCorrect ? 'onCorrect' : 'onWrong', { isCorrect: isCorrect, efficiency: efficiency });
    var blockedByPenalty = processSkillFailPenaltyAfterAnswer_(battleState, skill, isCorrect);
    if (!blockedByPenalty && battleState.player.hp > 0 && battleState.status === STATUS.BATTLE_ACTIVE) {
      applySkillEffect(battleState, Object.assign({}, skill, { targetId: pendingAction.targetId || '' }), efficiency, isCorrect);
    }
  }
  if (areAllMonstersDefeated_(battleState)) {
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
    selectedAnswer: payload.selectedAnswerText || payload.selectedAnswer || '',
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

  return buildBattleView_(requireRun_(run.runId), getStageState_(requireRun_(run.runId)));
}

function applySkillEffect(battleState, skill, efficiency, isCorrect) {
  var skillRule = getSkillExecutionRule_(skill);
  if (shouldUseSkillRuleEngine_(skillRule)) {
    return executeSkillByRule_(battleState, skill, skillRule, efficiency, isCorrect);
  }

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
        var critical = rollCriticalDamage_(areaBaseDamage, effectiveStats);
        var damage = applyFrozenBonusIfNeeded_(damageTarget, critical.damage);
        damage = applyOutgoingItemDamageModifiers_(battleState, damage, { actionType: ACTION_TYPES.SKILL, skill: skill });
        var damageResult = dealDamageToMonster_(battleState, damageTarget, damage);
        events.push({
          actor: 'player',
          type: ACTION_TYPES.SKILL,
          skillId: skill.skillId,
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
    var usedDamageTargetIds = {};
    for (var i = 0; i < hitCount; i += 1) {
      target = isRandomTargetSkill
        ? selectRandomAliveEnemyAvoiding_(battleState, usedDamageTargetIds)
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
          message: skill.name + '이 빗나갔습니다.',
        });
        continue;
      }
      var critical = rollCriticalDamage_(baseDamage, effectiveStats);
      var damage = applyFrozenBonusIfNeeded_(target, critical.damage);
      damage = applyOutgoingItemDamageModifiers_(battleState, damage, { actionType: ACTION_TYPES.SKILL, skill: skill });
      var damageResult = dealDamageToMonster_(battleState, target, damage);
      events.push({
        actor: 'player',
        type: ACTION_TYPES.SKILL,
        skillId: skill.skillId,
        targetMonsterId: target.instanceId || target.monsterId,
        damage: damageResult.damage,
        shieldDamage: damageResult.shieldDamage,
        hpDamage: damageResult.hpDamage,
        isCritical: critical.isCritical,
        criticalMultiplier: critical.multiplier,
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
    battleState.player.shield = Number(battleState.player.shield || 0) + shield;
    events.push({ actor: 'player', type: ACTION_TYPES.GUARD, shield: shield, message: skill.name + '으로 방어막 ' + shield + ' 생성!' });
    applySkillLinkedEffect_(battleState.player, skill, 'self');
    battleState.lastMessage = skill.name + '으로 방어막을 만들었습니다.';
  } else if (skill.type === SKILL_TYPES.HEAL) {
    var heal = value;
    battleState.player.hp = Math.min(Number(battleState.player.maxHp || battleState.player.stats.hp || 1), Number(battleState.player.hp || 0) + heal);
    events.push({ actor: 'player', type: 'heal', heal: heal, message: skill.name + '으로 ' + heal + ' 회복!' });
    battleState.lastMessage = skill.name + '으로 회복했습니다.';
  } else if (skill.type === SKILL_TYPES.BUFF) {
    applySkillLinkedEffect_(battleState.player, skill, 'self');
    events.push({ actor: 'player', type: 'buff', message: skill.name + ' 효과를 얻었습니다.' });
    battleState.lastMessage = skill.name + ' 효과를 얻었습니다.';
  } else if (skill.type === SKILL_TYPES.DEBUFF) {
    if (target) {
      var appliedDebuff = applySkillLinkedEffect_(target, skill, 'enemy');
      events.push({ actor: 'player', type: 'debuff', targetMonsterId: target.instanceId || target.monsterId, message: target.name + '에게 ' + skill.name + ' 효과!' });
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
  normalizeBattleStateEffects_(battleState);
  normalizeBattleMonsters_(battleState);
  normalizePlayerActionPoints_(battleState, false);
  battleState.lastTurnEvents = battleState.lastTurnEvents || [];
  if (rule.requireCondition && rule.requireCondition.requireEfficiencyAtLeast && Number(efficiency || 0) < Number(rule.requireCondition.requireEfficiencyAtLeast)) {
    battleState.lastTurnEvents.push({ actor: 'player', type: ACTION_TYPES.SKILL, skillId: skill.skillId, message: skill.name + ' 사용 조건을 만족하지 못했습니다.' });
    battleState.lastMessage = skill.name + ' 사용 조건을 만족하지 못했습니다.';
    return battleState;
  }

  var context = buildSkillFormulaContext_(battleState, skill, null, efficiency);
  applySkillActionPointModify_(battleState, skill, rule.actionPointModify, context);
  registerSkillTriggers_(battleState, skill, rule);

  var targets = selectSkillTargets_(rule, battleState, skill, skill.targetId || '');
  var hitCount = Math.max(1, Math.round(evaluateSkillFormulaValue_(rule.hitCount, context, Math.max(1, Number(skill.hitCount || 1)), battleState, skill)));
  var normalizedTargetMode = normalizeSkillTargetMode_(rule.targetMode || (skill.target === 'self' ? 'self' : 'singleEnemy'));
  if (normalizedTargetMode === 'randomEnemies') {
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

  applySkillRuleShield_(battleState, skill, rule, context, efficiency);
  applySkillRuleHeal_(battleState, skill, rule, context);
  applySkillRuleSelfDamage_(battleState, skill, rule, context);

  var criticalStats = calculateEffectiveStats(battleState.player.stats || {}, battleState.player.effects || []);
  var damageEvents = 0;
  targets.forEach(function(target) {
    if (!target || target.currentHp === undefined) {
      return;
    }
    for (var i = 0; i < (normalizedTargetMode === 'randomEnemies' ? 1 : hitCount); i += 1) {
      var damageTarget = target;
      if (Number(damageTarget.currentHp || 0) <= 0 && normalizedTargetMode !== 'allEnemies') {
        damageTarget = normalizedTargetMode === 'randomEnemies' ? selectRandomAliveEnemy_(battleState) : getSkillTarget_(battleState, skill, skill.targetId || '');
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
      var hit = rollHit_(criticalStats, targetStats);
      if (!hit.hit) {
        battleState.lastTurnEvents.push({
          actor: 'player',
          type: ACTION_TYPES.SKILL,
          skillId: skill.skillId,
          targetMonsterId: damageTarget.instanceId || damageTarget.monsterId,
          damage: 0,
          missed: true,
          hitChance: hit.chance,
          simultaneousGroupId: normalizedTargetMode === 'allEnemies' ? skill.skillId + ':allEnemies:' + i : '',
          message: skill.name + '이 빗나갔습니다.',
        });
        continue;
      }
      var critical = rollCriticalDamage_(damage, criticalStats);
      damage = applyFrozenBonusIfNeeded_(damageTarget, critical.damage);
      damage = applyOutgoingItemDamageModifiers_(battleState, damage, { actionType: ACTION_TYPES.SKILL, skill: skill });
      var damageResult = dealDamageToMonster_(battleState, damageTarget, damage);
      damageEvents += 1;
      battleState.lastTurnEvents.push({
        actor: 'player',
        type: ACTION_TYPES.SKILL,
        skillId: skill.skillId,
        targetMonsterId: damageTarget.instanceId || damageTarget.monsterId,
        damage: damageResult.damage,
        shieldDamage: damageResult.shieldDamage,
        hpDamage: damageResult.hpDamage,
        isCritical: critical.isCritical,
        criticalMultiplier: critical.multiplier,
        simultaneousGroupId: normalizedTargetMode === 'allEnemies' ? skill.skillId + ':allEnemies:' + i : '',
        message: critical.isCritical
          ? skill.name + ' 치명타! ' + damageResult.damage + ' 피해!'
          : skill.name + '으로 ' + damageResult.damage + ' 피해!',
      });
    }
  });

  applySkillRuleEffects_(battleState, skill, rule, targets, context);
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
  }
  syncPrimaryMonster_(battleState);
  battleState.lastMessage = skill.name + '을 사용했습니다.';
  if (!damageEvents && !rule.shieldFormula && !rule.healFormula && !(rule.applyEffects || []).length) {
    battleState.lastTurnEvents.push({ actor: 'player', type: skill.type || ACTION_TYPES.SKILL, skillId: skill.skillId, message: skill.name + ' 효과가 발동했습니다.' });
  }
  return battleState;
}

function buildSkillRulePreviewText_(skill, battleState, rule) {
  var context = buildSkillFormulaContext_(battleState, skill, getFirstAliveMonster_(battleState), 1);
  var parts = [];
  if (rule.damageFormula) {
    parts.push('Damage ' + Math.max(0, Math.round(evaluateSkillFormula_(rule.damageFormula, context, battleState, skill))));
  }
  if (rule.shieldFormula) {
    parts.push('Shield ' + Math.max(0, Math.round(evaluateSkillFormula_(rule.shieldFormula, context, battleState, skill))));
  }
  if (rule.healFormula) {
    parts.push('Heal ' + Math.max(0, Math.round(evaluateSkillFormula_(rule.healFormula, context, battleState, skill))));
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

function calculateSkillRuleDamage_(battleState, skill, rule, context, efficiency) {
  var hasDamageFormula = rule.damageFormula !== undefined && rule.damageFormula !== null && rule.damageFormula !== '';
  var damage = hasDamageFormula ? evaluateSkillFormula_(rule.damageFormula, context, battleState, skill) : 0;
  if (rule.randomMin !== undefined || rule.randomMax !== undefined) {
    damage += randomSkillInt_(Number(rule.randomMin || 0), Number(rule.randomMax || rule.randomMin || 0));
  }
  if (rule.extraDamageFormula) {
    damage += evaluateSkillFormula_(rule.extraDamageFormula, context, battleState, skill);
  }
  if (rule.tagBonus) {
    damage = applySkillTagBonusToValue_(battleState, skill, rule.tagBonus, damage);
  }
  if (rule.scaleByEfficiency !== false) {
    damage *= Number(efficiency || 0);
  }
  if (rule.efficiencyBonus && Number(efficiency || 0) >= Number(rule.efficiencyBonus.threshold || 0)) {
    damage *= Number(rule.efficiencyBonus.damageMultiplier || 1);
    damage += Number(rule.efficiencyBonus.damageAdd || 0);
  }
  return Math.max(0, Math.round(damage));
}

function applySkillRuleShield_(battleState, skill, rule, context, efficiency) {
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
  var supported = ['afterTurn', 'perStageLimit', 'perBattleLimit', 'requireShield', 'requireEnemyShield', 'requireTag', 'requireEfficiencyAtLeast', 'requireHpBelowPercent', 'requireHpAbovePercent', 'oncePerBattle', 'notUpgradable'];
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
  return {
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
    enemyShield: Number(target && target.shield || 0),
    efficiency: Number(efficiency || 0),
    usedStrikeSkillCountThisBattle: Number(tagCounts.strike || tagCounts['타격'] || 0),
    usedStrikeSkillCountThisTurn: Number(turnTagCounts.strike || turnTagCounts['타격'] || 0),
  };
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
  var supportedEffectKeys = ['target', 'effectId', 'value', 'valueFormula', 'durationType', 'durationTurns', 'stackable', 'maxStacks', 'chance', 'requireEfficiencyAtLeast', 'requireCondition'];
  Object.keys(effectRule).forEach(function(key) {
    if (supportedEffectKeys.indexOf(key) === -1) {
      warnSkillRule_(battleState, skill, 'Unsupported applyEffects key: ' + key, { key: key });
    }
  });
  var requiredEfficiency = effectRule.requireEfficiencyAtLeast || (effectRule.requireCondition && effectRule.requireCondition.requireEfficiencyAtLeast);
  if (requiredEfficiency && Number(context.efficiency || 0) < Number(requiredEfficiency)) {
    return;
  }
  var chance = effectRule.chance === undefined ? 100 : Number(effectRule.chance || 0);
  if (Math.random() * 100 > chance) {
    return;
  }
  var effect = findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effectRule.effectId, 600);
  if (!effect) {
    warnSkillRule_(battleState, skill, 'Effect not found: ' + effectRule.effectId, { effectId: effectRule.effectId });
    return;
  }
  var applied = Object.assign({}, effect);
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

  getTargetsForEffectRule_(battleState, effectRule, targets).forEach(function(target) {
    var appliedEffect = applyEffect(target, applied, { source: effectRule.target || 'rule', skillId: skill.skillId });
    var effectType = String(appliedEffect && appliedEffect.category || applied.category || '').toLowerCase() === 'debuff' ? 'debuff' : 'buff';
    battleState.lastTurnEvents = battleState.lastTurnEvents || [];
    if (target && target.currentHp !== undefined) {
      battleState.lastTurnEvents.push({
        actor: 'player',
        type: effectType,
        skillId: skill.skillId,
        targetMonsterId: target.instanceId || target.monsterId,
        message: (target.name || '적') + '에게 ' + (skill.name || '스킬') + ' 효과!',
      });
      return;
    }
    battleState.lastTurnEvents.push({
      actor: 'player',
      type: effectType,
      skillId: skill.skillId,
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
  Object.keys(apRule).forEach(function(key) {
    if (supportedKeys.indexOf(key) === -1) {
      warnSkillRule_(battleState, skill, 'Unsupported actionPointModify key: ' + key, { key: key });
    }
  });
  var config = {};
  supportedKeys.forEach(function(key) {
    if (apRule[key] !== undefined) {
      config[key] = evaluateSkillFormulaValue_(apRule[key], context, Number(apRule[key] || 0), battleState, skill);
    }
  });
  applyActionPointEffectConfig_(battleState.player, config);
}

function registerSkillTriggers_(battleState, skill, rule) {
  var triggerKeys = ['onDamaged', 'onBlock', 'onCorrect', 'onWrong', 'onTurnStart', 'onTurnEnd'];
  triggerKeys.forEach(function(key) {
    if (!rule[key]) {
      return;
    }
    validateSkillTriggerRule_(battleState, skill, key, rule[key]);
    battleState.activeTriggers = battleState.activeTriggers || [];
    battleState.activeTriggers.push({
      timing: key,
      rule: rule[key],
      sourceSkillId: skill.skillId,
      sourceSkillName: skill.name,
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
      durationType: 'battle',
      remainingTurns: 0,
      createdAtTurn: Number(battleState.turn || 1),
    });
  }
}

function validateSkillTriggerRule_(battleState, skill, key, triggerRule) {
  if (!triggerRule || typeof triggerRule !== 'object') {
    warnSkillRule_(battleState, skill, key + ' must be an object.', { value: triggerRule });
    return;
  }
  var supported = ['durationType', 'durationTurns', 'reflectBlockedDamage', 'damageFormula', 'applyEffects', 'actionPointModify'];
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
        battleState.lastTurnEvents.push({ actor: 'effect', type: 'ruleDamage', target: 'monster', targetMonsterId: target.instanceId || target.monsterId, damage: result.damage, shieldDamage: result.shieldDamage, hpDamage: result.hpDamage, message: skill.name + ' 효과로 ' + result.damage + ' 피해를 주었습니다.' });
      }
    }
  }
  if (actionRule.actionPointModify) {
    applySkillActionPointModify_(battleState, skill, actionRule.actionPointModify, context);
  }
  if (actionRule.applyEffects) {
    applySkillRuleEffects_(battleState, skill, { applyEffects: actionRule.applyEffects }, targets, context);
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
  var supported = ['loseBattleOnWrongAnswer', 'loseBattleOnDamageTaken', 'selfDamageOnUse', 'increaseQuestionDifficulty', 'reduceActionPoint'];
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
  if (!battleState || !battleState.activeTriggers || !battleState.activeTriggers.length) {
    return;
  }
  var triggers = battleState.activeTriggers.slice();
  triggers.forEach(function(trigger) {
    if (trigger.timing !== timing && trigger.timing !== 'failPenalty') {
      return;
    }
    processSingleSkillTrigger_(battleState, trigger, timing, payload || {});
  });
}

function processSingleSkillTrigger_(battleState, trigger, timing, payload) {
  var rule = trigger.rule || {};
  var sourceSkill = { skillId: trigger.sourceSkillId || '', name: trigger.sourceSkillName || trigger.sourceSkillId || 'trigger' };
  var context = buildSkillFormulaContext_(battleState, sourceSkill, payload.target || null, payload.efficiency || 1);
  context.blockedDamage = Number(payload.shieldDamage || 0);
  context.damageTaken = Number(payload.hpDamage || 0);

  if (trigger.timing === 'failPenalty') {
    if (timing === 'onDamaged' && rule.loseBattleOnDamageTaken && Number(payload.hpDamage || 0) > 0) {
      markBattleDefeatBySkillRule_(battleState, sourceSkill, '피격 패널티로 패배했습니다.');
    }
    return;
  }
  if (rule.reflectBlockedDamage && Number(payload.shieldDamage || 0) > 0) {
    var target = getFirstAliveMonster_(battleState);
    if (target) {
      var result = dealDamageToMonster_(battleState, target, Number(payload.shieldDamage || 0));
      battleState.lastTurnEvents = battleState.lastTurnEvents || [];
      battleState.lastTurnEvents.push({ actor: 'effect', type: 'reflect', target: 'monster', targetMonsterId: target.instanceId || target.monsterId, damage: result.damage, hpDamage: result.hpDamage, shieldDamage: result.shieldDamage, message: sourceSkill.name + ' 효과로 ' + result.damage + ' 피해를 반사했습니다.' });
    }
  }
  if (rule.damageFormula) {
    var damage = Math.max(0, Math.round(evaluateSkillFormula_(rule.damageFormula, context, battleState, sourceSkill)));
    var damageTarget = getFirstAliveMonster_(battleState);
    if (damageTarget && damage > 0) {
      dealDamageToMonster_(battleState, damageTarget, damage);
    }
  }
  if (rule.applyEffects) {
    applySkillRuleEffects_(battleState, sourceSkill, { applyEffects: rule.applyEffects }, [getFirstAliveMonster_(battleState)], context);
  }
  if (rule.actionPointModify) {
    applySkillActionPointModify_(battleState, sourceSkill, rule.actionPointModify, context);
  }
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
    if (startedTurn && currentTurn <= startedTurn + 1) {
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
  normalizeBattleStateEffects_(battleState);
  processSkillTriggers_(battleState, 'onTurnStart', {});
  applyTimedEffectDamage_(battleState.player, TRIGGER_TIMINGS.TURN_START, battleState, 'player');
  getAliveMonsters_(battleState).forEach(function(monster) {
    applyTimedEffectDamage_(monster, TRIGGER_TIMINGS.TURN_START, battleState, 'monster');
  });
  return battleState;
}

function tickEffectsOnPlayerAction(battleState) {
  normalizeBattleStateEffects_(battleState);
  applyTimedEffectDamage_(battleState.player, TRIGGER_TIMINGS.ON_ACTION, battleState, 'player');
  return battleState;
}

function tickEffectsAtTurnEnd(battleState) {
  normalizeBattleStateEffects_(battleState);
  processSkillTriggers_(battleState, 'onTurnEnd', {});
  cleanupSkillTriggersForTurn_(battleState);
  applyTimedEffectDamage_(battleState.player, TRIGGER_TIMINGS.TURN_END, battleState, 'player');
  getAliveMonsters_(battleState).forEach(function(monster) {
    applyTimedEffectDamage_(monster, TRIGGER_TIMINGS.TURN_END, battleState, 'monster');
    decrementTurnEffects_(monster);
  });
  decrementTurnEffects_(battleState.player);
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
  extraSeconds += Number(questionModifiers && questionModifiers.questionTimeSeconds || 0);
  var seconds = GAME_RULES.BASE_QUESTION_TIME_SEC + ((finalDifficulty - 1) * GAME_RULES.QUESTION_TIME_PER_DIFFICULTY_SEC) + extraSeconds;
  return Math.max(3000, seconds * 1000);
}

function calculateFinalQuestionTimeLimitForQuestion_(baseDifficulty, activeEffects, question, questionModifiers) {
  var maxMs = calculateFinalQuestionTimeLimit(baseDifficulty, activeEffects, questionModifiers);
  if (isShortAnswerQuestion_(question)) {
    return Math.round(maxMs * Number(GAME_RULES.SHORT_ANSWER_TIME_MULTIPLIER || 1.2));
  }
  return maxMs;
}

function isShortAnswerQuestion_(question) {
  return question && question.type === QUESTION_TYPES.SHORT_ANSWER;
}

function getSkillUpgradeValue(skill, key) {
  var upgrade = safeJsonParse_(skill.upgradeJson, {});
  var level = Math.max(1, Number(skill.level || 1));
  return Number(upgrade[key] || 0) * Math.max(0, level - 1);
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
    stats: safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS)),
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
  var rarity = normalizeRarity_(skill.rarity || RARITIES.COMMON);
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
  battleState.player.effects = battleState.player.effects || [];
  normalizeBattleMonsters_(battleState);
  (battleState.monsters || []).forEach(function(monster) {
    monster.effects = monster.effects || [];
    monster.effects = monster.effects.map(hydrateEffectDisplayFields_);
    monster.buffs = monster.effects.filter(function(effect) { return effect.category === EFFECT_CATEGORIES.BUFF; });
    monster.debuffs = monster.effects.filter(function(effect) { return effect.category === EFFECT_CATEGORIES.DEBUFF; });
  });
  battleState.player.effects = battleState.player.effects.map(hydrateEffectDisplayFields_);
  battleState.player.buffs = battleState.player.effects.filter(function(effect) { return effect.category === EFFECT_CATEGORIES.BUFF; });
  battleState.player.debuffs = battleState.player.effects.filter(function(effect) { return effect.category === EFFECT_CATEGORIES.DEBUFF; });
}

function hydrateEffectDisplayFields_(effect) {
  if (effect && effect.effectId === 'debuff_foolish') {
    effect.name = effect.name || '멍청해짐';
    effect.category = EFFECT_CATEGORIES.DEBUFF;
    effect.statKey = '';
    effect.effectType = EFFECT_TYPES.CONTROL;
    effect.value = 0;
    effect.description = '정신이 흐려진 상태입니다.';
    return effect;
  }
  if (!effect || !effect.effectId || effect.description) {
    return effect;
  }
  var master = findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effect.effectId, 600);
  if (!master) {
    return effect;
  }
  effect.name = effect.name || master.name || '';
  effect.description = master.description || '';
  effect.category = effect.category || master.category || '';
  effect.statKey = effect.statKey || master.statKey || '';
  effect.effectType = effect.effectType || master.effectType || '';
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

function applySkillLinkedEffect_(target, skill, source) {
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
  return applyEffect(target, upgraded, { source: source, skillId: skill.skillId });
}

function buildEffectInstance_(effect, source) {
  return {
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
  };
}

function applyTimedEffectDamage_(target, timing, battleState, actor) {
  return getSharedRuleEngine_().applyTimedEffectDamage(target, timing, battleState, actor);
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

function decrementTurnEffects_(target) {
  return getSharedRuleEngine_().decrementTurnEffects(target);
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
  var frozen = (target.effects || []).filter(function(effect) {
    return effect.effectId === 'debuff_freeze';
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

function getHpPercent_(target) {
  var current = Number(target.hp !== undefined ? target.hp : target.currentHp || 0);
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
