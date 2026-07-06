var ALLOWED_REWARD_STAT_KEYS_ = Object.freeze([
  'attack',
  'hp',
  'hpRegen',
  'evasion',
  'criticalRate',
  'criticalDamage',
  'defense',
]);

function generateRewardChoices(runId, stageId, authToken) {
  var run = requireRun_(runId);
  requireRewardRunOwner_(run, authToken);
  if (run.status !== STATUS.RUN_ACTIVE) {
    throw new Error('진행 중인 런에서만 보상을 생성할 수 있습니다.');
  }

  var stageState = getStageState_(run);
  var currentStageId = stageId || stageState.stageId || buildStageId_(run.currentFloor, run.currentStage);
  var battle = stageState.battle;
  if (!battle || battle.status !== STATUS.BATTLE_VICTORY) {
    throw new Error('전투 승리 후에만 보상을 받을 수 있습니다.');
  }

  var stage = loadStage(currentStageId);
  var rewardGroupId = stage.rewardGroupId;
  var rewardState = stageState.reward || {};
  var regenResult = grantStageClearRegenForRun_(run, stageState);
  run = regenResult.run;
  stageState = regenResult.stageState;
  rewardState = stageState.reward || {};
  if (rewardState.stageId === currentStageId && rewardState.choices && rewardState.choices.length) {
    if (!rewardState.currencyGranted) {
      rewardState.currencyAmount = grantCurrencyForRun_(run, stageState, rewardGroupId).amount;
      rewardState.currencyGranted = true;
      stageState.reward = rewardState;
      updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
        stageStateJson: safeJsonStringify_(stageState),
        updatedAt: new Date(),
      });
    }
    return buildRewardChoiceView_(runId, currentStageId, rewardGroupId, rewardState, safeJsonParse_(run.skillsJson, []), stageState.battle);
  }

  var choices = pickRewardChoices_(rewardGroupId, Number(stage.floor || run.currentFloor), safeJsonParse_(run.skillsJson, []));
  var currencyResult = grantCurrencyForRun_(run, stageState, rewardGroupId);
  run = requireRun_(runId);
  stageState = getStageState_(run);
  rewardState = {
    stageId: currentStageId,
    rewardGroupId: rewardGroupId,
    choices: choices.map(function(reward) {
      return sanitizeRewardForClient_(reward, stageState.battle);
    }),
    selectedRewardId: '',
    currencyGranted: true,
    currencyAmount: currencyResult.amount,
    stageClearRegenApplied: !!rewardState.stageClearRegenApplied,
    regenAmount: Number(rewardState.regenAmount || 0),
    currentHpAfterRegen: Number(rewardState.currentHpAfterRegen || run.currentHp || 0),
    maxHpAfterRegen: Number(rewardState.maxHpAfterRegen || safeJsonParse_(run.statsJson, BASE_PLAYER_STATS).hp || BASE_PLAYER_STATS.hp),
    createdAt: new Date().toISOString(),
  };
  stageState.reward = rewardState;
  updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
    stageStateJson: safeJsonStringify_(stageState),
    updatedAt: new Date(),
  });

  return buildRewardChoiceView_(runId, currentStageId, rewardGroupId, rewardState, safeJsonParse_(run.skillsJson, []), stageState.battle);
}

function selectReward(runId, rewardId, authToken) {
  var run = requireRun_(runId);
  requireRewardRunOwner_(run, authToken);
  if (run.status !== STATUS.RUN_ACTIVE) {
    throw new Error('진행 중인 런에서만 보상을 선택할 수 있습니다.');
  }

  var stageState = getStageState_(run);
  var rewardState = stageState.reward;
  if (!rewardState || !rewardState.choices || !rewardState.choices.length) {
    throw new Error('선택 가능한 보상이 없습니다.');
  }
  if (rewardState.selectedRewardId) {
    throw new Error('이미 보상을 선택했습니다.');
  }

  var reward = rewardState.choices.filter(function(choice) {
    return choice.rewardId === rewardId;
  })[0];
  if (!reward) {
    throw new Error('보상 후보에 없는 보상입니다.');
  }

  if (!rewardState.currencyGranted) {
    var currencyResult = grantCurrencyForRun_(run, stageState, rewardState.rewardGroupId);
    rewardState.currencyGranted = true;
    rewardState.currencyAmount = currencyResult.amount;
  }

  var runState = {
    run: run,
    stats: safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS)),
    skills: safeJsonParse_(run.skillsJson, []),
    items: safeJsonParse_(run.itemsJson, []),
    currentHp: Number(run.currentHp || 0),
  };

  if (reward.type === REWARD_TYPES.STAT) {
    applyStatReward(runState, reward);
  } else if (reward.type === REWARD_TYPES.SKILL) {
    if (hasOwnedSkill_(runState.skills, reward.targetId)) {
      applySkillUpgradeReward_(runState, Object.assign({}, reward, { type: REWARD_TYPES.SKILL_UPGRADE }));
    } else {
      applySkillReward(runState, reward);
    }
  } else if (reward.type === REWARD_TYPES.SKILL_UPGRADE) {
    applySkillUpgradeReward_(runState, reward);
  }

  rewardState.selectedRewardId = reward.rewardId;
  rewardState.selectedAt = new Date().toISOString();
  stageState.reward = rewardState;
  updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
    currentHp: Math.min(Number(runState.stats.hp || BASE_PLAYER_STATS.hp), Number(runState.currentHp || 0)),
    statsJson: safeJsonStringify_(runState.stats),
    skillsJson: safeJsonStringify_(runState.skills),
    stageStateJson: safeJsonStringify_(stageState),
    updatedAt: new Date(),
  });

  var movedRun = moveToNextStageForRun_(requireRun_(runId));
  updatePlayerProgressFromRun_(requireRun_(runId));
  if (movedRun.status === STATUS.RUN_CLEARED) {
    return {
      cleared: true,
      run: toClientObject_(movedRun),
      selectedReward: reward,
      currencyAmount: rewardState.currencyAmount,
    };
  }

  startBattle(runId);
  var nextRun = requireRun_(runId);
  return Object.assign(buildBattleView_(nextRun, getStageState_(nextRun)), {
    rewardSelected: true,
    selectedReward: reward,
    currencyAmount: rewardState.currencyAmount,
  });
}

function grantCurrency(runId, rewardGroupId, authToken) {
  var run = requireRun_(runId);
  requireRewardRunOwner_(run, authToken);
  var stageState = getStageState_(run);
  return grantCurrencyForRun_(run, stageState, rewardGroupId);
}

function grantStageClearRegenForRun_(run, stageState) {
  var runId = run.runId;
  var rewardState = stageState.reward || {};
  if (rewardState.stageClearRegenApplied) {
    return { run: run, stageState: stageState, amount: Number(rewardState.regenAmount || 0) };
  }

  var stats = safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS));
  var maxHp = Math.max(1, Number(stats.hp || BASE_PLAYER_STATS.hp));
  var currentHp = Math.max(0, Number(run.currentHp || 0));
  var regen = Math.max(0, Math.round(Number(stats.hpRegen || 0)));
  var amount = Math.max(0, Math.min(regen, maxHp - currentHp));
  var nextHp = currentHp + amount;
  rewardState.stageClearRegenApplied = true;
  rewardState.regenAmount = amount;
  rewardState.currentHpAfterRegen = nextHp;
  rewardState.maxHpAfterRegen = maxHp;
  stageState.reward = rewardState;

  updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
    currentHp: nextHp,
    stageStateJson: safeJsonStringify_(stageState),
    updatedAt: new Date(),
  });

  return {
    run: requireRun_(runId),
    stageState: getStageState_(requireRun_(runId)),
    amount: amount,
  };
}

function grantCurrencyForRun_(run, stageState, rewardGroupId) {
  var runId = run.runId;
  var rewardState = stageState.reward || {};
  if (rewardState.rewardGroupId === rewardGroupId && rewardState.currencyGranted) {
    return { amount: Number(rewardState.currencyAmount || 0), total: Number(run.currency || 0) };
  }

  var group = findCachedRowByKey_(DB_SHEETS.REWARD_GROUPS, 'rewardGroupId', rewardGroupId, 600);
  if (!group) {
    throw new Error('보상 그룹을 찾을 수 없습니다: ' + rewardGroupId);
  }

  var min = Number(group.currencyMin || 0);
  var max = Number(group.currencyMax || min);
  var amount = randomInt_(Math.min(min, max), Math.max(min, max));
  var nextRunCurrency = Number(run.currency || 0) + amount;
  rewardState.rewardGroupId = rewardGroupId;
  rewardState.currencyGranted = true;
  rewardState.currencyAmount = amount;
  stageState.reward = rewardState;
  updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
    currency: nextRunCurrency,
    stageStateJson: safeJsonStringify_(stageState),
    updatedAt: new Date(),
  });

  var playerData = getPlayerData_(run.playerId);
  if (playerData) {
    updateRowByKey_(DB_SHEETS.PLAYER_DATA, 'playerId', run.playerId, {
      currency: Number(playerData.currency || 0) + amount,
      updatedAt: new Date(),
    });
  }

  return { amount: amount, total: nextRunCurrency };
}

function applyStatReward(runState, reward) {
  if (ALLOWED_REWARD_STAT_KEYS_.indexOf(reward.targetId) === -1) {
    throw new Error('허용되지 않은 능력치 보상입니다: ' + reward.targetId);
  }

  var value = Number(reward.value || 0);
  runState.stats[reward.targetId] = Number(runState.stats[reward.targetId] || 0) + value;
  if (reward.targetId === STAT_KEYS.HP) {
    runState.currentHp = Number(runState.currentHp || 0) + value;
  }
  return runState;
}

function applySkillReward(runState, reward) {
  var skillId = String(reward.targetId || '').trim();
  if (!skillId) {
    throw new Error('스킬 보상 targetId가 비어 있습니다.');
  }

  var exists = runState.skills.some(function(skill) {
    return String(skill.skillId || skill) === skillId;
  });
  if (!exists) {
    runState.skills.push({
      skillId: skillId,
      level: Math.max(1, Number(reward.value || 1)),
      acquiredAt: new Date().toISOString(),
    });
  }
  return runState;
}

function applySkillUpgradeReward_(runState, reward) {
  var skillId = String(reward.targetId || '').trim();
  if (!skillId) {
    throw new Error('스킬 강화 보상 targetId가 비어 있습니다.');
  }

  var found = false;
  runState.skills = normalizeOwnedSkills_(runState.skills).map(function(skill) {
    if (skill.skillId === skillId) {
      found = true;
      return Object.assign({}, skill, {
        level: Number(skill.level || 1) + Math.max(1, Number(reward.value || 1)),
      });
    }
    return skill;
  });
  if (!found) {
    runState.skills.push({
      skillId: skillId,
      level: Math.max(1, Number(reward.value || 1)),
      acquiredAt: new Date().toISOString(),
    });
  }
  return runState;
}

function moveToNextStage(runId, authToken) {
  var run = requireRun_(runId);
  requireRewardRunOwner_(run, authToken);
  return moveToNextStageForRun_(run);
}

function moveToNextStageForRun_(run) {
  var runId = run.runId;
  var floor = Number(run.currentFloor || 1);
  var stage = Number(run.currentStage || 1);
  var now = new Date();

  if (floor >= GAME_RULES.FLOOR_COUNT && stage >= GAME_RULES.STAGES_PER_FLOOR) {
    var startedAt = run.startedAt ? new Date(run.startedAt).getTime() : now.getTime();
    return updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
      status: STATUS.RUN_CLEARED,
      endedAt: now,
      clearTimeMs: Math.max(0, now.getTime() - startedAt),
      currentShield: 0,
      stageStateJson: safeJsonStringify_({ cleared: true }),
      updatedAt: now,
    });
  }

  var nextFloor = floor;
  var nextStage = stage + 1;
  if (nextStage > GAME_RULES.STAGES_PER_FLOOR) {
    nextFloor += 1;
    nextStage = 1;
  }

  return updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
    currentFloor: nextFloor,
    currentStage: nextStage,
    currentShield: 0,
    stageStateJson: safeJsonStringify_({
      stageId: buildStageId_(nextFloor, nextStage),
      otherStudentQuestionShown: false,
      fallbackEvents: [],
    }),
    updatedAt: now,
  });
}

function updatePlayerProgressFromRun(runId, authToken) {
  var run = requireRun_(runId);
  requireRewardRunOwner_(run, authToken);
  return updatePlayerProgressFromRun_(run);
}

function updatePlayerProgressFromRun_(run) {
  var playerData = getPlayerData_(run.playerId) || ensurePlayerData_(run.playerId);
  var currentBestIndex = (Number(playerData.maxFloor || 1) * 100) + Number(playerData.maxStage || 1);
  var runIndex = (Number(run.currentFloor || 1) * 100) + Number(run.currentStage || 1);
  var patch = {
    currency: Number(playerData.currency || 0),
    updatedAt: new Date(),
  };

  if (runIndex > currentBestIndex || run.status === STATUS.RUN_CLEARED) {
    patch.maxFloor = Number(run.currentFloor || 1);
    patch.maxStage = Number(run.currentStage || 1);
  }

  if (run.status === STATUS.RUN_CLEARED && run.clearTimeMs !== '') {
    var clearTimeMs = Number(run.clearTimeMs || 0);
    var bestClearTimeMs = Number(playerData.bestClearTimeMs || 0);
    if (!bestClearTimeMs || clearTimeMs < bestClearTimeMs) {
      patch.bestClearTimeMs = clearTimeMs;
    }
  }

  return updateRowByKey_(DB_SHEETS.PLAYER_DATA, 'playerId', run.playerId, patch);
}

function pickRewardChoices_(rewardGroupId, floor, ownedSkills) {
  var group = findCachedRowByKey_(DB_SHEETS.REWARD_GROUPS, 'rewardGroupId', rewardGroupId, 600);
  if (!group) {
    throw new Error('보상 그룹을 찾을 수 없습니다: ' + rewardGroupId);
  }

  var rewardIds = safeJsonParse_(group.rewardIds, []);
  var rewards = readTableCached_(DB_SHEETS.REWARDS, 600).filter(function(reward) {
    var idAllowed = rewardIds.length === 0 || rewardIds.indexOf(reward.rewardId) !== -1;
    var floorAllowed = Number(reward.minFloor || 1) <= floor && Number(reward.maxFloor || GAME_RULES.FLOOR_COUNT) >= floor;
    var typeAllowed = reward.type === REWARD_TYPES.STAT || reward.type === REWARD_TYPES.SKILL || reward.type === REWARD_TYPES.SKILL_UPGRADE || reward.type === REWARD_TYPES.ITEM;
    var statAllowed = reward.type !== REWARD_TYPES.STAT || ALLOWED_REWARD_STAT_KEYS_.indexOf(reward.targetId) !== -1;
    var skillUpgradeAllowed = reward.type !== REWARD_TYPES.SKILL_UPGRADE || hasOwnedSkill_(ownedSkills, reward.targetId);
    return idAllowed && floorAllowed && typeAllowed && statAllowed && skillUpgradeAllowed;
  });

  var candidates = rewards.slice();
  var choices = [];
  while (choices.length < 3 && candidates.length > 0) {
    var picked = pickWeightedReward_(candidates);
    choices.push(picked);
    candidates = candidates.filter(function(candidate) {
      return candidate.rewardId !== picked.rewardId;
    });
  }

  if (choices.length === 0) {
    throw new Error('조건에 맞는 보상이 없습니다.');
  }
  return choices.map(function(choice) {
    return attachRewardRarity_(adaptRewardForChoice_(choice, ownedSkills));
  });
}

function adaptRewardForChoice_(reward, ownedSkills) {
  if (reward.type === REWARD_TYPES.SKILL && hasOwnedSkill_(ownedSkills, reward.targetId)) {
    return buildSkillUpgradeRewardView_(reward);
  }
  if (reward.type === REWARD_TYPES.SKILL_UPGRADE) {
    return buildSkillUpgradeRewardView_(reward);
  }
  return reward;
}

function buildSkillUpgradeRewardView_(reward) {
  var skillName = getRewardSkillName_(reward.targetId);
  return Object.assign({}, reward, {
    type: REWARD_TYPES.SKILL_UPGRADE,
    description: '스킬 강화: ' + skillName,
    detailDescription: '이미 보유한 ' + skillName + '의 레벨이 ' + Math.max(1, Number(reward.value || 1)) + ' 증가합니다.',
  });
}

function getRewardSkillName_(skillId) {
  var skill = findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', skillId, 600);
  return skill && skill.name ? skill.name : String(skillId || '스킬');
}

function hasOwnedSkill_(skills, skillId) {
  return normalizeOwnedSkills_(skills).some(function(skill) {
    return skill.skillId === skillId;
  });
}

function pickWeightedReward_(rewards) {
  var totalWeight = rewards.reduce(function(total, reward) {
    return total + Math.max(0, Number(reward.weight || 0));
  }, 0);
  if (totalWeight <= 0) {
    return pickRandom_(rewards);
  }

  var cursor = Math.random() * totalWeight;
  for (var i = 0; i < rewards.length; i += 1) {
    cursor -= Math.max(0, Number(rewards[i].weight || 0));
    if (cursor <= 0) {
      return rewards[i];
    }
  }
  return rewards[rewards.length - 1];
}

function sanitizeRewardForClient_(reward, battleState) {
  var rarity = resolveRewardRarity_(reward);
  return {
    rewardId: reward.rewardId,
    type: reward.type,
    targetId: reward.targetId,
    value: Number(reward.value || 0),
    description: reward.description,
    detailDescription: reward.detailDescription || '',
    displayTitle: getRewardDisplayTitle_(reward),
    rarity: rarity,
    rarityLabel: getRarityLabel_(rarity),
    skillDetail: buildRewardSkillDetail_(reward, battleState),
  };
}

function buildRewardSkillDetail_(reward, battleState) {
  if (!reward || (reward.type !== REWARD_TYPES.SKILL && reward.type !== REWARD_TYPES.SKILL_UPGRADE) || !reward.targetId) {
    return null;
  }

  var skill = findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', reward.targetId, 600);
  if (!skill) {
    return null;
  }

  var hydrated = hydrateSkill_(skill, Math.max(1, Number(reward.level || 1)));
  var previewBattleState = battleState || {
    player: {
      stats: Object.assign({}, BASE_PLAYER_STATS),
      effects: [],
    },
    monsters: [],
    skillUseCounts: {},
    skillCooldowns: {},
  };
  return {
    skillId: hydrated.skillId,
    name: hydrated.name,
    type: hydrated.type,
    target: hydrated.target,
    level: hydrated.level,
    baseValue: Number(hydrated.baseValue || 0),
    cooldown: hydrated.cooldown || '',
    cooldownText: buildSkillCooldownText_(hydrated),
    useLimitText: buildSkillUseLimitText_(hydrated, previewBattleState),
    difficultyBonus: Number(hydrated.difficultyBonus || 0),
    actionPointCost: Number(hydrated.actionPointCost || 1),
    rarity: hydrated.rarity,
    rarityLabel: getRarityLabel_(hydrated.rarity),
    tags: hydrated.tags,
    description: hydrated.description,
    effectJson: hydrated.effectJson || '',
    previewText: buildSkillPreviewText_(hydrated, previewBattleState),
  };
}

function buildRewardChoiceView_(runId, stageId, rewardGroupId, rewardState, ownedSkills, battleState) {
  var skills = normalizeOwnedSkills_(ownedSkills || []);
  var choices = (rewardState.choices || []).filter(function(reward) {
    return reward.type !== REWARD_TYPES.SKILL_UPGRADE || hasOwnedSkill_(skills, reward.targetId);
  }).map(function(reward) {
    var adapted = attachRewardRarity_(adaptRewardForChoice_(reward, skills));
    var ownedSkill = skills.filter(function(skill) {
      return skill.skillId === adapted.targetId;
    })[0];
    if (adapted.type === REWARD_TYPES.SKILL_UPGRADE && ownedSkill) {
      adapted.level = Number(ownedSkill.level || 1) + Math.max(1, Number(adapted.value || 1));
    } else if (adapted.type === REWARD_TYPES.SKILL && ownedSkill) {
      adapted.level = Number(ownedSkill.level || 1);
    }
    return sanitizeRewardForClient_(adapted, battleState);
  });
  return {
    runId: runId,
    stageId: stageId,
    rewardGroupId: rewardGroupId,
    currencyAmount: Number(rewardState.currencyAmount || 0),
    regenAmount: Number(rewardState.regenAmount || 0),
    currentHpAfterRegen: Number(rewardState.currentHpAfterRegen || 0),
    maxHpAfterRegen: Number(rewardState.maxHpAfterRegen || 0),
    choices: choices,
  };
}

function attachRewardRarity_(reward) {
  var rarity = resolveRewardRarity_(reward);
  return Object.assign({}, reward, {
    rarity: rarity,
    rarityLabel: getRarityLabel_(rarity),
  });
}

function resolveRewardRarity_(reward) {
  var ownRarity = normalizeRarity_(reward && reward.rarity);
  if (!reward) {
    return RARITIES.COMMON;
  }

  if (reward.type === REWARD_TYPES.SKILL || reward.type === REWARD_TYPES.SKILL_UPGRADE) {
    var skill = findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', reward.targetId, 600);
    return normalizeRarity_(skill && skill.rarity) || ownRarity || RARITIES.COMMON;
  }

  if (reward.type === REWARD_TYPES.ITEM) {
    var item = findCachedRowByKey_(DB_SHEETS.ITEMS, 'itemId', reward.targetId, 600);
    return normalizeRarity_(item && item.rarity) || ownRarity || RARITIES.COMMON;
  }

  return ownRarity || RARITIES.COMMON;
}

function normalizeRarity_(rarity) {
  var value = String(rarity || '').trim();
  if (!value) {
    return '';
  }

  var lower = value.toLowerCase();
  var aliases = {};
  aliases[RARITIES.COMMON] = RARITIES.COMMON;
  aliases[RARITIES.UNCOMMON] = RARITIES.UNCOMMON;
  aliases[RARITIES.RARE] = RARITIES.RARE;
  aliases[RARITIES.EPIC] = RARITIES.EPIC;
  aliases[RARITIES.LEGENDARY] = RARITIES.LEGENDARY;
  aliases[RARITIES.UNIQUE] = RARITIES.UNIQUE;
  aliases['일반'] = RARITIES.COMMON;
  aliases['드문'] = RARITIES.UNCOMMON;
  aliases['희귀'] = RARITIES.RARE;
  aliases['영웅'] = RARITIES.EPIC;
  aliases['전설'] = RARITIES.LEGENDARY;
  aliases['고유'] = RARITIES.UNIQUE;

  return aliases[value] || aliases[lower] || '';
}

function getRarityLabel_(rarity) {
  var normalized = normalizeRarity_(rarity) || RARITIES.COMMON;
  return RARITY_LABELS[normalized] || RARITY_LABELS.common;
}

function getRewardDisplayTitle_(reward) {
  if (!reward) {
    return '보상';
  }
  if (reward.type === REWARD_TYPES.STAT) {
    return '스텟 증가';
  }
  if (reward.type === REWARD_TYPES.SKILL) {
    return '스킬 획득';
  }
  if (reward.type === REWARD_TYPES.SKILL_UPGRADE) {
    return '스킬 강화';
  }
  if (reward.type === REWARD_TYPES.ITEM) {
    return '아이템 획득';
  }
  return '보상';
}

function randomInt_(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}

function requireRewardRunOwner_(run, authToken) {
  var player = getCurrentPlayer_(authToken);
  if (run.playerId !== player.playerId) {
    throw new Error('현재 플레이어의 런이 아닙니다.');
  }
}
