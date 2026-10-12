const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { context, start, copy } = require('./run-session.test.cjs');
const existing = require('./fixtures/live-skill-definitions.json');
function readTsv(path, expectedColumns) {
  const lines = fs.readFileSync(path, 'utf8').trimEnd().split(/\r?\n/);
  const headers = lines.shift().split('\t');
  assert.equal(headers.length, expectedColumns);
  return lines.map(line => {
    const cells = line.split('\t'); assert.equal(cells.length, expectedColumns);
    return Object.fromEntries(headers.map((key, i) => [key, cells[i]]));
  });
}
const skills = readTsv('docs/skill-packs/control-caffeine-skills.tsv', 16);
const effects = readTsv('docs/skill-packs/caffeine-effects.tsv', 12);
function setup() {
  const x = context();
  x.seed(x.c.DB_SHEETS.SKILLS, [...existing.skills, ...skills]);
  x.seed(x.c.DB_SHEETS.EFFECTS, [...existing.effects, ...effects]);
  const snapshot = start(x).gameDataSnapshot;
  const engine = vm.runInNewContext(x.c.getLocalRunEngineSource_(), { Date: x.c.Date, Math: x.c.Math });
  const battle = { battleId:'control',status:'active',turn:1,stage:{floor:1,stage:1},
    player:{hp:30,maxHp:100,shield:0,stats:{hp:100,attack:10,defense:2,accuracy:100,criticalRate:0,criticalDamage:200},effects:[],
      baseMaxActionPoint:3,maxActionPoint:3,currentActionPoint:3},
    monsters:['a','b'].map(instanceId=>({instanceId,monsterId:instanceId,currentHp:200,maxHp:200,attack:10,defense:0,evasion:0,shield:0,effects:[]})),lastTurnEvents:[] };
  const skill=(id,level=1)=>x.c.hydrateSkill_(skills.find(row=>row.skillId===id),level);
  const perform=(mode,b,id,{level=1,efficiency=1,target='a'}={})=>{
    const s=skill(id,level);
    if(mode==='browser')engine.skill(snapshot,b,s,target,efficiency,true);
    else x.c.applySkillEffect(b,{...s,targetId:target},efficiency,true);
    assert.ok(!b.lastTurnEvents.some(e=>e.type==='ruleWarning'),id);
    return b;
  };
  const effect=(target,id)=>target.effects.find(e=>e.effectId===id);
  return {x,engine,snapshot,battle,skill,perform,effect};
}
test('paste-ready definitions use literal tabs, unique ids and valid JSON',()=>{
  assert.equal(skills.length,11);
  assert.equal(new Set(skills.map(s=>s.skillId)).size,11);
  for(const skill of skills)for(const key of ['conditionJson','effectJson','upgradeJson','tags'])JSON.parse(skill[key]);
});
for(const mode of ['server','browser']) {
  test(mode+': choke skips exactly one enemy turn and triangle choke adds one at 100 percent efficiency',()=>{
    const g=setup();
    for(const [id,efficiency,turns] of [['skill_choke',1,1],['skill_triangle_choke',.99,1],['skill_triangle_choke',1,2]]) {
      const b=copy(g.battle);g.perform(mode,b,id,{efficiency});
      assert.equal(g.effect(b.monsters[0],'debuff_stun').remainingTurns,turns);
      b.monsters=b.monsters.slice(0,1);
      g.x.c.applyMonsterTurn(b);
      assert.equal(b.lastTurnEvents.filter(e=>e.actor==='monster' && e.type==='skip').length,1);
      if(mode==='browser')g.engine.tick(g.snapshot,b,'turnEnd');else g.x.c.tickEffectsAtTurnEnd(b);
      if(turns===1)assert.equal(g.effect(b.monsters[0],'debuff_stun'),undefined);
      else {
        assert.equal(g.effect(b.monsters[0],'debuff_stun').remainingTurns,1);b.turn++;
        if(mode==='browser')g.engine.tick(g.snapshot,b,'turnEnd');else g.x.c.tickEffectsAtTurnEnd(b);
        assert.equal(g.effect(b.monsters[0],'debuff_stun'),undefined);
      }
    }
  });
  test(mode+': bully triggers only below half HP and scales damage and bonus with upgrades',()=>{
    const g=setup();
    for(const [hp,level,damage] of [[100,1,15],[99,1,20],[99,3,30]]) {
      const b=copy(g.battle);b.monsters[0].currentHp=hp;g.perform(mode,b,'skill_bully',{level});
      assert.equal(b.lastTurnEvents.find(e=>e.type==='skill').damage,damage);
    }
  });
  test(mode+': swift strike upgrades damage while keeping zero AP cost and lower difficulty',()=>{
    const g=setup();
    for(const level of [1,3]) {
      const b=copy(g.battle);g.perform(mode,b,'skill_swift_strike',{level});
      assert.equal(b.lastTurnEvents.find(e=>e.type==='skill').damage,12+3*(level-1));
      assert.equal(g.skill('skill_swift_strike').actionPointCost,0);
      assert.equal(g.skill('skill_swift_strike').difficultyBonus,-1);
      assert.equal(g.x.c.isSkillUpgradable_(g.skill('skill_swift_strike')),true);
    }
  });
  test(mode+': assassination requires stun or sleep and guarantees critical damage at zero crit rate',()=>{
    const g=setup();
    const invalid=copy(g.battle);g.perform(mode,invalid,'skill_assassination');assert.equal(invalid.monsters[0].currentHp,200);
    assert.match(g.x.c.getSkillUnavailableReason(g.skill('skill_assassination'),{},invalid),/기절/);
    for(const id of ['debuff_stun','debuff_sleep']) {
      const b=copy(g.battle);b.monsters[0].effects=[{effectId:id,category:'debuff',statKey:'action',effectType:'control',durationType:'turn',remainingTurns:1}];
      g.perform(mode,b,'skill_assassination');
      const hit=b.lastTurnEvents.find(e=>e.type==='skill');assert.equal(hit.damage,60);assert.equal(hit.isCritical,true);
    }
    const b=copy(g.battle);b.skillUseCounts={skill_assassination:1};
    assert.match(g.x.c.getSkillUnavailableReason(g.skill('skill_assassination'),{},b),/더 이상/);
    assert.equal(g.x.c.isSkillUpgradable_(g.skill('skill_assassination')),false);
  });
  test(mode+': concussion stuns only on a critical hit, never on a miss',()=>{
    const g=setup();
    for(const [crit,evasion,stunned] of [[0,0,false],[100,0,true],[100,100,false]]) {
      const b=copy(g.battle);b.player.stats.criticalRate=crit;b.monsters[0].evasion=evasion;
      g.perform(mode,b,'skill_concussion',{level:3});
      assert.equal(!!g.effect(b.monsters[0],'debuff_stun'),stunned);
    }
  });
  test(mode+': ignite adds upgraded burn stacks and extinguisher crits only on burned targets',()=>{
    const g=setup();
    for(const level of [1,3]) {
      const b=copy(g.battle);g.perform(mode,b,'skill_ignite',{level});
      assert.equal(g.effect(b.monsters[0],'debuff_burn').stacks,5+2*(level-1));
      b.lastTurnEvents=[];g.perform(mode,b,'skill_extinguisher_attack',{level});
      assert.equal(b.lastTurnEvents.find(e=>e.type==='skill').damage,(15+4*(level-1))*2);
    }
    const b=copy(g.battle);g.perform(mode,b,'skill_extinguisher_attack');assert.equal(b.lastTurnEvents.find(e=>e.type==='skill').isCritical,false);
    b.skillUseCounts={skill_ignite:1};assert.match(g.x.c.getSkillUnavailableReason(g.skill('skill_ignite'),{},b),/더 이상/);
  });
  test(mode+': cleanse removes every debuff and preserves buffs without resurrecting status buckets',()=>{
    const g=setup(),b=copy(g.battle);
    b.player.effects=[{effectId:'debuff_burn',category:'debuff'},{effectId:'debuff_weak',category:'debuff'},{effectId:'buff_power',category:'buff',statKey:'attack',effectType:'flat',value:2}];
    b.player.debuffs=copy(b.player.effects.slice(0,2));
    g.perform(mode,b,'skill_cleanse');assert.deepEqual(copy(b.player.effects.map(e=>e.effectId)),['buff_power']);assert.equal(b.player.debuffs.length,0);
  });
  test(mode+': coffee stacks both question bonuses and addiction consumes all stacks for healing',()=>{
    const g=setup(),b=copy(g.battle);
    for(let i=0;i<3;i++)g.perform(mode,b,'skill_drink_coffee');
    assert.equal(g.effect(b.player,'buff_caffeine').stacks,3);
    assert.ok(Math.abs(g.x.c.getSharedRuleEngine_().getQuestionMaxEfficiencyMultiplier(b.player.effects)-1.06)<1e-10);
    const plain=g.x.c.calculateFinalQuestionTimeLimit(1,[],{});
    assert.equal(g.x.c.calculateFinalQuestionTimeLimit(1,b.player.effects,{}),plain+300);
    g.perform(mode,b,'skill_caffeine_addiction',{efficiency:.5});assert.equal(b.player.hp,39);assert.equal(g.effect(b.player,'buff_caffeine'),undefined);
    assert.equal(g.x.c.getSharedRuleEngine_().getQuestionMaxEfficiencyMultiplier(b.player.effects),1);
    assert.match(g.x.c.getSkillUnavailableReason(g.skill('skill_caffeine_addiction'),{},b),/부족/);
  });
}
