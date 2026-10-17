const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {context,start,copy} = require('./run-session.test.cjs');

function game() {
  const x=context(), view=start(x), c=x.c;
  const snapshot=view.gameDataSnapshot;
  const battle=copy(view.battle);
  const engine=vm.runInNewContext(c.getLocalRunEngineSource_(),{Date:c.Date,Math:c.Math});
  return {x,c,view,battle,snapshot,engine};
}

test('level system: player accuracy, solve efficiency and per-monster overrides',()=>{
  const {c}=game();
  function award(wrongCount,efficiency,extra={}) {
    const battle={stage:{floor:1},player:{stats:{hp:30}},monsters:[],lastTurnEvents:[]};
    const m={instanceId:'a',monsterId:'m',type:'normal',currentHp:1,...extra};
    battle.monsters=[m];
    c.recordExperienceQuestion_(battle,{efficiency,isCorrect:true,wrongCount});
    m.currentHp=0;
    return c.awardMonsterExperience_(battle,m).amount;
  }
  assert.equal(award(0,1),30);
  assert.equal(award(1,1),23);
  assert.equal(award(3,1),19);
  assert.equal(award(0,1.5),45);
  assert.equal(award(0,1,{experience:60}),60);
  assert.equal(award(0,0),8);
});

test('level system: server and browser kill awards are identical and never duplicate',()=>{
  const g=game();
  const server=copy(g.battle), browser=copy(g.battle);
  for(const b of [server,browser]) {
    b.monsters=b.monsters.slice(0,1);b.monsters[0].type='normal';b.monsters[0].currentHp=1;
    b.monsters[0].effects=[];b.monsters[0].skillIds=[];b.monsters[0].experience=30;
    b.suppressMonsterScoreBookkeeping=true;b.lastTurnEvents=[];
  }
  const sample={question:{correctCount:50,totalCount:100},efficiency:1,isCorrect:true};
  g.c.recordExperienceQuestion_(server,sample);g.engine.experienceQuestion(browser,sample);
  g.c.dealDamageToMonster_(server,server.monsters[0],1000,{damageKind:'direct'});
  g.engine.damage(g.snapshot,browser,browser.monsters[0].instanceId,1000,{damageKind:'direct'});
  assert.deepEqual(copy(server.player.baseStats.levelProgress),copy(browser.player.baseStats.levelProgress));
  assert.equal(browser.player.baseStats.levelProgress.xp,30);
  g.engine.settleExperience(browser);g.engine.settleExperience(browser);
  assert.equal(browser.lastTurnEvents.filter(e=>e.type==='experience').length,1);
});

test('level system: boss always levels up, carries excess XP and grants three points per level',()=>{
  const {c,battle}=game();
  battle.player.baseStats.levelProgress={level:4,xp:0,points:0,spent:{}};
  const m={instanceId:'boss',monsterId:'boss',type:'boss',currentHp:0,experience:1};
  const event=c.awardMonsterExperience_(battle,m);
  assert.equal(event.amount,175);assert.equal(event.after.level,5);assert.equal(event.after.points,3);
  m.instanceId='next';m.experience=600;
  const next=c.awardMonsterExperience_(battle,m);
  assert.equal(next.levelsGained,2);assert.equal(next.after.points,9);
  assert.equal(next.after.xp,175);
});

test('level system: allocations validate atomically and preserve fractional stat increments',()=>{
  const {c,battle}=game();
  const before=copy(battle.player.baseStats);
  battle.player.baseStats.levelProgress={level:4,xp:20,points:9,spent:{}};
  for(const invalid of [{attack:-1},{attack:0.5},{attack:10},{attack:1},{unknown:9}]) {
    assert.throws(()=>c.allocateLevelStats_(battle,invalid));
    assert.equal(battle.player.baseStats.attack,before.attack);
    assert.equal(battle.player.baseStats.levelProgress.points,9);
  }
  const options=c.getLevelStatOptions_();
  const allocation=Object.fromEntries(options.map(o=>[o.key,1]));
  const hp=battle.player.hp,maxHp=battle.player.maxHp;
  c.allocateLevelStats_(battle,allocation);
  for(const option of options) assert.equal(battle.player.baseStats[option.key],Number(before[option.key]||0)+option.amount);
  assert.equal(battle.player.baseStats.levelProgress.points,0);
  assert.equal(battle.player.maxHp,maxHp+1);assert.equal(battle.player.hp,hp+1);
  assert.equal(battle.player.stats.criticalRate,Number(before.criticalRate||0)+1.5);
  assert.equal(battle.player.stats.accuracy,Number(before.accuracy||0)+3);
  assert.equal(c.rollHit_({accuracy:103},{evasion:30}).chance,73);
});

test('level system: browser stat allocation and run save retain level, experience and investments',()=>{
  const g=game();
  g.battle.player.baseStats.levelProgress={level:2,xp:12,points:3,spent:{}};
  g.engine.allocate(g.snapshot,g.battle,{attack:1,criticalRate:1,questionEfficiency:1});
  const state=JSON.parse(g.view.localRunState.stageStateJson);
  state.battle=g.battle;
  g.c.saveStageState_(g.view.runId,state,g.battle);
  const saved=g.c.requireRun_(g.view.runId),stats=JSON.parse(saved.statsJson);
  assert.equal(stats.levelProgress.level,2);assert.equal(stats.levelProgress.xp,12);
  assert.equal(stats.levelProgress.points,0);assert.equal(stats.questionEfficiency,2);
  const restored=g.c.buildBattleStateView_(saved,g.c.getStageState_(saved));
  assert.deepEqual(copy(restored.battle.player.baseStats.levelProgress),stats.levelProgress);
});

test('level system: efficiency investment raises both endpoints on the server and browser',()=>{
  const g=game();
  const before=g.c.getItemQuestionModifiers_(g.battle,{type:'multipleChoice'});
  g.battle.player.baseStats.levelProgress={level:2,xp:0,points:3,spent:{}};
  g.c.allocateLevelStats_(g.battle,{questionEfficiency:3});
  const after=g.c.getItemQuestionModifiers_(g.battle,{type:'multipleChoice'});
  assert.equal(after.questionMinEfficiencyPercent-before.questionMinEfficiencyPercent,6);
  assert.equal(after.questionMaxEfficiencyFlatPercent-before.questionMaxEfficiencyFlatPercent,6);
  assert.ok(Math.abs(g.c.calculateMaxAnswerEfficiency_(after)-g.c.calculateMaxAnswerEfficiency_(before)-0.06)<1e-9);
  const client=fs.readFileSync('Battle.html','utf8');
  const ui=vm.createContext({currentView:{battle:g.battle},RULE_ENGINE_SHARED:g.c.getSharedRuleEngine_(),SHORT_ANSWER_TIME_MULTIPLIER:1.2});
  vm.runInContext(client.match(/    function getClientLocalQuestionModifiers\([^]*?\n    \}/)[0],ui);
  const local=ui.getClientLocalQuestionModifiers({type:'multipleChoice'});
  assert.equal(local.questionMinEfficiencyPercent,after.questionMinEfficiencyPercent);
  assert.equal(local.questionMaxEfficiencyFlatPercent,after.questionMaxEfficiencyFlatPercent);
  // Investing past a 100% minimum must never create a dip at the midpoint.
  const high={questionMinEfficiencyPercent:100,questionMaxEfficiencyFlatPercent:100};
  const atMiddle=g.c.calculateEfficiency(true,500,1000,0,high,{});
  const atEnd=g.c.calculateEfficiency(true,0,1000,0,high,{});
  assert.ok(atMiddle>=atEnd);
});

test('level system: investments survive prefetched rewards, next-stage replay and cached receipts',()=>{
  const g=game();
  const originalSnapshot=g.snapshot;
  g.view=g.c.withRunSession_(g.view.runId,g.view.runSessionToken,'auth',()=>{
    const run=g.c.requireRun_(g.view.runId),state=g.c.getStageState_(run);
    state.battle.player.baseStats.levelProgress={level:1,xp:90,points:0,spent:{}};
    const saved=g.c.saveStageState_(run.runId,state,state.battle);
    return g.c.buildBattleStateView_(saved,state);
  });
  g.view.localRunState=g.view.localRunState || g.c.decodeRunSession_(g.view.runSessionToken).run;
  g.snapshot=originalSnapshot;g.battle=copy(g.view.battle);
  g.battle.monsters.forEach(m=>{m.currentHp=0;});
  g.engine.settleExperience(g.battle);
  g.battle.status='victory';g.battle.player.hp=1;
  const client=fs.readFileSync('Battle.html','utf8');
  const serializer=vm.createContext({copyStageResultValue:(value,fallback)=>copy(value===undefined ? fallback : value),getBattleStatStartingStats:p=>p.startingStats || {}});
  vm.runInContext(client.match(/    function buildStageResultBattlePayload\([^]*?\n    \}/)[0],serializer);
  const p={runId:g.view.runId,runSessionToken:g.view.runSessionToken,localAdvanceEnabled:true,
    localTransitions:[],battle:serializer.buildStageResultBattlePayload(g.battle),stageState:copy(g.view.stageState),answerLogs:[]};
  g.x.tick(5000);
  const prepared=g.c.previewRewardChoicesForStageResult(copy(p),'auth');
  p.runSessionToken=prepared.runSessionToken;
  const points=g.battle.player.baseStats.levelProgress.points;
  assert.ok(points>=3);
  g.engine.allocate(g.snapshot,g.battle,{hpRegen:points});
  p.battle=serializer.buildStageResultBattlePayload(g.battle);
  const reward=g.c.previewRewardChoicesForStageResult(copy(p),'auth');
  assert.equal(reward.regenAmount,prepared.regenAmount+points);
  assert.deepEqual(copy(reward.battleCompletionReceipt),copy(prepared.battleCompletionReceipt));
  p.runSessionToken=reward.runSessionToken;p.stageState.reward=copy(reward);
  const selectedAtMs=g.c.Date.now(),choice=reward.choices[0];
  const next=g.engine.advance(g.view.localRunState,g.snapshot,p,choice.rewardId,reward,{selectedAtMs});
  const checked=g.c.previewRewardChoicesForStageResult({...p,localTransitions:[{payload:copy(p),rewardId:choice.rewardId,
    rewardToken:reward.localTransitionToken,selectedAtMs}]},'auth');
  assert.equal(next.battle.player.baseStats.levelProgress.level,g.battle.player.baseStats.levelProgress.level);
  assert.equal(next.battle.player.baseStats.levelProgress.points,0);
  assert.equal(next.battle.player.stats.hpRegen,g.battle.player.stats.hpRegen);
  assert.equal(next.localRunState.statsJson,checked.localRunState.statsJson);
});

test('level system: malformed or inflated progression cannot bypass run stat validation',()=>{
  const g=game(),run=g.view.localRunState;
  const tampered=copy(g.battle);
  tampered.player.baseStats.attack+=10;
  assert.throws(()=>g.c.validateLevelStatsForCommit_(run,g.battle,tampered),/능력치/);
  tampered.player.baseStats.attack-=10;
  tampered.player.baseStats.levelProgress.level=99;
  assert.throws(()=>g.c.validateLevelStatsForCommit_(run,g.battle,tampered),/레벨/);
  tampered.player.baseStats.levelProgress.level=1;
  tampered.player.baseStats.levelProgress.points=3;
  assert.throws(()=>g.c.validateLevelStatsForCommit_(run,g.battle,tampered),/포인트/);
});
