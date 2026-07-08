/*
 * Runtime bug fixes for data-driven combat rules.
 *
 * This file intentionally installs small wrappers instead of changing sheet data.
 * - Supports onUse.tagBonus buffs such as "타격의 달인" without dealing damage.
 * - Shows active tag-bonus rules as player buff icons.
 * - Resolves legacy/custom boss IDs from the live Monsters sheet before master fallbacks.
 */

(function installRuntimeBugFixes_() {
  if (typeof LEARNING_RPG_RUNTIME_BUGFIXES_INSTALLED_ !== 'undefined' && LEARNING_RPG_RUNTIME_BUGFIXES_INSTALLED_) {
    return;
  }

  if (typeof processImmediateSkillRuleActions_ === 'function' &&
      typeof calculateSkillRuleDamage_ === 'function' &&
      typeof normalizeSkillTags_ === 'function') {
    installStrikeMasterTagBonusPatch_();
  }

  if (typeof findMonsterRowById_ === 'function') {
    installBossMonsterIdFallbackPatch_();
  }

  LEARNING_RPG_RUNTIME_BUGFIXES_INSTALLED_ = true;
})();

function installStrikeMasterTagBonusPatch_() {
  if (typeof PROCESS_IMMEDIATE_SKILL_RULE_ACTIONS_ORIGINAL_ !== 'undefined') {
    return;
  }

  PROCESS_IMMEDIATE_SKILL_RULE_ACTIONS_ORIGINAL_ = processImmediateSkillRuleActions_;
  CALCULATE_SKILL_RULE_DAMAGE_ORIGINAL_ = calculateSkillRuleDamage_;

  processImmediateSkillRuleActions_ = function(battleState, skill, actionRule, targets, context) {
    PROCESS_IMMEDIATE_SKILL_RULE_ACTIONS_ORIGINAL_(battleState, skill, actionRule, targets, context);
    if (actionRule && actionRule.tagBonus) {
      registerActiveSkillTagBonus_(battleState, skill, actionRule.tagBonus, context);
    }
  };

  calculateSkillRuleDamage_ = function(battleState, skill, rule, context, efficiency) {
    var baseDamage = CALCULATE_SKILL_RULE_DAMAGE_ORIGINAL_(battleState, skill, rule, context, efficiency);
    return applyActiveSkillTagBonuses_(battleState, skill, baseDamage, context);
  };
}

function registerActiveSkillTagBonus_(battleState, skill, tagBonus, context) {
  if (!battleState || !skill || !tagBonus) {
    return;
  }

  var normalized = normalizeActiveSkillTagBonus_(battleState, skill, tagBonus, context || {});
  if (!normalized) {
    return;
  }

  battleState.activeTagBonuses = (battleState.activeTagBonuses || []).filter(function(existing) {
    return existing && existing.sourceSkillId !== normalized.sourceSkillId;
  });
  battleState.activeTagBonuses.push(normalized);
  upsertActiveSkillTagBonusBuffIcon_(battleState, normalized);
  battleState.lastTurnEvents = battleState.lastTurnEvents || [];
  battleState.lastTurnEvents.push({
    actor: 'player',
    type: 'buff',
    skillId: skill.skillId,
    message: (skill.name || '스킬') + ' 효과로 ' + normalized.tag + ' 스킬 피해가 증가했습니다.',
  });
}

function normalizeActiveSkillTagBonus_(battleState, skill, tagBonus, context) {
  var tag = String(tagBonus.tag || tagBonus.requireTag || tagBonus.skillTag || '').trim();
  if (!tag) {
    return null;
  }

  var damageMultiplier = tagBonus.damageMultiplier !== undefined ? Number(tagBonus.damageMultiplier || 1) : 1;
  if (tagBonus.damageMultiplierFormula) {
    damageMultiplier = evaluateSkillFormulaValue_(tagBonus.damageMultiplierFormula, context, damageMultiplier, battleState, skill);
  }

  var damageAdd = tagBonus.damageAdd !== undefined ? Number(tagBonus.damageAdd || 0) : Number(tagBonus.add || 0);
  if (tagBonus.damageAddFormula) {
    damageAdd = evaluateSkillFormulaValue_(tagBonus.damageAddFormula, context, damageAdd, battleState, skill);
  }

  return {
    sourceSkillId: skill.skillId || '',
    sourceSkillName: skill.name || skill.skillId || '',
    tag: tag,
    damageMultiplier: isFinite(damageMultiplier) ? Number(damageMultiplier || 1) : 1,
    damageAdd: isFinite(damageAdd) ? Number(damageAdd || 0) : 0,
    durationType: tagBonus.durationType || 'battle',
    remainingTurns: Number(tagBonus.durationTurns || 0),
    createdAtTurn: Number(battleState.turn || 1),
  };
}

function upsertActiveSkillTagBonusBuffIcon_(battleState, bonus) {
  if (!battleState || !battleState.player || !bonus) {
    return;
  }

  var effectId = buildActiveTagBonusEffectId_(bonus);
  var description = buildActiveTagBonusDescription_(bonus);
  var effect = {
    effectId: effectId,
    name: bonus.sourceSkillName || '태그 강화',
    category: EFFECT_CATEGORIES.BUFF,
    statKey: '',
    effectType: EFFECT_TYPES.CONTROL,
    value: 0,
    description: description,
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
  var parts = [];
  if (bonus && bonus.damageMultiplier && Number(bonus.damageMultiplier) !== 1) {
    parts.push(String(bonus.tag || '태그') + ' 스킬 피해 ' + Math.round((Number(bonus.damageMultiplier || 1) - 1) * 100) + '% 증가');
  }
  if (bonus && Number(bonus.damageAdd || 0)) {
    parts.push(String(bonus.tag || '태그') + ' 스킬 추가 피해 +' + Number(bonus.damageAdd || 0));
  }
  return parts.length ? parts.join(', ') : String(bonus && bonus.tag || '태그') + ' 스킬 강화';
}

function applyActiveSkillTagBonuses_(battleState, skill, damage, context) {
  var result = Number(damage || 0);
  var bonuses = battleState && battleState.activeTagBonuses || [];
  if (!bonuses.length || result <= 0) {
    return Math.max(0, Math.round(result));
  }

  var tags = normalizeSkillTags_(skill && skill.tags);
  bonuses.forEach(function(bonus) {
    if (!bonus || tags.indexOf(bonus.tag) === -1) {
      return;
    }
    if (bonus.sourceSkillId && skill && bonus.sourceSkillId === skill.skillId) {
      return;
    }
    result *= Number(bonus.damageMultiplier || 1);
    result += Number(bonus.damageAdd || 0);
  });

  return Math.max(0, Math.round(result));
}

function installBossMonsterIdFallbackPatch_() {
  if (typeof FIND_MONSTER_ROW_BY_ID_ORIGINAL_ !== 'undefined') {
    return;
  }

  FIND_MONSTER_ROW_BY_ID_ORIGINAL_ = findMonsterRowById_;
  findMonsterRowById_ = function(monsterId) {
    var id = String(monsterId || '').trim();
    var aliases = getBossMonsterIdAliases_(id);
    for (var i = 0; i < aliases.length; i += 1) {
      var aliasRow = findCachedRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', aliases[i], 600);
      if (aliasRow) {
        return aliasRow;
      }
    }
    return FIND_MONSTER_ROW_BY_ID_ORIGINAL_(monsterId);
  };
}

function getBossMonsterIdAliases_(monsterId) {
  var aliases = {
    boss_floor_1: ['boss_Door'],
    boss_floor_2: ['boss_Ghost'],
  };
  return aliases[String(monsterId || '').trim()] || [];
}

function auditStageBossMonsterReferences() {
  var monsterIds = readTable_(DB_SHEETS.MONSTERS).reduce(function(map, monster) {
    if (monster && monster.monsterId) {
      map[String(monster.monsterId).trim()] = true;
    }
    return map;
  }, {});

  return readTable_(DB_SHEETS.STAGES).filter(function(stage) {
    return stage && stage.bossMonsterId && !monsterIds[String(stage.bossMonsterId).trim()];
  }).map(function(stage) {
    return {
      stageId: stage.stageId,
      floor: Number(stage.floor || 0),
      stage: Number(stage.stage || 0),
      bossMonsterId: stage.bossMonsterId,
      aliases: getBossMonsterIdAliases_(stage.bossMonsterId),
    };
  });
}
