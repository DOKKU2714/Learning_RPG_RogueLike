var EXTRA_MONSTER_AI = Object.freeze([
  {
    aiId: 'ai_basic_attack',
    patternName: 'Basic Guard',
    actionType: 'guard',
    conditionJson: '{"afterTurn":2}',
    probability: 25,
    skillId: '',
    intentIcon: 'shield',
    intentTextTemplate: 'Guarding next.',
  },
  {
    aiId: 'ai_basic_attack',
    patternName: 'Boss Bleed Mark',
    actionType: 'skill',
    conditionJson: '{"bossOnly":true,"afterTurn":2}',
    probability: 35,
    skillId: 'skill_bleeding_mark',
    intentIcon: 'drop',
    intentTextTemplate: 'Applying bleed next.',
  },
]);
