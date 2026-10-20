function getSharedRuleEngineScript_() {
  return '<script>\n' + getSharedRuleEngineSource_() + '\n</script>';
}

function getSharedRuleEngine_() {
  if (typeof SHARED_RULE_ENGINE_CACHE_ !== 'undefined' && SHARED_RULE_ENGINE_CACHE_) {
    return SHARED_RULE_ENGINE_CACHE_;
  }
  eval(getSharedRuleEngineSource_());
  SHARED_RULE_ENGINE_CACHE_ = RULE_ENGINE_SHARED;
  return SHARED_RULE_ENGINE_CACHE_;
}

function getSharedRuleEngineSource_() {
  return String.raw`
var RULE_ENGINE_SHARED = (function() {
  var TIMING = {
    TURN_START: 'turnStart',
    TURN_END: 'turnEnd',
    ON_ACTION: 'onAction',
    PASSIVE: 'passive'
  };

  function safeJsonParse(value, fallback) {
    if (!value) return fallback;
    if (typeof value === 'object') return value;
    try {
      return JSON.parse(value);
    } catch (error) {
      return fallback;
    }
  }

  function isTruthy(value) {
    return value === true || String(value || '').toLowerCase() === 'true' || String(value || '') === '1';
  }

  function randomInt(min, max, randomFn) {
    var low = Math.round(Math.min(Number(min || 0), Number(max || min || 0)));
    var high = Math.round(Math.max(Number(min || 0), Number(max || min || 0)));
    var rand = typeof randomFn === 'function' ? randomFn : Math.random;
    return Math.floor(rand() * (high - low + 1)) + low;
  }

  // Only v2 definitions opt in. Old signed snapshots keep their original rules.
  function migrateLegacyEffectDefinitions(effects, existingRules) {
    var rules = (existingRules || []).slice();
    var definitions = (effects || []).map(function(source) {
      var effect = Object.assign({}, source);
      if (Number(effect.rulesVersion) === 2) return effect;
      var stacked = ['debuff_bleed', 'debuff_poison', 'debuff_burn'].indexOf(effect.effectId) >= 0;
      var foolish = effect.effectId === 'debuff_foolish';
      effect.rulesVersion = 2;
      effect.baseValue = foolish ? 1 : effect.value;
      effect.stackMode = stacked || foolish || isTruthy(effect.stackable) ? 'add' : 'replace';
      effect.maxStacks = stacked ? Math.max(99, Number(effect.maxStacks || 0)) : Math.max(1, Number(effect.maxStacks || 1));
      effect.reapplyDurationPolicy = 'max';
      effect.durationClock = stacked ? 'stacks' : 'turns';
      effect.decayTiming = stacked ? 'onTrigger' : foolish ? 'turnEnd' : 'none';
      effect.decayStacks = stacked || foolish ? 1 : 0;
      effect.decrementOnApplyTurn = foolish;
      function add(operation, timing, stat, mode, formula, shield) {
        rules.push({effectId:effect.effectId, ruleOrder:rules.filter(function(rule) { return rule.effectId === effect.effectId; }).length + 1,
          triggerTiming:timing, operation:operation, statKey:stat || '', valueMode:mode || '', valueFormula:formula || '', shieldPolicy:shield || '', description:''});
      }
      if (stacked) {
        var timing = {debuff_bleed:'beforeAction', debuff_poison:'turnEnd', debuff_burn:'beforeMonsterTurn'}[effect.effectId];
        // An empty value really means zero in the current game. Do not repair
        // balance data during a structural migration (damage still clamps to 1).
        var fallback = effect.effectId === 'debuff_poison' ? 'stacks' : 'maxHp*stacks*' + (effect.effectId === 'debuff_burn' ? '0.01' : '0.007');
        add('damage', timing, 'hp', 'flat', String(effect.damageFormula || '').trim() || fallback, effect.effectId === 'debuff_burn' ? 'absorb' : 'bypass');
        // The old stat reducer also saw DOT rows. Keep that projection when a
        // skill overrides value; removing it here would change effective HP.
        add('modifyStat', 'passive', effect.statKey || 'hp', effect.effectType || 'flat', 'value*stacks');
      } else if (effect.statKey === 'caffeine') {
        add('modifyStat', 'passive', 'questionEfficiencyBonusPercent', 'flat', '3*stacks');
        add('modifyStat', 'passive', 'questionTime', 'flat', '0.3*stacks');
        // Preserve the otherwise unused synthetic stat for existing snapshots.
        add('modifyStat', 'passive', 'caffeine', 'flat', 'value*stacks');
      } else if (effect.effectType === 'control') {
        if (['debuff_freeze', 'debuff_stun', 'debuff_sleep'].indexOf(effect.effectId) >= 0) add('blockAction', 'passive');
        if (effect.effectId === 'debuff_freeze') {
          add('damageTakenMultiplier', 'onHit', '', '', '1.5');
          add('removeOnHit', 'onHit');
        }
      } else if (effect.statKey) {
        add('modifyStat', 'passive', effect.statKey, effect.effectType || 'flat', foolish ? '1' : 'value*stacks');
      }
      if (!rules.some(function(rule) { return rule.effectId === effect.effectId; })) throw new Error('Cannot migrate effect: ' + effect.effectId);
      return effect;
    });
    return {effects:definitions, rules:rules};
  }

  function compileEffectDefinitions(effects, rules) {
    var byId = {}, seen = {};
    (rules || []).forEach(function(rule) {
      if (!rule.effectId) return;
      var key = rule.effectId + ':' + rule.ruleOrder;
      if (!isFinite(Number(rule.ruleOrder)) || Number(rule.ruleOrder) < 1 || Math.floor(Number(rule.ruleOrder)) !== Number(rule.ruleOrder)) throw new Error('Invalid EffectRules order: ' + key);
      if (seen[key]) throw new Error('Duplicate EffectRules key: ' + key);
      seen[key] = true;
      if (['modifyStat', 'damage', 'blockAction', 'damageTakenMultiplier', 'removeOnHit', 'combatParameter', 'directHitDamage', 'consumeStacks', 'modifyAppliedStacks', 'modifyReceivedStacks', 'consumeOnApply', 'incomingReductionIfEffect', 'triggerActions'].indexOf(rule.operation) < 0) throw new Error('Unsupported effect operation: ' + rule.operation);
      if (['passive', 'turnStart', 'turnEnd', 'onAction', 'beforeAction', 'beforeMonsterTurn', 'onHit', 'onEvade', 'onBlock', 'onKill', 'onApplyEffect', 'onTurnStart', 'onTurnEnd'].indexOf(rule.triggerTiming) < 0) throw new Error('Unsupported effect timing: ' + rule.triggerTiming);
      if (rule.operation === 'modifyStat' && (!rule.statKey || ['flat', 'percent'].indexOf(rule.valueMode) < 0)) throw new Error('Invalid stat rule: ' + key);
      if ((rule.operation === 'modifyStat' || rule.operation === 'blockAction') && rule.triggerTiming !== 'passive') throw new Error('Stat/control rules require passive timing: ' + key);
      if ((rule.operation === 'damageTakenMultiplier' || rule.operation === 'removeOnHit') && rule.triggerTiming !== 'onHit') throw new Error('Hit rules require onHit timing: ' + key);
      if ((rule.operation === 'modifyStat' || rule.operation === 'damage' || rule.operation === 'damageTakenMultiplier') && !String(rule.valueFormula || '').trim()) throw new Error('Missing effect formula: ' + key);
      if (rule.operation === 'damage' && ['absorb', 'bypass'].indexOf(rule.shieldPolicy) < 0) throw new Error('Invalid shield policy: ' + key);
      if (rule.operation === 'combatParameter' && (!String(rule.statKey || '').trim() || ['json','text'].indexOf(rule.valueMode)<0)) throw new Error('Invalid combat parameter: '+key);
      if (rule.operation === 'combatParameter' && rule.valueMode === 'json') JSON.parse(rule.valueFormula);
      if (rule.operation === 'combatParameter' && rule.statKey === 'revive') {
        var revival = JSON.parse(rule.valueFormula);
        if (rule.valueMode !== 'json' || rule.triggerTiming !== 'passive' || typeof revival.hpFormula !== 'string' || !revival.hpFormula.trim()) throw new Error('Invalid revival rule: '+key);
        evaluateFormula(revival.hpFormula, {maxHp:100,value:30}, {warn:function(message) { throw new Error('Invalid revival formula: '+message); }});
      }
      if (rule.operation === 'triggerActions') {
        var trigger=JSON.parse(rule.valueFormula);
        if(rule.valueMode!=='json' || !Array.isArray(trigger.actions) || ['onBlock','onTurnStart','onTurnEnd'].indexOf(rule.triggerTiming)<0)throw new Error('Invalid effect trigger: '+key);
        validateCombatActions(trigger.actions);
      }
      if(['directHitDamage','consumeStacks','modifyAppliedStacks','modifyReceivedStacks','consumeOnApply','incomingReductionIfEffect'].indexOf(rule.operation)>=0 && !String(rule.valueFormula || '').trim())throw new Error('Missing effect formula: '+key);
      if(rule.operation==='directHitDamage' && ['absorb','bypass'].indexOf(rule.shieldPolicy)<0)throw new Error('Invalid shield policy: '+key);
      if (['directHitDamage','consumeStacks'].indexOf(rule.operation)>=0 && rule.triggerTiming!=='onHit') throw new Error('Direct hit rules require onHit timing: '+key);
      if (['modifyAppliedStacks','modifyReceivedStacks','consumeOnApply'].indexOf(rule.operation)>=0 && rule.triggerTiming!=='onApplyEffect') throw new Error('Stack modifiers require onApplyEffect timing: '+key);
      if (['combatParameter','triggerActions'].indexOf(rule.operation)<0 && String(rule.valueFormula || '').trim()) evaluateFormula(rule.valueFormula, {value:1, stacks:1, maxHp:100, remainingTurns:1,attack:20}, {
        random:function() { return 0; },
        warn:function(message) { throw new Error('Invalid EffectRules formula (' + key + '): ' + message); }
      });
      (byId[rule.effectId] || (byId[rule.effectId] = [])).push(Object.assign({}, rule));
    });
    return (effects || []).map(function(definition) {
      var effect = Object.assign({}, definition);
      if (Number(effect.rulesVersion) !== 2) return effect;
      if (effect.behaviorJson || effect.behavior) effect.behavior = readCombatBehavior(effect.behaviorJson || effect.behavior);
      if ((!byId[effect.effectId] || !byId[effect.effectId].length) && !Object.keys(effect.behavior || {}).length) throw new Error('Missing EffectRules: ' + effect.effectId);
      effect.rules = (byId[effect.effectId] || []).slice().sort(function(a, b) { return Number(a.ruleOrder) - Number(b.ruleOrder); });
      effect.value = Number(effect.baseValue || 0);
      effect.stackable = effect.stackMode === 'add';
      if (['add', 'replace'].indexOf(effect.stackMode) < 0 || ['max', 'refresh', 'extend', 'keep'].indexOf(effect.reapplyDurationPolicy) < 0 || ['turns', 'stacks'].indexOf(effect.durationClock) < 0) throw new Error('Invalid effect lifecycle: ' + effect.effectId);
      // Project the first rule for existing skill upgrades and status displays.
      var primary = effect.rules.filter(function(rule) { return rule.operation === 'modifyStat' || rule.operation === 'blockAction'; })[0];
      if (!effect.statKey && primary) effect.statKey = primary.statKey || 'action';
      if (!effect.effectType && primary) effect.effectType = primary.operation === 'blockAction' ? 'control' : primary.valueMode;
      return effect;
    });
  }

  function getEffectRuleValue(effect, rule, target, extraContext) {
    return evaluateFormula(rule.valueFormula, Object.assign({
      value: Number(effect.value || 0), stacks: Math.max(1, Number(effect.stacks || 1)),
      maxHp: Math.max(1, Number(target && (target.maxHp || target.stats && target.stats.hp) || 1)),
      remainingTurns: Number(effect.remainingTurns || 0)
    }, extraContext || {}), {});
  }

  function getRuleStatBonus(effect, statKey, valueMode) {
    return (effect.rules || []).reduce(function(total, rule) {
      return total + (rule.operation === 'modifyStat' && rule.triggerTiming === 'passive' && rule.statKey === statKey && rule.valueMode === valueMode ? getEffectRuleValue(effect, rule) : 0);
    }, 0);
  }

  function hasActionBlock(target) {
    return (target && target.effects || []).some(function(effect) {
      if (effect.behavior && effect.behavior.control) return true;
      if (effect.rules) return effect.rules.some(function(rule) { return rule.operation === 'blockAction' && rule.triggerTiming === 'passive'; });
      return ['debuff_stun', 'debuff_freeze', 'debuff_sleep'].indexOf(effect.effectId) >= 0;
    });
  }

  function normalizeEffectInstance(effect, sourceInfo, turn) {
    var payload = Object.assign({}, effect || {});
    var isStackedDamageEffect = payload.rules ? payload.durationClock === 'stacks' : payload.effectId === 'debuff_burn' || payload.effectId === 'debuff_bleed' || payload.effectId === 'debuff_poison';
    if (isStackedDamageEffect) {
      payload.durationType = 'turn';
      payload.stackable = true;
      payload.maxStacks = Math.max(payload.rules ? 1 : 99, Number(payload.maxStacks || 0));
    }
    payload.value = Number(payload.value || 0);
    payload.stackable = isTruthy(payload.stackable);
    payload.maxStacks = Math.max(1, Number(payload.maxStacks || 1));
    var defaultStacks = isStackedDamageEffect
      ? (payload.durationTurns || payload.remainingTurns || 1)
      : 1;
    payload.stacks = Math.min(payload.maxStacks, Math.max(1, Math.floor(Number(payload.stacks !== undefined && payload.stacks !== '' ? payload.stacks : defaultStacks))));
    payload.remainingTurns = payload.durationType === 'turn'
      ? Number(payload.durationTurns || payload.remainingTurns || 1)
      : '';
    payload.source = sourceInfo && sourceInfo.source || payload.source || '';
    payload.skillId = sourceInfo && sourceInfo.skillId || payload.skillId || '';
    payload.appliedAtTurn = Number(turn || payload.appliedAtTurn || 1);
    return payload;
  }

  function getEffectCategory(effect, fallback) {
    var category = String(effect && effect.category || fallback || '').toLowerCase();
    if (!category && /^buff_/i.test(String(effect && effect.effectId || ''))) {
      category = 'buff';
    }
    if (!category && /^debuff_/i.test(String(effect && effect.effectId || ''))) {
      category = 'debuff';
    }
    return category;
  }

  function mergeStatusEffects(target) {
    var merged = [];
    var seen = {};
    function fillMissingStatusFields(targetEffect, sourceEffect) {
      Object.keys(sourceEffect).forEach(function(key) {
        if (targetEffect[key] === undefined || targetEffect[key] === null || targetEffect[key] === '') {
          targetEffect[key] = sourceEffect[key];
        }
      });
    }
    function add(effect, fallbackCategory) {
      if (!effect) return;
      var copy = Object.assign({}, effect);
      copy.category = getEffectCategory(copy, fallbackCategory) || copy.category || '';
      var key = String(copy.effectId || copy.id || copy.name || merged.length);
      if (seen[key]) {
        fillMissingStatusFields(seen[key], copy);
        return;
      }
      seen[key] = copy;
      merged.push(copy);
    }
    (target.effects || []).forEach(function(effect) { add(effect, ''); });
    (target.buffs || []).forEach(function(effect) { add(effect, 'buff'); });
    (target.debuffs || []).forEach(function(effect) { add(effect, 'debuff'); });
    return merged;
  }

  function syncStatusBuckets(target) {
    if (!target) return target;
    target.effects = mergeStatusEffects(target);
    target.buffs = target.effects.filter(function(effect) {
      return getEffectCategory(effect, '') === 'buff';
    });
    target.debuffs = target.effects.filter(function(effect) {
      return getEffectCategory(effect, '') === 'debuff';
    });
    return target;
  }

  function applyEffect(target, effectPayload, sourceInfo, turn) {
    if (!target || !effectPayload || !effectPayload.effectId) return null;
    var effect = normalizeEffectInstance(effectPayload, sourceInfo, turn);
    if (effect.behaviorJson || effect.behavior) effect.behavior = readCombatBehavior(effect.behaviorJson || effect.behavior);
    if (effect.behavior && effect.behavior.control) {
      effect.controlState = { remainingSkips: Math.max(1, Math.floor(Number(effect.behavior.control.skipActions || 1))), skipped: false };
      if (effect.behavior.control.blockImmediately && target.currentHp === undefined) target.currentActionPoint = 0;
    }
    target.effects = target.effects || [];
    var existing = null;
    for (var i = 0; i < target.effects.length; i += 1) {
      if (target.effects[i].effectId === effect.effectId) {
        existing = target.effects[i];
        break;
      }
    }
    if (existing && effect.stackable) {
      existing.stacks = Math.min(Number(effect.maxStacks || 99), Math.max(1, Number(existing.stacks || 1)) + Math.max(1, Number(effect.stacks || 1)));
      if (effect.remainingTurns !== '') {
        var policy = effect.reapplyDurationPolicy || 'max';
        if (policy === 'refresh') existing.remainingTurns = Number(effect.remainingTurns || 0);
        else if (policy === 'extend') existing.remainingTurns = Number(existing.remainingTurns || 0) + Number(effect.remainingTurns || 0);
        else if (policy !== 'keep') existing.remainingTurns = Math.max(Number(existing.remainingTurns || 0), Number(effect.remainingTurns || 0));
      }
      syncStatusBuckets(target);
      return existing;
    }
    if (existing && !effect.stackable) {
      // Reapplying an actor-clock control never grants another skipped turn.
      if (existing.controlState && effect.behavior && effect.behavior.control) return existing;
      Object.keys(existing).forEach(function(key) { delete existing[key]; });
      Object.assign(existing, effect);
      syncStatusBuckets(target);
      return existing;
    }
    target.effects.push(effect);
    syncStatusBuckets(target);
    return effect;
  }

  function getQuestionMaxEfficiencyMultiplier(effects) {
    return (effects || []).reduce(function(multiplier, effect) {
      if (effect.rules) {
        return effect.rules.reduce(function(result, rule) {
          return rule.operation === 'modifyStat' && rule.triggerTiming === 'passive' && rule.statKey === 'questionMaxEfficiency' && rule.valueMode === 'percent' ? result * Math.max(0, 1 + getEffectRuleValue(effect, rule) / 100) : result;
        }, multiplier);
      }
      if (effect.statKey !== 'questionMaxEfficiency' || effect.effectType !== 'percent') return multiplier;
      return multiplier * Math.max(0, 1 + Number(effect.value || 0) * Math.max(1, Number(effect.stacks || 1)) / 100);
    }, 1);
  }

  function getQuestionEfficiencyBonusPercent(effects) {
    return (effects || []).reduce(function(total, effect) {
      if (effect.rules) return total + getRuleStatBonus(effect, 'questionEfficiencyBonusPercent', 'flat');
      return total + (effect.statKey === 'caffeine'
        ? Math.max(1, Number(effect.stacks || 1)) * 3
        : 0);
    }, 0);
  }

  function getQuestionMinEfficiencyBonusPercent(effects) {
    return (effects || []).reduce(function(total, effect) {
      if (effect.rules) return total + getRuleStatBonus(effect, 'questionMinEfficiencyPercent', 'flat');
      return total + (effect.statKey === 'questionMinEfficiencyPercent' && effect.effectType === 'flat'
        ? Number(effect.value || 0) * Math.max(1, Number(effect.stacks || 1)) : 0);
    }, 0);
  }

  function getQuestionCappedEfficiencyBonusPercent(effects) {
    return (effects || []).reduce(function(total,effect){
      return total + (effect.behavior && effect.behavior.combat && effect.behavior.combat.capEfficiency ? getRuleStatBonus(effect,'questionEfficiencyBonusPercent','flat') : 0);
    },0);
  }

  function capQuestionEfficiencyBonus(value, maximum, cappedPercent) {
    var bonus=Math.max(0,Number(cappedPercent || 0))/100;
    var baseline=Number(value || 0)-bonus;
    return baseline+Math.min(bonus,Math.max(0,Number(maximum)-baseline));
  }

  function consumeQuestionEffects(player) {
    if (!player) return;
    syncStatusBuckets(player);
    player.effects = player.effects.filter(function(effect) { return effect.durationType !== 'question' && !(effect.behavior && effect.behavior.combat && effect.behavior.combat.consumeOnQuestion); });
    player.buffs = [];
    player.debuffs = [];
    syncStatusBuckets(player);
  }

  function isCooldownReductionSkill(skill) {
    var rule = safeJsonParse(skill && skill.effectJson, {});
    return !!(rule.cooldownModify && Number(rule.cooldownModify.amount) < 0) ||
      (rule.actions || []).some(function(action) { return action.operation === 'cooldownSelect' || action.operation === 'cooldownAll'; });
  }

  function getDiscountedSkillCost(player, skill, baseCost) {
    var cost = Math.max(0, Math.min(3, Number(baseCost)));
    (player && player.effects || []).forEach(function(effect) {
      var modifier = effect.behavior && effect.behavior.combat && effect.behavior.combat.skillCost;
      if (!modifier || Number(effect.skillCostUses === undefined ? modifier.uses : effect.skillCostUses) <= 0) return;
      if (effect.sourceSkillId === (skill && skill.skillId)) return;
      if (cost > 0) cost = Math.max(Number(modifier.minimum || 1), cost - Number(modifier.amount || 0));
    });
    return cost;
  }

  function consumeSkillCostEffects(player, skill) {
    if (!player || !skill) return;
    (player.effects || []).slice().forEach(function(effect) {
      var modifier = effect.behavior && effect.behavior.combat && effect.behavior.combat.skillCost;
      if (!modifier || effect.sourceSkillId === skill.skillId) return;
      effect.skillCostUses = Number(effect.skillCostUses === undefined ? modifier.uses : effect.skillCostUses) - 1;
      if (effect.skillCostUses <= 0) removeCombatEffect(player, effect.effectId, 'consumed');
    });
  }

  function getEffectiveStat(target, statKey) {
    var baseValue = Number(target && target[statKey] !== undefined
      ? target[statKey]
      : target && target.stats && target.stats[statKey] !== undefined ? target.stats[statKey] : 0);
    return (target && target.effects || []).reduce(function(value, effect) {
      var a=effect.assassinState;
      if(a && a.active!==false){
        if(statKey==='evasion')value+=Number(a.evasion || 0)+((target.shield!==undefined?Number(target.shield)===0:a.unshielded)?Number(a.unshieldedExtra || 0):0);
        if(statKey==='attack')value+=Number(a.attackBonus || 0);
        if(statKey==='hp')value=Math.max(1,value-Number(a.maxHpReduction || 0));
      }
      if (effect.rules) {
        if (['questionTime', 'questionDifficulty', 'questionMaxEfficiency', 'questionMinEfficiencyPercent', 'questionEfficiencyBonusPercent', 'action'].indexOf(statKey) >= 0) return value;
        return effect.rules.reduce(function(result, rule) {
          if (rule.operation !== 'modifyStat' || rule.triggerTiming !== 'passive' || rule.statKey !== statKey) return result;
          var amount = getEffectRuleValue(effect, rule, target);
          return rule.valueMode === 'percent' ? result * (1 + amount / 100) : result + amount;
        }, value);
      }
      if (effect.statKey !== statKey) return value;
      if (effect.statKey === 'questionTime' || effect.statKey === 'questionDifficulty' || effect.statKey === 'questionMaxEfficiency' || effect.statKey === 'questionMinEfficiencyPercent' || effect.statKey === 'action') return value;
      var effectValue = Number(effect.value || 0) * Math.max(1, Number(effect.stacks || 1));
      if (effect.effectType === 'percent') return value * (1 + (effectValue / 100));
      if (effect.effectType === 'flat') return value + effectValue;
      return value;
    }, baseValue);
  }

  function calculateEffectiveStats(baseStats, activeEffects) {
    var stats = Object.assign({}, baseStats || {});
    (activeEffects || []).forEach(function(effect) {
      if (effect.rules) {
        var keys = {};
        effect.rules.forEach(function(rule) { if (rule.operation === 'modifyStat') keys[rule.statKey] = true; });
        Object.keys(keys).forEach(function(key) {
          if (['questionTime', 'questionDifficulty', 'questionMaxEfficiency', 'questionMinEfficiencyPercent', 'questionEfficiencyBonusPercent', 'action'].indexOf(key) < 0) stats[key] = getEffectiveStat({ stats: stats, effects: [effect] }, key);
        });
        return;
      }
      if (!effect.statKey || effect.statKey === 'questionTime' || effect.statKey === 'questionDifficulty' || effect.statKey === 'questionMaxEfficiency' || effect.statKey === 'questionMinEfficiencyPercent' || effect.statKey === 'action') return;
      stats[effect.statKey] = getEffectiveStat({ stats: stats, effects: [effect] }, effect.statKey);
    });
    (activeEffects || []).forEach(function(effect) {
      var a=effect.assassinState;
      if(!a || a.active===false)return;
      stats.evasion=Number(stats.evasion || 0)+Number(a.evasion || 0)+(a.unshielded?Number(a.unshieldedExtra || 0):0);
      stats.attack=Number(stats.attack || 0)+Number(a.attackBonus || 0);
      if(a.maxHpReduction)stats.hp=Math.max(1,Number(stats.hp || 1)-Number(a.maxHpReduction));
      if(Number(a.guaranteedEvadeCharges)>0)stats.guaranteedEvade=true;
    });
    return stats;
  }

  function hasEffect(target, effectId) {
    return (target && target.effects || []).some(function(effect) {
      return effect.effectId === effectId;
    });
  }

  function reviveAfterDamage(target, battle) {
    if (!battle || target !== battle.player || Number(target.hp) > 0) return false;
    var effect = (target.effects || []).filter(function(candidate) {
      return (candidate.rules || []).some(function(rule) { return rule.operation === 'combatParameter' && rule.statKey === 'revive'; });
    })[0];
    if (!effect) return false;
    var rule = effect.rules.filter(function(rule) { return rule.operation === 'combatParameter' && rule.statKey === 'revive'; })[0];
    var config = JSON.parse(rule.valueFormula);
    var maxHp = Math.max(1, Number(target.maxHp || target.stats && target.stats.hp || 1));
    var hp = evaluateFormula(config.hpFormula, {maxHp:maxHp,value:Number(effect.value || 0)}, {warn:function(message) { throw new Error('Invalid revive formula: '+message); }});
    removeCombatEffect(target, effect.effectId, 'consumed');
    target.hp = Math.max(1, Math.min(maxHp, Math.round(hp)));
    battle.lastTurnEvents = battle.lastTurnEvents || [];
    battle.lastTurnEvents.push({actor:'effect',type:'heal',target:'player',effectId:effect.effectId,heal:target.hp,message:(effect.name || '부활')+' 효과로 체력 '+target.hp+' 부활!'});
    return true;
  }

  function applyTimedEffectDamage(target, timing, battle, actor, currentTurn) {
    if (!target) return 0;
    if (isCombatInvulnerable(target)) return 0;
    var totalDamage = 0;
    (target.effects || []).forEach(function(effect) {
      // Stack-clock damage is dispatched at its explicit lifecycle event by the
      // server rules (also exported verbatim to the browser).
      if (effect.rules) {
        if (effect.durationClock === 'stacks') return;
        if (currentTurn !== undefined && effect.appliedAtTurn !== undefined && Number(effect.appliedAtTurn) === Number(currentTurn) && !isTruthy(effect.decrementOnApplyTurn)) return;
        effect.rules.forEach(function(rule) {
          if (rule.operation !== 'damage' || rule.triggerTiming !== timing) return;
          var damage = Math.max(1, Math.round(getEffectRuleValue(effect, rule, target)));
          var currentHp = Number(target.currentHp !== undefined ? target.currentHp : target.hp || 0);
          var shieldDamage = rule.shieldPolicy === 'bypass' ? 0 : Math.min(Number(target.shield || 0), damage);
          var hpDamage = Math.min(currentHp, damage - shieldDamage);
          if (target.currentHp !== undefined) target.currentHp = Math.max(0, currentHp - hpDamage);
          else target.hp = Math.max(0, currentHp - hpDamage);
          if (rule.shieldPolicy !== 'bypass') target.shield = Math.max(0, Number(target.shield || 0) - shieldDamage);
          totalDamage += hpDamage + shieldDamage;
          if (battle) {
            battle.lastTurnEvents = battle.lastTurnEvents || [];
            battle.lastTurnEvents.push({actor:'effect', type:'effectDamage', target:actor === 'monster' ? 'monster' : 'player', effectId:effect.effectId, targetMonsterId:actor === 'monster' ? target.instanceId || target.monsterId || '' : '', damage:hpDamage + shieldDamage, hpDamage:hpDamage, shieldDamage:shieldDamage, message:(effect.name || effect.effectId) + '로 ' + (hpDamage + shieldDamage) + ' 피해!'});
          }
          reviveAfterDamage(target, battle);
        });
        return;
      }
      if (effect.effectId === 'debuff_burn' || effect.effectId === 'debuff_bleed' || effect.effectId === 'debuff_poison') return;
      if (effect.triggerTiming !== timing || effect.statKey !== 'hp' || effect.effectType !== 'flat' || Number(effect.value || 0) >= 0) return;
      if (currentTurn !== undefined && effect.appliedAtTurn !== undefined && Number(effect.appliedAtTurn || 0) === Number(currentTurn || 0)) return;
      var damage = Math.abs(Number(effect.value || 0)) * Math.max(1, Number(effect.stacks || 1));
      if (target.currentHp !== undefined) {
        target.currentHp = Math.max(0, Number(target.currentHp || 0) - damage);
      } else {
        target.hp = Math.max(0, Number(target.hp || 0) - damage);
      }
      totalDamage += damage;
      if (battle) {
        battle.lastTurnEvents = battle.lastTurnEvents || [];
        battle.lastTurnEvents.push({
          actor: 'effect',
          type: 'effectDamage',
          target: actor === 'monster' ? 'monster' : 'player',
          effectId: effect.effectId || '',
          targetMonsterId: actor === 'monster' ? (target.instanceId || target.monsterId || '') : '',
          damage: damage,
          hpDamage: damage,
          shieldDamage: 0,
          message: (effect.name || effect.effectId || '효과') + '로 ' + damage + ' 피해!'
        });
      }
      reviveAfterDamage(target, battle);
    });
    return totalDamage;
  }

  function decrementTurnEffects(target, currentTurn) {
    if (!target) return target;
    if (!Array.isArray(target.effects) || !target.effects.length) {
      syncStatusBuckets(target);
    }
    target.effects = (target.effects || []).map(function(effect) {
      if (effect.rules) {
        if (effect.behavior && effect.behavior.control) return effect;
        if (effect.durationType !== 'turn' || effect.durationClock === 'stacks') return effect;
        if (!isTruthy(effect.decrementOnApplyTurn) && !(target.currentHp !== undefined && hasActionBlock({effects:[effect]})) && currentTurn !== undefined && effect.appliedAtTurn !== undefined && Number(effect.appliedAtTurn) === Number(currentTurn)) return effect;
        if (effect.decayTiming === 'turnEnd') effect.stacks = Math.max(0, Number(effect.stacks || 1) - Number(effect.decayStacks || 0));
        effect.remainingTurns = Number(effect.remainingTurns || 0) - 1;
        return effect;
      }
      if (effect.durationType === 'turn' && effect.effectId !== 'debuff_burn' && effect.effectId !== 'debuff_bleed' && effect.effectId !== 'debuff_poison') {
        if (effect.effectId !== 'debuff_foolish'
          && !(target.currentHp !== undefined && effect.statKey === 'action' && effect.effectType === 'control')
          && currentTurn !== undefined
          && effect.appliedAtTurn !== undefined
          && Number(effect.appliedAtTurn || 0) === Number(currentTurn || 0)) {
          return effect;
        }
        if (effect.effectId === 'debuff_foolish') {
          effect.stacks = Math.max(0, Number(effect.stacks || 1) - 1);
        }
        effect.remainingTurns = Number(effect.remainingTurns || 0) - 1;
      }
      return effect;
    }).filter(function(effect) {
      return effect.durationType !== 'turn' || Number(effect.remainingTurns || 0) > 0;
    });
    target.buffs = [];
    target.debuffs = [];
    return syncStatusBuckets(target);
  }

  function buildFormulaContext(battle, skill, target, efficiency) {
    var player = battle && battle.player || {};
    var level = Math.max(1, Number(skill && skill.level || 1));
    var upgradeLevel = Math.max(0, level - 1);
    var upgradeJson = safeJsonParse(skill && skill.upgradeJson, {});
    var tagCounts = battle && battle.usedSkillCountByTagThisBattle || {};
    var turnTagCounts = battle && battle.usedSkillCountByTagThisTurn || {};
    return {
      n: upgradeLevel,
      upgrade: upgradeLevel,
      level: level,
      skillLevel: level,
      base: Number(skill && skill.baseValue || 0),
      baseValue: Number(skill && skill.baseValue || 0),
      skillBaseValue: Number(skill && skill.baseValue || 0),
      damageUpgrade: getUpgradeValue(skill, upgradeJson, 'damage', upgradeLevel, level),
      effectUpgrade: getUpgradeValue(skill, upgradeJson, 'effect', upgradeLevel, level),
      buffValueUpgrade: getUpgradeValue(skill, upgradeJson, 'buffValue', upgradeLevel, level),
      debuffChanceUpgrade: getUpgradeValue(skill, upgradeJson, 'debuffChance', upgradeLevel, level),
      atk: getEffectiveStat(player, 'attack'),
      attack: getEffectiveStat(player, 'attack'),
      def: getEffectiveStat(player, 'defense'),
      defense: getEffectiveStat(player, 'defense'),
      hp: Number(player.hp || 0),
      maxHp: Number(player.maxHp || player.stats && player.stats.hp || 1),
      shield: Number(player.shield || 0),
      defaultShield: Number(skill && skill.baseValue || 0) + getEffectiveStat(player, 'defense'),
      skillShield: Number(skill && skill.baseValue || 0) + getEffectiveStat(player, 'defense'),
      enemyHp: Number(target && target.currentHp || 0),
      enemyMaxHp: Number(target && target.maxHp || 0),
      enemyShield: Number(target && target.shield || 0),
      targetShock: effectStacks(target, 'effect_v2_shock'),
      enemyShockTotal: (battle.monsters || []).filter(function(m) { return Number(m.currentHp || 0) > 0; }).reduce(function(sum,m) { return sum + effectStacks(m,'effect_v2_shock'); },0),
      efficiency: Number(efficiency || 0),
      usedStrikeSkillCountThisBattle: Number(tagCounts.strike || tagCounts['타격'] || 0),
      usedStrikeSkillCountThisTurn: Number(turnTagCounts.strike || turnTagCounts['타격'] || 0)
    };
  }

  function getUpgradeValue(skill, upgradeJson, key, upgradeLevel, level) {
    var raw = upgradeJson && upgradeJson[key];
    if (raw === undefined || raw === null || raw === '') return 0;
    if (typeof raw === 'number' || /^-?\d+(?:\.\d+)?$/.test(String(raw).trim())) {
      return Number(raw || 0) * upgradeLevel;
    }
    return evaluateFormula(String(raw), {
      n: upgradeLevel,
      upgrade: upgradeLevel,
      level: level,
      skillLevel: level,
      base: Number(skill && skill.baseValue || 0),
      baseValue: Number(skill && skill.baseValue || 0),
      skillBaseValue: Number(skill && skill.baseValue || 0)
    }, {});
  }

  function evaluateFormula(formula, context, options) {
    var source = String(formula || '').replace(/\s+/g, '');
    if (!source) return 0;
    source = source.replace(/\{([A-Za-z_.][0-9A-Za-z_.]*)\}/g, function(match, name) {
      if (name === 'shield') {
        if (context && context.defaultShield !== undefined) return 'defaultShield';
        if (context && context.skillShield !== undefined) return 'skillShield';
      }
      return name;
    });
    if (!/^[0-9A-Za-z_.+\-*/()%dD]+$/.test(source)) {
      warn(options, 'Unsafe formula rejected.', { formula: formula });
      return 0;
    }
    source = source.replace(/(\d+)[dD](\d+)/g, function(match, countText, sidesText) {
      var count = Math.max(1, Math.min(100, Number(countText || 1)));
      var sides = Math.max(1, Math.min(100000, Number(sidesText || 1)));
      var total = 0;
      for (var i = 0; i < count; i += 1) total += randomInt(1, sides, options && options.random);
      return String(total);
    });
    // Sheet formulas also use mathematical implicit multiplication (e.g. 2n).
    source = source.replace(/(\d)(?=[A-Za-z_(])/g, '$1*');
    var parser = createFormulaParser(source, context || {}, options);
    var result = parser.parseExpression();
    if (parser.hasRemaining()) warn(options, 'Formula parse stopped before end.', { formula: formula, at: parser.index });
    return isFinite(result) ? Number(result || 0) : 0;
  }

  function createFormulaParser(source, context, options) {
    return {
      source: source,
      index: 0,
      hasRemaining: function() { return this.index < this.source.length; },
      peek: function() { return this.source.charAt(this.index); },
      take: function() { return this.source.charAt(this.index++); },
      parseExpression: function() {
        var value = this.parseTerm();
        while (this.hasRemaining()) {
          var op = this.peek();
          if (op !== '+' && op !== '-') break;
          this.take();
          var rhs = this.parseTerm();
          value = op === '+' ? value + rhs : value - rhs;
        }
        return value;
      },
      parseTerm: function() {
        var value = this.parseFactor();
        while (this.hasRemaining()) {
          var op = this.peek();
          if (op !== '*' && op !== '/' && op !== '%') break;
          this.take();
          var rhs = this.parseFactor();
          if (op === '*') value *= rhs;
          if (op === '/') value = rhs === 0 ? 0 : value / rhs;
          if (op === '%') value = rhs === 0 ? 0 : value % rhs;
        }
        return value;
      },
      parseFactor: function() {
        var op = this.peek();
        if (op === '+') { this.take(); return this.parseFactor(); }
        if (op === '-') { this.take(); return -this.parseFactor(); }
        if (op === '(') {
          this.take();
          var nested = this.parseExpression();
          if (this.peek() === ')') this.take();
          return nested;
        }
        return this.parseAtom();
      },
      parseAtom: function() {
        var start = this.index;
        while (this.hasRemaining() && /[0-9.]/.test(this.peek())) this.take();
        if (this.index > start) return Number(this.source.slice(start, this.index) || 0);
        start = this.index;
        while (this.hasRemaining() && /[A-Za-z_.]/.test(this.peek())) this.take();
        if (this.index > start) {
          var name = this.source.slice(start, this.index);
          if (Object.prototype.hasOwnProperty.call(context, name)) return Number(context[name] || 0);
          warn(options, 'Unknown formula variable: ' + name, { variable: name });
          return 0;
        }
        warn(options, 'Unexpected formula token: ' + this.peek(), { formula: this.source, at: this.index });
        this.take();
        return 0;
      }
    };
  }

  function getSkillRuleEngineKeys() {
    return [
      'targetMode', 'hitCount', 'damageFormula', 'shieldFormula', 'selfDamage',
      'applyEffects', 'efficiencyBonus', 'requireCondition', 'onUse', 'onDamaged',
      'onBlock', 'onCorrect', 'onWrong', 'onTurnStart', 'onTurnEnd', 'cooldownModify',
      'actionPointModify', 'failPenalty', 'tagBonus', 'scaleByEfficiency', 'randomMin',
      'randomMax', 'extraDamageFormula', 'healFormula', 'healFromDamageFormula',
      'healFromDamagePercentFormula', 'copyTargetShield', 'copyTargetBuffs',
      'conditionalDamage', 'removeDebuffs', 'consumeEffect', 'actions',
      'onHit', 'onCritical', 'onMiss', 'onEvade', 'onKill', 'onEffectRemoved', 'onDamage', 'onBeforeMonsterTurn', 'onExplosion', 'combat'
    ];
  }

  function getSupportedSkillRuleKeys() {
    return getSkillRuleEngineKeys().concat(['effectId', 'chance', 'criticalBonus']);
  }

  function shouldUseSkillRuleEngine(rule) {
    if (!rule || typeof rule !== 'object' || Array.isArray(rule)) return false;
    return getSkillRuleEngineKeys().some(function(key) {
      return Object.prototype.hasOwnProperty.call(rule, key);
    });
  }

  function validateKeys(value, supportedKeys, label, options) {
    if (!value || typeof value !== 'object' || Array.isArray(value)) return;
    Object.keys(value).forEach(function(key) {
      if (supportedKeys.indexOf(key) === -1) {
        warn(options, 'Unsupported ' + label + ' key: ' + key, { key: key });
      }
    });
  }

  function validateSkillRule(rule, options) {
    validateKeys(rule, getSupportedSkillRuleKeys(), 'effectJson', options);
    validateKeys(rule && rule.criticalBonus, ['damageMultiplier', 'force', 'targetEffects', 'applyEffects'], 'criticalBonus', options);
    validateKeys(rule && rule.conditionalDamage, ['targetHpBelowPercent', 'damageMultiplierFormula'], 'conditionalDamage', options);
    validateKeys(rule && rule.consumeEffect, ['effectId', 'minValue', 'healPerValue'], 'consumeEffect', options);
    validateKeys(rule && rule.efficiencyBonus, ['threshold', 'damageMultiplier', 'damageAdd', 'shieldMultiplier', 'shieldAdd', 'healMultiplier', 'healAdd', 'applyEffects'], 'efficiencyBonus', options);
    validateKeys(rule && rule.actionPointModify, ['currentActionPointAdd', 'currentActionPointSub', 'maxActionPointAdd', 'maxActionPointSub', 'nextTurnActionPointAdd', 'nextTurnActionPointSub'], 'actionPointModify', options);
    validateKeys(rule && rule.failPenalty, ['loseBattleOnWrongAnswer', 'loseBattleOnDamageTaken', 'selfDamageOnUse', 'increaseQuestionDifficulty', 'reduceActionPoint'], 'failPenalty', options);
    validateKeys(rule && rule.requireCondition, ['afterTurn', 'perStageLimit', 'perBattleLimit', 'requireShield', 'requireEnemyShield', 'requireTag', 'requireEfficiencyAtLeast', 'requireHpBelowPercent', 'requireHpAbovePercent', 'oncePerBattle', 'notUpgradable', 'targetEffects'], 'requireCondition', options);
    validateCombatActions(rule && rule.actions);
    ['onHit','onCritical','onMiss','onEvade','onKill','onEffectRemoved','onDamage','onExplosion','onBeforeMonsterTurn'].forEach(function(key) {
      if (!rule || !rule[key]) return;
      validateCombatActions(rule[key].actions);
      ['maxActivations','maxActivationsPerTurn'].forEach(function(limit) {
        if (rule[key][limit] !== undefined && (!Number.isInteger(Number(rule[key][limit])) || Number(rule[key][limit]) < 1)) throw new Error('Invalid trigger limit: '+limit);
      });
      ['oncePerTarget','oncePerAction'].forEach(function(flag){if(rule[key][flag]!==undefined && typeof rule[key][flag]!=='boolean')throw new Error('Invalid trigger boolean: '+flag);});
    });
    if(rule && rule.combat){
      validateCombatActions(rule.combat.onEachHit);
      var random=rule.combat.random;
      if(random){
        if([1,2].indexOf(Number(random.dice || 1))<0 || !Number.isInteger(Number(random.sides)) || Number(random.sides)<2 || Number(random.sides)>20)throw new Error('Invalid combat dice configuration');
        if(random.multipliers && (!Array.isArray(random.multipliers)||random.multipliers.length!==Number(random.sides)||random.multipliers.some(function(v){return !Number.isFinite(Number(v)) || Number(v)<0;})))throw new Error('Invalid combat random multipliers');
      }
    }
  }

  function getAliveMonsters(battle) {
    return (battle && battle.monsters || []).filter(function(monster) {
      return Number(monster && monster.currentHp || 0) > 0;
    });
  }

  function findMonsterById(battle, targetId) {
    var id = String(targetId || '');
    return getAliveMonsters(battle).filter(function(monster) {
      return String(monster.instanceId || monster.monsterId || '') === id;
    })[0] || null;
  }

  function selectRuleTargets(battle, skill, rule, targetId, options) {
    var mode = normalizeTargetMode(rule.targetMode || (skill && skill.target === 'self' ? 'self' : 'singleEnemy'));
    if (mode === 'self') return [battle.player];
    if (mode === 'allEnemies') return getAliveMonsters(battle);
    if (mode === 'enemyWithShield') {
      return getAliveMonsters(battle).filter(function(monster) {
        return Number(monster.shield || 0) > 0;
      }).slice(0, 1);
    }
    if (mode === 'randomEnemy' || mode === 'randomEnemies') {
      var alive = getAliveMonsters(battle);
      if (!alive.length) return [];
      return [alive[randomInt(0, alive.length - 1, options && options.random)]];
    }
    if (mode !== 'singleEnemy') {
      warn(options, 'Unsupported targetMode: ' + mode, { targetMode: mode });
    }
    return [findMonsterById(battle, targetId) || getAliveMonsters(battle)[0]].filter(Boolean);
  }

  function applyRuleCopyActions(battle, skill, rule, targets) {
    if (!battle || !battle.player || !rule || !targets || !targets.length) return;
    var source = targets.filter(function(target) {
      return target && target.currentHp !== undefined;
    })[0];
    if (!source) return;
    var skillId = skill && skill.skillId || '';
    var skillName = skill && skill.name || '스킬';
    var copyShield = isTruthy(rule.copyTargetShield);
    var copyBuffs = isTruthy(rule.copyTargetBuffs);

    if (copyShield) {
      var copiedShield = Math.max(0, Math.round(Number(source.shield || 0)));
      if (copiedShield > 0) {
        battle.player.shield = Number(battle.player.shield || 0) + copiedShield;
        battle.lastTurnEvents.push({
          actor: 'player',
          type: 'guard',
          skillId: skillId,
          shield: copiedShield,
          message: skillName + '으로 적의 방어막 ' + copiedShield + '을 흉내냈습니다.'
        });
      }
    }

    if (copyBuffs) {
      var sourceBuffs = (source.effects || []).filter(function(effect) {
        return getEffectCategory(effect, '') === 'buff';
      });
      if (!sourceBuffs.length) {
        sourceBuffs = source.buffs || [];
      }
      sourceBuffs.forEach(function(sourceEffect) {
        if (!sourceEffect || !sourceEffect.effectId) return;
        var copiedEffect = applyEffect(
          battle.player,
          Object.assign({}, sourceEffect),
          { source: 'skillCopy', skillId: skillId },
          battle.turn
        );
        if (copiedEffect) {
          battle.lastTurnEvents.push({
            actor: 'player',
            type: 'buff',
            skillId: skillId,
            statusSnapshot: { effects: JSON.parse(JSON.stringify(battle.player.effects || [])) },
            message: skillName + '으로 ' + (copiedEffect.name || copiedEffect.effectId) + ' 버프를 흉내냈습니다.'
          });
        }
      });
    }
  }

  function normalizeTargetMode(mode) {
    var value = String(mode || '').trim().toLowerCase().replace(/[_-]/g, '');
    if (value === 'self') return 'self';
    if (value === 'allenemies' || value === 'enemies') return 'allEnemies';
    if (value === 'randomenemy') return 'randomEnemy';
    if (value === 'randomenemies') return 'randomEnemies';
    if (value === 'enemywithshield') return 'enemyWithShield';
    return value === 'singleenemy' || value === 'enemy' ? 'singleEnemy' : String(mode || 'singleEnemy');
  }

  function getMonsterRuntimeId(monster) {
    return String(monster && (monster.instanceId || monster.monsterId) || '');
  }

  function selectRandomAliveEnemyAvoiding(battle, usedTargetIds, options) {
    var alive = getAliveMonsters(battle);
    if (!alive.length) return null;
    var unused = alive.filter(function(monster) {
      var id = getMonsterRuntimeId(monster);
      return !id || !usedTargetIds[id];
    });
    var pool = unused.length ? unused : alive;
    var picked = pool[randomInt(0, pool.length - 1, options && options.random)];
    var pickedId = getMonsterRuntimeId(picked);
    if (pickedId) usedTargetIds[pickedId] = true;
    return picked;
  }

  function applyActionPointModify(player, apRule, context, options) {
    if (!player || !apRule) return;
    validateKeys(apRule, ['currentActionPointAdd', 'currentActionPointSub', 'maxActionPointAdd', 'maxActionPointSub', 'nextTurnActionPointAdd', 'nextTurnActionPointSub'], 'actionPointModify', options);
    [
      ['currentActionPointAdd', 'currentActionPoint', 1],
      ['currentActionPointSub', 'currentActionPoint', -1],
      ['maxActionPointAdd', 'maxActionPoint', 1],
      ['maxActionPointSub', 'maxActionPoint', -1],
      ['nextTurnActionPointAdd', 'nextTurnActionPointBonus', 1],
      ['nextTurnActionPointSub', 'nextTurnActionPointBonus', -1]
    ].forEach(function(config) {
      if (apRule[config[0]] === undefined) return;
      player[config[1]] = Number(player[config[1]] || 0) + (evaluateFormula(apRule[config[0]], context, options) * config[2]);
    });
    player.maxActionPoint = Math.max(1, Number(player.maxActionPoint || 1));
    player.currentActionPoint = Math.max(0, Math.min(player.maxActionPoint, Number(player.currentActionPoint || 0)));
  }

  function dealDamageToMonster(monster, amount, battle, context) {
    var incoming = Math.max(0, Math.round(Number(amount || 0)));
    var shieldBefore = Math.max(0, Number(monster.shield || 0));
    var modifiers = battle && battle.player && battle.player.itemModifiers || {};
    // Extra damage is consumed by shields only; it never spills into HP.
    var shieldDamage = context && context.bypassShield ? 0 : Math.min(shieldBefore, Math.max(0, Math.round(incoming * (1 + Number(modifiers.shieldDamagePercent || 0) / 100))));
    var hpDamage = Math.min(Math.max(0, Number(monster.currentHp || 0)), Math.max(0, incoming - (context && context.bypassShield ? 0 : shieldBefore)));
    monster.shield = Math.max(0, Number(monster.shield || 0) - shieldDamage);
    spendRetainedShield(monster, shieldDamage, shieldBefore);
    monster.currentHp = Math.max(0, Number(monster.currentHp || 0) - hpDamage);
    monster.hp = monster.currentHp;
    if (shieldBefore > 0 && monster.shield === 0 && battle && battle.player && canGainShield(battle.player)) {
      battle.player.shield = Number(battle.player.shield || 0) + Math.max(0, Number(modifiers.shieldBreakShield || 0));
    }
    return { damage: shieldDamage + hpDamage, displayDamage: incoming, shieldDamage: shieldDamage, hpDamage: hpDamage };
  }

  // These records are JSON-only so signed checkpoints and the browser share them.
  function readCombatBehavior(value) {
    var behavior = safeJsonParse(value, {});
    if (!behavior || typeof behavior !== 'object' || Array.isArray(behavior)) throw new Error('Invalid effect behaviorJson');
    // New options travel inside an existing container so older deployments can
    // still load the sheet. Expand them only in engines that implement them.
    var extensions = behavior.combat && behavior.combat.additional && behavior.combat.additional.extensions;
    if (extensions) {
      if (typeof extensions !== 'object' || Array.isArray(extensions)) throw new Error('Invalid combat extensions');
      behavior = Object.assign({},behavior,{combat:Object.assign({},behavior.combat)});
      Object.keys(extensions).forEach(function(key) {
        if (['skillCost','consumeOnQuestion','capEfficiency'].indexOf(key)<0) throw new Error('Unsupported combat extension: '+key);
        behavior.combat[key] = extensions[key];
      });
    }
    Object.keys(behavior).forEach(function(key) {
      if (['control', 'invulnerable', 'hitDamage', 'retainShield', 'combat'].indexOf(key) < 0) throw new Error('Unsupported effect behavior: ' + key);
    });
    ['invulnerable','retainShield'].forEach(function(key) {
      if (behavior[key] !== undefined && typeof behavior[key] !== 'boolean') throw new Error('Invalid boolean behavior: '+key);
    });
    if(behavior.combat){
      if(typeof behavior.combat!=='object'||Array.isArray(behavior.combat))throw new Error('Invalid combat behavior');
      Object.keys(behavior.combat).forEach(function(key){if(['outgoing','incomingMultiplier','retaliationMultiplier','critical','criticalBank','random','fatalGuard','blockShield','dot','additional','relay','preserveDecayEffect','skillCost','consumeOnQuestion','capEfficiency'].indexOf(key)<0)throw new Error('Unsupported combat behavior: '+key);});
    }
    if (behavior.hitDamage) {
      if (typeof behavior.hitDamage !== 'object' || Array.isArray(behavior.hitDamage)) throw new Error('Invalid hitDamage behavior');
      Object.keys(behavior.hitDamage).forEach(function(key) {
        if (['damagePerStack','baseDamage','attackRatio','consumeStacks'].indexOf(key)<0) throw new Error('Unsupported hitDamage behavior: '+key);
        if (!Number.isFinite(Number(behavior.hitDamage[key])) || Number(behavior.hitDamage[key])<0) throw new Error('Invalid hitDamage value: '+key);
      });
    }
    // Keep the legacy hitDamage shape readable by older deployments during rollout.
    var additionalHit = behavior.combat && behavior.combat.additional && behavior.combat.additional.hitDamage;
    if (additionalHit !== undefined) readCombatBehavior({hitDamage:additionalHit});
    if (behavior.control) {
      var control = behavior.control;
      if (typeof control !== 'object' || Array.isArray(control)) throw new Error('Invalid control behavior');
      Object.keys(control).forEach(function(key) {
        if (['skipActions','breakOnDirectHit','stackEffectId','damagePerStack','blockImmediately','healMissingFromValue'].indexOf(key) < 0) throw new Error('Unsupported control behavior: '+key);
      });
      ['breakOnDirectHit','blockImmediately','healMissingFromValue'].forEach(function(key) {
        if (control[key] !== undefined && typeof control[key] !== 'boolean') throw new Error('Invalid control boolean: '+key);
      });
      if (control.skipActions !== undefined && (!Number.isInteger(Number(control.skipActions)) || Number(control.skipActions) < 1)) throw new Error('Invalid skipActions');
      if (control.damagePerStack !== undefined && (!Number.isFinite(Number(control.damagePerStack)) || Number(control.damagePerStack) < 0)) throw new Error('Invalid damagePerStack');
    }
    return behavior;
  }

  function effectStacks(target, effectId) {
    return (target && target.effects || []).reduce(function(sum, effect) {
      return sum + (effect.effectId === effectId ? Math.max(0, Math.floor(Number(effect.stacks || 0))) : 0);
    }, 0);
  }

  function setCombatEffects(target, effects) {
    target.effects = effects;
    // Never merge deleted effects back from the compatibility buckets.
    target.buffs = [];
    target.debuffs = [];
    syncStatusBuckets(target);
  }

  function removeCombatEffect(target, effectId, reason) {
    var removed = (target && target.effects || []).filter(function(e) { return e.effectId === effectId; });
    if (!target || !removed.length) return [];
    removed.forEach(function(effect) {
      if (effect.retainedShield) target.shield = Math.max(0, Number(target.shield || 0) - Number(effect.retainedShield || 0));
      var control = effect.behavior && effect.behavior.control;
      if (reason === 'natural' && control && control.healMissingFromValue && target.currentHp === undefined) {
        var maxHp = Number(target.maxHp || target.stats && target.stats.hp || 1);
        var rate = Math.max(0, Math.min(100, Number(effect.value || 0)));
        target.hp = Math.min(maxHp, Number(target.hp || 0) + Math.round(Math.max(0, maxHp - Number(target.hp || 0)) * rate / 100));
      }
    });
    setCombatEffects(target, target.effects.filter(function(e) { return e.effectId !== effectId; }));
    return removed;
  }

  function consumeEffectStacks(target, effectId, requested) {
    var amount = requested === undefined ? effectStacks(target, effectId) : Math.max(0, Math.floor(Number(requested) || 0));
    var consumed = 0;
    (target && target.effects || []).forEach(function(effect) {
      if (effect.effectId !== effectId) return;
      var count = Math.min(Math.max(0, Number(effect.stacks || 0)), Math.max(0, amount - consumed));
      effect.stacks -= count;
      if (effect.durationClock === 'stacks') effect.remainingTurns = effect.stacks;
      consumed += count;
    });
    if (target) setCombatEffects(target, (target.effects || []).filter(function(e) { return e.effectId !== effectId || Number(e.stacks) > 0; }));
    return consumed;
  }

  function transferEffectStacks(source, destination, effectId, requested, copy) {
    if (!source || !destination || source === destination) return 0;
    var effect = (source.effects || []).filter(function(e) { return e.effectId === effectId; })[0];
    if (!effect) return 0;
    var capacity = Math.max(0, Number(effect.maxStacks || 99) - effectStacks(destination, effectId));
    var moved = Math.min(capacity, effectStacks(source, effectId), Math.max(0, Math.floor(Number(requested) || 0)));
    if (!moved) return 0;
    var payload = JSON.parse(JSON.stringify(effect));
    payload.stacks = moved;
    if (!copy) consumeEffectStacks(source, effectId, moved);
    applyEffect(destination, payload, {source:effect.source, skillId:effect.skillId}, effect.appliedAtTurn);
    return moved;
  }

  function combatRuntime(battle) {
    if (!battle.combatRuntime) battle.combatRuntime = { version:1, sequence:0, actionSequence:0, history:[], killedTargets:{}, actors:{} };
    return battle.combatRuntime;
  }

  function actorKey(target, battle) {
    return target === battle.player ? 'player' : String(target && (target.instanceId || target.monsterId) || 'unknown');
  }

  function recordCombatEvent(battle, timing, payload) {
    var state = combatRuntime(battle), data = payload || {};
    var event = {
      id: ++state.sequence, timing:timing, turn:Number(battle.turn || 1),
      actionId:data.actionId || state.actionId || '', sourceSkillId:data.sourceSkillId || '',
      actor:data.actor || 'player', targetId:data.targetId || actorKey(data.target, battle),
      damageKind:data.damageKind || 'effect', isCritical:!!data.isCritical,
      damage:Number(data.damage || 0), hpDamage:Number(data.hpDamage || 0), shieldDamage:Number(data.shieldDamage || 0),
      effectId:data.effectId || '', reason:data.reason || ''
    };
    state.history.push(event);
    if (state.history.length > 64) state.history.shift();
    if (event.hpDamage > 0 && event.targetId === 'player') state.playerWasDamaged = true;
    return event;
  }

  function claimCombatTrigger(trigger, event) {
    var rule = trigger.rule || {};
    if (trigger.exhausted) return false;
    if (rule.damageKind && rule.damageKind !== event.damageKind) return false;
    if (rule.actor && rule.actor !== event.actor) return false;
    if (rule.targetId && rule.targetId !== event.targetId) return false;
    if (rule.oncePerAction && trigger.lastActionId === event.actionId && event.actionId) return false;
    if (trigger.activationTurn !== event.turn) { trigger.activationTurn = event.turn; trigger.activationsThisTurn = 0; trigger.targetsThisTurn = {}; }
    if (rule.maxActivationsPerTurn && Number(trigger.activationsThisTurn || 0) >= Number(rule.maxActivationsPerTurn)) return false;
    if (rule.oncePerTarget && trigger.targetsThisTurn[event.targetId]) return false;
    trigger.activations = Number(trigger.activations || 0) + 1;
    trigger.activationsThisTurn = Number(trigger.activationsThisTurn || 0) + 1;
    trigger.targetsThisTurn[event.targetId] = true;
    trigger.lastActionId = event.actionId;
    if (rule.maxActivations && trigger.activations >= Number(rule.maxActivations)) trigger.exhausted = true;
    return true;
  }

  function beginCombatAction(battle, skill) {
    var state = combatRuntime(battle);
    state.actionId = 'action:' + (++state.actionSequence);
    state.sourceSkillId = skill && skill.skillId || '';
    return state.actionId;
  }

  function beginActorTurn(battle, target) {
    var state = combatRuntime(battle), key = actorKey(target, battle);
    var token = String(battle.turn || 1) + ':' + key;
    if (state.actors[key] === token) return {blocked:hasActionBlock(target), removed:[]};
    state.actors[key] = token;
    var removed = [];
    (target.effects || []).slice().forEach(function(effect) {
      if (!effect.controlState) return;
      if (effect.controlState.remainingSkips > 0) {
        effect.controlState.remainingSkips -= 1;
        effect.controlState.skipped = true;
      } else {
        removed = removed.concat(removeCombatEffect(target, effect.effectId, 'natural'));
      }
    });
    if (hasActionBlock(target) && target === battle.player) target.currentActionPoint = 0;
    return {blocked:hasActionBlock(target), removed:removed};
  }

  function isCombatInvulnerable(target) {
    return (target && target.effects || []).some(function(e) { return e.behavior && e.behavior.invulnerable; });
  }

  function canGainShield(target) {
    return !(target && target.effects || []).some(function(e){return e.behavior && e.behavior.combat && e.behavior.combat.blockShield;});
  }

  function randomDamageRange(rule,context) {
    var random=rule && rule.combat && rule.combat.random;
    if(!random)return null;
    if([1,2].indexOf(Number(random.dice || 1))<0 || !Number.isInteger(Number(random.sides)) || Number(random.sides)<2 || Number(random.sides)>20)return null;
    var values=[],minimum=Infinity,maximum=0;
    function visit(){
      if(values.length<Number(random.dice || 1)){for(var i=1;i<=Number(random.sides);i++){values.push(i);visit();values.pop();}return;}
      var power=random.multipliers?Number(random.multipliers[values[0]-1]):values.reduce(function(a,b){return a+b;},0)*Number(random.attackPerPoint || 0);
      var damage=evaluateFormula(rule.damageFormula,Object.assign({},context,{randomPower:power}),{});
      if(values.length===2 && values[0]===values[1])damage*=Number(random.doublesMultiplier || 1);
      minimum=Math.min(minimum,damage);maximum=Math.max(maximum,damage);
    }
    visit();return {min:Math.max(0,Math.round(minimum)),max:Math.max(0,Math.round(maximum))};
  }

  function spendRetainedShield(target, spent, previousShield) {
    var retained = (target.effects || []).reduce(function(sum,e) { return sum + Number(e.retainedShield || 0); },0);
    var remaining = Math.max(0, spent - Math.max(0, previousShield - retained));
    (target.effects || []).forEach(function(effect) {
      var count = Math.min(Number(effect.retainedShield || 0), remaining);
      if (count > 0) effect.retainedShield -= count;
      remaining -= count;
    });
  }

  function clearCombatTurnShield(target) {
    target.shield = Math.min(Number(target.shield || 0), (target.effects || []).reduce(function(sum,e) { return sum + Number(e.retainedShield || 0); },0));
  }

  function directHitReactions(target, attacker) {
    var packets = [], removed = [];
    (target.effects || []).slice().forEach(function(effect) {
      var behavior = effect.behavior || {};
      var directRules=(effect.rules || []).filter(function(r){return r.operation==='directHitDamage' && r.triggerTiming==='onHit';});
      directRules.forEach(function(rule){
        var extra={attack:Math.max(0,getEffectiveStat(attacker,'attack'))};
        var consume=(effect.rules || []).filter(function(r){return r.operation==='consumeStacks' && r.triggerTiming==='onHit';}).reduce(function(sum,r){return sum+getEffectRuleValue(effect,r,target,extra);},0);
        packets.push({damageKind:'additional',effectId:effect.effectId,amount:getEffectRuleValue(effect,rule,target,extra),consumeStacks:consume,bypassShield:rule.shieldPolicy==='bypass'});
      });
      if (!directRules.length && behavior.hitDamage) {
        var hit = behavior.combat && behavior.combat.additional && behavior.combat.additional.hitDamage || behavior.hitDamage;
        packets.push({damageKind:'additional', effectId:effect.effectId,
          amount:Number(hit.baseDamage || 0)+Math.max(0,getEffectiveStat(attacker,'attack'))*Number(hit.attackRatio || 0)+effectStacks(target,effect.effectId)*Number(hit.damagePerStack || 0),
          consumeStacks:Number(hit.consumeStacks || 0)});
      }
      var control = behavior.control;
      if (control && control.breakOnDirectHit) {
        var amount = effectStacks(target,control.stackEffectId) * Math.max(0,Number(control.damagePerStack || 0));
        removed = removed.concat(removeCombatEffect(target,effect.effectId,'hit'));
        if (amount > 0) packets.push({damageKind:'shatter',effectId:effect.effectId,amount:amount});
      }
    });
    return {packets:packets, removed:removed};
  }

  function validateCombatActions(actions) {
    if (actions === undefined) return;
    if (!Array.isArray(actions)) throw new Error('actions must be an array');
    actions.forEach(function(action) {
      if (!action || ['damage','shield','heal','actionPoint','consumeStacks','moveStacks','copyStacks','removeEffect','applyEffect','storeCombo','resetCombo','cooldownSelect','cooldownAll','spreadStacks','gatherStacks','distributeStacks','cleanseLongest','counterAttack','breakControl','explosion','rewardBonus','clearShield'].indexOf(action.operation) < 0) throw new Error('Unsupported combat action');
      if (['consumeStacks','moveStacks','copyStacks','removeEffect','applyEffect'].indexOf(action.operation) >= 0 && !action.effectId) throw new Error('Combat action requires effectId');
      if (action.damageKind && ['direct','effect','dot','additional','shatter','explosion','reflect','counter'].indexOf(action.damageKind) < 0) throw new Error('Unsupported damageKind');
      if (action.target && ['self','allEnemies','secondary','enemy'].indexOf(action.target) < 0) throw new Error('Unsupported combat action target');
    });
  }

  function decayCombatStacks(target, timing, currentTurn) {
    (target.effects || []).slice().forEach(function(effect) {
      if (effect.durationClock !== 'stacks' || effect.decayTiming !== timing) return;
      if (Number(effect.appliedAtTurn) === Number(currentTurn)) return;
      var preserve=(target.effects || []).filter(function(e){var c=e.behavior && e.behavior.combat;return c && c.preserveDecayEffect===effect.effectId;})[0];
      if(preserve){removeCombatEffect(target,preserve.effectId,'consumed');return;}
      consumeEffectStacks(target,effect.effectId,Math.max(0,Number(effect.decayStacks || 0)));
    });
  }

  function applyTagBonus(value, battle, tagBonus) {
    if (!tagBonus) return value;
    var counts = battle && battle.usedSkillCountByTagThisBattle || {};
    var tag = tagBonus.tag || tagBonus.requireTag || 'strike';
    var next = Number(value || 0);
    if (tagBonus.damageMultiplier) next *= Number(tagBonus.damageMultiplier || 1);
    if (tagBonus.percent) next *= 1 + (Number(tagBonus.percent || 0) / 100);
    if (tagBonus.add) next += Number(tagBonus.add || 0);
    if (tagBonus.addPerUse) next += Number(tagBonus.addPerUse || 0) * Number(counts[tag] || counts.strike || 0);
    return next;
  }

  function calculateRuleDamage(battle, skill, rule, context, efficiency, options) {
    var damage = rule.damageFormula !== undefined && rule.damageFormula !== null && rule.damageFormula !== ''
      ? evaluateFormula(rule.damageFormula, context, options)
      : 0;
    if (rule.randomMin !== undefined || rule.randomMax !== undefined) {
      damage += randomInt(Number(rule.randomMin || 0), Number(rule.randomMax || rule.randomMin || 0), options && options.random);
    }
    if (rule.extraDamageFormula) damage += evaluateFormula(rule.extraDamageFormula, context, options);
    damage = applyTagBonus(damage, battle, rule.tagBonus);
    if (rule.conditionalDamage && Number(context.enemyMaxHp || 0) > 0 && Number(context.enemyHp || 0) / Number(context.enemyMaxHp) * 100 < Number(rule.conditionalDamage.targetHpBelowPercent || 0)) {
      damage *= Math.max(0, evaluateFormula(rule.conditionalDamage.damageMultiplierFormula, context, options));
    }
    if (rule.scaleByEfficiency !== false) damage *= Number(efficiency || 0);
    if (rule.efficiencyBonus && Number(efficiency || 0) >= Number(rule.efficiencyBonus.threshold || 0)) {
      damage *= Number(rule.efficiencyBonus.damageMultiplier || 1);
      damage += Number(rule.efficiencyBonus.damageAdd || 0);
    }
    return Math.max(0, Math.round(damage));
  }

  function resolveRuleEffect(effectRule, options) {
    if (!effectRule || !effectRule.effectId) {
      warn(options, 'applyEffects entry missing effectId.', { effectRule: effectRule });
      return null;
    }
    validateKeys(effectRule, ['target', 'effectId', 'value', 'valueFormula', 'durationType', 'durationTurns', 'stackable', 'maxStacks', 'stacks', 'stacksFormula', 'chance', 'requireEfficiencyAtLeast', 'requireCondition'], 'applyEffects', options);
    var effect = options && typeof options.effectResolver === 'function'
      ? options.effectResolver(effectRule.effectId, effectRule)
      : null;
    if (!effect) {
      warn(options, 'Effect not found: ' + effectRule.effectId, { effectId: effectRule.effectId });
      return null;
    }
    return Object.assign({}, effect);
  }

  function applyRuleEffects(battle, skill, rule, targets, context, options) {
    var effectRules = [];
    if (Array.isArray(rule.applyEffects)) effectRules = effectRules.concat(rule.applyEffects);
    if (rule.effectId) effectRules.push({ target: skill && skill.target === 'self' ? 'self' : 'enemy', effectId: rule.effectId, chance: rule.chance });
    effectRules.forEach(function(effectRule) {
      var requiredEfficiency = effectRule.requireEfficiencyAtLeast || (effectRule.requireCondition && effectRule.requireCondition.requireEfficiencyAtLeast);
      if (requiredEfficiency && Number(context.efficiency || 0) < Number(requiredEfficiency)) return;
      var chance = effectRule.chance === undefined ? 100 : Number(effectRule.chance || 0);
      var random = options && options.random || Math.random;
      if (random() * 100 > chance) return;
      var effect = resolveRuleEffect(effectRule, options);
      if (!effect) return;
      if (effectRule.value !== undefined) effect.value = Number(effectRule.value || 0);
      if (effectRule.valueFormula) effect.value = evaluateFormula(effectRule.valueFormula, context, options);
      if (effectRule.durationType) effect.durationType = effectRule.durationType;
      if (effectRule.durationTurns !== undefined) effect.durationTurns = Number(effectRule.durationTurns || 0);
      if (effectRule.stackable !== undefined) effect.stackable = effectRule.stackable;
      if (effectRule.maxStacks !== undefined) effect.maxStacks = Number(effectRule.maxStacks || 1);
      if (effectRule.stacks !== undefined) effect.stacks = Number(effectRule.stacks || 1);
      if (effectRule.stacksFormula !== undefined) effect.stacks = Math.max(1, Math.round(evaluateFormula(effectRule.stacksFormula, context, options)));
      var effectTargets = effectRule.target === 'self' ? [battle.player] : (effectRule.target === 'allEnemies' ? getAliveMonsters(battle) : targets);
      effectTargets.filter(Boolean).forEach(function(target) {
        var applied = applyEffect(target, effect, { source: effectRule.target || 'rule', skillId: skill && skill.skillId || '' }, battle.turn);
        var type = String(applied && applied.category || '').toLowerCase() === 'debuff' ? 'debuff' : 'buff';
        battle.lastTurnEvents.push({
          actor: 'player',
          type: type,
          skillId: skill && skill.skillId || '',
          statusSnapshot: { effects: JSON.parse(JSON.stringify(target.effects || [])) },
          targetMonsterId: target && target.currentHp !== undefined ? (target.instanceId || target.monsterId || '') : '',
          message: (skill && skill.name || '스킬') + ' 효과가 발동했습니다.'
        });
      });
    });
  }

  function trackSkillTags(battle, skill) {
    var tags = Array.isArray(skill && skill.tags) ? skill.tags : String(skill && skill.tags || '').split(',');
    battle.usedSkillTagsThisBattle = battle.usedSkillTagsThisBattle || [];
    battle.usedSkillTagsThisTurn = battle.usedSkillTagsThisTurn || [];
    battle.usedSkillCountByTagThisBattle = battle.usedSkillCountByTagThisBattle || {};
    battle.usedSkillCountByTagThisTurn = battle.usedSkillCountByTagThisTurn || {};
    tags.map(function(tag) { return String(tag || '').trim(); }).filter(Boolean).forEach(function(tag) {
      if (battle.usedSkillTagsThisBattle.indexOf(tag) === -1) battle.usedSkillTagsThisBattle.push(tag);
      if (battle.usedSkillTagsThisTurn.indexOf(tag) === -1) battle.usedSkillTagsThisTurn.push(tag);
      battle.usedSkillCountByTagThisBattle[tag] = Number(battle.usedSkillCountByTagThisBattle[tag] || 0) + 1;
      battle.usedSkillCountByTagThisTurn[tag] = Number(battle.usedSkillCountByTagThisTurn[tag] || 0) + 1;
    });
  }

  function executeSkillRuleAction(args) {
    args = args || {};
    var battle = args.battle || {};
    var skill = args.skill || {};
    var rule = args.rule || {};
    var efficiency = Number(args.efficiency || 0);
    var options = { random: args.random || Math.random, warn: args.warn, effectResolver: args.effectResolver };
    if (!shouldUseSkillRuleEngine(rule)) return false;
    validateSkillRule(rule, options);
    battle.lastTurnEvents = battle.lastTurnEvents || [];
    if (rule.requireCondition && rule.requireCondition.requireEfficiencyAtLeast && efficiency < Number(rule.requireCondition.requireEfficiencyAtLeast)) {
      battle.lastTurnEvents.push({ actor: 'player', type: 'skill', skillId: skill.skillId || '', message: (skill.name || '스킬') + ' 사용 조건을 만족하지 못했습니다.' });
      return true;
    }
    var context = buildFormulaContext(battle, skill, null, efficiency);
    applyActionPointModify(battle.player, rule.actionPointModify, context, options);
    var targets = selectRuleTargets(battle, skill, rule, args.targetId || '', options);
    var hitCount = Math.max(1, Math.round(rule.hitCount !== undefined ? evaluateFormula(rule.hitCount, context, options) : Number(skill.hitCount || 1)));
    var normalizedTargetMode = normalizeTargetMode(rule.targetMode || (skill && skill.target === 'self' ? 'self' : 'singleEnemy'));
    if (normalizedTargetMode === 'randomEnemies') {
      targets = [];
      var usedRandomTargetIds = {};
      for (var randomHit = 0; randomHit < hitCount; randomHit += 1) {
        var randomTarget = selectRandomAliveEnemyAvoiding(battle, usedRandomTargetIds, options);
        if (randomTarget) targets.push(randomTarget);
      }
    }
    applyRuleCopyActions(battle, skill, rule, targets);
    if (rule.shieldFormula !== undefined && rule.shieldFormula !== null && rule.shieldFormula !== '') {
      var shield = evaluateFormula(rule.shieldFormula, context, options);
      if (rule.scaleByEfficiency !== false) shield *= efficiency;
      if (rule.efficiencyBonus && efficiency >= Number(rule.efficiencyBonus.threshold || 0)) {
        shield *= Number(rule.efficiencyBonus.shieldMultiplier || 1);
        shield += Number(rule.efficiencyBonus.shieldAdd || 0);
      }
      shield = Math.max(0, Math.round(shield));
      battle.player.shield = Number(battle.player.shield || 0) + shield;
      battle.lastTurnEvents.push({ actor: 'player', type: 'guard', skillId: skill.skillId || '', shield: shield, message: (skill.name || '스킬') + '으로 방어막 ' + shield + '을 얻었습니다.' });
    }
    if (rule.healFormula !== undefined && rule.healFormula !== null && rule.healFormula !== '') {
      var heal = evaluateFormula(rule.healFormula, context, options);
      if (rule.scaleByEfficiency !== false) heal *= efficiency;
      if (rule.efficiencyBonus && efficiency >= Number(rule.efficiencyBonus.threshold || 0)) {
        heal *= Number(rule.efficiencyBonus.healMultiplier || 1);
        heal += Number(rule.efficiencyBonus.healAdd || 0);
      }
      heal = Math.max(0, Math.round(heal));
      battle.player.hp = Math.min(Number(battle.player.maxHp || battle.player.stats && battle.player.stats.hp || 1), Number(battle.player.hp || 0) + heal);
      battle.lastTurnEvents.push({ actor: 'player', type: 'heal', skillId: skill.skillId || '', heal: heal, message: (skill.name || '스킬') + '으로 체력을 ' + heal + ' 회복했습니다.' });
    }
    var totalDamageDealt = 0;
    targets.forEach(function(target) {
      var perTargetHits = normalizedTargetMode === 'randomEnemies' ? 1 : rule.hitCount === undefined ? hitCount : Math.max(0, Math.round(evaluateFormula(rule.hitCount, buildFormulaContext(battle,skill,target,efficiency), options)));
      for (var i = 0; i < perTargetHits; i += 1) {
        var targetContext = buildFormulaContext(battle, skill, target, efficiency);
        var simultaneousGroupId = normalizedTargetMode === 'allEnemies'
          ? (skill.skillId || 'skill') + ':allEnemies:' + i
          : ((hitCount > 1 || normalizedTargetMode === 'randomEnemies') ? (skill.skillId || 'skill') + ':multiHit' : '');
        var damage = calculateRuleDamage(battle, skill, rule, targetContext, efficiency, options);
        if (damage <= 0 || !target) continue;
        var hitResult = typeof args.hitResolver === 'function'
          ? args.hitResolver({ attacker: battle.player, target: target, skill: skill, hitIndex: i, hitCount: hitCount })
          : { hit: true, chance: 100 };
        if (hitResult && hitResult.hit === false) {
          battle.lastTurnEvents.push({
            actor: 'player',
            type: 'skill',
            skillId: skill.skillId || '',
            targetMonsterId: target && (target.instanceId || target.monsterId) || '',
            damage: 0,
            shieldDamage: 0,
            hpDamage: 0,
            missed: true,
            hitChance: Number(hitResult.chance || 0),
            hitIndex: i + 1,
            hitCount: hitCount,
            simultaneousGroupId: simultaneousGroupId,
            message: (skill.name || '스킬') + ' 공격이 빗나갔습니다.'
          });
          continue;
        }
        if (typeof args.damageModifier === 'function') {
          damage = args.damageModifier(damage, { actionType: 'skill', skill: skill, target: target });
        }
        if (damage <= 0) continue;
        var result = dealDamageToMonster(target, damage, battle);
        totalDamageDealt += Number(result.damage || 0);
        battle.lastTurnEvents.push({
          actor: 'player',
          type: 'skill',
          skillId: skill.skillId || '',
          targetMonsterId: target.instanceId || target.monsterId || '',
          damage: result.damage,
          displayDamage: result.displayDamage,
          shieldDamage: result.shieldDamage,
          hpDamage: result.hpDamage,
          hitIndex: i + 1,
          hitCount: hitCount,
          simultaneousGroupId: simultaneousGroupId,
          message: (skill.name || '스킬') + '으로 ' + result.displayDamage + ' 피해를 주었습니다.'
        });
      }
    });
    var hasDamageHealFormula = rule.healFromDamageFormula !== undefined && rule.healFromDamageFormula !== null && rule.healFromDamageFormula !== '';
    var hasDamageHealPercentFormula = rule.healFromDamagePercentFormula !== undefined && rule.healFromDamagePercentFormula !== null && rule.healFromDamagePercentFormula !== '';
    if (hasDamageHealFormula || hasDamageHealPercentFormula) {
      var damageHealContext = Object.assign({}, context, {
        damageDealt: totalDamageDealt,
        totalDamageDealt: totalDamageDealt
      });
      // damageDealt already includes efficiency and outgoing damage modifiers.
      var damageHeal = hasDamageHealPercentFormula
        ? totalDamageDealt * evaluateFormula(rule.healFromDamagePercentFormula, damageHealContext, options) / 100
        : evaluateFormula(rule.healFromDamageFormula, damageHealContext, options);
      if (rule.efficiencyBonus && efficiency >= Number(rule.efficiencyBonus.threshold || 0)) {
        damageHeal *= Number(rule.efficiencyBonus.healMultiplier || 1);
        damageHeal += Number(rule.efficiencyBonus.healAdd || 0);
      }
      damageHeal = Math.max(0, Math.round(damageHeal));
      battle.player.hp = Math.min(Number(battle.player.maxHp || battle.player.stats && battle.player.stats.hp || 1), Number(battle.player.hp || 0) + damageHeal);
      battle.lastTurnEvents.push({ actor: 'player', type: 'heal', skillId: skill.skillId || '', heal: damageHeal, damageDealt: totalDamageDealt, message: (skill.name || '스킬') + '으로 체력을 ' + damageHeal + ' 회복했습니다.' });
    }
    applyRuleEffects(battle, skill, rule, targets, context, options);
    if (rule.efficiencyBonus && efficiency >= Number(rule.efficiencyBonus.threshold || 0) && Array.isArray(rule.efficiencyBonus.applyEffects)) {
      applyRuleEffects(battle, skill, { applyEffects: rule.efficiencyBonus.applyEffects }, targets, context, options);
    }
    if (rule.selfDamage || rule.failPenalty && rule.failPenalty.selfDamageOnUse) {
      var selfDamage = Number(rule.selfDamage || 0) + Number(rule.failPenalty && rule.failPenalty.selfDamageOnUse || 0);
      selfDamage = Math.max(0, Math.round(evaluateFormula(selfDamage, context, options)));
      battle.player.hp = Math.max(0, Number(battle.player.hp || 0) - selfDamage);
      battle.lastTurnEvents.push({ actor: 'player', type: 'selfDamage', skillId: skill.skillId || '', damage: selfDamage, hpDamage: selfDamage, message: (skill.name || '스킬') + '의 반동으로 ' + selfDamage + ' 피해를 받았습니다.' });
      reviveAfterDamage(battle.player, battle);
    }
    trackSkillTags(battle, skill);
    if (!battle.lastTurnEvents.length) {
      battle.lastTurnEvents.push({ actor: 'player', type: skill.type || 'skill', skillId: skill.skillId || '', message: (skill.name || '스킬') + ' 효과가 발동했습니다.' });
    }
    return true;
  }

  function applyQuestionModifiers(questionView, effects) {
    if (!questionView || questionView.clientEffectsApplied) return questionView;
    var difficultyDelta = (effects || []).reduce(function(total, effect) {
      if (effect.rules) return total + getRuleStatBonus(effect, 'questionDifficulty', 'flat');
      return effect.statKey === 'questionDifficulty' && effect.effectType === 'flat'
        ? total + Number(effect.value || 0) * Math.max(1, Number(effect.stacks || 1))
        : total;
    }, 0);
    var timeDeltaSeconds = (effects || []).reduce(function(total, effect) {
      if (effect.rules) return total + getRuleStatBonus(effect, 'questionTime', 'flat');
      return (effect.statKey === 'questionTime' && effect.effectType === 'flat') || effect.statKey === 'caffeine'
        ? total + (effect.statKey === 'caffeine' ? Math.max(1, Number(effect.stacks || 1)) * 0.3 : Number(effect.value || 0) * Math.max(1, Number(effect.stacks || 1)))
        : total;
    }, 0);
    if (difficultyDelta) questionView.finalDifficulty = Math.max(1, Math.min(10, Math.round(Number(questionView.finalDifficulty || 1) + difficultyDelta)));
    if (timeDeltaSeconds) questionView.maxMs = Math.max(3000, Number(questionView.maxMs || 10000) + timeDeltaSeconds * 1000);
    questionView.clientEffectsApplied = true;
    return questionView;
  }

  function warn(options, message, data) {
    if (options && typeof options.warn === 'function') {
      options.warn(message, data || {});
    } else if (typeof console !== 'undefined' && console.warn) {
      console.warn('[RuleEngineWarning] ' + message, data || {});
    }
  }

  function consumeWrongProtection(battle, wrongCount) {
    if (!battle || Number(wrongCount || 0) <= 0 || !Number(battle.player && battle.player.itemModifiers && battle.player.itemModifiers.ignoreWrongPerStage || 0)) return 0;
    battle.itemTriggerState = battle.itemTriggerState || {};
    if (battle.itemTriggerState.wrongProtectionUsed) return 0;
    battle.itemTriggerState.wrongProtectionUsed = true;
    return 1;
  }
  function applyPerfectAnswerItems(battle, efficiency, gaveUp) {
    if (!battle || gaveUp || Number(efficiency) < 1) return;
    var effects = battle.player && battle.player.itemModifiers && battle.player.itemModifiers.perfectAnswerEffects || [];
    effects.forEach(function(effect) { applyEffect(battle.player, effect, { source: 'item' }, Number(battle.turn || 1)); });
  }
  function applyCriticalItemHealing(battle, critical, damage) {
    if (!battle || !critical || Number(damage || 0) <= 0) return 0;
    var player = battle.player || {};
    var percent = Number(player.itemModifiers && player.itemModifiers.criticalHealPercent || 0);
    var restored = Math.min(Math.max(0, Number(player.maxHp || player.stats && player.stats.hp || 1) - Number(player.hp || 0)), Math.max(0, Math.round(Number(damage) * percent / 100)));
    player.hp = Number(player.hp || 0) + restored;
    return restored;
  }

  function getQuestionSelectionPool(questions, usedQuestionIds, lastQuestionId) {
    var pool = questions || [];
    var previousId = String(lastQuestionId || '');
    if (!previousId) return pool;
    return pool.filter(function(question) {
      return String(question && question.questionId || '') !== previousId;
    });
  }

  function getQuestionAccuracyWeight(question) {
    var total = Math.max(0, Number(question && question.totalCount || 0));
    var correct = Math.max(0, Math.min(total, Number(question && question.correctCount || 0)));
    var rate = (correct + 5) / (total + 10);
    // One wrong answer from a clean slate raises weight by about 0.25.
    // A correct retry can reverse only one third of that adjustment.
    // Keep the configured weight range between 0.4 and 2.0.
    var accuracyWeight = Math.max(0.4, Math.min(2.0,
      1.2 + 5.5 * (0.5 - rate) + Number(question && question.selectionWeightOffset || 0)));
    var rating = Number(question && question.understandingRating || 0);
    var understandingWeights = [1, 3, 2.4, 1.6, 0.8, 0.2];
    var exposureCount = Math.max(0, Number(question && question.selectionExposureCount || 0));
    var exposureWeight = Math.max(0.1, Math.pow(0.9, exposureCount));
    return accuracyWeight * (Number.isInteger(rating) && rating >= 1 && rating <= 5 ? understandingWeights[rating] : 1) * exposureWeight;
  }

  return {
    reviveAfterDamage:reviveAfterDamage,
    effectStacks:effectStacks, consumeEffectStacks:consumeEffectStacks, transferEffectStacks:transferEffectStacks,
    removeCombatEffect:removeCombatEffect, readCombatBehavior:readCombatBehavior,
    combatRuntime:combatRuntime, beginCombatAction:beginCombatAction, recordCombatEvent:recordCombatEvent,
    claimCombatTrigger:claimCombatTrigger, beginActorTurn:beginActorTurn, isCombatInvulnerable:isCombatInvulnerable,
    spendRetainedShield:spendRetainedShield, clearCombatTurnShield:clearCombatTurnShield,
    directHitReactions:directHitReactions, validateCombatActions:validateCombatActions, canGainShield:canGainShield, randomDamageRange:randomDamageRange,
    decayCombatStacks:decayCombatStacks,
    migrateLegacyEffectDefinitions: migrateLegacyEffectDefinitions,
    compileEffectDefinitions: compileEffectDefinitions,
    getEffectRuleValue: getEffectRuleValue,
    getRuleStatBonus: getRuleStatBonus,
    hasActionBlock: hasActionBlock,
    getQuestionSelectionPool: getQuestionSelectionPool,
    getQuestionMaxEfficiencyMultiplier: getQuestionMaxEfficiencyMultiplier,
    getQuestionMinEfficiencyBonusPercent: getQuestionMinEfficiencyBonusPercent,
    getQuestionEfficiencyBonusPercent: getQuestionEfficiencyBonusPercent,
    getQuestionCappedEfficiencyBonusPercent:getQuestionCappedEfficiencyBonusPercent, capQuestionEfficiencyBonus:capQuestionEfficiencyBonus,
    consumeQuestionEffects: consumeQuestionEffects,
    isCooldownReductionSkill:isCooldownReductionSkill, getDiscountedSkillCost:getDiscountedSkillCost, consumeSkillCostEffects:consumeSkillCostEffects,
    getQuestionAccuracyWeight: getQuestionAccuracyWeight,
    dealDamageToMonster: dealDamageToMonster,
    consumeWrongProtection: consumeWrongProtection,
    applyPerfectAnswerItems: applyPerfectAnswerItems,
    applyCriticalItemHealing: applyCriticalItemHealing,
    TIMING: TIMING,
    safeJsonParse: safeJsonParse,
    isTruthy: isTruthy,
    randomInt: randomInt,
    applyEffect: applyEffect,
    syncStatusBuckets: syncStatusBuckets,
    getEffectiveStat: getEffectiveStat,
    calculateEffectiveStats: calculateEffectiveStats,
    hasEffect: hasEffect,
    applyTimedEffectDamage: applyTimedEffectDamage,
    decrementTurnEffects: decrementTurnEffects,
    buildFormulaContext: buildFormulaContext,
    evaluateFormula: evaluateFormula,
    getSkillRuleEngineKeys: getSkillRuleEngineKeys,
    getSupportedSkillRuleKeys: getSupportedSkillRuleKeys,
    shouldUseSkillRuleEngine: shouldUseSkillRuleEngine,
    validateSkillRule: validateSkillRule,
    executeSkillRuleAction: executeSkillRuleAction,
    applyQuestionModifiers: applyQuestionModifiers
  };
})();
`;
}
