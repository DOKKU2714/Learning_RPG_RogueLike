const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {context,copy}=require('./run-session.test.cjs');
const normal=require('../docs/skill-packs/normal-skills-2026-10-18.json');
const original=require('./fixtures/skill-rework-2026-10-17.json');

function game(mode){
 const x=context();
 const skills=[...original.skills,...normal.skills],effects=[...original.effects,...normal.effects],effectRules=[...original.effectRules,...normal.effectRules];
 x.seed(x.c.DB_SHEETS.SKILLS,skills);x.seed(x.c.DB_SHEETS.EFFECTS,effects);x.seed(x.c.DB_SHEETS.EFFECT_RULES,effectRules);
 x.c.Math.random=()=>.4;
 const local=vm.runInNewContext(x.c.getLocalRunEngineSource_(),{Date:x.c.Date,Math:x.c.Math});
 const snapshot={skills,effects:copy(x.c.readTable_(x.c.DB_SHEETS.EFFECTS)),effectRules};
 const stats={hp:100,attack:20,defense:10,accuracy:100,evasion:0,criticalRate:0,criticalDamage:150};
 const battle={battleId:'normal-skills',status:'active',turn:1,suppressMonsterScoreBookkeeping:true,skillCooldowns:{},skillUseCounts:{},
  player:{hp:60,maxHp:100,shield:0,baseStats:{...stats},stats:{...stats},effects:[],items:[],baseMaxActionPoint:3,maxActionPoint:3,currentActionPoint:3},
  monsters:['a','b','c'].map(instanceId=>({instanceId,monsterId:instanceId,name:instanceId,hp:1000,currentHp:1000,maxHp:1000,attack:10,defense:10,accuracy:100,evasion:0,shield:0,effects:[]})),lastTurnEvents:[]};
 const engine=x.c.getSharedRuleEngine_();
 const skill=n=>({...normal.skills[n-1],level:1,targetId:'a'});
 const use=(n,extra={})=>{const s={...skill(n),...extra};return mode==='browser'?local.skill(snapshot,battle,s,'a',1,true):x.c.applySkillEffect(battle,s,1,true);};
 const tick=timing=>mode==='browser'?local.tick(snapshot,battle,timing):timing==='turnStart'?(x.c.normalizePlayerActionPoints_(battle,true),x.c.tickEffectsAtTurnStart(battle)):x.c.tickEffectsAtTurnEnd(battle);
 const damage=(amount,id)=>mode==='browser'?local.damage(snapshot,battle,'a',amount,{damageKind:'direct',sourceSkillId:id}):x.c.dealDamageToMonster_(battle,battle.monsters[0],amount,{damageKind:'direct',sourceSkillId:id});
 return {x,local,snapshot,battle,p:battle.player,a:battle.monsters[0],engine,skill,use,tick,damage};
}

const checks=[
 g=>{g.p.stats.accuracy=30;g.use(1);assert.equal(g.a.currentHp,976);assert.equal(g.p.stats.accuracy,30);},
 g=>{g.use(2);assert.equal(g.a.currentHp,963);},
 g=>{g.use(3);assert.ok(g.battle.monsters.every(m=>m.currentHp===984));},
 g=>{g.use(4);assert.equal(g.p.shield,18);},
 g=>{g.use(5);assert.equal(g.p.shield,27);},
 g=>{g.use(6);assert.equal(g.p.hp,70);},
 g=>{g.use(7);g.damage(20,'');assert.equal(g.a.currentHp,980);g.use(1);assert.equal(g.a.currentHp,948);assert.ok(!g.p.effects.some(e=>e.effectId==='effect_normal_attack_ready'));},
 g=>{g.use(8);assert.equal(g.engine.calculateEffectiveStats(g.p.stats,g.p.effects).evasion,35);g.tick('turnEnd');assert.ok(!g.p.effects.some(e=>e.effectId==='effect_normal_cautious'));},
 g=>{g.battle.skillCooldowns={skill_normal_01:3,skill_normal_10:5};g.use(9,{cooldownTargetSkillId:'skill_normal_01'});assert.equal(g.battle.skillCooldowns.skill_normal_01,2);assert.equal(g.battle.skillCooldowns.skill_normal_10,5);},
 g=>{g.battle.skillCooldowns={skill_normal_01:3,skill_normal_02:4,skill_normal_09:5};g.use(10);assert.equal(g.battle.skillCooldowns.skill_normal_01,2);assert.equal(g.battle.skillCooldowns.skill_normal_02,3);assert.equal(g.battle.skillCooldowns.skill_normal_09,5);},
 g=>{g.use(11);assert.equal(g.engine.getQuestionEfficiencyBonusPercent(g.p.effects),10);g.engine.consumeQuestionEffects(g.p);assert.equal(g.engine.getQuestionEfficiencyBonusPercent(g.p.effects),0);},
 g=>{g.use(12);assert.equal(g.engine.getQuestionMinEfficiencyBonusPercent(g.p.effects),10);g.tick('turnEnd');g.battle.turn++;assert.equal(g.engine.getQuestionMinEfficiencyBonusPercent(g.p.effects),10);g.tick('turnEnd');assert.equal(g.engine.getQuestionMinEfficiencyBonusPercent(g.p.effects),0);},
 g=>{g.use(13);assert.equal(g.p.nextTurnActionPointDelta,2);g.battle.turn++;g.tick('turnStart');assert.equal(g.p.currentActionPoint,5);g.x.c.normalizePlayerActionPointFields_(g.p);assert.equal(g.p.currentActionPoint,5);g.battle.turn++;g.tick('turnStart');assert.equal(g.p.currentActionPoint,3);assert.equal(g.p.maxActionPoint,3);},
 g=>{g.p.currentActionPoint=1;g.use(14);assert.equal(g.p.hp,50);assert.equal(g.p.currentActionPoint,2);},
 g=>{g.use(15);assert.equal(g.engine.getDiscountedSkillCost(g.p,g.skill(2),2),1);assert.equal(g.engine.getDiscountedSkillCost(g.p,g.skill(11),0),0);assert.equal(g.engine.getDiscountedSkillCost(g.p,g.skill(15),1),1);g.engine.consumeSkillCostEffects(g.p,g.skill(2));assert.equal(g.engine.getDiscountedSkillCost(g.p,g.skill(2),2),1);g.engine.consumeSkillCostEffects(g.p,g.skill(2));assert.equal(g.engine.getDiscountedSkillCost(g.p,g.skill(2),2),2);},
];
for(const mode of ['server','browser'])checks.forEach((check,i)=>test(`normal skills ${mode}: ${normal.skills[i].name}`,()=>check(game(mode))));

test('normal skills: source difficulty, AP cost, schema, and limited uses are preserved',()=>{
 assert.deepEqual(normal.skills.map(s=>s.difficultyBonus),[0,1,0,0,1,1,1,0,0,2,0,0,1,0,2]);
 assert.deepEqual(normal.skills.map(s=>s.actionPointCost),[1,2,1,1,2,2,1,1,1,2,0,1,1,0,1]);
 assert.equal(normal.effects.length,5);assert.equal(normal.effectRules.length,3);
 for(const n of [6,13,14])assert.equal(JSON.parse(normal.skills[n-1].conditionJson).perBattleLimit,1);
});
for(const mode of ['server','browser'])test('normal skills '+mode+': emergency action cannot reduce HP to zero',()=>{
 const g=game(mode);g.p.hp=10;assert.throws(()=>g.use(14),/체력 소모 후 1 이상/);assert.equal(g.p.hp,10);assert.equal(g.p.currentActionPoint,3);
});

test('normal skills: focus does not increase the efficiency maximum and expires at turn end',()=>{
 const g=game('server');g.use(11);
 const mods=g.x.c.getItemQuestionModifiers_(g.battle,{type:'multipleChoice'});
 assert.equal(mods.questionCappedEfficiencyBonusPercent,10);
 const maximum=g.x.c.calculateMaxAnswerEfficiency_(mods);
 assert.equal(g.x.c.calculateEfficiency(true,10000,10000,0,mods,{}),maximum);
 const noFocus={...mods,questionEfficiencyBonusPercent:0,questionCappedEfficiencyBonusPercent:0};
 const base=g.x.c.calculateEfficiency(true,1000,10000,0,noFocus,{});
 assert.ok(Math.abs(g.x.c.calculateEfficiency(true,1000,10000,0,mods,{})-Math.min(maximum,base+.1))<.001);
 assert.equal(g.engine.capQuestionEfficiencyBonus(1.6,1.25,10),1.5,'existing uncapped bonuses are not reduced');
 g.tick('turnEnd');assert.equal(g.engine.getQuestionEfficiencyBonusPercent(g.p.effects),0);
});

test('normal skills: AP discounts appear once in availability and browser cost calculation',()=>{
 const g=game('server');g.use(15);
 const available=g.x.c.getAvailableSkills({skills:[{skillId:'skill_normal_02',level:1}],stats:g.p.stats,items:[]},g.battle)[0];
 assert.equal(available.actionPointCost,1);assert.equal(available.baseActionPointCost,2);
 const c=vm.createContext({RULE_ENGINE_SHARED:g.engine,currentView:{battle:g.battle}});
 const html=fs.readFileSync('Battle.html','utf8');
 vm.runInContext(html.match(/    function getSkillActionPointCost\([^]*?\n    \}/)[0],c);
 assert.equal(c.getSkillActionPointCost(available),1);
 g.engine.consumeSkillCostEffects(g.p,g.skill(2));g.engine.consumeSkillCostEffects(g.p,g.skill(2));
 assert.equal(c.getSkillActionPointCost(available),2);
});

for(const mode of ['server','browser'])test('normal skills '+mode+': cooldown reducers cannot target each other',()=>{
 const g=game(mode);g.battle.skillCooldowns={skill_normal_10:5};
 assert.throws(()=>g.use(9,{cooldownTargetSkillId:'skill_normal_10'}),/쿨타임을 줄일 스킬/);
 assert.equal(g.battle.skillCooldowns.skill_normal_10,5);
});
