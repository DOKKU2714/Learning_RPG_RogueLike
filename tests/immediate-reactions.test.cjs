const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const source=fs.readFileSync('Battle.html','utf8');
const extract=name=>source.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];

test('monster reactions stay between the triggering hit and later effects, without turn announcements',async()=>{
  const seen=[];
  const ui=vm.createContext({workbookDeadlineExpired:false,pendingActionPointVisualCost:null,
    currentView:{battle:{turn:1,player:{},monsters:[]}},window:{},
    cancelTargetSelection(){},setBattleInputLocked(){},setPlayerTurn(){},getPlayerLevelProgress:()=>({}),
    playTurnPlayerEvent:async e=>seen.push(e.message),playTurnEffectEvent:async e=>seen.push(e.message),
    playMonsterReactionEvent:async e=>seen.push(e.message),
    pushLog:m=>seen.push(m),showTurnBanner:m=>seen.push(m),
    normalizeBattleView(){throw new Error('presentation complete');}});
  vm.runInContext(extract('playTurnSequence'),ui);
  await assert.rejects(ui.playTurnSequence({battle:{turn:1,status:'active',monsters:[],lastTurnEvents:[
    {actor:'player',type:'attack',message:'hit'},
    {actor:'monster',type:'heal',reaction:true,message:'threshold heal'},
    {actor:'effect',type:'effectDamage',message:'follow-up'},
    {actor:'player',type:'attack',message:'second hit'},
  ]}}),/presentation complete/);
  assert.deepEqual(seen,['hit','threshold heal','follow-up','second hit']);
});

for (const turnAdvanced of [false,true]) test('shield retaliation follows each monster impact: turn advanced '+turnAdvanced,async()=>{
  const seen=[],banners=[];
  const ui=vm.createContext({workbookDeadlineExpired:false,pendingActionPointVisualCost:null,
    currentView:{battle:{turn:1,player:{},monsters:[]}},window:{},
    cancelTargetSelection(){},setBattleInputLocked(){},setPlayerTurn(){},getPlayerLevelProgress:()=>({}),
    MONSTER_TURN_START_DELAY_MS:0,MONSTER_TURN_END_DELAY_MS:0,BATTLE_STEP_DELAY_MS:0,
    holdBattleMessage:async()=>{},skippableAutoDelay:async()=>{},
    playTurnPlayerEvent:async e=>seen.push(e.message),playTurnEffectEvent:async e=>seen.push(e.message),
    playMonsterReactionEvent:async e=>seen.push(e.message),
    playMonsterAttackImpact:async e=>{await Promise.resolve();seen.push(e.message);},
    playMonsterMultiHitSequence:async()=>assert.fail('retaliation must separate successive hits'),
    pushLog(){},showTurnBanner:m=>banners.push(m),
    normalizeBattleView(){throw new Error('presentation complete');}});
  for(const name of ['collectMonsterMultiHitEvents','playTurnSequence'])vm.runInContext(extract(name),ui);
  await assert.rejects(ui.playTurnSequence({battle:{turn:turnAdvanced?2:1,status:'active',monsters:[],lastTurnEvents:[
    {actor:'player',type:'guard',message:'shield cast'},
    {actor:'monster',monsterId:'a',type:'skill',hitCount:2,hitIndex:1,damage:3,shieldDamage:3,message:'first shield hit'},
    {actor:'player',type:'debuff',targetMonsterId:'a',effectId:'effect_v2_burn',message:'first ignition'},
    {actor:'monster',monsterId:'a',type:'skill',hitCount:2,hitIndex:2,damage:3,shieldDamage:3,message:'second shield hit'},
    {actor:'player',type:'debuff',targetMonsterId:'a',effectId:'effect_v2_burn',message:'second ignition'},
    {actor:'player',type:'heal',message:'reactive healing'},
    {actor:'effect',type:'effectDamage',target:'monster',message:'turn-end burn'},
  ]}}),/presentation complete/);
  assert.deepEqual(seen,['shield cast','first shield hit','first ignition','second shield hit','second ignition','reactive healing','turn-end burn']);
  assert.deepEqual(banners,turnAdvanced?['상대 턴']:[]);
});
