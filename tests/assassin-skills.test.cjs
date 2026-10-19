const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {context,copy}=require('./run-session.test.cjs');
const pack=require('../scripts/build-assassin-pack.cjs');
const defs=require('./fixtures/skill-rework-2026-10-17.json');

test('assassin: only persistent states own Effects rows; one-shot settings stay in Skills',()=>{
  assert.deepEqual(pack.effects.map(e=>e.effectId),[2,3,9,11,12,13,16,17,18].map(n=>'effect_v2_assassin_'+String(n).padStart(2,'0')));
  assert.equal(pack.effectRules.length,43);
  const ids=new Set(pack.effects.map(e=>e.effectId));
  assert.ok(pack.effectRules.every(r=>ids.has(r.effectId)));
  for(const n of [1,4,5,7,8,10,14]){
    const skill=pack.skills[n-1],rule=JSON.parse(skill.effectJson);
    assert.equal(rule.combat.effectRuleIds,undefined,skill.name);
    if(n===7)assert.equal(rule.combat.onEachHit[0].effectId,'effect_v2_accuracy_down');
    else assert.ok(rule.combat.effectRules,skill.name);
  }
  assert.deepEqual(pack,require('../docs/skill-packs/assassin-skills-2026-10-19.json'));
});

test('assassin: inline one-shot parameters remain sheet-authoritative in both engines',()=>{
  for(const mode of ['server','browser']){
    const g=game(mode),skills=copy(pack.skills);
    const opening=JSON.parse(skills[0].effectJson);opening.combat.effectRules.fullHealthDamageBonusPercentFormula='100';
    skills[0].effectJson=JSON.stringify(opening);
    g.x.seed(g.c.DB_SHEETS.SKILLS,skills);g.c.clearTableCache_(g.c.DB_SHEETS.SKILLS);g.snapshot.skills=skills;
    const skill={...g.c.hydrateSkill_(skills[0],1),targetId:'a'};
    if(mode==='server')g.c.applySkillEffect(g.b,skill,1,true);else g.local.skill(g.snapshot,g.b,skill,'a',1,true);
    assert.equal(g.a.currentHp,58);assert.equal(g.a.effects.length,0,'one-shot bonus creates no status');
  }
});
test('assassin: sheet parameters are authoritative in server and browser engines',()=>{
  for(const mode of ['server','browser']){
    const g=game(mode),rows=copy(defs.effectRules.concat(pack.effectRules));
    rows.find(r=>r.effectId==='effect_v2_assassin_02' && r.statKey==='evasion.valueFormula').valueFormula='70';
    g.x.seed(g.c.DB_SHEETS.EFFECT_RULES,rows);g.c.clearTableCache_(g.c.DB_SHEETS.EFFECT_RULES);g.snapshot.effectRules=rows;
    g.use(2);assert.equal(g.stats().evasion,85);
    assert.equal(g.p.effects[0].definitionEffectId,'effect_v2_assassin_02');
    const missing=game(mode);missing.x.seed(missing.c.DB_SHEETS.EFFECT_RULES,[]);missing.c.clearTableCache_(missing.c.DB_SHEETS.EFFECT_RULES);missing.snapshot.effectRules=[];
    assert.throws(()=>missing.use(2),/Missing combat EffectRules/);
  }
});
function game(mode='server') {
  const x=context(),c=x.c;
  x.seed(c.DB_SHEETS.SKILLS,pack.skills);x.seed(c.DB_SHEETS.EFFECTS,defs.effects.concat(pack.effects));x.seed(c.DB_SHEETS.EFFECT_RULES,defs.effectRules.concat(pack.effectRules));
  c.Math.random=()=>.4;
  const snapshot={skills:pack.skills,effects:copy(c.readTable_(c.DB_SHEETS.EFFECTS)),effectRules:defs.effectRules.concat(pack.effectRules)};
  const local=vm.runInNewContext(c.getLocalRunEngineSource_(),{Date:c.Date,Math:c.Math});
  const stats={hp:100,attack:20,defense:10,evasion:0,accuracy:100,criticalRate:0,criticalDamage:150};
  const b={battleId:'assassin',runId:'r',status:'active',turn:1,stage:{floor:1,stage:1},suppressMonsterScoreBookkeeping:true,
    skillCooldowns:{},skillUseCounts:{},experienceAwarded:{a:true,b:true},lastTurnEvents:[],player:{hp:50,maxHp:100,shield:0,stats:{...stats},baseStats:{...stats},effects:[],items:[],
      baseMaxActionPoint:3,maxActionPoint:3,currentActionPoint:2},
    monsters:['a','b'].map(instanceId=>({instanceId,monsterId:instanceId,name:instanceId,hp:100,currentHp:100,maxHp:100,shield:0,attack:10,defense:0,accuracy:100,evasion:0,effects:[],experience:0}))};
  const use=(n,level=1)=>{const s={...c.hydrateSkill_(pack.skills[n-1],level),targetId:'a'};return mode==='server'?c.applySkillEffect(b,s,1,true):local.skill(snapshot,b,s,'a',1,true);};
  const trigger=(timing,payload={})=>mode==='server'?c.processSkillTriggers_(b,timing,payload):local.trigger(snapshot,b,timing,payload);
  const incoming=(damage)=>mode==='server'?c.dealDamageToPlayer_(b,damage,b.monsters[0]):local.playerDamage(snapshot,b,damage,b.monsters[0]);
  const damage=(amount,id='a')=>mode==='server'?c.dealDamageToMonster_(b,b.monsters.find(m=>m.instanceId===id),amount,{damageKind:'direct'}):local.damage(snapshot,b,id,amount,{damageKind:'direct'});
  const end=()=>{if(mode==='server')c.tickEffectsAtTurnEnd(b);else local.tick(snapshot,b,'turnEnd');b.turn++;if(mode==='server')c.tickEffectsAtTurnStart(b);else local.tick(snapshot,b,'turnStart');};
  return {x,c,b,p:b.player,a:b.monsters[0],local,snapshot,use,trigger,incoming,damage,end,stats:()=>c.calculateEffectiveStats(b.player.stats,b.player.effects)};
}
test('assassin: all definitions produce identical browser/server effects and damage',()=>{
  for(let n=1;n<=18;n++){
    const a=game('server'),b=game('browser');a.use(n,3);b.use(n,3);
    for(const key of ['player','monsters','skillCooldowns','lastTurnEvents'])assert.deepEqual(copy(a.b[key]),copy(b.b[key]),pack.skills[n-1].name+' '+key);
  }
});

test('assassin: kill stat points survive validation and spending, with forged victim records rejected',()=>{
  const g=game();g.c.ensureLevelProgress_(g.p);g.a.currentHp=5;
  const run={runId:'r',statsJson:JSON.stringify(g.p.baseStats),skillsJson:JSON.stringify([{skillId:pack.skills[17].skillId,level:1}])};
  const before=copy(g.b);g.use(18);g.damage(10);
  assert.equal(g.p.baseStats.levelProgress.points,1);
  assert.equal(g.c.validateLevelStatsForCommit_(run,before,g.b),true);
  const choice=g.c.getLevelStatRewardChoices_(g.b)[0],previousStat=Number(g.p.baseStats[choice.targetId] || 0);
  g.c.applyLevelStatReward_(g.b,choice.rewardId);assert.equal(g.p.baseStats[choice.targetId],previousStat+choice.value);
  assert.equal(g.c.validateLevelStatsForCommit_(run,before,g.b),true);
  const bad=copy(g.b);bad.player.baseStats.levelProgress.assassinKills.fake={sourceSkillId:pack.skills[17].skillId,level:1};
  assert.throws(()=>g.c.validateLevelStatsForCommit_(run,before,bad),/처치/);
});
for(const mode of ['server','browser']){
  test(`assassin ${mode}: all 18 skills execute at levels 1 and 3 without rule warnings`,()=>{
    for(let n=1;n<=18;n++)for(const level of [1,3]){const g=game(mode);g.use(n,level);assert.deepEqual(copy(g.b.skillRuleWarnings || []),[],pack.skills[n-1].name);}
  });
  test(`assassin ${mode}: opening bonus, missing health scaling and fixed shield bypass`,()=>{
    const full=game(mode);full.use(1);assert.equal(full.a.currentHp,67);
    const hurt=game(mode);hurt.a.currentHp=80;hurt.use(1);assert.equal(hurt.a.currentHp,59);
    const last=game(mode);last.a.currentHp=50;last.use(4);assert.equal(last.a.currentHp,17);
    const fixed=game(mode);fixed.a.shield=100;fixed.use(5);assert.equal(fixed.a.currentHp,73);assert.equal(fixed.a.shield,100);
    const recoil=game(mode);recoil.p.shield=100;recoil.use(14);assert.equal(recoil.p.hp,42);assert.equal(recoil.p.shield,100);
  });
  test(`assassin ${mode}: dynamic unshielded evasion, two-turn counters and expiry`,()=>{
    const g=game(mode);g.use(2);assert.equal(g.stats().evasion,55);g.p.shield=5;g.incoming(0);assert.equal(g.stats().evasion,40);
    g.incoming(5);assert.equal(g.stats().evasion,55);g.end();assert.equal(g.stats().evasion,0);
    const counter=game(mode);counter.use(3);assert.equal(counter.stats().evasion,20);
    counter.trigger('onEvade',{actor:'player',target:counter.a,originalDamage:10});assert.equal(counter.a.currentHp,83);
    counter.end();assert.equal(counter.stats().evasion,20);counter.end();assert.equal(counter.stats().evasion,0);
  });
  test(`assassin ${mode}: shield from actual damage, blocked reflection and no reflection loop`,()=>{
    const g=game(mode);g.use(8);assert.equal(g.p.shield,19);
    const r=game(mode);r.use(9);assert.equal(r.p.shield,16);r.incoming(10);assert.equal(r.a.currentHp,89);assert.equal(r.p.hp,50);
    r.end();r.p.shield=20;r.incoming(10);assert.equal(r.a.currentHp,89);
  });
  test(`assassin ${mode}: low health extra hit, duel, stealth charges, and stun`,()=>{
    const g=game(mode);g.p.hp=49;g.use(10);assert.equal(g.a.currentHp,50);assert.equal(g.b.monsters[1].currentHp,50);
    const duel=game(mode);duel.use(11);duel.damage(10);assert.equal(duel.a.currentHp,85);duel.incoming(10);assert.equal(duel.p.hp,37);
    const stealth=game(mode);stealth.use(12);assert.equal(stealth.c.rollHit_({accuracy:100},stealth.stats()).hit,false);
    stealth.trigger('onEvade',{actor:'player',target:stealth.a,originalDamage:10});assert.equal(stealth.c.rollHit_({accuracy:100},stealth.stats()).hit,true);
    const choke=game(mode);choke.use(15);assert.ok(choke.c.getSharedRuleEngine_().hasActionBlock(choke.a));
  });
  test(`assassin ${mode}: glass cannon and max action points expire without permanent changes`,()=>{
    const g=game(mode);g.p.hp=100;g.use(13);assert.equal(g.p.maxHp,90);assert.equal(g.p.hp,90);assert.equal(g.stats().attack,25.5);
    g.use(13);assert.equal(g.p.maxHp,90,'recast replaces, never compounds');
    g.end();g.end();assert.equal(g.p.maxHp,90);g.end();assert.equal(g.p.maxHp,100);assert.equal(g.p.hp,90);assert.equal(g.stats().attack,20);
    const ap=game(mode);ap.use(17);assert.equal(ap.p.maxActionPoint,4);ap.p.assassinUnusedActionPoint=2;ap.p.currentActionPoint=0;
    ap.trigger('onBeforeMonsterTurn');assert.equal(ap.stats().evasion,26);ap.end();assert.equal(ap.stats().evasion,0);assert.equal(ap.p.maxActionPoint,4);
    ap.end();ap.end();assert.equal(ap.p.maxActionPoint,3);
  });
  test(`assassin ${mode}: rainbow only on next turn, last-hit reset, kill stats and overkill healing`,()=>{
    const r=game(mode);r.use(16);assert.equal(r.stats().evasion,0);r.trigger('onEvade',{actor:'player',target:r.a,originalDamage:10});assert.equal(r.a.currentHp,100);
    r.end();assert.equal(r.stats().evasion,30);r.trigger('onEvade',{actor:'player',target:r.a,originalDamage:10});assert.equal(r.a.currentHp,70);
    r.end();assert.equal(r.stats().evasion,0);
    const kill=game(mode);kill.use(18);kill.a.currentHp=5;kill.use(4);
    assert.equal(kill.p.baseStats.levelProgress.points,1);assert.equal(kill.p.hp,69);
    kill.c.setSkillCooldownAfterUse_(kill.b,kill.c.hydrateSkill_(pack.skills[3],1));assert.equal(kill.b.skillCooldowns[pack.skills[3].skillId],0);
    kill.trigger('onKill',{target:kill.a,overkill:100});assert.equal(kill.p.baseStats.levelProgress.points,1);assert.equal(kill.p.hp,69);
  });
}
