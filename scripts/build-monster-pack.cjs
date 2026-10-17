// Canonical import data for the school monster pack. Runtime reads only sheets.
const fs = require('node:fs');
const path = require('node:path');
const damage = (multiplier, extra={}) => ({op:'damage',multiplier,...extra});
const stat = (stat,value,extra={}) => ({op:'stat',stat,value,...extra});
const dot = (value,durationTurns) => ({op:'dot',target:'player',value,durationTurns});
const periodic = (every,actions,extra={}) => ({trigger:'action',every,actions,...extra});
const half = actions => ({trigger:'hpBelow',hpBelowPercent:50,once:true,actions});
const start = actions => ({trigger:'battleStart',once:true,actions});
const charged = (multiplier,extra={}) => periodic(4,[damage(multiplier)],{firstAction:1,chargeTurns:1,...extra});
const skills=[], monsters=[];
function monster(monsterId,name,type,numbers,attackEffect,definitions) {
  const [hp,attack,hpRegen,evasion,criticalRate,criticalDamage,defense]=numbers;
  const ids=definitions.map(([suffix,name,description,rule,effect])=>{
    const skillId='ms_'+suffix;
    const hitCount=rule.actions.find(a=>a.op==='damage')?.hitCount || 1;
    rule.actions.forEach(a=>{if(a.op==='damage')delete a.hitCount;});
    skills.push({skillId,name,hitCount,
      cooldown:0,conditionJson:'{}',description,effectJson:JSON.stringify({monsterSkill:rule}),rewardEnabled:false,
      type:rule.actions.some(a=>a.op==='damage')?'damage':'buff',target:rule.actions.some(a=>a.op==='damage')?'enemy':'self',
      baseValue:0,difficultyBonus:0,upgradeJson:'{}',actionPointCost:0,rarity:'common',tags:'["monsterOnly"]',attackEffect:effect || 'none'});
    return skillId;
  });
  monsters.push({monsterId,name,type,hp,attack,hpRegen,evasion,criticalRate,criticalDamage,defense,
    aiId:'ai_monster_kit',skillIds:JSON.stringify(ids),description:definitions.map(d=>d[1]+': '+d[2]).join(' / '),attackEffect});
}
monster('monster_test_ghost','망한 시험지 유령','normal',[30,8,0,12,10,150,2],'slash',[
  ['red_mark','빨간 빗금','3턴마다 80% 피해. 적중 시 플레이어 공격력 2턴간 15% 감소.',periodic(3,[damage(.8),stat('attack',-15,{mode:'percent',target:'player',durationTurns:2,requiresHit:true})]),'slash'],
  ['crumpled_paper','구겨진 답안지','HP 50% 이하에서 한 번, 2턴간 회피율 +15%p.',half([stat('evasion',15,{durationTurns:2})])],
]);
monster('monster_Pigeon','이상한 비둘기','normal',[35,10,0,15,15,175,2],'thrust',[
  ['double_peck','연속 쪼기','3턴마다 65% 피해로 2회 공격.',periodic(3,[damage(.65,{hitCount:2})]),'thrust'],
  ['puffed_feathers','깃털 부풀리기','전투 시작 시 다음에 받는 직접 공격 1타의 피해 50% 감소.',start([{op:'reduction',value:50,nextHit:true}])],
]);
monster('monster_Outdoor','녹슨 실외기','normal',[65,18,0,0,0,150,8],'blunt',[
  ['overheat','과열 배기','1·5·9번째 행동부터 한 턴 충전 후 180% 피해. 사용 후 한 턴 휴식.',charged(1.8,{restTurns:1}),'fire'],
  ['rust_fragments','녹슨 파편','근접 직접 공격을 받으면 2 피해 반사.',{trigger:'onDamaged',meleeOnly:true,actions:[damage(0,{value:2,unavoidable:true,canCritical:false,damageKind:'reflection'})]},'thrust'],
]);
monster('monster_Chair','기괴한 의자','normal',[40,13,0,15,10,150,5],'blunt',[
  ['trip','다리 걸기','3턴마다 100% 피해. 적중 시 플레이어 회피율 2턴간 15%p 감소.',periodic(3,[damage(1),stat('evasion',-15,{target:'player',durationTurns:2,requiresHit:true})]),'blunt'],
  ['rattle_counter','덜컹 반격','공격을 회피하면 60% 피해로 반격. 턴당 한 번.',{trigger:'onEvade',oncePerTurn:true,actions:[damage(.6)]},'blunt'],
]);
monster('monster_Desk','살아있는 책상','normal',[65,12,0,0,0,150,10],'blunt',[
  ['desk_flip','책상 뒤집기','3턴마다 140% 피해.',periodic(3,[damage(1.4)]),'blunt'],
  ['broken_desktop','부서진 상판','HP 50% 이하에서 한 번, 방어력 -5, 공격력 +5.',half([stat('defense',-5),stat('attack',5)])],
]);
monster('monster_Book','저주받은 교과서','normal',[45,11,0,5,5,150,4],'slash',[
  ['cursed_sentence','저주의 문장','3턴마다 70% 피해. 적중 시 다음 2턴 시작마다 저주 피해 3. 중첩 불가.',periodic(3,[damage(.7),{...dot(3,2),requiresHit:true}]),'slash'],
  ['close_book','책장 덮기','HP 50% 이하에서 한 번, 다음에 받는 직접 공격 1타의 피해 70% 감소.',half([{op:'reduction',value:70,nextHit:true}])],
]);
monster('monster_Locker','사물함 미믹','normal',[75,16,0,0,10,170,10],'thrust',[
  ['chomp','덥석!','전투 첫 행동에 150% 피해.',periodic(1,[damage(1.5)],{firstAction:1,once:true,priority:10}),'thrust'],
  ['rusty_teeth','녹슨 이빨','3턴마다 100% 피해. 적중 시 플레이어 방어력 2턴간 25% 감소.',periodic(3,[damage(1),stat('defense',-25,{mode:'percent',target:'player',durationTurns:2,requiresHit:true})]),'thrust'],
]);
monster('monster_Exit','비상구 괴물','normal',[70,18,0,10,15,150,6],'blunt',[
  ['exit_charge','출구 돌진','1·5·9번째 행동부터 한 턴 준비 후 170% 피해.',charged(1.7),'blunt'],
  ['flickering_sign','깜빡이는 유도등','출구 돌진 후 다음 1턴 동안 회피율 +20%p.',{trigger:'afterSkill',afterSkillId:'ms_exit_charge',actions:[stat('evasion',20,{durationTurns:1})]}],
]);
monster('monster_Cabinet','캐비넷 미믹','normal',[110,20,0,0,5,175,14],'blunt',[
  ['iron_press','철제 압착','1·5·9번째 행동부터 한 턴 준비 후 200% 피해. 직후 다음 1턴 동안 방어력 0.',charged(2,{actions:[damage(2),stat('defense',-100,{mode:'percent',durationTurns:1})]}),'blunt'],
  ['thick_iron','두꺼운 철판','HP가 50%보다 많을 때 받는 직접 피해 20% 감소.',start([{op:'reduction',value:20,hpAbovePercent:50}])],
]);
monster('monster_Ghost','귀신','normal',[35,20,0,25,0,150,0],'slash',[
  ['cold_touch','차가운 손길','3턴마다 100% 피해. 피해의 50%는 방어막을 관통.',periodic(3,[damage(1,{shieldPiercePercent:50})]),'slash'],
  ['drain_life','생기 흡수','HP 50% 이하에서 일반 공격이 적중하면 HP 3 회복.',{trigger:'onBasicHit',hpBelowPercent:50,actions:[{op:'heal',value:3}]}],
]);
monster('monster_Write','필기구 뭉치','normal',[35,8,0,15,30,175,2],'thrust',[
  ['pencil_barrage','샤프심 난사','3턴마다 50% 피해로 3회 공격.',periodic(3,[damage(.5,{hitCount:3})]),'thrust'],
  ['sharp_nib','날카로운 펜촉','치명타 적중 시 다음 턴 시작에 출혈 피해 3. 중첩 불가.',{trigger:'onCritical',actions:[dot(3,1)]}],
]);
monster('monster_Computer','오래된 컴퓨터','normal',[80,15,0,0,0,150,10],'blunt',[
  ['not_responding','응답 없음','1·5·9번째 행동에 멈춘 뒤 다음 행동에 강제 종료로 180% 피해.',charged(1.8),'blunt'],
  ['reboot','재부팅','HP 50% 이하에서 한 번, HP 15 회복하고 방어력 5 감소.',half([{op:'heal',value:15},stat('defense',-5)])],
]);
monster('boss_Door','저주받은 출입문','boss',[130,15,0,0,0,150,15],'blunt',[
  ['door_slam','문짝 강타','1·5·9번째 행동부터 한 턴 준비 후 180% 피해.',charged(1.8),'blunt'],
  ['exposed_hinge','경첩 노출','문짝 강타 직후 다음 1턴 동안 방어력 0.',{trigger:'afterSkill',afterSkillId:'ms_door_slam',actions:[stat('defense',-100,{mode:'percent',durationTurns:1})]}],
  ['broken_lock','잠금장치 파손','HP 50% 이하에서 한 번, 공격력 30% 증가, 방어력 5 감소.',half([stat('attack',30,{mode:'percent'}),stat('defense',-5)])],
]);
monster('boss_Ghost','분필 가루 망령','boss',[220,20,0,5,5,150,8],'slash',[
  ['chalk_barrage','분필 세례','3턴마다 50% 피해로 3회 공격.',periodic(3,[damage(.5,{hitCount:3})]),'thrust'],
  ['eraser_dust','지우개 털기','4턴마다 다음 2턴 시작에 분진 피해 4. 중첩 불가. 주기가 겹치면 분필 세례 후 사용.',periodic(4,[dot(4,2)],{priority:-1})],
  ['scattered_body','흩어지는 몸','HP 50% 이하에서 한 번, 회피율 +15%p, 방어력 0.',half([stat('evasion',15),stat('defense',-100,{mode:'percent'})])],
]);
monster('boss_Mockexam','모의고사 시험지 유령','boss',[300,25,0,10,0,150,10],'slash',[
  ['final_grading','최종 채점','1·5·9번째 행동부터 한 턴 준비 후 180% 피해.',charged(1.8,{priority:10}),'slash'],
  ['wrong_answer','오답 표시','3턴마다 80% 피해. 적중 시 플레이어 공격력 2턴간 20% 감소.',periodic(3,[damage(.8),stat('attack',-20,{mode:'percent',target:'player',durationTurns:2,requiresHit:true})]),'slash'],
  ['exam_deadline','시험 종료 임박','HP 50% 이하에서 한 번, 공격력 25% 증가, 방어력 5 감소.',half([stat('attack',25,{mode:'percent'}),stat('defense',-5)])],
]);
monster('boss_Human','인체모형','boss',[420,28,0,0,5,150,15],'blunt',[
  ['severed_limbs','분리된 사지','3턴마다 60% 피해로 3회 공격.',periodic(3,[damage(.6,{hitCount:3})]),'blunt'],
  ['bone_armor','골격 강화','전투 시작 시 보호막 40. 소진될 때까지 턴이 지나도 유지.',start([{op:'shield',value:40}])],
  ['muscle_rampage','근육 폭주','HP 50% 이하에서 한 번, 공격력 25% 증가, 방어력 0.',half([stat('attack',25,{mode:'percent'}),stat('defense',-100,{mode:'percent'})])],
]);
monster('boss_floor_5','???','finalBoss',[666,35,0,5,0,150,15],'slash',[
  ['expulsion','퇴학 처분','1·5·9번째 행동부터 한 턴 준비 후 200% 피해.',charged(2,{priority:10}),'slash'],
  ['attendance','출석 확인','3턴마다 80% 피해 후 공격력 +3. 공격력 증가는 최대 5회.',periodic(3,[damage(.8),stat('attack',3,{perUse:true,maxStacks:5})]),'slash'],
  ['last_homeroom','마지막 종례','HP 50% 이하에서 한 번, 방어력 0. 퇴학 처분이 110% 피해 2연타로 변경.',half([stat('defense',-100,{mode:'percent'}),{op:'overrideSkill',skillId:'ms_expulsion',multiplier:1.1,hitCount:2}])],
]);
const pack={version:1,Monsters:monsters,Skills:skills,MonsterAI:[{aiId:'ai_monster_kit',patternName:'School monster kit fallback',actionType:'attack',conditionJson:'{}',probability:100,skillId:'',intentIcon:'sword',intentTextTemplate:''}]};
if(require.main===module){
  const out=path.join(__dirname,'../tests/fixtures/monster-pack.json');
  fs.writeFileSync(out,JSON.stringify(pack,null,2)+'\n');
  console.log(`Saved ${monsters.length} monsters and ${skills.length} skills to ${out}`);
}
module.exports=pack;
