const test=require('node:test');
const assert=require('node:assert/strict');
const fs=require('node:fs');
const vm=require('node:vm');
const skills=fs.readFileSync('SkillService.gs','utf8');
const server=fs.readFileSync('BattleService.gs','utf8');
const client=fs.readFileSync('Battle.html','utf8');
const extract=(source,name,indent='')=>source.match(new RegExp(indent+'function '+name+'\\([^]*?\\n'+indent+'\\}'))[0];
function game(mode,cooldown,turn=1,conditionJson='{}'){
 const skill={skillId:'sample',cooldown,conditionJson,available:true};
 const view={availableSkills:[skill],battle:{turn,status:'active',player:{hp:100,maxHp:100,shield:0,maxActionPoint:3},
  monsters:[{instanceId:'enemy',name:'적',currentHp:100,effects:[]}],skillCooldowns:{},skillCooldownStartedTurns:{},skillUseCounts:{}}};
 const c=vm.createContext({currentView:view,hasLocalBattleSkillEngine:()=>false,safeJsonParseClient:(v,f)=>v?JSON.parse(v):f,
  RULE_ENGINE_SHARED:{clearCombatTurnShield:()=>{},hasActionBlock:()=>true},captureClientMonsterScoreSnapshot:()=>({}),
  normalizeClientActionPoints:()=>{},normalizeBattleView:v=>v,getFirstAliveMonster:b=>b.monsters.find(m=>m.currentHp>0),
  applyClientTimedEffectDamage:()=>{},decrementClientTurnEffects:()=>{},recordClientMonsterScoreContribution:()=>0,assignClientMonsterIntents:()=>{}});
 for(const name of ['parseClientPositiveNumber','findSkillInView','updateClientSkillAvailabilityForLocks','refreshClientSkillAvailabilityForLocks',
  'applyClientSkillUsageLocks','decrementClientSkillCooldowns','buildClientPassTurnView'])vm.runInContext(extract(client,name,'    '),c);
 if(mode==='server'){
  for(const name of ['normalizeSkillRuntimeState_','parseSkillCooldown_','setSkillCooldownAfterUse_','decrementSkillCooldowns_'])vm.runInContext(extract(skills,name),c);
  const run={runId:'r',playerId:'p',status:'active'};
  Object.assign(c,{STATUS:{RUN_ACTIVE:'active',BATTLE_ACTIVE:'active',BATTLE_DEFEAT:'defeat',BATTLE_VICTORY:'victory'},
   getCurrentPlayer_:()=>({playerId:'p'}),requireRun_:()=>run,requireRunBeforeWorkbookDeadline_:()=>{},getStageState_:()=>({battle:c.currentView.battle}),
   requireActiveBattle_:s=>s.battle,normalizeUsedQuestionIds_:()=>{},normalizeBattleStateEffects_:()=>{},normalizeBattleMonsters_:()=>{},normalizePlayerActionPoints_:()=>{},
   areAllMonstersDefeated_:()=>false,processSkillTriggers_:()=>{},getAliveMonsters_:b=>b.monsters,applyMonsterBurnDamage_:()=>{},
   clearMonsterTurnShields_:()=>{},applyMonsterTurn:()=>{},tickEffectsAtTurnEnd:()=>{},clearPlayerTurnShield_:()=>{},tickEffectsAtTurnStart:()=>{},
   decideMonsterIntents:()=>{},flushQueuedBattleAnswerLogs_:()=>{},saveStageState_:()=>{},buildBattleStateView_:()=>c.currentView});
  vm.runInContext(extract(server,'passPlayerTurn'),c);
 }
 return {
  get view(){return c.currentView;},
  use(){if(mode==='server')c.setSkillCooldownAfterUse_(c.currentView.battle,skill);else c.applyClientSkillUsageLocks(c.currentView,skill.skillId);},
  sameTurnTick(){if(mode==='server')c.decrementSkillCooldowns_(c.currentView.battle);else c.decrementClientSkillCooldowns(c.currentView.battle);},
  nextTurn(){if(mode==='server')c.passPlayerTurn('r','token');else c.currentView=c.buildClientPassTurnView();},
 };
}
for(const mode of ['server','browser']){
 for(const start of [1,5])for(const cooldown of [0,1,2,3])test(`cooldown ${mode}: ${cooldown} used on turn ${start} is ready on turn ${start+cooldown}`,()=>{
  const g=game(mode,cooldown,start);g.use();g.sameTurnTick();
  assert.equal(Number(g.view.battle.skillCooldowns.sample||0),cooldown);
  if(mode==='browser')assert.equal(g.view.availableSkills[0].available,cooldown===0);
  for(let elapsed=1;elapsed<=Math.max(1,cooldown);elapsed++){
   g.nextTurn();assert.equal(g.view.battle.turn,start+elapsed);
   assert.equal(Number(g.view.battle.skillCooldowns.sample||0),Math.max(0,cooldown-elapsed));
   if(mode==='browser')assert.equal(g.view.availableSkills[0].available,elapsed>=cooldown);
  }
  if(cooldown>0){assert.equal(g.view.battle.skillCooldownStartedTurns.sample,undefined);g.use();assert.equal(g.view.battle.skillCooldowns.sample,cooldown);}
 });
}
test('cooldown browser: expiry keeps the maximum-use restriction',()=>{
 const g=game('browser',1,1,'{"perBattleLimit":1}');g.use();g.nextTurn();
 assert.equal(g.view.battle.skillCooldowns.sample,0);assert.equal(g.view.availableSkills[0].available,false);
 assert.match(g.view.availableSkills[0].unavailableReason,/더 이상 사용할 수 없습니다/);
});
