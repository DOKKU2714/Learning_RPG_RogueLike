const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {context,start,copy}=require('./run-session.test.cjs');
const rewards=require('./fixtures/level-stat-rewards.json');
function game(rows=rewards){
  const x=context(),c=x.c;x.seed(c.DB_SHEETS.REWARDS,rows);
  const view=start(x),snapshot=view.gameDataSnapshot,battle=copy(view.battle);
  const engine=vm.runInNewContext(c.getLocalRunEngineSource_(),{Date:c.Date,Math:c.Math});
  battle.monsters[0].currentHp=0;engine.settleExperience(battle);
  return {x,c,view,snapshot,battle,engine};
}

test('stat rewards: XP animation allows exactly one selection on the settled view without points',async()=>{
  const fs=require('node:fs'),source=fs.readFileSync('Battle.html','utf8'),g=game();
  const extract=name=>source.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
  const message={textContent:''},modal={classList:{remove(){}},setAttribute(){}};
  const nextView={...g.view,battle:g.battle,availableSkills:[]};
  const ui={window:{LearningRpgLocalRunEngine:g.engine},document:{activeElement:null,getElementById:id=>id==='rewardModal'?modal:message},
    currentView:g.view,currentRewardView:null,localGameDataSnapshot:g.snapshot,levelAllocationActive:false,
    levelRewardResolve:null,levelAllocationCancel:null,workbookDeadlineExpired:false,rewardSelectionApplying:false,
    victoryRewardPreload:{},victoryRewardResultPayload:{},getLevelRewardRerollQuestion(){return null;},setBattleInputLocked(){},renderRewardChoices(){},renderBattle(){},pushLog(){}};
  vm.createContext(ui);
  vm.runInContext(['getPlayerLevelProgress','presentLevelStatAllocation','selectRewardChoice'].map(extract).join('\n'),ui);
  assert.equal(g.view.battle.player.baseStats.levelProgress.points,0);
  const points=g.engine.pendingStatRewards(g.battle);
  assert.equal(points,1);
  const presentation=ui.presentLevelStatAllocation(nextView);
  try {
    for(let i=0;i<points;i++){
      const choice=ui.currentRewardView.choices[0];
      ui.selectRewardChoice(choice.rewardId);
      assert.equal(message.textContent,'');
      assert.equal(g.engine.pendingStatRewards(g.battle),points-i-1);
      assert.equal(g.view.battle.player.baseStats.levelProgress.points,0);
      await new Promise(setImmediate);
    }
    await presentation;
    assert.equal(g.battle.player.baseStats.levelProgress.statRewards.length,points);
    assert.equal(ui.currentRewardView,null);
    assert.equal(ui.levelAllocationActive,false);
    assert.equal(g.c.validateLevelStatsForCommit_(g.view.localRunState,g.view.battle,g.battle),true);
  } finally {
    if(ui.levelAllocationCancel)ui.levelAllocationCancel();
    await presentation;
  }
});
test('stat rewards: Rewards values, floor limits, weights and deterministic draws match in both engines',()=>{
  const g=game();
  for(const floor of [1,2,3,4,5])for(let ordinal=0;ordinal<20;ordinal++){
    g.battle.stage.floor=floor;g.battle.player.baseStats.levelProgress.statRewards=Array(ordinal).fill({});
    const a=g.c.getLevelStatRewardChoices_(g.battle),b=g.engine.statRewardChoices(g.snapshot,g.battle);
    assert.deepEqual(copy(a),copy(b));assert.equal(a.length,3);assert.equal(new Set(a.map(r=>r.targetId)).size,3);
    for(const r of a){const row=rewards.find(s=>s.rewardId===r.rewardId);assert.equal(r.value,Number(row.value));assert.equal(r.rarity,row.rarity);assert.ok(floor>=Number(row.minFloor)&&floor<=Number(row.maxFloor));}
  }
  assert.ok(g.c.getLocalRunEngineSource_().includes('function getLevelStatRewardChoices_'));
});
test('stat rewards: invalid/zero-weight rows are excluded and live value wins over stale description',()=>{
  const rows=[{rewardId:'regen',type:'stat',targetId:'hpRegen',value:1,weight:100,minFloor:1,maxFloor:5,description:'체력재생 +999'},
    {rewardId:'disabled',type:'stat',targetId:'attack',value:100,weight:0},
    {rewardId:'bad',type:'stat',targetId:'notAStat',value:100,weight:100}];
  const g=game(rows),choices=g.engine.statRewardChoices(g.snapshot,g.battle);
  assert.equal(choices.length,1);assert.equal(choices[0].description,'체력 재생 +1');
  const before=g.battle.player.baseStats.hpRegen;
  g.engine.claimStatReward(g.snapshot,g.battle,'regen');assert.equal(g.battle.player.baseStats.hpRegen,before+1);
  assert.deepEqual(copy(g.engine.statRewardChoices({...g.snapshot,rewards:[]},g.battle)),[],'missing rows do not use hardcoded rewards');
});
test('stat rewards: one choice per level preserves fractional amounts and rejects duplicate claims atomically',()=>{
  const rows=[{rewardId:'hp',type:'stat',targetId:'hp',value:7,weight:1},{rewardId:'dodge',type:'stat',targetId:'evasion',value:12.5,weight:1}];
  const g=game(rows),p=g.battle.player,points=p.baseStats.levelProgress.points,before=copy(p);
  assert.throws(()=>g.engine.claimStatReward(g.snapshot,g.battle,'forged'),/후보/);assert.deepEqual(copy(p),before);
  g.engine.claimStatReward(g.snapshot,g.battle,'hp');assert.equal(p.maxHp,before.maxHp+7);assert.equal(p.hp,before.hp+7);
  assert.throws(()=>g.engine.claimStatReward(g.snapshot,g.battle,'dodge'),/보상/);
  g.c.grantLevelExperience_(p,g.c.levelExperienceRequired_(2));
  g.engine.claimStatReward(g.snapshot,g.battle,'dodge');assert.equal(p.baseStats.evasion,Number(before.baseStats.evasion)+12.5);
  assert.equal(p.baseStats.levelProgress.points,0);
  assert.throws(()=>g.engine.claimStatReward(g.snapshot,g.battle,'hp'),/보상/);
});
test('stat rewards: checkpoint validation accepts actual choices, rejects forged amounts/candidates/history and survives repeated saves',()=>{
  const g=game(),original=copy(g.view.battle);
  while(g.engine.pendingStatRewards(g.battle)){const choice=g.engine.statRewardChoices(g.snapshot,g.battle)[0];g.engine.claimStatReward(g.snapshot,g.battle,choice.rewardId);}
  assert.equal(g.c.validateLevelStatsForCommit_(g.view.localRunState,original,g.battle),true);
  const bad=copy(g.battle);bad.player.baseStats.attack+=1;assert.throws(()=>g.c.validateLevelStatsForCommit_(g.view.localRunState,original,bad),/능력치/);
  bad.player.baseStats.attack-=1;bad.player.baseStats.levelProgress.statRewards[0].rewardId='forged';assert.throws(()=>g.c.validateLevelStatsForCommit_(g.view.localRunState,original,bad),/후보/);
  bad.player.baseStats.levelProgress.statRewards[0].rewardId=g.battle.player.baseStats.levelProgress.statRewards[0].rewardId;bad.player.baseStats.levelProgress.statRewards[0].floor=5;
  assert.throws(()=>g.c.validateLevelStatsForCommit_(g.view.localRunState,original,bad),/층/);
  const state=JSON.parse(g.view.localRunState.stageStateJson);state.battle=g.battle;
  g.c.saveStageState_(g.view.runId,state,g.battle);g.c.saveStageState_(g.view.runId,state,g.battle);
  const saved=g.c.requireRun_(g.view.runId);assert.deepEqual(JSON.parse(saved.statsJson).levelProgress.statRewards,copy(g.battle.player.baseStats.levelProgress.statRewards));
  const rewrite=copy(g.battle);rewrite.player.baseStats.levelProgress.statRewards[0].rewardId='forged';assert.throws(()=>g.c.validateLevelStatsForCommit_(saved,g.battle,rewrite),/변경/);
});
test('stat rewards: a new run cannot bypass the draw with legacy point allocations',()=>{
  const g=game(),run=copy(g.view.localRunState),stats=JSON.parse(run.statsJson);
  stats.levelProgress={level:1,xp:0,points:0,spent:{},statRewardVersion:1,statRewards:[]};run.statsJson=JSON.stringify(stats);
  g.battle.player.baseStats.levelProgress.points=1;g.c.allocateLevelStats_(g.battle,{attack:1});
  assert.throws(()=>g.c.validateLevelStatsForCommit_(run,g.view.battle,g.battle),/무작위/);
});

test('stat rewards: correct and incorrect rerolls are independent of skill rerolls and verified on save',()=>{
  for(const correct of [true,false]){
    const g=game(),before=copy(g.engine.statRewardChoices(g.snapshot,g.battle));
    const question={workbookId:g.view.localRunState.workbookId,questionId:'stat-reroll',type:'multipleChoice',answer:'1',difficulty:1,totalCount:5};
    const answer=correct?'1':'2',record={question,signature:g.c.signLocalQuestionSnapshot_(question),answer:{selectedAnswer:answer,selectedChoiceIndex:answer}};
    assert.equal(g.engine.rerollStatReward(g.snapshot,g.battle,record),correct);
    assert.throws(()=>g.engine.rerollStatReward(g.snapshot,g.battle,record),/한 번/);
    const choices=g.engine.statRewardChoices(g.snapshot,g.battle);
    assert.deepEqual(copy(choices),copy(g.c.getLevelStatRewardChoices_(g.battle)));
    if(!correct)assert.deepEqual(copy(choices),before);
    else assert.ok(choices.every(r=>!before.some(old=>old.rewardId===r.rewardId)),'successful reroll replaces previous candidates');
    assert.equal(g.battle.player.baseStats.levelProgress.skillRewardRerolls,undefined);
    g.engine.claimStatReward(g.snapshot,g.battle,choices[0].rewardId);
    assert.equal(g.c.validateLevelStatsForCommit_(g.view.localRunState,g.view.battle,g.battle),true);
    const forged=copy(g.battle);forged.player.baseStats.levelProgress.statRewardRerolls[2].signature='forged';
    assert.throws(()=>g.c.validateLevelStatsForCommit_(g.view.localRunState,g.view.battle,forged));
    const duplicate=copy(g.battle);duplicate.player.baseStats.levelProgress.statRewards.push(copy(duplicate.player.baseStats.levelProgress.statRewards[0]));
    assert.throws(()=>g.c.validateLevelStatsForCommit_(g.view.localRunState,g.view.battle,duplicate),/횟수/);
    const saved={...g.view.localRunState,statsJson:JSON.stringify(g.battle.player.baseStats)};
    const rewritten=copy(g.battle);delete rewritten.player.baseStats.levelProgress.statRewardRerolls[2];
    assert.throws(()=>g.c.validateLevelStatsForCommit_(saved,g.battle,rewritten),/변경/);
  }
});

test('stat rewards: legacy unfinished point screens become one choice while old gains and histories stay intact',()=>{
  const g=game(),p=g.battle.player;
  p.baseStats.levelProgress={level:5,xp:10,points:9,spent:{attack:2},statRewardVersion:1,statRewards:[{rewardId:'old',floor:1}]};
  const before=copy(p.baseStats);
  const oldBattle=copy(g.battle),run={...g.view.localRunState,statsJson:JSON.stringify(before)};
  assert.equal(g.engine.pendingStatRewards(g.battle),1);
  g.engine.claimStatReward(g.snapshot,g.battle,g.engine.statRewardChoices(g.snapshot,g.battle)[0].rewardId);
  assert.equal(g.engine.pendingStatRewards(g.battle),0);
  assert.equal(p.baseStats.levelProgress.statRewards[0].rewardId,'old');
  assert.deepEqual(copy(p.baseStats.levelProgress.spent),before.levelProgress.spent);
  assert.equal(g.c.validateLevelStatsForCommit_(run,oldBattle,g.battle),true,'migration and the remaining choice pass server validation');
  g.c.grantLevelExperience_(p,g.c.levelExperienceRequired_(5));
  assert.equal(g.engine.pendingStatRewards(g.battle),1);
  assert.equal(p.baseStats.levelProgress.points,9,'old point history is retained without granting new level points');
});
