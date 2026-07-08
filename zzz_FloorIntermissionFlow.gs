/*
 * Adds a real floor intermission stage after each non-final boss clear.
 *
 * Flow:
 * - 1-5 victory still shows the normal stage-clear reward first.
 * - After that reward is selected, the run moves to 1-6 instead of 2-1.
 * - 1-6 is synthetic, so it does not need a Stages sheet row.
 * - The existing reward modal is reused at 1-6 to choose 휴식 or 보상 획득.
 * - Client background loading already tries exact stage numbers first, so stage 1-6
 *   uses Resources/Background/Battle/1-6.png when it exists.
 */

(function installFloorIntermissionFlow_() {
  if (typeof FLOOR_INTERMISSION_FLOW_INSTALLED_ !== 'undefined' && FLOOR_INTERMISSION_FLOW_INSTALLED_) {
    return;
  }

  if (typeof loadStage === 'function') {
    LOAD_STAGE_ORIGINAL_FLOOR_INTERMISSION_ = loadStage;
    loadStage = function(stageId) {
      if (isFloorIntermissionStageId_(stageId)) {
        return buildSyntheticFloorIntermissionStage_(getFloorFromStageId_(stageId));
      }
      return LOAD_STAGE_ORIGINAL_FLOOR_INTERMISSION_(stageId);
    };
  }

  if (typeof shouldOfferFloorRestChoice_ === 'function') {
    SHOULD_OFFER_FLOOR_REST_CHOICE_ORIGINAL_ = shouldOfferFloorRestChoice_;
    shouldOfferFloorRestChoice_ = function(stage) {
      return isFloorIntermissionStage_(stage);
    };
  }

  if (typeof startBattle === 'function') {
    START_BATTLE_ORIGINAL_FLOOR_INTERMISSION_ = startBattle;
    startBattle = function(runId) {
      var run = requireRun_(runId);
      var stageState = getStageState_(run);
      var stageId = stageState.stageId || buildStageId_(run.currentFloor, run.currentStage);
      if (!isFloorIntermissionStageId_(stageId) && Number(run.currentStage || 1) !== getFloorIntermissionStageNumber_()) {
        return START_BATTLE_ORIGINAL_FLOOR_INTERMISSION_(runId);
      }
      return startFloorIntermissionStage_(run, stageState, stageId);
    };
  }

  if (typeof moveToNextStageForRun_ === 'function') {
    MOVE_TO_NEXT_STAGE_ORIGINAL_FLOOR_INTERMISSION_ = moveToNextStageForRun_;
    moveToNextStageForRun_ = function(run) {
      return moveToNextStageWithFloorIntermission_(run);
    };
  }

  if (typeof buildFloorRestRewardViewForRun_ === 'function') {
    BUILD_FLOOR_REST_REWARD_VIEW_ORIGINAL_FLOOR_INTERMISSION_ = buildFloorRestRewardViewForRun_;
    buildFloorRestRewardViewForRun_ = function(run, stageState) {
      stageState = stageState || getStageState_(run);
      if (!stageState.battle || !isFloorIntermissionStageId_(stageState.stageId)) {
        startFloorIntermissionStage_(run, stageState, stageState.stageId || buildStageId_(run.currentFloor, run.currentStage));
        run = requireRun_(run.runId);
        stageState = getStageState_(run);
      }
      return BUILD_FLOOR_REST_REWARD_VIEW_ORIGINAL_FLOOR_INTERMISSION_(run, stageState);
    };
  }

  if (typeof include_ === 'function') {
    INCLUDE_ORIGINAL_FLOOR_INTERMISSION_ = include_;
    include_ = function(filename) {
      var html = INCLUDE_ORIGINAL_FLOOR_INTERMISSION_(filename);
      if (String(filename || '') === 'UiLoadingModal') {
        html += getFloorIntermissionClientPatch_();
      }
      return html;
    };
  }

  FLOOR_INTERMISSION_FLOW_INSTALLED_ = true;
})();

function getFloorIntermissionStageNumber_() {
  return Number(GAME_RULES && GAME_RULES.FLOOR_REST_STAGE || 6);
}

function isFloorIntermissionStage_(stage) {
  if (!stage) {
    return false;
  }
  return Number(stage.floor || 1) < Number(GAME_RULES.FLOOR_COUNT || 5) &&
    Number(stage.stage || 1) === getFloorIntermissionStageNumber_();
}

function isFloorIntermissionStageId_(stageId) {
  var parts = parseStageIdParts_(stageId);
  return !!parts && parts.stage === getFloorIntermissionStageNumber_() && parts.floor < Number(GAME_RULES.FLOOR_COUNT || 5);
}

function getFloorFromStageId_(stageId) {
  var parts = parseStageIdParts_(stageId);
  return parts ? parts.floor : 1;
}

function parseStageIdParts_(stageId) {
  var match = String(stageId || '').match(/floor_(\d+)_stage_(\d+)/);
  if (!match) {
    return null;
  }
  return {
    floor: Number(match[1] || 1),
    stage: Number(match[2] || 1),
  };
}

function buildSyntheticFloorIntermissionStage_(floor) {
  var normalizedFloor = Math.max(1, Math.min(Number(GAME_RULES.FLOOR_COUNT || 5), Number(floor || 1)));
  var stageNumber = getFloorIntermissionStageNumber_();
  return normalizeStageDifficulty_({
    stageId: buildStageId_(normalizedFloor, stageNumber),
    floor: normalizedFloor,
    stage: stageNumber,
    name: normalizedFloor + '층 정비 구역',
    baseDifficulty: GAME_RULES.MIN_DIFFICULTY,
    minDifficulty: GAME_RULES.MIN_DIFFICULTY,
    maxDifficulty: GAME_RULES.MIN_DIFFICULTY,
    monsterGroupId: '',
    bossMonsterId: '',
    rewardGroupId: typeof getDefaultRewardGroupId_ === 'function' ? getDefaultRewardGroupId_() : 'reward_global',
    requiredOtherQuestionCount: 0,
  });
}

function startFloorIntermissionStage_(run, stageState, stageId) {
  var runId = run.runId;
  var usedQuestionIds = normalizeUsedQuestionIds_(stageState, stageState && stageState.battle).slice();
  var stage = loadStage(stageId || buildStageId_(run.currentFloor, getFloorIntermissionStageNumber_()));
  var baseStats = safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS));
  var items = normalizeOwnedItems_(safeJsonParse_(run.itemsJson, []));
  var stats = calculateStatsWithItemEffects_(baseStats, items);
  var battleState = {
    battleId: generateId_('intermission'),
    status: STATUS.BATTLE_VICTORY,
    turn: 1,
    stage: {
      stageId: stage.stageId,
      floor: Number(stage.floor),
      stage: Number(stage.stage),
      name: stage.name,
      baseDifficulty: Number(stage.baseDifficulty),
      minDifficulty: Number(stage.minDifficulty),
      maxDifficulty: Number(stage.maxDifficulty),
      monsterGroupId: '',
      bossMonsterId: '',
      bossConfig: {},
      rewardGroupId: stage.rewardGroupId || (typeof getDefaultRewardGroupId_ === 'function' ? getDefaultRewardGroupId_() : 'reward_global'),
    },
    player: {
      hp: Math.max(1, Math.min(Number(stats.hp || BASE_PLAYER_STATS.hp), Number(run.currentHp || stats.hp))),
      maxHp: Number(stats.hp || BASE_PLAYER_STATS.hp),
      shield: 0,
      baseMaxActionPoint: GAME_RULES.DEFAULT_MAX_ACTION_POINT,
      maxActionPoint: GAME_RULES.DEFAULT_MAX_ACTION_POINT,
      currentActionPoint: 0,
      actionPointMaxDelta: 0,
      nextTurnActionPointDelta: 0,
      baseStats: baseStats,
      stats: stats,
      items: items,
      itemModifiers: buildItemModifiers_(items),
      effects: [],
      buffs: [],
      debuffs: [],
    },
    monsters: [],
    monster: null,
    playerGhost: null,
    forcedQuestionCreatorId: '',
    pendingAction: null,
    pendingAnswerLogs: [],
    usedQuestionIds: usedQuestionIds.slice(),
    lastMessage: '이곳은 아무도 없습니다. 행동을 선택하세요',
    lastTurnEvents: [],
    skillCooldowns: {},
    skillUseCounts: {},
    usedSkillTagsThisBattle: [],
    usedSkillTagsThisTurn: [],
    usedSkillCountByTagThisBattle: {},
    usedSkillCountByTagThisTurn: {},
    activeTriggers: [],
  };

  stageState.stageId = stage.stageId;
  stageState.otherStudentQuestionShown = false;
  stageState.fallbackEvents = [];
  stageState.battle = battleState;
  normalizeUsedQuestionIds_(stageState, battleState);
  saveStageState_(runId, stageState, battleState);
  return toClientObject_(getRunWithStageState_(runId));
}

function moveToNextStageWithFloorIntermission_(run) {
  var runId = run.runId;
  var floor = Number(run.currentFloor || 1);
  var stage = Number(run.currentStage || 1);
  var now = new Date();
  var stageState = getStageState_(run);
  var usedQuestionIds = normalizeUsedQuestionIds_(stageState, stageState.battle).slice();
  var scoreState = stageState.scoreState || {};
  var stageNumber = getFloorIntermissionStageNumber_();
  var floorCount = Number(GAME_RULES.FLOOR_COUNT || 5);
  var stagesPerFloor = Number(GAME_RULES.STAGES_PER_FLOOR || 5);

  if (floor >= floorCount && stage >= stagesPerFloor) {
    var startedAt = run.startedAt ? new Date(run.startedAt).getTime() : now.getTime();
    return updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
      status: STATUS.RUN_CLEARED,
      endedAt: now,
      clearTimeMs: Math.max(0, now.getTime() - startedAt),
      currentShield: 0,
      stageStateJson: safeJsonStringify_({
        cleared: true,
        usedQuestionIds: usedQuestionIds,
        scoreState: scoreState,
      }),
      updatedAt: now,
    });
  }

  var nextFloor = floor;
  var nextStage = stage + 1;
  if (stage === stagesPerFloor && floor < floorCount) {
    nextStage = stageNumber;
  } else if (stage === stageNumber) {
    nextFloor = floor + 1;
    nextStage = 1;
  } else if (nextStage > stagesPerFloor) {
    nextFloor += 1;
    nextStage = 1;
  }
  if (nextFloor !== floor) {
    scoreState.floorStartedAtByFloor = scoreState.floorStartedAtByFloor || {};
    scoreState.floorStartedAtByFloor[String(nextFloor)] = now.toISOString();
  }

  return updateRowByKey_(DB_SHEETS.RUNS, 'runId', runId, {
    currentFloor: nextFloor,
    currentStage: nextStage,
    currentShield: 0,
    stageStateJson: safeJsonStringify_({
      stageId: buildStageId_(nextFloor, nextStage),
      otherStudentQuestionShown: false,
      fallbackEvents: [],
      usedQuestionIds: usedQuestionIds,
      scoreState: scoreState,
    }),
    updatedAt: now,
  });
}

function getFloorIntermissionClientPatch_() {
  return '<script>window.__floorIntermissionClientPatchInstalled = true;</script>';
  return '<script>\n' +
    '(function(){\n' +
    '  function install(){\n' +
    '    if (window.__floorIntermissionClientPatchInstalled) return;\n' +
    '    if (typeof window.startBattleEntrance !== "function") { window.setTimeout(install, 30); return; }\n' +
    '    var originalStartBattleEntrance = window.startBattleEntrance;\n' +
    '    window.startBattleEntrance = function(){\n' +
    '      var battle = window.currentView && window.currentView.battle;\n' +
    '      if (battle && battle.status === "victory" && battle.stage && Number(battle.stage.stage || 0) === 6) {\n' +
    '        if (typeof window.finishBattleStartFade === "function") window.finishBattleStartFade();\n' +
    '        if (typeof window.setBattleInputLocked === "function") window.setBattleInputLocked(true);\n' +
    '        if (typeof window.setPlayerTurn === "function") window.setPlayerTurn(false);\n' +
    '        if (typeof window.openRewardAfterVictory === "function") window.openRewardAfterVictory();\n' +
    '        return;\n' +
    '      }\n' +
    '      return originalStartBattleEntrance.apply(this, arguments);\n' +
    '    };\n' +
    '    window.__floorIntermissionClientPatchInstalled = true;\n' +
    '  }\n' +
    '  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", install); } else { install(); }\n' +
    '})();\n' +
    '</script>';
}
