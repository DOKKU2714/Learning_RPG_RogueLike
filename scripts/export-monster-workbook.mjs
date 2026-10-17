import fs from 'node:fs/promises';
import path from 'node:path';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const loader=createRequire(path.resolve('.tmp_spreadsheet/monster-pack/dependencies.cjs'));
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(loader.resolve('@oai/artifact-tool')).href);
const pack=require('./build-monster-pack.cjs');
const outputDir=path.resolve('outputs/monster-skills-2026-10-17');
const previewDir=path.resolve('.tmp_spreadsheet/monster-pack');
const wb=Workbook.create();
const columns={
  Monsters:['monsterId','name','type','hp','attack','hpRegen','evasion','criticalRate','criticalDamage','defense','aiId','skillIds','description','attackEffect','experience'],
  Skills:['skillId','name','hitCount','cooldown','conditionJson','description','effectJson','rewardEnabled','type','target','baseValue','difficultyBonus','upgradeJson','actionPointCost','rarity','tags','attackEffect'],
  MonsterAI:['aiId','patternName','actionType','conditionJson','probability','skillId','intentIcon','intentTextTemplate'],
};
function letter(n){return String.fromCharCode(65+n);}
for(const [name,headers] of Object.entries(columns)){
  const sheet=wb.worksheets.add(name),rows=pack[name];
  sheet.showGridLines=false;
  const end=letter(headers.length-1),last=rows.length+1;
  sheet.getRange(`A1:${end}${last}`).values=[headers,...rows.map(row=>headers.map(key=>key==='experience' ? (row[key]??(/boss/i.test(row.type)?90:30)) : (row[key]??'')))];
  const body=sheet.getRange(`A1:${end}${last}`);
  body.format.font={name:'Arial',size:10,color:'#172B4D'};
  body.format.verticalAlignment='center';
  body.format.columnWidth=18;
  body.format.rowHeight=name==='Skills'?104:name==='Monsters'?62:32;
  body.format.wrapText=true;
  sheet.getRange(`A1:${end}1`).format={fill:'#243B53',font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},rowHeight:32,wrapText:true};
  sheet.getRange(`A1:${end}1`).format.horizontalAlignment='center';
  sheet.freezePanes.freezeRows(1);
  sheet.freezePanes.freezeColumns(2);
  sheet.getRange(`A2:A${last}`).format.columnWidth=30;
  sheet.getRange(`B2:B${last}`).format.columnWidth=25;
  if(name==='Monsters'){
    sheet.getRange(`D2:J${last}`).setNumberFormat('0');
    sheet.getRange(`D2:J${last}`).format.columnWidth=14;
    sheet.getRange(`D2:J${last}`).format.horizontalAlignment='right';
    sheet.getRange(`L2:L${last}`).format.columnWidth=78;
    sheet.getRange(`M2:M${last}`).format.columnWidth=90;
  } else if(name==='Skills'){
    sheet.getRange(`F2:F${last}`).format.columnWidth=78;
    sheet.getRange(`G2:G${last}`).format.columnWidth=110;
    for(const col of ['C','D','K','L','N'])sheet.getRange(`${col}2:${col}${last}`).setNumberFormat('0');
    sheet.getRange(`C2:E${last}`).format.columnWidth=17;
    sheet.getRange(`E2:E${last}`).format.horizontalAlignment='center';
    sheet.getRange(`M2:M${last}`).format.horizontalAlignment='center';
    sheet.getRange(`H2:Q${last}`).format.columnWidth=18;
  } else {
    sheet.getRange('B2').format.columnWidth=42;
    sheet.getRange('D2').format.columnWidth=24;
  }
  for(let row=2;row<=last;row++)if(row%2===0)sheet.getRange(`A${row}:${end}${row}`).format.fill='#F0F4F8';
  if(name==='Monsters'){
    sheet.getRange(`C2:C${last}`).dataValidation={rule:{type:'list',values:['normal','boss','finalBoss']}};
    sheet.getRange(`N2:N${last}`).dataValidation={rule:{type:'list',values:['slash','blunt','thrust','fire','none']}};
  }
}
const notes=wb.worksheets.add('사용안내');
notes.showGridLines=false;
const instructions=[
 ['구분','적용 방법'],
 ['Monsters','기존 17개 monsterId 행을 이 파일의 값으로 수정합니다. 기존 다른 몬스터 행은 유지합니다.'],
 ['Skills','ms_로 시작하는 39개 행을 기존 Skills 아래에 추가합니다. 같은 skillId가 이미 있으면 해당 행을 수정하고 중복 추가하지 않습니다.'],
 ['헤더 확인','Skills 열 순서는 skillId, name, hitCount, cooldown, conditionJson, description, effectJson, rewardEnabled, type, target, baseValue, difficultyBonus, upgradeJson, actionPointCost, rarity, tags, attackEffect입니다. 원본 순서가 다르면 헤더 이름으로 맞춰 복사합니다.'],
 ['MonsterAI','ai_monster_kit 행 1개를 추가합니다. 기존 다른 AI 행은 유지합니다. 이 행은 새 스킬 설정이 없는 경우의 기본공격입니다.'],
 ['반영 순서','수정 코드 업로드, Monsters 수정, Skills 추가, MonsterAI 추가 후 Apps Script에서 validateMonsterSkillSheets() 실행. ok:true와 monsters:17, skills:39를 확인합니다. 다른 몬스터 팩이 있으면 개수는 늘어날 수 있습니다.'],
 ['게임 시작','데이터 변경 후 새 게임을 시작합니다. 진행 중인 게임은 시작 시 받은 데이터 스냅샷을 계속 사용합니다.'],
 ['수치 단위','Monsters의 회피율·치명률은 0~100. criticalDamage=150은 공격력의 150%. hpRegen은 행동 가능한 몬스터가 행동하기 직전 회복하는 HP입니다.'],
 ['주기와 조건','effectJson.monsterSkill에서 trigger, every, firstAction, chargeTurns, restTurns, hpBelowPercent를 수정합니다. every=3은 해당 몬스터의 행동 3·6·9회째입니다. 기절로 쉰 행동은 세지 않습니다.'],
 ['충전 공격','첫 행동부터 준비하고 다음 행동에 공격합니다. 기본 every=4이므로 1·5·9회째 준비합니다. 높은 우선순위 스킬과 겹치면 늦어질 수 있습니다.'],
 ['충돌 우선순위','충전 중인 행동, 휴식, priority가 높은 사용 가능한 스킬, 일반 공격 순서입니다. 밀린 주기 스킬은 다음 가능한 행동에 사용하며 원래 주기를 유지합니다.'],
 ['배율·연타','actions의 multiplier=1.8은 공격력 180%. 일반 연타 횟수는 Skills.hitCount에서 수정합니다. 각 타격마다 회피·치명타·방어막을 따로 계산합니다.'],
 ['효과 지속','durationTurns=2는 적용 시점부터 다음 두 턴 종료까지입니다. 적용된 턴 종료에는 감소하지 않습니다. dot는 다음 플레이어 턴 시작부터 지정 횟수만큼 피해를 줍니다.'],
 ['체력 조건','HP 50% 이하는 정확히 절반인 경우를 포함합니다. hpBelow 효과는 공격 피해 처리 직후 또는 다음 행동을 정할 때 한 번 적용되며 행동을 소비하지 않습니다.'],
 ['회복과 피격','생기 흡수는 일반 공격이 적중하고 실제 피해가 있을 때만 회복합니다. 공격 부가 약화는 적중 시에만 적용합니다. 같은 출혈·저주는 중첩되지 않고 지속시간을 갱신합니다.'],
 ['근접 판정','기본공격과 일반 물리 스킬은 근접입니다. Skills.tags에 ranged 또는 spell이 있거나 attackEffect가 fire인 스킬은 녹슨 파편 반사에서 제외됩니다.'],
 ['방어 규칙','기존 게임 규칙을 유지합니다. 방어력은 방어막 생성에 사용되며 직접 피해에서 고정 차감되지 않습니다. 차가운 손길은 피해의 50%가 방어막을 관통합니다.'],
 ['수치 보정','기존의 일반 몬스터 2·3마리 동시 등장 시 HP·공격력 보정은 유지됩니다. 원본 스탯은 Monsters에서 수정합니다.'],
 ['몬스터 전용','39개 스킬의 rewardEnabled는 FALSE로 유지합니다. 플레이어 보상 목록에 등장하지 않도록 하는 값입니다.'],
 ['편집 기준','효과 설명은 표시용입니다. 실제 동작은 effectJson의 monsterSkill 설정, 연타는 hitCount, 공격 연출은 attackEffect 값을 따릅니다. 수정 시 설명도 함께 맞춥니다.'],
 ['원본 반영','이 파일은 수동 반영용입니다. 기존 플레이어 스킬, Effects, EffectRules, Stages, MonsterGroups를 삭제하거나 덮어쓰지 않습니다.'],
];
notes.getRange(`A1:B${instructions.length}`).values=instructions;
notes.getRange(`A1:B${instructions.length}`).format={font:{name:'Arial',size:11,color:'#172B4D'},rowHeight:58,verticalAlignment:'center',wrapText:true};
notes.getRange(`A1:A${instructions.length}`).format.columnWidth=22;
notes.getRange(`B1:B${instructions.length}`).format.columnWidth=120;
notes.getRange('A1:B1').format={fill:'#243B53',font:{name:'Arial',size:11,bold:true,color:'#FFFFFF'},rowHeight:30};
notes.getRange('A4:B4').format.rowHeight=88;
notes.freezePanes.freezeRows(1);
wb.recalculate();
console.log((await wb.inspect({kind:'table',range:'Monsters!A1:J4',include:'values',tableMaxRows:4,tableMaxCols:10,maxChars:2200})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:50},summary:'final formula error scan'})).ndjson);
for(const [name,headers] of Object.entries(columns)){
  const values=wb.worksheets.getItem(name).getRange(`A2:${letter(headers.length-1)}${pack[name].length+1}`).values;
  if(JSON.stringify(values)!==JSON.stringify(pack[name].map(row=>headers.map(key=>row[key]??''))))throw new Error(name+' value verification failed');
}
await fs.mkdir(outputDir,{recursive:true});
await fs.mkdir(previewDir,{recursive:true});
for(const [sheetName,range,suffix] of [
  ['Monsters','A1:J8','monsters'],['Monsters','K1:N4','monster-links'],
  ['Skills','A1:F5','skills'],['Skills','G1:J4','skill-rules'],['Skills','K1:Q5','skill-flags'],
  ['MonsterAI','A1:H2','ai'],['사용안내','A1:B7','instructions'],
]){
  const preview=await wb.render({sheetName,range,scale:1,format:'png'});
  await fs.writeFile(path.join(previewDir,suffix+'.png'),new Uint8Array(await preview.arrayBuffer()));
}
const file=await SpreadsheetFile.exportXlsx(wb);
await file.save(path.join(outputDir,'monster-skills.xlsx'));
console.log('Exported '+path.join(outputDir,'monster-skills.xlsx'));
