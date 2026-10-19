const test=require('node:test'),assert=require('node:assert/strict'),vm=require('node:vm');
const {context,copy}=require('./run-session.test.cjs');
const pack=require('../scripts/build-shock-pack.cjs'),old=require('./fixtures/skill-rework-2026-10-17.json');
function game(mode='server'){
  const x=context(),c=x.c,ids=pack.effects.map(e=>e.effectId);
  const definitions=old.effects.filter(e=>!ids.includes(e.effectId)).concat(pack.effects);
  const rules=old.effectRules.filter(r=>!ids.includes(r.effectId)).concat(pack.effectRules);
  x.seed(c.DB_SHEETS.SKILLS,pack.skills);x.seed(c.DB_SHEETS.EFFECTS,definitions);x.seed(c.DB_SHEETS.EFFECT_RULES,rules);c.Math.random=()=>.4;
  const snapshot={skills:pack.skills,effects:copy(c.readTable_(c.DB_SHEETS.EFFECTS)),effectRules:rules};
  const local=vm.runInNewContext(c.getLocalRunEngineSource_(),{Date:c.Date,Math:c.Math}),engine=c.getSharedRuleEngine_();
  const stats={hp:100,attack:20,defense:10,evasion:0,accuracy:100,criticalRate:0,criticalDamage:150};
  const b={battleId:'shock',runId:'r',status:'active',turn:1,suppressMonsterScoreBookkeeping:true,skillCooldowns:{},skillUseCounts:{},lastTurnEvents:[],
    player:{hp:100,maxHp:100,shield:0,baseStats:{...stats},stats:{...stats},effects:[],items:[],baseMaxActionPoint:3,maxActionPoint:3,currentActionPoint:3,nextTurnActionPointDelta:0,turnActionPointBonus:0},
    monsters:['a','b','c'].map(instanceId=>({instanceId,monsterId:instanceId,name:instanceId,hp:1000,currentHp:1000,maxHp:1000,shield:0,attack:20,defense:0,evasion:0,accuracy:100,effects:[],experience:0}))};
  const use=(n,level=1)=>{const skill={...c.hydrateSkill_(pack.skills[n-1],level),targetId:'a'};return mode==='server'?c.applySkillEffect(b,skill,1,true):local.skill(snapshot,b,skill,'a',1,true);};
  const shock=(target,count)=>engine.applyEffect(target,{...snapshot.effects.find(e=>e.effectId==='effect_v2_shock'),stacks:count},{},b.turn);
  const stacks=target=>engine.effectStacks(target,'effect_v2_shock');
  const damage=(amount,kind='direct',extra={})=>mode==='server'?c.dealDamageToMonster_(b,b.monsters[0],amount,{damageKind:kind,...extra}):local.damage(snapshot,b,'a',amount,{damageKind:kind,...extra});
  const incoming=(amount,target=b.monsters[0])=>mode==='server'?c.dealDamageToPlayer_(b,amount,target):local.playerDamage(snapshot,b,amount,target);
  const trigger=(timing,payload={})=>mode==='server'?c.processSkillTriggers_(b,timing,payload):local.trigger(snapshot,b,timing,payload);
  const end=()=>{if(mode==='server')c.tickEffectsAtTurnEnd(b);else local.tick(snapshot,b,'turnEnd');b.turn++;if(mode==='server')c.tickEffectsAtTurnStart(b);else local.tick(snapshot,b,'turnStart');};
  return {x,c,b,p:b.player,a:b.monsters[0],snapshot,engine,use,shock,stacks,damage,incoming,trigger,end};
}
for(const mode of ['server','browser']){
 test(`shock ${mode}: twelve skills execute at levels 1 and 3 without warnings`,()=>{
   for(let n=1;n<=12;n++)for(const level of [1,3]){const g=game(mode);g.shock(g.a,8);g.use(n,level);g.end();assert.deepEqual(copy(g.b.skillRuleWarnings||[]),[],pack.skills[n-1].name);}
 });
 test(`shock ${mode}: direct-only current-attack damage, one stack consumed, no accuracy penalty or natural decay`,()=>{
   const g=game(mode);g.shock(g.a,5);assert.equal(g.engine.getEffectiveStat(g.a,'accuracy'),100);
   g.damage(10);assert.equal(g.a.currentHp,986);assert.equal(g.stacks(g.a),4);
   for(const kind of ['additional','dot','reflect','counter','effect'])g.damage(1,kind);
   assert.equal(g.stacks(g.a),4);g.damage(0);assert.equal(g.stacks(g.a),4);
   g.p.stats.attack=40;g.damage(10);assert.equal(g.a.currentHp,965);assert.equal(g.stacks(g.a),3);
   g.end();assert.equal(g.stacks(g.a),3);
   const shield=game(mode);shield.shock(shield.a,2);shield.a.shield=100;shield.damage(10,'direct',{fixedDamage:true,bypassShield:true});
   assert.equal(shield.a.currentHp,990);assert.equal(shield.a.shield,96);assert.equal(shield.stacks(shield.a),1);
 });
 test(`shock ${mode}: sheet formula controls additional damage`,()=>{
   const g=game(mode);g.shock(g.a,2);g.a.effects[0].rules.find(r=>r.operation==='directHitDamage').valueFormula='10+0.5*attack';
   g.damage(1);assert.equal(g.a.currentHp,979);assert.equal(g.stacks(g.a),1);
 });
 test(`shock ${mode}: static grant happens after hit and conductor expires after three turns`,()=>{
   const g=game(mode);g.use(1);assert.equal(g.a.currentHp,982);assert.equal(g.stacks(g.a),4);
   g.use(2);assert.equal(g.a.currentHp,953);assert.equal(g.stacks(g.a),3);
   g.use(1);assert.equal(g.stacks(g.a),8); // old 3 - direct trigger 1 + round(4*1.6)
   g.end();g.end();g.end();assert(!g.a.effects.some(e=>e.effectId==='effect_v2_shock_received'));
 });
 test(`shock ${mode}: insulator only mitigates shocked attackers and scales with level`,()=>{
   const g=game(mode);g.use(3);assert.equal(g.p.shield,18);g.shock(g.a,2);
   g.incoming(20);assert.equal(g.p.shield,3);g.incoming(20,g.b.monsters[1]);assert.equal(g.p.hp,83);
   const max=game(mode);max.use(3,30);max.shock(max.a,1);max.incoming(100);assert.equal(max.p.hp,100);
 });
 test(`shock ${mode}: rod waits until next turn and damages using pre-grant stacks exactly once`,()=>{
   const g=game(mode);g.shock(g.a,3);g.use(4);g.trigger('onTurnStart');assert.equal(g.a.currentHp,1000);assert.equal(g.stacks(g.a),3);
   g.end();assert.equal(g.a.currentHp,985);assert.equal(g.stacks(g.a),8);assert.equal(g.stacks(g.b.monsters[1]),5);
   g.end();assert.equal(g.a.currentHp,985);assert.equal(g.stacks(g.a),8);
 });
 test(`shock ${mode}: short circuit rejects clean targets and floors lost health after shock damage`,()=>{
   const g=game(mode);assert.throws(()=>g.use(5),/스택/);g.shock(g.a,1);g.a.currentHp=998;g.use(5);
   assert.equal(g.a.currentHp,970);assert.equal(g.stacks(g.a),10);
   const stun=game(mode);stun.shock(stun.a,3);stun.use(6);assert.equal(stun.stacks(stun.a),4);assert(stun.engine.hasActionBlock(stun.a));
   const no=game(mode);no.use(6);assert.equal(no.stacks(no.a),2);assert(!no.engine.hasActionBlock(no.a));
 });
 test(`shock ${mode}: rub doubles the next entire AOE application once and never normal damage skills`,()=>{
   const g=game(mode);g.use(7);g.damage(1);g.use(9);assert.deepEqual(g.b.monsters.map(g.stacks),[10,10,10]);
   g.use(9);assert.deepEqual(g.b.monsters.map(g.stacks),[14,14,14]);
   assert(!g.p.effects.some(e=>e.effectId==='effect_v2_shock_next_application'));
 });
 test(`shock ${mode}: leakage transfers remaining stacks to other enemies including no-shock recipients`,()=>{
   const g=game(mode);g.shock(g.a,6);g.use(8);assert.equal(g.stacks(g.a),0);assert.deepEqual(g.b.monsters.slice(1).map(g.stacks),[5,5]);
   assert.equal(g.a.currentHp,970);
 });
 test(`shock ${mode}: coat applies two stacks to shield attackers for three turns and not HP-only hits`,()=>{
   const g=game(mode);g.use(10);assert.equal(g.p.shield,24);g.incoming(4);assert.equal(g.stacks(g.a),2);
   g.p.shield=0;g.incoming(4);assert.equal(g.stacks(g.a),2);
   g.end();g.end();g.p.shield=10;g.incoming(1);assert.equal(g.stacks(g.a),4);
   g.end();g.p.shield=10;g.incoming(1);assert.equal(g.stacks(g.a),4);
 });
 test(`shock ${mode}: conductor consumes all stacks and energy converts selected stacks to shield`,()=>{
   const g=game(mode);g.shock(g.a,4);g.shock(g.b.monsters[1],2);g.use(11);
   assert.deepEqual(g.b.monsters.map(m=>m.currentHp),[973,992,1000]);assert.deepEqual(g.b.monsters.map(g.stacks),[0,0,0]);
   const energy=game(mode);energy.shock(energy.a,7);energy.use(12,3);assert.equal(energy.p.shield,42);assert.equal(energy.stacks(energy.a),0);assert.equal(energy.a.currentHp,1000);
 });
}
test('shock: all twelve skill states match server and browser',()=>{
 for(let n=1;n<=12;n++){const a=game(),b=game('browser');a.shock(a.a,6);b.shock(b.a,6);a.use(n,3);b.use(n,3);a.end();b.end();
 for(const key of ['player','monsters','lastTurnEvents'])assert.deepEqual(copy(a.b[key]),copy(b.b[key]),pack.skills[n-1].name+' '+key);}
});
