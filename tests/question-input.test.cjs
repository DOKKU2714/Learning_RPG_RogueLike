const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'Battle.html'), 'utf8');
const extract = name => html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];

function loadRunQuestionStats(c) {
  c.runQuestionStats = {};
  c.runQuestionStatsRunId = '';
  const saved = new Map();
  c.sessionStorage = { getItem: k => saved.get(k) || null, setItem: (k, v) => saved.set(k, v) };
  vm.runInContext(['getRunQuestionStats','getQuestionSelectionStats','saveRunQuestionStats','recordRunQuestionAttempt','recordQuestionExposure'].map(extract).join('\n'), c);
}

function setup() {
  let selected = '', prevented = 0;
  const labels = ['3', '1', '4', '2'].map(value => {
    const input = { disabled: false };
    return { input, querySelector: () => input, click: () => { selected = value; } };
  });
  const modal = { classList: { contains: () => true } };
  const c = vm.createContext({ currentQuestionView: { question: { type: 'multipleChoice' } },
    document: { getElementById: id => id === 'questionModal' ? modal : { querySelectorAll: () => labels } } });
  vm.runInContext(extract('selectQuestionChoiceByNumber'), c);
  return { c, labels, modal, get selected() { return selected; }, get prevented() { return prevented; },
    event: key => ({ key, target: {}, preventDefault: () => prevented++ }) };
}

test('number shortcuts select displayed order despite shuffled original choice values', () => {
  const x = setup();
  for (const [key, value] of [['1','3'],['2','1'],['3','4'],['4','2']]) {
    assert.equal(x.c.selectQuestionChoiceByNumber(x.event(key)), true);
    assert.equal(x.selected, value);
  }
  assert.equal(x.prevented, 4);
});

test('number shortcuts ignore text editing, modified keys, disabled choices and inactive questions', () => {
  for (const overrides of [{ctrlKey:true},{altKey:true},{metaKey:true},{shiftKey:true},{repeat:true},{isComposing:true},
    {target:{tagName:'INPUT',type:'text'}},{target:{tagName:'TEXTAREA'}},{target:{isContentEditable:true}}]) {
    const x = setup();
    assert.equal(x.c.selectQuestionChoiceByNumber({...x.event('1'),...overrides}), false);
    assert.equal(x.selected, '');
  }
  for (const change of [x => x.labels[0].input.disabled = true,
    x => x.modal.classList.contains = () => false,
    x => x.c.currentQuestionView.resultHolding = true,
    x => x.c.currentQuestionView.question.type = 'shortAnswer',
    x => x.c.currentQuestionView = null]) {
    const x = setup(); change(x);
    assert.equal(x.c.selectQuestionChoiceByNumber(x.event('1')), false);
    assert.equal(x.selected, '');
  }
});

test('stage result payload preserves wrong attempts and give-up for statistics', () => {
  const c = vm.createContext({ buildSignedQuestionResultSnapshot: q => q });
  vm.runInContext(extract('buildStageResultAnswerLogPayload'), c);
  const payload = c.buildStageResultAnswerLogPayload({ wrongCountAfterTimeout: 2, giveUp: true });
  assert.equal(payload.wrongCountAfterTimeout, 2);
  assert.equal(payload.giveUp, true);
});

test('accuracy weighting favors low rates and combines with existing item type weights', () => {
  const c = vm.createContext({ currentView: { battle: { player: { itemModifiers: {} } } } });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'SharedRuleEngine.gs'), 'utf8'), c);
  c.RULE_ENGINE_SHARED = c.getSharedRuleEngine_();
  loadRunQuestionStats(c);
  c.runQuestionStats = { low: {correctCount:0,totalCount:100}, high: {correctCount:100,totalCount:100} };
  vm.runInContext(extract('pickWeightedLocalQuestion'), c);
  const low = { questionId: 'low', type: 'multipleChoice', correctCount: 0, totalCount: 100 };
  const high = { questionId: 'high', type: 'shortAnswer', correctCount: 100, totalCount: 100 };
  assert.equal(c.RULE_ENGINE_SHARED.getQuestionAccuracyWeight({}), 1.25);
  assert.ok(c.RULE_ENGINE_SHARED.getQuestionAccuracyWeight(low) > c.RULE_ENGINE_SHARED.getQuestionAccuracyWeight(high));
  vm.runInContext('Math.random = () => 0.55', c);
  assert.equal(c.pickWeightedLocalQuestion([low, high]).questionId, 'low');
  c.currentView.battle.player.itemModifiers.shortAnswerChancePercent = 300;
  assert.equal(c.pickWeightedLocalQuestion([low, high]).questionId, 'high');
});

test('local selection uses weights even for immediate repeats and still enforces difficulty and author', () => {
  const low = { questionId:'low', creatorId:'other', difficulty:1, type:'multipleChoice', correctCount:0, totalCount:100 };
  const high = { questionId:'high', creatorId:'other', difficulty:1, type:'multipleChoice', correctCount:100, totalCount:100 };
  const c = vm.createContext({ localWorkbookQuestions:[low,high,{questionId:'wrong-difficulty',difficulty:2}],
    currentView:{playerId:'p',battle:{},stageState:{usedQuestionIds:[]}},
    getClientUsedQuestionIds:v=>v.stageState.usedQuestionIds,
    getClientLocalQuestionModifiers:()=>({}),calculateClientLocalQuestionTimeMs:()=>10000,MAX_ANSWER_EFFICIENCY:1.25 });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'SharedRuleEngine.gs'), 'utf8'), c);
  c.RULE_ENGINE_SHARED = c.getSharedRuleEngine_();
  loadRunQuestionStats(c);
  vm.runInContext(extract('calculateClientMaxAnswerEfficiency') + '\n' + extract('pickWeightedLocalQuestion') + '\n' + extract('takeLocalQuestionView'), c);
  vm.runInContext('Math.random = () => 0.4', c);
  assert.equal(c.takeLocalQuestionView('attack','','',1).question.questionId,'low');
  assert.equal(c.takeLocalQuestionView('attack','','',1).question.questionId,'low');
  assert.equal(c.takeLocalQuestionView('attack','','',1).question.questionId,'low');
  c.currentView.stageState.usedQuestionIds=['low'];
  assert.equal(c.takeLocalQuestionView('attack','','',1).question.questionId,'low');
  c.currentView.battle.forcedQuestionCreatorId='ghost';
  assert.equal(c.takeLocalQuestionView('attack','','',1),null);
});

test('the only eligible question can repeat rather than blocking the next action', () => {
  const question={questionId:'only',creatorId:'p',difficulty:1};
  const c=vm.createContext({localWorkbookQuestions:[question],currentView:{playerId:'p',battle:{},stageState:{lastQuestionId:'only'}},
    getClientUsedQuestionIds:()=>[],RULE_ENGINE_SHARED:{getQuestionSelectionPool:p=>p},pickWeightedLocalQuestion:p=>p[0],getClientLocalQuestionModifiers:()=>({}),
    calculateClientLocalQuestionTimeMs:()=>10000,MAX_ANSWER_EFFICIENCY:1.25});
  vm.runInContext(extract('calculateClientMaxAnswerEfficiency') + '\n' + extract('takeLocalQuestionView'),c);
  assert.equal(c.takeLocalQuestionView('attack','','',1).question.questionId,'only');
});

test('boss item row keeps a text name, rarity color class, escaped hover details and acquisition button',()=>{
  const c=vm.createContext({normalizeRewardRarity:r=>r,escapeHtml:s=>String(s).replaceAll('&','&amp;').replaceAll('"','&quot;').replaceAll('<','&lt;').replaceAll('>','&gt;'),getRewardRarityLabel:()=> '희귀'});
  vm.runInContext(extract('renderBossItemRewardRow'),c);
  const reward={targetId:'gloves',rarity:'rare',itemDetail:{name:'골키퍼 장갑',effectSummary:'체력 +5',description:'<설명>'}};
  const pending=c.renderBossItemRewardRow(reward,true);
  assert.match(pending,/boss-item-name rarity-rare/);
  assert.match(pending,/data-tooltip="골키퍼 장갑\n희귀\n체력 \+5\n&lt;설명&gt;"/);
  assert.match(pending,/onclick="claimBossItemReward\(\)">획득/);
  assert.doesNotMatch(c.renderBossItemRewardRow(reward,false),/onclick=/);
});

test('wrong submissions of either type are buffered immediately with the actual answers',()=>{
  const q={questionId:'q',type:'multipleChoice'};
  const c=vm.createContext({currentQuestionView:{question:q,actionType:'attack'},
    currentView:{runId:'r',playerId:'p',battle:{stage:{}}},questionStartedAt:Date.now(),pendingStageAnswerLogs:[],buildSignedQuestionResultSnapshot:q=>q});
  loadRunQuestionStats(c);
  for(const name of ['recordWrongQuestionAttempt','buildPendingStageAnswerLog','buildStageResultAnswerLogPayload'])
    vm.runInContext(extract(name),c);
  for(const choice of ['2','3','4'])c.recordWrongQuestionAttempt({selectedAnswer:choice,selectedChoiceIndex:choice});
  assert.equal(c.pendingStageAnswerLogs.length,3);
  assert.equal(c.currentQuestionView.attemptsRecorded,true);
  c.pendingStageAnswerLogs.forEach(log=>{
    assert.equal(log.attemptOnly,true);
    const payload=c.buildStageResultAnswerLogPayload(log);
    assert.equal(payload.attemptOnly,true);
    assert.equal(payload.attemptsRecorded,true);
  });
  c.currentQuestionView.question.type='shortAnswer';
  c.recordWrongQuestionAttempt({selectedAnswerText:'틀린 답'});
  assert.equal(c.pendingStageAnswerLogs.length,4);
  assert.equal(c.pendingStageAnswerLogs[3].selectedAnswerText,'틀린 답');
  assert.equal(c.getRunQuestionStats('q').totalCount,4);
  c.recordRunQuestionAttempt(q,{giveUp:true,attemptsRecorded:true});
  assert.equal(c.getRunQuestionStats('q').totalCount,4,'giving up must not duplicate a recorded wrong attempt');
});

test('cached fallback applies live weights with no unseen guarantee',()=>{
 const rows=['weak','second','new'].map((questionId,i)=>({questionId,difficulty:1,type:'multipleChoice',understandingRating:i?5:1}));
 const c=vm.createContext({localWorkbookQuestions:[],reusableQuestionCache:rows.map(question=>({question,finalDifficulty:1})),battleQuestionCache:[],
   currentView:{battle:{},stageState:{usedQuestionIds:['weak','second'],lastQuestionId:'second'}},
   getClientRequiredQuestionDifficulty:()=>1,getClientUsedQuestionIds:v=>v.stageState.usedQuestionIds,
   getClientLocalQuestionModifiers:()=>({}),MAX_ANSWER_EFFICIENCY:1.25});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','SharedRuleEngine.gs'),'utf8'),c);
 c.RULE_ENGINE_SHARED=c.getSharedRuleEngine_();loadRunQuestionStats(c);
 vm.runInContext(['getQuestionViewId','filterQuestionCacheByDifficulty','calculateClientMaxAnswerEfficiency',
   'pickWeightedLocalQuestion','takeCachedQuestionView'].map(extract).join('\n'),c);
 vm.runInContext('Math.random=()=>0',c);
 assert.equal(c.takeCachedQuestionView('attack','','').question.questionId,'weak');
});

test('review can be selected before any unseen questions and stage changes do not prioritize unseen questions',()=>{
 const questions=['weak','second','new'].map((questionId,i)=>({questionId,creatorId:'other',difficulty:1,
   type:'multipleChoice',understandingRating:i===0?1:5,totalCount:100,correctCount:i===0?0:100}));
 const c=vm.createContext({localWorkbookQuestions:questions,currentView:{playerId:'p',battle:{},stageState:{usedQuestionIds:[],otherStudentQuestionShown:true}},
   getClientUsedQuestionIds:v=>v.stageState.usedQuestionIds,getClientLocalQuestionModifiers:()=>({}),
   calculateClientLocalQuestionTimeMs:()=>10000,MAX_ANSWER_EFFICIENCY:1.25});
 vm.runInContext(fs.readFileSync(path.join(__dirname,'..','SharedRuleEngine.gs'),'utf8'),c);
 c.RULE_ENGINE_SHARED=c.getSharedRuleEngine_();loadRunQuestionStats(c);
 vm.runInContext(['calculateClientMaxAnswerEfficiency','pickWeightedLocalQuestion','takeLocalQuestionView'].map(extract).join('\n'),c);
 vm.runInContext('Math.random=()=>0',c);
 const draw=()=>c.takeLocalQuestionView('attack','','',1);
 assert.equal(draw().question.questionId,'weak');c.currentView.stageState.usedQuestionIds.push('weak');
 assert.equal(draw().question.questionId,'weak');c.currentView.stageState.usedQuestionIds.push('second');
 const review=draw();assert.equal(review.question.questionId,'weak');assert.equal(review.fallbackReason,'weightedReview');
 assert.equal(c.currentView.stageState.usedQuestionIds.includes('new'),false);
 assert.equal(draw().question.questionId,'weak','the last question remains eligible for weighted selection');
 // Difficulty restrictions remain in force.
 c.localWorkbookQuestions.push({questionId:'hard-new',creatorId:'other',difficulty:2});
 assert.equal(c.takeLocalQuestionView('attack','','',2).question.questionId,'hard-new');
 c.currentView.stageState.usedQuestionIds=[];c.currentView.stageState.lastQuestionId='';
 assert.equal(draw().question.questionId,'weak','a new stage does not prioritize unseen questions');
});

test('run weighting updates immediately, survives stages and reloads, and resets for a new run', () => {
  const c = vm.createContext({currentView:{runId:'run-1',battle:{player:{itemModifiers:{}}}},
    isClientCorrectAnswer:(q,p)=>p.selectedAnswer === 'correct'});
  loadRunQuestionStats(c);
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'SharedRuleEngine.gs'), 'utf8'), c);
  c.RULE_ENGINE_SHARED = c.getSharedRuleEngine_();
  vm.runInContext(extract('pickWeightedLocalQuestion'), c);
  const q = {questionId:'q',type:'multipleChoice',correctCount:1000,totalCount:1000,snapshotSignature:'signed'};
  const other = {questionId:'other',type:'multipleChoice',correctCount:0,totalCount:1000};
  vm.runInContext('Math.random = () => 0.5', c);
  // Historical statistics also influence a fresh run.
  assert.equal(c.pickWeightedLocalQuestion([q,other]).questionId,'other');
  assert.equal(c.getQuestionSelectionStats(q).totalCount,1000);
  for (let i=0;i<3;i++) c.recordRunQuestionAttempt(q,{attemptOnly:true});
  assert.equal(c.getRunQuestionStats('q').totalCount,3);
  assert.ok(c.RULE_ENGINE_SHARED.getQuestionAccuracyWeight(c.getRunQuestionStats('q')) > 1.25);
  c.recordRunQuestionAttempt(q,{selectedAnswer:'correct',attemptsRecorded:true});
  assert.equal(c.getRunQuestionStats('q').totalCount,4);
  assert.equal(c.getRunQuestionStats('q').correctCount,1);
  assert.equal(c.getQuestionSelectionStats(q).totalCount,1004);
  assert.equal(c.getQuestionSelectionStats(q).correctCount,1001);
  const refreshed = {...q,totalCount:1004,correctCount:1001};
  assert.equal(c.getQuestionSelectionStats(refreshed).totalCount,1004);
  assert.equal(c.getQuestionSelectionStats(refreshed).correctCount,1001);
  c.recordRunQuestionAttempt(q,{giveUp:true,attemptsRecorded:true});
  assert.equal(c.getRunQuestionStats('q').totalCount,4);
  for(let i=0;i<15;i++) c.recordRunQuestionAttempt(q,{selectedAnswer:'correct'});
  assert.equal(c.pickWeightedLocalQuestion([q,other]).questionId,'other');
  assert.equal(q.correctCount,1000);
  assert.equal(q.totalCount,1000);
  assert.equal(q.snapshotSignature,'signed');
  c.currentView = {runId:'run-1',stageState:{stage:2}};
  assert.equal(c.getRunQuestionStats('q').totalCount,19);
  assert.equal(c.getQuestionSelectionStats(refreshed).totalCount,1019);
  c.runQuestionStats = {};
  c.runQuestionStatsRunId = '';
  assert.equal(c.getRunQuestionStats('q').totalCount,19);
  c.currentView.runId='run-2';
  assert.equal(c.getRunQuestionStats('q').totalCount,0);
  assert.equal(c.getRunQuestionStats('q').correctCount,0);
  assert.equal(c.getQuestionSelectionStats(refreshed).totalCount,1004);
  assert.equal(c.getQuestionSelectionStats(refreshed).correctCount,1001);
  c.recordRunQuestionAttempt({questionId:'short',type:'shortAnswer'},{giveUp:true});
  assert.equal(c.getRunQuestionStats('short').totalCount,1);
  assert.equal(c.getRunQuestionStats('short').correctCount,0);
});

function actionSetup() {
  const clicks=[],buttons={};
  for (const id of ['attackActionButton','guardActionButton','skillToggleButton','passTurnButton']) {
    buttons[id]={id,disabled:false,classList:{add(k){this[k]=true;},remove(k){this[k]=false;}},focus(){},click(){clicks.push(id);}};
  }
  const c=vm.createContext({selectedKeyboardActionId:'',workbookDeadlineExpired:false,skillPanelOpen:false,pendingTargetSelection:null,
    shouldLockBattleInput:()=>false,document:{getElementById:id=>buttons[id],querySelector:()=>null}});
  vm.runInContext(extract('clearKeyboardActionSelection')+'\n'+extract('handleBattleActionKeyboard'),c);
  return {c,buttons,clicks,event:key=>({key,target:{},preventDefault(){}})};
}

test('short-answer hints reveal one random new character per wrong answer and stop when complete',()=>{
  const hint={textContent:'',classList:{remove(){}}};
  const c=vm.createContext({currentQuestionView:{question:{type:'shortAnswer',answer:'제안하다'}},
    document:{getElementById:()=>hint},hasClientAnswer:()=>true,getQuestionAnswerDisplayText:q=>q.answer});
  vm.runInContext(extract('revealShortAnswerHint'),c);
  vm.runInContext('Math.random=()=>0.3',c);
  c.revealShortAnswerHint();assert.equal(hint.textContent,'힌트: *안**');
  c.revealShortAnswerHint();assert.equal(hint.textContent,'힌트: 제안**');
  c.revealShortAnswerHint();assert.equal(hint.textContent,'힌트: 제안하*');
  c.revealShortAnswerHint();assert.equal(hint.textContent,'힌트: 제안하다');
  c.revealShortAnswerHint();assert.equal(c.currentQuestionView.shortAnswerHintIndices.length,4);
  c.currentQuestionView={question:{type:'shortAnswer',answer:'가 나😀'}};
  vm.runInContext('Math.random=()=>0',c);
  c.revealShortAnswerHint();assert.equal(hint.textContent,'힌트: 가 **');
  c.revealShortAnswerHint();assert.equal(hint.textContent,'힌트: 가 나*');
  c.revealShortAnswerHint();assert.equal(hint.textContent,'힌트: 가 나😀');
});

test('action shortcuts select attack, guard, skills and end-turn, executing only on Enter', () => {
  const x=actionSetup();
  const ids=['attackActionButton','guardActionButton','skillToggleButton','passTurnButton'];
  ids.forEach((id,i)=>{
    assert.equal(x.c.handleBattleActionKeyboard(x.event(String(i+1))),true);
    assert.equal(x.clicks.length,i);
    assert.equal(x.buttons[id].classList['keyboard-action-selected'],true);
    assert.equal(x.c.handleBattleActionKeyboard(x.event('Enter')),true);
    assert.equal(x.clicks[i],id);
    assert.equal(x.c.selectedKeyboardActionId,'');
  });
  assert.equal(x.c.handleBattleActionKeyboard(x.event('Enter')),false);
});

test('action shortcuts cannot execute through dialogs, enemy turns, submenus or disabled buttons', () => {
  for (const change of [x=>x.c.shouldLockBattleInput=()=>true,x=>x.c.document.querySelector=()=>({}),
    x=>x.c.skillPanelOpen=true,x=>x.c.pendingTargetSelection={},x=>x.c.workbookDeadlineExpired=true,
    x=>x.buttons.attackActionButton.disabled=true]) {
    const x=actionSetup();
    x.c.handleBattleActionKeyboard(x.event('1'));change(x);
    assert.equal(x.c.handleBattleActionKeyboard(x.event('Enter')),false);
    assert.equal(x.clicks.length,0);
  }
  const x=actionSetup();
  assert.equal(x.c.handleBattleActionKeyboard({...x.event('1'),target:{tagName:'INPUT'}}),false);
});
