const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {context, start, copy} = require('./run-session.test.cjs');

function game() {
  const x = context(), initial = start(x);
  const engine = vm.runInNewContext(x.c.getLocalRunEngineSource_(), {Date:x.c.Date});
  return {x, initial, engine, view:initial, run:initial.localRunState, token:initial.runSessionToken, journal:[]};
}
function payload(g) {
  return {runId:g.run.runId, runSessionToken:g.token, localAdvanceEnabled:true,
    localTransitions:copy(g.journal), battle:copy(g.view.battle), stageState:copy(g.view.stageState), answerLogs:[]};
}
function remember(g, view) {
  g.token = view.runSessionToken;
  g.run = view.localRunState;
  g.journal = g.journal.filter(e => !(view.acknowledgedLocalTransitions || []).includes(e.rewardToken.split('.')[1]));
}
function victory(g, p) {
  p.battle.status = 'victory';
  p.battle.player.hp = Math.max(1, p.battle.player.maxHp - 30);
  p.battle.monsters.forEach(m => {m.currentHp=0;});
  p.battle.monsterScoreState = {battleId:p.battle.battleId, monsterScore:100, byMonsterId:{}, scoreAwardedToRun:0};
  return p;
}

test('combat preparation neither applies rewards nor consumes ghosts; victory reuses the plan', () => {
  const g=game(), {x}=g;
  x.seed('PlayerGhosts', [{ghostId:'ghost', sourceRunId:'fallen', sourcePlayerId:'other', sourceDisplayName:'Other', floor:1, stage:1, status:'active', workbookId:'w'}]);
  const before=copy(g.run), p=payload(g);
  x.writes.length=0;
  const plan=x.c.previewRewardChoicesForStageResult({...p,prepareDuringBattle:true},'auth');
  assert.deepEqual(copy(plan.localRunState),before);
  assert.equal(plan.localTransitionToken,undefined);
  assert.equal(plan.battleCompletionReceipt,undefined);
  assert.equal(x.writes.length,0);
  remember(g,plan);
  x.tick(5000);
  const result= victory(g,payload(g));
  result.rewardPreparationToken=plan.rewardPreparationToken;
  const local=g.engine.reward(g.run,g.initial.gameDataSnapshot,result,plan);
  const reward=x.c.previewRewardChoicesForStageResult(result,'auth');
  assert.deepEqual(copy(reward.choices),copy(local.choices));
  assert.equal(reward.regenAmount,local.regenAmount);
  assert.equal(reward.currentHpAfterRegen,local.currentHpAfterRegen);
  assert.equal(reward.localTransition.ghostSelection.context.ghostId,'ghost');
  assert.equal(reward.battleCompletionReceipt.completedAtMs,x.c.Date.now());
  assert.equal(reward.preparedDuringBattle,undefined);
  assert.ok(reward.localTransitionToken);
  const writes=x.writes.length;
  x.c.previewRewardChoicesForStageResult(result,'auth');
  assert.equal(x.writes.length,writes);
});

test('signed preparation survives cache loss and rejects use for another battle or early advancement', () => {
  const g=game(), plan=g.x.c.prepareRewardChoicesDuringBattle(payload(g),'auth');
  remember(g,plan); g.x.cache.clear(); g.x.tick(5000);
  const p=victory(g,payload(g)); p.rewardPreparationToken=plan.rewardPreparationToken;
  const reward=g.x.c.previewRewardChoicesForStageResult(p,'auth');
  assert.deepEqual(copy(reward.choices.map(c=>c.rewardId)),copy(plan.choices.map(c=>c.rewardId)));
  g.x.cache.clear(); p.battle.battleId='wrong-battle';
  assert.throws(()=>g.x.c.previewRewardChoicesForStageResult(p,'auth'),/현재 전투/);
  const early={payload:victory(g,payload(g)), rewardId:plan.choices[0].rewardId, rewardToken:plan.rewardPreparationToken, selectedAtMs:g.x.c.Date.now()};
  assert.throws(()=>g.x.c.previewRewardChoicesForStageResult({...payload(g),localTransitions:[early]},'auth'),/전투 종료 확인/);
});

test('prefetched rewards preserve local/server parity through every floor, rest and final victory', () => {
  const g=game(); let count=0;
  while(g.run.status==='active' && count<35) {
    let p=payload(g), reward=g.view.rewardView;
    if(!reward) {
      const plan=g.x.c.prepareRewardChoicesDuringBattle(p,'auth'); remember(g,plan);
      g.x.tick(5000); p=victory(g,payload(g)); p.rewardPreparationToken=plan.rewardPreparationToken;
      reward=g.x.c.previewRewardChoicesForStageResult(p,'auth'); remember(g,reward);
    } else { g.x.tick(5000); p.battle.status='victory'; }
    const choice=reward.choices.find(c=>c.type===(reward.floorRestChoice?'rest':'stat')) || reward.choices[0];
    p.stageState.reward=copy(reward);
    const selectedAtMs=g.x.c.Date.now();
    const local=g.engine.advance(g.run,g.initial.gameDataSnapshot,p,choice.rewardId,reward,{selectedAtMs});
    const event={payload:copy(p),rewardId:choice.rewardId,rewardToken:reward.localTransitionToken,selectedAtMs};
    // Replay uses the same signed choices but independently evaluates HP and scores.
    const checked=g.x.c.withRunSession_(g.run.runId,g.token,'auth',()=>{
      g.x.c.replayLocalRunTransitions_([event],'auth');
      return {localRunState:copy(g.x.c.requireRun_(g.run.runId))};
    });
    for(const key of ['statsJson','skillsJson','itemsJson','currentHp','currency','score','currentFloor','currentStage']) {
      assert.deepEqual(local.localRunState[key],checked.localRunState[key],`stage ${count}: ${key}`);
    }
    if(local.showReward) {
      const heal=local.rewardView.choices.find(c=>c.type==='rest');
      const max=g.x.c.calculateStatsWithItemEffects_(JSON.parse(local.localRunState.statsJson),JSON.parse(local.localRunState.itemsJson)).hp;
      assert.equal(heal.healAmount,Math.min(Math.ceil(max*g.x.c.GAME_RULES.FLOOR_REST_HEAL_PERCENT/100),max-local.localRunState.currentHp));
    }
    g.view=local; g.run=local.localRunState; remember(g,checked); g.journal=[]; count++;
  }
  assert.equal(g.run.status,'cleared'); assert.equal(count,29);
});

test('reward UI displays the prefetched plan while victory finalization is still pending', async () => {
  const g=game(), plan=g.x.c.prepareRewardChoicesDuringBattle(payload(g),'auth'); remember(g,plan);
  const p=victory(g,payload(g));
  const html=fs.readFileSync('Battle.html','utf8');
  let callback, displayed=0, requested;
  const c=vm.createContext({currentView:{...g.view,battle:p.battle},localRunState:g.run,localGameDataSnapshot:g.initial.gameDataSnapshot,
    window:{LearningRpgLocalRunEngine:g.engine},isDummyMode:false,workbookDeadlineExpired:false,
    victoryRewardPreload:null,victoryRewardResultPayload:null,battleRewardPreparation:{key:[p.runId,p.battle.battleId,p.battle.stage.stageId].join(':'),loading:false,rewardView:plan},
    victoryRewardRecoveryComplete:true,victoryRewardDisplayStarted:false,runSessionToken:g.token,localRunTransitions:[],
    buildStageResultPayload:()=>copy(p),getPendingQuestionUnderstanding:()=>[],getAuthToken:()=> 'auth',showPreparedVictoryReward:()=>{displayed++;},
    google:{script:{run:{withSuccessHandler(fn){callback=fn;return this;},withFailureHandler(){return this;},previewRewardChoicesForStageResult(p){requested=p;}}}}});
  for(const name of ['getVictoryRewardKey','preloadVictoryRewardChoices']) vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],c);
  c.preloadVictoryRewardChoices(c.currentView);
  assert.equal(displayed,1); assert.equal(c.victoryRewardPreload.loading,true);
  assert.ok(c.victoryRewardPreload.rewardView.choices.length);
  assert.equal(requested.rewardPreparationToken,plan.rewardPreparationToken);
  assert.equal(typeof callback,'function');
  // A rapid confirm is queued once; it cannot apply unsigned or incomplete progress.
  const nodes=new Map(); let selected=0;
  c.document={getElementById:id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:''});return nodes.get(id);}};
  c.currentRewardView=c.victoryRewardPreload.rewardView;
  c.rewardSelectionApplying=false;
  c.offerBossItemBeforeReward=()=>false;
  c.selectRewardChoiceLocally=()=>{selected++;};
  c.rememberRunSession=()=>{};
  c.ensureClientRewardState=()=>{};
  c.victoryRewardDisplayStarted=true;
  vm.runInContext(html.match(/    function selectRewardChoice\([^]*?\n    \}/)[0],c);
  const choice=plan.choices[0].rewardId;
  c.selectRewardChoice(choice); c.selectRewardChoice(choice);
  assert.equal(selected,0); assert.equal(c.rewardSelectionApplying,true);
  const finalized=g.x.c.previewRewardChoicesForStageResult(requested,'auth');
  callback(finalized);
  assert.equal(selected,1); assert.equal(c.currentRewardView.localTransitionToken,finalized.localTransitionToken);
  assert.equal(c.currentRewardView.preparedDuringBattle,undefined);
});

test('background preparation uses the existing RPC and falls back on an older server', async () => {
  const html=fs.readFileSync('Battle.html','utf8');
  const calls=[]; let failure;
  const runner={withSuccessHandler(){return this;},withFailureHandler(fn){failure=fn;return this;},
    previewRewardChoicesForStageResult(p){calls.push(p);if(p.prepareDuringBattle)failure({message:'전투 승리 후에만 보상을 받을 수 있습니다.'});}};
  const view={runId:'run',battle:{battleId:'battle',status:'active',stage:{stageId:'1-1'}}};
  const c=vm.createContext({isDummyMode:false,localRunState:{},localGameDataSnapshot:{},
    window:{LearningRpgLocalRunEngine:{reward(){throw Error('no plan should be used');}}},google:{script:{run:runner}},
    battleRewardPreparation:null,victoryRewardPreload:null,victoryRewardResultPayload:null,
    workbookDeadlineExpired:false,runSessionToken:'token',localRunTransitions:[],
    buildStageResultPayload:v=>({runId:v.runId,battle:copy(v.battle)}),getPendingQuestionUnderstanding:()=>[],getAuthToken:()=> 'auth'});
  for(const name of ['getVictoryRewardKey','prepareBattleRewardsInBackground','preloadVictoryRewardChoices']) {
    vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],c);
  }
  c.prepareBattleRewardsInBackground(view);
  assert.equal(await c.battleRewardPreparation.promise,null);
  assert.equal(c.battleRewardPreparation.loading,false);
  c.preloadVictoryRewardChoices({...view,battle:{...view.battle,status:'victory'}});
  assert.equal(calls.length,2);
  assert.equal(calls[0].prepareDuringBattle,true);
  assert.equal(calls[1].prepareDuringBattle,undefined);
  assert.equal(calls[1].battle.status,'victory');
  assert.doesNotMatch(html,/\.prepareRewardChoicesDuringBattle\(/);
});

test('a synchronous Apps Script bridge error settles preparation instead of rejecting or hanging', async () => {
  const html=fs.readFileSync('Battle.html','utf8');
  const c=vm.createContext({isDummyMode:false,localRunState:{},
    window:{LearningRpgLocalRunEngine:{reward(){}}},battleRewardPreparation:null,
    getVictoryRewardKey:()=> 'stage',buildStageResultPayload:()=> ({}),getPendingQuestionUnderstanding:()=>[],getAuthToken:()=> 'auth',
    google:{script:{run:{withSuccessHandler(){return this;},withFailureHandler(){return this;}}}}});
  vm.runInContext(html.match(/    function prepareBattleRewardsInBackground\([^]*?\n    \}/)[0],c);
  c.prepareBattleRewardsInBackground({battle:{status:'active'}});
  assert.equal(await c.battleRewardPreparation.promise,null);
  assert.equal(c.battleRewardPreparation.loading,false);
});
