const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('Battle.html','utf8');
const extract = name => html.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];

test('monster death plays the kill sound once for each defeated monster',()=>{
 const sounds=[],states=[],timers=[];
 const slots=Object.fromEntries(['a','b'].map(id=>{
  const classes=new Set();
  return [id,{classList:{contains:c=>classes.has(c),add:c=>classes.add(c)},querySelector:()=>({id,classList:{remove(){}}}),getBoundingClientRect:()=>({}),parentNode:null}];
 }));
 const c=vm.createContext({document:{querySelector:selector=>slots[selector.match(/="([^"]+)"/)[1]]},cssEscape:s=>s,
  playBattleSound:key=>sounds.push(key),setMonsterSpriteState:(target,state)=>states.push([target.id,state]),
  window:{setTimeout:cb=>timers.push(cb)},DEATH_STATE_HOLD_MS:2200});
 c.startMonsterDeathRewards=()=>{};
 vm.runInContext(extract('animateMonsterDeath'),c);
 c.animateMonsterDeath('a');c.animateMonsterDeath('a');c.animateMonsterDeath('b');c.animateMonsterDeath('missing');
 assert.deepEqual(sounds,['kill','kill']);assert.equal(states.length,2);assert.equal(timers.length,2);
 assert.match(html,/kill:\s*'Resources\/Sounds\/Kill\.mp3'/);
});

test('a monster killed by its turn-start effects cannot execute an attack',()=>{
  let attacks=0;
  const c=vm.createContext({
    currentView:{battle:{player:{hp:30,maxActionPoint:3},monsters:[{instanceId:'m',currentHp:1}],turn:1}},
    localGameDataSnapshot:{},window:{LearningRpgLocalRunEngine:{
      tick(){},actorTurn:(_,battle,monster)=>{monster.currentHp=0;return {blocked:false};},
      monsterAction:()=>{attacks++;return true;},
    }},
    hasLocalBattleSkillEngine:()=>true,RULE_ENGINE_SHARED:{clearCombatTurnShield(){}},
    captureClientMonsterScoreSnapshot:()=>({}),normalizeClientActionPoints(){},
    getFirstAliveMonster:b=>b.monsters.find(m=>m.currentHp>0),
    recordClientMonsterScoreContribution:()=>0,refreshClientSkillAvailabilityForLocks(){},
    assignClientMonsterIntents(){},normalizeBattleView:v=>v,
  });
  vm.runInContext(extract('buildClientPassTurnView'),c);
  const next=c.buildClientPassTurnView();
  assert.equal(attacks,0);
  assert.equal(next.battle.player.hp,30);
  assert.equal(next.battle.status,'victory');
});

test('turn playback preserves attack then poison death and interleaves effects between monsters',async()=>{
  const order=[];
  const banners=[];
  const c=vm.createContext({
    window:{},document:{},workbookDeadlineExpired:false,pendingActionPointVisualCost:null,
    getPlayerLevelProgress:()=>({}),
    localGameDataSnapshot:{},currentView:{battle:{}},battleQuestionCache:[],pendingServerTurnView:null,
    pendingTurnResolutionActive:false,passTurnLogPending:false,
    MONSTER_TURN_START_DELAY_MS:0,MONSTER_TURN_END_DELAY_MS:0,BATTLE_STEP_DELAY_MS:0,
    cancelTargetSelection(){},setBattleInputLocked(){},setPlayerTurn(){},
    showTurnBanner:text=>banners.push(text),pushLog(){},holdBattleMessage(){},skippableAutoDelay(){},
    playTurnEffectEvent:e=>order.push(e.message),
    playTurnPlayerEvent:e=>{
      if(e.message==='after turn begins') assert.equal(banners.at(-1),'내 턴');
      order.push(e.message);
    },
    collectMonsterMultiHitEvents:(events,i)=>[events[i]],
    playMonsterAttackImpact:e=>order.push(e.message),
    animateExperienceRewards(){},normalizeBattleView:v=>v,resetBattleQuestionCacheFromView(){},
    renderBattle(){},presentLevelStatAllocation(){},presentLevelSkillRewards(){},presentMonsterItemDrops(){},
  });
  vm.runInContext(extract('playTurnSequence'),c);
  await c.playTurnSequence({battle:{status:'active',lastTurnEvents:[
    {actor:'monster',type:'attack',damage:5,message:'first attack'},
    {actor:'effect',target:'monster',message:'poison death'},
    {actor:'monster',type:'attack',damage:5,message:'second attack'},
    {actor:'effect',target:'monster',message:'turn end poison'},
    {actor:'player',type:'heal',turnPhase:'playerTurnStart',message:'player turn-start skill'},
  ]}});
  assert.deepEqual(order,['first attack','poison death','second attack','turn end poison','player turn-start skill']);
  assert.deepEqual(banners,[],'reactive effects in the same turn do not show turn transition banners');
  order.length=0;
  await c.playTurnSequence({battle:{turn:2,status:'active',lastTurnEvents:[
    {actor:'monster',type:'attack',damage:5,message:'normal turn attack'},
  ]}});
  assert.deepEqual(banners,['상대 턴','내 턴'],'actual turn changes retain their transition banners');
  order.length=0;banners.length=0;
  await c.playTurnSequence({battle:{turn:3,status:'active',lastTurnEvents:[
    {actor:'monster',type:'attack',damage:5,message:'last enemy action'},
    {actor:'player',type:'heal',turnPhase:'playerTurnStart',message:'after turn begins'},
  ]}});
  assert.deepEqual(order,['last enemy action','after turn begins']);
  assert.deepEqual(banners,['상대 턴','내 턴'],'turn-start skills do not duplicate the next turn banner');
});

for (const changedStage of [false,true]) test('rest transition survives refreshed view but rejects a different stage: '+changedStage,()=>{
 let timer,selected=[];
 const view={runId:'r',battle:{battleId:'rest1',stage:{stageId:'stage_1_6'}}};
 const c=vm.createContext({currentView:view,stageIntroPlaying:false,floorIntermissionActionPending:false,workbookDeadlineExpired:false,rewardSelectionApplying:false,
  isFloorIntermissionView:()=>true,isBattleResultLoading:()=>false,pushLog(){},setBattleInputLocked(){},setPlayerTurn(){},
  loadFloorIntermissionRewardView:cb=>cb({choices:[{rewardId:'rest',type:'rest'}]}),
  getFloorIntermissionChoice:v=>v.choices[0],playFloorRestEffect(){},currentRewardView:null,
  window:{setTimeout:cb=>{timer=cb;}},FLOOR_REST_TRANSITION_DELAY_MS:100,
  selectRewardChoice:id=>selected.push(id)});
 vm.runInContext(extract('getVictoryRewardKey'),c);
 vm.runInContext(extract('chooseFloorIntermissionAction'),c);
 c.chooseFloorIntermissionAction('rest');
 c.currentView=JSON.parse(JSON.stringify(view));
 if(changedStage)c.currentView.battle.stage.stageId='stage_2_1';
 timer();
 assert.deepEqual(selected,changedStage?[]:['rest']);
 assert.equal(c.floorIntermissionActionPending,false);
});
