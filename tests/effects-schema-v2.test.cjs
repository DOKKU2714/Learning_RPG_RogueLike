const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {context, copy, start} = require('./run-session.test.cjs');
const fixture = require('./fixtures/effects-schema-v2.json');

function game(v2) {
  const x = context();
  x.seed(x.c.DB_SHEETS.EFFECTS, v2 ? fixture.effects : fixture.legacyEffects);
  x.seed(x.c.DB_SHEETS.EFFECT_RULES, v2 ? fixture.rules : []);
  x.c.GAME_DATA_REQUEST_TABLES_ = {};
  return x;
}
function battle() {
  return {battleId:'effects-test', status:'active', turn:1, stage:{floor:1,stage:1}, lastTurnEvents:[],
    player:{hp:80,maxHp:100,shield:7,stats:{hp:100,attack:20,defense:10,evasion:10,criticalRate:5,criticalDamage:200},effects:[],baseMaxActionPoint:3,maxActionPoint:3,currentActionPoint:3},
    monsters:[{instanceId:'enemy',monsterId:'enemy',name:'적',currentHp:100,maxHp:100,attack:10,defense:0,evasion:0,shield:7,effects:[]}]};
}
function stats(c, b) {
  const e=b.player.effects, engine=c.getSharedRuleEngine_();
  return copy({stats:c.calculateEffectiveStats(b.player.stats,e), time:c.calculateFinalQuestionTimeLimit(3,e,{}),
    difficulty:c.getEffectFlatBonus_(e,'questionDifficulty'), multiplier:engine.getQuestionMaxEfficiencyMultiplier(e),
    efficiencyBonus:engine.getQuestionEfficiencyBonusPercent(e), blocked:engine.hasActionBlock(b.player)});
}
function state(c,b) {
  const target=t=>({hp:t.hp,currentHp:t.currentHp,shield:t.shield,
    effects:t.effects.map(e=>({id:e.effectId,value:e.value,stacks:e.stacks,remainingTurns:e.remainingTurns,durationType:e.durationType}))});
  return copy({player:target(b.player),monsters:b.monsters.map(target),stats:stats(c,b),
    damage:b.lastTurnEvents.filter(e=>e.type==='effectDamage').map(e=>({id:e.effectId,damage:e.damage,hpDamage:e.hpDamage,shieldDamage:e.shieldDamage}))});
}
function apply(c,b,id,stacks,value) {
  const master=c.findCachedRowByKey_(c.DB_SHEETS.EFFECTS,'effectId',id);
  const effect={...master,stacks};
  if(value!==undefined) effect.value=value;
  c.applyEffect(b.player,effect,{turn:b.turn});
  c.applyEffect(b.monsters[0],effect,{turn:b.turn});
}

test('effects v2: all live effects preserve stats, question bonuses, damage, shield handling, reapplication and expiration',()=>{
  const old=game(false), next=game(true);
  for(const effect of fixture.effects) for(const stacks of [1,3,99]) for(const value of [undefined,0,2,-2]) {
    const a=battle(),b=battle();
    apply(old.c,a,effect.effectId,stacks,value);apply(next.c,b,effect.effectId,stacks,value);
    const label=`${effect.effectId}/${stacks}/${value}`;
    assert.deepEqual(state(next.c,b),state(old.c,a),label+' initial');
    apply(old.c,a,effect.effectId,2,value);apply(next.c,b,effect.effectId,2,value);
    assert.deepEqual(state(next.c,b),state(old.c,a),label+' reapplied');
    for(let turn=1;turn<=4;turn++) {
      for(const [x,z] of [[old,a],[next,b]]) {
        z.turn=turn;
        x.c.applyMonsterBurnDamage_(z.monsters[0],z);
        x.c.tickEffectsOnPlayerAction(z);
        x.c.applyStackedDamageEffects_(z.monsters[0],'beforeAction',z,'monster');
        x.c.tickEffectsAtTurnEnd(z);
      }
      assert.deepEqual(state(next.c,b),state(old.c,a),label+' turn '+turn);
    }
  }
});

test('effects v2: server and exported browser rules agree, including snapshot pinning and next-question consumption',()=>{
  const x=game(true),initial=start(x),snapshot=initial.gameDataSnapshot;
  assert.equal(snapshot.effectRules.length,fixture.rules.length);
  assert.ok(snapshot.effects.every(e=>e.rules.length));
  const engine=vm.runInNewContext(x.c.getLocalRunEngineSource_(),{Date:x.c.Date,Math:x.c.Math});
  const a=battle(),b=battle();
  for(const id of ['debuff_bleed','debuff_poison','debuff_burn','debuff_foolish','buff_caffeine','buff_motivation','buff_power']) {
    apply(x.c,a,id,3);apply(x.c,b,id,3);
  }
  for(const timing of ['turnStart','onAction','turnEnd']) {
    if(timing==='turnStart') x.c.tickEffectsAtTurnStart(a);
    else if(timing==='turnEnd') x.c.tickEffectsAtTurnEnd(a);
    else x.c.tickEffectsOnPlayerAction(a);
    engine.tick(snapshot,b,timing);
    assert.deepEqual(state(x.c,b),state(x.c,a),timing);
  }
  x.c.getSharedRuleEngine_().consumeQuestionEffects(a.player);
  assert.ok(!a.player.effects.some(e=>e.effectId==='buff_motivation'));
  assert.ok(a.player.effects.some(e=>e.effectId==='buff_caffeine'));
  const previous=x.c.getPinnedGameDataTable_;
  x.c.withGameDataSnapshot_(snapshot,()=>{
    assert.equal(x.c.readTable_(x.c.DB_SHEETS.EFFECT_RULES).length,fixture.rules.length);
    assert.ok(x.c.readTable_(x.c.DB_SHEETS.EFFECTS).every(e=>e.rules));
  });
  assert.equal(x.c.getPinnedGameDataTable_,previous);
});

test('effects v2: new IDs support composite stats, damage, control and hit rules without ID branches',()=>{
  const x=game(true),c=x.c;
  const effects=[{effectId:'custom',name:'복합 효과',category:'buff',baseValue:2,durationType:'turn',durationTurns:3,stackMode:'add',maxStacks:10,reapplyDurationPolicy:'max',durationClock:'stacks',decayTiming:'onTrigger',decayStacks:1,rulesVersion:2}];
  const rules=[
    {effectId:'custom',ruleOrder:1,triggerTiming:'passive',operation:'modifyStat',statKey:'attack',valueMode:'flat',valueFormula:'value*stacks'},
    {effectId:'custom',ruleOrder:2,triggerTiming:'passive',operation:'modifyStat',statKey:'defense',valueMode:'percent',valueFormula:'10*stacks'},
    {effectId:'custom',ruleOrder:3,triggerTiming:'beforeAction',operation:'damage',valueFormula:'2*stacks',shieldPolicy:'absorb'},
    {effectId:'custom',ruleOrder:4,triggerTiming:'passive',operation:'blockAction'},
    {effectId:'custom',ruleOrder:5,triggerTiming:'onHit',operation:'damageTakenMultiplier',valueFormula:'2'},
    {effectId:'custom',ruleOrder:6,triggerTiming:'onHit',operation:'removeOnHit'}];
  x.seed(c.DB_SHEETS.EFFECTS,effects);x.seed(c.DB_SHEETS.EFFECT_RULES,rules);c.GAME_DATA_REQUEST_TABLES_={};
  const b=battle();apply(c,b,'custom',3);
  assert.equal(stats(c,b).stats.attack,26);assert.equal(stats(c,b).stats.defense,13);
  assert.equal(c.getSharedRuleEngine_().hasActionBlock(b.monsters[0]),true);
  c.applyStackedDamageEffects_(b.monsters[0],'beforeAction',b,'monster');
  assert.equal(b.monsters[0].shield,1);assert.equal(b.monsters[0].effects[0].stacks,2);
  assert.equal(c.applyFrozenBonusIfNeeded_(b.monsters[0],10),20);
  assert.equal(b.monsters[0].effects.length,0);
});

test('effects v2: malformed rules fail explicitly and migration is idempotent',()=>{
  const engine=game(true).c.getSharedRuleEngine_();
  assert.throws(()=>engine.compileEffectDefinitions(fixture.effects,[]),/Missing EffectRules/);
  assert.throws(()=>engine.compileEffectDefinitions(fixture.effects,[...fixture.rules,fixture.rules[0]]),/Duplicate/);
  assert.throws(()=>engine.compileEffectDefinitions(fixture.effects,[{...fixture.rules[0],operation:'typo'}]),/Unsupported/);
  assert.throws(()=>engine.compileEffectDefinitions(fixture.effects,[{...fixture.rules[0],valueFormula:'missingVariable*stacks'}]),/Invalid EffectRules formula/);
  assert.throws(()=>engine.compileEffectDefinitions(fixture.effects,[{...fixture.rules[0],ruleOrder:0}]),/Invalid EffectRules order/);
  const migrated=engine.migrateLegacyEffectDefinitions(fixture.effects,fixture.rules);
  assert.deepEqual(copy(migrated),{effects:fixture.effects,rules:fixture.rules});
});

test('effects v2: HUD and server read the same question stat rules',()=>{
  const x=game(true),b=battle();
  apply(x.c,b,'buff_caffeine',3);apply(x.c,b,'debuff_foolish',99);
  const html=fs.readFileSync('Battle.html','utf8');
  const fn=name=>html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
  const c=vm.createContext({RULE_ENGINE_SHARED:x.c.getSharedRuleEngine_(),currentView:{battle:b,clientConfig:{baseQuestionTimeSec:10,questionTimePerDifficultySec:2}},SHORT_ANSWER_TIME_MULTIPLIER:1.2});
  vm.runInContext(fn('getClientQuestionDifficultyEffectDelta')+fn('calculateClientLocalQuestionTimeMs'),c);
  assert.equal(c.getClientQuestionDifficultyEffectDelta(),x.c.getEffectFlatBonus_(b.player.effects,'questionDifficulty'));
  assert.equal(c.calculateClientLocalQuestionTimeMs({type:'multipleChoice'},3,{}),x.c.calculateFinalQuestionTimeLimit(3,b.player.effects,{}));
  assert.equal(stats(x.c,b).efficiencyBonus,9);
});
