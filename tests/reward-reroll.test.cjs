const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { context, start, copy } = require('./run-session.test.cjs');

function game(type = 'multipleChoice') {
  const x = context(), initial = start(x), run = initial.localRunState;
  const state = JSON.parse(run.stageStateJson), battle = copy(initial.battle);
  battle.status = 'victory';
  battle.monsters.forEach(m => { m.currentHp = 0; });
  x.c.readRunQuestionsForBattle_ = () => [{ questionId: 'weak', type, status: 'approved',
    prompt: '문제', answer: type === 'multipleChoice' ? '2' : '정답', answerAliases: '["별칭"]',
    choice1: '오답', choice2: '정답', correctCount: 0, totalCount: 10, difficulty: 5 }];
  let payload = { runId: run.runId, runSessionToken: initial.runSessionToken, localAdvanceEnabled: true,
    localTransitions: [], battle, stageState: state, answerLogs: [] };
  const original = x.c.previewRewardChoicesForStageResult(payload, 'auth');
  payload.runSessionToken = original.runSessionToken;
  payload.rewardToken = original.localTransitionToken;
  payload.stageState.reward = copy(original);
  function request(action, answer) {
    const result = x.c.previewRewardChoicesForStageResult({ ...payload, rewardRerollAction: action, rerollAnswer: answer }, 'auth');
    payload.runSessionToken = result.runSessionToken;
    return result;
  }
  return { x, initial, original, payload, request };
}

test('reroll chooses randomly only among the lowest accuracy questions across difficulties', () => {
  const { c } = context();
  const questions = [
    { questionId: 'good', correctCount: 9, totalCount: 10, difficulty: 1 },
    { questionId: 'low1', correctCount: 1, totalCount: 10, difficulty: 5 },
    { questionId: 'low2', correctCount: 2, totalCount: 20, difficulty: 2 },
    { questionId: 'excluded', correctCount: 0, totalCount: 10, status: 'pending' },
  ].map(q => ({ status: 'approved', ...q }));
  assert.ok(['low1', 'low2'].includes(c.pickRewardRerollQuestion_(questions).questionId));
  assert.ok(['low1', 'low2'].includes(c.pickRewardRerollQuestion_([{ ...questions[0], questionId: 'unattempted', totalCount: 0 }, ...questions]).questionId));
  assert.equal(c.pickRewardRerollQuestion_([]), null);
});

test('reroll excludes unattempted questions and still allows attempted questions with zero correct answers', () => {
  const { c } = context();
  const unattempted = [0, undefined, '', -1, 'invalid', Infinity].map((totalCount, i) => ({
    questionId: 'unattempted-' + i, status: 'approved', totalCount, correctCount: 0,
  }));
  assert.equal(c.pickRewardRerollQuestion_(unattempted), null);
  const wrong = { questionId: 'wrong', status: 'approved', totalCount: 1, correctCount: 0 };
  assert.equal(c.pickRewardRerollQuestion_([...unattempted, wrong]).questionId, 'wrong');
});

test('no attempted questions leaves normal rewards intact and does not preload a reroll question', () => {
  const { c } = context();
  c.readRunQuestionsForBattle_ = () => [{ questionId: 'new', status: 'approved', totalCount: 0, correctCount: 0 }];
  const view = { rerollUsed: false, choices: [{rewardId:'keep'}] };
  assert.equal(c.prepareRewardRerollQuestion_(view, {}), view);
  assert.equal(view.rerollQuestion, undefined);
  assert.deepEqual(view.choices, [{rewardId:'keep'}]);
});

test('reroll wrong multiple choice fails once, keeps all rewards and survives cache loss', () => {
  const g = game();
  const challenge = g.request('start');
  assert.equal(challenge.rerollStatus, 'pending');
  assert.equal(challenge.rerollQuestion.questionId, 'weak');
  assert.equal(challenge.rerollQuestion.answer, '2');
  assert.equal(challenge.rewardView.rerollUsed, true);
  const failed = g.request('answer', { selectedChoiceIndex: 1 });
  assert.equal(failed.rerollStatus, 'failed');
  assert.deepEqual(copy(failed.rewardView.choices), copy(g.original.choices));
  g.x.cache.clear();
  const again = g.request('answer', { selectedChoiceIndex: 2 });
  assert.equal(again.rerollStatus, 'failed');
  assert.equal(again.rewardView.localTransitionToken, failed.rewardView.localTransitionToken);
});

test('reroll success issues signed choices without extra currency or healing and advances locally', () => {
  const g = game();
  g.request('start');
  const result = g.request('answer', { selectedChoiceIndex: 2 });
  assert.equal(result.rerollStatus, 'success');
  assert.equal(result.rewardView.rerollUsed, true);
  assert.notEqual(result.rewardView.localTransitionToken, g.original.localTransitionToken);
  // The fixture has a small skill pool; excluding the first draw may leave
  // fewer legal cards now that stat and item rewards cannot fill the gaps.
  assert.ok(result.rewardView.choices.length > 0);
  assert.ok(result.rewardView.choices.length <= g.original.choices.length);
  for (const view of [g.original, result.rewardView]) {
    assert.ok(view.choices.every(reward => ['skill', 'skillUpgrade'].includes(reward.type)));
  }
  const identity = reward => [reward.type,reward.targetId,reward.value].join(':');
  const previous = g.original.choices.map(identity);
  assert.ok(result.rewardView.choices.every(reward => !previous.includes(identity(reward))), 'reroll excludes all previous choices even with fixed randomness');
  assert.equal(result.rewardView.currencyAmount, g.original.currencyAmount);
  assert.equal(result.rewardView.currentHpAfterRegen, g.original.currentHpAfterRegen);
  assert.deepEqual(copy(result.rewardView.battleCompletionReceipt), copy(g.original.battleCompletionReceipt));
  assert.deepEqual(copy(g.x.c.verifyLocalRewardView_(result.rewardView.localTransitionToken).choices), copy(result.rewardView.choices));
  const engine = vm.runInNewContext(g.x.c.getLocalRunEngineSource_(), { Date: g.x.c.Date });
  const choice = result.rewardView.choices[0];
  const payload = copy(g.payload);
  payload.stageState.reward = copy(result.rewardView);
  const next = engine.advance(g.initial.localRunState, g.initial.gameDataSnapshot, payload, choice.rewardId, result.rewardView, { selectedAtMs: g.x.c.Date.now() });
  assert.equal(next.localRunState.currentStage, 2);
  const duplicate = g.request('start');
  assert.equal(duplicate.rewardView.localTransitionToken, result.rewardView.localTransitionToken);
});

test('reroll counts current-run attempts before sheet settlement and never double-counts committed battles', () => {
  const x=context(),initial=start(x),run=x.c.decodeRunSession_(initial.runSessionToken).run;
  const question={questionId:'recent',workbookId:'w',type:'multipleChoice',status:'approved',answer:'2',correctCount:0,totalCount:0};
  x.c.readRunQuestionsForBattle_=()=>[question,{...question,questionId:'unseen'}];
  const base={questionId:'recent',questionSnapshot:question,questionSignature:x.c.signLocalQuestionSnapshot_(question),attemptsRecorded:true};
  const payload={battle:initial.battle,answerLogs:[{...base,selectedChoiceIndex:1,attemptOnly:true},{...base,selectedChoiceIndex:2,wrongCountAfterTimeout:1}]};
  const counts=x.c.getRewardRerollQuestions_(run,payload);
  assert.deepEqual(copy(counts.map(q=>[q.questionId,q.totalCount,q.correctCount])),[['recent',1,0],['unseen',0,0]]);
  assert.equal(x.c.pickRewardRerollQuestion_(counts).questionId,'recent');
  assert.equal(question.totalCount,0,'master question statistics remain unchanged');
  x.c.ACTIVE_RUN_SESSION_={answerBatches:[{battle:{battleId:initial.battle.battleId},logs:[{questionId:'recent',isCorrect:false}]}]};
  assert.deepEqual(copy(x.c.getRewardRerollQuestions_(run,payload)),copy(counts));
  x.c.ACTIVE_RUN_SESSION_=null;
});

test('reroll refreshes an unavailable combat plan with the just-completed battle answers', () => {
  const x=context(),initial=start(x);
  const question={questionId:'recent',workbookId:'w',creatorId:'p',type:'multipleChoice',status:'approved',prompt:'문제',answer:'2',choice1:'오답',choice2:'정답',difficulty:1,correctCount:0,totalCount:0};
  x.c.readRunQuestionsForBattle_=()=>[question];
  const payload={runId:initial.runId,runSessionToken:initial.runSessionToken,localAdvanceEnabled:true,localTransitions:[],battle:copy(initial.battle),stageState:copy(initial.stageState),answerLogs:[]};
  const plan=x.c.prepareRewardChoicesDuringBattle(payload,'auth');
  assert.equal(plan.rerollUnavailable,true);
  payload.runSessionToken=plan.runSessionToken;
  payload.battle.status='victory';payload.battle.monsters.forEach(m=>{m.currentHp=0;});
  payload.rewardPreparationToken=plan.rewardPreparationToken;
  payload.answerLogs=[{questionId:'recent',questionSnapshot:question,questionSignature:x.c.signLocalQuestionSnapshot_(question),selectedChoiceIndex:1,wrongCountAfterTimeout:1}];
  const reward=x.c.previewRewardChoicesForStageResult(payload,'auth');
  assert.equal(reward.rerollUnavailable,false);
  assert.equal(reward.rerollQuestion.questionId,'recent');
  assert.equal(reward.rerollQuestion.totalCount,1);
  assert.equal(reward.rerollQuestion.correctCount,0);
  const pending=x.c.previewRewardChoicesForStageResult({...payload,runSessionToken:reward.runSessionToken,rewardToken:reward.localTransitionToken,rewardRerollAction:'start'},'auth');
  assert.equal(pending.rerollStatus,'pending');
  assert.equal(pending.rerollQuestion.questionId,'recent');
});

test('reroll without attempted questions reports unavailable without consuming the chance or redrawing rewards', () => {
  const g=game(),view=copy(g.original);
  delete view.rerollQuestion;
  g.x.c.readRunQuestionsForBattle_=()=>[{questionId:'new',type:'multipleChoice',status:'approved',totalCount:0}];
  g.payload.rewardToken=g.x.c.signLocalRewardView_(view).localTransitionToken;
  const response=g.request('start');
  assert.equal(response.rerollStatus,'unavailable');
  assert.equal(response.rewardView.rerollUsed,false);
  assert.equal(response.rewardView.rerollUnavailable,true);
  assert.match(response.rerollMessage,/풀이 기록/);
  assert.deepEqual(copy(response.rewardView.choices),copy(view.choices));
});

test('reroll ships its question with rewards and accepts the first answer without a start round trip', () => {
  const g = game();
  assert.equal(g.original.rerollQuestion.questionId, 'weak');
  assert.equal(g.original.rerollQuestion.answer, '2');
  assert.equal(g.request('answer', { selectedChoiceIndex: 2 }).rerollStatus, 'success');
});

test('reroll resets on the next stage after either success or failure and remains once per stage', () => {
  for (const firstAnswer of [1, 2]) {
    const g = game();
    const first = g.request('answer', { selectedChoiceIndex:firstAnswer });
    assert.equal(first.rewardView.rerollUsed, true);
    assert.equal(g.request('answer', { selectedChoiceIndex:2 }).rerollStatus, first.rerollStatus);
    const engine = vm.runInNewContext(g.x.c.getLocalRunEngineSource_(), { Date:g.x.c.Date });
    const payload = copy(g.payload);
    payload.stageState.reward = copy(first.rewardView);
    const choice = first.rewardView.choices[0], selectedAtMs = g.x.c.Date.now();
    const next = engine.advance(g.initial.localRunState, g.initial.gameDataSnapshot, payload, choice.rewardId, first.rewardView, { selectedAtMs });
    const battle = copy(next.battle);
    battle.status = 'victory'; battle.monsters.forEach(m => { m.currentHp=0; });
    const nextPayload = { runId:payload.runId, runSessionToken:g.payload.runSessionToken, localAdvanceEnabled:true,
      localTransitions:[{payload, rewardId:choice.rewardId, rewardToken:first.rewardView.localTransitionToken, selectedAtMs}],
      battle, stageState:next.stageState, answerLogs:[] };
    const rewards = g.x.c.previewRewardChoicesForStageResult(nextPayload, 'auth');
    assert.notEqual(rewards.stageId, first.rewardView.stageId);
    assert.equal(rewards.rerollUsed, false);
    const second = g.x.c.previewRewardChoicesForStageResult({ ...nextPayload, runSessionToken:rewards.runSessionToken,
      rewardToken:rewards.localTransitionToken, rewardRerollAction:'answer', rerollAnswer:{selectedChoiceIndex:2} }, 'auth');
    assert.equal(second.rerollStatus, 'success');
    assert.equal(second.rewardView.rerollUsed, true);
  }
});

test('reroll short answers accept aliases and lock failures or giving up', () => {
  const g = game('shortAnswer');
  g.request('start');
  assert.equal(g.request('answer', { selectedAnswerText: '별칭' }).rerollStatus, 'success');
  const other = game('shortAnswer');
  other.request('start');
  assert.equal(other.request('answer', { giveUp: true }).rerollStatus, 'failed');
  const wrong = game('shortAnswer');
  assert.equal(wrong.request('answer', { selectedAnswerText: '오답' }).rerollStatus, 'failed');
  assert.equal(wrong.request('answer', { selectedAnswerText: '정답' }).rerollStatus, 'failed');
});

test('reroll rejects another owner, battle and a reward prepared before victory', () => {
  const g = game();
  const attempt = { ...g.payload, rewardRerollAction: 'start' };
  assert.throws(() => g.x.c.previewRewardChoicesForStageResult(attempt, 'other'), /플레이어|런/);
  attempt.battle = { ...attempt.battle, battleId: 'another' };
  assert.throws(() => g.x.c.previewRewardChoicesForStageResult(attempt, 'auth'), /현재 승리/);
  attempt.battle = g.payload.battle;
  attempt.rewardToken = g.x.c.signLocalRewardView_({ ...copy(g.original), preparedDuringBattle: true }).localTransitionToken;
  assert.throws(() => g.x.c.previewRewardChoicesForStageResult(attempt, 'auth'), /현재 승리/);
});

test('reroll works for floor intermission rewards after replaying local stages', () => {
  const g = game();
  const engine = vm.runInNewContext(g.x.c.getLocalRunEngineSource_(), { Date: g.x.c.Date });
  let run = g.initial.localRunState, view = g.initial, token = g.original.runSessionToken, reward = g.original;
  for (let i = 0; i < 5; i++) {
    const battle = copy(view.battle);
    battle.status = 'victory'; battle.monsters.forEach(m => { m.currentHp = 0; });
    const payload = { runId: run.runId, runSessionToken: token, localAdvanceEnabled: true, localTransitions: [], battle, stageState: copy(view.stageState), answerLogs: [] };
    if (i) { reward = g.x.c.previewRewardChoicesForStageResult(payload, 'auth'); token = reward.runSessionToken; }
    payload.stageState.reward = copy(reward);
    const choice = reward.choices[0], selectedAtMs = g.x.c.Date.now();
    view = engine.advance(run, g.initial.gameDataSnapshot, payload, choice.rewardId, reward, { selectedAtMs });
    const saved = g.x.c.withRunSession_(run.runId, token, 'auth', () => {
      g.x.c.replayLocalRunTransitions_([{ payload, rewardId: choice.rewardId, rewardToken: reward.localTransitionToken, selectedAtMs }], 'auth');
      return {};
    });
    token = saved.runSessionToken; run = view.localRunState;
  }
  assert.equal(view.rewardView.floorRestChoice, true);
  const payload = { runId: run.runId, runSessionToken: token, localAdvanceEnabled: true, localTransitions: [],
    battle: view.battle, stageState: view.stageState, answerLogs: [], rewardToken: view.rewardView.localTransitionToken, rewardRerollAction: 'start' };
  const challenge = g.x.c.previewRewardChoicesForStageResult(payload, 'auth');
  assert.equal(challenge.rerollStatus, 'pending');
  payload.runSessionToken = challenge.runSessionToken; payload.rewardRerollAction = 'answer'; payload.rerollAnswer = { selectedChoiceIndex: 2 };
  const result = g.x.c.previewRewardChoicesForStageResult(payload, 'auth');
  assert.equal(result.rerollStatus, 'success');
  const choice = result.rewardView.choices.find(c => c.type !== 'rest');
  const next = engine.advance(run, g.initial.gameDataSnapshot, payload, choice.rewardId, result.rewardView, { selectedAtMs: g.x.c.Date.now() });
  assert.equal(next.localRunState.currentFloor, 2);
});
