// n in the design is the skill level (starting at 1). Use `level` in
// executable formulas to preserve legacy skills whose n starts at zero.
const fs = require('node:fs');
const path = require('node:path');
const burn = 'effect_v2_burn';
const apply = (stacksFormula, extra = {}) => ({operation:'applyEffect',effectId:burn,stacksFormula,...extra});
const selfBurn = (stacks, chanceFormula) => ({operation:'applyEffect',effectId:burn,target:'self',stacks,chanceFormula});
const consume = target => ({operation:'consumeStacks',effectId:burn,amountFormula:'targetStacks',...(target ? {target} : {})});
const C = formula => `{calc:${formula}}`;
const chance = formula => C(formula+'|min:0|max:100');
const data = [];
function add(name, rarity, type, target, ap, cooldown, difficulty, description, rule, limit) {
  const condition = typeof limit === 'string' ? {perBattleLimitFormula:limit} : limit ? {perBattleLimit:limit} : {};
  data.push({skillId:`skill_v2_burn_${String(data.length+1).padStart(2,'0')}`,name,hitCount:1,cooldown,
    conditionJson:JSON.stringify(condition),description,effectJson:JSON.stringify({targetMode:target==='self'?'self':target==='all'?'allEnemies':'singleEnemy',...rule}),
    rewardEnabled:1,type,target,baseValue:0,difficultyBonus:difficulty,upgradeJson:'{}',actionPointCost:ap,rarity,
    tags:JSON.stringify(['burn','발화',type]),attackEffect:type==='damage'?'fire':'none'});
}
add('횃불 휘두르기','common','damage','enemy',1,1,1,
  `한 적에게 ${C('(0.8+0.1*level)*attack+2+level')} 피해를 주고 발화 ${C('1+level')}중첩을 부여한다. 2턴간 회피율을 ${C('5+5*level')}%p 감소시킨다. ${chance('30-5*level')}% 확률로 자신에게 발화 1중첩을 부여한다.`,
  {damageFormula:'(0.8+0.1*level)*attack+2+level',combat:{onEachHit:[apply('1+level'),{operation:'applyEffect',effectId:'effect_v2_burn_evasion_down',valueFormula:'-(5+5*level)'}]},actions:[selfBurn(1,'30-5*level')]},3);
add('불붙이기','common','debuff','enemy',1,2,0,
  `한 적에게 발화 ${C('3+2*level')}중첩을 부여한다. 사용 전 이미 발화 상태였다면 다른 모든 적에게 발화 ${C('1+level')}중첩을 부여한다. ${chance('20-5*level')}% 확률로 자신에게 발화 2중첩을 부여한다.`,
  {actions:[apply('1+level',{target:'allEnemies',excludeSelected:true,when:{formula:'selectedBurn'}}),apply('3+2*level'),selfBurn(2,'20-5*level')]});
add('핫팩','common','heal','self',0,0,1,
  `체력을 ${C('3+level+enemyBurnTotal+2*level')} 회복한다. 기본 회복 ${C('3+level')}에 적 전체의 발화 중첩 합계와 ${C('2*level')}을 더한 값이다.`,
  {healFormula:'3+level+enemyBurnTotal+2*level'},1);
add('불씨 방패','common','shield','self',1,2,0,
  `${C('defense+2+level')} 방어막을 얻는다. 이번 턴 방어막에 피해를 입힌 적에게 발화 ${C('2+level')}중첩을 부여한다.`,
  {shieldFormula:'defense+2+level',onBlock:{durationType:'turn',durationTurns:1,replaceExisting:true,actions:[apply('2+level')]}});
add('화염 스프레이','common','damage','all',1,2,1,
  `모든 적에게 ${C('3+level+0.8*attack+0.1*level')} 피해를 주고 발화 ${C('2+level')}중첩을 부여한다. ${chance('30-5*level')}% 확률로 자신에게 발화 2중첩을 부여한다.\n“절대 따라하지 말자”`,
  {damageFormula:'3+level+0.8*attack+0.1*level',combat:{onEachHit:[apply('2+level')]},actions:[selfBurn(2,'30-5*level')]});
add('라이터 투척','uncommon','damage','enemy',1,2,2,
  `한 적에게 ${C('1.2*attack+0.1*level+2*level')} 피해를 주고, 대상의 발화 중첩 수만큼 고정 피해를 추가로 준다.\n“주머니에 이게 왜 있는지는 모르겠다”`,
  {damageFormula:'1.2*attack+0.1*level+2*level',combat:{onEachHit:[{operation:'damage',effectId:burn,damageKind:'additional',amountFormula:'initialTargetBurn'}]}},1);
add('가스누출','uncommon','damage','all',2,2,1,
  `발화 상태인 모든 적에게 ${C('8+2*level+0.5*attack')} 피해를 준다. 각 대상의 발화 1중첩당 피해가 ${C('10+3*level')}%씩 증가한다. 자신도 발화 상태라면 기본 ${C('5-level|min:0')} 피해에 자신의 발화 중첩에 따른 같은 증가율을 적용해 피해를 받는다.`,
  {actions:[{operation:'damage',effectId:burn,target:'allEnemies',requireEffect:burn,amountFormula:'(8+2*level+0.5*attack)*(1+targetBurn*(10+3*level)/100)*efficiency'},
    {operation:'damage',effectId:burn,target:'self',requireEffect:burn,amountFormula:'(5-level)*(1+selfBurn*(10+3*level)/100)'}]});
add('소화기 투척','uncommon','damage','enemy',1,1,0,
  `한 적에게 ${C('1.2*attack+5+2*level')} 피해를 준다. 적중 시 대상의 발화를 모두 소모하고, 소모한 중첩당 ${C('7+level')}%p 명중률을 2턴간 감소시킨다. 자신의 발화를 모두 제거하고 이번 턴 회피율이 ${C('25+3*level')}%p 증가한다.`,
  {damageFormula:'1.2*attack+5+2*level',combat:{onEachHit:[consume(),{operation:'applyEffect',effectId:'effect_v2_burn_accuracy_down',valueFormula:'-consumedStacks*(7+level)',when:{formula:'consumedStacks'}}]},
    actions:[{operation:'removeEffect',target:'self',effectId:burn},{operation:'applyEffect',target:'self',effectId:'effect_v2_burn_evasion_up',valueFormula:'25+3*level'}]});
add('화중 방어','uncommon','shield','self',1,2,0,
  `${C('1.2*defense+10+2*level')} 방어막을 얻고 자신에게 발화 3중첩을 부여한다.`,
  {shieldFormula:'1.2*defense+10+2*level',actions:[apply('3',{target:'self'})]});
add('불씨 던지기','uncommon','debuff','enemy',1,0,0,
  `한 적에게 발화 ${C('2+level')}중첩을 부여한다.`,{actions:[apply('2+level')]});
add('열기 회수','uncommon','buff','enemy',0,1,0,
  `한 적과 자신의 발화를 모두 소모하여 행동력을 1 회복한다. 총 소모 중첩이 ${C('6-level|min:0')} 이상이면 행동력을 2 회복한다.`,
  {actions:[consume(),consume('self'),{operation:'actionPoint',target:'self',amount:1},
    {operation:'actionPoint',target:'self',amount:1,when:{formula:'totalConsumedStacks',minFormula:'6-level'}}]});
add('폭발','rare','damage','enemy',3,0,1,
  `선택한 적의 발화를 모두 소모한다. 소모한 중첩당 선택한 적 최대 체력의 2%+5 피해를 모든 적에게 준다. 현재 선택한 적 기준 중첩당 ${C('selectedMaxHp*0.02+5')} 피해.`,
  {actions:[consume(),{operation:'damage',target:'allEnemies',damageKind:'explosion',amountFormula:'totalConsumedStacks*(selectedMaxHp*0.02+5)*efficiency'}]});
add('쥐불놀이','rare','damage','all',2,2,2,
  `모든 적에게 ${C('0.9*attack+2+level')} 피해를 주고 발화 ${C('1+level')}중첩을 부여한다. 이미 발화 상태였던 적에게는 ${C('0.3*attack+1+level')} 피해를 사용 전 발화 중첩 수만큼 추가로 준다. ${chance('30-5*level')}% 확률로 자신에게 발화 2중첩을 부여한다.`,
  {damageFormula:'0.9*attack+2+level',combat:{onEachHit:[{operation:'damage',effectId:burn,amountFormula:'(0.3*attack+1+level)*efficiency',repeatFormula:'initialTargetBurn'},apply('1+level')]},actions:[selfBurn(2,'30-5*level')]});
add('부채질','rare','debuff','enemy',1,1,0,
  `선택한 적의 발화 중첩을 2배로 늘린다. 증가한 뒤의 중첩 수+${C('2*level')} 피해를 모든 적에게 준다.`,
  {actions:[apply('targetBurn'),{operation:'damage',effectId:burn,target:'allEnemies',amountFormula:'(selectedBurn+2*level)*efficiency'}]},'1+level');
add('자나깨나 불조심','epic','heal','self',1,0,0,
  `자신을 포함한 모든 대상의 발화를 모두 소모한다. 소모한 중첩당 체력을 ${C('2+level')} 회복하고 방어막을 ${C('4+2*level')} 얻는다.`,
  {actions:[consume('allEnemies'),consume('self'),{operation:'heal',target:'self',amountFormula:'totalConsumedStacks*(2+level)*efficiency'},
    {operation:'shield',target:'self',amountFormula:'totalConsumedStacks*(4+2*level)*efficiency'}]},1);
add('불장난','epic','damage','all',2,3,2,
  `모든 적에게 ${C('attack+3+2*level')} 피해를 준다. 실제 피해를 입은 적의 발화 중첩을 2배로 늘린다.`,
  {damageFormula:'attack+3+2*level',combat:{onEachHit:[apply('targetBurn',{when:{formula:'hitDamage'}})]}});
add('불주먹','legendary','damage','enemy',1,1,1,
  `한 적에게 ${C('1.1*attack+2+level')} 피해를 주고 발화 ${C('2+level')}중첩을 부여한다.\n“내가 oo고 불주먹이여”`,
  {damageFormula:'1.1*attack+2+level',combat:{onEachHit:[apply('2+level')]}});
add('태양인','unique','buff','self',2,0,2,
  `이번 턴을 포함해 3턴간 피해를 입힌 적에게 발화 ${C('2+level')}중첩을 부여한다. 자신이 피해를 받으면 자신에게 발화 1중첩을 부여한다. 방어막으로 흡수한 피해와 발화 피해도 포함한다.`,
  {onDamage:{durationType:'turn',durationTurns:3,replaceExisting:true,actions:[apply('2+level',{when:{formula:'eventIsEnemy'}}),apply('1',{target:'self',when:{formula:'eventIsPlayer'}})]}},1);

const effects = [
  {effectId:burn,name:'발화',category:'debuff',durationClock:'stacks',stackMode:'add',stackable:true,triggerTiming:'turnEnd',maxStacks:2147483647,description:'턴 종료 시 중첩당 최대 체력의 1.5% 피해를 받는다. 방어막이 먼저 흡수한다. 중첩은 자동 감소하지 않는다.'},
  {effectId:'effect_v2_burn_evasion_down',name:'불빛 노출',category:'debuff',statKey:'evasion',durationTurns:2,description:'2턴간 회피율이 {value}%p 감소한다.'},
  {effectId:'effect_v2_burn_accuracy_down',name:'소화 분말',category:'debuff',statKey:'accuracy',durationTurns:2,description:'2턴간 명중률이 {value}%p 감소한다.'},
  {effectId:'effect_v2_burn_evasion_up',name:'연막 회피',category:'buff',statKey:'evasion',durationTurns:1,decrementOnApplyTurn:true,description:'이번 턴 회피율이 {value}%p 증가한다.'},
].map(e=>({baseValue:0,durationType:'turn',durationTurns:1,stackMode:'replace',maxStacks:1,reapplyDurationPolicy:'refresh',durationClock:'turns',decayTiming:'none',decayStacks:0,
  decrementOnApplyTurn:false,rulesVersion:2,statKey:'',effectType:'flat',value:0,stackable:false,triggerTiming:'',damageFormula:'',behaviorJson:'',...e}));
const effectRules=effects.map(e=>({effectId:e.effectId,ruleOrder:1,triggerTiming:e.effectId===burn?'turnEnd':'passive',operation:e.effectId===burn?'damage':'modifyStat',
  statKey:e.effectId===burn?'hp':e.statKey,valueMode:'flat',valueFormula:e.effectId===burn?'maxHp*stacks*0.015':'value',shieldPolicy:e.effectId===burn?'absorb':'',description:e.description}));
const pack={source:'사용자 발화 스킬 기획 및 2026-10-19 수식 해석 확인',skills:data,effects,effectRules};
if(require.main===module){
  const file=path.resolve(__dirname,'../docs/skill-packs/ignition-skills-2026-10-19.json');
  fs.writeFileSync(file,JSON.stringify(pack,null,2)+'\n');
  console.log(`${data.length} skills, ${effects.length} effects, ${effectRules.length} rules -> ${file}`);
}
module.exports=pack;
