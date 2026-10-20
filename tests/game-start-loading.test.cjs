const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const source=fs.readFileSync('GameStartService.gs','utf8');
test('loading tips use live sheet rows, filter inactive rows and keep sort order',()=>{
 const rows=[{tipId:'b',text:'두 번째',active:true,sortOrder:2},{tipId:'a',text:'첫 번째',active:'TRUE',sortOrder:1},
 {tipId:'off',text:'숨김',active:false},{tipId:'empty',text:' ',active:true}];
 const c=vm.createContext({DB_SHEETS:{LOADING_TIPS:'LoadingTips'},getSpreadsheet_:()=>({getSheetByName:()=>true}),readTable_:()=>rows,isTruthy_:v=>v===true||v==='TRUE'});
 vm.runInContext(source,c);
 assert.deepEqual(JSON.parse(JSON.stringify(c.getGameStartTips())),[{tipId:'a',text:'첫 번째'},{tipId:'b',text:'두 번째'}]);
 rows[1].text='시트 수정';assert.equal(c.getGameStartTips()[0].text,'시트 수정');
 c.getSpreadsheet_=()=>({getSheetByName:()=>null});assert.equal(c.getGameStartTips().length,0);
});

const battle=fs.readFileSync('Battle.html','utf8');
const extract=name=>battle.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
test('initial loading waits for local questions and assets before signaling ready',async()=>{
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
