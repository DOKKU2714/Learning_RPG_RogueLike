var DB_SHEETS = Object.freeze({
  SETTINGS: 'Settings',
  ADMINS: 'Admins',
  PLAYERS: 'Players',
  PLAYER_DATA: 'PlayerData',
  RUNS: 'Runs',
  PLAYER_GHOSTS: 'PlayerGhosts',
  QUESTIONS: 'Questions',
  ANSWER_LOGS: 'AnswerLogs',
  STAGES: 'Stages',
  MONSTER_GROUPS: 'MonsterGroups',
  MONSTERS: 'Monsters',
  MONSTER_AI: 'MonsterAI',
  SKILLS: 'Skills',
  EFFECTS: 'Effects',
  ITEMS: 'Items',
  REWARDS: 'Rewards',
  BATTLE_LOGS: 'BattleLogs',
});

var DB_COLUMNS = Object.freeze({
  SETTINGS: ['key', 'value', 'type', 'description', 'updatedAt'],
  ADMINS: ['email', 'name', 'role', 'active', 'createdAt'],
  PLAYERS: ['playerId', 'studentId', 'studentName', 'passwordHash', 'passwordSalt', 'email', 'displayName', 'avatarType', 'avatarKey', 'createdAt', 'lastLoginAt', 'isActive'],
  PLAYER_DATA: ['playerId', 'maxFloor', 'maxStage', 'bestClearTimeMs', 'totalAnswerCount', 'correctAnswerCount', 'averageAnswerTimeMs', 'currency', 'baseStatsJson', 'ownedSkillsJson', 'ownedItemsJson', 'bestScore', 'bestScoreRunId', 'bestScoreUpdatedAt', 'updatedAt'],
  RUNS: ['runId', 'playerId', 'status', 'currentFloor', 'currentStage', 'currentHp', 'currentShield', 'statsJson', 'skillsJson', 'itemsJson', 'stageStateJson', 'startedAt', 'updatedAt', 'endedAt', 'clearTimeMs', 'currency', 'score'],
  PLAYER_GHOSTS: ['ghostId', 'sourceRunId', 'sourcePlayerId', 'sourceDisplayName', 'sourceAvatarType', 'sourceAvatarKey', 'floor', 'stage', 'status', 'spawnedRunId', 'spawnedPlayerId', 'spawnedBattleId', 'spawnedAt', 'createdAt'],
  QUESTIONS: ['questionId', 'type', 'prompt', 'choice1', 'choice2', 'choice3', 'choice4', 'answer', 'answerAliases', 'explanation', 'difficulty', 'creatorId', 'creatorName', 'subject', 'unit', 'tags', 'status', 'reviewComment', 'approvedBy', 'approvedAt', 'createdAt', 'updatedAt', 'correctCount', 'totalCount', 'likeCount', 'dislikeCount', 'reactionJson'],
  ANSWER_LOGS: ['answerLogId', 'questionId', 'playerId', 'creatorId', 'runId', 'battleId', 'floor', 'stage', 'actionType', 'selectedAnswer', 'isCorrect', 'elapsedMs', 'maxTimeMs', 'efficiency', 'finalDifficulty', 'isOtherPlayerQuestion', 'scoreDelta', 'createdAt'],
  STAGES: ['stageId', 'floor', 'stage', 'name', 'baseDifficulty', 'minDifficulty', 'maxDifficulty', 'monsterGroupId', 'bossMonsterId', 'rewardGroupId', 'requiredOtherQuestionCount'],
  MONSTER_GROUPS: ['monsterGroupId', 'name', 'monsterIds', 'weights', 'monsterCount'],
  MONSTERS: ['monsterId', 'name', 'type', 'hp', 'attack', 'hpRegen', 'evasion', 'criticalRate', 'criticalDamage', 'defense', 'aiId', 'skillIds', 'description'],
  MONSTER_AI: ['aiId', 'patternName', 'actionType', 'conditionJson', 'probability', 'skillId', 'intentIcon', 'intentTextTemplate'],
  SKILLS: ['skillId', 'name', 'type', 'target', 'baseValue', 'hitCount', 'cooldown', 'conditionJson', 'difficultyBonus', 'effectJson', 'upgradeJson', 'description', 'actionPointCost', 'rarity', 'tags'],
  EFFECTS: ['effectId', 'name', 'category', 'statKey', 'effectType', 'value', 'durationType', 'durationTurns', 'stackable', 'maxStacks', 'triggerTiming', 'description'],
  ITEMS: ['itemId', 'name', 'type', 'target', 'effectJson', 'triggerTiming', 'description', 'rarity'],
  REWARDS: ['rewardId', 'type', 'targetId', 'value', 'weight', 'minFloor', 'maxFloor', 'description', 'detailDescription', 'rarity'],
  BATTLE_LOGS: ['battleLogId', 'runId', 'playerId', 'floor', 'stage', 'result', 'summaryJson', 'createdAt'],
});

var DB_SCHEMA = Object.freeze([
  { sheetName: DB_SHEETS.SETTINGS, headers: DB_COLUMNS.SETTINGS },
  { sheetName: DB_SHEETS.ADMINS, headers: DB_COLUMNS.ADMINS },
  { sheetName: DB_SHEETS.PLAYERS, headers: DB_COLUMNS.PLAYERS },
  { sheetName: DB_SHEETS.PLAYER_DATA, headers: DB_COLUMNS.PLAYER_DATA },
  { sheetName: DB_SHEETS.RUNS, headers: DB_COLUMNS.RUNS },
  { sheetName: DB_SHEETS.PLAYER_GHOSTS, headers: DB_COLUMNS.PLAYER_GHOSTS },
  { sheetName: DB_SHEETS.QUESTIONS, headers: DB_COLUMNS.QUESTIONS },
  { sheetName: DB_SHEETS.ANSWER_LOGS, headers: DB_COLUMNS.ANSWER_LOGS },
  { sheetName: DB_SHEETS.STAGES, headers: DB_COLUMNS.STAGES },
  { sheetName: DB_SHEETS.MONSTER_GROUPS, headers: DB_COLUMNS.MONSTER_GROUPS },
  { sheetName: DB_SHEETS.MONSTERS, headers: DB_COLUMNS.MONSTERS },
  { sheetName: DB_SHEETS.MONSTER_AI, headers: DB_COLUMNS.MONSTER_AI },
  { sheetName: DB_SHEETS.SKILLS, headers: DB_COLUMNS.SKILLS },
  { sheetName: DB_SHEETS.EFFECTS, headers: DB_COLUMNS.EFFECTS },
  { sheetName: DB_SHEETS.ITEMS, headers: DB_COLUMNS.ITEMS },
  { sheetName: DB_SHEETS.REWARDS, headers: DB_COLUMNS.REWARDS },
  { sheetName: DB_SHEETS.BATTLE_LOGS, headers: DB_COLUMNS.BATTLE_LOGS },
]);

var STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  RUN_ACTIVE: 'active',
  RUN_FINISHED: 'finished',
  RUN_CLEARED: 'cleared',
  RUN_FAILED: 'failed',
  BATTLE_ACTIVE: 'active',
  BATTLE_VICTORY: 'victory',
  BATTLE_DEFEAT: 'defeat',
  GHOST_ACTIVE: 'active',
  GHOST_CONSUMED: 'consumed',
  QUESTION_DRAFT: 'draft',
  QUESTION_PENDING: 'pending',
  QUESTION_APPROVED: 'approved',
  QUESTION_REJECTED: 'rejected',
});

var AVATAR_TYPES = Object.freeze({
  INITIAL: 'initial',
  DEFAULT: 'default',
  PHOTO: 'photo',
});

var QUESTION_TYPES = Object.freeze({
  MULTIPLE_CHOICE: 'multipleChoice',
  SHORT_ANSWER: 'shortAnswer',
});

var ACTION_TYPES = Object.freeze({
  ATTACK: 'attack',
  GUARD: 'guard',
  SKILL: 'skill',
});

var SKILL_TYPES = Object.freeze({
  DAMAGE: 'damage',
  SHIELD: 'shield',
  HEAL: 'heal',
  BUFF: 'buff',
  DEBUFF: 'debuff',
});

var REWARD_TYPES = Object.freeze({
  STAT: 'stat',
  SKILL: 'skill',
  SKILL_UPGRADE: 'skillUpgrade',
  ITEM: 'item',
  REST: 'rest',
});

var RARITIES = Object.freeze({
  COMMON: 'common',
  UNCOMMON: 'uncommon',
  RARE: 'rare',
  EPIC: 'epic',
  LEGENDARY: 'legendary',
  UNIQUE: 'unique',
});

var RARITY_LABELS = Object.freeze({
  common: '일반',
  uncommon: '드문',
  rare: '희귀',
  epic: '영웅',
  legendary: '전설',
  unique: '고유',
});

var EFFECT_CATEGORIES = Object.freeze({
  BUFF: 'buff',
  DEBUFF: 'debuff',
});

var EFFECT_TYPES = Object.freeze({
  FLAT: 'flat',
  PERCENT: 'percent',
  CONTROL: 'control',
});

var DURATION_TYPES = Object.freeze({
  STAGE: 'stage',
  TURN: 'turn',
});

var TRIGGER_TIMINGS = Object.freeze({
  TURN_START: 'turnStart',
  TURN_END: 'turnEnd',
  ON_ACTION: 'onAction',
  ON_HIT: 'onHit',
  PASSIVE: 'passive',
});

var STAT_KEYS = Object.freeze({
  ATTACK: 'attack',
  HP: 'hp',
  HP_REGEN: 'hpRegen',
  EVASION: 'evasion',
  CRITICAL_RATE: 'criticalRate',
  CRITICAL_DAMAGE: 'criticalDamage',
  DEFENSE: 'defense',
  ACCURACY: 'accuracy',
  QUESTION_TIME: 'questionTime',
  QUESTION_DIFFICULTY: 'questionDifficulty',
});

var BASE_PLAYER_STATS = Object.freeze({
  attack: 10,
  hp: 100,
  hpRegen: 5,
  evasion: 0,
  criticalRate: 5,
  criticalDamage: 150,
  defense: 0,
  accuracy: 100,
});

var ITEM_EFFECT_TYPES = Object.freeze({
  STAT: 'stat',
  DAMAGE_DEALT_PERCENT: 'damageDealtPercent',
  DAMAGE_TAKEN_PERCENT: 'damageTakenPercent',
  BASIC_ATTACK_DAMAGE_PERCENT: 'basicAttackDamagePercent',
  SKILL_DAMAGE_PERCENT: 'skillDamagePercent',
  SKILL_EXTRA_DAMAGE: 'skillExtraDamage',
  BATTLE_START_EFFECT: 'battleStartEffect',
  QUESTION_DIFFICULTY: 'questionDifficulty',
  QUESTION_MAX_EFFICIENCY_PERCENT: 'questionMaxEfficiencyPercent',
  QUESTION_TIME: 'questionTime',
  QUESTION_TYPE_CHANCE_PERCENT: 'questionTypeChancePercent',
  ANSWER_CORRECT_EFFICIENCY_PERCENT: 'answerCorrectEfficiencyPercent',
  SHORT_ANSWER_CHANCE_PERCENT: 'shortAnswerChancePercent',
  SHORT_ANSWER_CORRECT_EFFICIENCY_PERCENT: 'shortAnswerCorrectEfficiencyPercent',
});

var ITEM_REWARD_CONFIG = Object.freeze({
  rarityWeights: Object.freeze({
    common: 50,
    uncommon: 25,
    rare: 15,
    epic: 7,
    legendary: 2,
    unique: 1,
  }),
  preventDuplicateUniqueItems: true,
  allowDuplicateNonUniqueItems: false,
  excludeOwnedItems: true,
});

var SKILL_REWARD_CONFIG = Object.freeze({
  rarityWeights: Object.freeze({
    common: 50,
    uncommon: 25,
    rare: 15,
    epic: 7,
    legendary: 2,
    unique: 1,
  }),
  excludeOwnedSkills: true,
});

var SKILL_UPGRADE_REWARD_CONFIG = Object.freeze({
  rarityWeights: Object.freeze({
    common: 50,
    uncommon: 25,
    rare: 15,
    epic: 7,
    legendary: 2,
    unique: 1,
  }),
  onlyOwnedSkills: true,
});

var REWARD_CONFIG = Object.freeze({
  choicesCount: 3,
  ensureItemRewardChoice: false,
  currencyMin: 5,
  currencyMax: 15,
  typeWeights: Object.freeze({
    stat: 40,
    skill: 30,
    skillUpgrade: 25,
    item: 20,
  }),
});

var GAME_RULES = Object.freeze({
  FLOOR_COUNT: 5,
  STAGES_PER_FLOOR: 5,
  FLOOR_REST_STAGE: 6,
  FLOOR_REST_HEAL_PERCENT: 25,
  MIN_DIFFICULTY: 1,
  MAX_DIFFICULTY: 5,
  DEFAULT_REQUIRED_OTHER_QUESTION_COUNT: 1,
  BASE_GUARD_SHIELD: 5,
  DEFAULT_MAX_ACTION_POINT: 3,
  BASE_QUESTION_TIME_SEC: 10,
  QUESTION_TIME_PER_DIFFICULTY_SEC: 2,
  SHORT_ANSWER_TIME_MULTIPLIER: 1.2,
  MIN_ANSWER_EFFICIENCY: 0.5,
  MAX_ANSWER_EFFICIENCY: 1.25,
  EXTRA_WRONG_EFFICIENCY_PENALTY: 0.1,
  PLAYER_GHOST_OFF_FLOOR_CHANCE: 10,
});

var PLAYER_GHOST_FLOOR_CONFIGS = Object.freeze({
  1: { hp: 55, attack: 9, defense: 1, aiId: 'ai_player_ghost_floor_1', skillIds: '[]' },
  2: { hp: 75, attack: 12, defense: 2, aiId: 'ai_player_ghost_floor_2', skillIds: '["skill_bleeding_mark"]' },
  3: { hp: 100, attack: 16, defense: 3, aiId: 'ai_player_ghost_floor_3', skillIds: '["skill_bleeding_mark"]' },
  4: { hp: 130, attack: 21, defense: 4, aiId: 'ai_player_ghost_floor_4', skillIds: '["skill_bleeding_mark","skill_guard_focus"]' },
  5: { hp: 165, attack: 27, defense: 5, aiId: 'ai_player_ghost_floor_5', skillIds: '["skill_bleeding_mark","skill_guard_focus"]' },
});

var MASTER_SETTINGS = Object.freeze([
  { key: 'appVersion', value: '0.5', type: 'string', description: 'Current app data version.' },
  { key: 'gameEnabled', value: 'false', type: 'boolean', description: 'Whether students can start the game.' },
  { key: 'floorCount', value: '5', type: 'number', description: 'Total number of floors.' },
  { key: 'stagesPerFloor', value: '5', type: 'number', description: 'Number of stages per floor.' },
  { key: 'baseQuestionTimeSec', value: '10', type: 'number', description: 'Base question time in seconds.' },
  { key: 'questionTimePerDifficultySec', value: '2', type: 'number', description: 'Additional seconds per difficulty above 1.' },
  { key: 'questionResultHoldMs', value: '1400', type: 'number', description: 'Milliseconds to keep the correct-answer result visible before battle resolution continues.' },
  { key: 'questionActionStartDelayMs', value: '0', type: 'number', description: 'Milliseconds to wait after closing the question modal before playing the battle action.' },
  { key: 'firstStageIntroLinesJson', value: JSON.stringify([
    { text: '눈을 떠보니 학교 옥상이다 .', sparkleDot: true },
    { text: '일단 여기서 나가야겠다.' },
    { text: '눈앞에 무언가 나타났다!' },
  ]), type: 'json', description: 'Narration lines shown before the first battle of a new run. Use [{text, sparkleDot}].' },
  { key: 'minAnswerEfficiency', value: '0.5', type: 'number', description: 'Minimum normal answer efficiency.' },
  { key: 'maxAnswerEfficiency', value: '1.25', type: 'number', description: 'Maximum answer efficiency.' },
  { key: 'extraWrongEfficiencyPenalty', value: '0.1', type: 'number', description: 'Efficiency penalty after timeout or repeated wrong answers.' },
  { key: 'basePlayerStatsJson', value: JSON.stringify(BASE_PLAYER_STATS), type: 'json', description: 'Default player base stats.' },
]);

var MASTER_EFFECTS = Object.freeze([
  { effectId: 'debuff_bleed', name: '출혈', category: EFFECT_CATEGORIES.DEBUFF, statKey: 'hp', effectType: EFFECT_TYPES.FLAT, value: -5, durationType: DURATION_TYPES.TURN, durationTurns: 3, stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.ON_ACTION, description: 'N턴 간 행동할 때마다 피해를 받는다.' },
  { effectId: 'debuff_poison', name: '중독', category: EFFECT_CATEGORIES.DEBUFF, statKey: 'hp', effectType: EFFECT_TYPES.FLAT, value: -5, durationType: DURATION_TYPES.TURN, durationTurns: 3, stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.TURN_END, description: 'N턴 간 턴 종료 시 피해를 받는다.' },
  { effectId: 'debuff_freeze', name: '빙결', category: EFFECT_CATEGORIES.DEBUFF, statKey: 'action', effectType: EFFECT_TYPES.CONTROL, value: 0, durationType: DURATION_TYPES.TURN, durationTurns: 2, stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '2턴 행동 불가. 공격받으면 추가 피해와 함께 해제된다.' },
  { effectId: 'debuff_burn', name: '발화', category: EFFECT_CATEGORIES.DEBUFF, statKey: 'hp', effectType: EFFECT_TYPES.FLAT, value: -5, durationType: DURATION_TYPES.TURN, durationTurns: 3, stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.TURN_START, description: 'N턴 간 턴 시작 시 피해를 받는다.' },
  { effectId: 'debuff_stun', name: '기절', category: EFFECT_CATEGORIES.DEBUFF, statKey: 'action', effectType: EFFECT_TYPES.CONTROL, value: 0, durationType: DURATION_TYPES.TURN, durationTurns: 1, stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '1턴 행동 불가.' },
  { effectId: 'debuff_weak', name: '약화', category: EFFECT_CATEGORIES.DEBUFF, statKey: STAT_KEYS.ATTACK, effectType: EFFECT_TYPES.PERCENT, value: -25, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '공격력 25% 감소.' },
  { effectId: 'debuff_corrosion', name: '부식', category: EFFECT_CATEGORIES.DEBUFF, statKey: STAT_KEYS.DEFENSE, effectType: EFFECT_TYPES.PERCENT, value: -33, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '방어력 33% 감소.' },
  { effectId: 'debuff_dazed', name: '멍해짐', category: EFFECT_CATEGORIES.DEBUFF, statKey: STAT_KEYS.QUESTION_TIME, effectType: EFFECT_TYPES.FLAT, value: -3, durationType: DURATION_TYPES.TURN, durationTurns: 3, stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: 'N턴간 문제 풀이 제한시간 -3초.' },
  { effectId: 'debuff_foolish', name: '멍청해짐', category: EFFECT_CATEGORIES.DEBUFF, statKey: '', effectType: EFFECT_TYPES.CONTROL, value: 0, durationType: DURATION_TYPES.TURN, durationTurns: 3, stackable: true, maxStacks: 99, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '정신이 흐려진 상태입니다.' },
  { effectId: 'buff_power', name: '힘', category: EFFECT_CATEGORIES.BUFF, statKey: STAT_KEYS.ATTACK, effectType: EFFECT_TYPES.FLAT, value: 2, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: true, maxStacks: 99, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '공격력 n 증가. 스택 가능.' },
  { effectId: 'buff_hard', name: '단단함', category: EFFECT_CATEGORIES.BUFF, statKey: STAT_KEYS.DEFENSE, effectType: EFFECT_TYPES.FLAT, value: 2, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: true, maxStacks: 99, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '방어력 n 증가. 스택 가능.' },
  { effectId: 'buff_focus', name: '집중', category: EFFECT_CATEGORIES.BUFF, statKey: STAT_KEYS.CRITICAL_RATE, effectType: EFFECT_TYPES.FLAT, value: 20, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: true, maxStacks: 99, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '치명타 확률 n% 증가. 스택 가능.' },
  { effectId: 'buff_smart', name: '똑똑해짐', category: EFFECT_CATEGORIES.BUFF, statKey: STAT_KEYS.QUESTION_DIFFICULTY, effectType: EFFECT_TYPES.FLAT, value: -1, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '문제 난이도 -1. 최소 난이도 1 고정.' },
  { effectId: 'buff_wisdom', name: '지혜', category: EFFECT_CATEGORIES.BUFF, statKey: STAT_KEYS.QUESTION_TIME, effectType: EFFECT_TYPES.FLAT, value: 3, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '문제 풀이 제한시간 +n초.' },
]);

var MASTER_SKILLS = Object.freeze([
  {
    skillId: 'skill_basic_slash',
    name: '깊게 베기',
    type: SKILL_TYPES.DAMAGE,
    target: 'enemy',
    baseValue: 18,
    hitCount: 1,
    cooldown: '',
    conditionJson: '{"afterTurn":1,"perStageLimit":3}',
    difficultyBonus: 1,
    effectJson: '{}',
    upgradeJson: '{"damage":4,"chance":0,"effect":0,"buffValue":0,"debuffChance":0}',
    description: '적 하나에게 큰 피해를 준다.',
    actionPointCost: 1,
    rarity: RARITIES.RARE,
    tags: '["attack","slash","singleTarget"]',
  },
  {
    skillId: 'skill_guard_focus',
    name: '집중 방어',
    type: SKILL_TYPES.SHIELD,
    target: 'self',
    baseValue: 28,
    hitCount: 1,
    cooldown: '',
    conditionJson: '{"afterTurn":1,"perStageLimit":2}',
    difficultyBonus: 1,
    effectJson: '{"effectId":"buff_hard","chance":100}',
    upgradeJson: '{"damage":0,"chance":0,"effect":0,"buffValue":1,"debuffChance":0}',
    description: '방어막을 만들고 단단함을 얻는다.',
    actionPointCost: 1,
    rarity: RARITIES.UNCOMMON,
    tags: '["shield","defense","buff"]',
  },
  {
    skillId: 'skill_first_aid',
    name: '응급 처치',
    type: SKILL_TYPES.HEAL,
    target: 'self',
    baseValue: 20,
    hitCount: 1,
    cooldown: '',
    conditionJson: '{"selfHpBelowPercent":60,"perStageLimit":1}',
    difficultyBonus: 1,
    effectJson: '{}',
    upgradeJson: '{"damage":0,"chance":0,"effect":3,"buffValue":0,"debuffChance":0}',
    description: '체력을 회복한다. 체력이 낮을 때만 사용할 수 있다.',
    actionPointCost: 1,
    rarity: RARITIES.UNCOMMON,
    tags: '["heal","recovery"]',
  },
  {
    skillId: 'skill_power_shout',
    name: '힘의 외침',
    type: SKILL_TYPES.BUFF,
    target: 'self',
    baseValue: 0,
    hitCount: 1,
    cooldown: '',
    conditionJson: '{"afterTurn":2,"perStageLimit":2}',
    difficultyBonus: 1,
    effectJson: '{"effectId":"buff_power","chance":100}',
    upgradeJson: '{"damage":0,"chance":0,"effect":0,"buffValue":1,"debuffChance":0}',
    description: '힘 버프를 얻는다.',
    actionPointCost: 1,
    rarity: RARITIES.RARE,
    tags: '["buff","attack"]',
  },
  {
    skillId: 'skill_bleeding_mark',
    name: '출혈 표식',
    type: SKILL_TYPES.DEBUFF,
    target: 'enemy',
    baseValue: 0,
    hitCount: 1,
    cooldown: '',
    conditionJson: '{"afterTurn":1,"targetHpAbovePercent":20,"perStageLimit":2}',
    difficultyBonus: 2,
    effectJson: '{"effectId":"debuff_bleed","chance":100}',
    upgradeJson: '{"damage":0,"chance":0,"effect":0,"buffValue":0,"debuffChance":10}',
    description: '적에게 출혈을 건다.',
    actionPointCost: 1,
    rarity: RARITIES.RARE,
    tags: '["debuff","bleed"]',
  },
]);

var MASTER_MONSTER_AI = Object.freeze([
  { aiId: 'ai_basic_attack', patternName: '기본 공격', actionType: 'attack', conditionJson: '{}', probability: 100, skillId: '', intentIcon: 'sword', intentTextTemplate: '공격하려고 합니다.' },
]);

var MASTER_MONSTERS = Object.freeze([
  { monsterId: 'monster_shadow_problem', name: '그림자 문제', type: 'normal', hp: 45, attack: 8, hpRegen: 0, evasion: 3, criticalRate: 3, criticalDamage: 150, defense: 1, aiId: 'ai_basic_attack', skillIds: '[]', description: '민첩한 기본 전투 대상.' },
  { monsterId: 'boss_floor_1', name: '1층 보스', type: 'boss', hp: 90, attack: 12, hpRegen: 0, evasion: 2, criticalRate: 5, criticalDamage: 150, defense: 2, aiId: 'ai_basic_attack', skillIds: '[]', description: '1층 마지막 스테이지 보스.' },
  { monsterId: 'boss_floor_2', name: '2층 보스', type: 'boss', hp: 130, attack: 16, hpRegen: 1, evasion: 3, criticalRate: 5, criticalDamage: 150, defense: 3, aiId: 'ai_basic_attack', skillIds: '[]', description: '2층 마지막 스테이지 보스.' },
  { monsterId: 'boss_floor_3', name: '3층 보스', type: 'boss', hp: 170, attack: 20, hpRegen: 2, evasion: 4, criticalRate: 6, criticalDamage: 150, defense: 4, aiId: 'ai_basic_attack', skillIds: '[]', description: '3층 마지막 스테이지 보스.' },
  { monsterId: 'boss_floor_4', name: '4층 보스', type: 'boss', hp: 220, attack: 25, hpRegen: 3, evasion: 5, criticalRate: 7, criticalDamage: 150, defense: 5, aiId: 'ai_basic_attack', skillIds: '[]', description: '4층 마지막 스테이지 보스.' },
  { monsterId: 'boss_floor_5', name: '5층 보스', type: 'finalBoss', hp: 300, attack: 32, hpRegen: 5, evasion: 6, criticalRate: 8, criticalDamage: 150, defense: 7, aiId: 'ai_basic_attack', skillIds: '[]', description: '5층 최종 보스.' },
]);

var MASTER_MONSTER_GROUPS = Object.freeze([
  { monsterGroupId: 'group_floor_1', name: '1층 일반 몬스터', monsterIds: '["monster_shadow_problem"]', weights: '[100]', monsterCount: 1 },
  { monsterGroupId: 'group_floor_2', name: '2층 일반 몬스터', monsterIds: '["monster_shadow_problem"]', weights: '[100]', monsterCount: 1 },
  { monsterGroupId: 'group_floor_3', name: '3층 일반 몬스터', monsterIds: '["monster_shadow_problem"]', weights: '[100]', monsterCount: 1 },
  { monsterGroupId: 'group_floor_4', name: '4층 일반 몬스터', monsterIds: '["monster_shadow_problem"]', weights: '[100]', monsterCount: 1 },
  { monsterGroupId: 'group_floor_5', name: '5층 일반 몬스터', monsterIds: '["monster_shadow_problem"]', weights: '[100]', monsterCount: 1 },
]);

var MASTER_REWARDS = Object.freeze([
  { rewardId: 'reward_stat_attack_2', type: REWARD_TYPES.STAT, targetId: STAT_KEYS.ATTACK, value: 2, weight: 30, minFloor: 1, maxFloor: 5, description: '공격력 +2', detailDescription: '기본 공격과 공격형 스킬 피해가 증가합니다.', rarity: RARITIES.COMMON },
  { rewardId: 'reward_stat_hp_10', type: REWARD_TYPES.STAT, targetId: STAT_KEYS.HP, value: 10, weight: 25, minFloor: 1, maxFloor: 5, description: '최대 체력 +10', detailDescription: '최대 체력이 증가하고 현재 체력도 함께 회복됩니다.', rarity: RARITIES.COMMON },
  { rewardId: 'reward_stat_defense_2', type: REWARD_TYPES.STAT, targetId: STAT_KEYS.DEFENSE, value: 2, weight: 25, minFloor: 1, maxFloor: 5, description: '방어력 +2', detailDescription: '수비 행동으로 얻는 방어막 수치가 증가합니다.', rarity: RARITIES.COMMON },
  { rewardId: 'reward_stat_critical_rate_3', type: REWARD_TYPES.STAT, targetId: STAT_KEYS.CRITICAL_RATE, value: 3, weight: 15, minFloor: 1, maxFloor: 5, description: '치명타 확률 +3', detailDescription: '공격 시 치명타가 발생할 확률이 증가합니다.', rarity: RARITIES.UNCOMMON },
]);

var MASTER_ITEMS = Object.freeze([
  { itemId: 'item_knuckle', name: '너클', type: 'passive', target: 'self', effectJson: '[{"type":"skillExtraDamage","skillName":"타격","skillId":"skill_strike","skillTag":"strike","value":3,"summary":"타격 스킬 사용 시 3의 추가 피해"}]', triggerTiming: 'onSkillUse', description: '', rarity: RARITIES.LEGENDARY },
  { itemId: 'item_yut', name: '윷', type: 'passive', target: 'self', effectJson: '[{"type":"battleStartEffect","effectId":"debuff_foolish","stacks":3,"summary":"매 전투 시작 시 멍청해짐 3중첩"},{"type":"damageDealtPercent","value":20,"summary":"피해 증폭 +20%"}]', triggerTiming: 'battleStart', description: '', rarity: RARITIES.EPIC },
  { itemId: 'item_combat_boots', name: '전투화', type: 'passive', target: 'self', effectJson: '[{"type":"stat","statKey":"evasion","effectType":"flat","value":-5,"summary":"회피율 -5%"},{"type":"stat","statKey":"defense","effectType":"flat","value":2,"summary":"방어력 +2"}]', triggerTiming: 'passive', description: '', rarity: RARITIES.COMMON },
  { itemId: 'item_smartphone', name: '스마트폰', type: 'passive', target: 'self', effectJson: '[{"type":"questionDifficulty","value":-1,"summary":"문제 난이도 -1"},{"type":"questionMaxEfficiencyPercent","value":-15,"summary":"문제 최대 효율 -15%"}]', triggerTiming: 'passive', description: '', rarity: RARITIES.UNIQUE },
  { itemId: 'item_good_feel_pen', name: '느좋 볼펜', type: 'passive', target: 'self', effectJson: '[{"type":"shortAnswerCorrectEfficiencyPercent","value":10,"summary":"주관식 문제 정답 시 효율 +10%"},{"type":"shortAnswerChancePercent","value":10,"summary":"주관식 문제 확률 +10%"}]', triggerTiming: 'passive', description: '괜히 글을 쓰고싶어지는 볼펜이다.', rarity: RARITIES.RARE },
  { itemId: 'item_suspicious_glasses', name: '뭔가 수상한 안경', type: 'passive', target: 'self', effectJson: '[{"type":"stat","statKey":"criticalRate","effectType":"flat","value":20,"summary":"치명타 확률 +20%"},{"type":"stat","statKey":"criticalDamage","effectType":"flat","value":-20,"summary":"치명타 피해 -20%"}]', triggerTiming: 'passive', description: '', rarity: RARITIES.EPIC },
  { itemId: 'item_roka_tshirt', name: 'ROKA 티셔츠', type: 'passive', target: 'self', effectJson: '[{"type":"stat","statKey":"hp","effectType":"flat","value":-5,"summary":"최대 체력 -5"},{"type":"stat","statKey":"defense","effectType":"flat","value":-1,"summary":"방어력 -1"},{"type":"damageTakenPercent","value":20,"summary":"입는 피해 +20%"},{"type":"damageDealtPercent","value":20,"summary":"피해 증폭 +20%"}]', triggerTiming: 'passive', description: '어른이 된 느낌', rarity: RARITIES.UNIQUE },
  { itemId: 'item_goalkeeper_gloves', name: '골키퍼 장갑', type: 'passive', target: 'self', effectJson: '[{"type":"stat","statKey":"hp","effectType":"flat","value":5,"summary":"최대 체력 +5"},{"type":"stat","statKey":"attack","effectType":"flat","value":-2,"summary":"공격력 -2"}]', triggerTiming: 'passive', description: '', rarity: RARITIES.UNCOMMON },
  { itemId: 'item_compass', name: '컴퍼스', type: 'passive', target: 'self', effectJson: '[{"type":"stat","statKey":"attack","effectType":"flat","value":3,"summary":"공격력 +3"},{"type":"stat","statKey":"hp","effectType":"flat","value":-5,"summary":"최대 체력 -5"}]', triggerTiming: 'passive', description: '', rarity: RARITIES.COMMON },
  { itemId: 'item_dice', name: '주사위', type: 'passive', target: 'self', effectJson: '[{"type":"questionTime","questionType":"multipleChoice","value":2,"summary":"객관식 문제 시간 +2초"},{"type":"questionTime","questionType":"shortAnswer","value":-2,"summary":"주관식 문제 시간 -2초"}]', triggerTiming: 'passive', description: '', rarity: RARITIES.COMMON },
  { itemId: 'item_dirty_eyepatch', name: '더러운 안대', type: 'passive', target: 'self', effectJson: '[{"type":"stat","statKey":"accuracy","effectType":"flat","value":-15,"summary":"명중률 -15%"},{"type":"stat","statKey":"criticalRate","effectType":"flat","value":20,"summary":"치명타 확률 +20%"}]', triggerTiming: 'passive', description: '', rarity: RARITIES.COMMON },
  { itemId: 'item_top_student_note', name: '전교 1등의 노트', type: 'passive', target: 'self', effectJson: '[{"type":"battleStartEffect","effectId":"buff_smart","stacks":1,"summary":"전투 시작 시 똑똑해짐 획득"},{"type":"questionMaxEfficiencyPercent","value":10,"summary":"문제 최대 효율 +10%"}]', triggerTiming: 'battleStart', description: '', rarity: RARITIES.UNIQUE },
  { itemId: 'item_fountain_pen', name: '만년필', type: 'passive', target: 'self', effectJson: '[{"type":"stat","statKey":"attack","effectType":"flat","value":3,"summary":"공격력 +3"},{"type":"stat","statKey":"evasion","effectType":"flat","value":-10,"summary":"회피율 -10%"}]', triggerTiming: 'passive', description: '다른 용도로 사용할 수 있을 것 같다.', rarity: RARITIES.RARE },
  { itemId: 'item_fake_gun', name: '총?', type: 'passive', target: 'self', effectJson: '[{"type":"stat","statKey":"attack","effectType":"percent","value":20,"summary":"공격력 +20%"},{"type":"stat","statKey":"criticalDamage","effectType":"flat","value":50,"summary":"치명타 피해 +50%"},{"type":"stat","statKey":"defense","effectType":"flat","value":-5,"summary":"방어력 -5"}]', triggerTiming: 'passive', description: '진짜 총은 아닌 듯 하다.', rarity: RARITIES.UNIQUE },
  { itemId: 'item_suspicious_bag', name: '수상한 가방', type: 'passive', target: 'self', effectJson: '[{"type":"skillDamagePercent","value":20,"summary":"스킬 피해 +20%"},{"type":"basicAttackDamagePercent","value":-30,"summary":"일반 공격 피해 -30%"}]', triggerTiming: 'passive', description: '', rarity: RARITIES.EPIC },
  { itemId: 'item_sneakers', name: '운동화', type: 'passive', target: 'self', effectJson: '[{"type":"stat","statKey":"evasion","effectType":"flat","value":15,"summary":"회피율 +15%"},{"type":"stat","statKey":"criticalRate","effectType":"flat","value":-10,"summary":"치명타 확률 -10%"}]', triggerTiming: 'passive', description: '', rarity: RARITIES.COMMON },
  { itemId: 'item_sword_stick', name: '검 모양 막대기', type: 'passive', target: 'self', effectJson: '[{"type":"stat","statKey":"attack","effectType":"flat","value":5,"summary":"공격력 +5"},{"type":"stat","statKey":"defense","effectType":"flat","value":-3,"summary":"방어력 -3"}]', triggerTiming: 'passive', description: '', rarity: RARITIES.UNCOMMON },
]);
