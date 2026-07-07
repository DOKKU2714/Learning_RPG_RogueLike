function getSpreadsheet_() {
  if (CONFIG.SPREADSHEET_ID) {
    return SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  }

  var spreadsheet = SpreadsheetApp.getActiveSpreadsheet();
  if (!spreadsheet) {
    throw new Error('No active spreadsheet. Set CONFIG.SPREADSHEET_ID in Config.gs.');
  }
  return spreadsheet;
}

function getSheet_(sheetName) {
  var sheet = getSpreadsheet_().getSheetByName(sheetName);
  if (!sheet) {
    throw new Error('Sheet not found: ' + sheetName);
  }
  return sheet;
}

function ensureSheet_(sheetName, headers) {
  var spreadsheet = getSpreadsheet_();
  var sheet = spreadsheet.getSheetByName(sheetName);
  if (!sheet) {
    sheet = spreadsheet.insertSheet(sheetName);
  }

  if (sheet.getMaxColumns() < headers.length) {
    sheet.insertColumnsAfter(sheet.getMaxColumns(), headers.length - sheet.getMaxColumns());
  }

  sheet.getRange(1, 1, 1, sheet.getMaxColumns()).clearContent();
  sheet.getRange(1, 1, 1, headers.length).setValues([headers]);
  sheet.setFrozenRows(1);
  return sheet;
}

function readTable_(sheetName) {
  var sheet = getSheet_(sheetName);
  var lastRow = sheet.getLastRow();
  var lastColumn = sheet.getLastColumn();
  if (lastRow < 1 || lastColumn < 1) {
    return [];
  }

  var values = sheet.getRange(1, 1, lastRow, lastColumn).getValues();
  var headers = values[0].filter(function(header) {
    return header !== '';
  });

  return values.slice(1).filter(function(row) {
    return row.some(function(value) {
      return value !== '';
    });
  }).map(function(row) {
    return rowToObject_(headers, row);
  });
}

function readTableCached_(sheetName, ttlSeconds) {
  var ttl = Number(ttlSeconds || 300);
  var cacheKey = 'table:' + sheetName;
  try {
    var cached = CacheService.getScriptCache().get(cacheKey);
    if (cached) {
      return safeJsonParse_(cached, []);
    }
  } catch (error) {
    return readTable_(sheetName);
  }

  var rows = readTable_(sheetName);
  try {
    CacheService.getScriptCache().put(cacheKey, safeJsonStringify_(rows), ttl);
  } catch (error) {
    // Large sheets can exceed Apps Script cache item limits; fall back silently.
  }
  return rows;
}

function findCachedRowByKey_(sheetName, keyColumn, keyValue, ttlSeconds) {
  return readTableCached_(sheetName, ttlSeconds).filter(function(row) {
    return String(row[keyColumn]) === String(keyValue);
  })[0] || null;
}

function clearTableCache_(sheetName) {
  try {
    CacheService.getScriptCache().remove('table:' + sheetName);
  } catch (error) {
    // Cache clearing is best-effort.
  }
}

function clearMasterTableCaches_() {
  [
    DB_SHEETS.SETTINGS,
    DB_SHEETS.STAGES,
    DB_SHEETS.MONSTER_GROUPS,
    DB_SHEETS.MONSTERS,
    DB_SHEETS.SKILLS,
    DB_SHEETS.EFFECTS,
    DB_SHEETS.ITEMS,
    DB_SHEETS.REWARDS,
    DB_SHEETS.REWARD_GROUPS,
    DB_SHEETS.QUESTIONS,
  ].forEach(clearTableCache_);
}

function clearRuntimeCaches() {
  clearMasterTableCaches_();
  return { ok: true, clearedAt: new Date() };
}

function warmupGameData(authToken) {
  var startedAt = new Date().getTime();
  [
    DB_SHEETS.SETTINGS,
    DB_SHEETS.STAGES,
    DB_SHEETS.MONSTER_GROUPS,
    DB_SHEETS.MONSTERS,
    DB_SHEETS.MONSTER_AI,
    DB_SHEETS.SKILLS,
    DB_SHEETS.EFFECTS,
    DB_SHEETS.ITEMS,
    DB_SHEETS.REWARDS,
    DB_SHEETS.REWARD_GROUPS,
    DB_SHEETS.QUESTIONS,
  ].forEach(function(sheetName) {
    readTableCached_(sheetName, 1800);
  });
  var user = null;
  if (authToken) {
    try {
      user = getCurrentUser(authToken);
    } catch (error) {
      user = null;
    }
  }
  return {
    ok: true,
    isRegistered: !!(user && user.isRegistered),
    elapsedMs: new Date().getTime() - startedAt,
  };
}

function appendRowObject_(sheetName, object) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaderRow_(sheet);
  var row = headers.map(function(header) {
    return object[header] !== undefined ? object[header] : '';
  });
  sheet.appendRow(row);
  return object;
}

function appendRowObjects_(sheetName, objects) {
  var rows = objects || [];
  if (!rows.length) {
    return [];
  }
  var sheet = getSheet_(sheetName);
  var headers = getHeaderRow_(sheet);
  var values = rows.map(function(object) {
    return headers.map(function(header) {
      return object[header] !== undefined ? object[header] : '';
    });
  });
  sheet.getRange(sheet.getLastRow() + 1, 1, values.length, headers.length).setValues(values);
  return rows;
}

function updateRowByKey_(sheetName, keyColumn, keyValue, patchObject) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaderRow_(sheet);
  var keyIndex = headers.indexOf(keyColumn);
  if (keyIndex === -1) {
    throw new Error('Key column not found: ' + keyColumn);
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  var rowNumber = findSheetRowNumberByKey_(sheet, headers, keyIndex, sheetName, keyColumn, keyValue);
  if (!rowNumber) {
    return null;
  }
  var currentRow = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  var currentObject = rowToObject_(headers, currentRow);
  var updatedObject = Object.assign({}, currentObject, patchObject);
  var updatedRow = headers.map(function(header) {
    return updatedObject[header] !== undefined ? updatedObject[header] : '';
  });
  sheet.getRange(rowNumber, 1, 1, headers.length).setValues([updatedRow]);
  if (sheetName === DB_SHEETS.RUNS && typeof cacheRun_ === 'function') {
    cacheRun_(updatedObject);
  }
  return updatedObject;
}

function findRowByKey_(sheetName, keyColumn, keyValue) {
  var sheet = getSheet_(sheetName);
  var headers = getHeaderRow_(sheet);
  var keyIndex = headers.indexOf(keyColumn);
  if (keyIndex === -1) {
    throw new Error('Key column not found: ' + keyColumn);
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return null;
  }

  var rowNumber = findSheetRowNumberByKey_(sheet, headers, keyIndex, sheetName, keyColumn, keyValue);
  if (!rowNumber) {
    return null;
  }
  var row = sheet.getRange(rowNumber, 1, 1, headers.length).getValues()[0];
  return rowToObject_(headers, row);
}

function findSheetRowNumberByKey_(sheet, headers, keyIndex, sheetName, keyColumn, keyValue) {
  var cachedRowNumber = getCachedSheetRowNumber_(sheetName, keyColumn, keyValue);
  if (cachedRowNumber && cachedRowNumber >= 2 && cachedRowNumber <= sheet.getLastRow()) {
    var cachedValue = sheet.getRange(cachedRowNumber, keyIndex + 1).getValue();
    if (String(cachedValue) === String(keyValue)) {
      return cachedRowNumber;
    }
  }

  var lastRow = sheet.getLastRow();
  if (lastRow < 2) {
    return 0;
  }
  var keyValues = sheet.getRange(2, keyIndex + 1, lastRow - 1, 1).getValues();
  for (var i = 0; i < keyValues.length; i += 1) {
    if (String(keyValues[i][0]) === String(keyValue)) {
      var rowNumber = i + 2;
      cacheSheetRowNumber_(sheetName, keyColumn, keyValue, rowNumber);
      return rowNumber;
    }
  }
  return 0;
}

function getCachedSheetRowNumber_(sheetName, keyColumn, keyValue) {
  try {
    var value = CacheService.getScriptCache().get(getSheetRowNumberCacheKey_(sheetName, keyColumn, keyValue));
    return value ? Number(value) : 0;
  } catch (error) {
    return 0;
  }
}

function cacheSheetRowNumber_(sheetName, keyColumn, keyValue, rowNumber) {
  try {
    CacheService.getScriptCache().put(getSheetRowNumberCacheKey_(sheetName, keyColumn, keyValue), String(rowNumber), 21600);
  } catch (error) {}
}

function getSheetRowNumberCacheKey_(sheetName, keyColumn, keyValue) {
  return ['row', sheetName, keyColumn, String(keyValue || '')].join(':');
}

function safeJsonParse_(value, fallback) {
  if (value === null || value === undefined || value === '') {
    return fallback;
  }

  try {
    return JSON.parse(value);
  } catch (error) {
    try {
      var text = String(value || '').trim();
      if (!/^[\[{]/.test(text) || text.indexOf("'") === -1) {
        return fallback;
      }
      var normalized = text.replace(/'([^'\\]*(?:\\.[^'\\]*)*)'/g, function(match, inner) {
        return '"' + inner.replace(/"/g, '\\"') + '"';
      });
      return JSON.parse(normalized);
    } catch (retryError) {
      return fallback;
    }
  }
}

function safeJsonStringify_(value) {
  if (value === null || value === undefined) {
    return '';
  }

  try {
    return JSON.stringify(value);
  } catch (error) {
    return '';
  }
}

function generateId_(prefix) {
  var idPrefix = prefix || 'id';
  return idPrefix + '_' + Utilities.getUuid().replace(/-/g, '');
}

function setupDatabase() {
  DB_SCHEMA.forEach(function(schema) {
    ensureSheet_(schema.sheetName, schema.headers);
  });
}

function seedMasterData() {
  setupDatabase();

  var now = new Date();

  MASTER_SETTINGS.forEach(function(setting) {
    upsertRowByKey_(DB_SHEETS.SETTINGS, 'key', setting.key, Object.assign({}, setting, {
      updatedAt: now,
    }));
  });

  MASTER_EFFECTS.forEach(function(effect) {
    upsertRowByKey_(DB_SHEETS.EFFECTS, 'effectId', effect.effectId, effect);
  });

  MASTER_MONSTER_AI.forEach(function(ai) {
    upsertRowByKey_(DB_SHEETS.MONSTER_AI, 'aiId', ai.aiId, ai);
  });
  if (typeof EXTRA_MONSTER_AI !== 'undefined') {
    EXTRA_MONSTER_AI.forEach(function(ai) {
      upsertRowByKey_(DB_SHEETS.MONSTER_AI, 'patternName', ai.patternName, ai);
    });
  }

  MASTER_SKILLS.forEach(function(skill) {
    upsertRowByKey_(DB_SHEETS.SKILLS, 'skillId', skill.skillId, skill);
  });

  MASTER_MONSTERS.forEach(function(monster) {
    upsertRowByKey_(DB_SHEETS.MONSTERS, 'monsterId', monster.monsterId, monster);
  });

  MASTER_MONSTER_GROUPS.forEach(function(group) {
    upsertRowByKey_(DB_SHEETS.MONSTER_GROUPS, 'monsterGroupId', group.monsterGroupId, group);
  });

  MASTER_ITEMS.forEach(function(item) {
    upsertRowByKey_(DB_SHEETS.ITEMS, 'itemId', item.itemId, item);
  });

  MASTER_REWARDS.forEach(function(reward) {
    upsertRowByKey_(DB_SHEETS.REWARDS, 'rewardId', reward.rewardId, reward);
  });

  MASTER_REWARD_GROUPS.forEach(function(group) {
    upsertRowByKey_(DB_SHEETS.REWARD_GROUPS, 'rewardGroupId', group.rewardGroupId, group);
  });

  buildStageSeedData_().forEach(function(stage) {
    upsertRowByKey_(DB_SHEETS.STAGES, 'stageId', stage.stageId, stage);
  });

  clearMasterTableCaches_();
}

/**
 * DEV ONLY: Clears all managed database sheets, then recreates headers and
 * master data. Do not run this in production because player and run data can be
 * permanently removed from the spreadsheet.
 */
function resetDatabaseForDev() {
  var spreadsheet = getSpreadsheet_();

  DB_SCHEMA.forEach(function(schema) {
    var sheet = spreadsheet.getSheetByName(schema.sheetName);
    if (sheet) {
      sheet.clear();
    }
  });

  setupDatabase();
  seedMasterData();
}

function upsertRowByKey_(sheetName, keyColumn, keyValue, object) {
  var existing = findRowByKey_(sheetName, keyColumn, keyValue);
  if (existing) {
    return updateRowByKey_(sheetName, keyColumn, keyValue, object);
  }
  return appendRowObject_(sheetName, object);
}

function getHeaderRow_(sheet) {
  var lastColumn = sheet.getLastColumn();
  if (lastColumn < 1) {
    return [];
  }

  return sheet.getRange(1, 1, 1, lastColumn).getValues()[0].filter(function(header) {
    return header !== '';
  });
}

function rowToObject_(headers, row) {
  return headers.reduce(function(object, header, index) {
    object[header] = row[index];
    return object;
  }, {});
}

function buildStageSeedData_() {
  var stages = [];

  for (var floor = 1; floor <= GAME_RULES.FLOOR_COUNT; floor += 1) {
    for (var stage = 1; stage <= GAME_RULES.STAGES_PER_FLOOR; stage += 1) {
      var globalStage = ((floor - 1) * GAME_RULES.STAGES_PER_FLOOR) + stage;
      var baseDifficulty = Math.min(GAME_RULES.MAX_DIFFICULTY, Math.max(GAME_RULES.MIN_DIFFICULTY, Math.ceil(globalStage / 3)));
      var isBossStage = stage === GAME_RULES.STAGES_PER_FLOOR;

      stages.push({
        stageId: 'floor_' + floor + '_stage_' + stage,
        floor: floor,
        stage: stage,
        name: floor + '층-' + stage + '스테이지',
        baseDifficulty: baseDifficulty,
        minDifficulty: Math.max(GAME_RULES.MIN_DIFFICULTY, baseDifficulty - 1),
        maxDifficulty: Math.min(GAME_RULES.MAX_DIFFICULTY, baseDifficulty + 1),
        monsterGroupId: 'group_floor_' + floor,
        bossMonsterId: isBossStage ? 'boss_floor_' + floor : '',
        rewardGroupId: 'reward_group_default',
        requiredOtherQuestionCount: GAME_RULES.DEFAULT_REQUIRED_OTHER_QUESTION_COUNT,
      });
    }
  }

  return stages;
}
