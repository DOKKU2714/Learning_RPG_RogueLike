const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');
const assert=require('node:assert/strict');
const html=fs.readFileSync('Battle.html','utf8');
const extract=name=>html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const pack=require('./fixtures/skill-rework-2026-10-17.json');
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  await page.setContent('<!doctype html><html lang="ko"><body></body></html>');
  await page.addScriptTag({content:`
    var pack=${JSON.stringify(pack)},pendingCombatSkillChoice=null,pendingTargetSelection=null,workbookDeadlineExpired=false,isDummyMode=false;
    var opened=[],logs=[],currentView={runId:'test',availableSkills:pack.skills,battle:{player:{hp:60,maxHp:100},monsters:[{instanceId:'a',currentHp:100,maxHp:100,effects:[]},{instanceId:'b',currentHp:100,maxHp:100,effects:[]}],skillCooldowns:{skill_v2_strike_01:2,skill_v2_strike_02:3}}};
    function updateWorkbookCountdown(){}function renderMonsters(){}function updateBattleInputLockState(){}function closeSkillPanel(){}
    function pushLog(text){logs.push(text);}function safeJsonParseClient(t,f){try{return JSON.parse(t);}catch(e){return f;}}
    function findAvailableSkill(id){return currentView.availableSkills.find(s=>s.skillId===id);}
    function getAliveClientMonsters(){return currentView.battle.monsters.filter(m=>m.currentHp>0);}
    function getMonsterRuntimeId(m){return m.instanceId;}
    function normalizeSkillTags(t){return JSON.parse(t);}
    function hasClientEffect(m,id){return m.effects.some(e=>e.effectId===id);}
    function takeCachedQuestionView(type,skillId,targetId){return {actionType:type,skillId,targetId};}
    function openQuestionModal(view){opened.push({...view,...pendingCombatSkillChoice});pendingCombatSkillChoice=null;}
    var RULE_ENGINE_SHARED={effectStacks:(m,id)=>(m.effects||[]).filter(e=>e.effectId===id).reduce((s,e)=>s+e.stacks,0)};
    ${['startSkillQuestion','beginTargetSelection','completeTargetSelection','cancelTargetSelection','openCombatCooldownChoice'].map(extract).join('\n')}
  `});
  await page.evaluate(()=>startSkillQuestion('skill_v2_strike_08','a'));
  await page.getByRole('dialog').waitFor();
  assert.equal(await page.evaluate(()=>opened.length),0);
  await page.getByRole('button',{name:'잇기',exact:true}).click();
  assert.equal(await page.evaluate(()=>opened[0].cooldownTargetSkillId),'skill_v2_strike_02');
  await page.evaluate(()=>{opened=[];startSkillQuestion('skill_v2_poison_08','a');});
  assert.equal(await page.evaluate(()=>pendingTargetSelection.primaryTargetId),'a');
  assert.equal(await page.evaluate(()=>opened.length),0);
  await page.evaluate(()=>completeTargetSelection('a'));
  assert.equal(await page.evaluate(()=>opened.length),0);
  await page.evaluate(()=>{currentView.battle.monsters[0].effects=[{effectId:'effect_v2_poison',stacks:7}];completeTargetSelection('b');});
  assert.equal(await page.evaluate(()=>opened[0].secondaryTargetId),'b');
  assert.equal(await page.evaluate(()=>opened[0].targetId),'a');
  await page.evaluate(()=>{opened=[];startSkillQuestion('skill_v2_strike_08','a');});
  await page.getByRole('button',{name:'취소',exact:true}).click();
  assert.equal(await page.evaluate(()=>opened.length),0);
  console.log('rework selection: cooldown dialog, source/secondary selection, same-target rejection and cancellation passed');
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
