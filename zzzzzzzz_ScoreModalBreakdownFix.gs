/*
 * Fixes the score settlement modal when the run total is correct but every
 * breakdown row is rendered as +0.
 *
 * The score total can already include points that were awarded earlier in the
 * run, while the end-of-run modal only receives the current visible breakdown.
 * When that breakdown is empty or incomplete, normalize the summary and display
 * the missing delta as an explicit fallback row instead of a useless wall of +0.
 */

(function installScoreModalBreakdownFixPatch_() {
  if (typeof SCORE_MODAL_BREAKDOWN_FIX_INSTALLED_ !== 'undefined' && SCORE_MODAL_BREAKDOWN_FIX_INSTALLED_) {
    return;
  }

  if (typeof include_ === 'function') {
    INCLUDE_ORIGINAL_SCORE_MODAL_BREAKDOWN_FIX_ = include_;
    include_ = function(filename) {
      var html = INCLUDE_ORIGINAL_SCORE_MODAL_BREAKDOWN_FIX_(filename);
      if (String(filename || '') === 'UiLoadingModal') {
        html += getScoreModalBreakdownFixClientPatch_();
      }
      return html;
    };
  }

  if (typeof buildStageScoreSummary_ === 'function') {
    BUILD_STAGE_SCORE_SUMMARY_ORIGINAL_BREAKDOWN_FIX_ = buildStageScoreSummary_;
    buildStageScoreSummary_ = function(run, summary) {
      return normalizeServerScoreSummaryBreakdown_(BUILD_STAGE_SCORE_SUMMARY_ORIGINAL_BREAKDOWN_FIX_(run, summary));
    };
  }

  SCORE_MODAL_BREAKDOWN_FIX_INSTALLED_ = true;
})();

function normalizeServerScoreSummaryBreakdown_(summary) {
  summary = Object.assign({}, summary || {});
  var componentTotal = getScoreSummaryComponentTotal_(summary);
  var scoreDelta = Math.max(0, Number(summary.scoreDelta || 0));
  var totalScore = Math.max(0, Number(summary.totalScore || 0));
  var previousScore = Math.max(0, Number(summary.previousScore !== undefined && summary.previousScore !== ''
    ? summary.previousScore
    : totalScore - scoreDelta));

  if (scoreDelta <= 0 && totalScore > previousScore) {
    scoreDelta = totalScore - previousScore;
    summary.scoreDelta = scoreDelta;
  }

  if (scoreDelta > componentTotal) {
    summary.unclassifiedScore = Number(summary.unclassifiedScore || 0) + (scoreDelta - componentTotal);
  }

  return summary;
}

function getScoreSummaryComponentTotal_(summary) {
  return [
    'answerScore',
    'monsterScore',
    'questionReactionScore',
    'stageScore',
    'floorBaseScore',
    'floorSpeedScore',
    'clearBonus',
    'unclassifiedScore',
  ].reduce(function(total, key) {
    return total + Math.max(0, Number(summary && summary[key] || 0));
  }, 0);
}

function getScoreModalBreakdownFixClientPatch_() {
  return '<script>\n' +
    '(function(){\n' +
    '  var COMPONENT_KEYS = [\n' +
    '    "answerScore",\n' +
    '    "monsterScore",\n' +
    '    "questionReactionScore",\n' +
    '    "stageScore",\n' +
    '    "floorBaseScore",\n' +
    '    "floorSpeedScore",\n' +
    '    "clearBonus",\n' +
    '    "unclassifiedScore"\n' +
    '  ];\n' +
    '\n' +
    '  function positiveNumber(value){\n' +
    '    var number = Number(value || 0);\n' +
    '    return isFinite(number) ? Math.max(0, Math.round(number)) : 0;\n' +
    '  }\n' +
    '\n' +
    '  function componentTotal(summary){\n' +
    '    return COMPONENT_KEYS.reduce(function(total, key){\n' +
    '      return total + positiveNumber(summary && summary[key]);\n' +
    '    }, 0);\n' +
    '  }\n' +
    '\n' +
    '  function cloneSummary(summary){\n' +
    '    return Object.assign({}, summary || {});\n' +
    '  }\n' +
    '\n' +
    '  function normalizeSummary(summary, response){\n' +
    '    summary = cloneSummary(summary);\n' +
    '    response = response || {};\n' +
    '    var currentTotal = positiveNumber(window.currentView && window.currentView.score);\n' +
    '    var responseTotal = positiveNumber(response.score || response.totalScore || response.run && response.run.score);\n' +
    '    var totalScore = positiveNumber(summary.totalScore || responseTotal || currentTotal);\n' +
    '    var scoreDelta = positiveNumber(summary.scoreDelta);\n' +
    '    var previousScore = summary.previousScore !== undefined && summary.previousScore !== null && summary.previousScore !== ""\n' +
    '      ? positiveNumber(summary.previousScore)\n' +
    '      : Math.max(0, totalScore - scoreDelta);\n' +
    '\n' +
    '    if (scoreDelta <= 0) {\n' +
    '      var inferredDelta = Math.max(0, totalScore - previousScore);\n' +
    '      if (inferredDelta <= 0 && response.outcomeFinal && totalScore > 0 && componentTotal(summary) <= 0) {\n' +
    '        inferredDelta = totalScore;\n' +
    '        previousScore = 0;\n' +
    '      }\n' +
    '      scoreDelta = inferredDelta;\n' +
    '    }\n' +
    '\n' +
    '    summary.totalScore = totalScore;\n' +
    '    summary.scoreDelta = scoreDelta;\n' +
    '    summary.previousScore = previousScore;\n' +
    '\n' +
    '    var knownTotal = componentTotal(summary);\n' +
    '    if (scoreDelta > knownTotal) {\n' +
    '      summary.unclassifiedScore = positiveNumber(summary.unclassifiedScore) + (scoreDelta - knownTotal);\n' +
    '    }\n' +
    '    return summary;\n' +
    '  }\n' +
    '\n' +
    '  function patchFunction(name, wrapper){\n' +
    '    var attempts = 0;\n' +
    '    var timer = window.setInterval(function(){\n' +
    '      attempts += 1;\n' +
    '      var original = window[name];\n' +
    '      if (typeof original === "function" && !original.__scoreModalBreakdownFixPatched) {\n' +
    '        var patched = wrapper(original);\n' +
    '        patched.__scoreModalBreakdownFixPatched = true;\n' +
    '        window[name] = patched;\n' +
    '        window.clearInterval(timer);\n' +
    '        return;\n' +
    '      }\n' +
    '      if (attempts > 240) window.clearInterval(timer);\n' +
    '    }, 40);\n' +
    '  }\n' +
    '\n' +
    '  function install(){\n' +
    '    if (window.__scoreModalBreakdownFixInstalled) return;\n' +
    '    window.__scoreModalBreakdownFixInstalled = true;\n' +
    '\n' +
    '    patchFunction("showScoreModal", function(original){\n' +
    '      return function(scoreSummary, response){\n' +
    '        response = response || {};\n' +
    '        var normalized = normalizeSummary(scoreSummary, response);\n' +
    '        response.scoreSummary = normalized;\n' +
    '        return original.call(this, normalized, response);\n' +
    '      };\n' +
    '    });\n' +
    '\n' +
    '    patchFunction("buildCurrentOutcomeScoreSummary", function(original){\n' +
    '      return function(){\n' +
    '        return normalizeSummary(original.apply(this, arguments), { outcomeFinal: true });\n' +
    '      };\n' +
    '    });\n' +
    '\n' +
    '    patchFunction("buildScoreBreakdownRows", function(original){\n' +
    '      return function(summary, detailed){\n' +
    '        summary = normalizeSummary(summary, { outcomeFinal: detailed });\n' +
    '        var rows = original.call(this, summary, detailed).filter(function(row){\n' +
    '          return positiveNumber(row && row.value) > 0;\n' +
    '        });\n' +
    '        if (positiveNumber(summary.unclassifiedScore) > 0) {\n' +
    '          rows.push({\n' +
    '            label: detailed ? "누적 점수 반영" : "기타 점수",\n' +
    '            value: positiveNumber(summary.unclassifiedScore)\n' +
    '          });\n' +
    '        }\n' +
    '        if (!rows.length && positiveNumber(summary.scoreDelta) > 0) {\n' +
    '          rows.push({\n' +
    '            label: detailed ? "누적 점수 반영" : "획득 점수",\n' +
    '            value: positiveNumber(summary.scoreDelta)\n' +
    '          });\n' +
    '        }\n' +
    '        return rows;\n' +
    '      };\n' +
    '    });\n' +
    '  }\n' +
    '\n' +
    '  if (document.readyState === "loading") {\n' +
    '    document.addEventListener("DOMContentLoaded", install);\n' +
    '  } else {\n' +
    '    install();\n' +
    '  }\n' +
    '})();\n' +
    '</script>';
}
