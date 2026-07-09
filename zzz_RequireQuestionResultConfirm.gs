/*
 * Keeps the question result modal open for manual confirmation when needed.
 *
 * Multiple-choice results still auto-close after QUESTION_RESULT_AUTO_CLOSE_MS.
 * Correct short-answer results wait for the player to press 확인 so the success
 * state is not dismissed before they can read it.
 */

(function installQuestionResultConfirmPatch_() {
  if (typeof QUESTION_RESULT_CONFIRM_PATCH_INSTALLED_ !== 'undefined' && QUESTION_RESULT_CONFIRM_PATCH_INSTALLED_) {
    return;
  }

  if (typeof include_ === 'function') {
    INCLUDE_ORIGINAL_QUESTION_RESULT_CONFIRM_ = include_;
    include_ = function(filename) {
      var html = INCLUDE_ORIGINAL_QUESTION_RESULT_CONFIRM_(filename);
      if (String(filename || '') === 'UiLoadingModal') {
        html += getQuestionResultConfirmClientPatch_();
      }
      return html;
    };
  }

  QUESTION_RESULT_CONFIRM_PATCH_INSTALLED_ = true;
})();

function getQuestionResultConfirmClientPatch_() {
  return '<script>\n' +
    '(function(){\n' +
    '  function isManualShortAnswerResult(){\n' +
    '    var view = window.currentQuestionView || {};\n' +
    '    var question = view.question || {};\n' +
    '    return question.type === "shortAnswer" && !view.giveUp;\n' +
    '  }\n' +
    '  function install(){\n' +
    '    if (window.__questionResultConfirmPatchInstalled) return;\n' +
    '    if (typeof window.startQuestionResultHold !== "function") { window.setTimeout(install, 30); return; }\n' +
    '    window.startQuestionResultHold = function(){\n' +
    '      if (typeof window.resetQuestionResultHold === "function") {\n' +
    '        window.resetQuestionResultHold(false);\n' +
    '      }\n' +
    '      if (!window.currentQuestionView) return;\n' +
    '      var requiresManualProceed = isManualShortAnswerResult();\n' +
    '      window.currentQuestionView.resultHolding = true;\n' +
    '      window.pendingQuestionTurnView = null;\n' +
    '      window.pendingQuestionTurnError = null;\n' +
    '      window.pendingServerTurnView = null;\n' +
    '      window.pendingQuestionTurnIsOptimistic = false;\n' +
    '      window.questionResultProceedRequested = false;\n' +
    '      window.pendingTurnResolutionActive = true;\n' +
    '      window.pendingTurnResolutionLoading = false;\n' +
    '      if (window.questionResultHoldTimerId) {\n' +
    '        window.clearTimeout(window.questionResultHoldTimerId);\n' +
    '        window.questionResultHoldTimerId = null;\n' +
    '      }\n' +
    '      if (window.questionResultSkipTimerId) {\n' +
    '        window.clearTimeout(window.questionResultSkipTimerId);\n' +
    '        window.questionResultSkipTimerId = null;\n' +
    '      }\n' +
    '      var hold = document.getElementById("questionResultHold");\n' +
    '      var fill = document.getElementById("questionResultHoldFill");\n' +
    '      var button = document.getElementById("questionSubmitButton");\n' +
    '      if (hold) {\n' +
    '        hold.classList.add("hidden");\n' +
    '        hold.setAttribute("aria-hidden", "true");\n' +
    '      }\n' +
    '      if (fill) {\n' +
    '        fill.style.transition = "none";\n' +
    '        fill.style.width = "100%";\n' +
    '      }\n' +
    '      if (button) {\n' +
    '        button.disabled = false;\n' +
    '        button.textContent = "확인";\n' +
    '        if (requiresManualProceed) button.focus();\n' +
    '      }\n' +
    '      if (requiresManualProceed) return;\n' +
    '      window.questionResultHoldTimerId = window.setTimeout(function(){\n' +
    '        if (typeof window.requestQuestionResultProceed === "function") {\n' +
    '          window.requestQuestionResultProceed();\n' +
    '        }\n' +
    '      }, Number(window.QUESTION_RESULT_AUTO_CLOSE_MS || 10000));\n' +
    '    };\n' +
    '    window.__questionResultConfirmPatchInstalled = true;\n' +
    '  }\n' +
    '  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", install); } else { install(); }\n' +
    '})();\n' +
    '</script>';
}
