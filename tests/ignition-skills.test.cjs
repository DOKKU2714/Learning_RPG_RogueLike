const test=require('node:test');
const assert=require('node:assert/strict');
const vm=require('node:vm');
const fs=require('node:fs');
const {context,copy}=require('./run-session.test.cjs');
const pack=require('../scripts/build-ignition-pack.cjs');
function game(mode){
 const x=context();
 x.seed(x.c.DB_SHEETS.SKILLS,pack.skills);x.seed(x.c.DB_SHEETS.EFFECTS,pack.effects);x.seed(x.c.DB_SHEETS.EFFECT_RULES,pack.effectRules);
 x.c.Math.random=()=>.4;
 const local=vm.runInNewContext(x.c.getLocalRunEngineSource_(),{Date:x.c.Date,Math:x.c.Math});
 const snapshot={skills:pack.skills,effects:copy(x.c.readTable_(x.c.DB_SHEETS.EFFECTS)),effectRules:pack.effectRules};
 const stats={hp:100,attack:20,defense:10,accuracy:100,evasion:0,criticalRate:0,criticalDamage:150};
 const b={battleId:'ignition',status:'active',turn:1,suppressMonsterScoreBookkeeping:true,skillCooldowns:{},skillUseCounts:{},lastTurnEvents:[],
  player:{hp:40,maxHp:100,shield:0,baseStats:{...stats},stats:{...stats},effects:[],items:[],baseMaxActionPoint:3,maxActionPoint:3,currentActionPoint:0},
  monsters:['a','b','c'].map((instanceId,i)=>({instanceId,monsterId:instanceId,name:instanceId,hp:1000,currentHp:1000,maxHp:i===1?2000:1000,attack:10,defense:10,evasion:0,shield:0,effects:[]}))};
 const engine=x.c.getSharedRuleEngine_();
 const use=(n,level=1,efficiency=1,id='a')=>{const s={...x.c.hydrateSkill_(pack.skills[n-1],level),targetId:id};return mode==='server'?x.c.applySkillEffect(b,s,efficiency,true):local.skill(snapshot,b,s,id,efficiency,true);};
 const burn=(target,stacks)=>engine.applyEffect(target,{...snapshot.effects[0],stacks},{},b.turn);
 const stacks=target=>engine.effectStacks(target,'effect_v2_burn');
 const tick=()=>mode==='server'?x.c.tickEffectsAtTurnEnd(b):local.tick(snapshot,b,'turnEnd');
 const incoming=(amount)=>mode==='server'?x.c.dealDamageToPlayer_(b,amount,b.monsters[1]):local.playerDamage(snapshot,b,amount,b.monsters[1]);
 return {x,local,snapshot,b,p:b.player,a:b.monsters[0],engine,use,burn,stacks,tick,incoming};
}
for(const mode of ['server','browser']){
 test(`ignition ${mode}: edited sheet formula and stack decay override original pack defaults`,()=>{
  const g=game(mode),effects=copy(g.snapshot.effects),rules=copy(g.snapshot.effectRules);
  const burn=effects.find(e=>e.effectId==='effect_v2_burn');
  burn.decayTiming='onTrigger';burn.decayStacks=1;
  burn.rules.find(r=>r.operation==='damage').valueFormula='maxHp*stacks*0.03';
  rules.find(r=>r.effectId==='effect_v2_burn').valueFormula='maxHp*stacks*0.03';
  g.x.seed(g.x.c.DB_SHEETS.EFFECTS,effects);g.x.c.clearTableCache_(g.x.c.DB_SHEETS.EFFECTS);
  g.x.seed(g.x.c.DB_SHEETS.EFFECT_RULES,rules);g.x.c.clearTableCache_(g.x.c.DB_SHEETS.EFFECT_RULES);
  g.snapshot.effects=effects;g.snapshot.effectRules=rules;
  g.burn(g.a,3);g.tick();
  assert.equal(g.a.currentHp,910,'3% per stack comes from the edited effect formula');
  assert.equal(g.stacks(g.a),2,'the edited lifecycle consumes one stack');
 });
 test(`ignition ${mode}: every skill executes at level 1 and 3 without rule warnings`,()=>{
  for(let i=1;i<=18;i++)for(const level of [1,3]){
   const g=game(mode);g.burn(g.a,3);g.burn(g.p,2);g.use(i,level);
   assert.deepEqual(copy(g.b.skillRuleWarnings || []),[],pack.skills[i-1].name);
  }
 });
 test(`ignition ${mode}: turn-end DOT uses 1.5%, shields, no decay, and no early tick`,()=>{
  const g=game(mode);g.burn(g.a,2);g.burn(g.p,2);g.p.shield=10;g.a.shield=20;
  if(mode==='browser')g.local.tick(g.snapshot,g.b,'beforeMonsterTurn');else g.x.c.applyMonsterBurnDamage_(g.a,g.b);
  assert.equal(g.a.currentHp,1000);g.tick();
  assert.equal(g.a.currentHp,990);assert.equal(g.a.shield,0);assert.equal(g.p.hp,40);assert.equal(g.p.shield,7);
  assert.equal(g.stacks(g.a),2);assert.equal(g.stacks(g.p),2);
  g.b.turn++;g.tick();assert.equal(g.a.currentHp,960);assert.equal(g.stacks(g.a),2);
 });
 test(`ignition ${mode}: torch, fire spray, fist use level starting at one and attach effects on hits`,()=>{
  for(const [n,damage,stacks] of [[1,21,2],[5,20,3],[17,25,3]]){
   const g=game(mode);g.use(n);assert.equal(1000-g.a.currentHp,damage);assert.equal(g.stacks(g.a),stacks);assert.equal(g.stacks(g.p),0);
   if(n===1)assert.equal(g.engine.getEffectiveStat(g.a,'evasion'),-10);
   if(n===5)assert.equal(1000-g.b.monsters[2].currentHp,20);
  }
 });
 test(`ignition ${mode}: ignite spreads only from a previously burning target and excludes that target`,()=>{
  const g=game(mode);g.use(2);assert.equal(g.stacks(g.a),5);assert.equal(g.stacks(g.b.monsters[1]),0);
  g.use(2);assert.equal(g.stacks(g.a),10);assert.equal(g.stacks(g.b.monsters[1]),2);assert.equal(g.stacks(g.b.monsters[2]),2);
 });
 test(`ignition ${mode}: healing counts only enemies and shields retaliate against their attacker`,()=>{
  const g=game(mode);g.burn(g.a,3);g.burn(g.p,9);g.use(3);assert.equal(g.p.hp,49);
  g.use(4);assert.equal(g.p.shield,13);g.incoming(3);assert.equal(g.stacks(g.b.monsters[1]),3);assert.equal(g.stacks(g.a),3);
  g.tick();g.p.shield=10;g.incoming(1);assert.equal(g.stacks(g.b.monsters[1]),3);
  const h=game(mode);h.use(9);assert.equal(h.p.shield,24);assert.equal(h.stacks(h.p),3);h.tick();assert.equal(h.p.hp,40);assert.equal(h.p.shield,19);
 });
 test(`ignition ${mode}: ember shield ignites only after positive shield damage`,()=>{
  const g=game(mode),attacker=g.b.monsters[1];g.use(4);
  assert.equal(g.stacks(attacker),0,'casting the shield does not ignite enemies');
  g.b.lastTurnEvents=[];g.incoming(0);
  assert.equal(g.stacks(attacker),0,'zero damage cannot trigger retaliation');
  g.p.shield=0;g.incoming(3);
  assert.equal(g.stacks(attacker),0,'HP damage without shield damage cannot trigger retaliation');
  g.p.shield=5;const result=g.incoming(3);
  assert.equal(result.shieldDamage,3);assert.equal(g.p.shield,2);
  assert.equal(g.stacks(attacker),3);assert.equal(g.stacks(g.a),0);
  const applied=g.b.lastTurnEvents.find(e=>e.effectId==='effect_v2_burn');
  assert.equal(applied.actor,'player');assert.equal(applied.targetMonsterId,attacker.instanceId);
  assert.equal(applied.statusSnapshot.effects.find(e=>e.effectId==='effect_v2_burn').stacks,3);
 });
 test(`ignition ${mode}: lighter adds fixed stack damage and gas uses each target's own stacks`,()=>{
  const g=game(mode);g.burn(g.a,4);g.use(6);assert.equal(g.a.currentHp,970);
  const h=game(mode);h.burn(h.a,2);h.burn(h.p,3);h.use(7);assert.equal(h.a.currentHp,975);assert.equal(h.b.monsters[1].currentHp,1000);assert.equal(h.p.hp,34);
  const high=game(mode);high.burn(high.p,100);high.use(7,10);assert.equal(high.p.hp,40);
 });
 test(`ignition ${mode}: extinguisher consumes stacks and applies two-turn accuracy and one-turn evasion`,()=>{
  const g=game(mode);g.burn(g.a,4);g.burn(g.p,3);g.use(8);assert.equal(g.a.currentHp,969);
  assert.equal(g.stacks(g.a),0);assert.equal(g.stacks(g.p),0);assert.equal(g.engine.getEffectiveStat(g.a,'accuracy'),-32);
  assert.equal(g.engine.getEffectiveStat(g.p,'evasion'),28);g.tick();assert.equal(g.engine.getEffectiveStat(g.p,'evasion'),0);
  g.b.turn++;g.tick();assert.ok(g.a.effects.some(e=>e.effectId==='effect_v2_burn_accuracy_down'));
  g.b.turn++;g.tick();assert.ok(!g.a.effects.some(e=>e.effectId==='effect_v2_burn_accuracy_down'));
 });
 test(`ignition ${mode}: stack application, AP consumption threshold and AP maximum`,()=>{
  const g=game(mode);g.use(10,3);assert.equal(g.stacks(g.a),5);g.burn(g.p,1);g.use(11,3);assert.equal(g.p.currentActionPoint,2);assert.equal(g.stacks(g.a),0);assert.equal(g.stacks(g.p),0);
  const low=game(mode);low.burn(low.a,4);low.use(11);assert.equal(low.p.currentActionPoint,1);
  const boundary=game(mode);boundary.burn(boundary.a,3);boundary.burn(boundary.p,2);boundary.use(11);assert.equal(boundary.p.currentActionPoint,2);
 });
 test(`ignition ${mode}: explosion uses selected maximum HP equally for every recipient`,()=>{
  const g=game(mode);g.burn(g.b.monsters[1],3);g.use(12,1,1,'b');
  assert.deepEqual(g.b.monsters.map(m=>m.currentHp),[865,865,865]);assert.equal(g.stacks(g.b.monsters[1]),0);
 });
 test(`ignition ${mode}: jwi hits use old stacks and fan damage uses doubled selected stacks`,()=>{
  const g=game(mode);g.burn(g.a,3);g.use(13);assert.equal(g.a.currentHp,955);assert.equal(g.stacks(g.a),5);assert.equal(g.b.monsters[1].currentHp,979);
  const h=game(mode);h.burn(h.a,3);h.use(14);assert.equal(h.stacks(h.a),6);assert.deepEqual(h.b.monsters.map(m=>m.currentHp),[992,992,992]);
  const zero=game(mode);zero.use(14);assert.equal(zero.stacks(zero.a),0);
 });
 test(`ignition ${mode}: fire safety consumes self and all enemies and fire play doubles only burning hit targets`,()=>{
  const g=game(mode);g.burn(g.a,3);g.burn(g.b.monsters[1],2);g.burn(g.p,4);g.use(15);
  assert.equal(g.p.hp,67);assert.equal(g.p.shield,54);assert.equal(g.stacks(g.a)+g.stacks(g.b.monsters[1])+g.stacks(g.p),0);
  const h=game(mode);h.burn(h.a,3);h.use(16);assert.equal(h.a.currentHp,975);assert.equal(h.stacks(h.a),6);assert.equal(h.stacks(h.b.monsters[1]),0);
 });
 test(`ignition ${mode}: solar lasts exactly 3 turns and responds to shield and DOT damage`,()=>{
  const g=game(mode);g.use(18);g.p.shield=10;g.incoming(1);assert.equal(g.stacks(g.p),1);
  g.use(17);assert.equal(g.stacks(g.a),6);
  for(let i=0;i<3;i++){g.tick();g.b.turn++;}
  assert.equal(g.b.activeTriggers.length,0);const before=g.stacks(g.p);g.incoming(1);assert.equal(g.stacks(g.p),before);
 });
 test(`ignition ${mode}: self-ignition probabilities clamp to zero and lower levels can trigger`,()=>{
  for(const n of [1,2,5,13]){
   const g=game(mode);g.x.c.Math.random=()=>0;g.use(n,10);assert.equal(g.stacks(g.p),0);
   const h=game(mode);h.x.c.Math.random=()=>0;h.use(n,1);assert.equal(h.stacks(h.p),n===1?1:2);
  }
 });
}
test('ignition: fan level-dependent use limits, schema, rarity, and source formulas',()=>{
 const g=game('server');assert.equal(pack.skills.length,18);assert.deepEqual(pack.skills.map(s=>s.rarity),['common','common','common','common','common','uncommon','uncommon','uncommon','uncommon','uncommon','uncommon','rare','rare','rare','epic','epic','legendary','unique']);
 for(const level of [1,3,8])assert.equal(JSON.parse(g.x.c.hydrateSkill_(pack.skills[13],level).conditionJson).perBattleLimit,1+level);
 assert.equal(g.x.c.getSkillRewardConcept_(pack.skills[0]),'burn');
 assert.deepEqual(pack,require('../docs/skill-packs/ignition-skills-2026-10-19.json'));
 for(const s of pack.skills){assert.match(s.skillId,/^skill_v2_burn_\d\d$/);assert.ok(JSON.parse(s.tags).includes('burn'));assert.doesNotMatch(s.effectJson,/ignition/);}
 const effectIds=new Set(pack.effects.map(e=>e.effectId));
 for(const s of pack.skills)for(const match of s.effectJson.matchAll(/effect_v2_burn(?:_[a-z_]+)?/g))assert.ok(effectIds.has(match[0]),match[0]);
});
test('ignition: full server end-turn flow keeps player shields until after DOT',()=>{
 const g=game('server'),c=g.x.c;g.burn(g.p,2);g.p.shield=10;
 const run={runId:'r',playerId:'p',status:'active'},stage={battle:g.b};
 Object.assign(c,{getCurrentPlayer_:()=>({playerId:'p'}),requireRun_:()=>run,requireRunBeforeWorkbookDeadline_:()=>{},
  getStageState_:()=>stage,requireActiveBattle_:()=>g.b,normalizeUsedQuestionIds_:()=>{},applyMonsterTurn:()=>{},
  saveStageState_:()=>{},buildBattleStateView_:()=>g.b,logBattleEvent_:()=>{},tickEffectsAtTurnStart:()=>{}});
 c.passPlayerTurn('r','token');assert.equal(g.p.hp,40);assert.equal(g.p.shield,0);assert.equal(g.stacks(g.p),2);
});
test('ignition: tooltips show calculated status values and no countdown for persistent stacks',()=>{
 const html=fs.readFileSync('Battle.html','utf8');const extract=name=>html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
 const c=vm.createContext({getStatusTotalValue:s=>s.value,getStatLabel:()=>'',getStatusStatTooltip:()=>''});
 for(const name of ['renderStatusDescriptionTemplate','buildStatusDescription','buildStatusTooltip'])vm.runInContext(extract(name),c);
 for(const effect of pack.effects.slice(1)){
  const text=c.buildStatusDescription({...effect,value:-28,stacks:1},effect.category);assert.match(text,/28%p/);assert.doesNotMatch(text,/[{}]/);
 }
 const text=c.buildStatusTooltip({...pack.effects[0],stacks:3,remainingTurns:3},'debuff').main;
 assert.doesNotMatch(text,/남은 턴/);assert.match(text,/3/);
});
test('ignition: rendered descriptions calculate attack, defense, level and live stacks',()=>{
 const g=game('server');g.burn(g.a,3);g.burn(g.p,2);
 const html=fs.readFileSync('Battle.html','utf8');const extract=name=>html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
 const c=vm.createContext({currentView:{battle:g.b},escapeHtml:String,getClientEffectiveStats:p=>p.stats,getSkillActionPointCost:s=>s.actionPointCost,getSkillCooldownDisplayText:()=>'',getSkillUseLimitText:()=>''});
 const names=['highlightSkillStatusNames','renderSkillDescriptionTemplate','replaceSkillDescriptionTokens','getSkillDescriptionTemplateValues','getSkillDescriptionFormulaValue','getSkillDisplayMetrics','getClientSkillUpgradeValue','safeJsonParseClient','evaluateSkillDisplayFormula','escapeRegExpClient','getSkillPreviewDamageRange','getSkillFormulaDamageRange','getSkillFormulaShieldRange','getSkillEffectDisplayMetrics','getSkillTagBonusDisplayMetrics','getSkillDisplayShield','getSkillRuleDisplayShield','collectSkillRuleShieldFormulas','appendSkillRuleShieldFormula','getSkillPreviewShieldValue','getSkillDisplayHeal','getSkillDisplayHealPercent','getSkillHitCount'];
 for(const name of names)vm.runInContext(extract(name),c);
 for(const source of pack.skills)for(const level of [1,3,10]){const s={...source,level};const text=c.renderSkillDescriptionTemplate(s,s.description);assert.doesNotMatch(text,/calc:|\?|NaN/,source.name);}
 assert.match(c.renderSkillDescriptionTemplate({...pack.skills[0],level:1},pack.skills[0].description),/>21</);
 assert.match(c.renderSkillDescriptionTemplate({...pack.skills[2],level:1},pack.skills[2].description),/>9</);
});

for(const mode of ['server','browser']){
 test(`ignition ${mode}: existing burn references stack with new skills and generic cleanse removes burn`,()=>{
  const g=game(mode),old=require('./fixtures/skill-rework-2026-10-17.json').skills.find(s=>s.skillId==='skill_v2_burn_01');
  const compatibilitySkill={...old,skillId:'compatibility_burn_source',level:1,targetId:'a'};
  const perform=s=>mode==='server'?g.x.c.applySkillEffect(g.b,s,1,true):g.local.skill(g.snapshot,g.b,s,'a',1,true);
  perform(compatibilitySkill);g.use(1);assert.equal(g.stacks(g.a),4);assert.equal(g.a.effects.filter(e=>e.effectId==='effect_v2_burn').length,1);
  g.burn(g.p,2);g.engine.applyEffect(g.p,{...g.snapshot.effects.find(e=>e.effectId==='effect_v2_burn_evasion_up'),value:28},{},g.b.turn);
  perform({skillId:'generic_cleanse',name:'정화',level:1,type:'buff',target:'self',effectJson:'{"targetMode":"self","removeDebuffs":true}'});
  assert.equal(g.stacks(g.p),0);assert.equal(g.p.debuffs.length,0);assert.ok(g.p.effects.some(e=>e.effectId==='effect_v2_burn_evasion_up'));
 });
 test(`ignition ${mode}: debuff events carry application-time snapshots and fire damage keeps its visual identity`,async()=>{
  const g=game(mode);g.use(1);
  const applied=g.b.lastTurnEvents.find(e=>e.effectId==='effect_v2_burn'&&e.type==='debuff');assert.equal(applied.statusSnapshot.effects.find(e=>e.effectId==='effect_v2_burn').stacks,2);
  g.use(10);assert.equal(applied.statusSnapshot.effects.find(e=>e.effectId==='effect_v2_burn').stacks,2);
  g.burn(g.p,2);g.b.lastTurnEvents=[];g.use(7);
  const damage=g.b.lastTurnEvents.filter(e=>e.type==='effectDamage');assert.ok(damage.some(e=>e.target==='player'));assert.ok(damage.some(e=>e.target==='monster'));
  const calls=[],html=fs.readFileSync('Battle.html','utf8'),extract=name=>html.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
  const c=vm.createContext({currentView:{battle:g.b},pushLog:()=>{},finishActionDescription:()=>Promise.resolve(),animateMonsterHit:()=>Promise.resolve(),animatePlayerHit:()=>{}});
  for(const name of ['getDamageVisualType','playTurnEffectEvent'])vm.runInContext(extract(name),c);
  c.playDamageTypeEffect=(id,target)=>{calls.push([c.getDamageVisualType(id),target]);return true;};
  for(const event of damage)await c.playTurnEffectEvent(copy(event));
  assert.ok(calls.length>=2);assert.ok(calls.every(([type])=>type==='burn'));
 });
}
test('ignition: canonical burn icons, reward art, affinity, and chance details are connected',()=>{
 const g=game('server'),html=fs.readFileSync('Battle.html','utf8'),extract=name=>html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
 const c=vm.createContext({ASSET_BASE_URL:'https://assets.example',escapeHtml:String});
 for(const name of ['getStatusIcon','renderStatusSymbol','renderStatusStack','getRewardSkillConcept','getRewardIconUrl'])vm.runInContext(extract(name),c);
 assert.equal(c.getStatusIcon('effect_v2_burn','debuff'),'BRN');
 const status={iconKey:'effect_v2_burn',stacks:4,stackable:true,type:'debuff',label:'BRN'};
 assert.match(c.renderStatusSymbol(status),/<svg/);assert.match(c.renderStatusStack(status),/>4</);
 for(const s of pack.skills){assert.equal(c.getRewardSkillConcept({skillDetail:s}),'발화');assert.match(c.getRewardIconUrl('skill',{skillDetail:s}),/Skill_Burn\.png$/);}
 assert.deepEqual([...g.x.c.getSkillAffinityWeights_([pack.skills[1]],[pack.skills[0].skillId],'burn')],[2.5]);
 for(const level of [1,3,10]){
  const skill=g.x.c.hydrateSkill_(pack.skills[4],level),chance=Math.max(0,30-5*level);
  assert.equal(g.x.c.buildSkillEffectDetails_(skill).find(e=>e.effectId==='effect_v2_burn').chance,chance);
  assert.equal(g.x.c.buildClientSkillEffects_(skill).find(e=>e.target==='self').chance,chance);
 }
});
