var DB_SHEETS = Object.freeze({
  SETTINGS: 'Settings',
  ADMINS: 'Admins',
  PLAYERS: 'Players',
  PLAYER_DATA: 'PlayerData',
  RUNS: 'Runs',
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
  REWARD_GROUPS: 'RewardGroups',
  BATTLE_LOGS: 'BattleLogs',
});

var DB_COLUMNS = Object.freeze({
  SETTINGS: ['key', 'value', 'type', 'description', 'updatedAt'],
  ADMINS: ['email', 'name', 'role', 'active', 'createdAt'],
  PLAYERS: ['playerId', 'email', 'displayName', 'avatarType', 'avatarKey', 'createdAt', 'lastLoginAt', 'isActive'],
  PLAYER_DATA: ['playerId', 'maxFloor', 'maxStage', 'bestClearTimeMs', 'totalAnswerCount', 'correctAnswerCount', 'averageAnswerTimeMs', 'currency', 'baseStatsJson', 'ownedSkillsJson', 'ownedItemsJson', 'updatedAt'],
  RUNS: ['runId', 'playerId', 'status', 'currentFloor', 'currentStage', 'currentHp', 'currentShield', 'statsJson', 'skillsJson', 'itemsJson', 'stageStateJson', 'startedAt', 'updatedAt', 'endedAt', 'clearTimeMs'],
  QUESTIONS: ['questionId', 'type', 'prompt', 'choice1', 'choice2', 'choice3', 'choice4', 'answer', 'answerAliases', 'explanation', 'difficulty', 'creatorId', 'creatorName', 'subject', 'unit', 'tags', 'status', 'reviewComment', 'approvedBy', 'approvedAt', 'createdAt', 'updatedAt', 'correctCount', 'totalCount'],
  ANSWER_LOGS: ['answerLogId', 'questionId', 'playerId', 'creatorId', 'runId', 'battleId', 'floor', 'stage', 'actionType', 'selectedAnswer', 'isCorrect', 'elapsedMs', 'maxTimeMs', 'efficiency', 'finalDifficulty', 'isOtherPlayerQuestion', 'createdAt'],
  STAGES: ['stageId', 'floor', 'stage', 'name', 'baseDifficulty', 'minDifficulty', 'maxDifficulty', 'monsterGroupId', 'bossMonsterId', 'rewardGroupId', 'requiredOtherQuestionCount'],
  MONSTER_GROUPS: ['monsterGroupId', 'name', 'monsterIds', 'weights'],
  MONSTERS: ['monsterId', 'name', 'type', 'imageKey', 'hp', 'attack', 'hpRegen', 'evasion', 'criticalRate', 'criticalDamage', 'defense', 'aiId', 'skillIds', 'description'],
  MONSTER_AI: ['aiId', 'patternName', 'actionType', 'conditionJson', 'probability', 'skillId', 'intentIcon', 'intentTextTemplate'],
  SKILLS: ['skillId', 'name', 'type', 'target', 'baseValue', 'hitCount', 'cooldown', 'conditionJson', 'difficultyBonus', 'effectJson', 'upgradeJson', 'description'],
  EFFECTS: ['effectId', 'name', 'category', 'statKey', 'effectType', 'value', 'durationType', 'durationTurns', 'stackable', 'maxStacks', 'triggerTiming', 'description'],
  ITEMS: ['itemId', 'name', 'type', 'target', 'effectJson', 'triggerTiming', 'description'],
  REWARDS: ['rewardId', 'type', 'targetId', 'value', 'weight', 'minFloor', 'maxFloor', 'description'],
  REWARD_GROUPS: ['rewardGroupId', 'rewardIds', 'currencyMin', 'currencyMax', 'description'],
  BATTLE_LOGS: ['battleLogId', 'runId', 'playerId', 'floor', 'stage', 'result', 'summaryJson', 'createdAt'],
});

var DB_SCHEMA = Object.freeze([
  { sheetName: DB_SHEETS.SETTINGS, headers: DB_COLUMNS.SETTINGS },
  { sheetName: DB_SHEETS.ADMINS, headers: DB_COLUMNS.ADMINS },
  { sheetName: DB_SHEETS.PLAYERS, headers: DB_COLUMNS.PLAYERS },
  { sheetName: DB_SHEETS.PLAYER_DATA, headers: DB_COLUMNS.PLAYER_DATA },
  { sheetName: DB_SHEETS.RUNS, headers: DB_COLUMNS.RUNS },
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
  { sheetName: DB_SHEETS.REWARD_GROUPS, headers: DB_COLUMNS.REWARD_GROUPS },
  { sheetName: DB_SHEETS.BATTLE_LOGS, headers: DB_COLUMNS.BATTLE_LOGS },
]);

var STATUS = Object.freeze({
  ACTIVE: 'active',
  INACTIVE: 'inactive',
  RUN_ACTIVE: 'active',
  RUN_CLEARED: 'cleared',
  RUN_FAILED: 'failed',
  QUESTION_DRAFT: 'draft',
  QUESTION_APPROVED: 'approved',
  QUESTION_REJECTED: 'rejected',
});

var AVATAR_TYPES = Object.freeze({
  INITIALS: 'initials',
  DEFAULT: 'default',
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
});

var GAME_RULES = Object.freeze({
  FLOOR_COUNT: 5,
  STAGES_PER_FLOOR: 5,
  MIN_DIFFICULTY: 1,
  MAX_DIFFICULTY: 10,
  DEFAULT_REQUIRED_OTHER_QUESTION_COUNT: 1,
});

var MASTER_SETTINGS = Object.freeze([
  { key: 'appVersion', value: '0.5', type: 'string', description: 'Current app data version.' },
  { key: 'floorCount', value: '5', type: 'number', description: 'Total number of floors.' },
  { key: 'stagesPerFloor', value: '5', type: 'number', description: 'Number of stages per floor.' },
  { key: 'baseQuestionTimeSec', value: '10', type: 'number', description: 'Base question time in seconds.' },
  { key: 'questionTimePerDifficultySec', value: '2', type: 'number', description: 'Additional seconds per difficulty above 1.' },
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
  { effectId: 'debuff_foolish', name: '멍청해짐', category: EFFECT_CATEGORIES.DEBUFF, statKey: STAT_KEYS.QUESTION_DIFFICULTY, effectType: EFFECT_TYPES.FLAT, value: 1, durationType: DURATION_TYPES.TURN, durationTurns: 3, stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: 'N턴간 문제 난이도 +1.' },
  { effectId: 'buff_power', name: '힘', category: EFFECT_CATEGORIES.BUFF, statKey: STAT_KEYS.ATTACK, effectType: EFFECT_TYPES.FLAT, value: 2, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: true, maxStacks: 99, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '공격력 n 증가. 스택 가능.' },
  { effectId: 'buff_hard', name: '단단함', category: EFFECT_CATEGORIES.BUFF, statKey: STAT_KEYS.DEFENSE, effectType: EFFECT_TYPES.FLAT, value: 2, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: true, maxStacks: 99, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '방어력 n 증가. 스택 가능.' },
  { effectId: 'buff_focus', name: '집중', category: EFFECT_CATEGORIES.BUFF, statKey: STAT_KEYS.CRITICAL_RATE, effectType: EFFECT_TYPES.FLAT, value: 5, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: true, maxStacks: 99, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '치명타 확률 n% 증가. 스택 가능.' },
  { effectId: 'buff_smart', name: '똑똑해짐', category: EFFECT_CATEGORIES.BUFF, statKey: STAT_KEYS.QUESTION_DIFFICULTY, effectType: EFFECT_TYPES.FLAT, value: -1, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '문제 난이도 -1. 최소 난이도 1 고정.' },
  { effectId: 'buff_wisdom', name: '지혜', category: EFFECT_CATEGORIES.BUFF, statKey: STAT_KEYS.QUESTION_TIME, effectType: EFFECT_TYPES.FLAT, value: 3, durationType: DURATION_TYPES.STAGE, durationTurns: '', stackable: false, maxStacks: 1, triggerTiming: TRIGGER_TIMINGS.PASSIVE, description: '문제 풀이 제한시간 +n초.' },
]);

var MASTER_MONSTER_AI = Object.freeze([
  { aiId: 'ai_basic_attack', patternName: '기본 공격', actionType: 'attack', conditionJson: '{}', probability: 100, skillId: '', intentIcon: 'sword', intentTextTemplate: '공격하려고 합니다.' },
]);

var MASTER_MONSTERS = Object.freeze([
  { monsterId: 'monster_training_dummy', name: '훈련 더미', type: 'normal', imageKey: 'training_dummy', hp: 30, attack: 6, hpRegen: 0, evasion: 0, criticalRate: 0, criticalDamage: 150, defense: 0, aiId: 'ai_basic_attack', skillIds: '[]', description: '초반 기본 전투 대상.' },
  { monsterId: 'monster_shadow_problem', name: '그림자 문제', type: 'normal', imageKey: 'shadow_problem', hp: 45, attack: 8, hpRegen: 0, evasion: 3, criticalRate: 3, criticalDamage: 150, defense: 1, aiId: 'ai_basic_attack', skillIds: '[]', description: '민첩한 기본 전투 대상.' },
  { monsterId: 'boss_floor_1', name: '1층 보스', type: 'boss', imageKey: 'boss_floor_1', hp: 90, attack: 12, hpRegen: 0, evasion: 2, criticalRate: 5, criticalDamage: 150, defense: 2, aiId: 'ai_basic_attack', skillIds: '[]', description: '1층 마지막 스테이지 보스.' },
  { monsterId: 'boss_floor_2', name: '2층 보스', type: 'boss', imageKey: 'boss_floor_2', hp: 130, attack: 16, hpRegen: 1, evasion: 3, criticalRate: 5, criticalDamage: 150, defense: 3, aiId: 'ai_basic_attack', skillIds: '[]', description: '2층 마지막 스테이지 보스.' },
  { monsterId: 'boss_floor_3', name: '3층 보스', type: 'boss', imageKey: 'boss_floor_3', hp: 170, attack: 20, hpRegen: 2, evasion: 4, criticalRate: 6, criticalDamage: 150, defense: 4, aiId: 'ai_basic_attack', skillIds: '[]', description: '3층 마지막 스테이지 보스.' },
  { monsterId: 'boss_floor_4', name: '4층 보스', type: 'boss', imageKey: 'boss_floor_4', hp: 220, attack: 25, hpRegen: 3, evasion: 5, criticalRate: 7, criticalDamage: 150, defense: 5, aiId: 'ai_basic_attack', skillIds: '[]', description: '4층 마지막 스테이지 보스.' },
  { monsterId: 'boss_floor_5', name: '5층 보스', type: 'finalBoss', imageKey: 'boss_floor_5', hp: 300, attack: 32, hpRegen: 5, evasion: 6, criticalRate: 8, criticalDamage: 150, defense: 7, aiId: 'ai_basic_attack', skillIds: '[]', description: '5층 최종 보스.' },
]);

var MASTER_MONSTER_GROUPS = Object.freeze([
  { monsterGroupId: 'group_floor_1', name: '1층 일반 몬스터', monsterIds: '["monster_training_dummy","monster_shadow_problem"]', weights: '[70,30]' },
  { monsterGroupId: 'group_floor_2', name: '2층 일반 몬스터', monsterIds: '["monster_training_dummy","monster_shadow_problem"]', weights: '[50,50]' },
  { monsterGroupId: 'group_floor_3', name: '3층 일반 몬스터', monsterIds: '["monster_training_dummy","monster_shadow_problem"]', weights: '[40,60]' },
  { monsterGroupId: 'group_floor_4', name: '4층 일반 몬스터', monsterIds: '["monster_training_dummy","monster_shadow_problem"]', weights: '[30,70]' },
  { monsterGroupId: 'group_floor_5', name: '5층 일반 몬스터', monsterIds: '["monster_training_dummy","monster_shadow_problem"]', weights: '[20,80]' },
]);

var MASTER_REWARDS = Object.freeze([
  { rewardId: 'reward_skill_power', type: 'effect', targetId: 'buff_power', value: 1, weight: 30, minFloor: 1, maxFloor: 5, description: '힘 버프 보상.' },
  { rewardId: 'reward_skill_hard', type: 'effect', targetId: 'buff_hard', value: 1, weight: 30, minFloor: 1, maxFloor: 5, description: '단단함 버프 보상.' },
  { rewardId: 'reward_skill_focus', type: 'effect', targetId: 'buff_focus', value: 1, weight: 20, minFloor: 1, maxFloor: 5, description: '집중 버프 보상.' },
  { rewardId: 'reward_item_small_heal', type: 'item', targetId: 'item_small_heal', value: 1, weight: 20, minFloor: 1, maxFloor: 5, description: '소형 회복 아이템 보상.' },
]);

var MASTER_REWARD_GROUPS = Object.freeze([
  { rewardGroupId: 'reward_group_default', rewardIds: '["reward_skill_power","reward_skill_hard","reward_skill_focus","reward_item_small_heal"]', currencyMin: 5, currencyMax: 15, description: '기본 스테이지 클리어 보상 그룹.' },
]);

var MASTER_ITEMS = Object.freeze([
  { itemId: 'item_small_heal', name: '작은 회복약', type: 'consumable', target: 'self', effectJson: '{"statKey":"hp","effectType":"flat","value":20}', triggerTiming: 'manual', description: '체력을 20 회복한다.' },
]);
