// Source definitions requested for the live Skills sheet, 2026-10-19.
// `level` is the user's n (starting at 1). Generated Effects/EffectRules are
// executed by the shared server/browser engine in SkillService.gs.
const fs=require('node:fs');
const path=require('node:path');
const skills=[];
const C=f=>`{calc:${f}}`;
function add(name,rarity,type,target,ap,cooldown,difficulty,description,rule,options={}) {
  const condition={...(options.limitFormula?{perBattleLimitFormula:options.limitFormula}:options.limit?{perBattleLimit:options.limit}:{}),...(options.fixed?{notUpgradable:true}:{})};
  const ready=true;
  skills.push({skillId:`skill_v2_assassin_${String(skills.length+1).padStart(2,'0')}`,name,
    hitCount:options.hits || 1,cooldown,actionPointCost:ap,rarity,conditionJson:JSON.stringify(condition),description,
    effectJson:JSON.stringify({targetMode:target==='self'?'self':target==='all'?'allEnemies':'singleEnemy',...rule}),
    rewardEnabled:ready?1:0,type,target,baseValue:0,difficultyBonus:difficulty,upgradeJson:JSON.stringify(options.fixed?{notUpgradable:true}:{}),
    tags:JSON.stringify(['assassin','암살',type]),attackEffect:options.attackEffect || (type==='damage'?'thrust':'none'),
    concept:'암살',rarityLabel:{common:'일반',uncommon:'드문',rare:'희귀',epic:'영웅',legendary:'전설',unique:'고유'}[rarity],
    role:options.role || ({damage:'공격',buff:'강화·자원',debuff:'약화',shield:'방어'}[type]),
    proposalOrigin:'사용자 암살 기획 (2026-10-19)',
    implementationStatus:'구현 완료 · 서버/클라이언트 공통 엔진',
    mechanicIds:options.mechanics || 'combat.assassin',
    upgradeDesign:options.fixed?'강화 불가.':`n=스킬 레벨(1부터 시작). level 수식으로 성장.${options.notes?' '+options.notes:''}`,
    rewardPlanned:1});
}
const assassin=config=>({combat:{assassin:config}});
add('선제공격','common','damage','enemy',0,1,0,
  `적에게 ${C('0.9*attack+0.1*level+2+level')} 피해를 입힌다.\n체력이 가득 찬 적에게는 피해가 ${C('50+5*level')}% 증가한다.`,
  {damageFormula:'0.9*attack+0.1*level+2+level',...assassin({fullHealthDamageBonusPercentFormula:'50+5*level'})});
add('민첩한 움직임','common','buff','self',1,2,0,
  `이번 상대 턴에 회피율이 ${C('35+5*level')}%p 증가한다.\n방어막이 없는 경우 회피율이 ${C('12+3*level')}%p 추가로 증가한다.`,
  assassin({evasion:{duration:'currentEnemyTurn',valueFormula:'35+5*level',unshieldedExtraFormula:'12+3*level',conditionCheck:'dynamic'}}));
add('반격','common','buff','self',2,0,2,
  `2턴간 회피율이 ${C('15+5*level')}%p 증가한다.\n같은 기간 상대 공격 회피 성공 시 공격한 적에게 ${C('0.5*attack+0.2*level+3+level')} 피해를 입힌다.\n이 반격 피해는 현재 회피율(%)만큼 증가한다.`,
  assassin({evasion:{durationTurns:2,valueFormula:'15+5*level'},counterOnEvade:{durationTurns:2,target:'attacker',damageFormula:'(0.5*attack+0.2*level+3+level)*(1+evasion/100)'}}),{limit:1});
add('마지막 일격','common','damage','enemy',1,2,1,
  `적에게 ${C('0.8*attack+0.1*level+4+2*level')} 피해를 입힌다.\n대상의 잃은 체력 비율만큼 피해가 증가한다. (잃은 체력 35% → 피해 +35%)\n이 스킬로 대상을 처치하면 이 스킬의 쿨타임이 초기화된다.`,
  {damageFormula:'(0.8*attack+0.1*level+4+2*level)*(1+(enemyMaxHp-enemyHp)/enemyMaxHp)',...assassin({resetOwnCooldownOnKill:true})});
add('백어택','common','damage','enemy',1,2,2,
  `적에게 ${C('1.2*attack+0.15*level+2+level')} 고정 피해를 입힌다.\n고정 피해는 대상의 방어막을 무시한다.`,
  {damageFormula:'1.2*attack+0.15*level+2+level',...assassin({fixedDamage:true,bypassShield:true})});
add('재빠른 행동','uncommon','buff','self',0,2,1,
  '행동력을 1 획득한다.\n강화 불가.',
  {actionPointModify:{currentActionPointAdd:1}},{fixed:true,ready:true,mechanics:'actionPointModify'});
add('눈 찌르기','uncommon','damage','enemy',1,2,1,
  `적에게 ${C('0.5*attack+0.07*level+2+level')} 피해를 2회 입힌다.\n적중한 대상의 명중률을 2턴간 ${C('35+5*level')}%p 감소시킨다.`,
  {hitCount:2,damageFormula:'0.5*attack+0.07*level+2+level',combat:{onEachHit:[{operation:'applyEffect',effectId:'effect_v2_accuracy_down',valueFormula:'-(35+5*level)',durationType:'turn',durationTurns:2,when:{formula:'enemyHp'}}]}},
  {hits:2,mechanics:'effect_v2_accuracy_down',notes:'명중률 감소는 기존 공통 효과를 사용한다. 2턴, 재적중 시 갱신하며 중복 합산하지 않는다.'});
add('공격은 최선의 방어','uncommon','damage','enemy',2,3,3,
  `적에게 ${C('1.5*attack+0.1*level+5+2*level')} 피해를 입힌다.\n스킬 사용 후 내 방어막이 0이면 실제 입힌 피해의 50%만큼 방어막을 얻는다.`,
  {damageFormula:'1.5*attack+0.1*level+5+2*level',...assassin({shieldFromDamageIfUnshielded:{percent:50,checkTiming:'afterSkill',damageBasis:'actualDamage'}})});
add('반사','uncommon','shield','self',1,2,2,
  `${C('defense+5+level')} 방어막을 얻는다.\n이번 턴 방어막으로 받은 피해의 ${C('100+10*level')}%를 공격한 적에게 돌려준다.`,
  {shieldFormula:'defense+5+level',...assassin({reflectBlockedDamage:{duration:'currentTurn',percentFormula:'100+10*level',target:'attacker',preventReflectionLoop:true}})});
add('무릎을 꿇은 이유','rare','damage','all',2,3,1,
  `모든 적에게 ${C('attack+3+2*level')} 피해를 입힌다.\n내 체력이 최대 체력의 ${C('45+5*level')}% 미만이면 같은 피해를 1회 더 입힌다.`,
  {damageFormula:'attack+3+2*level',...assassin({extraHitIfPlayerHpBelowPercentFormula:'45+5*level',extraHits:1,conditionCheck:'beforeSkill'})});
add('맞다이','rare','debuff','enemy',0,1,0,
  `적에게 “맞다이” 표식을 부여한다.\n표식 대상에게 입히는 피해가 ${C('45+5*level')}% 증가하지만, 그 대상에게 받는 피해도 ${C('33-3*level|min:0')}% 증가한다.`,
  assassin({duelMark:{durationType:'stage',outgoingBonusPercentFormula:'45+5*level',incomingBonusPercentFormula:'33-3*level',incomingMinimumPercent:0,target:'selectedEnemy'}}));
add('은신','rare','buff','self',1,1,2,
  `다음 적의 공격을 1회 무조건 회피한다.\n전투당 ${C('1+level')}회 사용할 수 있다.`,
  assassin({guaranteedEvade:{charges:1,consume:'nextEnemyAttack',durationType:'stage'}}),{limitFormula:'1+level'});
add('유리대포','rare','buff','self',1,1,0,
  `3턴간 최대 체력이 10% 감소한다.\n같은 기간 감소한 최대 체력의 ${C('50+5*level')}%만큼 공격력이 증가한다.`,
  assassin({glassCannon:{durationTurns:3,maxHpReductionPercent:10,attackFromLostMaxHpPercentFormula:'50+5*level',snapshotBaseMaxHp:true,restoreMaxHpOnExpiry:true}}));
add('암살','epic','damage','enemy',2,2,2,
  `적에게 ${C('1.3*attack+0.2*level+7+3*level')} 고정 피해를 입힌다.\n대상을 처치하지 못하면 자신이 ${C('10-2*level|min:0')} 피해를 입는다.\n고정 피해와 이 자가 피해는 방어막을 무시한다.`,
  {damageFormula:'1.3*attack+0.2*level+7+3*level',...assassin({fixedDamage:true,bypassShield:true,selfDamageIfTargetSurvives:{amountFormula:'10-2*level',minimum:0,bypassShield:true}})});
add('초크','epic','damage','enemy',1,2,2,
  `적에게 ${C('0.33*attack+0.05*level+3+level')} 피해를 입힌다.\n적중 시 대상은 1턴간 기절한다.`,
  {damageFormula:'0.33*attack+0.05*level+3+level',combat:{onEachHit:[{operation:'applyEffect',effectId:'effect_v2_stun',durationType:'turn',durationTurns:1}]}},
  {ready:true,attackEffect:'blunt',mechanics:'effect_v2_stun'});
add('무지개 반사','legendary','buff','self',1,1,2,
  '다음 1턴간 회피율이 30%p 증가한다.\n스킬 사용 후 바로 다음 턴에 공격 회피에 성공하면 공격한 적에게 원래 받을 피해의 3배를 돌려준다.',
  assassin({evasion:{duration:'nextTurn',valueFormula:'30'},reflectOnEvade:{activeTurnOffset:1,durationTurns:1,damageMultiplier:3,damageBasis:'wouldReceiveDamage',target:'attacker'}}),{limit:1});
add('여유로운 발걸음','legendary','buff','self',0,0,1,
  `3턴간 최대 행동력이 1 증가한다.\n행동력을 남기고 턴을 넘기면 남은 행동력 × ${C('10+3*level')}%p만큼 회피율이 1턴간 증가한다.`,
  assassin({reserveAction:{durationTurns:3,maxActionPointBonus:1,evasionPerUnusedApFormula:'10+3*level',evasionDuration:'followingEnemyTurn',snapshotUnusedApBeforeTurnReset:true}}),{limit:1});
add('처형자의 보상','unique','buff','self',2,0,3,
  '스킬 사용 후 이번 스테이지에서 적을 처치할 때마다 스탯 포인트를 1 획득한다.\n처치한 타격의 피해가 대상의 타격 직전 남은 체력보다 높으면 초과 피해의 절반만큼 체력을 회복한다.\n강화 불가.',
  assassin({killReward:{durationType:'stage',statPointsPerKill:1,healFromOverkillPercent:50,overkillBasis:'killingHitDamageMinusHpBeforeHit',oncePerVictim:true}}),
  {fixed:true,limit:1,notes:'마지막 일격은 스킬명이 아니라 적을 처치한 타격으로 해석.'});

// Only persistent states need an Effects definition. One-shot execution options
// stay in Skills; shared statuses (accuracy down, stun) reuse existing effects.
const effects=[],effectRules=[];
const persistentParameters=['evasion','guaranteedEvade','reflectBlockedDamage','duelMark','glassCannon','reserveAction','killReward'];
for(const skill of skills){
  const rule=JSON.parse(skill.effectJson),config=rule.combat && rule.combat.assassin;
  if(!config)continue;
  delete rule.combat.assassin;
  if(!persistentParameters.some(key=>config[key])){
    // effectRules is the engine's existing generic execution-options object;
    // without effectRuleIds it does not load or create an Effects row.
    rule.combat.effectRules=config;
    skill.effectJson=JSON.stringify(rule);
    skill.mechanicIds=Object.keys(config).map(key=>'combat.'+key).join(',');
    continue;
  }
  const effectId=skill.skillId.replace('skill_','effect_');
  effects.push({effectId,name:skill.name,category:skill.target==='enemy'?'debuff':'buff',baseValue:0,
    durationType:'stage',durationTurns:0,stackMode:'replace',maxStacks:1,reapplyDurationPolicy:'refresh',
    durationClock:'turns',decayTiming:'none',decayStacks:0,decrementOnApplyTurn:true,
    description:skill.description,rulesVersion:2,behaviorJson:'',effectType:'flat',value:0,stackable:false});
  function emit(object,prefix=''){
    for(const [key,value] of Object.entries(object)){
      const field=prefix?prefix+'.'+key:key;
      if(value && typeof value==='object')emit(value,field);
      else effectRules.push({effectId,ruleOrder:effectRules.filter(r=>r.effectId===effectId).length+1,
        triggerTiming:field.startsWith('counterOnEvade')||field.startsWith('reflectOnEvade')?'onEvade':
          field.startsWith('reflectBlockedDamage')?'onBlock':field.startsWith('killReward')||field==='resetOwnCooldownOnKill'?'onKill':'passive',
        operation:'combatParameter',statKey:field,valueMode:typeof value==='string'?'text':'json',
        valueFormula:typeof value==='string'?value:JSON.stringify(value),shieldPolicy:'',description:skill.name+' · '+field});
    }
  }
  emit(config);
  rule.combat.effectRuleIds=[effectId];
  skill.effectJson=JSON.stringify(rule);skill.mechanicIds=effectId;
}
const pack={source:'사용자 암살 스킬 기획 및 초크·암살 난이도 확인 (2026-10-19)',effects,effectRules,
  notes:['18개 전부 공통 엔진 연결 및 보상 활성화.',
    '눈 찌르기의 명중 감소는 2턴으로 적용한다.',
    'ㅇㅇ 이름은 여유로운 발걸음 / 처형자의 보상으로 명명했다.'],skills};
if(require.main===module){
  const file=path.resolve(__dirname,'../docs/skill-packs/assassin-skills-2026-10-19.json');
  fs.writeFileSync(file,JSON.stringify(pack,null,2)+'\n');
  console.log(`${skills.length} assassin skill definitions -> ${file}`);
}
module.exports=pack;
