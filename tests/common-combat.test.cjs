const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const {context, copy} = require('./run-session.test.cjs');

function setup() {
  const x=context();
  const effect=(effectId,behavior={},extra={})=>({
    effectId,name:effectId,category:'debuff',baseValue:1,rulesVersion:2,
    durationType:'stage',durationTurns:0,stackMode:'add',maxStacks:20,
    reapplyDurationPolicy:'keep',durationClock:'turns',decayTiming:'none',decayStacks:0,
    behaviorJson:JSON.stringify(behavior),...extra
  });
  const effects=[
    effect('cold'),
    effect('frozen',{control:{skipActions:1,breakOnDirectHit:true,stackEffectId:'cold',damagePerStack:5}},{stackMode:'replace',maxStacks:1}),
    effect('ice_coffin',{control:{skipActions:1,blockImmediately:true,healMissingFromValue:true},retainShield:true},{category:'buff',stackMode:'replace',maxStacks:1,baseValue:20}),
    effect('ice_immune',{control:{skipActions:1,blockImmediately:true},invulnerable:true},{category:'buff',stackMode:'replace',maxStacks:1}),
    effect('shock',{hitDamage:{damagePerStack:1}},{durationClock:'stacks',decayTiming:'turnStart',decayStacks:1}),
    effect('poison',{}, {durationClock:'stacks',decayTiming:'onTrigger',decayStacks:1})
  ];
  const rules=[
    {effectId:'cold',ruleOrder:1,triggerTiming:'passive',operation:'modifyStat',statKey:'evasion',valueMode:'flat',valueFormula:'-5*value*stacks'},
    {effectId:'cold',ruleOrder:2,triggerTiming:'passive',operation:'modifyStat',statKey:'defense',valueMode:'flat',valueFormula:'-value*stacks'},
    {effectId:'poison',ruleOrder:1,triggerTiming:'turnStart',operation:'damage',statKey:'hp',valueMode:'flat',valueFormula:'stacks',shieldPolicy:'bypass'}
  ];
  x.seed(x.c.DB_SHEETS.EFFECTS,effects);
  x.seed(x.c.DB_SHEETS.EFFECT_RULES,rules);
  const compiled=x.c.readTable_(x.c.DB_SHEETS.EFFECTS);
  const snapshot={effects:compiled,effectRules:rules,skills:[]};
  const local=vm.runInNewContext(x.c.getLocalRunEngineSource_(),{Date:x.c.Date,Math:x.c.Math});
  const battle={
    battleId:'common',status:'active',turn:1,
    player:{hp:40,maxHp:100,shield:0,stats:{hp:100,attack:10,defense:4,accuracy:100,criticalRate:0},effects:[],currentActionPoint:3,maxActionPoint:3,baseMaxActionPoint:3},
    monsters:['a','b'].map(instanceId=>({instanceId,currentHp:200,maxHp:200,hp:200,attack:1,defense:10,evasion:0,shield:0,effects:[]})),
    lastTurnEvents:[]
  };
  const engine=x.c.getSharedRuleEngine_();
  const apply=(target,id,stacks=1,value)=>x.c.applyEffect(target,{...compiled.find(e=>e.effectId===id),stacks,...(value===undefined?{}:{value})},{turn:battle.turn});
  const skill=(id,rule)=>({skillId:id,name:id,type:'damage',target:'enemy',hitCount:1,level:1,effectJson:JSON.stringify(rule),conditionJson:'{}',upgradeJson:'{}',tags:'["strike"]'});
  const perform=(mode,s)=>{
    snapshot.skills=[s];x.seed(x.c.DB_SHEETS.SKILLS,[s]);
    if(mode==='browser')local.skill(snapshot,battle,s,'a',1,true);
    else x.c.applySkillEffect(battle,{...s,targetId:'a'},1,true);
  };
  return {x,engine,local,battle,snapshot,compiled,apply,skill,perform};
}

test('combat common: stacks transfer atomically up to capacity and deleted buckets cannot resurrect',()=>{
  const g=setup(),[a,b]=g.battle.monsters;
  g.apply(a,'cold',7);g.apply(b,'cold',18);
  assert.equal(g.engine.transferEffectStacks(a,b,'cold',6,false),2);
  assert.equal(g.engine.effectStacks(a,'cold'),5);
  assert.equal(g.engine.effectStacks(b,'cold'),20);
  assert.equal(g.engine.consumeEffectStacks(a,'cold',99),5);
  g.x.c.normalizeBattleStateEffects_(g.battle);
  assert.equal(g.engine.effectStacks(a,'cold'),0);
  assert.equal(g.engine.transferEffectStacks(b,b,'cold',4,true),0);
  assert.equal(g.engine.consumeEffectStacks(b,'cold',-3),0);
});

for(const mode of ['server','browser']){
  test('combat common: '+mode+' ordered actions use actual consumed stacks and per-hit additional damage never recurses',()=>{
    const g=setup(),target=g.battle.monsters[0];
    g.apply(target,'cold',4);g.apply(target,'shock',3);
    g.perform(mode,g.skill('consume',{targetMode:'singleEnemy',actions:[
      {operation:'consumeStacks',effectId:'cold',amount:9},
      {operation:'damage',damageKind:'explosion',amountFormula:'consumedStacks*2'}
    ]}));
    assert.equal(target.currentHp,192);
    g.perform(mode,g.skill('multi',{targetMode:'singleEnemy',hitCount:3,damageFormula:'1'}));
    assert.equal(target.currentHp,180);
    const extra=g.battle.lastTurnEvents.filter(e=>e.damageKind==='additional');
    assert.equal(extra.length,3);
    assert.equal(g.engine.effectStacks(target,'shock'),3);
  });
  test('combat common: '+mode+' capped triggers run on each hit, once per action and kill exactly once',()=>{
    const g=setup(),target=g.battle.monsters[0];
    const s=g.skill('limited',{targetMode:'singleEnemy',hitCount:3,damageFormula:'1',
      onHit:{damageKind:'direct',maxActivations:2,actions:[{operation:'shield',target:'self',amount:3}]},
      onCritical:{maxActivations:1,actions:[{operation:'shield',target:'self',amount:50}]},
      onKill:{maxActivations:1,actions:[{operation:'heal',target:'self',amount:5}]}
    });
    g.perform(mode,s);
    assert.equal(g.battle.player.shield,6);
    assert.equal(g.battle.activeTriggers.some(t=>t.timing==='onHit'),false);
    const once=g.skill('once',{targetMode:'singleEnemy',hitCount:4,damageFormula:'1',onHit:{damageKind:'direct',oncePerAction:true,actions:[{operation:'shield',target:'self',amount:1}]}});
    g.perform(mode,once);assert.equal(g.battle.player.shield,7);
    target.currentHp=1;
    g.perform(mode,g.skill('kill',{targetMode:'singleEnemy',hitCount:3,damageFormula:'4'}));
    assert.equal(g.battle.player.hp,45);
    assert.equal(g.battle.combatRuntime.history.filter(e=>e.timing==='onKill'&&e.targetId==='a').length,1);
    const perTarget=g.skill('per-target',{targetMode:'self',onHit:{oncePerTarget:true,actions:[{operation:'shield',target:'self',amount:1}]}});
    g.perform(mode,perTarget);g.perform(mode,perTarget);
    assert.equal(g.battle.activeTriggers.filter(t=>t.sourceSkillId==='per-target'&&t.timing==='onHit').length,1);
  });
  test('combat common: '+mode+' frozen target skips once, remains breakable, then naturally releases on its next actor turn',()=>{
    const g=setup(),target=g.battle.monsters[0];
    g.apply(target,'cold',5);g.apply(target,'frozen');
    const turn=()=>mode==='browser'?g.local.actorTurn(g.snapshot,g.battle,target):g.x.c.beginCombatActorTurn_(g.battle,target);
    assert.equal(turn().blocked,true);
    assert.equal(turn().blocked,true); // duplicate UI/readback does not consume another actor turn
    assert.ok(target.effects.some(e=>e.effectId==='frozen'));
    g.battle.turn++;
    g.perform(mode,g.skill('break',{targetMode:'singleEnemy',hitCount:2,damageFormula:'1'}));
    assert.equal(target.currentHp,173);
    assert.equal(target.effects.some(e=>e.effectId==='frozen'),false);
    assert.equal(g.engine.effectStacks(target,'cold'),5);
    g.apply(target,'frozen');
    assert.equal(turn().blocked,true);
    g.battle.turn++;
    assert.equal(turn().blocked,false);
    assert.equal(target.effects.some(e=>e.effectId==='frozen'),false);
  });
  test('combat common: '+mode+' self control retains its shield, survives checkpoint reload and heals once on natural release',()=>{
    const g=setup();
    g.perform(mode,g.skill('coffin',{targetMode:'self',actions:[
      {operation:'applyEffect',target:'self',effectId:'ice_coffin',value:25},
      {operation:'shield',target:'self',amount:50,retainEffectId:'ice_coffin'}
    ]}));
    assert.equal(g.battle.player.currentActionPoint,0);
    g.engine.clearCombatTurnShield(g.battle.player);assert.equal(g.battle.player.shield,50);
    if(mode==='browser')g.local.playerDamage(g.snapshot,g.battle,7,g.battle.monsters[0]);
    else g.x.c.dealDamageToPlayer_(g.battle,7,g.battle.monsters[0]);
    assert.equal(g.battle.player.shield,43);
    const reloaded=copy(g.battle);
    const turn=()=>mode==='browser'?g.local.actorTurn(g.snapshot,reloaded,reloaded.player):g.x.c.beginCombatActorTurn_(reloaded,reloaded.player);
    reloaded.turn++;assert.equal(turn().blocked,true);
    g.engine.clearCombatTurnShield(reloaded.player);assert.equal(reloaded.player.shield,43);
    reloaded.turn++;assert.equal(turn().blocked,false);
    assert.equal(reloaded.player.shield,0);assert.equal(reloaded.player.hp,55);
    turn();assert.equal(reloaded.player.hp,55);
  });
  test('combat common: '+mode+' invulnerability covers direct and poison damage while poison still decays',()=>{
    const g=setup();g.apply(g.battle.player,'ice_immune');g.apply(g.battle.player,'poison',7);
    if(mode==='browser')g.local.playerDamage(g.snapshot,g.battle,100,g.battle.monsters[0]);
    else g.x.c.dealDamageToPlayer_(g.battle,100,g.battle.monsters[0]);
    assert.equal(g.battle.player.hp,40);
    g.battle.turn++;
    if(mode==='browser')g.local.tick(g.snapshot,g.battle,'turnStart');
    else g.x.c.tickEffectsAtTurnStart(g.battle);
    assert.equal(g.battle.player.hp,40);
    assert.equal(g.engine.effectStacks(g.battle.player,'poison'),6);
  });
}

test('combat common: death from poison emits one typed kill and poison 7 ticks total 28',()=>{
  const g=setup(),target=g.battle.monsters[0];g.apply(target,'poison',7);
  for(let turn=2;turn<=8;turn++){g.battle.turn=turn;g.x.c.tickEffectsAtTurnStart(g.battle);}
  assert.equal(target.currentHp,172);
  assert.equal(g.engine.effectStacks(target,'poison'),0);
  target.currentHp=1;g.apply(target,'poison',1);g.battle.turn++;
  g.x.c.tickEffectsAtTurnStart(g.battle);
  assert.equal(g.battle.combatRuntime.history.filter(e=>e.timing==='onKill'&&e.damageKind==='dot').length,1);
});

test('combat common: multi-target consumption keeps per-target values and exposes the aggregate for self healing',()=>{
  const g=setup(),[a,b]=g.battle.monsters;
  g.apply(a,'cold',2);g.apply(b,'cold',5);
  g.perform('server',g.skill('area',{targetMode:'allEnemies',actions:[
    {operation:'consumeStacks',effectId:'cold',amount:3},
    {operation:'damage',damageKind:'explosion',amountFormula:'consumedStacks*2'},
    {operation:'heal',target:'self',amountFormula:'totalConsumedStacks'}
  ]}));
  assert.equal(a.currentHp,196);assert.equal(b.currentHp,194);
  assert.equal(g.battle.player.hp,45);
});

test('combat common: invalid operations and missing secondary targets fail before dealing damage',()=>{
  const g=setup();
  assert.throws(()=>g.perform('server',g.skill('bad',{targetMode:'singleEnemy',damageFormula:'50',actions:[{operation:'unsupported'}]})),/Unsupported combat action/);
  assert.throws(()=>g.perform('server',g.skill('missing',{targetMode:'singleEnemy',damageFormula:'50',actions:[{operation:'moveStacks',effectId:'cold',amount:2}]})),/보조 대상/);
  assert.equal(g.battle.monsters[0].currentHp,200);
  assert.throws(()=>g.engine.readCombatBehavior({control:{unknown:true}}),/Unsupported control/);
});

test('combat common: reviewed workbook fixture validates every executable rule and preserves agreed values',()=>{
  const fixture=require('./fixtures/skill-rework-2026-10-17.json');
  const g=setup();
  g.engine.compileEffectDefinitions(fixture.effects,fixture.effectRules);
  assert.equal(fixture.skills.length,105);
  for(const s of fixture.skills){
    if(s.effectJson)g.engine.validateSkillRule(JSON.parse(s.effectJson),{warn:message=>assert.fail(s.name+': '+message)});
  }
  const find=id=>fixture.skills.find(s=>s.skillId===id);
  assert.equal(find('skill_v2_strike_01').cooldown,1);
  assert.equal(find('skill_v2_strike_01').actionPointCost,0);
  assert.match(find('skill_v2_strike_01').effectJson,/attack\*0.5/);
  assert.match(find('skill_v2_assassin_04').upgradeDesign,/체력 비용 5/);
  assert.match(find('skill_v2_frost_12').effectJson,/defense\*1.6\+16/);
  assert.match(find('skill_v2_frost_13').effectJson,/20\+5\*n/);
});

for(const mode of ['server','browser']){
  test('combat common: '+mode+' spreadsheet-authored cold/freezing and natural-release healing run without skill-ID branches',()=>{
    const fixture=require('./fixtures/skill-rework-2026-10-17.json'),x=context();
    x.seed(x.c.DB_SHEETS.EFFECTS,fixture.effects);x.seed(x.c.DB_SHEETS.EFFECT_RULES,fixture.effectRules);x.seed(x.c.DB_SHEETS.SKILLS,fixture.skills);
    const snapshot={skills:fixture.skills,effects:x.c.readTable_(x.c.DB_SHEETS.EFFECTS),effectRules:fixture.effectRules};
    const local=vm.runInNewContext(x.c.getLocalRunEngineSource_(),{Date:x.c.Date,Math:x.c.Math});
    const b=setup().battle;
    function use(id,level=1){
      const s=x.c.hydrateSkill_(fixture.skills.find(s=>s.skillId===id),level);
      if(mode==='browser')local.skill(snapshot,b,s,'a',1,true);
      else x.c.applySkillEffect(b,{...s,targetId:'a'},1,true);
    }
    use('skill_v2_strike_01');assert.equal(b.monsters[0].currentHp,186);
    use('skill_v2_frost_03'); // cold 4
    use('skill_v2_frost_05'); // cold 6, then freeze
    assert.ok(b.monsters[0].effects.some(e=>e.effectId==='effect_v2_freeze'));
    use('skill_v2_frost_13',2);
    assert.equal(b.player.currentActionPoint,0);
    const actor=()=>mode==='browser'?local.actorTurn(snapshot,b,b.player):x.c.beginCombatActorTurn_(b,b.player);
    b.turn++;assert.equal(actor().blocked,true);
    b.turn++;assert.equal(actor().blocked,false);
    assert.equal(b.player.hp,55);
  });
}
