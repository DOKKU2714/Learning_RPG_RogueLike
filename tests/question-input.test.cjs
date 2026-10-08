const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const html = fs.readFileSync(path.join(__dirname, '..', 'Battle.html'), 'utf8');
const extract = name => html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];

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
  vm.runInContext(extract('pickWeightedLocalQuestion'), c);
  const low = { questionId: 'low', type: 'multipleChoice', correctCount: 0, totalCount: 100 };
  const high = { questionId: 'high', type: 'shortAnswer', correctCount: 100, totalCount: 100 };
  assert.equal(c.RULE_ENGINE_SHARED.getQuestionAccuracyWeight({}), 2);
  assert.ok(c.RULE_ENGINE_SHARED.getQuestionAccuracyWeight(low) > c.RULE_ENGINE_SHARED.getQuestionAccuracyWeight(high));
  vm.runInContext('Math.random = () => 0.6', c);
  assert.equal(c.pickWeightedLocalQuestion([low, high]).questionId, 'low');
  c.currentView.battle.player.itemModifiers.shortAnswerChancePercent = 300;
  assert.equal(c.pickWeightedLocalQuestion([low, high]).questionId, 'high');
});

test('local selection avoids immediate repeats until solved and still enforces difficulty and author', () => {
  const low = { questionId:'low', creatorId:'other', difficulty:1, type:'multipleChoice', correctCount:0, totalCount:100 };
  const high = { questionId:'high', creatorId:'other', difficulty:1, type:'multipleChoice', correctCount:100, totalCount:100 };
  const c = vm.createContext({ localWorkbookQuestions:[low,high,{questionId:'wrong-difficulty',difficulty:2}],
    currentView:{playerId:'p',battle:{},stageState:{usedQuestionIds:[]}},
    getClientUsedQuestionIds:v=>v.stageState.usedQuestionIds,
    getClientLocalQuestionModifiers:()=>({}),calculateClientLocalQuestionTimeMs:()=>10000,MAX_ANSWER_EFFICIENCY:1.25 });
  vm.runInContext(fs.readFileSync(path.join(__dirname, '..', 'SharedRuleEngine.gs'), 'utf8'), c);
  c.RULE_ENGINE_SHARED = c.getSharedRuleEngine_();
  vm.runInContext(extract('calculateClientMaxAnswerEfficiency') + '\n' + extract('pickWeightedLocalQuestion') + '\n' + extract('takeLocalQuestionView'), c);
  vm.runInContext('Math.random = () => 0.6', c);
  assert.equal(c.takeLocalQuestionView('attack','','',1).question.questionId,'low');
  assert.equal(c.takeLocalQuestionView('attack','','',1).question.questionId,'high');
  assert.equal(c.takeLocalQuestionView('attack','','',1).question.questionId,'low');
  c.currentView.stageState.usedQuestionIds=['low'];
  assert.equal(c.takeLocalQuestionView('attack','','',1).question.questionId,'high');
  c.currentView.battle.forcedQuestionCreatorId='ghost';
  assert.equal(c.takeLocalQuestionView('attack','','',1),null);
});

test('the only eligible question can repeat rather than blocking the next action', () => {
  const question={questionId:'only',creatorId:'p',difficulty:1};
  const c=vm.createContext({localWorkbookQuestions:[question],currentView:{playerId:'p',battle:{},stageState:{lastQuestionId:'only'}},
    getClientUsedQuestionIds:()=>[],pickWeightedLocalQuestion:p=>p[0],getClientLocalQuestionModifiers:()=>({}),
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

test('multiple-choice wrong submissions are buffered immediately with the actual chosen answers',()=>{
  const q={questionId:'q',type:'multipleChoice'};
  const c=vm.createContext({currentQuestionView:{question:q,actionType:'attack'},
    currentView:{runId:'r',playerId:'p',battle:{stage:{}}},pendingStageAnswerLogs:[],buildSignedQuestionResultSnapshot:q=>q});
  for(const name of ['recordMultipleChoiceWrongAttempt','buildPendingStageAnswerLog','buildStageResultAnswerLogPayload'])
    vm.runInContext(extract(name),c);
  for(const choice of ['2','3','4'])c.recordMultipleChoiceWrongAttempt({selectedAnswer:choice,selectedChoiceIndex:choice});
  assert.equal(c.pendingStageAnswerLogs.length,3);
  assert.equal(c.currentQuestionView.attemptsRecorded,true);
  c.pendingStageAnswerLogs.forEach(log=>{
    assert.equal(log.attemptOnly,true);
    const payload=c.buildStageResultAnswerLogPayload(log);
    assert.equal(payload.attemptOnly,true);
    assert.equal(payload.attemptsRecorded,true);
  });
  c.currentQuestionView.question.type='shortAnswer';
  c.recordMultipleChoiceWrongAttempt({selectedAnswer:'wrong'});
  assert.equal(c.pendingStageAnswerLogs.length,3);
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
