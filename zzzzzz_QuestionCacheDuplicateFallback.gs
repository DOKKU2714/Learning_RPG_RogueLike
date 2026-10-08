/*
 * Question cache duplicate fallback.
 *
 * Goal:
 * - Prefer non-duplicated questions while the stage cache still has unused rows.
 * - If there are not enough questions for the current stage difficulty range,
 *   repeat matching questions instead of blocking the battle.
 * - Never fall back to questions outside the stage difficulty range. The previous
 *   broad fallback was a tiny trapdoor into nonsense, naturally.
 */

(function installQuestionCacheDuplicateFallbackPatch_() {
  if (typeof QUESTION_CACHE_DUPLICATE_FALLBACK_INSTALLED_ !== 'undefined' && QUESTION_CACHE_DUPLICATE_FALLBACK_INSTALLED_) {
    return;
  }

  if (typeof selectQuestionCacheRows_ === 'function') {
    SELECT_QUESTION_CACHE_ROWS_ORIGINAL_DUPLICATE_FALLBACK_ = selectQuestionCacheRows_;
    selectQuestionCacheRows_ = function(playerId, stage, otherStudentQuestionShown, forcedCreatorId, questionModifiers) {
      return selectQuestionCacheRowsWithDuplicateFallback_(playerId, stage, forcedCreatorId, questionModifiers);
    };
  }

  if (typeof pickQuestion_ === 'function') {
    PICK_QUESTION_ORIGINAL_DUPLICATE_FALLBACK_ = pickQuestion_;
    pickQuestion_ = function(playerId, stage, otherStudentQuestionShown, forcedCreatorId, questionModifiers) {
      var pool = getStrictStageQuestionPool_(playerId, stage, forcedCreatorId);
      if (!pool.length) {
        throw new Error('현재 스테이지 난이도에 맞는 승인 문제가 없습니다.');
      }
      return questionPickResult_(pickQuestionWithTypeBias_(pool, questionModifiers) || pickRandom_(pool), true, '');
    };
  }

  if (typeof include_ === 'function') {
    INCLUDE_ORIGINAL_QUESTION_CACHE_DUPLICATE_FALLBACK_ = include_;
    include_ = function(filename) {
      var html = INCLUDE_ORIGINAL_QUESTION_CACHE_DUPLICATE_FALLBACK_(filename);
      if (String(filename || '') === 'UiLoadingModal') {
        html += getQuestionCacheDuplicateFallbackClientPatch_();
      }
      return html;
    };
  }

  QUESTION_CACHE_DUPLICATE_FALLBACK_INSTALLED_ = true;
})();

function selectQuestionCacheRowsWithDuplicateFallback_(playerId, stage, forcedCreatorId, questionModifiers) {
  var limit = 30;
  var pool = getStrictStageQuestionPool_(playerId, stage, forcedCreatorId);
  if (!pool.length) {
    return [];
  }

  var selected = [];
  var remainingUnique = pool.slice();
  var selectedIds = {};

  while (selected.length < limit && remainingUnique.length > 0) {
    var uniquePick = pickQuestionWithTypeBias_(remainingUnique, questionModifiers) || pickRandom_(remainingUnique);
    if (!uniquePick || !uniquePick.questionId) {
      break;
    }
    if (!selectedIds[uniquePick.questionId]) {
      selected.push(uniquePick);
      selectedIds[uniquePick.questionId] = true;
    }
    remainingUnique = remainingUnique.filter(function(candidate) {
      return candidate.questionId !== uniquePick.questionId;
    });
  }

  while (selected.length < limit) {
    var duplicatePick = pickQuestionWithTypeBias_(pool, questionModifiers) || pickRandom_(pool);
    if (!duplicatePick) {
      break;
    }
    selected.push(duplicatePick);
  }

  return selected;
}

function getStrictStageQuestionPool_(playerId, stage, forcedCreatorId) {
  var range = getStageDifficultyRange_(stage || {});
  var minDifficulty = Number(range.minDifficulty || GAME_RULES.MIN_DIFFICULTY);
  var maxDifficulty = Number(range.maxDifficulty || GAME_RULES.MAX_DIFFICULTY);
  var playerKey = String(playerId || '').trim();
  var forcedKey = String(forcedCreatorId || '').trim();

  return readTableCached_(DB_SHEETS.QUESTIONS, 120).filter(function(question) {
    if (!question || question.status !== STATUS.QUESTION_APPROVED) {
      return false;
    }
    var creatorId = String(question.creatorId || '').trim();
    if (!creatorId || creatorId === playerKey) {
      return false;
    }
    if (forcedKey && creatorId !== forcedKey) {
      return false;
    }
    var difficulty = Number(question.difficulty || 0);
    return difficulty >= minDifficulty && difficulty <= maxDifficulty;
  });
}

function getQuestionCacheDuplicateFallbackClientPatch_() {
  return '<script>\n' +
    '(function(){\n' +
    '  var recyclePool = [];\n' +
    '  function clone(value){\n' +
    '    try { return JSON.parse(JSON.stringify(value)); } catch (error) { return null; }\n' +
    '  }\n' +
    '  function rememberCachePool(){\n' +
    '    var source = [];\n' +
    '    if (window.currentView && Array.isArray(window.currentView.questionCache) && window.currentView.questionCache.length) {\n' +
    '      source = window.currentView.questionCache;\n' +
    '    } else if (Array.isArray(window.battleQuestionCache) && window.battleQuestionCache.length) {\n' +
    '      source = window.battleQuestionCache;\n' +
    '    }\n' +
    '    if (source.length) {\n' +
    '      recyclePool = clone(source) || recyclePool;\n' +
    '    }\n' +
    '  }\n' +
    '  function buildDuplicateQuestionView(actionType, skillId, targetId){\n' +
    '    rememberCachePool();\n' +
    '    if (!recyclePool.length) return null;\n' +
    '    var questionView = clone(recyclePool[Math.floor(Math.random() * recyclePool.length)]);\n' +
    '    if (!questionView) return null;\n' +
    '    questionView.actionType = actionType || "attack";\n' +
    '    questionView.skillId = skillId || "";\n' +
    '    questionView.targetId = targetId || "";\n' +
    '    questionView.isCachedQuestion = true;\n' +
    '    questionView.fallbackReason = questionView.fallbackReason || "exhaustedQuestionCacheDuplicate";\n' +
    '    if (questionView.actionType === "skill" && typeof window.applySkillDifficultyBonusToQuestionView === "function") {\n' +
    '      window.applySkillDifficultyBonusToQuestionView(questionView, skillId);\n' +
    '    }\n' +
    '    if (typeof window.applyClientQuestionEffectModifiers === "function") {\n' +
    '      window.applyClientQuestionEffectModifiers(questionView);\n' +
    '    }\n' +
    '    return questionView;\n' +
    '  }\n' +
    '  function patchTakeCachedQuestionView(){\n' +
    '    var attempts = 0;\n' +
    '    var timer = window.setInterval(function(){\n' +
    '      attempts += 1;\n' +
    '      var original = window.takeCachedQuestionView;\n' +
    '      if (typeof original === "function" && !original.__questionCacheDuplicateFallbackPatched) {\n' +
    '        window.takeCachedQuestionView = function(actionType, skillId, targetId){\n' +
    '          rememberCachePool();\n' +
    '          var view = original.apply(this, arguments);\n' +
    '          if (view) {\n' +
    '            rememberCachePool();\n' +
    '            return view;\n' +
    '          }\n' +
    '          return buildDuplicateQuestionView(actionType, skillId, targetId);\n' +
    '        };\n' +
    '        window.takeCachedQuestionView.__questionCacheDuplicateFallbackPatched = true;\n' +
    '        window.clearInterval(timer);\n' +
    '        return;\n' +
    '      }\n' +
    '      if (attempts > 240) window.clearInterval(timer);\n' +
    '    }, 40);\n' +
    '  }\n' +
    '  function install(){\n' +
    '    if (window.__questionCacheDuplicateFallbackInstalled) return;\n' +
    '    window.__questionCacheDuplicateFallbackInstalled = true;\n' +
    '    rememberCachePool();\n' +
    '    patchTakeCachedQuestionView();\n' +
    '  }\n' +
    '  if (document.readyState === "loading") {\n' +
    '    document.addEventListener("DOMContentLoaded", install);\n' +
    '  } else {\n' +
    '    install();\n' +
    '  }\n' +
    '})();\n' +
    '</script>';
}
