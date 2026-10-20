const test = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const pack = require('./fixtures/monster-pack.json');
const {context, copy} = require('./run-session.test.cjs');

function setup(id, mode='server') {
  const x=context(), c=x.c;
  const skills=[...copy(c.MASTER_SKILLS),...copy(pack.Skills)];
  x.seed(c.DB_SHEETS.MONSTERS,pack.Monsters);
  x.seed(c.DB_SHEETS.SKILLS,skills);
  x.seed(c.DB_SHEETS.MONSTER_AI,pack.MonsterAI);
  const snapshot={monsters:copy(pack.Monsters),skills,monsterAi:copy(pack.MonsterAI),
    effects:copy(c.MASTER_EFFECTS),effectRules:[],basePlayerStats:copy(c.DEFAULT_BASE_PLAYER_STATS)};
  const engine=vm.runInNewContext(c.getLocalRunEngineSource_(),{Date:c.Date,Math:c.Math});
  const monster=c.buildBattleMonster_(copy(pack.Monsters.find(m=>m.monsterId===id)),0);
  const battle={battleId:'kit-test',status:'active',turn:1,stage:{floor:1,stage:1},suppressMonsterScoreBookkeeping:true,
    player:{hp:10000,maxHp:10000,shield:0,stats:{hp:10000,attack:10,defense:4,accuracy:100,evasion:0,criticalRate:0,criticalDamage:150},effects:[],currentActionPoint:3,maxActionPoint:3},
    monsters:[monster],monster,lastTurnEvents:[]};
  const intent=()=>mode==='server'?c.selectMonsterAction(monster,pack.MonsterAI,battle):engine.monsterIntent(snapshot,battle,monster);
  const action=()=>{
    monster.intent=intent();
    if(mode==='server')c.executeMonsterIntent(battle,monster.instanceId);
    else engine.monsterAction(snapshot,battle,monster);
  };
  const trigger=(timing,payload)=>mode==='server'?c.processSkillTriggers_(battle,timing,payload):engine.trigger(snapshot,battle,timing,payload);
  const damage=(value,extra={})=>mode==='server'?c.dealDamageToMonster_(battle,monster,value,{damageKind:'direct',...extra}):engine.damage(snapshot,battle,monster.instanceId,value,{damageKind:'direct',...extra});
  const tick=(timing)=>{
    if(mode!=='server')return engine.tick(snapshot,battle,timing);
    if(timing==='turnStart'){c.normalizePlayerActionPoints_(battle,true);return c.tickEffectsAtTurnStart(battle);}
    return c.tickEffectsAtTurnEnd(battle);
  };
  const round=()=>{action();tick('turnEnd');battle.turn++;tick('turnStart');};
  return {x,c,snapshot,engine,monster,battle,intent,action,trigger,damage,tick,round};
}

test('monster pack: 17 original IDs, 39 skills, no reward leakage, deterministic canonical data',()=>{
  assert.deepEqual(pack,require('../scripts/build-monster-pack.cjs'));
  assert.equal(pack.Monsters.length,17); assert.equal(pack.Skills.length,39);
  assert.equal(new Set(pack.Skills.map(s=>s.skillId)).size,39);
  for(const monster of pack.Monsters){
    const ids=JSON.parse(monster.skillIds);
    assert.equal(ids.length,monster.type==='normal'?2:3);
    for(const id of ids) assert.ok(pack.Skills.some(s=>s.skillId===id));
  }
  for(const skill of pack.Skills){
    assert.equal(skill.rewardEnabled,false);
    assert.ok(JSON.parse(skill.tags).includes('monsterOnly'));
    assert.ok(JSON.parse(skill.effectJson).monsterSkill);
  }
});

for(const mode of ['server','browser']) {
  test('monster pack: '+mode+' threshold skills show one activation while preserving every stat effect',()=>{
    for(const definition of pack.Monsters){
      const passive=pack.Skills.find(skill=>JSON.parse(definition.skillIds).includes(skill.skillId) && JSON.parse(skill.effectJson).monsterSkill.trigger==='hpBelow');
      if(!passive)continue;
      const g=setup(definition.monsterId,mode),id=passive.skillId;
      g.monster.currentHp=Math.floor(g.monster.maxHp/2);
      g.damage(1);
      assert.equal(g.monster.monsterKit.used[id],1,id);
      const events=g.battle.lastTurnEvents.filter(event=>event.skillId===id);
      assert.equal(events.length,1,id+' activation event');
      const stats=JSON.parse(passive.effectJson).monsterSkill.actions.filter(action=>action.op==='stat');
      for(const action of stats)assert.ok(g.monster.effects.some(effect=>effect.statKey===action.stat && effect.value===action.value),id+' '+action.stat);
      for(let i=0;i<2;i++){g.damage(1);g.intent();}
      assert.equal(g.monster.monsterKit.used[id],1,id+' must stay once');
      assert.equal(g.battle.lastTurnEvents.filter(event=>event.skillId===id).length,1,id+' must not repeat');
    }
  });

  test('monster pack: '+mode+' all 39 skills activate and survive checkpoint serialization',()=>{
    const activated=new Set();
    for(const definition of pack.Monsters){
      const g=setup(definition.monsterId,mode),m=g.monster;
      g.intent(); // battleStart passives
      m.currentHp=Math.floor(m.maxHp/2);
      m.criticalRate=100;
      g.intent(); // Preview must not activate threshold passives.
      g.damage(1);
      g.trigger('onMiss',{actor:'player',target:m,damageKind:'direct'});
      for(let i=0;i<20;i++)g.round();
      for(const [id,count] of Object.entries(m.monsterKit.used))if(count>0)activated.add(id);
      assert.deepEqual(copy(m.monsterKit),JSON.parse(JSON.stringify(m.monsterKit)));
    }
    assert.deepEqual([...activated].sort(),pack.Skills.map(s=>s.skillId).sort());
  });

  test('monster pack: '+mode+' charging, release, rest and preview do not advance the clock',()=>{
    const g=setup('monster_Outdoor',mode),m=g.monster;
    for(let i=0;i<4;i++)assert.equal(g.intent().phase,'charge');
    assert.equal(m.monsterKit.actions,0);
    g.action(); assert.equal(g.battle.player.hp,10000);
    assert.equal(g.intent().phase,'release');
    g.action(); assert.equal(g.battle.player.hp,10000-32);
    assert.equal(g.intent().phase,'rest');
    g.action();assert.equal(g.battle.player.hp,10000-32);
    g.action();assert.equal(g.battle.player.hp,10000-32-18);
    assert.equal(g.intent().phase,'charge');
  });

  test('monster pack: '+mode+' next-hit reductions consume once and threshold healing never repeats',()=>{
    const bird=setup('monster_Pigeon',mode);
    assert.equal(bird.damage(10).damage,5);
    assert.equal(bird.damage(10).damage,10);
    const book=setup('monster_Book',mode);
    book.damage(23);assert.equal(book.monster.currentHp,22);
    assert.equal(book.monster.monsterKit.used.ms_close_book,1);
    book.intent();assert.equal(book.monster.monsterKit.used.ms_close_book,1);
    book.action();
    assert.equal(book.damage(10).damage,3);
    assert.equal(book.damage(10).damage,10);
    const computer=setup('monster_Computer',mode);
    computer.damage(40);assert.equal(computer.monster.currentHp,55);
    computer.intent();assert.equal(computer.monster.currentHp,55);
    computer.action();assert.equal(computer.monster.currentHp,55);
    computer.damage(16);assert.equal(computer.monster.currentHp,39);
    assert.equal(computer.monster.monsterKit.used.ms_reboot,1);
  });

  test('monster pack: '+mode+' counter caps, melee reflection, shield piercing and lifesteal',()=>{
    const chair=setup('monster_Chair',mode);
    chair.trigger('onMiss',{actor:'player',target:chair.monster,damageKind:'direct'});
    chair.trigger('onMiss',{actor:'player',target:chair.monster,damageKind:'direct'});
    assert.equal(chair.battle.player.hp,10000-8);
    chair.battle.turn++;
    chair.trigger('onMiss',{actor:'player',target:chair.monster,damageKind:'direct'});
    assert.equal(chair.battle.player.hp,10000-16);
    const outdoor=setup('monster_Outdoor',mode);
    outdoor.damage(1);assert.equal(outdoor.battle.player.hp,9998);
    const reflection=outdoor.battle.lastTurnEvents.find(e=>e.skillId==='ms_rust_fragments');
    assert.equal(reflection.actor,'effect');
    assert.equal(reflection.target,'player');
    assert.equal(reflection.type,'reflection');
    assert.equal(outdoor.battle.lastMonsterAction,undefined);
    assert.equal(outdoor.battle.turn,1);
    assert.equal(outdoor.battle.player.currentActionPoint,3);
    assert.equal(outdoor.monster.monsterKit.actions,0);
    const ranged={skillId:'ranged',tags:'["ranged"]',attackEffect:'thrust'};
    outdoor.snapshot.skills.push(ranged);outdoor.x.seed(outdoor.c.DB_SHEETS.SKILLS,outdoor.snapshot.skills);outdoor.c.clearMasterTableCaches_();
    outdoor.damage(1,{sourceSkillId:'ranged'});assert.equal(outdoor.battle.player.hp,9998);
    const ghost=setup('monster_Ghost',mode);
    ghost.monster.currentHp=10;ghost.battle.player.shield=100;
    ghost.action();assert.equal(ghost.monster.currentHp,13);
    ghost.action();assert.equal(ghost.monster.currentHp,16);
    const hpBefore=ghost.battle.player.hp;
    ghost.action();assert.equal(ghost.battle.player.hp,hpBefore-10);
    assert.equal(ghost.monster.currentHp,16,'skill hits do not lifesteal');
  });

  test('monster pack: '+mode+' dots do not stack and last exactly the configured turns',()=>{
    const g=setup('monster_Book',mode);
    g.action();g.action();g.action();
    const afterHit=g.battle.player.hp;
    g.tick('turnEnd');assert.equal(g.battle.player.hp,afterHit);
    g.battle.turn++;g.tick('turnStart');assert.equal(g.battle.player.hp,afterHit-3);
    g.tick('turnEnd');g.battle.turn++;g.tick('turnStart');assert.equal(g.battle.player.hp,afterHit-6);
    g.tick('turnEnd');g.battle.turn++;g.tick('turnStart');assert.equal(g.battle.player.hp,afterHit-6);
    const nib=setup('monster_Write',mode);nib.monster.criticalRate=100;
    nib.action();nib.action();nib.action();
    assert.equal(nib.battle.player.effects.filter(e=>e.skillId==='ms_sharp_nib').length,1);
  });

  test('monster pack: '+mode+' persistent bone shield, overdue skills, final phase and capped attendance',()=>{
    const human=setup('boss_Human',mode);human.intent();
    assert.equal(human.monster.shield,40);
    human.c.getSharedRuleEngine_().clearCombatTurnShield(human.monster);
    assert.equal(human.monster.shield,40);
    assert.equal(human.damage(10).shieldDamage,10);
    human.c.getSharedRuleEngine_().clearCombatTurnShield(human.monster);
    assert.equal(human.monster.shield,30);
    const chalk=setup('boss_Ghost',mode),used=[];
    for(let n=1;n<=13;n++){const i=chalk.intent();used.push([n,i.skillId]);chalk.action();}
    assert.equal(used[11][1],'ms_chalk_barrage');assert.equal(used[12][1],'ms_eraser_dust');
    const boss=setup('boss_floor_5',mode);boss.intent();boss.monster.currentHp=333;boss.intent();
    assert.equal(boss.intent().hitCount,1,'preview must not activate the HP phase');
    boss.action();assert.equal(boss.intent().value,39);boss.action();
    assert.equal(boss.battle.lastTurnEvents.filter(e=>e.skillId==='ms_expulsion'&&e.damage>0).length,2);
    for(let n=0;n<26;n++)boss.action();
    assert.equal(boss.c.monsterKitStats_(boss.monster).attack,50);
  });
}

for(const mode of ['server','browser']) {
  test('monster pack: '+mode+' HP conditions activate immediately once, even before a blocked owner turn',()=>{
    const g=setup('monster_Computer',mode);
    g.damage(40);
    assert.equal(g.monster.currentHp,55);
    assert.equal(g.battle.lastTurnEvents.find(e=>e.skillId==='ms_reboot').reaction,true);
    for(let i=0;i<3;i++)g.intent();
    assert.equal(g.monster.currentHp,55);
    g.c.applyEffect(g.monster,{effectId:'debuff_stun',category:'debuff',statKey:'action',effectType:'control',durationType:'turn',durationTurns:1},{turn:1});
    const result=mode==='server' ? g.c.beginCombatActorTurn_(g.battle,g.monster)
      : g.engine.actorTurn(g.snapshot,g.battle,g.monster);
    assert.equal(result.blocked,true);
    assert.equal(g.monster.currentHp,55);
    assert.equal(g.monster.monsterKit.used.ms_reboot,1);
    g.intent();assert.equal(g.monster.currentHp,55);
    const dead=setup('monster_Computer',mode);
    dead.damage(1000);dead.intent();dead.action();
    assert.equal(dead.monster.currentHp,0);
    assert.equal(dead.monster.monsterKit.used.ms_reboot,undefined);
  });
}

test('monster pack: server/browser parity for all monsters, including effects, phases and hit events',()=>{
  for(const definition of pack.Monsters){
    const a=setup(definition.monsterId),b=setup(definition.monsterId,'browser');
    for(let turn=1;turn<=10;turn++){
      if(turn===3){a.monster.currentHp=b.monster.currentHp=Math.floor(definition.hp/2);}
      assert.deepEqual(copy(a.intent()),copy(b.intent()),definition.monsterId+' intent '+turn);
      a.round();b.round();
      assert.deepEqual(copy(a.battle),copy(b.battle),definition.monsterId+' state '+turn);
    }
  }
});

test('monster pack: edited sheet stats, multiplier, period and duration drive server and browser',()=>{
  for(const mode of ['server','browser']){
    const g=setup('monster_test_ghost',mode),skill=g.snapshot.skills.find(s=>s.skillId==='ms_red_mark');
    const rule=JSON.parse(skill.effectJson);rule.monsterSkill.every=2;rule.monsterSkill.actions[0].multiplier=2;
    rule.monsterSkill.actions[1].durationTurns=4;skill.effectJson=JSON.stringify(rule);
    g.x.seed(g.c.DB_SHEETS.SKILLS,g.snapshot.skills);g.c.clearMasterTableCaches_();
    g.monster.attack=7;g.monster.criticalRate=0;
    g.action();g.action();
    assert.equal(g.battle.player.hp,10000-7-14);
    assert.equal(g.battle.player.effects[0].remainingTurns,4);
  }
});

test('monster pack: browser executes the common monster action after the shared control gate',()=>{
  const html=fs.readFileSync('Battle.html','utf8');
  const start=html.indexOf('function buildClientPassTurnView('),end=html.indexOf('function decrementClientSkillCooldowns',start);
  const section=html.slice(start,end);
  assert.ok(section.indexOf('commonTurn.blocked')<section.indexOf('LearningRpgLocalRunEngine.monsterAction('));
  assert.ok(section.includes('RULE_ENGINE_SHARED.clearCombatTurnShield(monster)'));
});

test('monster pack: imported sheet validation checks links and rejects malformed configuration without writes',()=>{
  const g=setup('monster_test_ghost');g.c.Logger={log(){}};
  assert.deepEqual(copy(g.c.validateMonsterSkillSheets()),{ok:true,monsters:17,skills:39,errors:[]});
  const skills=copy(g.snapshot.skills),row=skills.find(s=>s.skillId==='ms_red_mark');
  row.effectJson='{"monsterSkill":{"trigger":"action","every":0,"actions":{}}}';
  g.x.seed(g.c.DB_SHEETS.SKILLS,skills);
  const before=g.x.writes.length;
  const report=g.c.validateMonsterSkillSheets();
  assert.equal(report.ok,false);assert.ok(report.errors.some(e=>e.includes('every')));
  assert.equal(g.x.writes.length,before);
});

test('monster pack: changing Skills.hitCount and attackEffect changes the actual packet count and visuals',()=>{
  for(const mode of ['server','browser']){
    const g=setup('monster_Pigeon',mode),skill=g.snapshot.skills.find(s=>s.skillId==='ms_double_peck');
    skill.hitCount=4;skill.attackEffect='fire';
    g.x.seed(g.c.DB_SHEETS.SKILLS,g.snapshot.skills);g.c.clearMasterTableCaches_();
    g.monster.criticalRate=0;g.action();g.action();g.action();
    const events=g.battle.lastTurnEvents.filter(e=>e.skillId==='ms_double_peck');
    assert.equal(events.length,4);assert.ok(events.every(e=>e.attackEffect==='fire'));
  }
});

test('monster pack: a blocked monster preserves its charged attack and independent action clock',()=>{
  const g=setup('monster_Outdoor');
  g.action();assert.equal(g.monster.monsterKit.actions,1);
  g.monster.intent=g.intent();
  g.c.applyEffect(g.monster,{effectId:'debuff_stun',category:'debuff',statKey:'action',effectType:'control',durationType:'turn',durationTurns:1},{turn:1});
  g.c.applyMonsterTurn(g.battle);
  assert.equal(g.monster.monsterKit.actions,1);
  assert.equal(g.monster.monsterKit.charging.remaining,0);
});

test('monster pack: actual browser pass-turn flow uses common charge, release, rest and intent UI',()=>{
  const g=setup('monster_Outdoor','browser');g.monster.criticalRate=0;g.monster.intent=g.intent();
  const ui=vm.createContext({
    window:{LearningRpgLocalRunEngine:g.engine},localGameDataSnapshot:g.snapshot,
    currentView:{battle:copy(g.battle),monsterAiRules:copy(pack.MonsterAI)},
    hasLocalBattleSkillEngine:()=>true,RULE_ENGINE_SHARED:g.c.getSharedRuleEngine_(),
    captureClientMonsterScoreSnapshot:()=>({}),normalizeClientActionPoints:()=>{},
    getFirstAliveMonster:b=>b.monsters.find(m=>m.currentHp>0),
    applyClientTimedEffectDamage:()=>{},recordClientMonsterScoreContribution:()=>0,
    refreshClientSkillAvailabilityForLocks:()=>{},decrementClientSkillCooldowns:()=>{},
    normalizeBattleView:v=>v,syncClientStatusBuckets:m=>g.c.getSharedRuleEngine_().syncStatusBuckets(m),
    getActionIntentIconUrl:()=>'',escapeHtml:v=>String(v),
  });
  const html=fs.readFileSync('Battle.html','utf8');
  for(const name of ['buildClientPassTurnView','assignClientMonsterIntents','buildClientMonsterIntent','renderMonsterIntent','intentIconLabel']){
    vm.runInContext(html.match(new RegExp('^    function '+name+'\\([^]*?^    \\}', 'm'))[0],ui);
  }
  assert.match(ui.renderMonsterIntent(ui.currentView.battle.monsters[0].intent),/준비/);
  ui.currentView=ui.buildClientPassTurnView();
  assert.equal(ui.currentView.battle.player.hp,10000);
  assert.equal(ui.currentView.battle.monsters[0].intent.phase,'release');
  ui.currentView=ui.buildClientPassTurnView();
  assert.equal(ui.currentView.battle.player.hp,9968);
  assert.match(ui.renderMonsterIntent(ui.currentView.battle.monsters[0].intent),/휴식/);
  ui.currentView=ui.buildClientPassTurnView();
  assert.equal(ui.currentView.battle.player.hp,9968);
});
