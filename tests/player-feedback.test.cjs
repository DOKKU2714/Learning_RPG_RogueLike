const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm'),fs=require('node:fs');
const html=fs.readFileSync('Battle.html','utf8');
const extract=name=>html.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];

test('stage-clear regeneration distinguishes a full health bar from zero regeneration',async()=>{
  for(const [hp,regen,wanted] of [[12,0,'재생 수치가 0'],[30,0,'모두 차 있어'],[12,3,'3 재생']]){
    const messages=[];
    const ui=vm.createContext({currentView:{runId:'r',battle:{battleId:'b',status:'victory',player:{hp,maxHp:30,stats:{hp:30,hpRegen:regen}}}},
      workbookDeadlineExpired:false,victoryRewardFlowStarted:false,victoryRewardRecoveryComplete:false,victoryRegenPresentationKey:'',stageClearPresentation:{key:'r:b',complete:true},
      preloadVictoryRewardChoices(){},buildStageResultPayload:()=>({}),showPreparedVictoryReward(){},getVictoryRewardKey:()=> 'r:b',renderPlayerHud(){},
      animatePlayerStatusEffect(){},spawnFloatingText(){},document:{getElementById:()=>null},pushLog:m=>messages.push(m),waitForBattleLogAdvance:()=>Promise.resolve()});
    for(const name of ['presentStageClearRegen','openRewardAfterVictory'])vm.runInContext(extract(name),ui);
    ui.openRewardAfterVictory();await Promise.resolve();
    assert.equal(messages.length,1);assert.ok(messages[0].includes(wanted),messages[0]);
    if(hp<30 && regen===0)assert.ok(!messages[0].includes('모두 차'));
    ui.openRewardAfterVictory();assert.equal(messages.length,1,'retrying never presents regeneration twice');
  }
});

test('experience questions auto-claim after feedback and keep a visible retry on failure',()=>{
  const timers=[],nodes={questionMessage:{},questionSubmitButton:{}};
  const ui=vm.createContext({currentView:{},currentRewardView:{},currentQuestionView:{isFloorExperience:true,question:{}},
    workbookDeadlineExpired:false,rewardSelectionApplying:false,currentDamageEfficiency:.85,floorIntermissionActionPending:true,pendingStageAnswerLogs:[],
    window:{setTimeout:fn=>timers.push(fn)},document:{getElementById:id=>nodes[id]},
    recordRunQuestionAttempt(){},buildPendingStageAnswerLog:a=>a,closeQuestionModal(){ui.currentQuestionView=null;}});
  for(const name of ['submitQuestionAnswerOnServer','requestQuestionResultProceed','finishFloorExperienceSelection'])vm.runInContext(extract(name),ui);
  let attempts=0;
  ui.selectRewardChoice=id=>{assert.equal(id,'floor_rest_experience');attempts++;ui.finishFloorExperienceSelection({message:'다시 시도'});};
  ui.submitQuestionAnswerOnServer({elapsedMs:3000,wrongCountAfterTimeout:0});
  assert.equal(timers.length,1);timers[0]();
  assert.equal(attempts,1);assert.equal(nodes.questionSubmitButton.disabled,false);
  assert.equal(nodes.questionSubmitButton.textContent,'경험치 반영 재시도');
  ui.selectRewardChoice=()=>{attempts++;ui.finishFloorExperienceSelection();};
  ui.requestQuestionResultProceed();
  assert.equal(attempts,2);assert.equal(ui.currentQuestionView,null);assert.equal(ui.floorIntermissionActionPending,false);
  assert.equal(ui.currentView.floorExperienceAnswer.elapsedMs,3000);
});

test('fire attacks use the flame visual instead of the circular weapon impact',async()=>{
  const effects=[];
  const ui=vm.createContext({document:{querySelector:()=>({})},cssEscape:v=>v,
    normalizePlayerAttackEffect:()=> 'fire',playDamageTypeEffect:(...args)=>effects.push(args),skippableAutoDelay:()=>Promise.resolve(),ATTACK_EFFECT_DELAY_MS:0});
  vm.runInContext(extract('animatePlayerAttack'),ui);await ui.animatePlayerAttack('monster','fire');
  assert.deepEqual(effects,[['burn','monster','monster']]);
});
