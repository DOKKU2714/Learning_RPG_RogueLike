const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('RewardService.gs', 'utf8');
const client = fs.readFileSync('Battle.html', 'utf8');
const extract = name => source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'))[0];

test('initial draws and rerolls only offer unowned skills, even with legacy weights', () => {
  const pool = Array.from({length: 12}, (_, i) => ({skillId: 's' + i}));
  const c = vm.createContext({
    REWARD_TYPES: {SKILL:'skill',SKILL_UPGRADE:'skillUpgrade',ITEM:'item'},
    SKILL_REWARD_CONFIG: {},
    getRewardConfig_: () => ({choicesCount:3,typeWeights:{skillUpgrade:100,item:100}}),
    getAvailableSkillRewardPool_: (_, owned) => pool.filter(s => !owned.includes(s.skillId)),
    buildAutoSkillReward_: s => ({rewardId:s.skillId,type:'skill',targetId:s.skillId,value:1}),
    pickAutoSkillReward_: () => ({rewardId:'s0',type:'skill',targetId:'s0',value:1}),
    adaptRewardForChoice_: r => r, attachRewardRarity_: r => r,
    pickRandom_: rows => rows[0], pickWeighted_: rows => rows[0],
    getSkillAffinityWeights_: rows => rows.map(()=>1),
  });
  for (const name of ['pickRewardChoices_', 'pickRewardType_', 'pickFallbackRewardChoice_']) vm.runInContext(extract(name), c);
  const first = c.pickRewardChoices_('',1,[],[]);
  const reroll = c.pickRewardChoices_('',1,[],[],first);
  assert.equal(first.length,3); assert.equal(reroll.length,3);
  assert.ok([...first,...reroll].every(r=>r.type==='skill'));
  assert.ok(reroll.every(r=>!first.some(old=>old.targetId===r.targetId)));
});

test('reward card concepts match all 105 planned skills', () => {
  const c = vm.createContext({});
  vm.runInContext(client.match(/    function getRewardSkillConcept\([^]*?\n    \}/)[0], c);
  for (const skill of require('./fixtures/skill-rework-2026-10-17.json').skills) {
    assert.equal(c.getRewardSkillConcept({skillDetail:{tags:skill.tags}}),skill.concept);
  }
});
