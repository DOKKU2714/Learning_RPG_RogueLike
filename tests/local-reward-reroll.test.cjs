const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {context,start,advance,copy}=require('./run-session.test.cjs');

function game(stagesBefore=0) {
  const x=context();let initial=start(x);
  const snapshot=initial.gameDataSnapshot;
  for(let i=0;i<stagesBefore;i++)initial={...advance(x,initial).response,gameDataSnapshot:snapshot};
  const battle=copy(initial.battle);
  battle.status='victory';battle.monsters.forEach(m=>m.currentHp=0);
  x.c.readRunQuestionsForBattle_=()=>[{questionId:'weak',type:'multipleChoice',status:'approved',answer:'2',totalCount:5,correctCount:0}];
  const payload={runId:initial.runId,runSessionToken:initial.runSessionToken,localAdvanceEnabled:true,localTransitions:[],battle,stageState:{},answerLogs:[]};
  const view=x.c.previewRewardChoicesForStageResult(payload,'auth');
  // Exercise a skill-choice stage permit; current default combat rewards are continue-only.
  const skills=JSON.parse(view.localRunState.skillsJson || '[]');
  view.choices=copy(x.c.pickRewardChoices_(view.rewardGroupId,1,skills,[]));
  view.rerollQuestion={questionId:'weak',type:'multipleChoice',answer:'2',totalCount:5};
  x.c.signLocalRewardView_(view);
  payload.runSessionToken=view.runSessionToken;
  const engine=vm.runInNewContext(x.c.getLocalRunEngineSource_(),{Date:x.c.Date,Math:x.c.Math});
  return {x,initial,payload,view,engine};
}

test('local reroll: browser and replay draw identical choices and preserve the signed permit, currency and recovery',()=>{
  const g=game(),answer={selectedChoiceIndex:2};
  const result=g.engine.rerollReward(g.view.localRunState,g.initial.gameDataSnapshot,g.payload,g.view,answer);
  assert.equal(result.rerollStatus,'success');
  const replay=g.x.c.getLocalRunRuleEngine_().rerollReward(g.view.localRunState,g.initial.gameDataSnapshot,g.payload,g.x.c.verifyLocalRewardView_(g.view.localTransitionToken),answer);
  assert.deepEqual(copy(result.rewardView.choices),copy(replay.rewardView.choices));
  for(const key of ['localTransitionToken','currencyAmount','regenAmount','currentHpAfterRegen','battleCompletionReceipt'])assert.deepEqual(copy(result.rewardView[key]??null),copy(g.view[key]??null),key);
  assert.equal(g.view.rerollUsed,false,'source permit remains unchanged');
  assert.throws(()=>g.engine.rerollReward(g.view.localRunState,g.initial.gameDataSnapshot,g.payload,result.rewardView,answer),/새로고침/);
});

test('local reroll: wrong answers and giving up keep the choices and consume the attempt',()=>{
  const g=game();
  for(const answer of [{selectedChoiceIndex:1},{giveUp:true}]) {
    const result=g.engine.rerollReward(g.view.localRunState,g.initial.gameDataSnapshot,g.payload,g.view,answer);
    assert.equal(result.rerollStatus,'failed');assert.equal(result.rewardView.rerollUsed,true);
    assert.deepEqual(copy(result.rewardView.choices),copy(g.view.choices));
    assert.deepEqual(copy(result.rewardView.localRerollAnswer),answer);
  }
});

test('local reroll: locally advancing and server replay produce the same next battle without duplicate rewards',()=>{
  const g=game(),answer={selectedChoiceIndex:2};
  const view=g.engine.rerollReward(g.view.localRunState,g.initial.gameDataSnapshot,g.payload,g.view,answer).rewardView;
  const payload={...g.payload,localRewardRerollAnswer:answer,stageState:{reward:view}};
  const selectedAtMs=Math.max(g.x.c.Date.now(),view.localTransition.issuedAtMs);
  const response=g.engine.advance(g.view.localRunState,g.initial.gameDataSnapshot,payload,view.choices[0].rewardId,view,{selectedAtMs});
  const event={payload,rewardId:view.choices[0].rewardId,rewardToken:g.view.localTransitionToken,selectedAtMs};
  g.x.c.withRunSession_(g.initial.runId,g.view.runSessionToken,'auth',()=>{
    g.x.c.replayLocalRunTransitions_([event],'auth');
    assert.deepEqual(copy(g.x.c.requireRun_(g.initial.runId)),copy(response.localRunState));
    const before=copy(g.x.c.requireRun_(g.initial.runId));
    g.x.c.replayLocalRunTransitions_([event],'auth');
    assert.deepEqual(copy(g.x.c.requireRun_(g.initial.runId)),before);
  });
});

test('local reroll: UI completes immediately without using the RPC bridge',()=>{
  const html=fs.readFileSync('Battle.html','utf8');
  const source=html.match(/    function requestRewardReroll\([^]*?\n    \}/)[0];
  const nodes={questionSubmitButton:{},questionMessage:{}};
  const ui=vm.createContext({localRunState:{},localGameDataSnapshot:{},currentView:{},
    currentRewardView:{},currentQuestionView:{isRewardReroll:true},victoryRewardPreload:{},
    window:{LearningRpgLocalRunEngine:{rerollReward:()=>({rerollStatus:'success',rewardView:{rerollUsed:true}})}},
    buildStageResultPayload:()=>({}),ensureClientRewardState(){},
    document:{getElementById:id=>nodes[id]},google:{get script(){throw Error('Unexpected RPC');}}});
  vm.runInContext(source,ui);ui.requestRewardReroll('answer',{selectedChoiceIndex:2});
  assert.equal(ui.currentQuestionView.rerollComplete,true);
  assert.equal(ui.currentQuestionView.rerollStatus,'success');
  assert.equal(nodes.questionSubmitButton.disabled,false);
});

test('local reroll: a newly drawn skill can be upgraded at the next rest stage and replayed',()=>{
  const g=game(4),answer={selectedChoiceIndex:2};
  const view=g.engine.rerollReward(g.view.localRunState,g.initial.gameDataSnapshot,g.payload,g.view,answer).rewardView;
  const choice=view.choices.find(r=>r.type==='skill');assert.ok(choice);
  const payload={...g.payload,localRewardRerollAnswer:answer,stageState:{reward:view}};
  const selectedAtMs=Math.max(g.x.c.Date.now(),view.localTransition.issuedAtMs);
  const response=g.engine.advance(g.view.localRunState,g.initial.gameDataSnapshot,payload,choice.rewardId,view,{selectedAtMs});
  assert.equal(response.rewardView.floorRestChoice,true);
  const upgrade=response.rewardView.choices.find(r=>r.type==='skillUpgrade' && r.targetId===choice.targetId);
  assert.ok(upgrade,'new skill appears in rest upgrades');
  const restPayload={runId:g.initial.runId,battle:copy(response.battle),stageState:copy(response.stageState),answerLogs:[]};
  restPayload.battle.status='victory';
  const restTime=Math.max(selectedAtMs,response.rewardView.localTransition.issuedAtMs);
  const next=g.engine.advance(response.localRunState,g.initial.gameDataSnapshot,restPayload,upgrade.rewardId,response.rewardView,{selectedAtMs:restTime});
  const events=[{payload,rewardId:choice.rewardId,rewardToken:g.view.localTransitionToken,selectedAtMs},
    {payload:restPayload,rewardId:upgrade.rewardId,rewardToken:response.rewardView.localTransitionToken,selectedAtMs:restTime}];
  g.x.c.withRunSession_(g.initial.runId,g.view.runSessionToken,'auth',()=>{
    g.x.c.replayLocalRunTransitions_(events,'auth');
    assert.deepEqual(copy(g.x.c.requireRun_(g.initial.runId)),copy(next.localRunState));
  });
});

test('local reroll: replay rejects a successful reward when the recorded answer was wrong',()=>{
  const g=game(),answer={selectedChoiceIndex:2};
  const view=g.engine.rerollReward(g.view.localRunState,g.initial.gameDataSnapshot,g.payload,g.view,answer).rewardView;
  const event={payload:{...g.payload,localRewardRerollAnswer:{selectedChoiceIndex:1}},rewardId:view.choices[0].rewardId,
    rewardToken:g.view.localTransitionToken,selectedAtMs:Math.max(g.x.c.Date.now(),view.localTransition.issuedAtMs)};
  assert.throws(()=>g.x.c.withRunSession_(g.initial.runId,g.view.runSessionToken,'auth',()=>g.x.c.replayLocalRunTransitions_([event],'auth')));
});

test('local reroll: UI state carries the answer into the next progress payload',()=>{
  const html=fs.readFileSync('Battle.html','utf8');
  const answer={selectedChoiceIndex:2};
  const ui=vm.createContext({currentView:{runId:'r',battle:{}},localRunState:{},window:{LearningRpgLocalRunEngine:{}},
    runSessionToken:'session',localRunTransitions:[],pendingStageAnswerLogs:[],
    getClientUsedQuestionIds(){},buildStageResultAnswerLogPayload:a=>a,buildStageResultBattlePayload:b=>b,buildStageResultStageStatePayload:v=>v.stageState});
  for(const name of ['ensureClientRewardState','buildStageResultPayload'])vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],ui);
  ui.ensureClientRewardState({stageId:'s',rerollUsed:true,localRerollAnswer:answer,choices:[]});
  assert.deepEqual(copy(ui.buildStageResultPayload().localRewardRerollAnswer),answer);
});
