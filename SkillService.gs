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
      difficultyBonus: Number(hydrated.difficultyBonus || 0),
      actionPointCost: Number(hydrated.actionPointCost || 1),
      rarity: hydrated.rarity,
      rarityLabel: getRarityLabel_(hydrated.rarity),
      tags: hydrated.tags,
      description: hydrated.description,
      previewText: buildSkillPreviewText_(hydrated, battleState),
      available: !reason,
      unavailableReason: reason,
    };
  }).filter(Boolean);
}

function canUseSkill(skill, runState, battleState) {
  return !getSkillUnavailableReason(skill, runState, battleState);
}

function getSkillUnavailableReason(skill, runState, battleState) {
  if (!skill) {
    return '보유하지 않은 스킬입니다.';
  }

  var conditions = safeJsonParse_(skill.conditionJson, {});
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
  var actionPointCost = getActionPointCostForAction_(ACTION_TYPES.SKILL, skill);
  if (!hasEnoughActionPoint_(battleState, actionPointCost)) {
    return '행동력이 부족합니다.';
  }

  return '';
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
    var preferredQuestionType = shouldUseShortQuestionInBoss(battleState.stage.bossConfig) ? QUESTION_TYPES.SHORT_ANSWER : '';
    var questionResult = pickQuestion_(run.playerId, battleState.stage, stageState.otherStudentQuestionShown, preferredQuestionType, getForcedQuestionCreatorId_(battleState));
    var baseDifficulty = applyBossDifficultyBonus(battleState.stage, Number(questionResult.question.difficulty || battleState.stage.baseDifficulty) + Number(skill.difficultyBonus || 0));
    var finalDifficulty = calculateFinalQuestionDifficulty(baseDifficulty, activeEffects);
    var maxMs = calculateFinalQuestionTimeLimit(finalDifficulty, activeEffects);
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
      logBattleEvent_(run, 'questionFallback', {
        reason: questionResult.fallbackReason,
        actionType: ACTION_TYPES.SKILL,
        skillId: skill.skillId,
        stageId: battleState.stage.stageId,
        questionId: questionResult.question.questionId,
      });
    }
    saveStageState_(runId, stageState, battleState);
    return buildQuestionView_(pendingAction.question, pendingAction);
  }

  if (!pendingAction || pendingAction.actionType !== ACTION_TYPES.SKILL || pendingAction.skillId !== skill.skillId || pendingAction.questionId !== payload.questionId) {
    throw new Error('풀이 중인 스킬 문제가 없습니다.');
  }

  var question = findRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', pendingAction.questionId);
  if (!question) {
    throw new Error('문제를 찾을 수 없습니다.');
  }

  var elapsedMs = Math.max(0, Number(payload.elapsedMs || 0));
  var maxMs = Number(pendingAction.maxMs || calculateFinalQuestionTimeLimit(pendingAction.finalDifficulty, getActiveEffectsForQuestion_(battleState)));
  var remainingMs = Math.max(0, maxMs - elapsedMs);
  var isCorrect = isCorrectAnswer_(question, payload.selectedAnswer, payload.selectedChoiceIndex, payload.selectedAnswerText);
  var efficiency = calculateEfficiency(isCorrect, remainingMs, maxMs, Number(payload.wrongCountAfterTimeout || 0));

  battleState.lastTurnEvents = [];
  consumeActionPoint_(battleState, Number(pendingAction.actionPointCost || getActionPointCostForAction_(ACTION_TYPES.SKILL, skill)));
  tickEffectsAtTurnStart(battleState);
  if (battleState.player.hp > 0) {
    applySkillEffect(battleState, Object.assign({}, skill, { targetId: pendingAction.targetId }), efficiency);
  }

  if (areAllMonstersDefeated_(battleState)) {
    battleState.status = STATUS.BATTLE_VICTORY;
    battleState.lastMessage = '몬스터를 처치했습니다.';
    logBattleEvent_(run, STATUS.BATTLE_VICTORY, { battleId: battleState.battleId });
  }

  incrementSkillUseCount_(battleState, skill.skillId);
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
    actionType: ACTION_TYPES.SKILL,
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

function applySkillEffect(battleState, skill, efficiency) {
  normalizeBattleStateEffects_(battleState);
  var effectiveStats = calculateEffectiveStats(battleState.player.stats || {}, battleState.player.effects || []);
  var target = getSkillTarget_(battleState, skill, skill.targetId || '');
  var value = Math.max(0, Math.round((Number(skill.baseValue || 0) + getSkillUpgradeValue(skill, 'damage') + getSkillUpgradeValue(skill, 'effect')) * Number(efficiency || 0)));
  var hitCount = Math.max(1, Number(skill.hitCount || 1));
  var events = battleState.lastTurnEvents || [];

  if (skill.type === SKILL_TYPES.DAMAGE) {
    var damage = Math.max(0, Math.round((Number(skill.baseValue || 0) + getSkillUpgradeValue(skill, 'damage') + Number(effectiveStats.attack || 0)) * Number(efficiency || 0)));
    for (var i = 0; i < hitCount; i += 1) {
      target = getSkillTarget_(battleState, skill, skill.targetId || '');
      if (!target) break;
      damage = applyFrozenBonusIfNeeded_(target, damage);
      var damageResult = dealDamageToMonster_(battleState, target, damage);
      events.push({
        actor: 'player',
        type: ACTION_TYPES.SKILL,
        skillId: skill.skillId,
        targetMonsterId: target.instanceId || target.monsterId,
        damage: damageResult.damage,
        shieldDamage: damageResult.shieldDamage,
        hpDamage: damageResult.hpDamage,
        message: skill.name + '으로 ' + damage + ' 피해!',
      });
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

function applyEffect(target, effect, source) {
  target.effects = target.effects || [];
  var effectInstance = buildEffectInstance_(effect, source || {});
  var existing = target.effects.filter(function(activeEffect) {
    return activeEffect.effectId === effectInstance.effectId;
  })[0];

  if (existing && effectInstance.stackable) {
    existing.stacks = Math.min(Number(existing.maxStacks || 99), Number(existing.stacks || 1) + 1);
    existing.remainingTurns = Math.max(Number(existing.remainingTurns || 0), Number(effectInstance.remainingTurns || 0));
    return existing;
  }
  if (existing && !effectInstance.stackable) {
    Object.assign(existing, effectInstance);
    return existing;
  }

  target.effects.push(effectInstance);
  return effectInstance;
}

function tickEffectsAtTurnStart(battleState) {
  normalizeBattleStateEffects_(battleState);
  applyTimedEffectDamage_(battleState.player, TRIGGER_TIMINGS.TURN_START, battleState, 'player');
  applyTimedEffectDamage_(battleState.player, TRIGGER_TIMINGS.ON_ACTION, battleState, 'player');
  getAliveMonsters_(battleState).forEach(function(monster) {
    applyTimedEffectDamage_(monster, TRIGGER_TIMINGS.TURN_START, battleState, 'monster');
  });
  return battleState;
}

function tickEffectsAtTurnEnd(battleState) {
  normalizeBattleStateEffects_(battleState);
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
  var stats = Object.assign({}, baseStats || {});
  (activeEffects || []).forEach(function(effect) {
    var stacks = Math.max(1, Number(effect.stacks || 1));
    var value = Number(effect.value || 0) * stacks;
    if (!effect.statKey || effect.statKey === STAT_KEYS.QUESTION_TIME || effect.statKey === STAT_KEYS.QUESTION_DIFFICULTY || effect.statKey === 'action') {
      return;
    }
    if (effect.effectType === EFFECT_TYPES.PERCENT) {
      stats[effect.statKey] = Number(stats[effect.statKey] || 0) * (1 + (value / 100));
    } else {
      stats[effect.statKey] = Number(stats[effect.statKey] || 0) + value;
    }
  });
  return stats;
}

function calculateFinalQuestionTimeLimit(baseDifficulty, activeEffects) {
  var finalDifficulty = clampDifficulty_(Number(baseDifficulty || GAME_RULES.MIN_DIFFICULTY));
  var extraSeconds = getEffectFlatBonus_(activeEffects, STAT_KEYS.QUESTION_TIME);
  var seconds = GAME_RULES.BASE_QUESTION_TIME_SEC + ((finalDifficulty - 1) * GAME_RULES.QUESTION_TIME_PER_DIFFICULTY_SEC) + extraSeconds;
  return Math.max(3000, seconds * 1000);
}

function getSkillUpgradeValue(skill, key) {
  var upgrade = safeJsonParse_(skill.upgradeJson, {});
  var level = Math.max(1, Number(skill.level || 1));
  return Number(upgrade[key] || 0) * Math.max(0, level - 1);
}

function buildSkillPreviewText_(skill, battleState) {
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
    return '쿨타임 ' + Number(skill.cooldown || 0) + '턴';
  }

  var conditions = safeJsonParse_(skill.conditionJson, {});
  if (conditions.perStageLimit) {
    return '스테이지 ' + Number(conditions.perStageLimit || 0) + '회';
  }
  return '쿨타임 없음';
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
  battleState.player.effects = battleState.player.effects || [];
  normalizeBattleMonsters_(battleState);
  (battleState.monsters || []).forEach(function(monster) {
    monster.effects = monster.effects || [];
    monster.buffs = monster.effects.filter(function(effect) { return effect.category === EFFECT_CATEGORIES.BUFF; });
    monster.debuffs = monster.effects.filter(function(effect) { return effect.category === EFFECT_CATEGORIES.DEBUFF; });
  });
  battleState.player.buffs = battleState.player.effects.filter(function(effect) { return effect.category === EFFECT_CATEGORIES.BUFF; });
  battleState.player.debuffs = battleState.player.effects.filter(function(effect) { return effect.category === EFFECT_CATEGORIES.DEBUFF; });
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
    return (battleState.monsters || []).filter(function(monster) {
      return (monster.instanceId || monster.monsterId) === explicitTargetId || monster.monsterId === explicitTargetId;
    })[0] || getFirstAliveMonster_(battleState);
  }
  return getFirstAliveMonster_(battleState);
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
  if (upgraded.effectType === EFFECT_TYPES.FLAT) {
    upgraded.value = Number(upgraded.value || 0) + getSkillUpgradeValue(skill, 'buffValue');
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
  battleState.skillUseCounts = battleState.skillUseCounts || {};
  return Number(battleState.skillUseCounts[skillId] || 0);
}

function incrementSkillUseCount_(battleState, skillId) {
  battleState.skillUseCounts = battleState.skillUseCounts || {};
  battleState.skillUseCounts[skillId] = getSkillUseCount_(battleState, skillId) + 1;
}
