const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const server = fs.readFileSync('BattleService.gs','utf8');
const skills = fs.readFileSync('SkillService.gs','utf8');
const html = fs.readFileSync('Battle.html','utf8');
const extract = (source,name,indent='') => source.match(new RegExp(indent+'function '+name+'\\([^]*?\\n'+indent+'\\}'))[0];
const fail = () => assert.fail('zero efficiency must not execute action effects or triggers');
function setup(actionType,cost) {
  const skill = {skillId:'s',type:'buff',target:'self',effectJson:'{}'};
  const battle = {runId:'r',battleId:'b',status:'active',stage:{floor:1,stage:1},
    player:{hp:50,maxHp:100,shield:7,currentActionPoint:3,effects:[]},
    monsters:[{instanceId:'enemy',currentHp:100,effects:[]}],skillCooldowns:{},skillUseCounts:{},
    pendingAction:{questionId:'q',actionType,skillId:'s',actionPointCost:cost,maxMs:1000}};
  const view = {battle,availableSkills:[skill]}, run = {runId:'r',playerId:'p'}, question = {questionId:'q'};
  const logs = [];
  const c = vm.createContext({STATUS:{BATTLE_ACTIVE:'active'},ACTION_TYPES:{SKILL:'skill',GUARD:'guard',ATTACK:'attack'},
    getCurrentPlayer_:()=>({playerId:'p'}),requireRun_:()=>run,requireRunBeforeWorkbookDeadline_(){},getStageState_:()=>({battle}),
    requireActiveBattle_:s=>s.battle,normalizeUsedQuestionIds_(){},normalizeBattleStateEffects_(){},normalizeBattleMonsters_(){},
    normalizePlayerActionPoints_:b=>b.player,buildRunState_:()=>({}),getOwnedSkillForRun_:()=>skill,getSkillUnavailableReason:()=>'',
    findRunQuestionById_:()=>question,validateQuestionAllowedForBattle_(){},isCorrectAnswer_:()=>true,markQuestionUsedForRun_(){},
    calculateEfficiency:()=>0,getItemQuestionModifiers_:()=>({}),recordExperienceQuestion_(){},areAllMonstersDefeated_:()=>false,
    isQuestionCorrectForStats_:v=>v,queueQuestionAttemptStats_:(...args)=>logs.push(args),queueBattleAnswerLog_:(...args)=>logs.push(args),
    saveStageState_(){},buildBattleStateView_:()=>view,tickEffectsOnPlayerAction:fail,processSkillTriggers_:fail,
    applyAttack:fail,applyGuard:fail,applySkillEffect:fail,processSkillFailPenaltyAfterAnswer_:fail,
    setSkillCooldownAfterUse_:fail,incrementSkillUseCount_:fail,trackSkillTagsForUse_:fail});
  vm.runInContext(fs.readFileSync('SharedRuleEngine.gs','utf8'),c);
  for (const [source,name] of [[server,'consumeActionPoint_'],[server,'submitActionAnswer'],[skills,'useSkill']])
    vm.runInContext(extract(source,name),c);
  return {c,view,battle,logs};
}

test('server: zero efficiency consumes only action cost and records the answer for attack, guard and skills', () => {
  for (const action of ['attack','guard','skill']) for (const cost of [0,1]) {
    const g = setup(action,cost), payload = {runId:'r',questionId:'q',elapsedMs:1000};
    if (action === 'skill') g.c.useSkill('r','s','enemy',payload);
    else g.c.submitActionAnswer(payload);
    assert.equal(g.battle.player.currentActionPoint,3-cost);
    assert.equal(g.battle.player.hp,50);
    assert.equal(g.battle.player.shield,7);
    assert.equal(g.battle.monsters[0].currentHp,100);
    assert.equal(g.battle.lastPlayerAction.efficiency,0);
    assert.equal(g.battle.lastTurnEvents[0].type,'actionFailed');
    assert.equal(g.battle.pendingAction,null);
    assert.equal(g.logs.length,1);
    assert.deepEqual(g.battle.skillCooldowns,{});
    assert.deepEqual(g.battle.skillUseCounts,{});
  }
});

test('browser: zero efficiency exits before actions, triggers, usage locks and combat animation events', () => {
  for (const action of ['attack','guard','skill']) for (const cost of [0,1]) {
    const g = setup(action,cost), c = g.c;
    Object.assign(c,{currentView:g.view,currentQuestionView:{actionType:action,skillId:'s',efficiencyLocked:true,lockedEfficiency:0,
      maxMs:1000,maxAnswerEfficiency:1.25,actionPointCost:cost,questionModifiers:{}},questionStartedAt:0,wrongCountAfterTimeout:5,
      window:{},currentDamageEfficiency:null,RULE_ENGINE_SHARED:c.getSharedRuleEngine_(),
      getQuestionViewId:()=> 'q',markClientQuestionUsed(){},normalizeClientActionPoints(){},normalizeBattleView:v=>v,
      hasLocalBattleSkillEngine:fail,applyOptimisticSkillAction:fail,applyOptimisticMonsterDamage:fail,applyClientSkillUsageLocks:fail});
    vm.runInContext(extract(html,'buildOptimisticNextViewFromQuestion','    '),c);
    const next = c.buildOptimisticNextViewFromQuestion();
    assert.equal(next.battle.player.currentActionPoint,3-cost);
    assert.equal(next.battle.player.hp,50);
    assert.equal(next.battle.player.shield,7);
    assert.equal(next.battle.monsters[0].currentHp,100);
    assert.equal(next.battle.lastTurnEvents.length,1);
    assert.equal(next.battle.lastTurnEvents[0].type,'actionFailed');
    assert.equal(next.battle.pendingAction,null);
    assert.deepEqual(JSON.parse(JSON.stringify(next.battle.skillCooldowns)),{});
    assert.deepEqual(JSON.parse(JSON.stringify(next.battle.skillUseCounts)),{});
  }
});

test('direct action entry points return before any battle mutation at zero efficiency', () => {
  const c = vm.createContext({});
  for (const [source,name,indent] of [[server,'applyAttack',''],[server,'applyGuard',''],[skills,'applySkillEffect',''],[html,'applyOptimisticSkillAction','    ']]) {
    vm.runInContext(extract(source,name,indent),c);
    const battle = {player:{hp:50},monsters:[{currentHp:100}]};
    if (name === 'applySkillEffect') c[name](battle,{},0,true);
    else if (name === 'applyOptimisticSkillAction') c[name](battle,{},0);
    else c[name](battle,0,'enemy');
    assert.deepEqual(battle,{player:{hp:50},monsters:[{currentHp:100}]});
  }
});

test('browser: a forced zero from a fatal wrong-answer penalty still applies the penalty without activating the skill', () => {
  const g = setup('skill',1), c = g.c;
  Object.assign(c,{currentView:g.view,currentQuestionView:{actionType:'skill',skillId:'s',efficiencyLocked:true,lockedEfficiency:0,
    failedBySkillPenalty:true,maxMs:1000,actionPointCost:1},questionStartedAt:0,wrongCountAfterTimeout:1,
    RULE_ENGINE_SHARED:c.getSharedRuleEngine_(),normalizeClientActionPoints(){},normalizeBattleView:v=>v,
    hasLocalBattleSkillEngine:()=>true,localGameDataSnapshot:{},findAvailableSkill:()=>g.view.availableSkills[0],
    window:{LearningRpgLocalRunEngine:{tick(){},trigger(){},skill(snapshot,battle,skill,target,efficiency,isCorrect){
      assert.equal(efficiency,0); assert.equal(isCorrect,false);
      battle.player.hp=0; battle.status='defeat';
    }}}});
  for (const name of ['buildOptimisticNextViewFromQuestion','applyOptimisticSkillAction'])
    vm.runInContext(extract(html,name,'    '),c);
  const next = c.buildOptimisticNextViewFromQuestion();
  assert.equal(next.battle.status,'defeat');
  assert.equal(next.battle.player.hp,0);
  assert.equal(next.battle.monsters[0].currentHp,100);
});
