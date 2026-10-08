const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {context, start, copy} = require('./run-session.test.cjs');
const added = require('./fixtures/new-support-skills.json');
const existing = require('./fixtures/live-skill-definitions.json');
const html = fs.readFileSync('Battle.html', 'utf8');
const extract = name => html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];
function setup() {
  const x = context();
  x.seed(x.c.DB_SHEETS.SKILLS, [...existing.skills, ...added.skills]);
  x.seed(x.c.DB_SHEETS.EFFECTS, [...existing.effects, ...added.effects]);
  const snapshot = start(x).gameDataSnapshot;
  const engine = vm.runInNewContext(x.c.getLocalRunEngineSource_(), {Date:x.c.Date, Math:x.c.Math});
  const battle = {battleId:'support',status:'active',turn:1,stage:{floor:1,stage:1},
    player:{hp:30,maxHp:100,shield:0,stats:{hp:100,attack:10,defense:2,accuracy:100,criticalRate:0},effects:[],
      baseMaxActionPoint:3,maxActionPoint:3,currentActionPoint:3},
    monsters:[{instanceId:'a',monsterId:'a',currentHp:200,maxHp:200,attack:10,defense:10,evasion:0,shield:0,effects:[]},
      {instanceId:'b',monsterId:'b',currentHp:200,maxHp:200,attack:10,defense:10,evasion:0,shield:0,effects:[]}],lastTurnEvents:[]};
  const skill = (id, level=1) => x.c.hydrateSkill_(added.skills.find(s=>s.skillId===id), level);
  const use = (mode,b,id,level=1,efficiency=1) => mode==='browser'
    ? engine.skill(snapshot,b,skill(id,level),'b',efficiency,true)
    : x.c.applySkillEffect(b,{...skill(id,level),targetId:'b'},efficiency,true);
  return {x,snapshot,engine,battle,skill,use};
}
for (const mode of ['server','browser']) {
  test(mode+': recovery and shield skills scale with upgrades and efficiency and cap healing',()=>{
    const g=setup();
    for(const [id,level,efficiency,expected] of [['skill_emergency_treatment',1,1,35],['skill_emergency_treatment',3,1,39],
      ['skill_emergency_treatment',3,.5,35],['skill_emergency_rations',1,1,37],['skill_emergency_rations',3,1,40]]) {
      const b=copy(g.battle);g.use(mode,b,id,level,efficiency);assert.equal(b.player.hp,expected);
    }
    const capped=copy(g.battle);capped.player.hp=99;g.use(mode,capped,'skill_emergency_treatment',3);assert.equal(capped.player.hp,100);
    const b=copy(g.battle);g.use(mode,b,'skill_tough_it_out',3);assert.equal(b.player.shield,52);
  });
  test(mode+': analysis grants concentration 5 and L grants strength 2 and five existing corrosion stacks to one enemy',()=>{
    const g=setup(),b=copy(g.battle);
    g.use(mode,b,'skill_analysis');assert.equal(b.player.effects[0].value,5);
    g.use(mode,b,'skill_take_the_l');assert.equal(b.monsters[0].effects.length,0);
    const power=b.monsters[1].effects.find(e=>e.effectId==='buff_power');assert.equal(power.value,2);assert.equal(power.stacks,1);
    const corrosion=b.monsters[1].effects.find(e=>e.effectId==='debuff_corrosion');assert.equal(corrosion.value,-33);assert.equal(corrosion.stacks,5);
    g.use(mode,b,'skill_take_the_l');assert.equal(b.monsters[1].effects.find(e=>e.effectId==='debuff_corrosion').stacks,10);
    assert.equal(b.monsters[1].currentHp,200);
  });
  test(mode+': motivation survives turn end and renews without stacking',()=>{
    const g=setup(),b=copy(g.battle);g.use(mode,b,'skill_motivation');
    if(mode==='browser')g.engine.tick(g.snapshot,b,'turnEnd');else g.x.c.tickEffectsAtTurnEnd(b);
    g.use(mode,b,'skill_motivation');assert.equal(b.player.effects.length,1);assert.equal(b.player.effects[0].stacks,1);
    assert.equal(g.x.c.getSharedRuleEngine_().getQuestionMaxEfficiencyMultiplier(b.player.effects),1.5);
  });
}
test('motivation multiplies the entire cap, including item bonuses, and expires on the next resolved question even at AP cost zero',()=>{
  const g=setup(),b=copy(g.battle);g.use('server',b,'skill_motivation');
  const modifiers=g.x.c.getItemQuestionModifiers_(b,{});
  assert.equal(g.x.c.calculateMaxAnswerEfficiency_(modifiers,1.25),1.875);
  modifiers.questionMaxEfficiencyPercent=20;modifiers.questionMaxEfficiencyFlatPercent=10;
  assert.equal(g.x.c.calculateMaxAnswerEfficiency_(modifiers,1.25),2.4);
  g.x.c.consumeActionPoint_(b,0);
  assert.equal(b.player.effects.length,0);assert.equal(b.player.buffs.length,0);assert.equal(b.player.currentActionPoint,3);
  assert.equal(g.x.c.calculateMaxAnswerEfficiency_(g.x.c.getItemQuestionModifiers_(b,{}),1.25),1.25);
  g.use('server',b,'skill_motivation');b.player.currentActionPoint=0;
  assert.throws(()=>g.x.c.consumeActionPoint_(b,1));assert.equal(b.player.effects.length,1);
});
test('browser fresh and cached questions use the current motivation cap; resolving or giving up consumes it',()=>{
  const g=setup(),b=copy(g.battle);g.use('server',b,'skill_motivation');
  const c=vm.createContext({currentView:{battle:b},MAX_ANSWER_EFFICIENCY:1.25,SHORT_ANSWER_TIME_MULTIPLIER:1.2});
  vm.runInContext(g.x.c.getSharedRuleEngineSource_(),c);
  vm.runInContext(extract('calculateClientMaxAnswerEfficiency')+'\n'+extract('getClientLocalQuestionModifiers'),c);
  assert.equal(c.calculateClientMaxAnswerEfficiency(c.getClientLocalQuestionModifiers({})),1.875);
  const build=extract('buildOptimisticNextViewFromQuestion');
  assert.ok(build.indexOf('consumeQuestionEffects(battle.player)')<build.indexOf('if (questionView.giveUp)'));
  assert.ok(build.indexOf('consumeQuestionEffects(battle.player)')<build.indexOf('applyOptimisticSkillAction(battle, questionView, efficiency)'));
  assert.match(extract('takeCachedQuestionView'),/maxAnswerEfficiency = calculateClientMaxAnswerEfficiency/);
});
test('new skill restrictions, costs, rarity and formula rows are valid',()=>{
  const g=setup();
  for(const row of added.skills) {
    const s=g.skill(row.skillId);
    assert.equal(g.x.c.getActionPointCostForAction_('skill',s,g.battle),row.actionPointCost);
    const condition=JSON.parse(row.conditionJson);
    if(condition.perStageLimit) {
      const b=copy(g.battle);g.x.c.incrementSkillUseCount_(b,row.skillId);
      assert.match(g.x.c.checkSkillConditions_({requireCondition:condition},s,b,b.monsters[0]),/Stage/);
    } else {
      assert.equal(condition.notUpgradable,true);assert.equal(JSON.parse(row.upgradeJson).notUpgradable,true);assert.equal(row.cooldown,1);
    }
    assert.doesNotThrow(()=>JSON.parse(row.effectJson));
  }
});

test('recovery events update the HUD before the enemy hit without healing the model twice',async()=>{
  for(const [id,hp,level,expectedHeal] of [
    ['skill_emergency_rations',30,1,7],
    ['skill_emergency_rations',30,3,10],
    ['skill_emergency_treatment',99,3,1],
  ]) {
    const g=setup(),before=copy(g.battle),next=copy(g.battle);
    before.player.hp=hp;next.player.hp=hp;
    before.player.shield=next.player.shield=4;
    g.use('browser',next,id,level);
    const healedHp=next.player.hp;
    next.player.hp-=5;
    next.lastTurnEvents.push({actor:'monster',type:'attack',monsterId:'a',damage:5,hpDamage:5});
    const displayed=[],floating=[],text={hpDisplayState:{hp,shield:4,max:100}};
    const c={currentView:{battle:before},pendingActionPointVisualCost:null,pendingServerTurnView:null,
      pendingTurnResolutionActive:false,pendingQuestionTurnIsOptimistic:false,battleQuestionCache:null,
      passTurnLogPending:false,workbookDeadlineExpired:false,
      MONSTER_TURN_START_DELAY_MS:0,MONSTER_TURN_END_DELAY_MS:0,BATTLE_STEP_DELAY_MS:0,
      cancelTargetSelection(){},setBattleInputLocked(){},setPlayerTurn(){},pushLog(){},
      finishActionDescription:()=>Promise.resolve(),showTurnBanner(){},holdBattleMessage:()=>Promise.resolve(),skippableAutoDelay:()=>Promise.resolve(),
      collectMonsterMultiHitEvents:(events,index)=>[events[index]],
      playMonsterAttackImpact:async event=>{
        assert.equal(text.hpDisplayState.hp,healedHp,'enemy hit starts after healing');
        text.hpDisplayState.hp-=event.hpDamage;displayed.push(text.hpDisplayState.hp);
      },
      normalizeBattleView:v=>v,resetBattleQuestionCacheFromView(){},renderBattle:v=>{displayed.push(v.battle.player.hp);},
      document:{getElementById:()=>text},
      renderPlayerHud:p=>{text.hpDisplayState={hp:p.hp,shield:p.shield,max:p.maxHp};displayed.push(p.hp);},
      animatePlayerStatusEffect(){},spawnFloatingText:(anchor,value)=>floating.push(value)};
    vm.createContext(c);
    vm.runInContext(extract('getHpTextMatch')+'\n'+extract('animatePlayerHeal')+'\n'+
      html.match(/    async function playTurnSequence\([^]*?\n    \}/)[0],c);
    await c.playTurnSequence({battle:next});
    assert.equal(displayed[0],hp+expectedHeal);
    assert.deepEqual(floating,['+'+expectedHeal]);
    assert.equal(text.hpDisplayState.shield,4);
    assert.equal(before.player.hp,hp,'animation leaves the previous model unchanged');
    assert.equal(next.player.hp,hp+expectedHeal-5,'the computed result is not healed again');
    assert.deepEqual(displayed,[healedHp,healedHp-5,healedHp-5]);
  }
});
