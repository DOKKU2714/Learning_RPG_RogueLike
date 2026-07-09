/*
 * Cleans up the starting-score bonus block on the main menu.
 *
 * The previous single-line sentence wrapped awkwardly on narrow screens. This
 * renders the bonus as a small two-line stat card: score first, details below.
 */

(function installMainScoreBonusLayoutPatch_() {
  if (typeof MAIN_SCORE_BONUS_LAYOUT_PATCH_INSTALLED_ !== 'undefined' && MAIN_SCORE_BONUS_LAYOUT_PATCH_INSTALLED_) {
    return;
  }

  if (typeof include_ === 'function') {
    INCLUDE_ORIGINAL_MAIN_SCORE_BONUS_LAYOUT_ = include_;
    include_ = function(filename) {
      var html = INCLUDE_ORIGINAL_MAIN_SCORE_BONUS_LAYOUT_(filename);
      if (String(filename || '') === 'UiLoadingModal') {
        html += getMainScoreBonusLayoutClientPatch_();
      }
      return html;
    };
  }

  MAIN_SCORE_BONUS_LAYOUT_PATCH_INSTALLED_ = true;
})();

function getMainScoreBonusLayoutClientPatch_() {
  return '<style>\n' +
    '  #playerBadge { margin: 6px auto 18px; }\n' +
    '  #playerBadge .player-name-line {\n' +
    '    display: block;\n' +
    '    margin-bottom: 8px;\n' +
    '    font-size: 1rem;\n' +
    '    color: var(--accent);\n' +
    '    letter-spacing: 0.02em;\n' +
    '  }\n' +
    '  #playerBadge .starting-score-bonus {\n' +
    '    width: min(340px, 100%);\n' +
    '    margin: 8px auto 0;\n' +
    '    padding: 8px 10px;\n' +
    '    border: 1px solid rgba(255,255,255,0.16);\n' +
    '    background: rgba(0,0,0,0.18);\n' +
    '    color: var(--text);\n' +
    '    text-align: center;\n' +
    '    line-height: 1.45;\n' +
    '  }\n' +
    '  #playerBadge .score-bonus-title {\n' +
    '    display: block;\n' +
    '    margin-bottom: 2px;\n' +
    '    color: var(--muted);\n' +
    '    font-size: 0.76rem;\n' +
    '  }\n' +
    '  #playerBadge .score-bonus-value {\n' +
    '    display: block;\n' +
    '    color: var(--accent);\n' +
    '    font-size: 0.98rem;\n' +
    '    font-weight: 700;\n' +
    '    letter-spacing: 0.02em;\n' +
    '  }\n' +
    '  #playerBadge .score-bonus-detail {\n' +
    '    display: block;\n' +
    '    margin-top: 3px;\n' +
    '    color: var(--muted);\n' +
    '    font-size: 0.78rem;\n' +
    '    word-break: keep-all;\n' +
    '  }\n' +
    '</style>\n' +
    '<script>\n' +
    '(function(){\n' +
    '  function escapeHtmlLocal(value){\n' +
    '    if (typeof window.escapeHtml === "function") return window.escapeHtml(value);\n' +
    '    return String(value == null ? "" : value)\n' +
    '      .replace(/&/g, "&amp;")\n' +
    '      .replace(/</g, "&lt;")\n' +
    '      .replace(/>/g, "&gt;")\n' +
    '      .replace(/\\"/g, "&quot;")\n' +
    '      .replace(/\'/g, "&#039;");\n' +
    '  }\n' +
    '\n' +
    '  function formatScoreLocal(value){\n' +
    '    if (typeof window.formatScore === "function") return window.formatScore(value);\n' +
    '    var number = Number(value || 0);\n' +
    '    if (!isFinite(number)) number = 0;\n' +
    '    return String(Math.round(number));\n' +
    '  }\n' +
    '\n' +
    '  function renderScoreBadge(state){\n' +
    '    var player = state && state.player || {};\n' +
    '    var bonus = state && state.startingScoreBonus || {};\n' +
    '    var displayName = player.displayName || player.studentName || "플레이어";\n' +
    '    var startingScore = Number(bonus.startingScore || 0);\n' +
    '    var questionCount = Number(bonus.questionCount || 0);\n' +
    '    var likeCount = Number(bonus.likeCount || 0);\n' +
    '    var badge = document.getElementById("playerBadge");\n' +
    '    if (!badge) return;\n' +
    '    badge.innerHTML =\n' +
    '      "<strong class=\\"player-name-line\\">" + escapeHtmlLocal(displayName) + "</strong>" +\n' +
    '      "<div class=\\"starting-score-bonus\\">" +\n' +
    '        "<span class=\\"score-bonus-title\\">문제 기여 시작 점수</span>" +\n' +
    '        "<span class=\\"score-bonus-value\\">+" + escapeHtmlLocal(formatScoreLocal(startingScore)) + "점</span>" +\n' +
    '        "<span class=\\"score-bonus-detail\\">문제 " + escapeHtmlLocal(questionCount) + "개 · 좋아요 " + escapeHtmlLocal(likeCount) + "개</span>" +\n' +
    '      "</div>";\n' +
    '  }\n' +
    '\n' +
    '  function install(){\n' +
    '    if (window.__mainScoreBonusLayoutInstalled) return;\n' +
    '    window.__mainScoreBonusLayoutInstalled = true;\n' +
    '    var attempts = 0;\n' +
    '    var timer = window.setInterval(function(){\n' +
    '      attempts += 1;\n' +
    '      if (typeof window.renderPlayerBadge === "function" && !window.renderPlayerBadge.__mainScoreBonusLayoutPatched) {\n' +
    '        var patched = function(state){ renderScoreBadge(state); };\n' +
    '        patched.__mainScoreBonusLayoutPatched = true;\n' +
    '        window.renderPlayerBadge = patched;\n' +
    '        if (window.currentState && window.currentState.isRegistered) {\n' +
    '          renderScoreBadge(window.currentState);\n' +
    '        }\n' +
    '        window.clearInterval(timer);\n' +
    '        return;\n' +
    '      }\n' +
    '      if (attempts > 240) window.clearInterval(timer);\n' +
    '    }, 40);\n' +
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
