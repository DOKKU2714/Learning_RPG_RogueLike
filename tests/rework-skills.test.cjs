const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const {context,copy,start}=require('./run-session.test.cjs');
const pack=require('./fixtures/skill-rework-2026-10-17.json');
const clientSource=require('node:fs').readFileSync('Battle.html','utf8');
const fixtures={};
for(const mode of ['server','browser']){
 const x=context();x.seed(x.c.DB_SHEETS.SKILLS,pack.skills);x.seed(x.c.DB_SHEETS.EFFECTS,pack.effects);x.seed(x.c.DB_SHEETS.EFFECT_RULES,pack.effectRules);
 const effects=x.c.readTable_(x.c.DB_SHEETS.EFFECTS);
 const snapshot={skills:pack.skills,effects:copy(effects),effectRules:pack.effectRules};
 fixtures[mode]={x,effects,snapshot,local:vm.runInNewContext(x.c.getLocalRunEngineSource_(),{Date:x.c.Date,Math:x.c.Math})};
}
function setup(mode){
 const {x,effects,snapshot,local}=fixtures[mode];x.c.Math.random=()=>.4;
 const engine=x.c.getSharedRuleEngine_();
 const battle={battleId:'rework',status:'active',turn:1,suppressMonsterScoreBookkeeping:true,skillCooldowns:{},skillUseCounts:{},
  player:{hp:60,maxHp:100,shield:0,stats:{hp:100,attack:20,defense:10,accuracy:100,evasion:0,criticalRate:0,criticalDamage:150},effects:[],maxActionPoint:10,baseMaxActionPoint:10,currentActionPoint:3},
  monsters:['a','b','c'].map(instanceId=>({instanceId,monsterId:instanceId,name:instanceId,currentHp:1000,hp:1000,maxHp:1000,attack:10,defense:10,evasion:0,shield:0,effects:[]})),lastTurnEvents:[]};
 const s=(group,n)=>pack.skills.find(s=>s.skillId===`skill_v2_${group}_${String(n).padStart(2,'0')}`);
 const use=(group,n,level=1,options={})=>{const skill={...s(group,n),level,targetId:'a',...options};if(mode==='browser')local.skill(snapshot,battle,skill,skill.targetId,1,true);else x.c.applySkillEffect(battle,skill,1,true);return skill;};
 const apply=(id,stacks=1,target=battle.monsters[0])=>x.c.applyEffect(target,{...effects.find(e=>e.effectId==='effect_v2_'+id),stacks},{turn:battle.turn});
 const tick=timing=>{if(mode==='browser')local.tick(snapshot,battle,timing);else if(timing==='turnStart')x.c.tickEffectsAtTurnStart(battle);else if(timing==='turnEnd')x.c.tickEffectsAtTurnEnd(battle);else{x.c.processSkillTriggers_(battle,'onBeforeMonsterTurn',{});battle.monsters.filter(m=>m.currentHp>0).forEach(m=>x.c.applyMonsterBurnDamage_(m,battle));}};
 const event=(name,payload)=>mode==='browser'?local.trigger(snapshot,battle,name,payload):x.c.processSkillTriggers_(battle,name,payload);
 const incoming=(amount,target=battle.monsters[0],kind='direct')=>mode==='browser'?local.playerDamage(snapshot,battle,amount,target,{damageKind:kind}):x.c.dealDamageToPlayer_(battle,amount,target,{damageKind:kind});
 const direct=(amount=1,target=battle.monsters[0],critical=false)=>{engine.beginCombatAction(battle,null);return mode==='browser'?local.damage(snapshot,battle,target.instanceId,amount,{damageKind:'direct',isCritical:critical}):x.c.dealDamageToMonster_(battle,target,amount,{damageKind:'direct',isCritical:critical});};
 const stacks=(id,target=battle.monsters[0])=>engine.effectStacks(target,'effect_v2_'+id);
 const has=(id,target=battle.monsters[0])=>!!(target.effects || []).find(e=>e.effectId==='effect_v2_'+id);
 return {mode,x,local,snapshot,engine,battle,a:battle.monsters[0],b:battle.monsters[1],c:battle.monsters[2],p:battle.player,s,use,apply,tick,event,incoming,direct,stacks,has};
}
const cases={strike:[
 g=>{g.use('strike',1);assert.equal(g.a.currentHp,976);},
 g=>{g.x.c.combatChain_(g.battle).count=1;g.use('strike',2);assert.equal(g.a.currentHp,967);},
 g=>{g.x.c.combatChain_(g.battle).count=4;g.use('strike',3);assert.equal(g.a.currentHp,960);},
 g=>{g.a.shield=1000;g.use('strike',4);assert.equal(g.a.shield,952);assert.equal(g.a.currentHp,1000);},
 g=>{g.use('strike',5);assert.equal(g.battle.monsters.reduce((s,m)=>s+1000-m.currentHp,0),40);},
 g=>{g.use('strike',6);assert.equal(g.p.shield,18);g.use('strike',1);assert.equal(g.a.currentHp,970);},
 g=>{g.x.c.combatChain_(g.battle).count=2;g.use('strike',7);assert.equal(g.p.currentActionPoint,4);assert.match(g.x.c.checkCombatSkillConditions_(g.battle,g.s('strike',7),JSON.parse(g.s('strike',7).effectJson),g.a),/이미/);},
 g=>{g.battle.skillCooldowns.skill_v2_strike_11=2;g.use('strike',8,1,{cooldownTargetSkillId:'skill_v2_strike_11'});assert.equal(g.a.currentHp,982);assert.equal(g.battle.skillCooldowns.skill_v2_strike_11,1);},
 g=>{g.x.c.combatChain_(g.battle).total=5;g.use('strike',9);assert.equal(g.a.currentHp,940);},
 g=>{g.x.c.combatChain_(g.battle).distinct=['one','two','three'];g.use('strike',10);assert.equal(g.a.currentHp,919);assert.equal(g.x.c.combatChain_(g.battle).count,0);},
 g=>{g.use('strike',11);assert.equal(g.a.currentHp,974);assert.equal(g.a.effects.find(e=>e.effectId==='effect_v2_weak').value,-33);},
 g=>{g.use('strike',12);assert.deepEqual(g.battle.monsters.map(m=>m.currentHp),[978,978,978]);},
 g=>{g.use('strike',13);g.incoming(1);assert.equal(g.a.currentHp,973);g.incoming(1);assert.equal(g.a.currentHp,973);},
 g=>{g.x.c.combatChain_(g.battle).count=3;g.use('strike',14);g.battle.turn++;g.use('strike',3);assert.equal(g.a.currentHp,968);assert.equal(g.x.c.combatChain_(g.battle).stored,0);},
 g=>{g.x.c.combatChain_(g.battle).total=8;g.use('strike',15);assert.equal(g.a.currentHp,896);}
],assassin:[
 g=>{g.use('assassin',1);assert.equal(g.a.currentHp,955);},
 g=>{g.a.currentHp=200;g.use('assassin',2);assert.equal(g.a.currentHp,158);},
 g=>{g.p.hp=30;g.use('assassin',3);assert.equal(g.a.currentHp,948);},
 g=>{g.use('assassin',4);assert.equal(g.p.hp,55);assert.equal(g.a.currentHp,948);},
 g=>{g.use('assassin',5);assert.equal(g.a.currentHp,936);g.incoming(10);assert.equal(g.p.hp,47);},
 g=>{g.use('assassin',6);assert.equal(g.x.c.calculateEffectiveStats(g.p.stats,g.p.effects).evasion,40);},
 g=>{g.use('assassin',7);assert.equal(g.x.c.calculateEffectiveStats({accuracy:100},g.a.effects).accuracy,80);g.use('assassin',8);assert.equal(g.a.currentHp,965);},
 g=>{g.use('assassin',8);assert.equal(g.a.currentHp,974);assert.equal(g.x.c.calculateEffectiveStats(g.p.stats,g.p.effects).evasion,20);},
 g=>{g.use('assassin',9);g.event('onEvade',{actor:'monster',target:g.a,damageKind:'direct'});g.use('assassin',8);assert.equal(g.a.currentHp,958);},
 g=>{g.p.hp=30;g.a.currentHp=200;g.use('assassin',10);assert.equal(g.a.currentHp,92);},
 g=>{g.use('assassin',11);g.use('assassin',8);assert.equal(g.a.currentHp,964);g.incoming(10);assert.equal(g.p.hp,48);},
 g=>{g.a.evasion=100;g.use('assassin',12);assert.equal(g.a.currentHp,968);},
 g=>{g.use('assassin',13);assert.ok(g.battle.monsters.every(m=>g.x.c.calculateEffectiveStats({accuracy:100},m.effects).accuracy===75));assert.equal(g.x.c.calculateEffectiveStats(g.p.stats,g.p.effects).evasion,15);},
 g=>{g.p.shield=100;g.use('assassin',14);g.use('frost',6);assert.equal(g.p.shield,0);g.use('assassin',8);assert.equal(g.a.currentHp,953);},
 g=>{g.use('assassin',15);assert.equal(g.a.currentHp,932);assert.equal(g.p.hp,45);}
],burn:[
 g=>{g.use('burn',1);assert.equal(g.a.currentHp,990);assert.equal(g.stacks('burn'),2);},
 g=>{g.use('burn',2);assert.ok(g.battle.monsters.every(m=>m.currentHp===994&&g.stacks('burn',m)===1));},
 g=>{g.apply('burn',2);g.use('burn',3);assert.equal(g.stacks('burn'),5);},
 g=>{g.use('burn',4);assert.equal(g.stacks('burn'),1);assert.ok(g.has('fuse'));},
 g=>{g.apply('burn',7);g.use('burn',5);assert.deepEqual([g.stacks('burn'),g.stacks('burn',g.b),g.stacks('burn',g.c)],[7,3,3]);},
 g=>{g.apply('burn',2);g.apply('burn',1,g.b);g.use('burn',6);assert.equal(g.p.shield,12);assert.equal(g.stacks('burn'),1);},
 g=>{g.apply('burn',3);g.use('burn',7);g.tick('beforeMonsterTurn');assert.equal(g.a.currentHp,955);assert.equal(g.stacks('burn'),2);},
 g=>{g.apply('burn',4);g.use('burn',8);assert.equal(g.a.currentHp,955);assert.equal(g.stacks('burn'),1);},
 g=>{g.apply('burn',15);g.use('burn',9);assert.deepEqual(g.battle.monsters.map(m=>m.currentHp),[820,940,940]);assert.equal(g.stacks('burn'),0);},
 g=>{g.use('burn',10);g.a.currentHp=1;g.apply('burn',1);g.use('burn',8);assert.equal(g.stacks('burn',g.b),2);assert.equal(g.stacks('burn',g.c),2);},
 g=>{g.apply('burn',3);g.use('burn',11);g.tick('beforeMonsterTurn');assert.equal(g.a.currentHp,962);},
 g=>{g.use('burn',12);assert.equal(g.battle.monsters.reduce((s,m)=>s+g.stacks('burn',m),0),3);assert.equal(g.battle.monsters.reduce((s,m)=>s+1000-m.currentHp,0),24);},
 g=>{g.use('burn',13);for(let i=0;i<4;i++)g.tick('beforeMonsterTurn');assert.ok(g.battle.monsters.every(m=>m.currentHp===970));},
 g=>{g.use('burn',14);g.incoming(1);g.incoming(1);assert.equal(g.stacks('burn'),1);},
 g=>{g.apply('burn',4);g.use('burn',15);g.use('burn',8);assert.equal(g.stacks('burn'),4);}
],frost:[
 g=>{g.use('frost',1);assert.equal(g.a.currentHp,990);assert.equal(g.stacks('chill'),2);},
 g=>{g.use('frost',2);assert.ok(g.battle.monsters.every(m=>g.stacks('chill',m)===2));},
 g=>{g.use('frost',3);assert.equal(g.stacks('chill'),4);assert.ok(!g.has('freeze'));},
 g=>{g.use('frost',4);assert.equal(g.stacks('chill'),1);assert.equal(g.x.c.calculateEffectiveStats({accuracy:100},g.a.effects).accuracy,85);},
 g=>{g.apply('chill',3);g.use('frost',5);assert.equal(g.stacks('chill'),5);assert.ok(g.has('freeze'));},
 g=>{g.use('frost',6);assert.equal(g.p.shield,40);},
 g=>{g.use('frost',7);g.incoming(1);g.incoming(1);assert.equal(g.stacks('chill'),2);},
 g=>{g.apply('chill',5);g.use('frost',8);assert.ok(g.has('freeze'));assert.equal(g.stacks('chill'),8);},
 g=>{g.apply('chill',4);g.apply('freeze');g.use('frost',9);assert.equal(g.a.currentHp,932);assert.equal(g.stacks('chill'),4);assert.ok(!g.has('freeze'));},
 g=>{g.apply('chill',4);g.apply('freeze');g.use('frost',10);assert.equal(g.a.currentHp,980);assert.equal(g.stacks('chill',g.b),2);},
 g=>{g.battle.skillCooldowns.skill_v2_frost_06=3;g.use('frost',11,1,{cooldownTargetSkillId:'skill_v2_frost_06'});assert.equal(g.p.shield,20);assert.equal(g.battle.skillCooldowns.skill_v2_frost_06,2);},
 g=>{g.use('frost',12);assert.equal(g.p.shield,32);assert.ok(g.battle.monsters.every(m=>g.stacks('chill',m)===2));},
 g=>{g.use('frost',13);assert.equal(g.p.shield,70);assert.equal(g.p.currentActionPoint,0);assert.ok(g.engine.hasActionBlock(g.p));},
 g=>{g.use('frost',14);g.incoming(999);assert.equal(g.p.hp,60);assert.ok(g.engine.hasActionBlock(g.p));},
 g=>{g.apply('chill',4);g.use('frost',15);assert.ok(g.has('freeze'));assert.equal(g.stacks('chill',g.b),4);assert.equal(g.p.shield,25);}
],poison:[
 g=>{g.use('poison',1);assert.equal(g.a.currentHp,991);assert.equal(g.stacks('poison'),2);},
 g=>{g.use('poison',2);assert.equal(g.stacks('poison'),5);},
 g=>{g.use('poison',3);assert.ok(g.battle.monsters.every(m=>g.stacks('poison',m)===3));},
 g=>{g.apply('poison',10);g.use('poison',4);assert.equal(g.stacks('poison'),16);},
 g=>{g.apply('poison',7);g.use('poison',5);g.battle.turn++;g.tick('turnStart');assert.equal(g.a.currentHp,993);assert.equal(g.stacks('poison'),7);},
 g=>{g.apply('poison',20);g.use('poison',6);assert.equal(g.a.effects.find(e=>e.effectId==='effect_v2_weak').value,-30);},
 g=>{g.apply('poison',8);g.use('poison',7);assert.ok(g.engine.hasActionBlock(g.a));assert.equal(g.stacks('poison'),8);},
 g=>{g.apply('poison',7);g.apply('poison',98,g.b);g.use('poison',8,1,{secondaryTargetId:'b'});assert.equal(g.stacks('poison'),6);assert.equal(g.stacks('poison',g.b),99);},
 g=>{g.apply('poison',7);g.use('poison',9);assert.equal(g.p.hp,72);assert.equal(g.stacks('poison'),3);},
 g=>{g.apply('poison',7);g.use('poison',10);g.battle.turn++;g.tick('turnStart');assert.equal(g.a.currentHp,985);assert.equal(g.stacks('poison'),6);},
 g=>{g.apply('poison',7);g.use('poison',11);assert.equal(g.a.currentHp,993);assert.equal(g.stacks('poison'),6);},
 g=>{g.apply('poison',1);g.use('poison',12);g.battle.turn++;g.tick('turnStart');assert.equal(g.a.currentHp,999);assert.equal(g.stacks('poison'),3);assert.ok(!g.has('residual_poison'));},
 g=>{g.apply('poison',1);g.apply('poison',5,g.b);g.apply('poison',7,g.c);g.use('poison',13);assert.deepEqual([g.stacks('poison'),g.stacks('poison',g.b),g.stacks('poison',g.c)],[6,3,4]);},
 g=>{g.apply('poison',20);g.apply('poison',20,g.b);g.use('poison',14);assert.equal(g.p.shield,38);assert.equal(g.stacks('poison'),20);},
 g=>{g.apply('poison',7);g.use('poison',15);g.b.currentHp=600;g.c.currentHp=700;g.direct(1000);assert.equal(g.stacks('poison',g.b),4);assert.equal(g.stacks('poison',g.c),3);}
],luck:[
 g=>{g.use('luck',1);assert.equal(g.a.currentHp,988);assert.deepEqual(Array.from(g.battle.combatRuntime.prepared.rolls),[1]);},
 g=>{g.use('luck',2);assert.equal(g.a.currentHp,980);assert.deepEqual(Array.from(g.battle.combatRuntime.prepared.rolls),[3]);},
 g=>{g.use('luck',3);assert.equal(g.a.currentHp,981);},
 g=>{g.use('luck',4);for(let i=0;i<3;i++)assert.equal(g.x.c.prepareCombatHit_(g.battle,null,{criticalRate:0}).criticalRate,20);assert.equal(g.x.c.prepareCombatHit_(g.battle,null,{criticalRate:0}).criticalRate,0);},
 g=>{g.use('luck',5);g.use('luck',1);assert.equal(g.a.currentHp,992);},
 g=>{g.use('luck',6);g.use('luck',1);assert.equal(g.p.effects.find(e=>e.effectId==='effect_v2_bad_luck').badLuck,1);g.use('luck',1);assert.equal(g.battle.combatRuntime.prepared.rolls[0],2);},
 g=>{g.use('luck',7);assert.equal(g.p.shield,16);g.battle.turn++;g.tick('turnStart');assert.equal(g.p.shield,22);},
 g=>{g.use('luck',8);assert.equal(g.battle.combatRuntime.reward.currencyPercent,20);},
 g=>{g.use('luck',9);assert.equal(g.battle.combatRuntime.reward.extraChoices,1);},
 g=>{g.use('luck',10);g.direct(1,g.a,true);g.direct(1,g.a,true);assert.equal(g.battle.combatRuntime.reward.jackpot.hits,2);},
 g=>{g.use('luck',11);let values=[0,.99,0,0];g.x.c.Math.random=()=>values.shift()??0;g.use('luck',2);assert.equal(g.battle.combatRuntime.prepared.rolls[0],6);assert.ok(g.has('next_crit',g.p));},
 g=>{g.use('luck',12);for(let i=0;i<3;i++)g.direct(1);assert.equal(g.x.c.prepareCombatHit_(g.battle,null,{criticalRate:0}).criticalRate,30);g.direct(1,g.a,true);assert.equal(g.x.c.prepareCombatHit_(g.battle,null,{criticalRate:0}).criticalRate,0);},
 g=>{g.use('luck',13);assert.equal(g.a.currentHp,964);assert.deepEqual(Array.from(g.battle.combatRuntime.prepared.rolls),[3,3]);},
 g=>{g.use('luck',14);g.incoming(100);assert.equal(g.p.hp,1);g.incoming(1);assert.equal(g.p.hp,0);},
 g=>{g.use('luck',15);assert.equal(g.p.hp,48);g.use('luck',1);assert.equal(g.a.currentHp,978);}
],shock:[
 g=>{g.use('shock',1);assert.equal(g.a.currentHp,990);assert.equal(g.stacks('shock'),2);},
 g=>{g.use('shock',2);assert.equal(g.stacks('shock'),5);},
 g=>{g.use('shock',3);assert.ok(g.battle.monsters.every(m=>g.stacks('shock',m)===2));},
 g=>{g.apply('shock',10);g.use('shock',4);g.direct(1);assert.equal(g.a.currentHp,986);},
 g=>{g.apply('shock',5);g.use('shock',5);g.battle.turn++;g.tick('turnStart');assert.equal(g.stacks('shock'),7);g.battle.turn++;g.tick('turnStart');assert.equal(g.stacks('shock'),6);},
 g=>{g.apply('shock',6);g.use('shock',6);assert.ok(g.engine.hasActionBlock(g.a));assert.equal(g.stacks('shock'),6);},
 g=>{g.apply('stun');g.use('shock',7);assert.equal(g.a.currentHp,983);assert.equal(g.stacks('shock'),3);},
 g=>{g.a.shield=6;g.apply('shock',5);g.use('shock',8);g.direct(1);assert.equal(g.a.shield,0);assert.equal(g.a.currentHp,1000);},
 g=>{g.apply('shock',8);g.apply('shock',2,g.b);g.use('shock',9);g.direct(1);assert.equal(g.a.currentHp,991);assert.equal(g.b.currentHp,996);},
 g=>{g.apply('shock',5);g.use('shock',10);for(let i=0;i<6;i++)g.direct(1);assert.equal(g.a.currentHp,939);},
 g=>{g.a.shield=100;g.use('shock',11);assert.equal(g.a.shield,61);assert.equal(g.stacks('shock'),3);},
 g=>{g.apply('shock',8);g.use('shock',12);assert.deepEqual([g.stacks('shock'),g.stacks('shock',g.b),g.stacks('shock',g.c)],[2,3,3]);},
 g=>{g.use('shock',13);g.incoming(1);g.incoming(1);assert.equal(g.stacks('shock'),2);},
 g=>{g.apply('shock',4);g.apply('accuracy_down',1,g.p);g.use('shock',14);assert.equal(g.stacks('shock'),1);assert.equal(g.p.effects.filter(e=>e.category==='debuff').length,0);},
 g=>{g.apply('shock',8);g.apply('shock',7,g.b);g.c.stunImmune=true;g.apply('shock',8,g.c);g.use('shock',15);assert.ok(g.engine.hasActionBlock(g.a));assert.ok(!g.engine.hasActionBlock(g.b));assert.ok(!g.engine.hasActionBlock(g.c));assert.equal(g.stacks('shock',g.c),10);}
]};
for(const mode of ['server','browser'])for(const [group,checks] of Object.entries(cases))checks.forEach((check,index)=>{
 test(`rework 105: ${mode} ${group} ${String(index+1).padStart(2,'0')}`,()=>{
  const g=setup(mode);check(g);
  assert.ok(g.battle.monsters.every(m=>Number.isFinite(m.currentHp)&&m.currentHp>=0));
  assert.ok(!g.battle.lastTurnEvents.some(e=>e.type==='ruleWarning'),JSON.stringify(g.battle.lastTurnEvents.filter(e=>e.type==='ruleWarning')));
  assert.doesNotThrow(()=>JSON.parse(JSON.stringify(g.battle)));
 });
});

module.exports={setup};

for(const mode of ['server','browser']){
 test(`rework integration: ${mode} combined DOT and shock modifiers use additive rules`,()=>{
  const g=setup(mode);g.apply('burn',4);g.use('burn',7);g.use('burn',11);g.tick('beforeMonsterTurn');assert.equal(g.a.currentHp,930);
  const h=setup(mode);h.apply('shock',10);h.apply('shock',1,h.b);h.use('shock',4);h.use('shock',9);h.use('shock',10);h.direct(1);assert.equal(h.a.currentHp,976);assert.equal(h.b.currentHp,995);
 });
 test(`rework integration: ${mode} reroll compares final double-dice damage including level scaling`,()=>{
  const g=setup(mode);g.use('luck',11);let values=[0,0,0,.4,0,0];g.x.c.Math.random=()=>values.shift()??0;g.use('luck',13,20);assert.equal(g.a.currentHp,874);assert.deepEqual(Array.from(g.battle.combatRuntime.prepared.rolls),[1,1]);
 });
 test(`rework integration: ${mode} missed attacks do not apply per-hit stacks or break freeze`,()=>{
  const g=setup(mode);g.a.evasion=100;g.use('shock',1);assert.equal(g.stacks('shock'),0);assert.equal(g.a.currentHp,1000);g.apply('chill',5);g.apply('freeze');g.use('strike',1);assert.ok(g.has('freeze'));assert.equal(g.a.currentHp,1000);
 });
 test(`rework integration: ${mode} percentage costs round up and cleanse requires a debuff`,()=>{
  const g=setup(mode);g.p.hp=6;g.use('luck',15);assert.equal(g.p.hp,4);g.apply('shock',8);assert.throws(()=>g.use('shock',14),/디버프/);assert.equal(g.stacks('shock'),8);
 });
 test(`rework integration: ${mode} upgrade coefficients follow design at level three`,()=>{
  const expected={strike:{1:28,2:26,3:20,5:50,9:48,10:66,11:30,12:78},assassin:{1:57,2:32,3:37,4:62,5:78,8:32,12:40,15:84},burn:{1:14,2:24,12:30},frost:{1:14,5:22,9:46},poison:{1:11},luck:{1:16,2:24,3:25,13:48},shock:{1:14}};
  for(const [group,rows] of Object.entries(expected))for(const [n,damage] of Object.entries(rows)){
   const g=setup(mode);g.p.hp=100;g.use(group,Number(n),3);
   assert.equal(g.battle.monsters.reduce((sum,m)=>sum+1000-m.currentHp,0),damage,group+n);
  }
  for(const [group,n,shield] of [['strike',6,24],['strike',13,20],['burn',14,28],['frost',6,48],['frost',7,30],['frost',12,42],['frost',13,82],['frost',15,33],['shock',13,30]]){const g=setup(mode);g.use(group,n,3);assert.equal(g.p.shield,shield,group+n);}
  const g=setup(mode);g.apply('poison',4);g.use('poison',9,3);assert.equal(g.p.hp,80);
 });
 test(`rework integration: ${mode} timed buffs expire after their stated monster turns`,()=>{
  const g=setup(mode);g.use('assassin',6);g.tick('turnEnd');assert.equal(g.x.c.calculateEffectiveStats(g.p.stats,g.p.effects).evasion,0);
  g.use('frost',4);g.tick('turnEnd');assert.equal(g.x.c.calculateEffectiveStats({accuracy:100},g.a.effects).accuracy,85);g.battle.turn++;g.tick('turnEnd');assert.equal(g.x.c.calculateEffectiveStats({accuracy:100},g.a.effects).accuracy,100);
 });
 test(`rework integration: ${mode} consumed attack bonuses cover all hits of one action only`,()=>{
  const g=setup(mode);g.use('strike',6);g.use('strike',1);assert.equal(g.a.currentHp,970);g.use('strike',1);assert.equal(g.a.currentHp,946);
 });
 test(`rework integration: ${mode} re-ignition cannot put burn on a killed center`,()=>{
  const g=setup(mode);g.apply('burn',3);g.a.currentHp=1;g.use('burn',15);g.use('burn',8);assert.equal(g.stacks('burn'),0);assert.equal(g.a.currentHp,0);
 });
 test(`rework integration: ${mode} transferred stacks remain conserved across death and capacity`,()=>{
  const g=setup(mode);g.apply('poison',7);g.apply('poison',98,g.b);g.apply('poison',99,g.c);g.use('poison',15);g.direct(1000);assert.equal(g.stacks('poison',g.b),99);assert.equal(g.stacks('poison'),0);assert.equal(g.stacks('poison',g.c),99);
 });
 test(`rework integration: ${mode} shield-only additions never spill into HP`,()=>{
  const g=setup(mode);g.a.shield=5;g.use('strike',4);assert.equal(g.a.currentHp,972); // 33 normal damage less the 5 shield; the extra 15 cannot overflow.
 });
 test(`rework integration: ${mode} fractional stun immunity does not prevent status stacks`,()=>{
  const g=setup(mode);g.a.controlImmune=true;g.apply('chill',3);g.use('frost',5);assert.equal(g.stacks('chill'),5);assert.ok(!g.engine.hasActionBlock(g.a));
 });
}

test('rework integration: conditions reject costs, missing stacks and missing choices before damage',()=>{
 const g=setup('server');g.p.hp=5;assert.throws(()=>g.use('assassin',4),/체력/);assert.equal(g.a.currentHp,1000);assert.equal(g.p.hp,5);
 assert.throws(()=>g.use('shock',6),/스택/);assert.equal(g.a.currentHp,1000);
 g.p.hp=60;g.apply('poison',5);assert.throws(()=>g.use('poison',8),/보조 대상/);assert.equal(g.stacks('poison'),5);
 g.battle.skillCooldowns={skill_v2_strike_01:2,skill_v2_strike_02:2};assert.throws(()=>g.use('strike',8),/선택/);assert.equal(g.a.currentHp,1000);
});

test('rework integration: only upgradeable definitions can enter upgrade rewards',()=>{
 const g=setup('server');for(const s of pack.skills)assert.equal(g.x.c.isSkillUpgradable_(s),s.upgradeDesign!=='강화 불가.',s.name);
 assert.equal(pack.skills.filter(s=>s.rewardEnabled===1 && s.effectJson).length,105);
});

test('rework integration: random previews enumerate both dice, doubles and upgrades without rolling',()=>{
 const g=setup('server');
 for(const [n,level,expected] of [[1,1,{min:12,max:32}],[2,1,{min:8,max:38}],[13,1,{min:12,max:72}],[13,3,{min:20,max:84}]]){
  const skill={...g.s('luck',n),level},rule=JSON.parse(skill.effectJson),ctx=g.x.c.buildSkillFormulaContext_(g.battle,skill,g.a,1);
  assert.deepEqual(copy(g.engine.randomDamageRange(rule,ctx)),expected);
  assert.match(g.x.c.buildSkillRulePreviewText_(skill,g.battle,rule),new RegExp(expected.min+'-'+expected.max));
 }
});

test('rework integration: reward bonuses are stable, additive once, capped at legendary and preserve other concepts',()=>{
 const g=setup('server');g.use('luck',8);g.use('luck',9);g.use('luck',10);g.direct(1,g.a,true);g.direct(1,g.a,true);g.battle.status='victory';
 const initial={currencyAmount:10,choices:[g.x.c.buildAutoSkillReward_(g.s('strike',1)),g.x.c.buildAutoSkillReward_(g.s('burn',1)),g.x.c.buildAutoSkillReward_(g.s('poison',1))]};
 const view=copy(initial);g.x.c.applyCombatRewardBonuses_(view,g.battle,[],[]);assert.equal(view.choices.length,4);assert.equal(view.currencyAmount,12);assert.ok(view.combatJackpotApplied);
 const again=copy(initial);g.x.c.applyCombatRewardBonuses_(again,g.battle,[],[]);assert.deepEqual(copy(again),copy(view));
 const ids=view.choices.map(c=>c.rewardId);g.x.c.applyCombatRewardBonuses_(view,g.battle,[],[]);assert.deepEqual(view.choices.map(c=>c.rewardId),ids);assert.equal(view.currencyAmount,12);
 assert.ok(view.choices.every(c=>c.rarity!=='unique'));
 const weights=[];g.x.c.pickWeighted_=(pool,w)=>{weights.push(...w);return pool[0];};g.x.c.pickSkillWithAffinity_([g.s('strike',1),g.s('burn',1)],[{skillId:g.s('strike',2).skillId}],{});assert.deepEqual(Array.from(weights),[1.5,1]);
});

test('rework integration: late luck skills update prepared rewards and settle identically after signed replay',()=>{
 const x=context();x.seed(x.c.DB_SHEETS.SKILLS,pack.skills);x.seed(x.c.DB_SHEETS.EFFECTS,pack.effects);x.seed(x.c.DB_SHEETS.EFFECT_RULES,pack.effectRules);
 const first=start(x),engine=vm.runInNewContext(x.c.getLocalRunEngineSource_(),{Date:x.c.Date,Math:x.c.Math});
 let payload={runId:first.runId,runSessionToken:first.runSessionToken,localAdvanceEnabled:true,localTransitions:[],battle:copy(first.battle),stageState:copy(first.stageState),answerLogs:[]};
 const plan=x.c.prepareRewardChoicesDuringBattle(payload,'auth');payload.runSessionToken=plan.runSessionToken;const run=copy(plan.localRunState);
 for(const n of [8,9,10]){const skill=pack.skills.find(s=>s.skillId===`skill_v2_luck_${String(n).padStart(2,'0')}`);engine.skill(first.gameDataSnapshot,payload.battle,{...skill,level:1},'',1,true);}
 engine.trigger(first.gameDataSnapshot,payload.battle,'onCritical',{actor:'player',target:payload.battle.monsters[0],damageKind:'direct'});
 engine.trigger(first.gameDataSnapshot,payload.battle,'onCritical',{actor:'player',target:payload.battle.monsters[0],damageKind:'direct'});
 payload.battle.status='victory';payload.battle.monsters.forEach(m=>{m.currentHp=0;m.hp=0;});payload.rewardPreparationToken=plan.rewardPreparationToken;x.tick(5000);
 const local=engine.reward(run,first.gameDataSnapshot,copy(payload),plan);
 const server=x.c.previewRewardChoicesForStageResult(payload,'auth');
 assert.equal(server.choices.length,4);assert.equal(server.currencyAmount,Math.round(plan.currencyAmount*1.2));assert.ok(server.combatJackpotApplied);
 assert.deepEqual(copy(local.choices),copy(server.choices));assert.equal(local.currencyAmount,server.currencyAmount);
 payload.stageState.reward=copy(server);const choice=server.choices[3],selectedAtMs=x.c.Date.now();
 const result=engine.advance(server.localRunState,first.gameDataSnapshot,payload,choice.rewardId,server,{selectedAtMs});
 const replayed=x.c.withRunSession_(run.runId,server.runSessionToken,'auth',()=>{x.c.replayLocalRunTransitions_([{payload:copy(payload),rewardId:choice.rewardId,rewardToken:server.localTransitionToken,selectedAtMs}],'auth');return copy(x.c.requireRun_(run.runId));});
 assert.equal(result.localRunState.currency,replayed.currency);assert.equal(replayed.currency,Number(run.currency || 0)+server.currencyAmount);
});

for (const mode of ['server','browser']) {
 test(mode + ': shock damage plays immediately after its original skill hit',()=>{
  const g=setup(mode);g.apply('shock',3);g.battle.lastTurnEvents=[];
  g.use('strike',1);
  const events=g.battle.lastTurnEvents;
  const hit=events.findIndex(e=>e.actor==='player' && e.damage>0);
  const shock=events.findIndex(e=>e.effectId==='effect_v2_shock' && e.damageKind==='additional');
  assert.ok(hit>=0);assert.equal(shock,hit+1);
 });
 test(mode + ': electronic barrier reacts after the blocked monster attack',()=>{
  const g=setup(mode);g.use('shock',13);g.battle.lastTurnEvents=[];
  const intent={actionType:'attack',type:'attack'};
  if(mode==='server')g.x.c.applyMonsterAttackIntent_(g.battle,g.a,intent);
  else {
   const result=g.incoming(10);
   g.battle.lastTurnEvents.splice(result.eventIndex,0,{actor:'monster',type:'attack',...result});
  }
  const events=g.battle.lastTurnEvents;
  const hit=events.findIndex(e=>e.actor==='monster' && e.shieldDamage>0);
  const reaction=events.findIndex(e=>e.skillId==='skill_v2_shock_13' && e.type==='debuff');
  assert.ok(hit>=0);assert.ok(reaction>hit);
 });
}

for (const mode of ['server','browser']) {
 test(mode + ': onDamaged recovery plays immediately after incoming HP damage',()=>{
  const g=setup(mode);
  g.battle.activeTriggers=[{timing:'onDamaged',sourceSkillId:'test_damage_recovery',sourceSkillName:'피격 회복',rule:{actions:[{operation:'heal',target:'self',amount:3}]},durationType:'battle'}];
  g.battle.lastTurnEvents=[];
  if(mode==='server')g.x.c.applyMonsterAttackIntent_(g.battle,g.a,{actionType:'attack',type:'attack'});
  else {
   const result=g.incoming(10);
   g.battle.lastTurnEvents.splice(result.eventIndex,0,{actor:'monster',type:'attack',...result});
  }
  const events=g.battle.lastTurnEvents;
  const hit=events.findIndex(e=>e.actor==='monster' && e.hpDamage>0);
  const reaction=events.findIndex(e=>e.type==='heal');
  assert.ok(hit>=0);assert.equal(reaction,hit+1);
  assert.equal(g.p.hp,53);
 });
 test(mode + ': fully blocked hits do not trigger onDamaged',()=>{
  const g=setup(mode);g.p.shield=20;
  g.battle.activeTriggers=[{timing:'onDamaged',sourceSkillId:'test_damage_recovery',rule:{actions:[{operation:'heal',target:'self',amount:3}]},durationType:'battle'}];
  g.incoming(10);
  assert.equal(g.p.hp,60);
  assert.ok(!g.battle.lastTurnEvents.some(e=>e.type==='heal'));
 });
}

for(const mode of ['server','browser'])for(const solo of [false,true])test(mode+': leakage relays full shock to all others or once to a lone target: '+solo,()=>{
 const g=setup(mode);g.apply('shock',3);g.use('shock',9);
 const leakage=g.a.effects.find(e=>e.effectId==='effect_v2_leakage');
 leakage.behavior={combat:{relay:{effectId:'effect_v2_shock',ratio:1,requireOtherEffect:false,allOthers:true,sameTargetIfAlone:true,useAppliedDamage:true}}};
 if(solo){g.b.currentHp=0;g.c.currentHp=0;}
 g.direct(1);
 assert.equal(g.a.currentHp,solo?993:996);
 if(!solo){assert.equal(g.b.currentHp,997);assert.equal(g.c.currentHp,997);}
});

for(const mode of ['server','browser'])test(mode+': status and damage events carry elemental IDs for dedicated playback',()=>{
 const g=setup(mode);
 g.battle.activeTriggers=[{timing:'onHit',sourceSkillId:'element_test',sourceSkillName:'상태 연출',durationType:'battle',rule:{actions:[
  {operation:'applyEffect',target:'enemy',effectId:'effect_v2_chill',stacks:2},
  {operation:'applyEffect',target:'enemy',effectId:'effect_v2_freeze',stacks:1},
  {operation:'damage',effectId:'effect_v2_poison',damageKind:'dot',amount:2}
 ]}}];
 g.event('onHit',{actor:'player',target:g.a,damageKind:'direct'});
 const events=g.battle.lastTurnEvents;
 for(const id of ['effect_v2_chill','effect_v2_freeze','effect_v2_poison'])assert.ok(events.some(e=>e.effectId===id),id);
 assert.equal(events.find(e=>e.effectId==='effect_v2_poison').damageKind,'dot');
});

for(const mode of ['server','browser'])for(const kind of ['normal','critical','miss'])test(mode+': golden touch remake heals from its hit only: '+kind,()=>{
 const g=setup(mode);g.p.hp=40;
 if(kind==='critical')g.p.stats.criticalRate=100;
 if(kind==='miss'){g.p.stats.accuracy=0;g.a.evasion=100;}
 const skill={...g.s('luck',8),level:1,type:'damage',target:'enemy',cooldown:3,conditionJson:'{"notUpgradable":true}',effectJson:JSON.stringify({targetMode:'singleEnemy',damageFormula:'attack*0.8+2',combat:{criticalChanceAdd:20},healFromDamagePercentFormula:'50'}),targetId:'a'};
 if(mode==='browser')g.local.skill({...g.snapshot,skills:g.snapshot.skills.map(s=>s.skillId===skill.skillId?skill:s)},g.battle,skill,'a',1,true);else g.x.c.applySkillEffect(g.battle,skill,1,true);
 assert.equal(g.p.hp,kind==='normal'?49:kind==='critical'?54:40);
 assert.equal(g.a.currentHp,kind==='normal'?982:kind==='critical'?973:1000);
});

test('coffin UI immediately ends the current turn, skips one owned turn, then thaws and heals',()=>{
 const g=setup('browser');g.battle.monsters=[g.a];g.a.intent={actionType:'guard',value:1};g.use('frost',13);
 const view={battle:g.battle,availableSkills:[],score:0};
 const ui=vm.createContext({currentView:view,window:{LearningRpgLocalRunEngine:g.local},localGameDataSnapshot:g.snapshot,RULE_ENGINE_SHARED:g.engine,
  normalizeClientActionPoints(){},normalizeBattleView:v=>v,captureClientMonsterScoreSnapshot:()=>({}),recordClientMonsterScoreContribution:()=>0,
  getFirstAliveMonster:b=>b.monsters.find(m=>m.currentHp>0),hasClientEffect:()=>false,getClientIntentValue:i=>i.value,
  applyClientTimedEffectDamage(){},calculateClientMonsterGuardShield:()=>1,
  assignClientMonsterIntents(b){b.monsters.forEach(m=>m.intent={actionType:'guard',value:1});},refreshClientSkillAvailabilityForLocks(){}});
 for(const name of ['hasLocalBattleSkillEngine','buildClientPassTurnView','decrementClientSkillCooldowns','advanceClientBlockedTurns'])
  vm.runInContext(clientSource.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0],ui);
 const result=ui.advanceClientBlockedTurns(view);
 assert.equal(result.battle.turn,3);assert.equal(g.engine.hasActionBlock(result.battle.player),false);
 assert.equal(result.battle.player.hp,68);assert.equal(result.battle.player.shield,0);
 assert.equal(result.battle.player.currentActionPoint,10);
 assert.equal(result.battle.lastTurnEvents.filter(e=>e.actor==='monster').length,2);
 assert.ok(result.battle.lastTurnEvents.some(e=>e.type==='guard' && /빙하의 관/.test(e.message)));
 const textUi=vm.createContext({getSkillDisplayMetrics:()=>({shield:82})});
 vm.runInContext(clientSource.match(/    function buildSkillDetailDescription\([^]*?\n    \}/)[0],textUi);
 const description=textUi.buildSkillDetailDescription({...g.s('frost',13),level:3,description:''});
 assert.match(description,/82/);assert.match(description,/30%/);assert.match(description,/즉시 턴을 종료/);
});
