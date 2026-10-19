const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('RewardService.gs','utf8');
const extract=name=>source.match(new RegExp('function '+name+'\\([^]*?\\n\\}'))[0];
const definitions=require('./fixtures/skill-rework-2026-10-17.json').skills;
function setup(rows=definitions){
  let captured;
  const c=vm.createContext({getSkillRowsForRewards_:()=>rows,
    normalizeOwnedSkills_:skills=>skills.map(s=>typeof s==='string'?{skillId:s}:s),
    normalizeSkillTags_:tags=>Array.isArray(tags)?tags:JSON.parse(tags || '[]'),
    pickRandom_:pool=>pool[0],pickWeighted_:(pool,weights)=>{captured=[...weights];return pool[0];}});
  for(const name of ['getSkillRewardConcept_','getSkillAffinityWeights_','pickSkillWithAffinity_'])vm.runInContext(extract(name),c);
  return {c,weights:()=>captured};
}

test('skill affinity: each owned concept skill adds 50% without a cap',()=>{
  const {c}=setup();
  const owned=definitions.filter(s=>s.concept==='발화');
  const candidates=[owned[14],definitions.find(s=>s.concept==='빙결')];
  for(const count of [0,1,2,3,4,5,10,15]){
    const weights=c.getSkillAffinityWeights_(candidates,owned.slice(0,count).map(s=>s.skillId));
    assert.deepEqual([...weights],[1+count*0.5,1]);
  }
});

test('first selected concept adds another 100% to the per-skill bonus',()=>{
  const {c}=setup();const burn=definitions.filter(s=>s.concept==='발화'),frost=definitions.find(s=>s.concept==='빙결');
  assert.deepEqual([...c.getSkillAffinityWeights_([burn[3],frost],[burn[0].skillId],'burn')],[2.5,1]);
  assert.deepEqual([...c.getSkillAffinityWeights_([burn[3],frost],[burn[0].skillId,burn[1].skillId],'burn')],[3,1]);
});

test('skill affinity: concepts are independent, levels and duplicate IDs do not inflate counts',()=>{
  const {c,weights}=setup();
  const burn=definitions.filter(s=>s.concept==='발화'),frost=definitions.filter(s=>s.concept==='빙결');
  const owned=[{skillId:burn[0].skillId,level:9},{skillId:burn[0].skillId,level:9},burn[1].skillId,frost[0].skillId];
  const pool=[burn[2],frost[1],definitions.find(s=>s.concept==='타격')];
  c.pickSkillWithAffinity_(pool,owned,{});
  assert.deepEqual(weights(),[2,1.5,1]);
  const rewardRows=pool.map(s=>({type:'skill',targetId:s.skillId}));
  assert.deepEqual([...c.getSkillAffinityWeights_(rewardRows,owned)],[2,1.5,1]);
});

test('skill affinity: concept tags work regardless of tag position or Korean notation',()=>{
  const {c}=setup([{skillId:'owned',tags:'["damage","발화"]'},{skillId:'next',tags:'["buff","burn"]'},{skillId:'other',concept:'빙결',tags:'[]'}]);
  assert.deepEqual([...c.getSkillAffinityWeights_([{targetId:'next'},{targetId:'other'}],['owned'])],[1.5,1]);
});
