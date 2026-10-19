const test=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const server=fs.readFileSync(process.env.REWARD_SERVICE_FILE || 'RewardService.gs','utf8');
const html=fs.readFileSync(process.env.BATTLE_HTML_FILE || 'Battle.html','utf8');
const serverFn=name=>server.match(new RegExp('function '+name+'\\([^]*?\\n\\}'))[0];
const clientFn=name=>html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
for(const entry of ['previewRewardChoicesForStageResult','prepareRewardChoicesDuringBattle']) {
 test(entry+' emits JSON after session and acknowledgement processing',()=>{
  const response={choices:[{rewardId:'a'},{rewardId:'b'},{rewardId:'c'}],localTransitionToken:'signed',runSessionToken:'checkpoint',localRunState:{updatedAt:new Date('2026-10-18T00:00:00Z')}};
  const c=vm.createContext({RUN_SESSION_LOCK_HELD_:false,LockService:{getScriptLock:()=>({waitLock(){},releaseLock(){}})},withRunSession_:()=>response,syncQuestionUnderstandingForRun_:(id,entries,auth,r)=>({...r,acknowledgedLocalTransitions:['prior']})});
  for(const n of ['encodeRewardRpcResponse_',entry])vm.runInContext(serverFn(n),c);
  const value=c[entry]({runId:'run',rewardResponseFormat:'json'},'auth');assert.equal(typeof value,'string');const parsed=JSON.parse(value);
  assert.equal(parsed.choices.length,3);assert.equal(parsed.localTransitionToken,'signed');assert.equal(parsed.runSessionToken,'checkpoint');assert.equal(parsed.localRunState.updatedAt,'2026-10-18T00:00:00.000Z');assert.deepEqual(parsed.acknowledgedLocalTransitions,['prior']);
  assert.equal(typeof c[entry]({runId:'run'},'auth'),'object');assert.equal(c.RUN_SESSION_LOCK_HELD_,false);
 });
}
test('JSON serialization errors fail explicitly instead of returning an empty success',()=>{
 const c=vm.createContext({});vm.runInContext(serverFn('encodeRewardRpcResponse_'),c);const circular={};circular.self=circular;
 assert.throws(()=>c.encodeRewardRpcResponse_(circular,{rewardResponseFormat:'json'}));assert.throws(()=>c.encodeRewardRpcResponse_(undefined,{rewardResponseFormat:'json'}));
});
test('background preparation accepts JSON and requests the negotiated format',async()=>{
 let requested,remembered;const c=vm.createContext({isDummyMode:false,localRunState:{},window:{LearningRpgLocalRunEngine:{reward(){}}},battleRewardPreparation:null,
 getVictoryRewardKey:()=> 'key',buildStageResultPayload:()=>({}),getAuthToken:()=>'',rememberRunSession:r=>remembered=r,
 google:{script:{run:{withSuccessHandler(fn){return {withFailureHandler(){return {previewRewardChoicesForStageResult(p){requested=p;fn(JSON.stringify({choices:[{rewardId:'a'}],rewardPreparationToken:'plan'}));}}}}}}}}});
 vm.runInContext(clientFn('prepareBattleRewardsInBackground'),c);c.prepareBattleRewardsInBackground({battle:{status:'active'}});const result=await c.battleRewardPreparation.promise;
 assert.equal(requested.rewardResponseFormat,'json');assert.equal(result.rewardPreparationToken,'plan');assert.equal(remembered.choices.length,1);
});
test('floor rest accepts JSON rewards and reports malformed replies through failure',()=>{
 for(const value of [JSON.stringify({choices:[{rewardId:'rest'}]}),'{broken']) {
  let requested,result,error,finished=0;const c=vm.createContext({getCurrentFloorIntermissionRewardView:()=>null,buildStageResultPayload:()=>({}),startDelayedLoadingModal:()=>1,finishDelayedLoadingModal:()=>finished++,ensureClientRewardState:()=>{},getAuthToken:()=>'',
   google:{script:{run:{withSuccessHandler(fn){return {withFailureHandler(){return {previewRewardChoicesForStageResult(p){requested=p;fn(value)}}}}}}}}});
  vm.runInContext(clientFn('loadFloorIntermissionRewardView'),c);c.loadFloorIntermissionRewardView(r=>result=r,e=>error=e);assert.equal(requested.rewardResponseFormat,'json');assert.equal(finished,1);
  if(value==='{broken')assert.ok(error);else assert.equal(result.choices[0].rewardId,'rest');
 }
});
test('reroll accepts JSON without losing its signed reward view',()=>{
 let requested,rendered;const c=vm.createContext({currentView:{},currentRewardView:{localTransitionToken:'old'},currentQuestionView:null,workbookDeadlineExpired:false,victoryRewardPreload:null,
 buildStageResultPayload:()=>({}),rememberRunSession:()=>{},getAuthToken:()=>'',ensureClientRewardState:()=>{},renderRewardChoices:r=>rendered=r,
 google:{script:{run:{withSuccessHandler(fn){return {withFailureHandler(){return {previewRewardChoicesForStageResult(p){requested=p;fn(JSON.stringify({rerollStatus:'success',rewardView:{choices:[{rewardId:'new'}],localTransitionToken:'new-signed'}}));}}}}}}}}});
 vm.runInContext(clientFn('requestRewardReroll'),c);c.requestRewardReroll('answer','2');assert.equal(requested.rewardResponseFormat,'json');assert.equal(rendered.localTransitionToken,'new-signed');assert.equal(c.rewardSelectionApplying,false);
});
