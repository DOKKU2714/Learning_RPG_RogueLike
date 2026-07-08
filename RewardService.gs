var ALLOWED_REWARD_STAT_KEYS_ = Object.freeze([
  'attack',
  'hp',
  'hpRegen',
  'evasion',
  'criticalRate',
  'criticalDamage',
  'defense',
  'accuracy',
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
  var rewardGroupId = getDefaultRewardGroupId_();
  var isFloorRestChoice = isFloorRestStage_(stage);
  var rewardState = stageState.reward || {};
  var ownedSkills = safeJsonParse_(run.skillsJson, []);
  var ownedItems = safeJsonParse_(run.itemsJson, []);
  var regenResult = grantStageClearRegenForRun_(run, stageState);
  run = regenResult.run;
  stageState = regenResult.stageState;
  rewardState = stageState.reward || {};
  if (rewardState.stageId === currentStageId && rewardState.choices && rewardState.choices.length) {
    if (shouldRegenerateRewardChoices_(rewardState, ownedItems)) {
      rewardState.choices = [];
      rewardState.selectedRewardId = '';
    } else {
      if (!rewardState.currencyGranted && !rewardState.floorRestChoice) {
        rewardState.currencyAmount = grantCurrencyForRun_(run, stageState, rewardGroupId).amount;
        rewardState.currencyGranted = true;
        stageState.reward = rewardState;
        updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
          stageStateJson: safeJsonStringify_(stageState),
          updatedAt: new Date(),
        });
      }
      return buildRewardChoiceView_(runId, currentStageId, rewardGroupId, rewardState, ownedSkills, stageState.battle);
    }
  }

  var choices = isFloorRestChoice
    ? buildFloorRestChoices_(run, stageState.battle, rewardGroupId, Number(stage.floor || run.currentFloor), ownedSkills, ownedItems)
    : pickRewardChoices_(rewardGroupId, Number(stage.floor || run.currentFloor), ownedSkills, ownedItems);
  var currencyAmount = isFloorRestChoice
    ? previewCurrencyReward_(rewardGroupId)
    : grantCurrencyForRun_(run, stageState, rewardGroupId).amount;
  run = requireRun_(runId);
  stageState = getStageState_(run);
  rewardState = {
    stageId: currentStageId,
    rewardGroupId: rewardGroupId,
    choices: choices.map(function(reward) {
      return sanitizeRewardForClient_(reward, stageState.battle);
    }),
    selectedRewardId: '',
    currencyGranted: !isFloorRestChoice,
    currencyAmount: currencyAmount,
    floorRestChoice: isFloorRestChoice,
    intermissionStage: isFloorRestChoice ? buildFloorRestStageView_(stage) : null,
    stageClearRegenApplied: !!rewardState.stageClearRegenApplied,
    regenAmount: Number(rewardState.regenAmount || 0),
    currentHpAfterRegen: Number(rewardState.currentHpAfterRegen || run.currentHp || 0),
    maxHpAfterRegen: Number(rewardState.maxHpAfterRegen || calculateStatsWithItemEffects_(safeJsonParse_(run.statsJson, BASE_PLAYER_STATS), safeJsonParse_(run.itemsJson, [])).hp || BASE_PLAYER_STATS.hp),
    createdAt: new Date().toISOString(),
  };
  stageState.reward = rewardState;
  updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
    stageStateJson: safeJsonStringify_(stageState),
    updatedAt: new Date(),
  });

  return buildRewardChoiceView_(runId, currentStageId, rewardGroupId, rewardState, ownedSkills, stageState.battle);
}

function previewRewardChoicesForStageResult(stagePayload, authToken) {
  var payload = stagePayload || {};
  var run = requireRun_(payload.runId);
  requireRewardRunOwner_(run, authToken);
  if (run.status !== STATUS.RUN_ACTIVE) {
    throw new Error('진행 중인 런에서만 보상을 생성할 수 있습니다.');
  }

  var battle = payload.battle || {};
  if (battle.status !== STATUS.BATTLE_VICTORY) {
    throw new Error('전투 승리 후에만 보상을 받을 수 있습니다.');
  }

  var currentStageId = battle.stage && battle.stage.stageId || buildStageId_(run.currentFloor, run.currentStage);
  var stage = loadStage(currentStageId);
  var rewardGroupId = getDefaultRewardGroupId_();
  var isFloorRestChoice = isFloorRestStage_(stage);
  var clientStageState = payload.stageState || {};
  var rewardState = clientStageState.reward || {};
  var ownedSkills = safeJsonParse_(run.skillsJson, []);
  var ownedItems = safeJsonParse_(run.itemsJson, []);
  if (!(rewardState.stageId === currentStageId && rewardState.choices && rewardState.choices.length) || shouldRegenerateRewardChoices_(rewardState, ownedItems)) {
    var previewRegen = previewStageClearRegen_(run, battle);
    var battleAfterPreviewRegen = Object.assign({}, battle, {
      player: Object.assign({}, battle.player || {}, {
        hp: previewRegen.nextHp,
      }),
    });
    var choices = isFloorRestChoice
      ? buildFloorRestChoices_(run, battleAfterPreviewRegen, rewardGroupId, Number(stage.floor || run.currentFloor), ownedSkills, ownedItems)
      : pickRewardChoices_(rewardGroupId, Number(stage.floor || run.currentFloor), ownedSkills, ownedItems);
    rewardState = {
      stageId: currentStageId,
      rewardGroupId: rewardGroupId,
      choices: choices,
      selectedRewardId: '',
      currencyGranted: false,
      currencyAmount: previewCurrencyReward_(rewardGroupId),
      floorRestChoice: isFloorRestChoice,
      intermissionStage: isFloorRestChoice ? buildFloorRestStageView_(stage) : null,
      stageClearRegenApplied: true,
      regenAmount: previewRegen.amount,
      currentHpAfterRegen: previewRegen.nextHp,
      maxHpAfterRegen: previewRegen.maxHp,
      createdAt: new Date().toISOString(),
    };
  }

  return buildRewardChoiceView_(run.runId, currentStageId, rewardGroupId, rewardState, ownedSkills, battle);
}

function previewStageClearRegen_(run, battle) {
  var runItems = safeJsonParse_(run.itemsJson, []);
  var stats = battle && battle.player && battle.player.stats
    ? battle.player.stats
    : calculateStatsWithItemEffects_(safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS)), runItems);
  var maxHp = Math.max(1, Number(stats.hp || battle && battle.player && battle.player.maxHp || BASE_PLAYER_STATS.hp));
  var currentHp = Math.max(0, Number(battle && battle.player && battle.player.hp || run.currentHp || 0));
  var regen = Math.max(0, Math.round(Number(stats.hpRegen || 0)));
  var amount = Math.max(0, Math.min(regen, maxHp - currentHp));
  return {
    amount: amount,
    nextHp: currentHp + amount,
    maxHp: maxHp,
  };
}

function previewCurrencyReward_(rewardGroupId) {
  var config = getRewardConfig_();
  var min = Number(config.currencyMin || 0);
  var max = Number(config.currencyMax || min);
  return randomInt_(Math.min(min, max), Math.max(min, max));
}

function getRewardConfig_() {
  return typeof REWARD_CONFIG !== 'undefined'
    ? REWARD_CONFIG
    : {
      choicesCount: 3,
      ensureItemRewardChoice: false,
      currencyMin: 5,
      currencyMax: 15,
      typeWeights: { stat: 40, skill: 30, item: 20 },
    };
}

function getDefaultRewardGroupId_() {
  return 'reward_global';
}

function shouldRegenerateRewardChoices_(rewardState, ownedItems) {
  var config = getRewardConfig_();
  if (!config.ensureItemRewardChoice || !rewardState || rewardState.selectedRewardId) {
    return false;
  }
  var choices = rewardState.choices || [];
  if (!choices.length || choices.some(function(choice) { return choice.type === REWARD_TYPES.ITEM; })) {
    return false;
  }
  return typeof hasAvailableItemReward_ === 'function' && hasAvailableItemReward_(ownedItems);
}

function isFloorRestStage_(stage) {
  var floor = Number(stage && stage.floor || 1);
  var stageNumber = Number(stage && stage.stage || 1);
  return floor < GAME_RULES.FLOOR_COUNT
    && stageNumber === GAME_RULES.FLOOR_REST_STAGE;
}

function shouldOfferFloorRestChoice_(stage) {
  return isFloorRestStage_(stage);
}

function buildFloorRestStageView_(stage) {
  return {
    stageId: buildStageId_(Number(stage.floor || 1), GAME_RULES.FLOOR_REST_STAGE),
    floor: Number(stage.floor || 1),
    stage: GAME_RULES.FLOOR_REST_STAGE,
    name: Number(stage.floor || 1) + '층-' + GAME_RULES.FLOOR_REST_STAGE + '스테이지',
  };
}

function buildFloorRestRewardChoice_(run, battle) {
  var preview = previewFloorRestHeal_(run, battle);
  return {
    rewardId: 'floor_rest_heal',
    type: REWARD_TYPES.REST,
    targetId: STAT_KEYS.HP,
    value: GAME_RULES.FLOOR_REST_HEAL_PERCENT,
    weight: 0,
    minFloor: 1,
    maxFloor: GAME_RULES.FLOOR_COUNT,
    description: '휴식',
    detailDescription: '최대 체력의 ' + GAME_RULES.FLOOR_REST_HEAL_PERCENT + '%만큼 회복합니다. 현재 기준 +' + preview.amount + ' 회복.',
    rarity: RARITIES.COMMON,
    healAmount: preview.amount,
    currentHpAfterRest: preview.nextHp,
    maxHpAfterRest: preview.maxHp,
  };
}

function buildFloorRestChoices_(run, battle, rewardGroupId, floor, ownedSkills, ownedItems) {
  return [
    buildFloorRestRewardChoice_(run, battle),
    buildFloorRestClaimRewardChoice_(rewardGroupId, floor, ownedSkills, ownedItems),
  ];
}

function buildFloorRestRewardViewForRun_(run, stageState) {
  var stage = loadStage(stageState.stageId || buildStageId_(run.currentFloor, run.currentStage));
  var rewardGroupId = getDefaultRewardGroupId_();
  var ownedSkills = safeJsonParse_(run.skillsJson, []);
  var ownedItems = safeJsonParse_(run.itemsJson, []);
  var rewardState = {
    stageId: stage.stageId,
    rewardGroupId: rewardGroupId,
    choices: buildFloorRestChoices_(run, stageState.battle, rewardGroupId, Number(stage.floor || run.currentFloor), ownedSkills, ownedItems).map(function(reward) {
      return sanitizeRewardForClient_(reward, stageState.battle);
    }),
    selectedRewardId: '',
    currencyGranted: false,
    currencyAmount: previewCurrencyReward_(rewardGroupId),
    floorRestChoice: true,
    intermissionStage: buildFloorRestStageView_(stage),
    stageClearRegenApplied: true,
    regenAmount: 0,
    currentHpAfterRegen: Number(run.currentHp || 0),
    maxHpAfterRegen: Number(calculateStatsWithItemEffects_(safeJsonParse_(run.statsJson, BASE_PLAYER_STATS), ownedItems).hp || BASE_PLAYER_STATS.hp),
    createdAt: new Date().toISOString(),
  };
  stageState.reward = rewardState;
  updateRowByKey_(DB_SHEETS.RUNS, 'runId', run.runId, {
    stageStateJson: safeJsonStringify_(stageState),
    updatedAt: new Date(),
  });
  return {
    showReward: true,
    runId: run.runId,
    battle: stageState.battle || null,
    availableSkills: [],
    questionCache: [],
    stageState: {
      otherStudentQuestionShown: !!stageState.otherStudentQuestionShown,
      fallbackEvents: stageState.fallbackEvents || [],
      reward: rewardState,
      playerGhost: stageState.playerGhost || null,
    },
    rewardView: buildRewardChoiceView_(run.runId, stage.stageId, rewardGroupId, rewardState, ownedSkills, stageState.battle),
  };
}

function buildFloorRestClaimRewardChoice_(rewardGroupId, floor, ownedSkills, ownedItems) {
  var picked = pickRewardChoices_(rewardGroupId, floor, ownedSkills, ownedItems)[0] || pickFallbackRewardChoice_([], ownedSkills, ownedItems, []);
  return {
    rewardId: 'floor_rest_claim_reward',
    type: 'rewardClaim',
    targetId: picked ? picked.rewardId : '',
    value: 1,
    weight: 0,
    minFloor: 1,
    maxFloor: GAME_RULES.FLOOR_COUNT,
    description: '보상 획득',
    detailDescription: picked ? '휴식하지 않고 보상을 하나 획득합니다: ' + (picked.description || picked.rewardId) : '휴식하지 않고 보상을 하나 획득합니다.',
    rarity: picked ? resolveRewardRarity_(picked) : RARITIES.COMMON,
    claimReward: picked,
  };
}

function previewFloorRestHeal_(run, battle) {
  var runItems = safeJsonParse_(run.itemsJson, []);
  var stats = battle && battle.player && battle.player.stats
    ? battle.player.stats
    : calculateStatsWithItemEffects_(safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS)), runItems);
  var maxHp = Math.max(1, Number(stats.hp || battle && battle.player && battle.player.maxHp || BASE_PLAYER_STATS.hp));
  var battleHp = Number(battle && battle.player && battle.player.hp || 0);
  var runHp = Number(run.currentHp || 0);
  var currentHp = Math.max(0, Math.max(battleHp, runHp));
  var rawAmount = Math.ceil(maxHp * (Number(GAME_RULES.FLOOR_REST_HEAL_PERCENT || 0) / 100));
  var amount = Math.max(0, Math.min(rawAmount, maxHp - currentHp));
  return {
    amount: amount,
    nextHp: currentHp + amount,
    maxHp: maxHp,
  };
}

function selectReward(runId, rewardId, authToken, rewardView) {
  var run = requireRun_(runId);
  requireRewardRunOwner_(run, authToken);
  if (run.status !== STATUS.RUN_ACTIVE) {
    throw new Error('진행 중인 런에서만 보상을 선택할 수 있습니다.');
  }

  var stageState = getStageState_(run);
  var rewardState = stageState.reward;
  if ((!rewardState || !rewardState.choices || !rewardState.choices.length) && rewardView && rewardView.choices && rewardView.choices.length) {
    rewardState = {
      stageId: rewardView.stageId || stageState.stageId || buildStageId_(run.currentFloor, run.currentStage),
      rewardGroupId: rewardView.rewardGroupId || '',
      choices: rewardView.choices,
      selectedRewardId: '',
      currencyGranted: false,
      currencyAmount: Number(rewardView.currencyAmount || 0),
      floorRestChoice: !!rewardView.floorRestChoice,
      intermissionStage: rewardView.intermissionStage || null,
      stageClearRegenApplied: true,
      regenAmount: Number(rewardView.regenAmount || 0),
      currentHpAfterRegen: Number(rewardView.currentHpAfterRegen || 0),
      maxHpAfterRegen: Number(rewardView.maxHpAfterRegen || 0),
      createdAt: new Date().toISOString(),
    };
    stageState.reward = rewardState;
  }
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

  var isRestReward = reward.type === REWARD_TYPES.REST;
  var appliedReward = reward.type === 'rewardClaim' && reward.claimReward ? reward.claimReward : reward;
  if (!isRestReward && !rewardState.currencyGranted) {
    var currencyResult = grantCurrencyForRun_(run, stageState, rewardState.rewardGroupId, rewardState.currencyAmount);
    rewardState.currencyGranted = true;
    rewardState.currencyAmount = currencyResult.amount;
  } else if (isRestReward) {
    rewardState.currencyAmount = 0;
  }

  var runState = {
    run: run,
    stats: safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS)),
    skills: safeJsonParse_(run.skillsJson, []),
    items: safeJsonParse_(run.itemsJson, []),
    currentHp: Number(run.currentHp || 0),
  };

  if (appliedReward.type === REWARD_TYPES.STAT) {
    applyStatReward(runState, appliedReward);
  } else if (appliedReward.type === REWARD_TYPES.SKILL) {
    if (hasOwnedSkill_(runState.skills, appliedReward.targetId)) {
      applySkillUpgradeReward_(runState, Object.assign({}, appliedReward, { type: REWARD_TYPES.SKILL_UPGRADE }));
    } else {
      applySkillReward(runState, appliedReward);
    }
  } else if (appliedReward.type === REWARD_TYPES.SKILL_UPGRADE) {
    applySkillUpgradeReward_(runState, appliedReward);
  } else if (appliedReward.type === REWARD_TYPES.ITEM) {
    applyItemReward_(runState, appliedReward);
  } else if (appliedReward.type === REWARD_TYPES.REST) {
    applyRestReward_(runState, appliedReward);
  }

  rewardState.selectedRewardId = reward.rewardId;
  rewardState.selectedAt = new Date().toISOString();
  stageState.reward = rewardState;
  updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
    currentHp: Math.min(Number(calculateStatsWithItemEffects_(runState.stats, runState.items).hp || BASE_PLAYER_STATS.hp), Number(runState.currentHp || 0)),
    statsJson: safeJsonStringify_(runState.stats),
    skillsJson: safeJsonStringify_(runState.skills),
    itemsJson: safeJsonStringify_(runState.items),
    stageStateJson: safeJsonStringify_(stageState),
    updatedAt: new Date(),
  });

  var movedRun = moveToNextStageForRun_(requireRun_(runId));
  updatePlayerProgressFromRun_(requireRun_(runId));
  if (movedRun.status === STATUS.RUN_CLEARED) {
    return {
      cleared: true,
      run: toClientObject_(movedRun),
      selectedReward: appliedReward,
      currencyAmount: isRestReward ? 0 : rewardState.currencyAmount,
    };
  }

  var movedStageState = getStageState_(movedRun);
  var movedStage = loadStage(movedStageState.stageId || buildStageId_(movedRun.currentFloor, movedRun.currentStage));
  if (isFloorRestStage_(movedStage)) {
    return buildFloorRestRewardViewForRun_(movedRun, movedStageState);
  }

  startBattle(runId);
  var nextRun = requireRun_(runId);
  return Object.assign(buildBattleView_(nextRun, getStageState_(nextRun)), {
    rewardSelected: true,
    selectedReward: appliedReward,
    currencyAmount: isRestReward ? 0 : rewardState.currencyAmount,
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

  var stats = calculateStatsWithItemEffects_(safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS)), safeJsonParse_(run.itemsJson, []));
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

function grantCurrencyForRun_(run, stageState, rewardGroupId, fixedAmount) {
  var runId = run.runId;
  var rewardState = stageState.reward || {};
  if (rewardState.rewardGroupId === rewardGroupId && rewardState.currencyGranted) {
    return { amount: Number(rewardState.currencyAmount || 0), total: Number(run.currency || 0) };
  }

  var config = getRewardConfig_();
  var min = Number(config.currencyMin || 0);
  var max = Number(config.currencyMax || min);
  var amount = fixedAmount !== undefined && fixedAmount !== ''
    ? Math.max(0, Math.round(Number(fixedAmount || 0)))
    : randomInt_(Math.min(min, max), Math.max(min, max));
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

function applyItemReward_(runState, reward) {
  var beforeStats = calculateStatsWithItemEffects_(runState.stats, runState.items);
  runState.items = addItemToOwnedItems_(runState.items, reward.targetId);
  var afterStats = calculateStatsWithItemEffects_(runState.stats, runState.items);
  var hpDelta = Math.max(0, Number(afterStats.hp || 1) - Number(beforeStats.hp || 1));
  runState.currentHp = Math.min(Number(afterStats.hp || 1), Math.max(0, Number(runState.currentHp || 0) + hpDelta));
  return runState;
}

function applyRestReward_(runState, reward) {
  var stats = calculateStatsWithItemEffects_(runState.stats, runState.items);
  var maxHp = Math.max(1, Number(stats.hp || BASE_PLAYER_STATS.hp));
  var percent = Number(reward.value || GAME_RULES.FLOOR_REST_HEAL_PERCENT || 0);
  var amount = Math.ceil(maxHp * (percent / 100));
  runState.currentHp = Math.min(maxHp, Math.max(0, Number(runState.currentHp || 0)) + Math.max(0, amount));
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
  if (stage === GAME_RULES.STAGES_PER_FLOOR && floor < GAME_RULES.FLOOR_COUNT) {
    nextStage = GAME_RULES.FLOOR_REST_STAGE;
  } else if (stage === GAME_RULES.FLOOR_REST_STAGE || nextStage > GAME_RULES.STAGES_PER_FLOOR) {
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

function pickRewardChoices_(rewardGroupId, floor, ownedSkills, ownedItems) {
  var rewards = getStatRewardRows_().filter(function(reward) {
    var typeAllowed = reward.type === REWARD_TYPES.STAT;
    var statAllowed = reward.type !== REWARD_TYPES.STAT || ALLOWED_REWARD_STAT_KEYS_.indexOf(reward.targetId) !== -1;
    return typeAllowed && statAllowed;
  });

  var candidates = rewards.slice();
  var choices = [];
  var attemptCount = 0;
  var config = getRewardConfig_();
  var choicesCount = Math.max(1, Number(config.choicesCount || 3));
  if (config.ensureItemRewardChoice) {
    var requiredItemReward = pickAutoItemReward_(ownedItems);
    if (requiredItemReward) {
      choices.push(requiredItemReward);
    }
  }
  while (choices.length < choicesCount && attemptCount < choicesCount * 8) {
    attemptCount += 1;
    var rewardType = pickRewardType_();
    var picked = null;
    if (rewardType === REWARD_TYPES.SKILL) {
      picked = pickAutoSkillReward_(ownedSkills);
    } else if (rewardType === REWARD_TYPES.ITEM) {
      picked = hasItemRewardChoice_(choices) ? null : pickAutoItemReward_(ownedItems);
    } else if (candidates.length > 0) {
      picked = pickWeightedReward_(candidates);
    }
    if (picked && choices.some(function(choice) { return choice.rewardId === picked.rewardId; })) {
      picked = null;
    }
    if (!picked) {
      picked = pickFallbackRewardChoice_(candidates, ownedSkills, ownedItems, choices);
    }
    if (!picked) {
      continue;
    }
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

function hasItemRewardChoice_(choices) {
  return (choices || []).some(function(choice) {
    return choice && choice.type === REWARD_TYPES.ITEM;
  });
}

function getStatRewardRows_() {
  var rows = [];
  try {
    rows = readTableCached_(DB_SHEETS.REWARDS, 600);
  } catch (error) {
    rows = [];
  }
  return rows && rows.length ? rows : MASTER_REWARDS.slice();
}

function pickRewardType_() {
  var weights = getRewardConfig_().typeWeights || {};
  var types = [REWARD_TYPES.STAT, REWARD_TYPES.SKILL, REWARD_TYPES.ITEM];
  var values = types.map(function(type) {
    return Math.max(0, Number(weights[type] || 0));
  });
  return pickWeighted_(types, values);
}

function pickFallbackRewardChoice_(candidates, ownedSkills, ownedItems, choices) {
  var picked = candidates.length > 0 ? pickWeightedReward_(candidates) : null;
  if (picked && !choices.some(function(choice) { return choice.rewardId === picked.rewardId; })) {
    return picked;
  }

  picked = pickAutoSkillReward_(ownedSkills);
  if (picked && !choices.some(function(choice) { return choice.rewardId === picked.rewardId; })) {
    return picked;
  }

  picked = hasItemRewardChoice_(choices) ? null : pickAutoItemReward_(ownedItems);
  if (picked && !choices.some(function(choice) { return choice.rewardId === picked.rewardId; })) {
    return picked;
  }

  return null;
}

function pickAutoSkillReward_(ownedSkills) {
  var rarity = pickSkillRewardRarity_(SKILL_REWARD_CONFIG.rarityWeights);
  var skill = pickSkillByRarityWithFallback_(rarity, ownedSkills, SKILL_REWARD_CONFIG);
  if (!skill) {
    return null;
  }
  return buildAutoSkillReward_(skill);
}

function pickSkillRewardRarity_(rarityWeights) {
  var ordered = [RARITIES.COMMON, RARITIES.UNCOMMON, RARITIES.RARE, RARITIES.EPIC, RARITIES.LEGENDARY, RARITIES.UNIQUE];
  var weights = ordered.map(function(rarity) {
    return Math.max(0, Number(rarityWeights && rarityWeights[rarity] || 0));
  });
  return pickWeighted_(ordered, weights);
}

function pickSkillByRarityWithFallback_(rarity, ownedSkills, config) {
  var ordered = [RARITIES.COMMON, RARITIES.UNCOMMON, RARITIES.RARE, RARITIES.EPIC, RARITIES.LEGENDARY, RARITIES.UNIQUE];
  var rarityIndex = Math.max(0, ordered.indexOf(rarity));
  for (var i = rarityIndex; i >= 0; i -= 1) {
    var pool = getAvailableSkillRewardPool_(ordered[i], ownedSkills, config);
    if (pool.length) {
      return pickRandom_(pool);
    }
  }
  var allPool = getAvailableSkillRewardPool_('', ownedSkills, Object.assign({}, config, { preferUnownedSkills: false }));
  return allPool.length ? pickRandom_(allPool) : null;
}

function getAvailableSkillRewardPool_(rarity, ownedSkills, config) {
  var ownedMap = normalizeOwnedSkills_(ownedSkills || []).reduce(function(map, skill) {
    map[skill.skillId] = skill;
    return map;
  }, {});
  var rows = getSkillRowsForRewards_();
  var pool = rows.filter(function(skill) {
    var skillId = String(skill.skillId || '').trim();
    var skillRarity = normalizeRarity_(skill.rarity) || RARITIES.COMMON;
    if (!skillId) {
      return false;
    }
    if (isSkillExcludedFromAutoRewards_(skill)) {
      return false;
    }
    if (rarity && skillRarity !== rarity) {
      return false;
    }
    if (config && config.preferUnownedSkills && ownedMap[skillId]) {
      return false;
    }
    return true;
  });
  if (!pool.length && config && config.preferUnownedSkills) {
    return getAvailableSkillRewardPool_(rarity, ownedSkills, Object.assign({}, config, { preferUnownedSkills: false }));
  }
  return pool;
}

function isSkillExcludedFromAutoRewards_(skill) {
  var skillId = String(skill && skill.skillId || '').trim();
  var skillName = String(skill && skill.name || '').trim();
  return skillId === 'skill_strike' || skillName === '타격';
}

function getSkillRowsForRewards_() {
  var rows = [];
  try {
    rows = readTableCached_(DB_SHEETS.SKILLS, 600);
  } catch (error) {
    rows = [];
  }
  return rows && rows.length ? rows : MASTER_SKILLS.slice();
}

function buildAutoSkillReward_(skill) {
  var rarity = normalizeRarity_(skill.rarity) || RARITIES.COMMON;
  return {
    rewardId: 'auto_skill_' + skill.skillId,
    type: REWARD_TYPES.SKILL,
    targetId: skill.skillId,
    value: 1,
    weight: 0,
    minFloor: 1,
    maxFloor: GAME_RULES.FLOOR_COUNT,
    description: '스킬 획득: ' + (skill.name || skill.skillId),
    detailDescription: skill.description || '',
    rarity: rarity,
  };
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
  var itemDetail = buildRewardItemDetail_(reward);
  var description = itemDetail ? itemDetail.name : reward.description;
  var detailDescription = itemDetail
    ? [itemDetail.effectSummary, itemDetail.description].filter(Boolean).join('\n')
    : reward.detailDescription || '';
  return {
    rewardId: reward.rewardId,
    type: reward.type,
    targetId: reward.targetId,
    value: Number(reward.value || 0),
    description: description,
    detailDescription: detailDescription,
    displayTitle: getRewardDisplayTitle_(reward),
    rarity: rarity,
    rarityLabel: getRarityLabel_(rarity),
    skillDetail: buildRewardSkillDetail_(reward, battleState),
    itemDetail: itemDetail,
    claimReward: reward.claimReward || null,
    healAmount: Number(reward.healAmount || 0),
    currentHpAfterRest: Number(reward.currentHpAfterRest || 0),
    maxHpAfterRest: Number(reward.maxHpAfterRest || 0),
  };
}

function buildRewardItemDetail_(reward) {
  if (!reward || reward.type !== REWARD_TYPES.ITEM || !reward.targetId) {
    return null;
  }
  return reward.itemDetail || buildItemClientDetail_(getItemById_(reward.targetId));
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
  var previewBattleState = buildRewardSkillPreviewBattleState_(battleState);
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
    actionPointCost: Number(hydrated.actionPointCost !== undefined && hydrated.actionPointCost !== '' ? hydrated.actionPointCost : 1),
    rarity: hydrated.rarity,
    rarityLabel: getRarityLabel_(hydrated.rarity),
    tags: hydrated.tags,
    description: hydrated.description,
    effectJson: hydrated.effectJson || '',
    previewText: buildSkillPreviewText_(hydrated, previewBattleState),
  };
}

function buildRewardSkillPreviewBattleState_(battleState) {
  if (!battleState || !battleState.player) {
    return {
      player: {
        stats: Object.assign({}, BASE_PLAYER_STATS),
        effects: [],
      },
      monsters: [],
      skillUseCounts: {},
      skillCooldowns: {},
      usedSkillCountByTagThisBattle: {},
      usedSkillCountByTagThisTurn: {},
    };
  }

  var preview = {
    player: Object.assign({}, battleState.player, {
      stats: Object.assign({}, battleState.player.stats || BASE_PLAYER_STATS),
      effects: [],
      buffs: [],
      debuffs: [],
    }),
    monsters: (battleState.monsters || []).map(function(monster) {
      return Object.assign({}, monster, {
        effects: [],
        buffs: [],
        debuffs: [],
      });
    }),
    skillUseCounts: Object.assign({}, battleState.skillUseCounts || {}),
    skillCooldowns: Object.assign({}, battleState.skillCooldowns || {}),
    usedSkillCountByTagThisBattle: Object.assign({}, battleState.usedSkillCountByTagThisBattle || {}),
    usedSkillCountByTagThisTurn: Object.assign({}, battleState.usedSkillCountByTagThisTurn || {}),
    usedSkillTagsThisBattle: (battleState.usedSkillTagsThisBattle || []).slice(),
    usedSkillTagsThisTurn: (battleState.usedSkillTagsThisTurn || []).slice(),
  };
  preview.monster = preview.monsters[0] || null;
  return preview;
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
    floorRestChoice: !!rewardState.floorRestChoice,
    intermissionStage: rewardState.intermissionStage || null,
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
    var item = getItemById_(reward.targetId);
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
  if (reward.type === REWARD_TYPES.REST) {
    return '휴식';
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
