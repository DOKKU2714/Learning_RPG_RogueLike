const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const {context, start, copy} = require('./run-session.test.cjs');
const definitions = require('./fixtures/live-skill-definitions.json');
const html = fs.readFileSync('Battle.html', 'utf8');
function clientFunction(name) {
  const begin = html.indexOf('    function ' + name + '(');
  return html.slice(begin, html.indexOf('\n    function ', begin + 1));
}
function setup() {
  const x = context();
  x.seed(x.c.DB_SHEETS.SKILLS, definitions.skills);
  x.seed(x.c.DB_SHEETS.EFFECTS, definitions.effects);
  const initial = start(x);
  const engine = vm.runInNewContext(x.c.getLocalRunEngineSource_(), {Date:x.c.Date, Math:x.c.Math});
  const battle = {battleId:'complex', status:'active', turn:1, stage:{floor:1,stage:1},
    player:{hp:30,maxHp:100,shield:0,stats:{hp:100,attack:10,defense:2,accuracy:100,criticalRate:0},effects:[],
      baseMaxActionPoint:3,maxActionPoint:3,currentActionPoint:3},
    monsters:[{instanceId:'a',monsterId:'a',currentHp:200,maxHp:200,attack:10,defense:0,evasion:0,shield:0,effects:[]},
      {instanceId:'b',monsterId:'b',currentHp:200,maxHp:200,attack:10,defense:0,evasion:0,shield:0,effects:[]}],lastTurnEvents:[]};
  const skill = (id, level=1) => x.c.hydrateSkill_(definitions.skills.find(row=>row.skillId===id), level);
  const perform = (mode, battle, id, efficiency=1, level=1, correct=true, target='a') => {
    const s=skill(id,level);
    if(mode==='browser') engine.skill(initial.gameDataSnapshot,battle,s,target,efficiency,correct);
    else if(!x.c.processSkillFailPenaltyAfterAnswer_(battle,s,correct)) x.c.applySkillEffect(battle,{...s,targetId:target},efficiency,correct);
    return battle;
  };
  const trigger = (mode,b,timing,payload={}) => mode==='browser'
    ? engine.trigger(initial.gameDataSnapshot,b,timing,payload) : x.c.processSkillTriggers_(b,timing,payload);
  return {x,engine,battle,skill,perform,trigger,snapshot:initial.gameDataSnapshot};
}

for(const mode of ['server','browser']) {
  test(mode+': mindless strike keeps all three hits after strike master without subtracting defense',()=>{
    const g=setup();
    for(const [efficiency,defense,unbuffedDamage,buffedDamage] of [[1,0,8,10],[1,5,8,10],[1,10,8,10],[.5,5,4,5]]) {
      for(const buffed of [false,true]) {
        const b=copy(g.battle);
        b.monsters.forEach(m=>{m.defense=defense;});
        if(buffed) g.perform(mode,b,'skill_strike_master');
        g.perform(mode,b,'skill_mindless_strike',efficiency);
        const hits=b.lastTurnEvents.filter(e=>e.skillId==='skill_mindless_strike' && e.type==='skill');
        const expected=buffed?buffedDamage:unbuffedDamage;
        assert.equal(hits.length,3);
        assert.ok(hits.every(e=>e.damage===expected && !e.missed));
        assert.equal(b.monsters.reduce((sum,m)=>sum+200-m.currentHp,0),3*expected);
        assert.equal(new Set(hits.map(e=>e.targetMonsterId)).size,2);
      }
    }
  });
  test(mode+': absorption heals from actual three-hit damage once, including low efficiency and overkill',()=>{
    const g=setup();
    for(const [efficiency,hp,expectedDamage,expectedHeal] of [[1,200,24,8],[.5,200,12,4],[1,5,5,2]]) {
      const b=copy(g.battle);b.monsters=[b.monsters[0]];b.monsters[0].currentHp=hp;
      g.perform(mode,b,'skill_vampire',efficiency);
      assert.equal(hp-b.monsters[0].currentHp,expectedDamage);
      assert.equal(b.player.hp,30+expectedHeal);
    }
  });
  test(mode+': cautious guard reduces another active cooldown',()=>{
    const g=setup(),b=copy(g.battle);b.skillCooldowns={skill_vampire:2,skill_cautious_guard:2};
    g.perform(mode,b,'skill_cautious_guard');
    assert.equal(b.skillCooldowns.skill_vampire,1);assert.equal(b.skillCooldowns.skill_cautious_guard,2);
    assert.equal(b.player.shield,7);
  });
  test(mode+': mimic copies the selected enemy shield and buffs, preserving remaining duration',()=>{
    const g=setup(),b=copy(g.battle);b.monsters[1].shield=12;
    b.monsters[1].effects=[{effectId:'buff_power',name:'힘',category:'buff',statKey:'attack',effectType:'flat',value:2,
      durationType:'turn',durationTurns:5,remainingTurns:2,stacks:3,stackable:true,maxStacks:99}];
    const original=copy(b.monsters[1]);g.perform(mode,b,'skill_mimic',.5,1,true,'b');
    assert.equal(b.player.shield,12);assert.equal(b.player.effects[0].stacks,3);assert.equal(b.player.effects[0].remainingTurns,2);
    assert.equal(b.monsters[1].shield,original.shield);assert.equal(b.monsters[1].effects[0].stacks,3);
    g.perform(mode,b,'skill_mimic',1,1,true,'b');assert.equal(b.player.effects[0].stacks,6);
  });
  test(mode+': emergency escape loses on its own wrong answer and later HP damage, but expires after this turn',()=>{
    const g=setup();
    let b=copy(g.battle);g.perform(mode,b,'skill_emergency_escape',0,1,false);assert.equal(b.status,'defeat');assert.equal(b.player.shield,0);
    b=copy(g.battle);g.perform(mode,b,'skill_emergency_escape');g.trigger(mode,b,'onBlock',{shieldDamage:5,hpDamage:0,target:b.monsters[1]});assert.equal(b.status,'active');
    g.trigger(mode,b,'onDamaged',{hpDamage:1,target:b.monsters[1]});assert.equal(b.status,'defeat');
    b=copy(g.battle);g.perform(mode,b,'skill_emergency_escape');g.trigger(mode,b,'onWrong');assert.equal(b.status,'defeat');
    b=copy(g.battle);g.perform(mode,b,'skill_emergency_escape');
    if(mode==='browser')g.engine.tick(g.snapshot,b,'turnEnd');else g.x.c.tickEffectsAtTurnEnd(b);
    assert.equal(b.activeTriggers.length,0);g.trigger(mode,b,'onDamaged',{hpDamage:1});assert.equal(b.status,'active');
    b=copy(g.battle);g.perform(mode,b,'skill_emergency_escape');
    b.player.effects=[{...g.snapshot.effects.find(e=>e.effectId==='debuff_poison'),remainingTurns:3,stacks:1}];
    if(mode==='browser')g.engine.tick(g.snapshot,b,'turnEnd');else g.x.c.tickEffectsAtTurnEnd(b);
    assert.equal(b.status,'defeat');
  });
  test(mode+': all or nothing increases the next turn AP and keeps difficulty through the battle',()=>{
    const g=setup(),b=copy(g.battle);b.player.currentActionPoint=0;g.perform(mode,b,'skill_all_or_nothing');
    assert.equal(b.player.maxActionPoint,4);assert.equal(b.player.currentActionPoint,0);
    b.turn++;
    if(mode==='browser')g.engine.tick(g.snapshot,b,'turnStart');else g.x.c.normalizePlayerActionPoints_(b,true);
    assert.equal(b.player.currentActionPoint,4);
    for(let i=0;i<5;i++){if(mode==='browser')g.engine.tick(g.snapshot,b,'turnEnd');else g.x.c.tickEffectsAtTurnEnd(b);b.turn++;}
    assert.equal(b.player.effects.find(e=>e.effectId==='debuff_foolish').durationType,'battle');
  });
  test(mode+': thorn shield reflects blocked damage to the attacker, rather than the first enemy',()=>{
    const g=setup(),b=copy(g.battle);g.perform(mode,b,'skill_thorn_shield');
    g.trigger(mode,b,'onBlock',{shieldDamage:7,hpDamage:0,target:b.monsters[1],actor:'monster'});
    assert.equal(b.monsters[0].currentHp,200);assert.equal(b.monsters[1].currentHp,193);
  });
  test(mode+': finishing strike counts preceding strike uses once each and true strike evaluates the AP formula',()=>{
    const g=setup(),b=copy(g.battle);
    g.perform(mode,b,'skill_body_blow');g.perform(mode,b,'skill_double_strike');
    assert.equal(b.usedSkillCountByTagThisBattle.strike,2);
    const before=b.monsters[0].currentHp;g.perform(mode,b,'skill_finishing_strike');assert.equal(before-b.monsters[0].currentHp,12);
    b.player.baseMaxActionPoint=6;b.player.maxActionPoint=6;b.player.currentActionPoint=6;
    g.perform(mode,b,'skill_true_strike');assert.equal(b.player.currentActionPoint,3);
  });
  test(mode+': endure pain only responds during player actions, and strike master actually buffs later strikes',()=>{
    const g=setup(),b=copy(g.battle);g.perform(mode,b,'skill_endure_pain');
    g.trigger(mode,b,'onDamaged',{hpDamage:3,actor:'monster'});assert.equal(b.player.effects.length,0);
    g.trigger(mode,b,'onDamaged',{hpDamage:3,actor:'player',selfTurn:false});assert.equal(b.player.effects.length,0);
    b.player.effects=[{...g.snapshot.effects.find(e=>e.effectId==='debuff_bleed'),remainingTurns:3,stacks:1}];
    if(mode==='browser')g.engine.tick(g.snapshot,b,'onAction');else g.x.c.tickEffectsOnPlayerAction(b);
    assert.ok(b.player.effects.some(e=>e.effectId==='buff_power'));
    const strike=copy(g.battle);g.perform(mode,strike,'skill_strike_master');assert.equal(strike.monsters[0].currentHp,200);
    assert.equal(strike.activeTagBonuses[0].damageMultiplier,1.25);
    const before=strike.monsters[0].currentHp;g.perform(mode,strike,'skill_body_blow');assert.equal(before-strike.monsters[0].currentHp,18);
  });
}

test('defense increases guard shields but never reduces incoming damage on server or browser',()=>{
  const g=setup();
  const client=vm.createContext({hasLocalBattleSkillEngine:()=>false});
  vm.runInContext(clientFunction('applyOptimisticPlayerDamage'),client);
  for(const defense of [0,10,100]) {
    const b=copy(g.battle);b.player.stats.defense=defense;
    g.x.c.applyGuard(b,.5);
    assert.equal(b.player.shield,Math.round((5+defense)*.5));
    for(const shield of [0,3,20]) {
      const server=copy(b);server.player.shield=shield;
      const browser=copy(server);
      const actual=g.x.c.dealDamageToPlayer_(server,10,server.monsters[0]);
      assert.equal(actual.damage,10);
      assert.equal(actual.shieldDamage,Math.min(shield,10));
      assert.equal(actual.hpDamage,10-Math.min(shield,10));
      assert.deepEqual(copy(client.applyOptimisticPlayerDamage(browser,10)),copy(actual));
      assert.equal(browser.player.hp,server.player.hp);
      assert.equal(browser.player.shield,server.player.shield);
    }
  }
});

test('all-in consumes all remaining AP, including modified maxima, and requires at least one AP',()=>{
  const g=setup(),s=g.skill('skill_all_in');
  for(const ap of [1,2,3,4,6]) {
    const b=copy(g.battle);b.player.baseMaxActionPoint=6;b.player.currentActionPoint=ap;
    assert.equal(g.x.c.getActionPointCostForAction_('skill',s,b),ap);
    const [view]=g.engine.skills(g.snapshot,b,[s]);assert.equal(view.actionPointCost,ap);assert.equal(view.available,true);
    g.x.c.consumeActionPoint_(b,view.actionPointCost);g.perform('browser',b,s.skillId);assert.equal(b.player.currentActionPoint,0);
  }
  const b=copy(g.battle);b.player.currentActionPoint=0;assert.equal(g.engine.skills(g.snapshot,b,[s])[0].available,false);
});

test('spreadsheet formulas, malformed legacy multi-attack, and non-upgradable skills are handled',()=>{
  const g=setup(),b=copy(g.battle),c=g.x.c;
  g.perform('browser',b,'skill_area_strike',1,3);assert.equal(b.monsters[0].currentHp,179);assert.equal(b.monsters[1].currentHp,179);
  const multi=g.skill('skill_multi_attack');assert.equal(JSON.parse(multi.effectJson).hitCount,3);assert.equal(JSON.parse(multi.conditionJson).perStageLimit,3);
  g.perform('browser',b,'skill_multi_attack');assert.equal(b.monsters[0].currentHp,167);
  for(const id of ['skill_mimic','skill_all_or_nothing']) {
    assert.equal(c.isSkillUpgradable_(g.skill(id)),false);
    const owned=[{skillId:id,level:1}];assert.equal(c.getAvailableSkillRewardPool_('',owned,{onlyOwnedSkills:true}).length,0);
    assert.throws(()=>c.applySkillUpgradeReward_({skills:owned},{targetId:id,value:1}),/강화/);
  }
});

test('every spreadsheet skill executes with supported keys and formulas on server and shipped browser code',()=>{
  const g=setup();
  for(const row of definitions.skills) {
    for(const mode of ['server','browser']) {
      const b=copy(g.battle);b.monsters[0].shield=10;
      b.skillCooldowns={skill_body_blow:2};b.usedSkillCountByTagThisBattle={strike:2};b.usedSkillCountByTagThisTurn={strike:2};
      g.perform(mode,b,row.skillId,1,3);
      assert.deepEqual(copy(b.skillRuleWarnings||[]),[],mode+': '+row.skillId);
      assert.ok(Number.isFinite(b.player.hp));assert.ok(Number.isFinite(b.player.shield));
    }
  }
});

test('browser handlers call the shipped rules and refresh dynamic HP and shield availability',()=>{
  const g=setup(),skill=g.skill('skill_piercing_strike'),view={battle:copy(g.battle),availableSkills:[skill]};
  const c=vm.createContext({window:{LearningRpgLocalRunEngine:g.engine},localGameDataSnapshot:g.snapshot,currentView:view,
    findAvailableSkill:id=>view.availableSkills.find(s=>s.skillId===id)});
  for(const name of ['hasLocalBattleSkillEngine','applyOptimisticSkillAction','refreshClientSkillAvailabilityForLocks','applyOptimisticPlayerDamage'])vm.runInContext(clientFunction(name),c);
  c.refreshClientSkillAvailabilityForLocks(view);assert.equal(view.availableSkills[0].available,false);
  view.battle.monsters[1].shield=10;c.refreshClientSkillAvailabilityForLocks(view);assert.equal(view.availableSkills[0].available,true);
  g.perform('browser',view.battle,'skill_thorn_shield');view.battle.player.shield=20;
  c.applyOptimisticPlayerDamage(view.battle,7,view.battle.monsters[1]);assert.equal(view.battle.monsters[1].currentHp,200);assert.equal(view.battle.monsters[1].shield,3);
  view.availableSkills=[g.skill('skill_cautious_guard')];view.battle.skillCooldowns={skill_vampire:2};
  c.applyOptimisticSkillAction(view.battle,{skillId:'skill_cautious_guard'},1);assert.equal(view.battle.skillCooldowns.skill_vampire,1);
});

test('browser turn transitions expire escape, refill modified AP, and award reflection kills',()=>{
  const g=setup(),view={battle:copy(g.battle),availableSkills:[],score:0};
  const c=vm.createContext({window:{LearningRpgLocalRunEngine:g.engine},localGameDataSnapshot:g.snapshot,currentView:view,
    normalizeClientActionPoints:()=>{},normalizeBattleView:x=>x,
    getFirstAliveMonster:b=>b.monsters.find(m=>m.currentHp>0),hasClientEffect:()=>false,
    applyClientTimedEffectDamage:()=>{},getClientIntentValue:i=>Number(i.value||0),
    getClientEffectiveStat:(m,key)=>Number(m[key]||0),rollClientHit:()=>({hit:true,chance:100}),
    rollClientMonsterCriticalDamage:(m,d)=>({damage:d,isCritical:false,multiplier:1}),assignClientMonsterIntents:()=>{}});
  for(const name of ['hasLocalBattleSkillEngine','buildClientPassTurnView','applyOptimisticPlayerDamage',
    'decrementClientSkillCooldowns','refreshClientSkillAvailabilityForLocks','captureClientMonsterScoreSnapshot',
    'recordClientMonsterScoreContribution','getClientMonsterScoreKey','ensureClientMonsterScoreState',
    'calculateClientMonsterKillScore','getClientGlobalStageIndexForScore','recordClientDefeatedMonster'])vm.runInContext(clientFunction(name),c);
  view.battle.monsters=[view.battle.monsters[0]];view.battle.monsters[0].currentHp=5;view.battle.monsters[0].intent={actionType:'attack',value:7};
  view.battle.monsterScoreState={battleId:'complex',monsterScore:0,byMonsterId:{a:{efficiencyByQuestion:{prior:1},efficiencyTotal:1,questionCount:1,scoreAwarded:0}}};
  g.perform('browser',view.battle,'skill_thorn_shield');view.battle.player.shield=20;
  let next=c.buildClientPassTurnView();assert.equal(next.battle.status,'victory');assert.equal(next.score,110);
  view.battle=copy(g.battle);view.battle.monsters.forEach(m=>m.intent={actionType:'guard',value:1});
  c.calculateClientMonsterGuardShield=()=>1;
  g.perform('browser',view.battle,'skill_all_or_nothing');g.perform('browser',view.battle,'skill_emergency_escape');
  next=c.buildClientPassTurnView();assert.equal(next.battle.status,'active');assert.equal(next.battle.player.currentActionPoint,4);assert.equal(next.battle.activeTriggers.length,0);
});

test('fatal wrong answer detection includes escape itself and an active escape on ordinary attacks',()=>{
  const g=setup(),view={battle:copy(g.battle),availableSkills:[g.skill('skill_emergency_escape')]};
  const c=vm.createContext({currentView:view,currentQuestionView:{actionType:'skill',skillId:'skill_emergency_escape'},
    safeJsonParseClient:(v,f)=>v?JSON.parse(v):f,findAvailableSkill:id=>view.availableSkills.find(s=>s.skillId===id)});
  vm.runInContext(clientFunction('hasClientFatalWrongAnswerPenalty'),c);assert.equal(c.hasClientFatalWrongAnswerPenalty(),true);
  g.perform('browser',view.battle,'skill_emergency_escape');c.currentQuestionView={actionType:'attack'};assert.equal(c.hasClientFatalWrongAnswerPenalty(),true);
  g.engine.tick(g.snapshot,view.battle,'turnEnd');assert.equal(c.hasClientFatalWrongAnswerPenalty(),false);
});
