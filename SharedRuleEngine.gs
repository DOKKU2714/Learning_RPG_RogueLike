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

  function normalizeEffectInstance(effect, sourceInfo, turn) {
    var payload = Object.assign({}, effect || {});
    payload.value = Number(payload.value || 0);
    payload.stackable = isTruthy(payload.stackable);
    payload.maxStacks = Math.max(1, Number(payload.maxStacks || 1));
    payload.stacks = Math.max(1, Number(payload.stacks || 1));
    payload.remainingTurns = payload.durationType === 'turn'
      ? Number(payload.durationTurns || payload.remainingTurns || 1)
      : '';
    payload.source = sourceInfo && sourceInfo.source || payload.source || '';
    payload.skillId = sourceInfo && sourceInfo.skillId || payload.skillId || '';
    payload.appliedAtTurn = Number(turn || payload.appliedAtTurn || 1);
    return payload;
  }

  function syncStatusBuckets(target) {
    if (!target) return target;
    target.effects = target.effects || [];
    target.buffs = target.effects.filter(function(effect) {
      return String(effect.category || '').toLowerCase() === 'buff';
    });
    target.debuffs = target.effects.filter(function(effect) {
      return String(effect.category || '').toLowerCase() === 'debuff';
    });
    return target;
  }

  function applyEffect(target, effectPayload, sourceInfo, turn) {
    if (!target || !effectPayload || !effectPayload.effectId) return null;
    var effect = normalizeEffectInstance(effectPayload, sourceInfo, turn);
    target.effects = target.effects || [];
    var existing = null;
    for (var i = 0; i < target.effects.length; i += 1) {
      if (target.effects[i].effectId === effect.effectId) {
        existing = target.effects[i];
        break;
      }
    }
    if (existing && effect.stackable) {
      existing.stacks = Math.min(Number(effect.maxStacks || 99), Math.max(1, Number(existing.stacks || 1)) + 1);
      if (effect.remainingTurns !== '') {
        existing.remainingTurns = Math.max(Number(existing.remainingTurns || 0), Number(effect.remainingTurns || 0));
      }
      syncStatusBuckets(target);
      return existing;
    }
    if (existing && !effect.stackable) {
      Object.keys(existing).forEach(function(key) { delete existing[key]; });
      Object.assign(existing, effect);
      syncStatusBuckets(target);
      return existing;
    }
    target.effects.push(effect);
    syncStatusBuckets(target);
    return effect;
  }

  function getEffectiveStat(target, statKey) {
    var baseValue = Number(target && target[statKey] !== undefined
      ? target[statKey]
      : target && target.stats && target.stats[statKey] !== undefined ? target.stats[statKey] : 0);
    return (target && target.effects || []).reduce(function(value, effect) {
      if (effect.statKey !== statKey) return value;
      if (effect.statKey === 'questionTime' || effect.statKey === 'questionDifficulty' || effect.statKey === 'action') return value;
      var effectValue = Number(effect.value || 0) * Math.max(1, Number(effect.stacks || 1));
      if (effect.effectType === 'percent') return value * (1 + (effectValue / 100));
      if (effect.effectType === 'flat') return value + effectValue;
      return value;
    }, baseValue);
  }

  function calculateEffectiveStats(baseStats, activeEffects) {
    var stats = Object.assign({}, baseStats || {});
    (activeEffects || []).forEach(function(effect) {
      if (!effect.statKey || effect.statKey === 'questionTime' || effect.statKey === 'questionDifficulty' || effect.statKey === 'action') return;
      stats[effect.statKey] = getEffectiveStat({ stats: stats, effects: [effect] }, effect.statKey);
    });
    return stats;
  }

  function hasEffect(target, effectId) {
    return (target && target.effects || []).some(function(effect) {
      return effect.effectId === effectId;
    });
  }

  function applyTimedEffectDamage(target, timing, battle, actor) {
    if (!target) return 0;
    var totalDamage = 0;
    (target.effects || []).forEach(function(effect) {
      if (effect.triggerTiming !== timing || effect.statKey !== 'hp' || effect.effectType !== 'flat' || Number(effect.value || 0) >= 0) return;
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
          targetMonsterId: actor === 'monster' ? (target.instanceId || target.monsterId || '') : '',
          damage: damage,
          hpDamage: damage,
          shieldDamage: 0,
          message: (effect.name || effect.effectId || '효과') + '로 ' + damage + ' 피해!'
        });
      }
    });
    return totalDamage;
  }

  function decrementTurnEffects(target) {
    if (!target) return target;
    target.effects = (target.effects || []).map(function(effect) {
      if (effect.durationType === 'turn') {
        effect.remainingTurns = Number(effect.remainingTurns || 0) - 1;
      }
      return effect;
    }).filter(function(effect) {
      return effect.durationType !== 'turn' || Number(effect.remainingTurns || 0) > 0;
    });
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
      damageUpgrade: Number(upgradeJson.damage || 0) * upgradeLevel,
      effectUpgrade: Number(upgradeJson.effect || 0) * upgradeLevel,
      buffValueUpgrade: Number(upgradeJson.buffValue || 0) * upgradeLevel,
      debuffChanceUpgrade: Number(upgradeJson.debuffChance || 0) * upgradeLevel,
      atk: getEffectiveStat(player, 'attack'),
      attack: getEffectiveStat(player, 'attack'),
      def: getEffectiveStat(player, 'defense'),
      defense: getEffectiveStat(player, 'defense'),
      hp: Number(player.hp || 0),
      maxHp: Number(player.maxHp || player.stats && player.stats.hp || 1),
      shield: Number(player.shield || 0),
      enemyHp: Number(target && target.currentHp || 0),
      enemyShield: Number(target && target.shield || 0),
      efficiency: Number(efficiency || 0),
      usedStrikeSkillCountThisBattle: Number(tagCounts.strike || tagCounts['타격'] || 0),
      usedStrikeSkillCountThisTurn: Number(turnTagCounts.strike || turnTagCounts['타격'] || 0)
    };
  }

  function evaluateFormula(formula, context, options) {
    var source = String(formula || '').replace(/\s+/g, '');
    if (!source) return 0;
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
      'randomMax', 'extraDamageFormula', 'healFormula'
    ];
  }

  function getSupportedSkillRuleKeys() {
    return getSkillRuleEngineKeys().concat(['effectId', 'chance']);
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
    validateKeys(rule && rule.efficiencyBonus, ['threshold', 'damageMultiplier', 'damageAdd', 'shieldMultiplier', 'shieldAdd', 'healMultiplier', 'healAdd', 'applyEffects'], 'efficiencyBonus', options);
    validateKeys(rule && rule.actionPointModify, ['currentActionPointAdd', 'currentActionPointSub', 'maxActionPointAdd', 'maxActionPointSub', 'nextTurnActionPointAdd', 'nextTurnActionPointSub'], 'actionPointModify', options);
    validateKeys(rule && rule.failPenalty, ['loseBattleOnWrongAnswer', 'loseBattleOnDamageTaken', 'selfDamageOnUse', 'increaseQuestionDifficulty', 'reduceActionPoint'], 'failPenalty', options);
    validateKeys(rule && rule.requireCondition, ['afterTurn', 'perStageLimit', 'perBattleLimit', 'requireShield', 'requireEnemyShield', 'requireTag', 'requireEfficiencyAtLeast', 'requireHpBelowPercent', 'requireHpAbovePercent', 'oncePerBattle', 'notUpgradable'], 'requireCondition', options);
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
    var mode = rule.targetMode || (skill && skill.target === 'self' ? 'self' : 'singleEnemy');
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

  function dealDamageToMonster(monster, amount) {
    var incoming = Math.max(0, Math.round(Number(amount || 0)));
    var shieldDamage = Math.min(Number(monster.shield || 0), incoming);
    var hpDamage = Math.max(0, incoming - shieldDamage);
    monster.shield = Math.max(0, Number(monster.shield || 0) - shieldDamage);
    monster.currentHp = Math.max(0, Number(monster.currentHp || 0) - hpDamage);
    monster.hp = monster.currentHp;
    return { damage: incoming, shieldDamage: shieldDamage, hpDamage: hpDamage };
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
    validateKeys(effectRule, ['target', 'effectId', 'value', 'valueFormula', 'durationType', 'durationTurns', 'stackable', 'maxStacks', 'chance', 'requireEfficiencyAtLeast', 'requireCondition'], 'applyEffects', options);
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
      var effectTargets = effectRule.target === 'self' ? [battle.player] : (effectRule.target === 'allEnemies' ? getAliveMonsters(battle) : targets);
      effectTargets.filter(Boolean).forEach(function(target) {
        var applied = applyEffect(target, effect, { source: effectRule.target || 'rule', skillId: skill && skill.skillId || '' }, battle.turn);
        var type = String(applied && applied.category || '').toLowerCase() === 'debuff' ? 'debuff' : 'buff';
        battle.lastTurnEvents.push({
          actor: 'player',
          type: type,
          skillId: skill && skill.skillId || '',
          targetMonsterId: target && target.currentHp !== undefined ? (target.instanceId || target.monsterId || '') : '',
          message: (skill && skill.name || 'Skill') + ' effect activated.'
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
      battle.lastTurnEvents.push({ actor: 'player', type: 'skill', skillId: skill.skillId || '', message: (skill.name || 'Skill') + ' failed efficiency condition.' });
      return true;
    }
    var context = buildFormulaContext(battle, skill, null, efficiency);
    applyActionPointModify(battle.player, rule.actionPointModify, context, options);
    var targets = selectRuleTargets(battle, skill, rule, args.targetId || '', options);
    var hitCount = Math.max(1, Math.round(rule.hitCount !== undefined ? evaluateFormula(rule.hitCount, context, options) : Number(skill.hitCount || 1)));
    if (rule.targetMode === 'randomEnemies') {
      targets = [];
      for (var randomHit = 0; randomHit < hitCount; randomHit += 1) {
        var randomTarget = selectRuleTargets(battle, skill, { targetMode: 'randomEnemy' }, '', options)[0];
        if (randomTarget) targets.push(randomTarget);
      }
    }
    if (rule.shieldFormula !== undefined && rule.shieldFormula !== null && rule.shieldFormula !== '') {
      var shield = evaluateFormula(rule.shieldFormula, context, options);
      if (rule.scaleByEfficiency !== false) shield *= efficiency;
      if (rule.efficiencyBonus && efficiency >= Number(rule.efficiencyBonus.threshold || 0)) {
        shield *= Number(rule.efficiencyBonus.shieldMultiplier || 1);
        shield += Number(rule.efficiencyBonus.shieldAdd || 0);
      }
      shield = Math.max(0, Math.round(shield));
      battle.player.shield = Number(battle.player.shield || 0) + shield;
      battle.lastTurnEvents.push({ actor: 'player', type: 'guard', skillId: skill.skillId || '', shield: shield, message: (skill.name || 'Skill') + ' gained shield ' + shield + '.' });
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
      battle.lastTurnEvents.push({ actor: 'player', type: 'heal', skillId: skill.skillId || '', heal: heal, message: (skill.name || 'Skill') + ' healed ' + heal + '.' });
    }
    targets.forEach(function(target) {
      var perTargetHits = rule.targetMode === 'randomEnemies' ? 1 : hitCount;
      for (var i = 0; i < perTargetHits; i += 1) {
        var targetContext = buildFormulaContext(battle, skill, target, efficiency);
        var damage = calculateRuleDamage(battle, skill, rule, targetContext, efficiency, options);
        if (damage <= 0 || !target) continue;
        var result = dealDamageToMonster(target, damage);
        battle.lastTurnEvents.push({
          actor: 'player',
          type: 'skill',
          skillId: skill.skillId || '',
          targetMonsterId: target.instanceId || target.monsterId || '',
          damage: result.damage,
          shieldDamage: result.shieldDamage,
          hpDamage: result.hpDamage,
          simultaneousGroupId: rule.targetMode === 'allEnemies' ? (skill.skillId || 'skill') + ':allEnemies:' + i : '',
          message: (skill.name || 'Skill') + ' dealt ' + result.damage + ' damage.'
        });
      }
    });
    applyRuleEffects(battle, skill, rule, targets, context, options);
    if (rule.efficiencyBonus && efficiency >= Number(rule.efficiencyBonus.threshold || 0) && Array.isArray(rule.efficiencyBonus.applyEffects)) {
      applyRuleEffects(battle, skill, { applyEffects: rule.efficiencyBonus.applyEffects }, targets, context, options);
    }
    if (rule.selfDamage || rule.failPenalty && rule.failPenalty.selfDamageOnUse) {
      var selfDamage = Number(rule.selfDamage || 0) + Number(rule.failPenalty && rule.failPenalty.selfDamageOnUse || 0);
      selfDamage = Math.max(0, Math.round(evaluateFormula(selfDamage, context, options)));
      battle.player.hp = Math.max(0, Number(battle.player.hp || 0) - selfDamage);
      battle.lastTurnEvents.push({ actor: 'player', type: 'selfDamage', skillId: skill.skillId || '', damage: selfDamage, hpDamage: selfDamage, message: (skill.name || 'Skill') + ' caused ' + selfDamage + ' self damage.' });
    }
    trackSkillTags(battle, skill);
    if (!battle.lastTurnEvents.length) {
      battle.lastTurnEvents.push({ actor: 'player', type: skill.type || 'skill', skillId: skill.skillId || '', message: (skill.name || 'Skill') + ' effect activated.' });
    }
    return true;
  }

  function applyQuestionModifiers(questionView, effects) {
    if (!questionView || questionView.clientEffectsApplied) return questionView;
    var difficultyDelta = (effects || []).reduce(function(total, effect) {
      return effect.statKey === 'questionDifficulty' && effect.effectType === 'flat'
        ? total + Number(effect.value || 0) * Math.max(1, Number(effect.stacks || 1))
        : total;
    }, 0);
    var timeDeltaSeconds = (effects || []).reduce(function(total, effect) {
      return effect.statKey === 'questionTime' && effect.effectType === 'flat'
        ? total + Number(effect.value || 0) * Math.max(1, Number(effect.stacks || 1))
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

  return {
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
