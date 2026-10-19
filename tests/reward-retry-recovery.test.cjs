const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync(process.env.BATTLE_HTML_FILE || 'Battle.html','utf8');
function setup({plan=false,previewThrows=false,bridgeThrows=false,immediate=false}={}) {
 const requests=[],timers=[],applied=[],nodes=new Map();
 const view={runId:'run',battle:{battleId:'battle',status:'victory',stage:{stageId:'1-1'},player:{hp:7}}};
 const reward={choices:[{rewardId:'chosen'}],localTransitionToken:'signed'};
 const c=vm.createContext({currentView:view,isDummyMode:false,workbookDeadlineExpired:false,
  victoryRewardPreload:null,victoryRewardResultPayload:null,battleRewardPreparation:plan?{key:'run:battle:1-1',loading:false,rewardView:{choices:reward.choices,rewardPreparationToken:'plan'}}:null,
  victoryRewardDisplayStarted:false,victoryRewardRecoveryComplete:false,currentRewardView:null,
  runSessionToken:'session',localRunTransitions:[],localRunState:{},localGameDataSnapshot:{},rewardSelectionApplying:false,
  buildStageResultPayload:v=>JSON.parse(JSON.stringify(v)),getPendingQuestionUnderstanding:()=>[],getAuthToken:()=> 'auth',rememberRunSession:()=>{},ensureClientRewardState:()=>{},
  selectRewardChoiceLocally:id=>applied.push(id),
  document:{getElementById:id=>{if(!nodes.has(id))nodes.set(id,{disabled:false,textContent:''});return nodes.get(id)}},
  window:{setTimeout:fn=>timers.push(fn),LearningRpgLocalRunEngine:{reward(){if(previewThrows)throw Error('preview failed');return {...reward}}}},
  google:{script:{run:{withSuccessHandler(fn){return {withFailureHandler(fail){return {previewRewardChoicesForStageResult(payload){if(bridgeThrows)throw Error('bridge failed');requests.push({payload:JSON.parse(JSON.stringify(payload)),success:fn,fail});if(immediate)fn(reward)}}}}}}}}
 });
 for(const name of ['getVictoryRewardKey','preloadVictoryRewardChoices','selectRewardChoice'])vm.runInContext(html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],c);
 return {c,requests,timers,applied,nodes,reward,start:()=>c.preloadVictoryRewardChoices(view),show(){c.currentRewardView=c.victoryRewardPreload.rewardView;c.victoryRewardDisplayStarted=true;}};
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
