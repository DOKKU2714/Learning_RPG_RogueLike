const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const read = file => fs.readFileSync(path.join(__dirname, '..', file), 'utf8');
const html = read('Battle.html');
const extract = name => html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];

test('personal understanding outweighs accuracy, with monotonic weights and safe unrated fallback', () => {
  const c = vm.createContext({});
  vm.runInContext(read('SharedRuleEngine.gs'), c);
  c.RULE_ENGINE_SHARED = c.getSharedRuleEngine_();
  const weight = q => c.RULE_ENGINE_SHARED.getQuestionAccuracyWeight(q);
  const baseline = { totalCount: 100, correctCount: 50 };
  const values = [1,2,3,4,5].map(understandingRating => weight({...baseline, understandingRating}));
  assert.ok(values.every((v,i) => i === 0 || values[i-1] > v));
  assert.equal(values[4],weight(baseline)*0.2);
  assert.ok(weight({totalCount:100,correctCount:100,understandingRating:1}) > weight({totalCount:100,correctCount:0,understandingRating:5}) * 4);
  assert.ok(weight({totalCount:10000,correctCount:0}) / weight({totalCount:10000,correctCount:10000}) < 1.5);
  for (const understandingRating of [0,6,-1,1.5,'bad']) assert.equal(weight({...baseline,understandingRating}),weight(baseline));
});


test('progress batches persist authenticated ratings once and ignore older requests', () => {
  const players={p:{},other:{}};let writes=0, playerId='p';
  const c=vm.createContext({
    getCurrentPlayer_:token=>{if(token!=='auth')throw Error('unauthorized');return {playerId};},
    requireQuestionWorkbook_:workbookId=>({workbookId}),
    findRowByKey_:(s,k,id)=>({playerId:'p',workbookId:id==='other-workbook-run'?'other-workbook':'w'}),
    readWorkbookQuestionTable_:()=>[{questionId:'q',status:'approved'}],
    getPlayerData_:id=>players[id],safeJsonParse_:(v,d)=>v?JSON.parse(v):d,safeJsonStringify_:JSON.stringify,
    ensureTableColumns_(){}, DB_SHEETS:{PLAYER_DATA:'PlayerData',RUNS:'Runs'},DB_COLUMNS:{PLAYER_DATA:[]},
    STATUS:{QUESTION_APPROVED:'approved'},getRunWorkbookContext_:run=>({workbookId:run.workbookId}),
    updateRowByKey_:(s,k,id,patch)=>{writes++;Object.assign(players[id],patch);},
  });
  vm.runInContext(read('QuestionReviewService.gs'),c);
  const batch=(rating,time)=>[{questionId:'q',rating,updatedAtMs:time,revision:'revision-'+time}];
  const sync=(entries,run='r')=>c.syncQuestionUnderstandingForRun_(run,entries,'auth',{});
  let response=sync(batch(2,10));
  assert.equal(response.acknowledgedQuestionUnderstanding.entries[0].revision,'revision-10');
  assert.equal(c.getQuestionUnderstandingRatings('w','auth').q,2);
  sync(batch(2,10));assert.equal(writes,1);
  sync(batch(5,20));sync(batch(1,15));
  assert.equal(c.getQuestionUnderstandingRatings('w','auth').q,5);
  assert.equal(writes,2);
  sync(batch(3,25),'other-workbook-run');
  assert.equal(c.getQuestionUnderstandingRatings('other-workbook','auth').q,3);
  sync([{questionId:'deleted',rating:3,updatedAtMs:30,revision:'removed'}]);
  assert.equal(writes,3);
  for(const rating of [0,6,1.5,'bad'])assert.throws(()=>sync(batch(rating,40)),/올바르지/);
  playerId='other';assert.throws(()=>sync(batch(1,50)),/현재 플레이어/);
  assert.deepEqual(Object.keys(c.getQuestionUnderstandingRatings('w','auth')),[]);
});

function browserContext(saved=new Map()) {
  const buttons=[1,2,3,4,5].map(rating=>({getAttribute:()=>String(rating),classList:{toggle(){}},setAttribute(){}}));
  const panel={classList:{contains:()=>false},querySelectorAll:()=>buttons};
  const status={},submit={};
  const c=vm.createContext({currentView:{playerId:'p'},currentQuestionView:{question:{questionId:'q'},resultHolding:true},
    runQuestionStats:{},runQuestionStatsRunId:'',sessionStorage:{getItem:()=>null,setItem(){}},
    questionUnderstandingRatings:{},questionUnderstandingPending:{},questionUnderstandingLoadKey:'',questionResultProceedRequested:false,
    getSelectedWorkbookId:()=> 'w', getAuthToken:()=> 'auth',
    google:{script:{run:new Proxy({}, {get(){throw Error('unexpected RPC');}})}},
    localStorage:{getItem:key=>saved.get(key)||null,setItem:(key,v)=>saved.set(key,v)},
    document:{getElementById:id=>id==='questionUnderstanding'?panel:id==='questionUnderstandingStatus'?status:submit}});
  vm.runInContext(['getQuestionUnderstandingStorageKey','readQuestionUnderstandingStore','writeQuestionUnderstandingStore',
    'getPendingQuestionUnderstanding','acknowledgeQuestionUnderstanding','loadQuestionUnderstandingRatings','chooseQuestionUnderstanding',
    'getRunQuestionStats','getQuestionSelectionStats','saveRunQuestionStats','recordQuestionExposure'].map(extract).join('\n'),c);
  return {c,status,submit,saved};
}

test('rating selection is immediate without RPC, survives reload and is isolated by player and workbook',()=>{
  const x=browserContext();x.c.chooseQuestionUnderstanding(2);
  assert.equal(x.c.questionUnderstandingRatings.q,2);
  assert.equal(x.submit.textContent,'확인');
  assert.equal(x.c.getPendingQuestionUnderstanding()[0].rating,2);
  const reloaded=browserContext(x.saved);
  assert.equal(reloaded.c.getPendingQuestionUnderstanding()[0].rating,2);
  reloaded.c.currentView.playerId='other';assert.equal(reloaded.c.getPendingQuestionUnderstanding().length,0);
  reloaded.c.currentView.playerId='p';reloaded.c.getSelectedWorkbookId=()=> 'other';
  assert.equal(reloaded.c.getPendingQuestionUnderstanding().length,0);
});

test('failed requests retain pending ratings and late acknowledgements retain newer selections',()=>{
  const x=browserContext();x.c.chooseQuestionUnderstanding(2);
  const first=JSON.parse(JSON.stringify(x.c.getPendingQuestionUnderstanding()[0]));
  x.c.acknowledgeQuestionUnderstanding(null);
  assert.equal(x.c.getPendingQuestionUnderstanding().length,1);
  x.c.chooseQuestionUnderstanding(5);
  const latest=JSON.parse(JSON.stringify(x.c.getPendingQuestionUnderstanding()[0]));
  x.c.acknowledgeQuestionUnderstanding({acknowledgedQuestionUnderstanding:{playerId:'p',workbookId:'w',entries:[first]}});
  assert.equal(x.c.getPendingQuestionUnderstanding()[0].rating,5);
  x.c.acknowledgeQuestionUnderstanding({acknowledgedQuestionUnderstanding:{playerId:'p',workbookId:'w',entries:[latest]}});
  assert.equal(x.c.getPendingQuestionUnderstanding().length,0);
  assert.equal(x.c.questionUnderstandingRatings.q,5);
  assert.equal(browserContext(x.saved).c.getPendingQuestionUnderstanding().length,0);
});

test('server ratings merge with locally pending changes and offline startup retains cached ratings', async()=>{
  const x=browserContext();x.c.chooseQuestionUnderstanding(2);
  const reloaded=browserContext(x.saved);let success,failure;
  reloaded.c.google={script:{run:{withSuccessHandler(fn){success=fn;return this;},withFailureHandler(fn){failure=fn;return this;},getQuestionUnderstandingRatings(){}}}};
  const loaded=reloaded.c.loadQuestionUnderstandingRatings();success({q:5,other:4});await loaded;
  assert.equal(reloaded.c.questionUnderstandingRatings.q,2);
  assert.equal(reloaded.c.questionUnderstandingRatings.other,4);
  const offline=browserContext(x.saved);offline.c.google=reloaded.c.google;
  const promise=offline.c.loadQuestionUnderstandingRatings();failure(Error('offline'));await promise;
  assert.equal(offline.c.questionUnderstandingRatings.q,2);
});

test('live answers and rating changes affect the very next local weighted draw without RPC',()=>{
  const {c}=browserContext();
  c.currentView.runId='live-run';
  c.runQuestionStatsRunId='';c.runQuestionStats={};
  c.sessionStorage={getItem:()=>null,setItem(){}};
  c.isClientCorrectAnswer=(question,payload)=>!!payload.correct;
  vm.runInContext(read('SharedRuleEngine.gs'),c);
  c.RULE_ENGINE_SHARED=c.getSharedRuleEngine_();
  vm.runInContext(['getRunQuestionStats','getQuestionSelectionStats','saveRunQuestionStats',
    'recordRunQuestionAttempt','pickWeightedLocalQuestion'].map(extract).join('\n'),c);
  const question={questionId:'q',type:'shortAnswer',totalCount:0,correctCount:0};
  const other={questionId:'other',type:'shortAnswer',totalCount:0,correctCount:0};
  const weight=()=>c.RULE_ENGINE_SHARED.getQuestionAccuracyWeight(c.getQuestionSelectionStats(question));
  const before=weight();
  c.recordRunQuestionAttempt(question,{correct:false});
  assert.ok(weight()>before,'a wrong answer immediately raises selection weight');
  const afterWrong=weight();
  c.recordRunQuestionAttempt(question,{correct:true});
  assert.ok(weight()<afterWrong,'a correct answer immediately lowers selection weight');
  // Exhaustively sample a uniform grid instead of relying on a flaky random trial.
  c.pool=[question,other];
  const draws=()=>vm.runInContext(`var picked=0;
    for(var i=0;i<10000;i++){
      Math.random=()=> (i+.5)/10000;
      if(pickWeightedLocalQuestion(pool).questionId==='q')picked++;
    }
    picked;`,c);
  assert.equal(draws(),5000);
  c.chooseQuestionUnderstanding(1);
  const lowRating=draws();
  c.chooseQuestionUnderstanding(5);
  const highRating=draws();
  assert.equal(lowRating,7500);
  assert.ok(highRating<3000);
  assert.ok(lowRating>highRating*2);
  assert.equal(c.getPendingQuestionUnderstanding()[0].rating,5);
});

test('each display reduces weight by ten percent across stages and reloads, and a new rating restores it',()=>{
  const {c}=browserContext();
  c.currentView.runId='exposure-run';
  const saved=new Map();
  c.sessionStorage={getItem:k=>saved.get(k)||null,setItem:(k,v)=>saved.set(k,v)};
  vm.runInContext(read('SharedRuleEngine.gs'),c);
  c.RULE_ENGINE_SHARED=c.getSharedRuleEngine_();
  const question={questionId:'q',understandingRating:1};
  const weight=()=>c.RULE_ENGINE_SHARED.getQuestionAccuracyWeight(c.getQuestionSelectionStats(question));
  c.chooseQuestionUnderstanding(1);
  const full=weight();
  c.recordQuestionExposure(question);assert.equal(weight(),full*.9);
  c.recordQuestionExposure(question);assert.equal(weight(),full*.81);
  c.currentView.stageState={stageId:'next-stage'};
  assert.equal(weight(),full*.81);
  c.runQuestionStats={};c.runQuestionStatsRunId='';
  assert.equal(weight(),full*.81);
  c.chooseQuestionUnderstanding(1);assert.equal(weight(),full);
  for(let i=0;i<24;i++)c.recordQuestionExposure(question);
  assert.equal(weight(),full*.1);
});
