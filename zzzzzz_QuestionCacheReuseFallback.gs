/*
 * Allows the battle question cache to reuse already-shown questions only when
 * the cached unused pool is exhausted.
 *
 * Important rule: reused questions must still be in the current stage difficulty
 * range. We are fixing cache exhaustion, not opening the gates to random chaos.
 */

(function installQuestionCacheReuseFallbackPatch_() {
  if (typeof QUESTION_CACHE_REUSE_FALLBACK_INSTALLED_ !== 'undefined' && QUESTION_CACHE_REUSE_FALLBACK_INSTALLED_) {
    return;
  }

  if (typeof include_ === 'function') {
    INCLUDE_ORIGINAL_QUESTION_CACHE_REUSE_FALLBACK_ = include_;
    include_ = function(filename) {
      var html = INCLUDE_ORIGINAL_QUESTION_CACHE_REUSE_FALLBACK_(filename);
      if (String(filename || '') === 'UiLoadingModal') {
        html += getQuestionCacheReuseFallbackClientPatch_();
      }
      return html;
    };
  }

  if (typeof createPendingActionFromCachedPayload_ === 'function') {
    CREATE_PENDING_ACTION_FROM_CACHED_PAYLOAD_ORIGINAL_REUSE_FALLBACK_ = createPendingActionFromCachedPayload_;
    createPendingActionFromCachedPayload_ = function(stageState, battleState, payload, actionType, skillId, targetId, playerId) {
      payload = payload || {};
      if (String(payload.fallbackReason || '') !== 'exhaustedUnusedQuestions') {
        return CREATE_PENDING_ACTION_FROM_CACHED_PAYLOAD_ORIGINAL_REUSE_FALLBACK_(stageState, battleState, payload, actionType, skillId, targetId, playerId);
      }

      var question = findCachedRowByKey_(DB_SHEETS.QUESTIONS, 'questionId', payload.questionId, 120);
      if (!question) {
        throw new Error('문제를 찾을 수 없습니다.');
      }

      validateQuestionAllowedForBattle_(question, playerId, battleState);
      normalizeUsedQuestionIds_(stageState, battleState);
      var activeEffects = getActiveEffectsForQuestion_(battleState);
      var skill = skillId ? findCachedRowByKey_(DB_SHEETS.SKILLS, 'skillId', skillId, 600) : null;
      var difficultyBonus = skill ? Number(skill.difficultyBonus || 0) : 0;
      var actionPointCost = getActionPointCostForAction_(actionType, skill);
      var baseDifficulty = applyBossDifficultyBonus(battleState.stage, Number(question.difficulty || battleState.stage.baseDifficulty) + difficultyBonus);
      var questionModifiers = getItemQuestionModifiers_(battleState, question);
      var finalDifficulty = calculateFinalQuestionDifficulty(baseDifficulty, activeEffects, questionModifiers);
      return {
        actionType: actionType,
        skillId: skillId || payload.skillId || '',
        targetId: targetId || payload.targetId || '',
        actionPointCost: actionPointCost,
        questionId: question.questionId,
        question: sanitizeQuestionForClient_(question),
        issuedAt: new Date().getTime() - Math.max(0, Number(payload.elapsedMs || 0)),
        maxMs: calculateFinalQuestionTimeLimitForQuestion_(finalDifficulty, activeEffects, question, questionModifiers),
        finalDifficulty: finalDifficulty,
        maxAnswerEfficiency: calculateMaxAnswerEfficiency_(questionModifiers),
        questionModifiers: questionModifiers,
        isOtherPlayerQuestion: question.creatorId !== playerId,
        fallbackReason: 'exhaustedUnusedQuestions',
        fromCache: true,
      };
    };
  }

  QUESTION_CACHE_REUSE_FALLBACK_INSTALLED_ = true;
})();

function getQuestionCacheReuseFallbackClientPatch_() {
  return '<script>\n' +
    '(function(){\n' +
    '  var recycleCache = [];\n' +
    '\n' +
    '  function clone(value){\n' +
    '    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return null; }\n' +
    '  }\n' +
    '\n' +
    '  function getQuestionId(questionView){\n' +
    '    return String(questionView && questionView.question && questionView.question.questionId || "");\n' +
    '  }\n' +
    '\n' +
    '  function archiveQuestionView(questionView){\n' +
    '    var questionId = getQuestionId(questionView);\n' +
    '    if (!questionId) return;\n' +
    '    for (var i = 0; i < recycleCache.length; i += 1) {\n' +
    '      if (getQuestionId(recycleCache[i]) === questionId) return;\n' +
    '    }\n' +
    '    var copied = clone(questionView);\n' +
    '    if (copied) recycleCache.push(copied);\n' +
    '  }\n' +
    '\n' +
    '  function archiveQuestionList(list){\n' +
    '    (list || []).forEach(archiveQuestionView);\n' +
    '  }\n' +
    '\n' +
    '  function getStageRange(){\n' +
    '    var stage = window.currentView && window.currentView.battle && window.currentView.battle.stage || {};\n' +
    '    var min = Number(stage.minDifficulty || stage.baseDifficulty || 1);\n' +
    '    var max = Number(stage.maxDifficulty || stage.baseDifficulty || 5);\n' +
    '    if (!isFinite(min)) min = 1;\n' +
    '    if (!isFinite(max)) max = 5;\n' +
    '    if (min > max) min = max;\n' +
    '    return { min: min, max: max };\n' +
    '  }\n' +
    '\n' +
    '  function isInCurrentDifficultyRange(questionView){\n' +
    '    var question = questionView && questionView.question || {};\n' +
    '    var difficulty = Number(question.difficulty || 0);\n' +
    '    var range = getStageRange();\n' +
    '    return difficulty >= range.min && difficulty <= range.max;\n' +
    '  }\n' +
    '\n' +
    '  function findReusableQuestionView(){\n' +
    '    archiveQuestionList(window.currentView && window.currentView.questionCache || []);\n' +
    '    archiveQuestionList(window.battleQuestionCache || []);\n' +
    '    var candidates = recycleCache.filter(function(questionView){\n' +
    '      return getQuestionId(questionView) && isInCurrentDifficultyRange(questionView);\n' +
    '    });\n' +
    '    if (!candidates.length) return null;\n' +
    '    var picked = clone(candidates[Math.floor(Math.random() * candidates.length)]);\n' +
    '    if (!picked) return null;\n' +
    '    picked.fallbackReason = "exhaustedUnusedQuestions";\n' +
    '    picked.isReusedQuestion = true;\n' +
    '    return picked;\n' +
    '  }\n' +
    '\n' +
    '  function prepareQuestionView(questionView, actionType, skillId, targetId){\n' +
    '    questionView.actionType = actionType || "attack";\n' +
    '    questionView.skillId = skillId || "";\n' +
    '    questionView.targetId = targetId || "";\n' +
    '    questionView.isCachedQuestion = true;\n' +
    '    questionView.fallbackReason = "exhaustedUnusedQuestions";\n' +
    '    if (questionView.actionType === "skill" && typeof window.applySkillDifficultyBonusToQuestionView === "function") {\n' +
    '      window.applySkillDifficultyBonusToQuestionView(questionView, skillId);\n' +
    '    }\n' +
    '    if (typeof window.applyClientQuestionEffectModifiers === "function") {\n' +
    '      window.applyClientQuestionEffectModifiers(questionView);\n' +
    '    }\n' +
    '    if (typeof window.markClientQuestionUsed === "function") {\n' +
    '      window.markClientQuestionUsed(getQuestionId(questionView), window.currentView);\n' +
    '    }\n' +
    '    return questionView;\n' +
    '  }\n' +
    '\n' +
    '  function patchFunction(name, wrapper){\n' +
    '    var attempts = 0;\n' +
    '    var timer = window.setInterval(function(){\n' +
    '      attempts += 1;\n' +
    '      var original = window[name];\n' +
    '      if (typeof original === "function" && !original.__learningRpgReuseFallbackPatched) {\n' +
    '        var patched = wrapper(original);\n' +
    '        patched.__learningRpgReuseFallbackPatched = true;\n' +
    '        window[name] = patched;\n' +
    '        window.clearInterval(timer);\n' +
    '        return;\n' +
    '      }\n' +
    '      if (attempts > 240) window.clearInterval(timer);\n' +
    '    }, 40);\n' +
    '  }\n' +
    '\n' +
    '  function install(){\n' +
    '    if (window.__learningRpgQuestionCacheReuseFallbackInstalled) return;\n' +
    '    window.__learningRpgQuestionCacheReuseFallbackInstalled = true;\n' +
    '    patchFunction("normalizeBattleView", function(original){\n' +
    '      return function(view){\n' +
    '        archiveQuestionList(view && view.questionCache || []);\n' +
    '        var normalized = original.apply(this, arguments);\n' +
    '        archiveQuestionList(normalized && normalized.questionCache || []);\n' +
    '        return normalized;\n' +
    '      };\n' +
    '    });\n' +
    '    patchFunction("takeCachedQuestionView", function(original){\n' +
    '      return function(actionType, skillId, targetId){\n' +
    '        archiveQuestionList(window.currentView && window.currentView.questionCache || []);\n' +
    '        archiveQuestionList(window.battleQuestionCache || []);\n' +
    '        var questionView = original.apply(this, arguments);\n' +
    '        if (questionView) {\n' +
    '          archiveQuestionView(questionView);\n' +
    '          return questionView;\n' +
    '        }\n' +
    '        var fallback = findReusableQuestionView();\n' +
    '        if (!fallback) return null;\n' +
    '        return prepareQuestionView(fallback, actionType, skillId, targetId);\n' +
    '      };\n' +
    '    });\n' +
    '  }\n' +
    '  if (document.readyState === "loading") {\n' +
    '    document.addEventListener("DOMContentLoaded", install);\n' +
    '  } else {\n' +
    '    install();\n' +
    '  }\n' +
    '})();\n' +
    '</script>';
}
