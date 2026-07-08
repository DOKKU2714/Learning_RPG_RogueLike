/*
 * Requires a manual 확인 click after a correct answer.
 *
 * The default Battle.html flow starts an automatic question-result hold timer and
 * proceeds after QUESTION_RESULT_HOLD_MS. This client wrapper keeps the modal open
 * indefinitely after a correct answer and re-enables the same 확인 button. The
 * existing submitQuestionAnswer() already calls requestQuestionResultProceed()
 * when currentQuestionView.resultHolding is true, so no extra button handler is
 * needed.
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
    '  function install(){\n' +
    '    if (window.__questionResultConfirmPatchInstalled) return;\n' +
    '    if (typeof window.startQuestionResultHold !== "function") { window.setTimeout(install, 30); return; }\n' +
    '    window.startQuestionResultHold = function(){\n' +
    '      if (typeof window.resetQuestionResultHold === "function") {\n' +
    '        window.resetQuestionResultHold(false);\n' +
    '      }\n' +
    '      if (!window.currentQuestionView) return;\n' +
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
    '      }\n' +
    '    };\n' +
    '    window.__questionResultConfirmPatchInstalled = true;\n' +
    '  }\n' +
    '  if (document.readyState === "loading") { document.addEventListener("DOMContentLoaded", install); } else { install(); }\n' +
    '})();\n' +
    '</script>';
}
