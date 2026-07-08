/*
 * Allows actionPointCost = 0 skills to stay zero through server and client views.
 *
 * The original code used `value || 1` in a few places, which treats 0 as empty.
 * As a result, zero-cost skills were displayed and handled as AP 1. Humanity's
 * long war with falsy zero continues, apparently.
 */

(function installZeroActionPointSkillPatch_() {
  if (typeof ZERO_ACTION_POINT_SKILL_PATCH_INSTALLED_ !== 'undefined' && ZERO_ACTION_POINT_SKILL_PATCH_INSTALLED_) {
    return;
  }

  if (typeof getActionPointCostForAction_ === 'function') {
    GET_ACTION_POINT_COST_FOR_ACTION_ORIGINAL_ZERO_AP_ = getActionPointCostForAction_;
    getActionPointCostForAction_ = function(actionType, skill) {
      if (actionType === ACTION_TYPES.SKILL) {
        return normalizeExplicitActionPointCost_(skill && skill.actionPointCost, 1);
      }
      return 1;
    };
  }

  if (typeof getAvailableSkills === 'function') {
    GET_AVAILABLE_SKILLS_ORIGINAL_ZERO_AP_ = getAvailableSkills;
    getAvailableSkills = function(runState, battleState) {
      var skills = GET_AVAILABLE_SKILLS_ORIGINAL_ZERO_AP_(runState, battleState) || [];
      var costBySkillId = getRawSkillActionPointCostMap_();
      return skills.map(function(skill) {
        if (!skill || !skill.skillId || !Object.prototype.hasOwnProperty.call(costBySkillId, skill.skillId)) {
          return skill;
        }
        return Object.assign({}, skill, {
          actionPointCost: costBySkillId[skill.skillId],
        });
      });
    };
  }

  if (typeof buildQuestionView_ === 'function') {
    BUILD_QUESTION_VIEW_ORIGINAL_ZERO_AP_ = buildQuestionView_;
    buildQuestionView_ = function(question, pendingAction) {
      var view = BUILD_QUESTION_VIEW_ORIGINAL_ZERO_AP_(question, pendingAction);
      if (pendingAction && pendingAction.actionType === ACTION_TYPES.SKILL && hasExplicitActionPointCost_(pendingAction.actionPointCost)) {
        view.actionPointCost = normalizeExplicitActionPointCost_(pendingAction.actionPointCost, 1);
      }
      return view;
    };
  }

  ZERO_ACTION_POINT_SKILL_PATCH_INSTALLED_ = true;
})();

function hasExplicitActionPointCost_(value) {
  return value !== undefined && value !== null && value !== '';
}

function normalizeExplicitActionPointCost_(value, fallback) {
  var raw = hasExplicitActionPointCost_(value) ? value : fallback;
  var number = Number(raw);
  if (!isFinite(number)) {
    number = Number(fallback || 1);
  }
  return Math.max(0, Math.min(3, Math.round(number)));
}

function getRawSkillActionPointCostMap_() {
  var rows = [];
  try {
    rows = readTableCached_(DB_SHEETS.SKILLS, 600);
  } catch (error) {
    rows = [];
  }
  return (rows || []).reduce(function(map, row) {
    if (!row || !row.skillId) {
      return map;
    }
    map[String(row.skillId).trim()] = normalizeExplicitActionPointCost_(row.actionPointCost, 1);
    return map;
  }, {});
}
