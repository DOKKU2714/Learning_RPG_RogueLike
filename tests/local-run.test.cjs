const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const {context,start,copy} = require('./run-session.test.cjs');
const progressSheets = ['Runs','PlayerData','WorkbookPlayerData','AnswerLogs','BattleLogs','RunSettlements'];

function localGame() {
  const x=context(), initial=start(x);
  const source=x.c.getLocalRunEngineSource_();
  const engine=vm.runInNewContext(source,{Date:x.c.Date});
  let view=initial, run=initial.localRunState, token=initial.runSessionToken, journal=[], prepared=null;
  const game={x,engine,initial,source,get view(){return view;},get run(){return run;},get token(){return token;},get journal(){return journal;}};
  game.prepare=()=>{
    x.tick(5000);
    const payload={runId:view.runId,runSessionToken:token,localAdvanceEnabled:true,localTransitions:copy(journal),
      battle:copy(view.battle),stageState:copy(view.stageState),answerLogs:[]};
    payload.battle.status='victory';
    payload.battle.monsters.forEach(m=>{m.currentHp=0;});
    payload.battle.monsterScoreState={battleId:payload.battle.battleId,monsterScore:payload.battle.monsters.length?100:0,byMonsterId:{},scoreAwardedToRun:0};
    let reward=view.rewardView;
    if(!reward){
      const prior=run;
      reward=x.c.previewRewardChoicesForStageResult(payload,'auth');
      assert.ok(reward.localTransitionToken);
      token=reward.runSessionToken;
      journal=journal.filter(event=>!reward.acknowledgedLocalTransitions.includes(event.rewardToken.split('.')[1]));
      run=reward.localRunState;
      for(const key of ['statsJson','skillsJson','itemsJson','currentFloor','currentStage','currentHp','currency','score']) assert.deepEqual(run[key],prior[key],key);
    }
    payload.stageState.reward=copy(reward);
    delete payload.runSessionToken;delete payload.localAdvanceEnabled;delete payload.localTransitions;
    prepared={payload,reward};return prepared;
  };
  game.choose=(type)=>{
    if(!prepared)game.prepare();
    const {payload,reward}=prepared;
    const choice=reward.choices.find(c=>c.type===type)||reward.choices.find(c=>c.type!=='rest')||reward.choices[0];
    const selectedAtMs=x.c.Date.now();
    view=engine.advance(run,initial.gameDataSnapshot,payload,choice.rewardId,reward,{selectedAtMs});
    run=view.localRunState;
    journal.push({payload,rewardId:choice.rewardId,rewardToken:reward.localTransitionToken,selectedAtMs});
    prepared=null;return view;
  };
  return game;
}

test('the browser bundle contains the server rules and has no external service dependency',()=>{
  const g=localGame();
  assert.doesNotMatch(g.source,/\b(?:SpreadsheetApp|CacheService|PropertiesService|LockService|UrlFetchApp|google\.script)\b/);
  assert.ok(g.source.includes(String(g.x.c.applyStatReward)));
  assert.ok(g.source.includes(String(g.x.c.calculateStageClearScoreForReward_)));
  assert.ok(g.source.includes(String(g.x.c.createMonstersForStage_)));
});

test('reward selection and next battle creation complete without any server operation',()=>{
  const g=localGame();g.prepare();g.x.reads.length=0;g.x.writes.length=0;
  const response=g.choose();
  assert.equal(response.battle.stage.stage,2);assert.equal(response.battle.status,'active');
  assert.equal(g.x.reads.length,0);assert.equal(g.x.writes.length,0);
  assert.equal(g.journal.length,1);assert.ok(response.availableSkills.length);
});

test('AP tradeoff items apply to the next battle and refill consistently with server rules',()=>{
  for(const [itemId,ap] of [['item_burning_timetable',4],['item_heavy_textbook',2]]){
    const g=localGame(),{payload,reward}=g.prepare();
    reward.choices=[{rewardId:'tradeoff-item',type:'item',targetId:itemId,value:1,rarity:'rare'}];
    g.x.c.signLocalRewardView_(reward);payload.stageState.reward=copy(reward);
    const result=g.choose('item');
    assert.equal(result.battle.player.maxActionPoint,ap);assert.equal(result.battle.player.currentActionPoint,ap);
    const server=g.x.c.advanceRunStage({...copy(payload),runSessionToken:g.token},reward.choices[0].rewardId,'auth',reward);
    assert.equal(server.battle.player.maxActionPoint,ap);
    assert.equal(result.battle.player.maxHp,server.battle.player.maxHp);
    const battle=copy(server.battle);battle.player.currentActionPoint=0;
    g.x.c.normalizePlayerActionPoints_(battle,true);assert.equal(battle.player.currentActionPoint,ap);
  }
});

test('local selection matches the previous server flow for stats, currency and score',()=>{
  const g=localGame(),{payload,reward}=g.prepare(),choice=reward.choices[0];
  const result=g.choose();
  const server=g.x.c.advanceRunStage({...copy(payload),runSessionToken:g.token},choice.rewardId,'auth',reward);
  const authoritative=g.x.c.decodeRunSession_(server.runSessionToken).run;
  for(const key of ['statsJson','skillsJson','itemsJson','currentHp','currentFloor','currentStage','currency','score']) assert.deepEqual(result.localRunState[key],authoritative[key],key);
});

test('HP, new skills, skill upgrades and item effects use exactly the previous reward rules',()=>{
  for(const type of ['stat','skill','skillUpgrade','item']){
    const g=localGame(),c=g.x.c;
    if(type==='skillUpgrade'){
      const first=g.prepare();
      first.reward.choices=[{rewardId:'learn-before-upgrade',type:'skill',targetId:c.MASTER_SKILLS[0].skillId,value:1,rarity:'common'}];
      c.signLocalRewardView_(first.reward);first.payload.stageState.reward=copy(first.reward);g.choose('skill');
    }
    const {payload,reward}=g.prepare();
    const owned=JSON.parse(g.run.skillsJson);
    const targetId=type==='stat'?'hp':type==='item'?c.MASTER_ITEMS[0].itemId:
      type==='skillUpgrade'?owned[0].skillId:c.MASTER_SKILLS.find(s=>!owned.some(o=>o.skillId===s.skillId)).skillId;
    reward.choices=[{rewardId:'parity-'+type,type,targetId,value:type==='stat'?10:1,rarity:'common'}];
    c.signLocalRewardView_(reward);payload.stageState.reward=copy(reward);
    const result=g.choose(type);
    const server=c.advanceRunStage({...copy(payload),runSessionToken:g.token},reward.choices[0].rewardId,'auth',reward);
    const authoritative=c.decodeRunSession_(server.runSessionToken).run;
    for(const key of ['statsJson','skillsJson','itemsJson','currentHp','currentFloor','currentStage','currency','score']) assert.deepEqual(result.localRunState[key],authoritative[key],type+':'+key);
    assert.deepEqual(copy(result.battle.player.stats),copy(server.battle.player.stats));
    assert.deepEqual(copy(result.availableSkills),copy(server.availableSkills));
  }
});

test('all 29 selections, rest healing, floor changes and victory settle only at the end',()=>{
  const g=localGame();let count=0,rests=0,bossDrops=0;
  while(!g.view.cleared){
    g.x.writes.length=0;
    if(g.view.rewardView){rests++;g.view.battle.player.hp=Math.max(1,g.run.currentHp-10);}
    const prepared=g.prepare();
    const boss=!!prepared.payload.battle.stage.bossMonsterId;
    assert.equal(g.x.writes.filter(s=>progressSheets.includes(s)).length,0);
    const response=g.choose(g.view.rewardView?'rest':['stat','skill','item','skillUpgrade'][count%4]);
    if(boss){
      bossDrops++;
      assert.ok(response.bonusItemReward);
      assert.ok(JSON.parse(g.run.itemsJson).some(item=>item.itemId===response.bonusItemReward.targetId));
    }else assert.equal(response.bonusItemReward,null);
    count++;assert.ok(count<=29);
  }
  assert.equal(count,29);assert.equal(rests,4);assert.equal(bossDrops,5);
  assert.equal(g.x.c.findRowByKeyUncached_('Runs','runId',g.run.runId).status,'active');
  g.x.c.readWorkbookQuestionTable_=()=>[{questionId:'review-q',status:'approved'}];
  const ratings=[{questionId:'review-q',rating:3,updatedAtMs:10,revision:'final-review'}];
  const saved=g.x.c.finishLocalRun(g.run.runId,g.token,copy(g.journal),'auth',ratings);
  assert.equal(saved.acknowledgedQuestionUnderstanding.entries[0].revision,'final-review');
  assert.equal(g.x.c.getPlayerQuestionUnderstanding_('p','w')['review-q'],3);
  assert.equal(saved.cleared,true);
  const row=g.x.c.findRowByKeyUncached_('Runs','runId',g.run.runId);
  assert.equal(row.status,'cleared');assert.equal(row.sessionSettled,true);
  assert.equal(row.score,g.run.score);assert.equal(row.currency,g.run.currency);
  assert.equal(row.itemsJson,g.run.itemsJson);
  assert.equal(g.x.c.getWorkbookPlayerData_('w','p').bestScore,row.score);
  const writes=g.x.writes.length;
  const retry=g.x.c.finishLocalRun(g.run.runId,g.token,copy(g.journal),'auth',ratings);
  assert.equal(retry.score,row.score);assert.equal(g.x.writes.length,writes);
  g.x.cache.clear();
  const coldRetry=g.x.c.finishLocalRun(g.run.runId,g.token,copy(g.journal),'auth');
  assert.equal(coldRetry.score,row.score);assert.equal(g.x.writes.length,writes);
});

test('boss drop excludes owned and selected items, is signed and applies without server access',()=>{
  const g=localGame();
  for(let i=0;i<4;i++){g.prepare();g.choose('stat');}
  const {reward}=g.prepare();
  assert.ok(reward.bossItemRewards);
  const owned=JSON.parse(g.run.itemsJson).map(item=>item.itemId);
  for(const choice of reward.choices){
    const drop=reward.bossItemRewards[choice.rewardId];
    assert.ok(drop);
    assert.ok(!owned.includes(drop.targetId));
    if(choice.type==='item')assert.notEqual(drop.targetId,choice.targetId);
  }
  const signed=g.x.c.verifyLocalRewardView_(reward.localTransitionToken);
  assert.deepEqual(copy(signed.bossItemRewards),copy(reward.bossItemRewards));
  const choice=reward.choices.find(c=>c.type==='item')||reward.choices[0];
  g.x.reads.length=0;g.x.writes.length=0;
  const response=g.choose(choice.type);
  assert.deepEqual(copy(response.bonusItemReward),copy(reward.bossItemRewards[choice.rewardId]));
  assert.equal(g.x.reads.length,0);assert.equal(g.x.writes.length,0);
  g.x.cache.clear();
  g.prepare();g.choose('rest');g.prepare();
  assert.ok(JSON.parse(g.run.itemsJson).some(item=>item.itemId===response.bonusItemReward.targetId));
});

test('boss reward previews draw a variety of items instead of always goalkeeper gloves',t=>{
  const dropped=new Set();
  for(let seed=1;seed<=6;seed++) {
    const g=localGame();
    vm.runInContext('var bossTestSeed='+seed+'; Math.random=()=>{bossTestSeed=(Math.imul(1664525,bossTestSeed)+1013904223)>>>0;return bossTestSeed/4294967296;};',g.x.c);
    for(let i=0;i<4;i++){g.prepare();g.choose('stat');}
    const {reward}=g.prepare();
    const signed=g.x.c.verifyLocalRewardView_(reward.localTransitionToken);
    assert.deepEqual(copy(signed.bossItemRewards),copy(reward.bossItemRewards));
    Object.values(reward.bossItemRewards).forEach(drop=>{if(drop)dropped.add(drop.targetId);});
  }
  assert.ok(dropped.size>3,[...dropped].join(', '));
  assert.ok([...dropped].some(id=>id!=='item_goalkeeper_gloves'));
  t.diagnostic('Boss preview item variety: '+dropped.size+' distinct items across six runs.');
});

test('boss detection excludes ordinary wins, defeats and floor rest; exhausted pools return no drop',()=>{
  const x=context();start(x);const c=x.c;
  const stages=c.buildStageSeedData_();
  const boss=stages.find(stage=>stage.bossMonsterId);
  const regular=stages.find(stage=>!stage.bossMonsterId&&!c.isFloorRestStage_(stage));
  const rest=stages.find(stage=>c.isFloorRestStage_(stage));
  assert.equal(c.isBossVictoryReward_(boss.stageId,{status:'victory',monsters:[]}),true);
  assert.equal(c.isBossVictoryReward_(boss.stageId,{status:'defeat',monsters:[]}),false);
  assert.equal(c.isBossVictoryReward_(regular.stageId,{status:'victory',monsters:[]}),false);
  assert.equal(c.isBossVictoryReward_(rest.stageId,{status:'victory',monsters:[{type:'boss',currentHp:0}]}),false);
  assert.equal(c.isBossVictoryReward_(regular.stageId,{status:'victory',monsters:[{type:'finalBoss',currentHp:0}]}),true);
  const items=c.getItemRows_().map(item=>({itemId:item.itemId,count:1}));
  assert.equal(c.pickAutoItemReward_(items),null);
});

test('defeat replays unacknowledged transitions and saves accumulated rewards once',()=>{
  const g=localGame();g.prepare();g.choose();
  const battle=copy(g.view.battle);battle.player.hp=0;battle.status='defeat';
  const payload={runId:g.run.runId,runSessionToken:g.token,localTransitions:copy(g.journal),battle,stageState:copy(g.view.stageState),answerLogs:[]};
  const saved=g.x.c.commitStageResult(payload,'auth');
  assert.equal(saved.battle.status,'defeat');assert.equal(saved.score,g.run.score);
  const row=g.x.c.findRowByKeyUncached_('Runs','runId',g.run.runId);
  assert.equal(row.currentStage,2);assert.equal(row.sessionSettled,true);
  assert.equal(g.x.c.getWorkbookPlayerData_('w','p').currency,g.run.currency);
  const writes=g.x.writes.length;g.x.c.commitStageResult(payload,'auth');assert.equal(g.x.writes.length,writes);
});

test('cache eviction replays the journal using the original signed reward options and snapshot',()=>{
  const g=localGame();g.prepare();g.choose();g.x.cache.clear();g.x.reads.length=0;g.x.writes.length=0;
  g.prepare();
  assert.equal(g.journal.length,0);assert.equal(g.run.currentStage,2);
  assert.equal(g.x.reads.filter(s=>['Monsters','Skills','Stages','Items','Rewards'].includes(s)).length,0);
  assert.equal(g.x.writes.filter(s=>progressSheets.includes(s)).length,0);
});

test('signed reward tampering, invalid selection and altered base stats are rejected',()=>{
  for(const kind of ['token','choice','stats']){
    const g=localGame();g.prepare();g.choose();const events=copy(g.journal);
    if(kind==='token')events[0].rewardToken+='x';
    if(kind==='choice')events[0].rewardId='unissued-reward';
    if(kind==='stats')events[0].payload.battle.player.baseStats.attack+=10000;
    assert.throws(()=>g.x.c.withRunSession_(g.run.runId,g.token,'auth',()=>g.x.c.replayLocalRunTransitions_(events,'auth')),/검증|후보|능력치/);
    assert.equal(g.x.c.findRowByKeyUncached_('Runs','runId',g.run.runId).status,'active');
  }
});

test('an acknowledged journal can be retried without granting rewards or moving twice',()=>{
  const g=localGame();g.prepare();g.choose();const events=copy(g.journal);
  const synced=g.x.c.withRunSession_(g.run.runId,g.token,'auth',()=>{g.x.c.replayLocalRunTransitions_(events,'auth');return {score:g.x.c.requireRun_(g.run.runId).score};});
  const retried=g.x.c.withRunSession_(g.run.runId,g.token,'auth',()=>{g.x.c.replayLocalRunTransitions_(events,'auth');return {score:g.x.c.requireRun_(g.run.runId).score};});
  assert.equal(retried.score,synced.score);
  assert.equal(g.x.c.decodeRunSession_(retried.runSessionToken).run.currentStage,2);
});

test('deadline defeat retains transitions selected before expiry and ends the current battle',()=>{
  const g=localGame();g.prepare();g.choose();const deadline=g.x.c.Date.now()+1000;
  g.x.c.updateRowByKey_('Workbooks','workbookId','w',{playTimeLimitEnabled:true,playEndsAt:new Date(deadline)});g.x.tick(2000);
  const payload={runId:g.run.runId,runSessionToken:g.token,localTransitions:copy(g.journal),battle:copy(g.view.battle),stageState:copy(g.view.stageState),answerLogs:[]};
  const saved=g.x.c.commitStageResult(payload,'auth');
  assert.equal(saved.battle.status,'defeat');assert.equal(saved.score,g.run.score);
  assert.equal(saved.localRunState.currentStage,2);
});

test('a deadline shortened before a local selection causes a saved defeat without applying that reward',()=>{
  const g=localGame();g.prepare();g.x.tick(1000);g.choose();
  g.x.c.updateRowByKey_('Workbooks','workbookId','w',{playTimeLimitEnabled:true,playEndsAt:new Date(g.journal[0].selectedAtMs-500)});
  const payload={runId:g.run.runId,runSessionToken:g.token,localTransitions:copy(g.journal),battle:copy(g.view.battle),stageState:copy(g.view.stageState),answerLogs:[]};
  const saved=g.x.c.commitStageResult(payload,'auth');
  assert.equal(saved.battle.status,'defeat');assert.equal(saved.localRunState.currentStage,1);
  assert.equal(saved.localRunState.currency,0);assert.equal(saved.localRunState.sessionSettled,true);
});

test('reaction requests acknowledge local progress and attach the reaction score to the new battle',()=>{
  const g=localGame();g.prepare();g.choose();
  let question={questionId:'q',workbookId:'w',creatorId:'other',likeCount:0,dislikeCount:0,reactionJson:'{}'};
  g.x.c.findRunQuestionById_=()=>question;
  g.x.c.updateWorkbookQuestionById_=(w,id,patch)=>(question={...question,...patch});
  g.x.c.clearWorkbookQuestionCache_=()=>{};
  const result=g.x.c.setQuestionReaction('q','like','auth',g.run.runId,g.token,copy(g.journal));
  assert.equal(result.acknowledgedLocalTransitions.length,1);assert.equal(result.localRunState.currentStage,2);
  assert.equal(result.localRunState.score,g.run.score+10);
});

test('player ghost selection preserves the encounter and does not take a nested lock or consume twice',()=>{
  const g=localGame();
  let locked=false;
  g.x.c.LockService={getScriptLock:()=>({waitLock(){if(locked)throw Error('nested lock');locked=true;},releaseLock(){locked=false;}})};
  g.x.seed('PlayerGhosts',[{ghostId:'eligible-ghost',sourceRunId:'fallen',sourcePlayerId:'other',sourceDisplayName:'Other',
    floor:1,stage:1,status:'active',workbookId:'w'}]);
  const {payload,reward}=g.prepare();
  assert.equal(reward.localTransition.ghostSelection.context.ghostId,'eligible-ghost');
  const response=g.choose();
  assert.equal(response.battle.playerGhost.ghostId,'eligible-ghost');
  assert.equal(response.battle.forcedQuestionCreatorId,'other');
  assert.equal(response.battle.monsters[0].type,'playerGhost');
  assert.equal(response.battle.monsters[0].currentHp,g.x.c.PLAYER_GHOST_FLOOR_CONFIGS[1].hp);
  const before=g.x.writes.filter(s=>s==='PlayerGhosts').length;
  g.x.c.previewRewardChoicesForStageResult({...copy(payload),runSessionToken:g.token,localAdvanceEnabled:true},'auth');
  assert.equal(g.x.writes.filter(s=>s==='PlayerGhosts').length,before);
});

test('answer and battle logs from locally finished stages stay deferred until defeat',()=>{
  const g=localGame(),{payload}=g.prepare();
  const question={questionId:'q',workbookId:'w',creatorId:'other',type:'shortAnswer',prompt:'One?',answer:'1',difficulty:1,answerAliases:'[]'};
  payload.answerLogs=[{questionId:'q',questionSnapshot:question,questionSignature:g.x.c.signLocalQuestionSnapshot_(question),
    selectedAnswer:'1',elapsedMs:1000,maxTimeMs:10000,actionType:'attack',finalDifficulty:1}];
  g.choose();g.x.cache.clear();g.prepare();
  assert.equal(g.x.c.readTableUncached_('BattleAnswerLogQueue').length,0);
  assert.equal(g.x.c.readTableUncached_('BattleLogs').length,0);
  const battle=copy(g.view.battle);battle.status='defeat';battle.player.hp=0;
  g.x.c.commitStageResult({runId:g.run.runId,runSessionToken:g.token,localTransitions:copy(g.journal),battle,stageState:copy(g.view.stageState),answerLogs:[]},'auth');
  assert.equal(g.x.c.readTableUncached_('BattleAnswerLogQueue').length,1);
  assert.equal(g.x.c.readTableUncached_('BattleLogs').filter(log=>log.result==='victory').length,1);
});

test('normal selection runs through the browser handler without a server call',()=>{
  const g=localGame(),{payload,reward}=g.prepare();let handled;
  const nodes=new Map();
  const document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,classList:{remove(){}},textContent:''});return nodes.get(id);}};
  const c=vm.createContext({localRunState:g.run,localRunTransitions:[],localVictoryPendingResponse:null,
    localGameDataSnapshot:g.initial.gameDataSnapshot,currentRewardView:reward,pendingStageAnswerLogs:[{questionId:'q'}],
    workbookDeadlineExpired:false,workbookDeadlineMs:0,rewardSelectionApplying:false,
    workbookClockServerMs:g.x.c.Date.now(),workbookClockPerformanceMs:0,performance:{now:()=>0},
    window:{LearningRpgLocalRunEngine:g.engine},document,buildStageResultPayload:()=>copy(payload),
    shouldShowScoreModal:()=>false,handleRewardSelectionResponse:r=>{handled=r;},
    google:{get script(){throw Error('unexpected server request');}},updateWorkbookCountdown(){}});
  const html=fs.readFileSync(path.join(__dirname,'..','Battle.html'),'utf8');
  for(const name of ['getBossItemChoiceKey','offerBossItemBeforeReward','selectRewardChoice','selectRewardChoiceLocally'])vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],c);
  c.selectRewardChoice(reward.choices[0].rewardId);
  assert.equal(handled.battle.stage.stage,2);assert.equal(c.localRunTransitions.length,1);
  assert.equal(c.pendingStageAnswerLogs.length,0);assert.equal(c.rewardSelectionApplying,false);
});

test('boss item is only applied after the acquisition click and duplicate clicks cannot apply it twice',()=>{
  const g=localGame();
  for(let i=0;i<4;i++){g.prepare();g.choose('stat');}
  const {payload,reward}=g.prepare();
  const choice=reward.choices.find(r=>r.type!=='item')||reward.choices[0];
  const item=reward.bossItemRewards[choice.rewardId];
  let shown,handled;
  const before=JSON.parse(g.run.itemsJson);
  const document={getElementById:()=>({disabled:false,classList:{remove(){}},textContent:''})};
  const c=vm.createContext({pendingBossItemChoice:null,approvedBossItemChoiceKey:'',localRunState:g.run,localRunTransitions:[],localVictoryPendingResponse:null,
    localGameDataSnapshot:g.initial.gameDataSnapshot,currentRewardView:reward,pendingStageAnswerLogs:[],
    workbookDeadlineExpired:false,workbookDeadlineMs:0,rewardSelectionApplying:false,
    workbookClockServerMs:g.x.c.Date.now(),workbookClockPerformanceMs:0,performance:{now:()=>0},
    window:{LearningRpgLocalRunEngine:g.engine},document,buildStageResultPayload:()=>copy(payload),
    shouldShowScoreModal:()=>false,handleRewardSelectionResponse:r=>{handled=r;},
    showScoreModal:(summary,response)=>{shown=response;},updateScoreModalConfirmButton(){},closeScoreModal(){},finishScoreAnimationNow(){},
    google:{get script(){throw Error('unexpected server request');}}});
  const html=fs.readFileSync(path.join(__dirname,'..','Battle.html'),'utf8');
  for(const name of ['getBossItemChoiceKey','offerBossItemBeforeReward','claimBossItemReward','selectRewardChoice','selectRewardChoiceLocally'])
    vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],c);
  c.selectRewardChoice(choice.rewardId);
  assert.equal(shown.bossItemClaimPending,true);
  assert.equal(shown.bonusItemReward.targetId,item.targetId);
  assert.deepEqual(JSON.parse(c.localRunState.itemsJson),before);
  assert.equal(c.localRunTransitions.length,0);
  c.claimBossItemReward();
  assert.ok(handled);
  assert.equal(JSON.parse(c.localRunState.itemsJson).filter(i=>i.itemId===item.targetId).length,1);
  assert.equal(c.localRunTransitions.length,1);
  c.claimBossItemReward();
  assert.equal(c.localRunTransitions.length,1);
});

test('late server acknowledgements cannot overwrite a more recent local selection',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','Battle.html'),'utf8');
  const original={currentStage:3};
  const c=vm.createContext({runSessionRevision:1,runSessionToken:'old',localRunState:original,
    localRunTransitions:[{rewardToken:'payload.first'},{rewardToken:'payload.second'}]});
  vm.runInContext(html.match(/    function rememberRunSession\([^]*?\n    \}/)[0],c);
  c.rememberRunSession({runSessionToken:'new',runSessionRevision:2,acknowledgedLocalTransitions:['first'],localRunState:{currentStage:2}});
  assert.equal(c.localRunTransitions.length,1);assert.equal(c.localRunState,original);
  c.rememberRunSession({runSessionToken:'newer',runSessionRevision:3,acknowledgedLocalTransitions:['first','second'],localRunState:{currentStage:3}});
  assert.equal(c.localRunTransitions.length,0);assert.equal(c.localRunState.currentStage,3);
});

test('the browser chooses locally, keeps terminal saves and sends its journal on existing requests',()=>{
  const html=fs.readFileSync(path.join(__dirname,'..','Battle.html'),'utf8');
  const extract=n=>html.match(new RegExp('    function '+n+'\\([^]*?\\n    \\}'))[0];
  assert.match(extract('selectRewardChoice'),/selectRewardChoiceLocally\(rewardId\)/);
  assert.doesNotMatch(extract('selectRewardChoiceLocally'),/google\.script|advanceRunStage/);
  assert.match(extract('saveLocalRunVictory'),/\.finishLocalRun\(/);
  assert.match(extract('buildStageResultPayload'),/localTransitions: localRunTransitions\.slice/);
});


test('stage 6 rest preview preserves payload HP and heals exactly once on transition',()=>{
  const g=localGame();
  for(let i=0;i<5;i++){
    const prepared=g.prepare();
    if(i===4)prepared.payload.battle.player.hp=1;
    g.choose('stat');
  }
  assert.equal(g.view.battle.stage.stage,6);
  const rest=g.view.rewardView.choices.find(c=>c.type==='rest');
  const before=g.view.battle.player.hp;
  let displayed;
  const html=fs.readFileSync('Battle.html','utf8');
  const start=html.indexOf('    function playFloorRestEffect('),end=html.indexOf('\n    function ',start+1);
  const c={currentView:g.view,renderPlayerHud:p=>{displayed=p.hp;},playBattleSound(){},animatePlayerStatusEffect(){},spawnFloatingText(){},pushLog(){},document:{getElementById(){return {};}}};
  vm.createContext(c);vm.runInContext(html.slice(start,end),c);c.playFloorRestEffect(rest);
  assert.equal(g.view.battle.player.hp,before);
  assert.equal(displayed,rest.currentHpAfterRest);
  assert.ok(displayed>before);
  const {payload,reward}=g.prepare();
  assert.equal(payload.battle.player.hp,before);
  const result=g.choose('rest');
  assert.equal(result.localRunState.currentHp,rest.currentHpAfterRest);
  const server=g.x.c.withRunSession_(g.run.runId,g.token,'auth',()=>{
    g.x.c.replayLocalRunTransitions_(copy(g.journal),'auth');
    return {hp:g.x.c.requireRun_(g.run.runId).currentHp};
  });
  assert.equal(server.hp,rest.currentHpAfterRest);
});
