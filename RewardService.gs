var ALLOWED_REWARD_STAT_KEYS_ = Object.freeze([
  'attack',
  'hp',
  'hpRegen',
  'evasion',
  'criticalRate',
  'criticalDamage',
  'defense',
]);

function generateRewardChoices(runId, stageId) {
  var run = requireRun_(runId);
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
  if (rewardState.stageId === currentStageId && rewardState.choices && rewardState.choices.length) {
    if (!rewardState.currencyGranted) {
      rewardState.currencyAmount = grantCurrency(runId, rewardGroupId).amount;
      rewardState.currencyGranted = true;
      stageState.reward = rewardState;
      updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
        stageStateJson: safeJsonStringify_(stageState),
        updatedAt: new Date(),
      });
    }
    return buildRewardChoiceView_(runId, currentStageId, rewardGroupId, rewardState);
  }

  var choices = pickRewardChoices_(rewardGroupId, Number(stage.floor || run.currentFloor));
  var currencyResult = grantCurrency(runId, rewardGroupId);
  run = requireRun_(runId);
  stageState = getStageState_(run);
  rewardState = {
    stageId: currentStageId,
    rewardGroupId: rewardGroupId,
    choices: choices.map(sanitizeRewardForClient_),
    selectedRewardId: '',
    currencyGranted: true,
    currencyAmount: currencyResult.amount,
    createdAt: new Date().toISOString(),
  };
  stageState.reward = rewardState;
  updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
    stageStateJson: safeJsonStringify_(stageState),
    updatedAt: new Date(),
  });

  return buildRewardChoiceView_(runId, currentStageId, rewardGroupId, rewardState);
}

function selectReward(runId, rewardId) {
  var run = requireRun_(runId);
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
    var currencyResult = grantCurrency(runId, rewardState.rewardGroupId);
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
    applySkillReward(runState, reward);
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

  var movedRun = moveToNextStage(runId);
  updatePlayerProgressFromRun(runId);
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

function grantCurrency(runId, rewardGroupId) {
  var run = requireRun_(runId);
  var stageState = getStageState_(run);
  var rewardState = stageState.reward || {};
  if (rewardState.rewardGroupId === rewardGroupId && rewardState.currencyGranted) {
    return { amount: Number(rewardState.currencyAmount || 0), total: Number(run.currency || 0) };
  }

  var group = findRowByKey_(DB_SHEETS.REWARD_GROUPS, 'rewardGroupId', rewardGroupId);
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

function moveToNextStage(runId) {
  var run = requireRun_(runId);
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

function updatePlayerProgressFromRun(runId) {
  var run = requireRun_(runId);
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

function pickRewardChoices_(rewardGroupId, floor) {
  var group = findRowByKey_(DB_SHEETS.REWARD_GROUPS, 'rewardGroupId', rewardGroupId);
  if (!group) {
    throw new Error('보상 그룹을 찾을 수 없습니다: ' + rewardGroupId);
  }

  var rewardIds = safeJsonParse_(group.rewardIds, []);
  var rewards = readTable_(DB_SHEETS.REWARDS).filter(function(reward) {
    var idAllowed = rewardIds.length === 0 || rewardIds.indexOf(reward.rewardId) !== -1;
    var floorAllowed = Number(reward.minFloor || 1) <= floor && Number(reward.maxFloor || GAME_RULES.FLOOR_COUNT) >= floor;
    var typeAllowed = reward.type === REWARD_TYPES.STAT || reward.type === REWARD_TYPES.SKILL || reward.type === REWARD_TYPES.SKILL_UPGRADE || reward.type === REWARD_TYPES.ITEM;
    var statAllowed = reward.type !== REWARD_TYPES.STAT || ALLOWED_REWARD_STAT_KEYS_.indexOf(reward.targetId) !== -1;
    return idAllowed && floorAllowed && typeAllowed && statAllowed && String(reward.targetId).indexOf('magicAttack') === -1;
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
  return choices;
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

function sanitizeRewardForClient_(reward) {
  return {
    rewardId: reward.rewardId,
    type: reward.type,
    targetId: reward.targetId,
    value: Number(reward.value || 0),
    description: reward.description,
  };
}

function buildRewardChoiceView_(runId, stageId, rewardGroupId, rewardState) {
  return {
    runId: runId,
    stageId: stageId,
    rewardGroupId: rewardGroupId,
    currencyAmount: Number(rewardState.currencyAmount || 0),
    choices: rewardState.choices || [],
  };
}

function randomInt_(min, max) {
  return Math.floor(Math.random() * (max - min + 1)) + min;
}
