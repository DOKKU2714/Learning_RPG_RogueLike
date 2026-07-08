function normalizeOwnedItems_(items) {
  var index = {};
  (Array.isArray(items) ? items : []).forEach(function(item) {
    var itemId = '';
    var count = 1;
    var acquiredAt = '';
    if (typeof item === 'string') {
      itemId = String(item || '').trim();
    } else if (item) {
      itemId = String(item.itemId || item.id || '').trim();
      count = Math.max(1, Number(item.count || 1));
      acquiredAt = item.acquiredAt || '';
    }
    if (!itemId) {
      return;
    }
    if (!index[itemId]) {
      index[itemId] = { itemId: itemId, count: 0, acquiredAt: acquiredAt || new Date().toISOString() };
    }
    index[itemId].count += count;
  });
  return Object.keys(index).map(function(itemId) {
    return index[itemId];
  });
}

function getItemRows_() {
  var rows = [];
  try {
    rows = readTableCached_(DB_SHEETS.ITEMS, 600);
  } catch (error) {
    rows = [];
  }
  var merged = {};
  MASTER_ITEMS.slice().concat(rows || []).map(normalizeItemRow_).forEach(function(item) {
    var itemId = item.itemId || item.id || '';
    if (!itemId) {
      return;
    }
    merged[itemId] = item;
  });
  return Object.keys(merged).map(function(itemId) {
    return merged[itemId];
  });
}

function normalizeItemRow_(row) {
  var source = row || {};
  var name = getFirstItemCell_(source, ['name', 'itemName', '아이템명', '이름']);
  var itemId = getFirstItemCell_(source, ['itemId', 'id', '아이템ID', '아이디']);
  if (!itemId && name) {
    itemId = getMasterItemIdByName_(name) || buildItemIdFromName_(name);
  }
  var rarity = getFirstItemCell_(source, ['rarity', '등급']) || RARITIES.COMMON;
  var description = getFirstItemCell_(source, ['description', 'flavor', 'flavorText', '플레이버/설명', '플레이버', '설명']);
  var effects = getItemEffectsFromRow_(source);
  return {
    itemId: itemId,
    id: itemId,
    name: name || source.name || itemId,
    type: getFirstItemCell_(source, ['type', '타입']) || 'passive',
    target: getFirstItemCell_(source, ['target', '대상']) || 'self',
    effectJson: safeJsonStringify_(effects),
    triggerTiming: getFirstItemCell_(source, ['triggerTiming', '발동타이밍']) || inferItemTriggerTiming_(effects),
    description: description || '',
    rarity: rarity,
  };
}

function getFirstItemCell_(row, keys) {
  for (var i = 0; i < keys.length; i += 1) {
    var key = keys[i];
    if (row[key] !== undefined && row[key] !== null && row[key] !== '') {
      return String(row[key]).trim();
    }
  }
  return '';
}

function getMasterItemIdByName_(name) {
  var match = MASTER_ITEMS.filter(function(item) {
    return String(item.name || '').trim() === String(name || '').trim();
  })[0];
  return match ? match.itemId : '';
}

function getItemEffectsFromRow_(row) {
  var effects = [];
  var raw = row.effects || row.effectJson || '';
  var parsed = safeJsonParse_(raw, []);
  if (parsed && !Array.isArray(parsed) && typeof parsed === 'object') {
    parsed = [parsed];
  }
  (Array.isArray(parsed) ? parsed : []).forEach(function(effect) {
    var normalized = normalizeStructuredItemEffect_(effect, '');
    if (normalized) {
      effects.push(normalized);
    }
  });

  ['effect1', 'effect2', 'effect3', 'effect4', 'effect5', 'effect 1', 'effect 2', 'effect 3', 'effect 4', 'effect 5', '효과 1', '효과 2', '효과 3', '효과 4', '효과 5', '효과1', '효과2', '효과3', '효과4', '효과5'].forEach(function(key) {
    var value = row[key];
    if (value === undefined || value === null || value === '') {
      return;
    }
    String(value).split(/\n+/).forEach(function(part) {
      var effect = parseItemEffectText_(part);
      if (effect && effect.type !== 'note') {
        effects.push(effect);
      }
    });
  });
  return effects;
}

function getItemById_(itemId) {
  var id = String(itemId || '').trim();
  if (!id) {
    return null;
  }
  return getItemRows_().filter(function(item) {
    return item.itemId === id || item.id === id;
  })[0] || null;
}

function getItemEffects_(item) {
  var raw = item && (item.effects || item.effectJson) || [];
  var parsed = safeJsonParse_(raw, []);
  if (!Array.isArray(parsed)) {
    parsed = parsed && typeof parsed === 'object' ? [parsed] : [];
  }
  return parsed.map(function(effect) {
    var normalized = Object.assign({}, effect || {});
    if (!normalized.type && normalized.statKey) {
      normalized.type = ITEM_EFFECT_TYPES.STAT;
    }
    return normalized;
  });
}

function buildItemIdFromName_(name) {
  return 'item_' + String(name || '').trim().replace(/\s+/g, '_').replace(/[^\w가-힣?]/g, '').toLowerCase();
}

function inferItemTriggerTiming_(effects) {
  if ((effects || []).some(function(effect) { return effect.type === ITEM_EFFECT_TYPES.BATTLE_START_EFFECT; })) {
    return 'battleStart';
  }
  if ((effects || []).some(function(effect) { return effect.type === ITEM_EFFECT_TYPES.SKILL_EXTRA_DAMAGE; })) {
    return 'onSkillUse';
  }
  return 'passive';
}

function parseItemEffectText_(text) {
  var value = String(text || '').trim();
  if (!value) {
    return null;
  }

  var structured = parseStructuredItemEffect_(value);
  if (structured) {
    return structured;
  }

  return parseLegacyItemEffectText_(value);
}

function parseStructuredItemEffect_(text) {
  var value = String(text || '').trim();
  if (!value) {
    return null;
  }

  var jsonParsed = parseItemEffectJsonCell_(value);
  if (jsonParsed) {
    return jsonParsed;
  }

  var keyValueParsed = parseItemEffectKeyValueCell_(value);
  if (keyValueParsed) {
    return keyValueParsed;
  }

  var compactParsed = parseItemEffectCompactCell_(value);
  if (compactParsed) {
    return compactParsed;
  }

  return null;
}

function parseItemEffectJsonCell_(text) {
  var trimmed = String(text || '').trim();
  if (!/^[{\[]/.test(trimmed)) {
    return null;
  }
  var parsed = safeJsonParse_(trimmed, null);
  if (!parsed) {
    return null;
  }
  if (Array.isArray(parsed)) {
    parsed = parsed[0];
  }
  return normalizeStructuredItemEffect_(parsed, trimmed);
}

function parseItemEffectKeyValueCell_(text) {
  var normalized = String(text || '').trim();
  if (normalized.indexOf('=') === -1) {
    return null;
  }
  var pairs = {};
  normalized.split(/[;\n]/).forEach(function(part) {
    var chunk = String(part || '').trim();
    if (!chunk) {
      return;
    }
    var index = chunk.indexOf('=');
    if (index === -1) {
      return;
    }
    var key = normalizeItemEffectKey_(chunk.slice(0, index));
    var value = chunk.slice(index + 1).trim();
    if (key) {
      pairs[key] = value;
    }
  });
  return normalizeStructuredItemEffect_(pairs, normalized);
}

function parseItemEffectCompactCell_(text) {
  var parts = String(text || '').split('|').map(function(part) {
    return part.trim();
  }).filter(Boolean);
  if (parts.length < 2) {
    return null;
  }

  var type = normalizeItemEffectTypeAlias_(parts[0]);
  if (!type) {
    return null;
  }

  var effect = { type: type };
  if (type === ITEM_EFFECT_TYPES.STAT) {
    effect.statKey = normalizeItemStatKeyAlias_(parts[1]);
    effect.effectType = normalizeItemEffectModeAlias_(parts[2] || EFFECT_TYPES.FLAT);
    effect.value = parseSignedNumber_(parts[3]);
  } else if (type === ITEM_EFFECT_TYPES.SKILL_EXTRA_DAMAGE) {
    effect.skillId = parts[1] || '';
    effect.value = parseSignedNumber_(parts[2]);
    effect.skillTag = parts[3] || '';
    effect.skillName = parts[4] || '';
  } else if (type === ITEM_EFFECT_TYPES.BATTLE_START_EFFECT) {
    effect.effectId = parts[1] || '';
    effect.stacks = Math.max(1, Number(parts[2] || 1));
    effect.value = 0;
  } else if (type === ITEM_EFFECT_TYPES.QUESTION_TIME) {
    effect.questionType = parts.length > 2 ? normalizeQuestionTypeAlias_(parts[1] || 'all') : inferItemEffectQuestionType_({ type: parts[0] }) || 'all';
    effect.value = parseSignedNumber_(parts.length > 2 ? parts[2] : parts[1]);
  } else if (type === ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT || type === ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT) {
    effect.questionType = parts.length > 2 ? normalizeQuestionTypeAlias_(parts[1] || 'all') : inferItemEffectQuestionType_({ type: parts[0] }) || 'all';
    effect.value = parseSignedNumber_(parts.length > 2 ? parts[2] : parts[1]);
  } else {
    effect.value = parseSignedNumber_(parts[1]);
  }
  if (parts.length > 5) {
    effect.summary = parts.slice(5).join('|');
  }
  return normalizeStructuredItemEffect_(effect, text);
}

function normalizeStructuredItemEffect_(effect, originalText) {
  if (!effect || typeof effect !== 'object') {
    return null;
  }

  var type = normalizeItemEffectTypeAlias_(effect.type || effect.effectType || effect.kind);
  if (!type) {
    return null;
  }

  var normalized = {
    type: type,
    value: parseSignedNumber_(effect.value !== undefined && effect.value !== '' ? effect.value : 0),
  };
  var summary = effect.summary || effect.label || effect.text || effect.display || '';

  if (type === ITEM_EFFECT_TYPES.STAT) {
    normalized.statKey = normalizeItemStatKeyAlias_(effect.statKey || effect.stat || effect.target || effect.key);
    normalized.effectType = normalizeItemEffectModeAlias_(effect.mode || effect.effectMode || effect.calc || effect.operation || effect.statMode || effect.effectType);
    if (!normalized.statKey) {
      return null;
    }
  } else if (type === ITEM_EFFECT_TYPES.SKILL_EXTRA_DAMAGE) {
    normalized.skillId = String(effect.skillId || effect.skill || effect.targetSkill || '').trim();
    normalized.skillName = String(effect.skillName || effect.name || '').trim();
    normalized.skillTag = String(effect.skillTag || effect.tag || '').trim();
    if (!normalized.skillId && !normalized.skillName && !normalized.skillTag) {
      return null;
    }
  } else if (type === ITEM_EFFECT_TYPES.BATTLE_START_EFFECT) {
    normalized.effectId = String(effect.effectId || effect.statusId || effect.buffId || effect.debuffId || effect.id || '').trim();
    normalized.stacks = Math.max(1, Number(effect.stacks || effect.stack || effect.count || 1));
    normalized.value = 0;
    if (!normalized.effectId) {
      return null;
    }
  } else if (type === ITEM_EFFECT_TYPES.QUESTION_TIME) {
    normalized.questionType = normalizeQuestionTypeAlias_(effect.questionType || effect.question || effect.target || inferItemEffectQuestionType_(effect) || 'all');
  } else if (type === ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT || type === ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT) {
    normalized.questionType = normalizeQuestionTypeAlias_(effect.questionType || effect.question || effect.target || inferItemEffectQuestionType_(effect) || 'all');
  }

  if (summary) {
    normalized.summary = String(summary);
  }
  if (!normalized.summary && originalText && originalText.indexOf('=') === -1 && originalText.indexOf('|') === -1 && !/^[{\[]/.test(String(originalText).trim())) {
    normalized.summary = String(originalText);
  }
  return normalized;
}

function normalizeItemEffectKey_(key) {
  var normalized = String(key || '').trim().replace(/[\s_-]+(.)/g, function(_, char) {
    return String(char || '').toUpperCase();
  });
  return normalized ? normalized.charAt(0).toLowerCase() + normalized.slice(1) : '';
}

function normalizeItemEffectTypeAlias_(type) {
  var value = String(type || '').trim();
  if (!value) {
    return '';
  }
  var lower = value.toLowerCase().replace(/[\s_-]+/g, '');
  var aliases = {
    stat: ITEM_EFFECT_TYPES.STAT,
    stats: ITEM_EFFECT_TYPES.STAT,
    ability: ITEM_EFFECT_TYPES.STAT,
    능력치: ITEM_EFFECT_TYPES.STAT,
    스탯: ITEM_EFFECT_TYPES.STAT,
    damagedealtpercent: ITEM_EFFECT_TYPES.DAMAGE_DEALT_PERCENT,
    damagedealt: ITEM_EFFECT_TYPES.DAMAGE_DEALT_PERCENT,
    outgoingdamage: ITEM_EFFECT_TYPES.DAMAGE_DEALT_PERCENT,
    outgoingdamagepercent: ITEM_EFFECT_TYPES.DAMAGE_DEALT_PERCENT,
    피해증폭: ITEM_EFFECT_TYPES.DAMAGE_DEALT_PERCENT,
    damagetakenpercent: ITEM_EFFECT_TYPES.DAMAGE_TAKEN_PERCENT,
    damagetaken: ITEM_EFFECT_TYPES.DAMAGE_TAKEN_PERCENT,
    incomingdamage: ITEM_EFFECT_TYPES.DAMAGE_TAKEN_PERCENT,
    incomingdamagepercent: ITEM_EFFECT_TYPES.DAMAGE_TAKEN_PERCENT,
    입는피해: ITEM_EFFECT_TYPES.DAMAGE_TAKEN_PERCENT,
    받는피해: ITEM_EFFECT_TYPES.DAMAGE_TAKEN_PERCENT,
    basicattackdamagepercent: ITEM_EFFECT_TYPES.BASIC_ATTACK_DAMAGE_PERCENT,
    basicattackdamage: ITEM_EFFECT_TYPES.BASIC_ATTACK_DAMAGE_PERCENT,
    attackdamagepercent: ITEM_EFFECT_TYPES.BASIC_ATTACK_DAMAGE_PERCENT,
    일반공격피해: ITEM_EFFECT_TYPES.BASIC_ATTACK_DAMAGE_PERCENT,
    기본공격피해: ITEM_EFFECT_TYPES.BASIC_ATTACK_DAMAGE_PERCENT,
    skilldamagepercent: ITEM_EFFECT_TYPES.SKILL_DAMAGE_PERCENT,
    skilldamage: ITEM_EFFECT_TYPES.SKILL_DAMAGE_PERCENT,
    스킬피해: ITEM_EFFECT_TYPES.SKILL_DAMAGE_PERCENT,
    skillextradamage: ITEM_EFFECT_TYPES.SKILL_EXTRA_DAMAGE,
    skillbonusdamage: ITEM_EFFECT_TYPES.SKILL_EXTRA_DAMAGE,
    skillflatdamage: ITEM_EFFECT_TYPES.SKILL_EXTRA_DAMAGE,
    스킬추가피해: ITEM_EFFECT_TYPES.SKILL_EXTRA_DAMAGE,
    battlestarteffect: ITEM_EFFECT_TYPES.BATTLE_START_EFFECT,
    battleStartEffect: ITEM_EFFECT_TYPES.BATTLE_START_EFFECT,
    onbattlestart: ITEM_EFFECT_TYPES.BATTLE_START_EFFECT,
    전투시작효과: ITEM_EFFECT_TYPES.BATTLE_START_EFFECT,
    questiondifficulty: ITEM_EFFECT_TYPES.QUESTION_DIFFICULTY,
    problemdifficulty: ITEM_EFFECT_TYPES.QUESTION_DIFFICULTY,
    문제난이도: ITEM_EFFECT_TYPES.QUESTION_DIFFICULTY,
    questionmaxefficiencypercent: ITEM_EFFECT_TYPES.QUESTION_MAX_EFFICIENCY_PERCENT,
    questionmaxefficiency: ITEM_EFFECT_TYPES.QUESTION_MAX_EFFICIENCY_PERCENT,
    문제최대효율: ITEM_EFFECT_TYPES.QUESTION_MAX_EFFICIENCY_PERCENT,
    questiontime: ITEM_EFFECT_TYPES.QUESTION_TIME,
    multiplechoicequestiontime: ITEM_EFFECT_TYPES.QUESTION_TIME,
    shortanswerquestiontime: ITEM_EFFECT_TYPES.QUESTION_TIME,
    문제시간: ITEM_EFFECT_TYPES.QUESTION_TIME,
    문제풀이시간: ITEM_EFFECT_TYPES.QUESTION_TIME,
    제한시간: ITEM_EFFECT_TYPES.QUESTION_TIME,
    객관식문제시간: ITEM_EFFECT_TYPES.QUESTION_TIME,
    주관식문제시간: ITEM_EFFECT_TYPES.QUESTION_TIME,
    questiontypechancepercent: ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT,
    questiontypechance: ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT,
    multiplechoicechancepercent: ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT,
    multiplechoicechance: ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT,
    객관식확률: ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT,
    객관식문제확률: ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT,
    answercorrectefficiencypercent: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    answercorrectefficiency: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    answerefficiencypercent: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    answerefficiency: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    문제풀이효율: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    문제효율: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    정답효율: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    multiplechoiceefficiency: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    multiplechoicecorrectefficiency: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    multiplechoicecorrectefficiencypercent: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    객관식효율: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    객관식정답효율: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    객관식문제정답효율: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT,
    shortanswerchancepercent: ITEM_EFFECT_TYPES.SHORT_ANSWER_CHANCE_PERCENT,
    shortanswerchance: ITEM_EFFECT_TYPES.SHORT_ANSWER_CHANCE_PERCENT,
    주관식확률: ITEM_EFFECT_TYPES.SHORT_ANSWER_CHANCE_PERCENT,
    주관식문제확률: ITEM_EFFECT_TYPES.SHORT_ANSWER_CHANCE_PERCENT,
    shortanswercorrectefficiencypercent: ITEM_EFFECT_TYPES.SHORT_ANSWER_CORRECT_EFFICIENCY_PERCENT,
    shortanswerefficiency: ITEM_EFFECT_TYPES.SHORT_ANSWER_CORRECT_EFFICIENCY_PERCENT,
    주관식정답효율: ITEM_EFFECT_TYPES.SHORT_ANSWER_CORRECT_EFFICIENCY_PERCENT,
    주관식문제정답효율: ITEM_EFFECT_TYPES.SHORT_ANSWER_CORRECT_EFFICIENCY_PERCENT,
  };
  return aliases[value] || aliases[lower] || '';
}

function inferItemEffectQuestionType_(effect) {
  var text = [effect.type, effect.effectType, effect.kind, effect.summary, effect.label, effect.text].map(function(value) {
    return String(value || '');
  }).join(' ').toLowerCase();
  var compact = text.replace(/[\s_-]+/g, '');
  if (compact.indexOf('multiplechoice') !== -1 || text.indexOf('객관식') !== -1) {
    return QUESTION_TYPES.MULTIPLE_CHOICE;
  }
  if (compact.indexOf('shortanswer') !== -1 || text.indexOf('주관식') !== -1) {
    return QUESTION_TYPES.SHORT_ANSWER;
  }
  return '';
}

function normalizeItemStatKeyAlias_(statKey) {
  var value = String(statKey || '').trim();
  var lower = value.toLowerCase().replace(/[\s_-]+/g, '');
  var aliases = {};
  aliases[STAT_KEYS.ATTACK] = STAT_KEYS.ATTACK;
  aliases[STAT_KEYS.HP] = STAT_KEYS.HP;
  aliases[STAT_KEYS.HP_REGEN] = STAT_KEYS.HP_REGEN;
  aliases[STAT_KEYS.EVASION] = STAT_KEYS.EVASION;
  aliases[STAT_KEYS.CRITICAL_RATE] = STAT_KEYS.CRITICAL_RATE;
  aliases[STAT_KEYS.CRITICAL_DAMAGE] = STAT_KEYS.CRITICAL_DAMAGE;
  aliases[STAT_KEYS.DEFENSE] = STAT_KEYS.DEFENSE;
  aliases[STAT_KEYS.ACCURACY] = STAT_KEYS.ACCURACY;
  aliases.attack = STAT_KEYS.ATTACK;
  aliases.atk = STAT_KEYS.ATTACK;
  aliases['공격력'] = STAT_KEYS.ATTACK;
  aliases.hp = STAT_KEYS.HP;
  aliases.health = STAT_KEYS.HP;
  aliases.maxhp = STAT_KEYS.HP;
  aliases['체력'] = STAT_KEYS.HP;
  aliases['최대체력'] = STAT_KEYS.HP;
  aliases.hpregen = STAT_KEYS.HP_REGEN;
  aliases.regen = STAT_KEYS.HP_REGEN;
  aliases['회복력'] = STAT_KEYS.HP_REGEN;
  aliases.evasion = STAT_KEYS.EVASION;
  aliases.eva = STAT_KEYS.EVASION;
  aliases.dodge = STAT_KEYS.EVASION;
  aliases['회피율'] = STAT_KEYS.EVASION;
  aliases.criticalrate = STAT_KEYS.CRITICAL_RATE;
  aliases.critrate = STAT_KEYS.CRITICAL_RATE;
  aliases.crit = STAT_KEYS.CRITICAL_RATE;
  aliases['치명타확률'] = STAT_KEYS.CRITICAL_RATE;
  aliases.criticaldamage = STAT_KEYS.CRITICAL_DAMAGE;
  aliases.critdamage = STAT_KEYS.CRITICAL_DAMAGE;
  aliases.critdmg = STAT_KEYS.CRITICAL_DAMAGE;
  aliases['치명타피해'] = STAT_KEYS.CRITICAL_DAMAGE;
  aliases.defense = STAT_KEYS.DEFENSE;
  aliases.def = STAT_KEYS.DEFENSE;
  aliases['방어력'] = STAT_KEYS.DEFENSE;
  aliases.accuracy = STAT_KEYS.ACCURACY;
  aliases.acc = STAT_KEYS.ACCURACY;
  aliases.hit = STAT_KEYS.ACCURACY;
  aliases['명중률'] = STAT_KEYS.ACCURACY;
  return aliases[value] || aliases[lower] || '';
}

function normalizeItemEffectModeAlias_(mode) {
  var value = String(mode || '').trim().toLowerCase().replace(/[\s_-]+/g, '');
  var aliases = {
    flat: EFFECT_TYPES.FLAT,
    add: EFFECT_TYPES.FLAT,
    plus: EFFECT_TYPES.FLAT,
    fixed: EFFECT_TYPES.FLAT,
    고정: EFFECT_TYPES.FLAT,
    percent: EFFECT_TYPES.PERCENT,
    percentage: EFFECT_TYPES.PERCENT,
    pct: EFFECT_TYPES.PERCENT,
    rate: EFFECT_TYPES.PERCENT,
    퍼센트: EFFECT_TYPES.PERCENT,
    '%': EFFECT_TYPES.PERCENT,
  };
  return aliases[value] || EFFECT_TYPES.FLAT;
}

function normalizeQuestionTypeAlias_(questionType) {
  var value = String(questionType || '').trim();
  var lower = value.toLowerCase().replace(/[\s_-]+/g, '');
  var aliases = {
    all: 'all',
    any: 'all',
    전체: 'all',
    multiplechoice: QUESTION_TYPES.MULTIPLE_CHOICE,
    choice: QUESTION_TYPES.MULTIPLE_CHOICE,
    객관식: QUESTION_TYPES.MULTIPLE_CHOICE,
    shortanswer: QUESTION_TYPES.SHORT_ANSWER,
    short: QUESTION_TYPES.SHORT_ANSWER,
    주관식: QUESTION_TYPES.SHORT_ANSWER,
  };
  return aliases[value] || aliases[lower] || 'all';
}

function parseSignedNumber_(value) {
  var text = String(value || '').trim();
  var match = text.match(/([+-]?\d+(?:\.\d+)?)/);
  return match ? Number(match[1]) : 0;
}

function parseLegacyItemEffectText_(text) {
  var value = String(text || '').trim();
  if (!value) {
    return null;
  }
  var normalized = value.replace(/[“”]/g, '"').replace(/\s+/g, ' ');
  var numberMatch = normalized.match(/([+-]?\d+(?:\.\d+)?)/);
  var numberValue = numberMatch ? Number(numberMatch[1]) : 0;
  var signedMatch = normalized.match(/([+-]\d+(?:\.\d+)?)/);
  var signedValue = signedMatch ? Number(signedMatch[1]) : numberValue;
  var statKey = parseItemStatKeyFromText_(normalized);
  if (normalized.indexOf('전투 시작') !== -1 && normalized.indexOf('멍청해짐') !== -1) {
    return { type: ITEM_EFFECT_TYPES.BATTLE_START_EFFECT, effectId: 'debuff_foolish', stacks: Math.max(1, numberValue || 1), summary: value };
  }
  if (normalized.indexOf('전투 시작') !== -1 && normalized.indexOf('똑똑해짐') !== -1) {
    return { type: ITEM_EFFECT_TYPES.BATTLE_START_EFFECT, effectId: 'buff_smart', stacks: Math.max(1, numberValue || 1), summary: value };
  }
  if (normalized.indexOf('타격') !== -1 && normalized.indexOf('스킬') !== -1 && normalized.indexOf('추가 피해') !== -1) {
    return { type: ITEM_EFFECT_TYPES.SKILL_EXTRA_DAMAGE, skillName: '타격', skillId: 'skill_strike', skillTag: 'strike', value: Math.abs(numberValue), summary: value };
  }
  if (normalized.indexOf('피해 증폭') !== -1 || normalized.indexOf('주는 피해') !== -1) {
    return { type: ITEM_EFFECT_TYPES.DAMAGE_DEALT_PERCENT, value: signedValue, summary: value };
  }
  if (normalized.indexOf('입는 피해') !== -1 || normalized.indexOf('받는 피해') !== -1) {
    return { type: ITEM_EFFECT_TYPES.DAMAGE_TAKEN_PERCENT, value: signedValue, summary: value };
  }
  if (normalized.indexOf('스킬 피해') !== -1) {
    return { type: ITEM_EFFECT_TYPES.SKILL_DAMAGE_PERCENT, value: signedValue, summary: value };
  }
  if (normalized.indexOf('일반 공격 피해') !== -1 || normalized.indexOf('기본 공격 피해') !== -1) {
    return { type: ITEM_EFFECT_TYPES.BASIC_ATTACK_DAMAGE_PERCENT, value: signedValue, summary: value };
  }
  if (normalized.indexOf('문제 난이도') !== -1) {
    return { type: ITEM_EFFECT_TYPES.QUESTION_DIFFICULTY, value: signedValue, summary: value };
  }
  if (normalized.indexOf('문제 최대 효율') !== -1) {
    return { type: ITEM_EFFECT_TYPES.QUESTION_MAX_EFFICIENCY_PERCENT, value: signedValue, summary: value };
  }
  if (normalized.indexOf('객관식') !== -1 && normalized.indexOf('확률') !== -1) {
    return { type: ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT, questionType: QUESTION_TYPES.MULTIPLE_CHOICE, value: signedValue, summary: value };
  }
  if (normalized.indexOf('주관식 문제 정답') !== -1 && normalized.indexOf('효율') !== -1) {
    return { type: ITEM_EFFECT_TYPES.SHORT_ANSWER_CORRECT_EFFICIENCY_PERCENT, value: signedValue, summary: value };
  }
  if (normalized.indexOf('주관식') !== -1 && normalized.indexOf('확률') !== -1) {
    return { type: ITEM_EFFECT_TYPES.SHORT_ANSWER_CHANCE_PERCENT, value: signedValue, summary: value };
  }
  if (normalized.indexOf('객관식') !== -1 && normalized.indexOf('효율') !== -1) {
    return { type: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT, questionType: QUESTION_TYPES.MULTIPLE_CHOICE, value: signedValue, summary: value };
  }
  if ((normalized.indexOf('문제 풀이 효율') !== -1 || normalized.indexOf('문제 효율') !== -1 || normalized.indexOf('정답 효율') !== -1) && normalized.indexOf('최대') === -1) {
    return { type: ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT, questionType: 'all', value: signedValue, summary: value };
  }
  if (normalized.indexOf('문제 시간') !== -1 || normalized.indexOf('문제 풀이 시간') !== -1 || normalized.indexOf('제한시간') !== -1) {
    return {
      type: ITEM_EFFECT_TYPES.QUESTION_TIME,
      questionType: normalized.indexOf('주관식') !== -1 ? QUESTION_TYPES.SHORT_ANSWER : (normalized.indexOf('객관식') !== -1 ? QUESTION_TYPES.MULTIPLE_CHOICE : 'all'),
      value: signedValue,
      summary: value,
    };
  }
  if (statKey) {
    return {
      type: ITEM_EFFECT_TYPES.STAT,
      statKey: statKey,
      effectType: normalized.indexOf('%') !== -1 && statKey === STAT_KEYS.ATTACK ? EFFECT_TYPES.PERCENT : EFFECT_TYPES.FLAT,
      value: signedValue,
      summary: value,
    };
  }
  return { type: 'note', value: 0, summary: value };
}

function parseItemStatKeyFromText_(text) {
  if (text.indexOf('공격력') !== -1) return STAT_KEYS.ATTACK;
  if (text.indexOf('최대 체력') !== -1 || text.indexOf('체력') !== -1) return STAT_KEYS.HP;
  if (text.indexOf('회피율') !== -1) return STAT_KEYS.EVASION;
  if (text.indexOf('명중률') !== -1) return STAT_KEYS.ACCURACY;
  if (text.indexOf('치명타 확률') !== -1) return STAT_KEYS.CRITICAL_RATE;
  if (text.indexOf('치명타 피해') !== -1) return STAT_KEYS.CRITICAL_DAMAGE;
  if (text.indexOf('방어력') !== -1) return STAT_KEYS.DEFENSE;
  return '';
}

function buildItemClientDetail_(item) {
  if (!item) {
    return null;
  }
  var effects = getItemEffects_(item);
  var rarity = normalizeRarity_(item.rarity) || RARITIES.COMMON;
  return {
    id: item.itemId || item.id || '',
    itemId: item.itemId || item.id || '',
    name: item.name || '',
    rarity: rarity,
    rarityLabel: getRarityLabel_(rarity),
    effects: effects,
    effectSummary: buildItemEffectSummary_(item),
    description: item.description || '',
  };
}

function buildOwnedItemClientDetails_(ownedItems) {
  return normalizeOwnedItems_(ownedItems).map(function(owned) {
    var detail = buildItemClientDetail_(getItemById_(owned.itemId));
    if (!detail) {
      return {
        id: owned.itemId,
        itemId: owned.itemId,
        name: owned.itemId,
        rarity: RARITIES.COMMON,
        rarityLabel: getRarityLabel_(RARITIES.COMMON),
        effects: [],
        effectSummary: '',
        description: '',
        count: Number(owned.count || 1),
      };
    }
    detail.count = Number(owned.count || 1);
    return detail;
  });
}

function buildItemEffectSummary_(item) {
  return getItemEffects_(item).map(function(effect) {
    return effect.summary || describeItemEffect_(effect);
  }).filter(Boolean).join(' / ');
}

function formatItemEffectForSheet_(effect) {
  if (!effect) {
    return '';
  }
  var parts = ['type=' + (effect.type || ITEM_EFFECT_TYPES.STAT)];
  if (effect.type === ITEM_EFFECT_TYPES.STAT) {
    parts.push('stat=' + (effect.statKey || ''));
    parts.push('mode=' + (effect.effectType || EFFECT_TYPES.FLAT));
    parts.push('value=' + Number(effect.value || 0));
  } else if (effect.type === ITEM_EFFECT_TYPES.SKILL_EXTRA_DAMAGE) {
    if (effect.skillId) parts.push('skillId=' + effect.skillId);
    if (effect.skillName) parts.push('skillName=' + effect.skillName);
    if (effect.skillTag) parts.push('skillTag=' + effect.skillTag);
    parts.push('value=' + Number(effect.value || 0));
  } else if (effect.type === ITEM_EFFECT_TYPES.BATTLE_START_EFFECT) {
    parts.push('effectId=' + (effect.effectId || ''));
    parts.push('stacks=' + Math.max(1, Number(effect.stacks || 1)));
  } else if (effect.type === ITEM_EFFECT_TYPES.QUESTION_TIME) {
    parts.push('questionType=' + (effect.questionType || 'all'));
    parts.push('value=' + Number(effect.value || 0));
  } else if (effect.type === ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT || effect.type === ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT) {
    parts.push('questionType=' + (effect.questionType || 'all'));
    parts.push('value=' + Number(effect.value || 0));
  } else {
    parts.push('value=' + Number(effect.value || 0));
  }
  var summary = effect.summary || describeItemEffect_(effect);
  if (summary) {
    parts.push('label=' + summary);
  }
  return parts.join('; ');
}

function describeItemEffect_(effect) {
  var value = Number(effect.value || 0);
  var sign = value > 0 ? '+' : '';
  if (effect.type === ITEM_EFFECT_TYPES.STAT) {
    return getItemStatLabel_(effect.statKey) + ' ' + sign + value + (effect.effectType === EFFECT_TYPES.PERCENT ? '%' : '');
  }
  if (effect.type === ITEM_EFFECT_TYPES.DAMAGE_DEALT_PERCENT) {
    return '피해 증폭 ' + sign + value + '%';
  }
  if (effect.type === ITEM_EFFECT_TYPES.DAMAGE_TAKEN_PERCENT) {
    return '입는 피해 ' + sign + value + '%';
  }
  if (effect.type === ITEM_EFFECT_TYPES.BASIC_ATTACK_DAMAGE_PERCENT) {
    return '일반 공격 피해 ' + sign + value + '%';
  }
  if (effect.type === ITEM_EFFECT_TYPES.SKILL_DAMAGE_PERCENT) {
    return '스킬 피해 ' + sign + value + '%';
  }
  if (effect.type === ITEM_EFFECT_TYPES.SKILL_EXTRA_DAMAGE) {
    return (effect.skillName || '특정 스킬') + ' 추가 피해 ' + sign + value;
  }
  if (effect.type === ITEM_EFFECT_TYPES.BATTLE_START_EFFECT) {
    return '전투 시작 효과 ' + (effect.effectId || '');
  }
  if (effect.type === ITEM_EFFECT_TYPES.QUESTION_DIFFICULTY) {
    return '문제 난이도 ' + sign + value;
  }
  if (effect.type === ITEM_EFFECT_TYPES.QUESTION_MAX_EFFICIENCY_PERCENT) {
    return '문제 최대 효율 ' + sign + value + '%';
  }
  if (effect.type === ITEM_EFFECT_TYPES.QUESTION_TIME) {
    return getQuestionTypeItemLabel_(effect.questionType) + '문제 시간 ' + sign + value + '초';
  }
  if (effect.type === ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT) {
    return getQuestionTypeItemLabel_(effect.questionType) + '문제 확률 ' + sign + value + '%';
  }
  if (effect.type === ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT) {
    return getQuestionTypeItemLabel_(effect.questionType) + '정답 효율 ' + sign + value + '%';
  }
  if (effect.type === ITEM_EFFECT_TYPES.SHORT_ANSWER_CHANCE_PERCENT) {
    return '주관식 문제 확률 ' + sign + value + '%';
  }
  if (effect.type === ITEM_EFFECT_TYPES.SHORT_ANSWER_CORRECT_EFFICIENCY_PERCENT) {
    return '주관식 정답 효율 ' + sign + value + '%';
  }
  return '';
}

function getItemStatLabel_(statKey) {
  var labels = {
    attack: '공격력',
    hp: '최대 체력',
    hpRegen: '회복력',
    evasion: '회피율',
    criticalRate: '치명타 확률',
    criticalDamage: '치명타 피해',
    defense: '방어력',
    accuracy: '명중률',
  };
  return labels[statKey] || String(statKey || '스탯');
}

function getQuestionTypeItemLabel_(questionType) {
  if (questionType === QUESTION_TYPES.MULTIPLE_CHOICE) return '객관식 ';
  if (questionType === QUESTION_TYPES.SHORT_ANSWER) return '주관식 ';
  return '';
}

function buildItemModifiers_(ownedItems) {
  var modifiers = {
    statFlat: {},
    statPercent: {},
    damageDealtPercent: 0,
    damageTakenPercent: 0,
    basicAttackDamagePercent: 0,
    skillDamagePercent: 0,
    skillExtraDamage: [],
    battleStartEffects: [],
    questionDifficulty: 0,
    questionMaxEfficiencyPercent: 0,
    questionTimeByType: {},
    questionChanceByType: {},
    answerCorrectEfficiencyPercent: 0,
    answerCorrectEfficiencyByType: {},
    shortAnswerChancePercent: 0,
    shortAnswerCorrectEfficiencyPercent: 0,
  };
  normalizeOwnedItems_(ownedItems).forEach(function(owned) {
    var item = getItemById_(owned.itemId);
    var count = Math.max(1, Number(owned.count || 1));
    if (!item) {
      return;
    }
    getItemEffects_(item).forEach(function(effect) {
      var type = effect.type || ITEM_EFFECT_TYPES.STAT;
      var value = Number(effect.value || 0) * count;
      if (type === ITEM_EFFECT_TYPES.STAT) {
        var statKey = effect.statKey;
        if (!statKey) {
          return;
        }
        var bucket = effect.effectType === EFFECT_TYPES.PERCENT ? modifiers.statPercent : modifiers.statFlat;
        bucket[statKey] = Number(bucket[statKey] || 0) + value;
      } else if (type === ITEM_EFFECT_TYPES.DAMAGE_DEALT_PERCENT) {
        modifiers.damageDealtPercent += value;
      } else if (type === ITEM_EFFECT_TYPES.DAMAGE_TAKEN_PERCENT) {
        modifiers.damageTakenPercent += value;
      } else if (type === ITEM_EFFECT_TYPES.BASIC_ATTACK_DAMAGE_PERCENT) {
        modifiers.basicAttackDamagePercent += value;
      } else if (type === ITEM_EFFECT_TYPES.SKILL_DAMAGE_PERCENT) {
        modifiers.skillDamagePercent += value;
      } else if (type === ITEM_EFFECT_TYPES.SKILL_EXTRA_DAMAGE) {
        modifiers.skillExtraDamage.push(Object.assign({}, effect, { value: value, itemId: item.itemId }));
      } else if (type === ITEM_EFFECT_TYPES.BATTLE_START_EFFECT) {
        modifiers.battleStartEffects.push(Object.assign({}, effect, {
          itemId: item.itemId,
          stacks: Math.max(1, Number(effect.stacks || 1)) * count,
        }));
      } else if (type === ITEM_EFFECT_TYPES.QUESTION_DIFFICULTY) {
        modifiers.questionDifficulty += value;
      } else if (type === ITEM_EFFECT_TYPES.QUESTION_MAX_EFFICIENCY_PERCENT) {
        modifiers.questionMaxEfficiencyPercent += value;
      } else if (type === ITEM_EFFECT_TYPES.QUESTION_TIME) {
        var questionType = effect.questionType || 'all';
        modifiers.questionTimeByType[questionType] = Number(modifiers.questionTimeByType[questionType] || 0) + value;
      } else if (type === ITEM_EFFECT_TYPES.QUESTION_TYPE_CHANCE_PERCENT) {
        var chanceQuestionType = effect.questionType || 'all';
        modifiers.questionChanceByType[chanceQuestionType] = Number(modifiers.questionChanceByType[chanceQuestionType] || 0) + value;
      } else if (type === ITEM_EFFECT_TYPES.ANSWER_CORRECT_EFFICIENCY_PERCENT) {
        var efficiencyQuestionType = effect.questionType || 'all';
        if (efficiencyQuestionType === 'all') {
          modifiers.answerCorrectEfficiencyPercent += value;
        } else {
          modifiers.answerCorrectEfficiencyByType[efficiencyQuestionType] = Number(modifiers.answerCorrectEfficiencyByType[efficiencyQuestionType] || 0) + value;
        }
      } else if (type === ITEM_EFFECT_TYPES.SHORT_ANSWER_CHANCE_PERCENT) {
        modifiers.shortAnswerChancePercent += value;
      } else if (type === ITEM_EFFECT_TYPES.SHORT_ANSWER_CORRECT_EFFICIENCY_PERCENT) {
        modifiers.shortAnswerCorrectEfficiencyPercent += value;
      }
    });
  });
  return modifiers;
}

function calculateStatsWithItemEffects_(baseStats, ownedItems) {
  var source = Object.assign({}, BASE_PLAYER_STATS, baseStats || {});
  var modifiers = buildItemModifiers_(ownedItems);
  var stats = Object.assign({}, source);
  Object.keys(modifiers.statPercent).forEach(function(statKey) {
    stats[statKey] = Number(source[statKey] || 0) * (1 + (Number(modifiers.statPercent[statKey] || 0) / 100));
  });
  Object.keys(modifiers.statFlat).forEach(function(statKey) {
    stats[statKey] = Number(stats[statKey] !== undefined ? stats[statKey] : source[statKey] || 0) + Number(modifiers.statFlat[statKey] || 0);
  });
  stats.hp = Math.max(1, Math.round(Number(stats.hp || 1)));
  stats.attack = Math.round(Number(stats.attack || 0));
  stats.defense = Math.round(Number(stats.defense || 0));
  stats.hpRegen = Math.round(Number(stats.hpRegen || 0));
  stats.evasion = clampPercent_(stats.evasion);
  stats.criticalRate = clampPercent_(stats.criticalRate);
  stats.accuracy = clampPercent_(stats.accuracy === undefined ? 100 : stats.accuracy);
  stats.criticalDamage = Math.max(0, Math.round(Number(stats.criticalDamage || 0)));
  return stats;
}

function clampPercent_(value) {
  return Math.max(0, Math.min(100, Number(value || 0)));
}

function applyBattleStartItemEffects_(battleState) {
  if (!battleState || !battleState.player || battleState.itemBattleStartApplied) {
    return battleState;
  }
  var modifiers = getBattleItemModifiers_(battleState);
  (modifiers.battleStartEffects || []).forEach(function(rule) {
    var effect = rule.effectId ? findCachedRowByKey_(DB_SHEETS.EFFECTS, 'effectId', rule.effectId, 600) : null;
    if (!effect) {
      return;
    }
    var stacks = Math.max(1, Number(rule.stacks || 1));
    var configured = Object.assign({}, effect, {
      stackable: stacks > 1 ? true : effect.stackable,
      maxStacks: Math.max(Number(effect.maxStacks || 1), stacks),
    });
    if (rule.effectId === 'debuff_foolish') {
      configured.statKey = '';
      configured.effectType = EFFECT_TYPES.CONTROL;
      configured.value = 0;
      configured.stackable = true;
      configured.maxStacks = Math.max(Number(configured.maxStacks || 1), stacks);
      configured.description = configured.description && configured.description.indexOf('난이도') === -1
        ? configured.description
        : '정신이 흐려진 상태입니다.';
    }
    for (var i = 0; i < stacks; i += 1) {
      applyEffect(battleState.player, configured, { source: 'item', itemId: rule.itemId || '' });
    }
  });
  battleState.itemBattleStartApplied = true;
  normalizeBattleStateEffects_(battleState);
  return battleState;
}

function syncBattlePlayerItemsFromRun_(battleState, run) {
  if (!battleState || !battleState.player || !run) {
    return battleState;
  }
  var items = normalizeOwnedItems_(safeJsonParse_(run.itemsJson, []));
  var baseStats = battleState.player.baseStats || safeJsonParse_(run.statsJson, Object.assign({}, BASE_PLAYER_STATS));
  var currentMaxHp = Math.max(1, Number(battleState.player.maxHp || battleState.player.stats && battleState.player.stats.hp || baseStats.hp || BASE_PLAYER_STATS.hp));
  var nextStats = calculateStatsWithItemEffects_(baseStats, items);
  var nextMaxHp = Math.max(1, Number(nextStats.hp || 1));
  battleState.player.baseStats = baseStats;
  battleState.player.items = items;
  battleState.player.itemDetails = buildOwnedItemClientDetails_(items);
  battleState.player.itemModifiers = buildItemModifiers_(items);
  battleState.player.stats = nextStats;
  battleState.player.maxHp = nextMaxHp;
  if (nextMaxHp !== currentMaxHp) {
    battleState.player.hp = Math.min(nextMaxHp, Math.max(0, Number(battleState.player.hp || 0)));
  }
  return battleState;
}

function getBattleItemModifiers_(battleState) {
  if (!battleState || !battleState.player) {
    return buildItemModifiers_([]);
  }
  if (!battleState.player.itemModifiers) {
    battleState.player.itemModifiers = buildItemModifiers_(battleState.player.items || []);
  }
  return battleState.player.itemModifiers;
}

function applyOutgoingItemDamageModifiers_(battleState, damage, context) {
  var modifiers = getBattleItemModifiers_(battleState);
  var next = Math.max(0, Number(damage || 0));
  var percent = Number(modifiers.damageDealtPercent || 0);
  var actionType = context && context.actionType || '';
  if (actionType === ACTION_TYPES.ATTACK) {
    percent += Number(modifiers.basicAttackDamagePercent || 0);
  }
  if (actionType === ACTION_TYPES.SKILL) {
    percent += Number(modifiers.skillDamagePercent || 0);
    (modifiers.skillExtraDamage || []).forEach(function(rule) {
      if (doesSkillMatchItemTrigger_(context && context.skill, rule)) {
        next += Number(rule.value || 0);
      }
    });
  }
  next *= 1 + (percent / 100);
  return Math.max(0, Math.round(next));
}

function applyIncomingItemDamageModifiers_(battleState, damage) {
  var modifiers = getBattleItemModifiers_(battleState);
  var next = Math.max(0, Number(damage || 0)) * (1 + (Number(modifiers.damageTakenPercent || 0) / 100));
  return Math.max(0, Math.round(next));
}

function doesSkillMatchItemTrigger_(skill, rule) {
  if (!skill || !rule) {
    return false;
  }
  if (rule.skillId && skill.skillId === rule.skillId) {
    return true;
  }
  if (rule.skillName && skill.name === rule.skillName) {
    return true;
  }
  if (rule.skillTag && normalizeSkillTags_(skill.tags).indexOf(rule.skillTag) !== -1) {
    return true;
  }
  return false;
}

function getItemQuestionModifiers_(battleState, question) {
  var modifiers = getBattleItemModifiers_(battleState);
  var questionType = question && question.type || '';
  var timeSeconds = Number(modifiers.questionTimeByType.all || 0);
  if (questionType && modifiers.questionTimeByType[questionType] !== undefined) {
    var typeSeconds = Number(modifiers.questionTimeByType[questionType] || 0);
    if (questionType === QUESTION_TYPES.SHORT_ANSWER) {
      typeSeconds = typeSeconds / Number(GAME_RULES.SHORT_ANSWER_TIME_MULTIPLIER || 1.2);
    }
    timeSeconds += typeSeconds;
  }
  return {
    questionDifficulty: Number(modifiers.questionDifficulty || 0),
    questionMaxEfficiencyPercent: Number(modifiers.questionMaxEfficiencyPercent || 0),
    questionTimeSeconds: timeSeconds,
    questionChanceByType: Object.assign({}, modifiers.questionChanceByType || {}),
    answerCorrectEfficiencyPercent: Number(modifiers.answerCorrectEfficiencyPercent || 0),
    answerCorrectEfficiencyByType: Object.assign({}, modifiers.answerCorrectEfficiencyByType || {}),
    shortAnswerChancePercent: Number(modifiers.shortAnswerChancePercent || 0),
    shortAnswerCorrectEfficiencyPercent: Number(modifiers.shortAnswerCorrectEfficiencyPercent || 0),
  };
}

function applyItemQuestionEfficiencyModifiers_(efficiency, isCorrect, question, battleState, maxEfficiency) {
  var next = Number(efficiency || 0);
  if (!isCorrect) {
    return roundTo_(Math.max(0, Math.min(Number(maxEfficiency || next), next)), 3);
  }
  var modifiers = getItemQuestionModifiers_(battleState, question);
  next += getItemQuestionCorrectEfficiencyBonusPercent_(modifiers, question) / 100;
  return roundTo_(Math.max(0, Math.min(Number(maxEfficiency || next), next)), 3);
}

function getItemQuestionCorrectEfficiencyBonusPercent_(questionModifiers, question) {
  var bonus = Number(questionModifiers && questionModifiers.answerCorrectEfficiencyPercent || 0);
  var byType = questionModifiers && questionModifiers.answerCorrectEfficiencyByType || {};
  if (question && question.type && byType[question.type] !== undefined) {
    bonus += Number(byType[question.type] || 0);
  }
  if (question && question.type === QUESTION_TYPES.SHORT_ANSWER) {
    bonus += Number(questionModifiers && questionModifiers.shortAnswerCorrectEfficiencyPercent || 0);
  }
  return bonus;
}

function addItemToOwnedItems_(ownedItems, itemId) {
  var items = normalizeOwnedItems_(ownedItems);
  var id = String(itemId || '').trim();
  if (!id) {
    throw new Error('아이템 보상 targetId가 비어 있습니다.');
  }
  var existing = items.filter(function(item) {
    return item.itemId === id;
  })[0];
  if (existing) {
    return items;
  } else {
    items.push({ itemId: id, count: 1, acquiredAt: new Date().toISOString() });
  }
  return items;
}

function pickAutoItemReward_(ownedItems) {
  var config = ITEM_REWARD_CONFIG;
  var rarity = pickItemRewardRarity_(config.rarityWeights);
  var item = pickItemByRarityWithFallback_(rarity, ownedItems, config);
  if (!item) {
    return null;
  }
  return buildAutoItemReward_(item);
}

function hasAvailableItemReward_(ownedItems) {
  return getAvailableItemRewardPool_('', ownedItems, ITEM_REWARD_CONFIG).length > 0;
}

function buildAutoItemReward_(item) {
  var detail = buildItemClientDetail_(item);
  return {
    rewardId: 'auto_item_' + detail.itemId,
    type: REWARD_TYPES.ITEM,
    targetId: detail.itemId,
    value: 1,
    weight: 0,
    minFloor: 1,
    maxFloor: GAME_RULES.FLOOR_COUNT,
    description: detail.name,
    detailDescription: [detail.effectSummary, detail.description].filter(Boolean).join('\n'),
    rarity: detail.rarity,
    itemDetail: detail,
  };
}

function pickItemRewardRarity_(rarityWeights) {
  var ordered = [RARITIES.COMMON, RARITIES.UNCOMMON, RARITIES.RARE, RARITIES.EPIC, RARITIES.LEGENDARY, RARITIES.UNIQUE];
  var weights = ordered.map(function(rarity) {
    return Math.max(0, Number(rarityWeights && rarityWeights[rarity] || 0));
  });
  return pickWeighted_(ordered, weights);
}

function pickItemByRarityWithFallback_(rarity, ownedItems, config) {
  var ordered = [RARITIES.COMMON, RARITIES.UNCOMMON, RARITIES.RARE, RARITIES.EPIC, RARITIES.LEGENDARY, RARITIES.UNIQUE];
  var rarityIndex = Math.max(0, ordered.indexOf(rarity));
  for (var i = rarityIndex; i >= 0; i -= 1) {
    var pool = getAvailableItemRewardPool_(ordered[i], ownedItems, config);
    if (pool.length) {
      return pickRandom_(pool);
    }
  }
  var allPool = getAvailableItemRewardPool_('', ownedItems, config);
  return allPool.length ? pickRandom_(allPool) : null;
}

function getAvailableItemRewardPool_(rarity, ownedItems, config) {
  var ownedMap = normalizeOwnedItems_(ownedItems).reduce(function(map, item) {
    map[item.itemId] = item;
    return map;
  }, {});
  return getItemRows_().filter(function(item) {
    var itemId = item.itemId || item.id || '';
    var itemRarity = normalizeRarity_(item.rarity) || RARITIES.COMMON;
    if (rarity && itemRarity !== rarity) {
      return false;
    }
    if (config.excludeOwnedItems && ownedMap[itemId]) {
      return false;
    }
    if (itemRarity === RARITIES.UNIQUE && config.preventDuplicateUniqueItems && ownedMap[itemId]) {
      return false;
    }
    if (itemRarity !== RARITIES.UNIQUE && !config.allowDuplicateNonUniqueItems && ownedMap[itemId]) {
      return false;
    }
    return true;
  });
}
