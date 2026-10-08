const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function functions(c, file, names) {
  const source = read(file);
  for (const name of names) {
    const match = source.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'));
    assert.ok(match, name); vm.runInContext(match[0], c);
  }
}
function browser(options = {}) {
  const nodes = new Map(), timeouts = new Map(), intervals = new Map(), session = new Map(); let id = 0;
  const node = tag => {
    const classes = new Set();
    const el = {tagName:tag,style:{},children:[],textContent:'',disabled:false,
      classList: { add(...v){v.forEach(x=>classes.add(x));}, remove(...v){v.forEach(x=>classes.delete(x));}, contains(v){return classes.has(v);}, toggle(v,on){if(on)classes.add(v);else classes.delete(v);} },
      setAttribute(k,v){this[k]=v;}, addEventListener(){}, removeEventListener(){}, remove(){nodes.delete(this.id);},
      appendChild(child){this.children.push(child);if(child.id)nodes.set(child.id,child);return child;},
    };
    Object.defineProperty(el,'innerHTML',{get:()=>el.html||'',set(value){el.html=value;for(const m of value.matchAll(/id="([^"]+)"/g)){const child=node('div');child.id=m[1];nodes.set(child.id,child);}}});
    return el;
  };
  function add(name,tag='div'){const el=node(tag);el.id=name;nodes.set(name,el);return el;}
  if(options.battle) add('battleShell');
  for(const name of ['loadingModal','loadingText','loadingTitle','battleStartFade','stageIntroOverlay'])add(name);
  nodes.get('battleStartFade').classList.add('active');
  const box=add('loadingBox');
  const document={head:node('head'),body:node('body'),documentElement:node('html'),fullscreenElement:options.fullscreen?{}:null,
    getElementById:name=>nodes.get(name)||null,createElement:node,
    querySelector:selector=>selector==='#loadingModal .loading-box'?box:null,querySelectorAll:()=>[],addEventListener(){},removeEventListener(){},readyState:'loading'};
  const c=vm.createContext({console,document,Promise,Date,Math,Number,String,Error,
    setTimeout(fn,delay){const key=++id;timeouts.set(key,{fn,delay});return key;},clearTimeout(key){timeouts.delete(key);},
    setInterval(fn,delay){const key=++id;intervals.set(key,{fn,delay});return key;},clearInterval(key){intervals.delete(key);},
    addEventListener(){},removeEventListener(){},innerWidth:1000,innerHeight:600,outerWidth:1100,outerHeight:700,screen:{width:1920,height:1080,availWidth:1920,availHeight:1040},
    sessionStorage:{getItem:key=>session.get(key)||null,setItem:(key,value)=>session.set(key,value),removeItem:key=>session.delete(key)},
  });c.window=c;
  return {c,nodes,timeouts,intervals,session,add,box};
}
function store(x,file){vm.runInContext(read(file).match(/<script>([^]*?)<\/script>/)[1],x.c,{filename:file});}
const flush = async () => {for(let i=0;i<12;i++) await Promise.resolve();};
const view = () => ({runId:'r',entryToken:'entry',battle:{stage:{stageId:'floor_1_stage_1',floor:1,stage:1},player:{hp:100},status:'active'},gameDataSnapshot:{monsters:[],skills:[],items:[]}});

test('fullscreen confirmation before the battle response does not leave the response waiting behind black fade',async()=>{
  const x=browser({battle:true});const applied=[];x.c.applyInitialBattleView=v=>applied.push(v);
  store(x,'GameDataSnapshotStore.html');
  x.c.confirmBattleFullscreenGuard();await flush();
  assert.equal(x.nodes.get('battleFullscreenGuard').classList.contains('hidden'),true);
  const data=view();x.c.applyInitialBattleView(data);
  assert.equal(applied.length,1);assert.equal(applied[0],data);
});

test('fullscreen confirmation after data arrives releases exactly one initial view',async()=>{
  const x=browser({battle:true});const applied=[];x.c.applyInitialBattleView=v=>applied.push(v);
  store(x,'GameDataSnapshotStore.html');x.c.applyInitialBattleView(view());
  assert.equal(applied.length,0);
  x.c.confirmBattleFullscreenGuard();await flush();
  x.c.confirmBattleFullscreenGuard();await flush();
  assert.equal(applied.length,1);
});

test('battle initialization installs the fullscreen hook before using a cached entry',async()=>{
  const x=browser({battle:true});let applied=0;
  functions(x.c,'Battle.html',['init','initializeBattlePage','applyInitialBattleView','validateInitialBattleView']);
  Object.assign(x.c,{initializeBattleView:()=>{applied++;},setupBattleUi(){},consumeInitialBattleView:view,loadInitialBattleView:v=>x.c.applyInitialBattleView(v),showBattleEntryFailure:msg=>assert.fail(msg)});
  store(x,'GameDataSnapshotStore.html');x.c.init();
  assert.equal(applied,0);x.c.confirmBattleFullscreenGuard();await flush();assert.equal(applied,1);
});

test('both snapshot stores use the same database version and schema',async()=>{
  const opened=[];
  for(const file of ['GameDataSnapshotStore.html','QuestionSnapshotStore.html']) {
    const x=browser();x.c.indexedDB={open:(name,version)=>{opened.push({name,version});return {};}};
    store(x,file);
    const p=file.startsWith('Game')?x.c.LearningRpgGameDataStore.get():x.c.LearningRpgQuestionStore.get('w');
    const timeout=[...x.timeouts.values()].find(t=>t.delay===5000);timeout.fn();await p;
  }
  assert.equal(opened[0].name,opened[1].name);assert.equal(opened[0].version,opened[1].version);
  assert.equal(opened[0].version,2);
});

test('blocked IndexedDB uses the session fallback and closes late connections',async()=>{
  for(const file of ['GameDataSnapshotStore.html','QuestionSnapshotStore.html']) {
    const x=browser();let request;const snapshot=file.startsWith('Game')?{monsters:[],skills:[]}:{workbookId:'w',questions:[{questionId:'q'}]};
    const key=file.startsWith('Game')?'learningRpgGameDataSnapshot':'learningRpgQuestionSnapshot:w';x.session.set(key,JSON.stringify(snapshot));
    x.c.indexedDB={open:()=>request={}};store(x,file);
    const p=file.startsWith('Game')?x.c.LearningRpgGameDataStore.get():x.c.LearningRpgQuestionStore.get('w');
    request.onblocked();const result=await p;assert.deepEqual(JSON.parse(JSON.stringify(result)),snapshot);
    let closed=0;request.result={close:()=>{closed++;}};request.onsuccess();assert.equal(closed,1);
  }
});

function indexContext() {
  const x=browser(),c=x.c;let begins=0;
  Object.assign(c,{GAME_START_LOADING_STEPS:[],currentState:{player:{playerId:'p'}},selectedWorkbookId:'w',currentQuestionSnapshotManifest:null,mainNavigationInProgress:false,
    beginMainNavigation:()=>{c.mainNavigationInProgress=true;return true;},showLoadingModal(){},hideLoadingModal(){},setMainMessage(){},showWorkbookSelectModal(){},
    findActiveWorkbookById:()=>({workbookId:'w'}),isUsableQuestionSnapshot:s=>!!s?.valid,beginGameStartRequest:()=>{begins++;}});
  functions(c,'Index.html',['showGameStartMessage','prepareWorkbookSnapshotAndStartGame']);
  return {...x,begins:()=>begins};
}
test('one start click resumes game creation automatically after refreshing a missing snapshot',async()=>{
  const x=indexContext();let preparation;
  x.c.LearningRpgQuestionStore={get:()=>Promise.resolve(null)};
  x.c.prepareWorkbookSnapshotAndEnterMain=(w,options)=>{preparation=options;};
  x.c.showGameStartMessage({});await flush();
  assert.equal(x.begins(),0);assert.equal(typeof preparation.onReady,'function');
  preparation.onReady();assert.equal(x.begins(),1);
});


test('a rejected local snapshot lookup also resumes game creation after preparation',async()=>{
  const x=indexContext();let preparation;
  x.c.LearningRpgQuestionStore={get:()=>Promise.reject(new Error('storage unavailable'))};
  x.c.prepareWorkbookSnapshotAndEnterMain=(w,options)=>{preparation=options;};
  x.c.showGameStartMessage({});await flush();
  assert.equal(typeof preparation.onReady,'function');
  preparation.onReady();assert.equal(x.begins(),1);
});

test('question form return requests a fresh snapshot even when the iframe URL has no query',()=>{
  const form=read('QuestionForm.html');
  const c=vm.createContext({WEB_APP_URL:'https://example.test/app',navigateTop:url=>{c.destination=url;}});
  functions(c,'QuestionForm.html',['goHome']);
  c.goHome();assert.equal(c.destination,'https://example.test/app?skipIntro=1&refreshQuestions=1');
  const declaration=read('Index.html').match(/var QUESTION_SNAPSHOT_REFRESH_REQUESTED =[^;]+;/)[0];
  const rendered=declaration.replace(/<\?=([^]*?)\?>/g,(_,expression)=>vm.runInNewContext(expression,{requestParams:{refreshQuestions:'1'}}));
  const main=vm.createContext({window:{location:{search:''}}});
  vm.runInContext(rendered,main);
  assert.equal(main.QUESTION_SNAPSHOT_REFRESH_REQUESTED,true);
});

test('a requested workbook refresh bypasses the stored snapshot before entering main',()=>{
  const x=indexContext(),c=x.c;let preparation;
  Object.assign(c,{QUESTION_SNAPSHOT_REFRESH_REQUESTED:true,questionSnapshotRefreshConsumed:false,
    prepareWorkbookSnapshotAndEnterMain:(workbook,options)=>{preparation={workbook,options};},
    LearningRpgQuestionStore:{get:()=>{throw new Error('stale snapshot must not be read');}}});
  functions(c,'Index.html',['prepareStoredWorkbookBeforeMain']);
  c.prepareStoredWorkbookBeforeMain({workbookId:'w'});
  assert.equal(preparation.workbook.workbookId,'w');
  assert.equal(preparation.options.forceReload,true);
});

test('a background main-screen snapshot lookup cannot replace a running game-start loader',async()=>{
  const x=indexContext(),c=x.c;let resolveLookup,changed=0;
  Object.assign(c,{QUESTION_SNAPSHOT_REFRESH_REQUESTED:false,questionSnapshotRefreshConsumed:false,
    applyQuestionSnapshotContribution:()=>{changed++;},applySelectedWorkbook:()=>{changed++;},
    prepareWorkbookSnapshotAndEnterMain:()=>{changed++;},
    LearningRpgQuestionStore:{get:()=>new Promise(resolve=>{resolveLookup=resolve;})}});
  functions(c,'Index.html',['prepareStoredWorkbookBeforeMain']);
  c.prepareStoredWorkbookBeforeMain({workbookId:'w'});
  c.mainNavigationInProgress=true;resolveLookup(null);await flush();assert.equal(changed,0);
});

test('snapshot preparation preserves start intent without hiding its new loading screen',async()=>{
  const x=indexContext(),c=x.c;let handler,started=0,hidden=0;
  Object.assign(c,{questionSnapshotLoadingWorkbookId:'',questionSnapshotReadyCallbacks:[],questionSnapshotRequestId:0,QUESTION_SNAPSHOT_REFRESH_REQUESTED:false,
    loadingSessionId:1,LOADING_COMPLETE_HOLD_MS:500,WORKBOOK_SNAPSHOT_LOADING_STEPS:[],toggle(){},getAuthToken:()=>'',updateLoadingModal(){},
    applyQuestionSnapshotContribution(){},applySelectedWorkbook(){},resetMainNavigation(){},hideLoadingModal:()=>{hidden++;},
    google:{script:{run:{withSuccessHandler(fn){handler=fn;return this;},withFailureHandler(){return this;},getWorkbookBattleQuestionSnapshot(){}}}},
    LearningRpgQuestionStore:{replace:()=>Promise.resolve()},
  });
  functions(c,'Index.html',['prepareWorkbookSnapshotAndEnterMain']);
  c.prepareWorkbookSnapshotAndEnterMain({workbookId:'w'},{onReady:()=>{started++;c.loadingSessionId++;}});
  handler({valid:true,workbookId:'w',questions:[]});await flush();
  assert.equal(started,1);
  for(const timer of [...x.timeouts.values()])timer.fn();assert.equal(hidden,0);
});

test('an earlier snapshot completion timer cannot hide a later game-start loader',async()=>{
  const x=indexContext(),c=x.c;let handler,hidden=0;
  Object.assign(c,{questionSnapshotLoadingWorkbookId:'',questionSnapshotReadyCallbacks:[],questionSnapshotRequestId:0,QUESTION_SNAPSHOT_REFRESH_REQUESTED:false,
    loadingSessionId:1,LOADING_COMPLETE_HOLD_MS:500,WORKBOOK_SNAPSHOT_LOADING_STEPS:[],toggle(){},getAuthToken:()=>'',updateLoadingModal(){},
    applyQuestionSnapshotContribution(){},applySelectedWorkbook(){},resetMainNavigation(){},hideLoadingModal:()=>{hidden++;},
    google:{script:{run:{withSuccessHandler(fn){handler=fn;return this;},withFailureHandler(){return this;},getWorkbookBattleQuestionSnapshot(){}}}},
    LearningRpgQuestionStore:{replace:()=>Promise.resolve()},
  });
  functions(c,'Index.html',['prepareWorkbookSnapshotAndEnterMain']);
  c.prepareWorkbookSnapshotAndEnterMain({workbookId:'w'},{});handler({valid:true,workbookId:'w',questions:[]});await flush();
  c.loadingSessionId++;
  for(const timer of [...x.timeouts.values()])timer.fn();assert.equal(hidden,0);
});

test('storage persistence failure cannot stop rendering received battle data',()=>{
  const x=browser();let applied=0;
  Object.assign(x.c,{rememberRunSession(){},isUsableGameDataSnapshot:()=>true,setLocalGameDataSnapshot(){},
    LearningRpgGameDataStore:{replace(){throw Error('quota exceeded');}},applyInitialBattleView:()=>{applied++;},showBattleEntryFailure:msg=>assert.fail(msg)});
  functions(x.c,'Battle.html',['loadInitialBattleView','validateInitialBattleView']);x.c.loadInitialBattleView(view());assert.equal(applied,1);
});

test('a battle initialization exception is displayed above the black fade and fullscreen guard',()=>{
  const x=browser({battle:true});
  store(x,'GameDataSnapshotStore.html');
  Object.assign(x.c,{initializeBattleView(){throw Error('render failed');},showLoadingModal:()=>x.nodes.get('loadingModal').classList.add('active')});
  functions(x.c,'Battle.html',['applyInitialBattleView','validateInitialBattleView','showBattleEntryFailure']);
  x.c.applyInitialBattleView(view());
  assert.equal(x.nodes.get('battleStartFade').classList.contains('active'),false);
  assert.equal(x.nodes.get('loadingModal').style.zIndex,'100001');
  assert.equal(x.nodes.get('battleEntryErrorText').textContent,'render failed');
  assert.equal(x.nodes.get('battleFullscreenGuard').classList.contains('hidden'),true);
});

test('empty start response returns to the main screen instead of navigating to an empty battle',()=>{
  const x=browser(),c=x.c;let success,failures=0,moved=0;
  Object.assign(c,{currentState:{player:{playerId:'p'}},selectedWorkbookId:'w',currentQuestionSnapshotManifest:{},updateLoadingModal(){},
    getAuthToken:()=>'',handleGameStartFailure:()=>{failures++;},cacheInitialBattleView(){},transitionToBattlePage:()=>{moved++;},
    google:{script:{run:{withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},startRun(){}}}},
  });
  functions(c,'Index.html',['beginGameStartRequest']);c.beginGameStartRequest();success(null);
  assert.equal(failures,1);assert.equal(moved,0);
});
