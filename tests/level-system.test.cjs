const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {context,start,copy} = require('./run-session.test.cjs');

function game(rewardRows) {
  const x=context(),c=x.c;
  x.seed(c.DB_SHEETS.SKILLS,[...c.MASTER_SKILLS,...require('./fixtures/skill-rework-2026-10-17.json').skills]);
  if(rewardRows)x.seed(c.DB_SHEETS.REWARDS,rewardRows);
  const view=start(x);
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
  assert.equal(browser.player.baseStats.levelProgress.level,2);
  assert.equal(browser.player.baseStats.levelProgress.xp,22);
  g.engine.settleExperience(browser);g.engine.settleExperience(browser);
  assert.equal(browser.lastTurnEvents.filter(e=>e.type==='experience').length,1);
});

test('level system: boss grants exactly 100 XP without forcing a level, excess carries normally',()=>{
  const {c,battle}=game();
  battle.player.baseStats.levelProgress={level:4,xp:0,points:0,spent:{}};
  const m={instanceId:'boss',monsterId:'boss',type:'boss',currentHp:0,experience:1};
  const event=c.awardMonsterExperience_(battle,m);
  assert.equal(event.amount,100);assert.equal(event.after.level,5);assert.equal(event.after.points,0);
  m.instanceId='next';m.experience=600;
  const next=c.awardMonsterExperience_(battle,m);
  assert.equal(next.amount,100);assert.equal(next.levelsGained,1);
  assert.equal(next.after.xp,55);
  assert.equal(next.after.level,6);
  assert.equal(next.after.points,0);
  assert.equal(c.getPendingLevelStatRewards_(battle),2);
});

test('level system: level skill upgrade is limited, validated, saved once and restored',()=>{
  const g=game(), owned=[{skillId:'skill_power',level:1}];
  g.x.seed(g.c.DB_SHEETS.SKILLS,[{skillId:'skill_power',name:'강타',type:'damage',effectJson:'{}',upgradeJson:'{}'},
    {skillId:'fixed',conditionJson:'{"notUpgradable":true}',effectJson:'{}'}]);
  g.c.clearTableCache_(g.c.DB_SHEETS.SKILLS);
  g.c.updateRowByKey_(g.c.DB_SHEETS.RUNS,'runId',g.view.runId,{skillsJson:JSON.stringify(owned)});
  g.snapshot.skills=copy(g.x.c.readTable_(g.c.DB_SHEETS.SKILLS));
  g.battle.player.baseStats.levelProgress={level:2,xp:0,points:0,spent:{}};
  assert.throws(()=>g.engine.upgrade(g.snapshot,g.battle,[{skillId:'fixed',level:1}],'fixed'));
  const result=g.engine.upgrade(g.snapshot,g.battle,owned,'skill_power');
  assert.equal(result[0].level,2);
  assert.throws(()=>g.engine.upgrade(g.snapshot,g.battle,result,'skill_power'));
  const state=JSON.parse(g.view.localRunState.stageStateJson);state.battle=g.battle;
  g.c.saveStageState_(g.view.runId,state,g.battle);
  g.c.saveStageState_(g.view.runId,state,g.battle);
  const saved=g.c.requireRun_(g.view.runId);
  assert.equal(JSON.parse(saved.skillsJson)[0].level,2);
  assert.equal(g.c.getAvailableSkills(saved,g.battle)[0].level,2);
  assert.throws(()=>g.c.validateLevelSkillUpgrades_(saved,{level:2,skillUpgrades:{skill_power:2}}));
  assert.throws(()=>g.c.validateLevelSkillUpgrades_(saved,{level:2,skillUpgrades:{}}));
});

test('level system: sixth stage offers rest and owned upgradable skills',()=>{
  const g=game();
  g.x.seed(g.c.DB_SHEETS.SKILLS,[{skillId:'upgradable',name:'강타',effectJson:'{}',upgradeJson:'{}'},
    {skillId:'fixed',conditionJson:'{"notUpgradable":true}',effectJson:'{}'}]);
  g.c.clearTableCache_(g.c.DB_SHEETS.SKILLS);
  const choices=g.c.buildFloorRestChoices_(g.c.requireRun_(g.view.runId),g.battle,'',1,[{skillId:'upgradable',level:2},{skillId:'fixed',level:1}],[]);
  assert.equal(choices[0].type,'rest');
  assert.equal(choices[1].type,'experience');
  assert.deepEqual(copy(choices.slice(2).map(r=>[r.type,r.targetId])),[['skillUpgrade','upgradable']]);
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

test('level system: investments and skill upgrades survive prefetched rewards, next-stage replay and cached receipts',()=>{
  const regen={rewardId:'regen',type:'stat',targetId:'hpRegen',value:1,weight:1};
  const g=game([regen]);
  const originalSnapshot=g.snapshot;
  g.view=g.c.withRunSession_(g.view.runId,g.view.runSessionToken,'auth',()=>{
    const run=g.c.requireRun_(g.view.runId),state=g.c.getStageState_(run);
    state.battle.player.baseStats.levelProgress={level:1,xp:90,points:0,spent:{}};
    g.c.updateRowByKey_(g.c.DB_SHEETS.RUNS,'runId',run.runId,{skillsJson:JSON.stringify([{skillId:'skill_basic_slash',level:1}])});
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
  const points=g.engine.pendingStatRewards(g.battle);
  assert.ok(points>=1);
  while(g.engine.pendingStatRewards(g.battle))g.engine.claimStatReward(g.snapshot,g.battle,'regen');
  const earned=g.engine.rewardChoices(g.snapshot,g.battle,g.view.availableSkills);
  const acquired=g.engine.claimLevelReward(g.snapshot,g.battle,g.view.availableSkills,earned[0].rewardId);
  g.engine.upgrade(g.snapshot,g.battle,acquired,'skill_basic_slash');
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
  assert.equal(next.localRunState.skillsJson,checked.localRunState.skillsJson);
  assert.equal(JSON.parse(next.localRunState.skillsJson).find(s=>s.skillId==='skill_basic_slash').level,2);
  assert.ok(JSON.parse(next.localRunState.skillsJson).some(s=>s.skillId===earned[0].targetId));
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

test('level system: first kill always levels up, and 25 baseline stages give 15 skill rewards',()=>{
  const {c}=game();
  const first={stage:{floor:1,stage:1},player:{stats:{hp:30}},lastTurnEvents:[]};
  c.awardMonsterExperience_(first,{instanceId:'first',type:'normal',currentHp:0,experience:1,experienceQuestions:{count:1,attemptTotal:1,correctTotal:0,efficiencyTotal:0}});
  assert.equal(first.player.baseStats.levelProgress.level,2);
  const battle={player:{stats:{hp:30}},lastTurnEvents:[]};
  for(let floor=1;floor<=5;floor++)for(let stage=1;stage<=5;stage++){
    battle.stage={floor,stage};
    c.awardMonsterExperience_(battle,{instanceId:`${floor}-${stage}`,type:stage===5?'boss':'normal',currentHp:0});
  }
  assert.equal(battle.player.baseStats.levelProgress.level-1,15);
  assert.equal(battle.player.baseStats.levelProgress.points,0);
  assert.equal(c.getPendingLevelStatRewards_(battle),15);
});

test('level system: skill reward candidates match on server/browser and survive repeated saving',()=>{
  const g=game(),battle=g.battle;
  battle.player.baseStats.levelProgress={level:3,xp:0,points:0,spent:{}};
  let owned=copy(g.view.availableSkills);
  for(let level=2;level<=3;level++){
    const choices=g.engine.rewardChoices(g.snapshot,battle,owned);
    assert.equal(choices.length,3);
    assert.deepEqual(copy(choices.map(r=>r.rewardId)),copy(g.c.getLevelRewardChoices_(g.view.runId,level,owned,battle).map(r=>r.rewardId)));
    assert.deepEqual(copy(g.engine.rewardChoices(g.snapshot,battle,owned)),copy(choices),'reopening cannot reroll rewards');
    assert.throws(()=>g.engine.claimLevelReward(g.snapshot,battle,owned,'invalid'));
    owned=g.engine.claimLevelReward(g.snapshot,battle,owned,choices[0].rewardId);
  }
  assert.equal(battle.player.baseStats.levelProgress.skillRewards.length,2);
  assert.throws(()=>g.engine.claimLevelReward(g.snapshot,battle,owned,'invalid'));
  const state=JSON.parse(g.view.localRunState.stageStateJson);state.battle=battle;
  g.c.saveStageState_(g.view.runId,state,battle);
  const once=g.c.requireRun_(g.view.runId).skillsJson;
  g.c.saveStageState_(g.view.runId,state,battle);
  assert.equal(g.c.requireRun_(g.view.runId).skillsJson,once);
  assert.deepEqual(copy(JSON.parse(once).map(s=>s.skillId)),copy(owned.map(s=>s.skillId)));
  const forged=copy(battle.player.baseStats.levelProgress);forged.skillRewards[0]='forged';
  assert.throws(()=>g.c.validateLevelSkillUpgrades_(g.c.requireRun_(g.view.runId),forged));
});

test('level system: intermission questions stay at next-stage difficulty and prioritize unseen or lowest accuracy',()=>{
  const {c}=game();
  const questions=[{questionId:'outside',difficulty:1,totalCount:0},{questionId:'unseen',difficulty:2,totalCount:0},
    {questionId:'weak',difficulty:2,totalCount:10,correctCount:1},{questionId:'strong',difficulty:2,totalCount:10,correctCount:9}].map(q=>({...q,status:'approved'}));
  assert.equal(c.pickFloorExperienceQuestion_(questions,2).questionId,'unseen');
  assert.equal(c.pickFloorExperienceQuestion_(questions.filter(q=>q.questionId!=='unseen'),2).questionId,'weak');
  assert.equal(c.pickFloorExperienceQuestion_(questions,9),null);
});

test('level system: intermission experience uses exact efficiency percent and preserves overflow',()=>{
  const {c}=game();
  const reward={questionView:{question:{type:'multipleChoice',answer:'1'},maxMs:10000,questionModifiers:{}}};
  const state={stats:{levelProgress:{level:2,xp:50,points:0,spent:{}}}};
  const answer={selectedAnswer:'1',selectedChoiceIndex:'1',elapsedMs:6500,wrongCountAfterTimeout:0};
  const amount=c.applyFloorExperienceReward_(state,reward,answer);
  assert.equal(amount,85);
  assert.equal(state.stats.levelProgress.level,4);
  assert.equal(state.stats.levelProgress.xp,10);
  assert.equal(c.applyFloorExperienceReward_(state,reward,{...answer,giveUp:true}),0);
  assert.throws(()=>c.applyFloorExperienceReward_(state,reward,{...answer,selectedAnswer:'2',selectedChoiceIndex:'2'}));
});

test('level system: first reward is always common and themed, including a successful reroll',()=>{
  const g=game();g.battle.player.baseStats.levelProgress={level:2,xp:0,points:3,spent:{}};
  for(let i=0;i<80;i++) {
    const choices=g.c.getLevelRewardChoices_('run-'+i,2,[],g.battle);
    assert.equal(choices.length,3);
    choices.forEach(r=>{assert.equal(r.rarity,'common');assert.ok(g.c.getSkillRewardConcept_(g.snapshot.skills.find(s=>s.skillId===r.targetId)));});
  }
  const before=g.engine.rewardChoices(g.snapshot,g.battle,[]);
  const question={workbookId:'w',questionId:'reroll-q',type:'multipleChoice',answer:'1',difficulty:1,totalCount:5,correctCount:2};
  const record={question,signature:g.c.signLocalQuestionSnapshot_(question),answer:{selectedAnswer:'1',selectedChoiceIndex:'1'}};
  assert.equal(g.engine.rerollLevelReward(g.snapshot,g.battle,record),true);
  const after=g.engine.rewardChoices(g.snapshot,g.battle,[]);
  after.forEach(r=>{assert.equal(r.rarity,'common');assert.ok(!before.some(old=>old.targetId===r.targetId));});
  assert.throws(()=>g.engine.rerollLevelReward(g.snapshot,g.battle,record));
  const owned=g.engine.claimLevelReward(g.snapshot,g.battle,[],after[0].rewardId);
  assert.deepEqual(copy(g.c.validateLevelSkillUpgrades_(g.view.localRunState,g.battle.player.baseStats.levelProgress).map(s=>s.skillId)),copy(owned.map(s=>s.skillId)));
  const forged=copy(g.battle.player.baseStats.levelProgress);forged.skillRewardRerolls[2].answer.selectedAnswer='2';forged.skillRewardRerolls[2].answer.selectedChoiceIndex='2';
  assert.throws(()=>g.c.validateLevelSkillUpgrades_(g.view.localRunState,forged));
});

test('level system: failed reroll preserves the original candidates and consumes the attempt',()=>{
  const g=game();g.battle.player.baseStats.levelProgress={level:2,xp:0,points:3,spent:{}};
  const before=g.engine.rewardChoices(g.snapshot,g.battle,[]);
  const question={workbookId:'w',questionId:'reroll-q',type:'multipleChoice',answer:'1',difficulty:1,totalCount:5};
  const record={question,signature:g.c.signLocalQuestionSnapshot_(question),answer:{selectedAnswer:'2',selectedChoiceIndex:'2'}};
  assert.equal(g.engine.rerollLevelReward(g.snapshot,g.battle,record),false);
  assert.deepEqual(copy(g.engine.rewardChoices(g.snapshot,g.battle,[])),copy(before));
  assert.throws(()=>g.engine.rerollLevelReward(g.snapshot,g.battle,record));
});
