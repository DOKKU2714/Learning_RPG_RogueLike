/*
 * Adds a visible player buff icon for runtime tag-bonus skills such as 타격의 달인.
 *
 * PR #1 added activeTagBonuses for the damage logic. This small follow-up keeps
 * the same wrapper style and mirrors that runtime bonus into player.effects so
 * the existing buff/debuff UI can render it without a separate UI path.
 */

(function installTagBonusBuffIconPatch_() {
  if (typeof TAG_BONUS_BUFF_ICON_PATCH_INSTALLED_ !== 'undefined' && TAG_BONUS_BUFF_ICON_PATCH_INSTALLED_) {
    return;
  }
  if (typeof registerActiveSkillTagBonus_ !== 'function') {
    return;
  }

  REGISTER_ACTIVE_SKILL_TAG_BONUS_ORIGINAL_ = registerActiveSkillTagBonus_;
  registerActiveSkillTagBonus_ = function(battleState, skill, tagBonus, context) {
    REGISTER_ACTIVE_SKILL_TAG_BONUS_ORIGINAL_(battleState, skill, tagBonus, context);
    var bonus = findActiveTagBonusForSkill_(battleState, skill);
    upsertActiveTagBonusBuffIcon_(battleState, bonus);
  };

  TAG_BONUS_BUFF_ICON_PATCH_INSTALLED_ = true;
})();

function findActiveTagBonusForSkill_(battleState, skill) {
  var sourceSkillId = String(skill && skill.skillId || '');
  var bonuses = battleState && battleState.activeTagBonuses || [];
  for (var i = bonuses.length - 1; i >= 0; i -= 1) {
    if (bonuses[i] && bonuses[i].sourceSkillId === sourceSkillId) {
      return bonuses[i];
    }
  }
  return null;
}

function upsertActiveTagBonusBuffIcon_(battleState, bonus) {
  if (!battleState || !battleState.player || !bonus) {
    return;
  }

  var effectId = buildActiveTagBonusEffectId_(bonus);
  var effect = {
    effectId: effectId,
    name: bonus.sourceSkillName || '태그 강화',
    category: EFFECT_CATEGORIES.BUFF,
    statKey: '',
    effectType: EFFECT_TYPES.CONTROL,
    value: 0,
    description: buildActiveTagBonusDescription_(bonus),
    durationType: bonus.durationType || 'battle',
    remainingTurns: bonus.remainingTurns || '',
    stackable: false,
    maxStacks: 1,
    triggerTiming: TRIGGER_TIMINGS.PASSIVE,
    stacks: 1,
    source: {
      source: 'skillTagBonus',
      skillId: bonus.sourceSkillId || '',
      tag: bonus.tag || '',
    },
  };

  battleState.player.effects = (battleState.player.effects || []).filter(function(existing) {
    return existing && existing.effectId !== effectId;
  });
  battleState.player.effects.push(effect);
  battleState.player.buffs = battleState.player.effects.filter(function(existing) {
    return existing && existing.category === EFFECT_CATEGORIES.BUFF;
  });
  battleState.player.debuffs = battleState.player.effects.filter(function(existing) {
    return existing && existing.category === EFFECT_CATEGORIES.DEBUFF;
  });
}

function buildActiveTagBonusEffectId_(bonus) {
  return 'buff_skill_tag_bonus_' + String(bonus && bonus.sourceSkillId || 'unknown').replace(/[^0-9A-Za-z_\-]/g, '_');
}

function buildActiveTagBonusDescription_(bonus) {
  var tag = String(bonus && bonus.tag || '태그');
  var parts = [];
  if (bonus && bonus.damageMultiplier && Number(bonus.damageMultiplier) !== 1) {
    parts.push(tag + ' 스킬 피해 ' + Math.round((Number(bonus.damageMultiplier || 1) - 1) * 100) + '% 증가');
  }
  if (bonus && Number(bonus.damageAdd || 0)) {
    parts.push(tag + ' 스킬 추가 피해 +' + Number(bonus.damageAdd || 0));
  }
  return parts.length ? parts.join(', ') : tag + ' 스킬 강화';
}
