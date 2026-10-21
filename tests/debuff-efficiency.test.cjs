const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {context, copy} = require('./run-session.test.cjs');
const base = require('./fixtures/skill-rework-2026-10-17.json');
const burn = require('../scripts/build-ignition-pack.cjs');
const shock = require('../scripts/build-shock-pack.cjs');
const x = context(), c = x.c;
const replaced = new Set([...burn.effects, ...shock.effects].map(e => e.effectId));
const definitions = base.effects.filter(e => !replaced.has(e.effectId)).concat(burn.effects, shock.effects);
const rules = base.effectRules.filter(r => !replaced.has(r.effectId)).concat(burn.effectRules, shock.effectRules);
x.seed(c.DB_SHEETS.EFFECTS, definitions);
x.seed(c.DB_SHEETS.EFFECT_RULES, rules);
const snapshot = {skills:[], effects:copy(c.readTable_(c.DB_SHEETS.EFFECTS)), effectRules:rules};
const local = vm.runInNewContext(c.getLocalRunEngineSource_(), {Date:c.Date, Math:c.Math});
const engine = c.getSharedRuleEngine_();

function game(mode, rule) {
  const stats = {hp:100, attack:20, defense:10, accuracy:100, evasion:0, criticalRate:0};
  const battle = {battleId:'efficiency',status:'active',turn:1,suppressMonsterScoreBookkeeping:true,
    player:{hp:100,maxHp:100,shield:0,stats,effects:[],baseMaxActionPoint:3,maxActionPoint:3,currentActionPoint:3},
    monsters:['a','b'].map(instanceId => ({instanceId,monsterId:instanceId,currentHp:1000,maxHp:1000,shield:0,evasion:0,effects:[]})),
    lastTurnEvents:[]};
  const skill = {skillId:'efficiency-test',name:'효율 테스트',type:'debuff',target:'enemy',targetId:'a',level:1,effectJson:JSON.stringify(rule)};
  const use = efficiency => mode === 'server' ? c.applySkillEffect(battle,skill,efficiency,true)
    : mode === 'browser' ? local.skill(snapshot,battle,skill,'a',efficiency,true)
    : engine.executeSkillRuleAction({battle,skill,rule,efficiency,targetId:'a',
      effectResolver:id => snapshot.effects.find(e => e.effectId === id)});
  const apply = (target,id,extra={}) => engine.applyEffect(target,{...snapshot.effects.find(e => e.effectId === id),...extra},{},battle.turn);
  return {battle,skill,use,apply,enemy:battle.monsters[0],stacks:(id,target=battle.monsters[0]) => engine.effectStacks(target,id)};
}

for (const mode of ['server','browser','fallback']) {
  test(`${mode}: zero efficiency skips the entire skill, including buffs, controls and resource changes`, () => {
    const g = game(mode,{damageFormula:'100',scaleByEfficiency:false,shieldFormula:'50',healFormula:'50',
      actionPointModify:{currentActionPointAdd:2},applyEffects:[
        {effectId:'buff_power',target:'self',stacks:5},
        {effectId:'effect_v2_burn',target:'self',stacks:5},
        {effectId:'effect_v2_freeze'},
        {effectId:'debuff_stun'}
      ],actions:[{operation:'damage',amount:100},{operation:'applyEffect',effectId:'effect_v2_burn',stacks:5}]});
    g.battle.player.hp = 50;
    const before = copy(g.battle);
    g.use(0);
    assert.deepEqual(copy(g.battle),before);
  });

  test(`${mode}: enemy debuff stacks scale, round, reapply and respect caps`, () => {
    for (const id of ['effect_v2_burn','effect_v2_poison','effect_v2_shock','effect_v2_chill']) {
      for (const [efficiency,expected] of [[0,0],[.1,1],[.5,3],[1,5],[1.25,6],[2,10]]) {
        const g = game(mode,{applyEffects:[{effectId:id,stacksFormula:'3+2*level'}]});
        g.use(efficiency);
        assert.equal(g.stacks(id),expected,`${id} at ${efficiency}`);
        g.use(efficiency);
        assert.equal(g.stacks(id),Math.min(expected*2,id === 'effect_v2_chill' ? 20 : 99));
        if (!expected) assert.equal(g.battle.lastTurnEvents.filter(e => e.effectId === id).length,0);
      }
      const capped = game(mode,{applyEffects:[{effectId:id,stacks:100}]});
      capped.use(.5);
      assert.equal(capped.stacks(id),id === 'effect_v2_chill' ? 20 : 50);
    }
  });

  test(`${mode}: self effects, enemy buffs, nonstacking debuffs and controls keep their original values`, () => {
    for (const efficiency of [.1,2]) {
      const g = game(mode,{applyEffects:[
        {effectId:'effect_v2_burn',target:'self',stacks:5},
        {effectId:'buff_power',stacks:5},
        {effectId:'effect_v2_weak',value:-33},
        {effectId:'debuff_stun',stacks:3},
        {effectId:'effect_v2_freeze'},
        {effectId:'effect_v2_chill',stacks:5,durationType:'turn',durationTurns:1}
      ]});
      g.use(efficiency);
      assert.equal(g.stacks('effect_v2_burn',g.battle.player),5);
      assert.equal(g.stacks('buff_power'),5);
      assert.equal(g.enemy.effects.find(e => e.effectId === 'effect_v2_weak').value,-33);
      assert.equal(g.stacks('debuff_stun'),3);
      assert.equal(g.stacks('effect_v2_freeze'),1);
      assert.equal(g.stacks('effect_v2_chill'),5);
    }
  });
}

for (const mode of ['server','browser']) {
  test(`${mode}: fixed action and per-hit stacks use efficiency for every living enemy`, () => {
    for (const rule of [
      {actions:[{operation:'applyEffect',effectId:'effect_v2_burn',target:'allEnemies',stacks:5}]},
      {targetMode:'allEnemies',damageFormula:'1',combat:{onEachHit:[{operation:'applyEffect',effectId:'effect_v2_burn',stacksFormula:'3+2*level'}]}}
    ]) {
      const g = game(mode,rule);
      g.use(.5);
      assert.deepEqual(g.battle.monsters.map(m => g.stacks('effect_v2_burn',m)),[3,3]);
    }
  });

  test(`${mode}: efficiency combines with stack bonuses before rounding and zero does not consume the bonus`, () => {
    const g = game(mode,{applyEffects:[{effectId:'effect_v2_shock',target:'allEnemies',stacks:5}]});
    g.apply(g.battle.player,'effect_v2_shock_next_application');
    g.battle.monsters.forEach(m => g.apply(m,'effect_v2_shock_received',{value:50}));
    g.use(0);
    assert.equal(g.stacks('effect_v2_shock_next_application',g.battle.player),1);
    g.use(.5);
    assert.deepEqual(g.battle.monsters.map(m => g.stacks('effect_v2_shock',m)),[8,8]);
    assert.equal(g.stacks('effect_v2_shock_next_application',g.battle.player),0);
  });
}

test('scaled debuff state and events match between server and exported browser engine', () => {
  const rule = {actions:[{operation:'applyEffect',effectId:'effect_v2_burn',target:'allEnemies',stacks:5}]};
  const a = game('server',rule), b = game('browser',rule);
  for (const efficiency of [0,.25,.5,1.25,2]) {
    a.use(efficiency); b.use(efficiency);
    assert.deepEqual(copy(a.battle),copy(b.battle));
  }
});

test('question preview reuses live stack modifiers without mutating battle state or consuming its buffs', () => {
  const g = game('browser',{damageFormula:'10',combat:{onEachHit:[{operation:'applyEffect',effectId:'effect_v2_shock',stacks:5}]}});
  g.apply(g.battle.player,'effect_v2_shock_next_application');
  g.apply(g.enemy,'effect_v2_shock_received',{value:50});
  const before = copy(g.battle);
  for (const [efficiency,expected] of [[.5,8],[1,15],[0,0]]) {
    const preview = local.previewSkill(snapshot,g.battle,g.skill,'a',efficiency,1);
    assert.equal(preview.lastTurnEvents.filter(e=>e.effectId==='effect_v2_shock').reduce((sum,e)=>sum+Number(e.appliedStacks || 0),0),expected);
    assert.deepEqual(copy(g.battle),before);
  }
  g.use(.5);
  assert.equal(g.stacks('effect_v2_shock'),8);
  assert.equal(g.stacks('effect_v2_shock_next_application',g.battle.player),0);
});
