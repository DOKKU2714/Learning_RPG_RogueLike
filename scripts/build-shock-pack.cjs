// Spreadsheet authoring source. n means skill level, starting at one.
const fs=require('node:fs'),path=require('node:path');
const skills=[],effects=[],effectRules=[],shock='effect_v2_shock';
const C=f=>`{calc:${f}}`;
const apply=(formula,extra={})=>({operation:'applyEffect',effectId:shock,stacksFormula:formula,...extra});
const consume=(target)=>({operation:'consumeStacks',effectId:shock,amountFormula:'targetStacks',...(target?{target}:{})});
function effect(effectId,name,category,turns,description,options={}){
  const row={effectId,name,category,baseValue:0,durationType:turns?'turn':'stage',durationTurns:turns,
    stackMode:'replace',maxStacks:1,reapplyDurationPolicy:'refresh',durationClock:'turns',decayTiming:'none',decayStacks:0,
    decrementOnApplyTurn:true,description,rulesVersion:2,behaviorJson:'',statKey:'',effectType:'flat',value:0,stackable:false,triggerTiming:'',damageFormula:'',...options};
  effects.push(row);return effectId;
}
function rule(effectId,operation,timing,formula,statKey='',mode='flat',description=''){
  effectRules.push({effectId,ruleOrder:effectRules.filter(r=>r.effectId===effectId).length+1,triggerTiming:timing,
    operation,statKey,valueMode:mode,valueFormula:typeof formula==='string'?formula:JSON.stringify(formula),shieldPolicy:operation==='directHitDamage'?'absorb':'',description});
}
effect(shock,'감전','debuff',0,'직접 공격으로 피해를 입을 때 2+공격자 공격력의 10%만큼 추가 피해를 받습니다. 추가 피해가 발동할 때마다 감전 1중첩을 소모합니다. 추가 피해·지속 피해·반사·반격으로는 발동하지 않습니다.',
  {baseValue:1,value:1,stackMode:'add',stackable:true,maxStacks:2147483647,reapplyDurationPolicy:'keep',durationClock:'stacks',decayTiming:'none',decrementOnApplyTurn:false,triggerTiming:'onHit'});
rule(shock,'directHitDamage','onHit','2+0.1*attack','','flat','직접 공격으로 피해를 줄 때 공격자의 현재 공격력을 기준으로 추가 피해.');
rule(shock,'consumeStacks','onHit','1','','flat','추가 피해 발동마다 1중첩 소모. 자연 감소 없음.');
const conductor=effect('effect_v2_shock_received','젓가락 꽂기','debuff',3,'3턴간 감전 중첩을 {value}% 더 받습니다.');
rule(conductor,'modifyReceivedStacks','onApplyEffect','value',shock,'percent','받는 감전 중첩 증가. 소수 중첩은 반올림.');
const insulator=effect('effect_v2_shock_insulator','비전도체 두르기','buff',0,'이번 스테이지에서 감전 상태의 적에게 받는 피해가 {value}% 감소합니다.');
rule(insulator,'incomingReductionIfEffect','passive','value',shock,'percent','공격자가 감전 상태일 때 받는 피해 감소. 최대 100%.');
const rod=effect('effect_v2_shock_rod','피뢰침','buff',0,'다음 내 턴 시작에 모든 적에게 기존 감전 중첩당 피해를 주고 감전 중첩을 부여합니다.');
rule(rod,'triggerActions','onTurnStart',{minTurnOffset:1,maxActivations:1,actions:[
  {operation:'damage',target:'allEnemies',effectId:shock,damageKind:'effect',amountFormula:'targetShock*(4+level)'},
  apply('4+level',{target:'allEnemies'})]},'','json','1턴 후 1회: 기존 중첩 기준 피해 → 모든 생존 적에게 감전.');
const rub=effect('effect_v2_shock_next_application','마찰 전하','buff',0,'다음 감전 부여 동작의 중첩이 2배가 됩니다. 광역 부여는 모든 대상에게 적용되며, 발동 후 사라집니다.',{durationClock:'stacks',baseValue:1,value:1});
rule(rub,'modifyAppliedStacks','onApplyEffect','100',shock,'percent','다음 감전 부여 동작에 +100%.');
rule(rub,'consumeOnApply','onApplyEffect','1',shock,'flat','감전을 실제 부여할 때 1회 소모.');
const coat=effect('effect_v2_shock_coat','전기외투','buff',3,'3턴간 방어막에 피해를 입힌 적에게 감전 2중첩을 부여합니다.');
rule(coat,'triggerActions','onBlock',{actions:[apply('2')]},'','json','방어막에 실제 피해를 입힌 공격자에게 감전 2중첩.');
function add(name,rarity,type,target,ap,cooldown,difficulty,description,config,options={}){
  skills.push({skillId:'skill_v2_shock_'+String(skills.length+1).padStart(2,'0'),name,hitCount:1,cooldown,actionPointCost:ap,rarity,
    conditionJson:JSON.stringify({...options.limit?{perBattleLimit:options.limit}:{},...options.fixed?{notUpgradable:true}:{}}),description,
    effectJson:JSON.stringify({targetMode:target==='self'?'self':target==='all'?'allEnemies':'singleEnemy',...config}),rewardEnabled:1,type,target,baseValue:0,difficultyBonus:difficulty,
    upgradeJson:JSON.stringify(options.fixed?{notUpgradable:true}:{}),tags:JSON.stringify(['shock','감전',type]),attackEffect:'shock',concept:'감전',
    rarityLabel:{common:'일반',uncommon:'드문',rare:'희귀',epic:'영웅'}[rarity],role:type==='damage'?'공격':type==='shield'?'방어':'강화·전하',
    proposalOrigin:'사용자 감전 기획 (2026-10-19)',implementationStatus:'구현 완료 · 시트 기반 공통 엔진',mechanicIds:[shock,...options.effects||[]].join(','),
    upgradeDesign:options.fixed?'강화 불가.':'n=스킬 레벨(1부터 시작). level 수식으로 성장.',rewardPlanned:1});
}
add('정전기','common','damage','enemy',1,1,0,`적에게 ${C('0.6*attack+0.05*level+5+level')} 피해를 입히고 감전 ${C('3+level')}중첩을 부여한다.`,
  {damageFormula:'0.6*attack+0.05*level+5+level',combat:{onEachHit:[apply('3+level')]}});
add('젓가락 꽂기','common','damage','enemy',1,2,1,`적에게 ${C('attack+0.1*level+3+2*level')} 피해를 입힌다.\n적중한 적은 3턴간 감전 중첩을 ${C('50+10*level')}% 더 받는다.`,
  {damageFormula:'attack+0.1*level+3+2*level',combat:{onEachHit:[{operation:'applyEffect',effectId:conductor,valueFormula:'50+10*level'}]}},{effects:[conductor]});
add('비전도체 두르기','common','shield','self',1,1,0,`방어막을 ${C('defense+6+2*level')} 얻는다.\n이번 스테이지에서 감전 상태의 적에게 받는 피해가 ${C('20+5*level|min:0|max:100')}% 감소한다.`,
  {shieldFormula:'defense+6+2*level',actions:[{operation:'applyEffect',effectId:insulator,target:'self',valueFormula:'20+5*level'}]},{effects:[insulator]});
add('피뢰침 꽂기','common','buff','self',2,2,1,`1턴 후 모든 적에게 감전 ${C('4+level')}중첩을 부여한다.\n이미 감전 상태인 적에게는 부여 전 중첩당 ${C('4+level')} 피해를 준다.`,
  {actions:[{operation:'applyEffect',effectId:rod,target:'self'}]},{effects:[rod]});
add('합선','uncommon','damage','enemy',1,2,1,`감전 상태인 적에게만 사용할 수 있다.\n적에게 ${C('0.9*attack+5+level')} 피해를 입힌다.\n피해 후 대상의 잃은 체력 3마다 감전 1중첩을 부여한다.`,
  {damageFormula:'0.9*attack+5+level',combat:{requireStacks:{effectId:shock,min:1},onEachHit:[apply('(enemyMaxHp-enemyHp)/3',{stacksRounding:'floor'})]}});
add('전기충격(기)','uncommon','damage','enemy',2,2,0,`적에게 ${C('0.4*attack+3+level')} 피해를 입히고 감전 2중첩을 부여한다.\n감전 부여 후 대상의 중첩이 ${C('5-level|min:0')} 이상이면 1턴간 기절시킨다.`,
  {damageFormula:'0.4*attack+3+level',combat:{onEachHit:[apply('2'),{operation:'applyEffect',effectId:'effect_v2_stun',durationType:'turn',durationTurns:1,when:{formula:'targetShock',minFormula:'5-level'}}]}},{effects:['effect_v2_stun']});
add('비비기','uncommon','buff','self',1,1,2,'다음에 부여하는 감전 중첩이 2배가 된다.\n강화 불가.',
  {actions:[{operation:'applyEffect',effectId:rub,target:'self'}]},{fixed:true,effects:[rub]});
add('누전','uncommon','damage','enemy',2,2,2,`적에게 ${C('attack+5+level')} 피해를 입힌다.\n피해를 입은 적의 남은 감전 중첩을 모두 소모하여 다른 모든 적에게 같은 수치를 부여한다.`,
  {damageFormula:'attack+5+level',combat:{onEachHit:[consume(),apply('totalConsumedStacks',{target:'allEnemies',excludeSelected:true})]}});
add('벼락 유도','rare','damage','all',2,3,3,`모든 적에게 ${C('0.4*attack+10+level')} 피해를 입히고 감전 ${C('4+level')}중첩을 부여한다.`,
  {damageFormula:'0.4*attack+10+level',combat:{onEachHit:[apply('4+level')]}});
add('전기외투','rare','shield','self',1,3,1,`방어막을 ${C('1.2*defense+10+2*level')} 얻는다.\n3턴간 방어막에 피해를 입힌 적에게 감전 2중첩을 부여한다.`,
  {shieldFormula:'1.2*defense+10+2*level',actions:[{operation:'applyEffect',effectId:coat,target:'self'}]},{effects:[coat]});
add('전도체 투척','epic','damage','enemy',2,0,2,`적 하나에게 ${C('0.3*attack+3+2*level')} 피해를 입힌다.\n이후 모든 적의 감전을 소모한다. 각 적에게 자신의 소모 중첩당 감전 피해(${C('2+0.1*attack')})를 입힌다.`,
  {damageFormula:'0.3*attack+3+2*level',actions:[consume('allEnemies'),{operation:'damage',target:'allEnemies',effectId:shock,damageKind:'additional',amountFormula:'2+0.1*attack',repeatFormula:'consumedStacks'}]},{limit:1});
add('에너지 충전','epic','shield','enemy',1,2,1,`적 하나의 감전을 모두 소모하여 소모 중첩당 ${C('3+level')}만큼 방어막을 얻는다.`,
  {actions:[consume(),{operation:'shield',target:'self',amountFormula:'totalConsumedStacks*(3+level)'}]});
const pack={source:'사용자 감전 스킬 기획 (2026-10-19)',skills,effects,effectRules};
if(require.main===module){const file=path.resolve(__dirname,'../docs/skill-packs/shock-skills-2026-10-19.json');fs.writeFileSync(file,JSON.stringify(pack,null,2)+'\n');console.log(`${skills.length} skills, ${effects.length} effects, ${effectRules.length} rules -> ${file}`);}
module.exports=pack;
