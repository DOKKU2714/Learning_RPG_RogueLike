const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(process.env.BATTLE_HTML_FILE || 'Battle.html','utf8');
function setup({plan=false,previewThrows=false,bridgeThrows=false,immediate=false}={}) {
 const requests=[],timers=[],watchdogs=[],applied=[],nodes=new Map();
 const view={runId:'run',battle:{battleId:'battle',status:'victory',stage:{stageId:'1-1'},player:{hp:7}}};
 const reward={choices:[{rewardId:'chosen'}],localTransitionToken:'signed'};
 const c=vm.createContext({currentView:view,isDummyMode:false,workbookDeadlineExpired:false,
  victoryRewardPreload:null,victoryRewardResultPayload:null,battleRewardPreparation:plan?{key:'run:battle:1-1',loading:false,rewardView:{choices:reward.choices,rewardPreparationToken:'plan'}}:null,
  victoryRewardDisplayStarted:false,victoryRewardRecoveryComplete:false,currentRewardView:null,
  runSessionToken:'session',localRunTransitions:[],localRunState:{},localGameDataSnapshot:{},rewardSelectionApplying:false,
  buildStageResultPayload:v=>JSON.parse(JSON.stringify(v)),getPendingQuestionUnderstanding:()=>[],getAuthToken:()=> 'auth',rememberRunSession:()=>{},ensureClientRewardState:()=>{},
  selectRewardChoiceLocally:id=>applied.push(id),
  document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:''});return nodes.get(id)}},
  window:{setTimeout(fn,ms){const handle={cancelled:false};if(ms===15000)watchdogs.push(()=>{if(!handle.cancelled)fn();});else timers.push(fn);return handle;},clearTimeout:handle=>{handle.cancelled=true;},LearningRpgLocalRunEngine:{reward(){if(previewThrows)throw Error('preview failed');return {...reward}}}},
  google:{script:{run:{withSuccessHandler(fn){return {withFailureHandler(fail){return {previewRewardChoicesForStageResult(payload){if(bridgeThrows)throw Error('bridge failed');requests.push({payload:JSON.parse(JSON.stringify(payload)),success:fn,fail});if(immediate)fn(reward)}}}}}}}}
 });
 for(const name of ['getVictoryRewardKey','refreshFinalVictoryRewardView','preloadVictoryRewardChoices','selectRewardChoice'])vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],c);
 return {c,requests,timers,watchdogs,applied,nodes,reward,start:()=>c.preloadVictoryRewardChoices(view),show(){c.currentRewardView=c.victoryRewardPreload.rewardView;c.victoryRewardDisplayStarted=true;}};
}
test('transient failure retries the original result and applies a queued choice exactly once',()=>{
 const x=setup({plan:true});x.start();x.show();x.c.selectRewardChoice('chosen');x.requests[0].fail({message:'temporary failure'});
 assert.equal(x.c.rewardSelectionApplying,true);assert.equal(x.timers.length,1);
 x.c.currentView.battle.player.hp=50;x.timers.shift()();assert.equal(x.requests.length,2);assert.deepEqual(x.requests[1].payload,x.requests[0].payload);
 x.requests[1].success(x.reward);assert.deepEqual(x.applied,['chosen']);assert.equal(x.c.rewardSelectionApplying,false);
});
test('retry exhaustion releases loading and selection lock and exposes the error',()=>{
 const x=setup({plan:true});x.start();x.show();x.c.selectRewardChoice('chosen');x.requests[0].fail({message:'temporary'});x.timers.shift()();x.requests[1].fail({message:'still failed'});
 assert.equal(x.requests.length,2);assert.equal(x.timers.length,0);assert.equal(x.c.victoryRewardPreload.loading,false);assert.equal(x.c.rewardSelectionApplying,false);
 assert.equal(x.nodes.get('rewardConfirmButton').disabled,false);assert.equal(x.nodes.get('rewardMessage').textContent,'still failed');
});
test('confirm after an error retains the choice even with an immediate success response',()=>{
 const x=setup({plan:true,immediate:true});x.c.currentRewardView={preparedDuringBattle:true};x.c.victoryRewardDisplayStarted=true;x.c.victoryRewardPreload={error:{message:'failed'}};
 x.c.selectRewardChoice('chosen');assert.deepEqual(x.applied,['chosen']);assert.equal(x.c.rewardSelectionApplying,false);
});
test('synchronous bridge exceptions release the pending confirmation',()=>{
 const x=setup({plan:true,bridgeThrows:true});x.c.currentRewardView={preparedDuringBattle:true};x.c.victoryRewardDisplayStarted=true;x.c.victoryRewardPreload={error:{message:'failed'}};
 assert.doesNotThrow(()=>x.c.selectRewardChoice('chosen'));assert.equal(x.c.victoryRewardPreload.loading,false);assert.equal(x.c.rewardSelectionApplying,false);assert.equal(x.nodes.get('rewardConfirmButton').disabled,false);
});
test('local preview failure still requests the same signed plan from the server',()=>{
 const x=setup({plan:true,previewThrows:true});assert.doesNotThrow(x.start);assert.equal(x.requests.length,1);assert.equal(x.requests[0].payload.rewardPreparationToken,'plan');
 x.requests[0].success(x.reward);assert.equal(x.c.victoryRewardPreload.rewardView.localTransitionToken,'signed');
});
test('late retry timers cannot request rewards after a new stage or deadline',()=>{
 for(const expired of [false,true]){const x=setup();x.start();x.requests[0].fail({message:'failed'});if(expired)x.c.workbookDeadlineExpired=true;else x.c.victoryRewardPreload=null;x.timers.shift()();assert.equal(x.requests.length,1);}
});
test('rejected background preparation falls back to a server request',async()=>{
 const x=setup();x.c.battleRewardPreparation={key:'run:battle:1-1',loading:true,promise:Promise.reject(Error('preparation failed'))};x.start();await Promise.resolve();assert.equal(x.requests.length,1);
});
test('empty responses and transport errors share a bounded retry budget',()=>{
 const x=setup();x.start();x.requests[0].success(null);assert.equal(x.requests.length,2);x.requests[1].fail({message:'failed'});assert.equal(x.timers.length,0);assert.equal(x.c.victoryRewardPreload.loading,false);
});

test('JSON reward transport preserves queued selection and checkpoint fields',()=>{
 const x=setup({plan:true});x.start();x.show();x.c.selectRewardChoice('chosen');
 assert.equal(x.requests[0].payload.rewardResponseFormat,'json');
 x.requests[0].success(JSON.stringify({...x.reward,runSessionToken:'checkpoint',acknowledgedLocalTransitions:['prior']}));
 assert.deepEqual(x.applied,['chosen']);assert.equal(x.c.currentRewardView.runSessionToken,'checkpoint');
});
test('malformed JSON responses exhaust one retry and release the confirm button',()=>{
 const x=setup({plan:true});x.start();x.show();x.c.selectRewardChoice('chosen');x.requests[0].success('{broken');x.requests[1].success('{broken');
 assert.equal(x.c.victoryRewardPreload.loading,false);assert.equal(x.c.rewardSelectionApplying,false);assert.equal(x.nodes.get('rewardConfirmButton').disabled,false);
});

test('a background request with no callback cannot block victory finalization',async()=>{
 const x=setup();let resolve;
 x.c.battleRewardPreparation={key:'run:battle:1-1',loading:true,promise:new Promise(r=>resolve=r)};
 x.start();assert.equal(x.requests.length,0);x.timers.shift()();assert.equal(x.requests.length,1);
 resolve({choices:x.reward.choices,rewardPreparationToken:'late'});await Promise.resolve();
 assert.equal(x.requests.length,1,'late preparation cannot issue duplicate finalization');
});

test('unanswered finalization requests time out, retry once and expose the battle retry button',()=>{
 const x=setup();x.start();x.watchdogs.shift()();x.timers.shift()();assert.equal(x.requests.length,2);
 x.watchdogs.shift()();assert.equal(x.c.victoryRewardPreload.loading,false);
 assert.equal(x.nodes.get('rewardLoadRetryButton').hidden,false);
 x.requests[0].success(x.reward);assert.equal(x.c.victoryRewardPreload.rewardView,x.reward,'the first valid response still completes the same battle');
 assert.equal(x.c.victoryRewardPreload.error,null);
});

test('late victory success cancels a scheduled retry and resumes progression once',()=>{
 const x=setup();let resumed=0;x.c.victoryRewardRecoveryComplete=true;x.c.showPreparedVictoryReward=()=>{resumed++;};
 x.start();x.watchdogs.shift()();assert.equal(x.timers.length,1);
 x.requests[0].success(x.reward);x.timers.shift()();assert.equal(x.requests.length,1);assert.equal(resumed,1);
 x.requests[0].success(x.reward);assert.equal(resumed,1);
});

test('victory preparation starts before dialogs, while advancement waits for item and level decisions',()=>{
 const animation=html.match(/    async function playTurnSequence\([^]*?\n    \}/)[0];
 assert(animation.indexOf('preloadVictoryRewardChoices(nextView)')<animation.indexOf('await presentMonsterItemDrops(currentView)'));
 assert(animation.indexOf('await presentMonsterItemDrops(currentView)')<animation.indexOf('openRewardAfterVictory()'));
});

test('prepared rewards rebase final HP and items locally without discarding the signed permit',()=>{
 const x=setup();x.start();x.requests[0].success(x.reward);const receipt={key:'run:battle:1-1',choicesSettled:true,payload:{battle:{player:{hp:17,items:[{itemId:'claimed'}]}}}};
 x.c.victoryRewardResultPayload=receipt;let payload;
 x.c.window.LearningRpgLocalRunEngine.reward=(run,snapshot,p,view)=>{payload=p;return {...view,currentHpAfterRegen:p.battle.player.hp+3};};
 const updated=x.c.refreshFinalVictoryRewardView(x.c.victoryRewardPreload.rewardView);
 assert.equal(updated.currentHpAfterRegen,20);assert.equal(updated.localTransitionToken,'signed');assert.equal(payload.battle.player.items[0].itemId,'claimed');
 assert.equal(x.requests.length,1);assert.equal(receipt.payload.battle.player.hp,17);
});

test('next-floor questions warm once while rest rewards are still being chosen',()=>{
 const x=setup();let requests=0;
 Object.assign(x.c,{currentView:{runId:'run',battle:{stage:{floor:1}}},nextFloorQuestionRefreshKey:'',nextFloorQuestionRefreshPromise:null,
  isFloorIntermissionView:()=>true,getSelectedWorkbookId:()=> 'workbook',refreshBattleQuestionSnapshot:()=>{requests++;return Promise.resolve({});}});
 for(const name of ['getCurrentBattleFloorForQuestionRefresh','getTargetFloorForQuestionRefresh','ensureNextFloorQuestionRefresh','preloadFollowingStageStatic'])vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],x.c);
 x.c.preloadFollowingStageStatic();x.c.preloadFollowingStageStatic();
 assert.equal(requests,1);assert.equal(x.c.nextFloorQuestionRefreshKey,'run:workbook:2');
});

test('automatic continuation waits for a finalized permit and ignores timers after entering the next battle',()=>{
 const x=setup({plan:true});x.reward.choices=[{rewardId:'continue',type:'stageContinue'}];
 x.c.battleRewardPreparation.rewardView.choices=x.reward.choices;x.c.pushLog=()=>{};
 vm.runInContext(html.match(/    function showPreparedVictoryReward\([^]*?\n    \}/)[0],x.c);
 x.start();x.c.showPreparedVictoryReward();assert.deepEqual(x.applied,[]);assert.equal(x.c.victoryRewardDisplayStarted,false);
 x.requests[0].success(x.reward);x.timers.shift()();assert.deepEqual(x.applied,['continue']);
 x.c.currentView.battle.status='active';x.c.victoryRewardDisplayStarted=false;x.c.showPreparedVictoryReward();assert.equal(x.requests.length,1);
});

test('automatic local continuation failures are visible outside the hidden reward modal',()=>{
 const x=setup(),logs=[];
 Object.assign(x.c,{workbookClockServerMs:0,workbookDeadlineMs:0,localVictoryPendingResponse:null,
  currentRewardView:{choices:[{type:'stageContinue'}],localTransition:{issuedAtMs:1}},victoryRewardPreload:{},victoryRewardDisplayStarted:true,
  buildStageResultPayload:()=>({}),
  finishFloorExperienceSelection(){},updateWorkbookCountdown(){},pushLog:m=>logs.push(m)});
 x.c.window.LearningRpgLocalRunEngine.advance=()=>{throw Error('transition failed');};
 vm.runInContext(html.match(/    function selectRewardChoiceLocally\([^]*?\n    \}/)[0],x.c);
 x.c.selectRewardChoiceLocally('continue');assert.equal(x.nodes.get('rewardLoadRetryButton').hidden,false);
 assert.equal(x.c.victoryRewardDisplayStarted,false);assert.deepEqual(logs,['transition failed']);
});
