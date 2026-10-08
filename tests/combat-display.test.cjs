const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('Battle.html','utf8');
const fn = name => html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
test('target shortcuts use alive displayed order and cannot act while locked',()=>{
 const picked=[],c=vm.createContext({pendingTargetSelection:{},workbookDeadlineExpired:false,
  shouldLockBattleInput:()=>false,document:{querySelector:()=>null},
  getAliveClientMonsters:()=>[{instanceId:'left'},{instanceId:'middle'},{instanceId:'right'}],
  getMonsterRuntimeId:m=>m.instanceId,completeTargetSelection:id=>picked.push(id)});
 vm.runInContext(fn('handleTargetSelectionKeyboard'),c);
 for(const key of ['1','2','3']) assert.equal(c.handleTargetSelectionKeyboard({key,target:{},preventDefault(){}}),true);
 assert.deepEqual(picked,['left','middle','right']);
 c.shouldLockBattleInput=()=>true;c.handleTargetSelectionKeyboard({key:'1',preventDefault(){}});
 assert.equal(picked.length,3);
 c.pendingTargetSelection=null;assert.equal(c.handleTargetSelectionKeyboard({key:'1'}),false);
});
test('status icons show the action snapshot immediately even if it expires later in the turn',()=>{
 let shown;const player={effects:[]};const c=vm.createContext({currentView:{battle:{player}},
  syncClientStatusBuckets(){},renderPlayerStatuses:x=>{shown=x;}});
 vm.runInContext(fn('refreshEventStatuses'),c);
 const snapshot={effects:[{effectId:'buff_power',category:'buff',value:2}]};
 c.refreshEventStatuses({actor:'player',type:'buff',statusSnapshot:snapshot},{battle:{player:{effects:[]}}});
 assert.equal(shown,snapshot);assert.equal(player.effects[0].value,2);
 snapshot.effects[0].value=99;assert.equal(player.effects[0].value,2);
});
test('monster buff and debuff intent values use actual effect values including explicit zero',()=>{
 const c=vm.createContext({getClientEffectiveStat:()=>10});
 vm.runInContext(fn('calculateClientMonsterIntentValue'),c);
 assert.equal(c.calculateClientMonsterIntentValue({}, {skillType:'buff',skillEffect:{value:3}},'skill'),3);
 assert.equal(c.calculateClientMonsterIntentValue({}, {skillType:'debuff',skillRule:{value:-2},skillEffect:{value:-1}},'skill'),2);
 assert.equal(c.calculateClientMonsterIntentValue({}, {skillType:'buff',skillRule:{value:0},skillEffect:{value:3}},'skill'),0);
 const source=fs.readFileSync('BattleService.gs','utf8');
 Object.assign(c,{calculateEffectiveStats:x=>x,ACTION_TYPES:{SKILL:'skill',ATTACK:'attack',GUARD:'guard'},
  SKILL_TYPES:{BUFF:'buff',DEBUFF:'debuff',HEAL:'heal',SHIELD:'shield',DAMAGE:'damage'},
  EFFECT_TYPES:{FLAT:'flat'},EFFECT_CATEGORIES:{BUFF:'buff'},DB_SHEETS:{EFFECTS:'Effects'},
  getMonsterSkillRule_:s=>s.rule,findCachedRowByKey_:()=>({value:3,effectType:'flat',category:'buff'}),getSkillUpgradeValue:()=>1});
 vm.runInContext(source.match(/function calculateMonsterIntentValue_\([^]*?\n\}/)[0],c);
 assert.equal(c.calculateMonsterIntentValue_({actionType:'skill',skillId:'s'},{},{},{type:'buff',rule:{effectId:'x'}}),4);
 assert.equal(c.calculateMonsterIntentValue_({actionType:'skill',skillId:'s'},{},{},{type:'debuff',rule:{effectId:'x',value:2}}),2);
});
test('HP text continues its original slower animation after HUD replacement',()=>{
 let now=0;const frames=[],c=vm.createContext({Date:{now:()=>now},window:{requestAnimationFrame:f=>frames.push(f)}});
 for(const name of ['formatHpShieldText','animateHpShieldText','resumeHpTextAnimation'])vm.runInContext(fn(name),c);
 const old={};c.animateHpShieldText(old,100,50,0,0,100);
 now=350;const replacement={};c.resumeHpTextAnimation(replacement,old.hpTextAnimation,50,0,100);
 assert.notEqual(replacement.innerHTML,'50 / 100');assert.equal(replacement.hpTextAnimation.started,0);
 now=650;frames.at(-1)();assert.equal(replacement.innerHTML,'50 / 100');
});
