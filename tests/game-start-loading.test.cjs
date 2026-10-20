const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('GameStartService.gs','utf8');
test('loading tips use live sheet rows, filter inactive rows and keep sort order',()=>{
 const rows=[{tipId:'b',text:'두 번째',active:true,sortOrder:2},{tipId:'a',text:'첫 번째',active:'TRUE',sortOrder:1},
 {tipId:'off',text:'숨김',active:false},{tipId:'empty',text:' ',active:true}];
 const c=vm.createContext({DB_SHEETS:{LOADING_TIPS:'LoadingTips'},getSpreadsheet_:()=>({getSheetByName:()=>true}),readTable_:()=>rows,isTruthy_:v=>v===true||v==='TRUE'});
 vm.runInContext(source,c);
 assert.deepEqual(JSON.parse(JSON.stringify(c.getGameStartTips())),[{tipId:'a',text:'첫 번째',displaySeconds:5},{tipId:'b',text:'두 번째',displaySeconds:5}]);
 for(const seconds of [2.5,10,0,-1,'bad',Infinity,'']){
   rows[1].displaySeconds=seconds;
   assert.equal(c.getGameStartTips()[0].displaySeconds,Number.isFinite(Number(seconds)) && Number(seconds)>0?Number(seconds):5);
 }
 rows[1].text='시트 수정';assert.equal(c.getGameStartTips()[0].text,'시트 수정');
 c.getSpreadsheet_=()=>({getSheetByName:()=>null});assert.equal(c.getGameStartTips().length,0);
});

const battle=fs.readFileSync('Battle.html','utf8');
const extract=name=>battle.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];

test('tip tags support nested bold, italic and hex colors while keeping HTML as text',()=>{
 const c=vm.createContext({document:{createElement:()=>({style:{}}),createTextNode:text=>({textContent:text,style:{}})}});
 const loading=fs.readFileSync('UiGameStartLoading.html','utf8');
 vm.runInContext(loading.match(/  function appendTipText\([^]*?\n  \}/)[0],c);
 function render(text){const parts=[];c.appendTipText({appendChild:part=>parts.push(part)},text);return parts;}
 let parts=render('[b]굵게 [i]기울임[/i][/b] [color=#12ABef]희귀 [color=#ff0000]빨강[/color] 복원[/color]');
 assert.equal(parts.map(p=>p.textContent).join(''),'굵게 기울임 희귀 빨강 복원');
 assert.equal(parts[0].style.fontWeight,'bold');
 assert.equal(parts[1].style.fontWeight,'bold');assert.equal(parts[1].style.fontStyle,'italic');
 assert.equal(parts.find(p=>p.textContent==='희귀').style.color,'#12ABef');
 assert.equal(parts.find(p=>p.textContent==='빨강').style.color,'#ff0000');
 assert.equal(parts.find(p=>p.textContent===' 복원').style.color,'#12ABef');
 assert.equal(render('희귀')[0].style.color,'#63a8ff');
 const unsafe='<img src=x onerror=alert(1)>[color=red]문자[/color][u]밑줄[/u][/b]';
 assert.equal(render(unsafe).map(p=>p.textContent).join(''),unsafe);
});

function loadingContext(embedded=false){
 const nodes={},intervals=[],timeouts=[],listeners={},created=[];let now=1000,success;
 const node=()=>({hidden:false,style:{},classList:{add(){},remove(){}},appendChild(){},replaceChildren(){}});
 const document={createElement:()=>{const value=node();created.push(value);return value;},createTextNode:text=>text,body:node(),documentElement:{},getElementById:id=>nodes[id]||(nodes[id]=node())};
 const math=Object.create(Math);math.random=()=>.75;
 const c=vm.createContext({document,Math:math,Date:{now:()=>now},sessionStorage:{getItem:()=>JSON.stringify([{tipId:'a',text:'A',displaySeconds:2},{tipId:'b',text:'B',displaySeconds:3}]),setItem(){}},
  google:{script:{run:{withSuccessHandler(fn){success=fn;return this;},withFailureHandler(){return this;},getGameStartTips(){}}}},
  setTimeout:(fn,ms)=>timeouts.push({fn,ms}),setInterval:(fn,ms)=>intervals.push({fn,ms}),clearTimeout(){},clearInterval(){},addEventListener:(name,fn)=>listeners[name]=fn});
 c.window=c;
 if(embedded){c.GAME_START_CHANNEL='test-channel';c.parent={postMessage(){},parent:null};c.parent.parent=c.parent;}
 vm.runInContext(fs.readFileSync('UiGameStartLoading.html','utf8').match(/<script>([^]*?)<\/script>/)[1],c);
 return {c,intervals,timeouts,listeners,nodes,created,setNow:value=>now=value,reply:rows=>success(rows)};
}

test('only the first tip is random; sheet durations control subsequent ordered tips',()=>{
 const x=loadingContext();x.c.LearningRpgGameStart.begin();
 assert.equal(vm.runInContext('undefined',x.c),undefined);
 // Read rendered text without exposing internal loading state.
 const text=[];x.nodes.gameStartTipText.appendChild=value=>text.push(value);x.nodes.gameStartTipText.replaceChildren=()=>text.length=0;
 x.reply([{tipId:'a',text:'A',displaySeconds:2},{tipId:'b',text:'B',displaySeconds:3}]);
 assert.deepEqual(text,['B'],'live refresh preserves the random first tip');
 const tick=x.intervals.find(timer=>timer.ms===250).fn;
 x.setNow(3999);tick();assert.deepEqual(text,['B']);
 x.setNow(4000);tick();assert.deepEqual(text,['A']);
 x.setNow(5999);tick();assert.deepEqual(text,['A']);
 x.setNow(6000);tick();assert.deepEqual(text,['B']);
 x.nodes.gameStartTip.onclick();assert.deepEqual(text,['A']);
});

test('loading is hidden before the embedded battle is allowed to start its title',async()=>{
 const x=loadingContext();x.c.LearningRpgGameStart.begin();
 const navigation=x.c.LearningRpgGameStart.navigate('https://battle.test/');
 x.timeouts.find(timer=>timer.ms===4000).fn();await navigation;
 const overlay=x.created[0],frame=x.created[x.created.length-1];
 frame.contentWindow={};frame.contentWindow.parent=frame.contentWindow;
 let started=false;frame.contentWindow.postMessage=()=>{assert.equal(overlay.hidden,true);started=true;};
 x.listeners.message({data:{type:'learningRpgBattleReady',channel: new URL(frame.src).searchParams.get('gameStartChannel')},source:frame.contentWindow,origin:'https://battle.test'});
 x.timeouts[x.timeouts.length-1].fn();await Promise.resolve();assert.equal(started,true);
});
test('page arrival and later intro share a handoff even when loading has already faded',async()=>{
 const x=loadingContext(true);let messages=0,finished=false;
 x.c.parent.postMessage=()=>messages++;
 const arrival=x.c.LearningRpgGameStart.ready();
 assert.equal(x.c.LearningRpgGameStart.ready(),arrival);assert.equal(messages,1);
 arrival.then(()=>finished=true);await Promise.resolve();assert.equal(finished,false);
 x.listeners.message({data:{type:'learningRpgStartIntro',channel:'test-channel'},source:x.c.parent});
 await arrival;assert.equal(finished,true);
 assert.equal(x.c.LearningRpgGameStart.ready(),arrival,'slow data preparation reuses the completed handoff');
});

test('battle page dismisses host loading before starting asynchronous data preparation',()=>{
 const calls=[],c=vm.createContext({window:{LearningRpgGameStart:{ready:()=>calls.push('arrival')}},
 setupBattleUi:()=>calls.push('ui'),consumeInitialBattleView:()=>({}),loadInitialBattleView:()=>calls.push('data')});
 vm.runInContext(extract('initializeBattlePage'),c);c.initializeBattlePage();
 assert.deepEqual(calls,['arrival','ui','data']);
});

test('a late battle failure restores the dismissed loading error screen',()=>{
 const x=loadingContext();x.c.LearningRpgGameStart.begin();x.created[0].hidden=true;
 x.c.LearningRpgGameStart.fail('준비 실패');
 assert.equal(x.created[0].hidden,false);assert.equal(x.nodes.gameStartLoadingError.hidden,false);
});

test('initial loading waits for local questions and assets before starting the intro',async()=>{
 let pending=true,finishWait,assetsReady,done=false;
 const c=vm.createContext({Date,document:{querySelectorAll:()=>[],fonts:{ready:new Promise(resolve=>assetsReady=resolve)}},
 isInitialQuestionCachePreparing:()=>pending,isLocalQuestionSnapshotUnavailable:()=>false,
 delay:ms=>ms===50?new Promise(resolve=>finishWait=resolve):new Promise(()=>{})});
 vm.runInContext(extract('waitForInitialBattleLoading'),c);
 const promise=c.waitForInitialBattleLoading().then(()=>done=true);
 await Promise.resolve();assert.equal(done,false);
 pending=false;finishWait();await Promise.resolve();assert.equal(done,false);
 assetsReady();await promise;assert.equal(done,true);
 c.isLocalQuestionSnapshotUnavailable=()=>true;
 await assert.rejects(c.waitForInitialBattleLoading(),/로컬 문제집/);
});

test('entering from loading replays the stage title even when the stage was already seen',()=>{
 const calls=[];
 const c=vm.createContext({currentView:{},isFloorIntermissionView:()=>false,hasSeenStageEntranceIntro:()=>true,
  playStageEntranceIntro:()=>calls.push('title'),skipStageEntranceIntro:()=>calls.push('skip')});
 vm.runInContext(extract('startBattleEntrance'),c);
 c.startBattleEntrance(true);c.startBattleEntrance();assert.deepEqual(calls,['title','skip']);
});

test('title remains fully visible for four seconds and fades before narration starts',()=>{
 const timers=[],classes=new Set();let narration=0;
 const overlay={classList:{add:(...names)=>names.forEach(n=>classes.add(n)),remove:(...names)=>names.forEach(n=>classes.delete(n))},setAttribute(){}};
 const nodes={stageIntroOverlay:overlay,stageIntroFloor:{},stageIntroArea:{}};
 const c=vm.createContext({currentView:{battle:{status:'active',stage:{}}},document:{getElementById:id=>nodes[id]||null},
 window:{setTimeout:(fn,ms)=>timers.push({fn,ms})},setBattleInputLocked(){},setPlayerTurn(){},finishBattleStartFade(){},
 getStageEntranceTitle:()=>({floorLine:'1층',areaLine:'교실'}),beginStageEntranceNarration:()=>narration++});
 const constants=battle.match(/    var STAGE_ENTRANCE_BLACK_HOLD_MS[^]*?var INITIAL_BATTLE_VIEW_KEY/)[0].replace(/var INITIAL_BATTLE_VIEW_KEY$/,'');
 vm.runInContext(constants,c);vm.runInContext(extract('playStageEntranceIntro'),c);c.playStageEntranceIntro();
 const sorted=timers.sort((a,b)=>a.ms-b.ms);
 sorted[0].fn();sorted[1].fn();assert.equal(classes.has('title-visible'),true);
 assert.ok(sorted[2].ms-sorted[1].ms>=4900,'title fade-in plus full reading time');
 sorted[2].fn();assert.equal(classes.has('fade-away'),true);assert.equal(narration,0);
 assert.equal(sorted[3].ms-sorted[2].ms,800);sorted[3].fn();assert.equal(narration,1);
});
