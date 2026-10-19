import fs from 'node:fs/promises';
import path from 'node:path';
import vm from 'node:vm';
import {createRequire} from 'node:module';
import {pathToFileURL} from 'node:url';
const require=createRequire(import.meta.url);
const loader=createRequire(path.resolve('.tmp_spreadsheet/dependencies.cjs'));
const {Workbook,SpreadsheetFile}=await import(pathToFileURL(loader.resolve('@oai/artifact-tool')).href);
const pack=require('./build-ignition-pack.cjs');
const c=vm.createContext({});
vm.runInContext(await fs.readFile('Constants.gs','utf8'),c);
const outputDir=path.resolve('outputs/ignition-skills-2026-10-19');
const previewDir=path.resolve('.tmp_spreadsheet/ignition-pack');
await fs.mkdir(outputDir,{recursive:true});await fs.mkdir(previewDir,{recursive:true});
const wb=Workbook.create();
const summary=wb.worksheets.add('스킬목록');
const headerColor='#793C24',textColor='#292524';
function header(sheet,range){sheet.getRange(range).format={fill:headerColor,font:{name:'Arial',size:10,bold:true,color:'#FFFFFF'},rowHeight:30,wrapText:true,horizontalAlignment:'center',verticalAlignment:'center'};}
function base(sheet,range){sheet.showGridLines=false;sheet.getRange(range).format={font:{name:'Arial',size:10,color:textColor},verticalAlignment:'center',rowHeight:24};}
base(summary,'A1:G32');summary.tabColor=headerColor;
summary.getRange('A2').values=[['발화 스킬 18종']];summary.getRange('A2').format.font={name:'Arial',size:15,bold:true,color:headerColor};
summary.getRange('D3:G3').merge();summary.getRange('D3').values=[['노란 셀을 바꾸면 아래 수치와 설명이 계산됩니다.']];summary.getRange('D3').format.font={name:'Arial',size:10,color:'#78716C'};
const inputs=[['스킬 레벨 n',1],['공격력',20],['방어력',10],['선택한 적 발화 중첩',3],['다른 적 발화 중첩 합계',2],['자신의 발화 중첩',2],['선택한 적 최대 체력',1000]];
summary.getRange('A4:B10').values=inputs;
summary.getRange('B4:B10').format.fill='#FFF0BA';summary.getRange('B4:B10').setNumberFormat('0');
summary.getRange('B4:B10').dataValidation={rule:{type:'whole',operator:'greaterThanOrEqual',formula1:0}};
summary.getRange('B4').dataValidation={rule:{type:'whole',operator:'greaterThanOrEqual',formula1:1}};
summary.getRange('B10').dataValidation={rule:{type:'whole',operator:'greaterThanOrEqual',formula1:1}};
summary.getRange('D5:G5').merge();summary.getRange('D5').values=[['발화: 턴 종료에 중첩×최대 체력 1.5% 피해. 방어막으로 흡수. 자동 감소 없음.']];
summary.getRange('D5:G5').format.wrapText=true;summary.getRange('D5:G5').format.rowHeight=38;
summary.getRange('D7:G7').merge();summary.getRange('D7').values=[['스킬목록은 검토용입니다. 게임에는 Skills·Effects·EffectRules 탭의 값을 넣습니다.']];summary.getRange('D7:G7').format.wrapText=true;
summary.getRange('D9:G9').merge();summary.getRange('D9').values=[['출처: 사용자 발화 기획. 모호한 수식은 2026-10-19 확인한 해석을 적용했습니다.']];summary.getRange('D9:G9').format.wrapText=true;
summary.getRange('A13:G13').values=[['스킬 이름','등급','행동력','쿨타임(턴)','최대 횟수','난이도 추가','계산된 설명 (효율 100%, 치명타 전)']];header(summary,'A13:G13');
const labels={common:'일반',uncommon:'드문',rare:'희귀',epic:'영웅',legendary:'전설',unique:'고유'};
const variables={level:'$B$4',attack:'$B$5',defense:'$B$6',selectedBurn:'$B$7',targetBurn:'$B$7',selfBurn:'$B$9',enemyBurnTotal:'($B$7+$B$8)',allBurnTotal:'($B$7+$B$8+$B$9)',selectedMaxHp:'$B$10'};
function excelExpr(formula){return formula.replace(/[A-Za-z_][A-Za-z_0-9]*/g,name=>{if(!variables[name])throw new Error('Unknown variable '+name);return variables[name];});}
function descriptionFormula(text){
 const parts=[];let last=0;const re=/\{calc:([^{}]+)\}/g;
 for(const match of text.matchAll(re)){
  if(match.index>last)parts.push(JSON.stringify(text.slice(last,match.index)).replace(/\\n/g,'"&CHAR(10)&"'));
  const [expression,...options]=match[1].split('|');let formula=excelExpr(expression),digits=0;
  for(const option of options){const [key,value]=option.split(':');if(key==='min')formula=`MAX(${value},${formula})`;else if(key==='max')formula=`MIN(${value},${formula})`;else if(key==='digits')digits=Number(value);}
  parts.push(`ROUND(${formula},${digits})`);last=match.index+match[0].length;
 }
 if(last<text.length)parts.push(JSON.stringify(text.slice(last)).replace(/\\n/g,'"&CHAR(10)&"'));
 // Excel string escaping uses doubled quotes, rather than JavaScript escapes.
 return '='+parts.join('&').replace(/\\"/g,'""');
}
for(let i=0;i<pack.skills.length;i++){
 const s=pack.skills[i],row=i+14,cond=JSON.parse(s.conditionJson);
 summary.getRange(`A${row}:F${row}`).values=[[s.name,labels[s.rarity],s.actionPointCost,s.cooldown,cond.perBattleLimit || (cond.perBattleLimitFormula?0:'제한 없음'),s.difficultyBonus]];
 if(cond.perBattleLimitFormula)summary.getRange(`E${row}`).formulas=[['='+excelExpr(cond.perBattleLimitFormula)]];
 summary.getRange(`G${row}`).formulas=[[descriptionFormula(s.description)]];
  summary.getRange(`A${row}:G${row}`).format={rowHeight:64,wrapText:true,fill:i%2?'#FFFFFF':'#FFF7ED',verticalAlignment:'center'};
}
summary.getRange('A1:A32').format.columnWidth=26;summary.getRange('B1:B32').format.columnWidth=12;
summary.getRange('C1:F32').format.columnWidth=12;summary.getRange('G1:G32').format.columnWidth=100;
summary.getRange('C14:F31').format.horizontalAlignment='right';summary.freezePanes.freezeRows(13);
const schema={
 Skills:['skillId','name','hitCount','cooldown','actionPointCost','rarity','conditionJson','description','effectJson','rewardEnabled','type','target','baseValue','difficultyBonus','upgradeJson','tags','attackEffect','concept','rarityLabel','role','proposalOrigin','implementationStatus','mechanicIds','upgradeDesign','rewardPlanned'],
 Effects:Array.from(c.DB_COLUMNS.EFFECTS),EffectRules:Array.from(c.DB_COLUMNS.EFFECT_RULES)};
const sourceRows={Skills:pack.skills.map(s=>({...s,
 concept:'발화',rarityLabel:labels[s.rarity],
 role:({damage:'공격',shield:'수비',heal:'회복',debuff:'발화 제어',buff:'강화·자원'})[s.type],
 proposalOrigin:'사용자 발화 기획 (2026-10-19)',implementationStatus:'구현 완료',
 mechanicIds:[...new Set(['effect_v2_burn',...(s.effectJson.match(/effect_v2_burn(?:_[a-z_]+)?/g)||[])])].join(','),
 upgradeDesign:/\blevel\b/.test(s.effectJson)?'n=스킬 레벨(1부터 시작). level 수식에 따라 피해·효과·조건 수치가 증가한다.':'레벨별 수치 변화 없음.',
 rewardPlanned:1,
})),Effects:pack.effects,EffectRules:pack.effectRules};
for(const [name,headers] of Object.entries(schema)){
 const sheet=wb.worksheets.add(name),rows=sourceRows[name],last=rows.length+1;
 base(sheet,`A1:${col(headers.length)}${last}`);
 sheet.getRange(`A1:${col(headers.length)}${last}`).values=[headers,...rows.map(r=>headers.map(h=>r[h]??''))];
 sheet.getRange(`A1:${col(headers.length)}${last}`).format={columnWidth:20,rowHeight:78,wrapText:true};
 header(sheet,`A1:${col(headers.length)}1`);sheet.freezePanes.freezeRows(1);sheet.freezePanes.freezeColumns(2);
 sheet.getRange(`A1:A${last}`).format.columnWidth=42;sheet.getRange(`B1:B${last}`).format.columnWidth=name==='EffectRules'?14:22;
 if(name==='Skills'){
  sheet.getRange(`F1:F${last}`).format.columnWidth=14;
  sheet.getRange(`G1:G${last}`).format.columnWidth=34;
  sheet.getRange(`H1:H${last}`).format.columnWidth=85;sheet.getRange(`I1:I${last}`).format.columnWidth=130;
  sheet.getRange(`A2:Y${last}`).format.rowHeight=104;
  sheet.getRange(`U1:U${last}`).format.columnWidth=34;
  sheet.getRange(`W1:W${last}`).format.columnWidth=48;
  sheet.getRange(`X1:X${last}`).format.columnWidth=55;
  for(const letter of ['C','D','E','J','M','N','Y'])sheet.getRange(`${letter}2:${letter}${last}`).setNumberFormat('0');
 }else if(name==='Effects'){
  sheet.getRange(`N1:N${last}`).format.columnWidth=90;sheet.getRange(`A2:V${last}`).format.rowHeight=54;
 }else{
  sheet.getRange(`G1:G${last}`).format.columnWidth=38;sheet.getRange(`I1:I${last}`).format.columnWidth=90;sheet.getRange(`A2:I${last}`).format.rowHeight=54;
 }
 for(let row=2;row<=last;row++)if(row%2===0)sheet.getRange(`A${row}:${col(headers.length)}${row}`).format.fill='#FFF7ED';
}
function col(n){let s='';while(n){n--;s=String.fromCharCode(65+n%26)+s;n=Math.floor(n/26);}return s;}
const notes=wb.worksheets.add('사용안내');base(notes,'A1:B25');
const instructions=[
 ['항목','적용 방법과 해석'],
 ['1. 코드 반영','수정한 SkillService.gs, SharedRuleEngine.gs, BattleService.gs, RewardService.gs, Battle.html, UiStyles.html을 Apps Script 프로젝트에 업로드하고 웹앱을 새 버전으로 배포합니다. 시트만 바꾸면 새 동작 일부가 실행되지 않습니다.'],
 ['2. Skills 교체','Skills 탭의 플레이어 스킬 18개로 기존 플레이어 스킬 행을 교체합니다. ID는 기존 발화 계열 skill_v2_burn_01~18로 통일했습니다. 이전에 넣은 skill_ignition_ 행도 삭제합니다. 몬스터 전용 ms_ 행 및 monsterSkill 설정이 있는 행은 유지합니다.'],
 ['열 순서','사용자가 전달한 25개 컬럼 순서에 맞췄습니다. A:F는 skillId, name, hitCount, cooldown, actionPointCost, rarity이며 R:Y에 기획 정보가 있습니다. Skills의 A1:Y19를 복사합니다. 마지막 두 빈 컬럼은 데이터가 없어 제외했습니다. 1행 영문 헤더는 변경하지 않습니다.'],
 ['3. Effects 반영','effect_v2_burn은 기존 행을 이 파일의 값으로 교체하고, 나머지 3개 효과는 추가하거나 같은 ID 행을 교체합니다. 이전에 추가한 effect_ignition으로 시작하는 효과 행은 삭제합니다. 다른 효과는 유지합니다.'],
 ['4. EffectRules 반영','effect_v2_burn의 기존 규칙을 삭제하고 이 파일의 턴 종료 규칙 1개로 교체합니다. 나머지 3개 규칙은 추가하거나 같은 effectId+ruleOrder 행을 교체합니다. 이전 effect_ignition으로 시작하는 규칙도 삭제합니다.'],
 ['5. 캐시와 새 게임','Apps Script에서 clearRuntimeCaches()를 실행한 뒤 새 게임을 시작합니다. 진행 중인 게임은 시작 시 받은 스냅샷을 사용하므로 새 규칙이 반영되지 않습니다.'],
 ['설명과 계산','Skills.description의 {calc:수식}은 게임에서 현재 스킬 레벨·능력치·발화 중첩을 사용해 숫자로 표시됩니다. 이 표기를 숫자로 덮어쓰면 강화 후에도 설명이 고정됩니다. 스킬목록 탭은 같은 수식의 엑셀 계산본입니다.'],
 ['레벨 정의','기획의 n은 1부터 시작하는 스킬 레벨입니다. 실행 JSON에서는 level로 표기합니다. 기존 스킬의 n=레벨−1 규칙을 바꾸지 않고 새 스킬에만 적용합니다.'],
 ['burn 통일','컨셉 태그 burn, 스킬 skill_v2_burn_*, 발화 상태 effect_v2_burn으로 통일했습니다. 기존 발화의 아이콘·불꽃 연출·보상 분류와 같은 계열을 사용합니다. 쿨타임 1은 사용한 턴의 다음 턴에 다시 사용 가능합니다.'],
 ['발화 규칙','턴 종료 시 최대 체력×중첩×0.015 피해. 방어막 우선 흡수. 자동 중첩 감소 없음. 정수 피해는 기존 전투 규칙처럼 반올림하며 양수 지속 피해의 최소값은 1입니다.'],
 ['대상과 적중','모든 대상은 살아 있는 적 전체를 뜻합니다. 자나깨나 불조심만 자신을 포함합니다. 직접 공격의 부가 발화는 적중한 적에게 적용합니다. 확률에 의한 자기 발화와 자기 정화는 적중 여부와 별도로 처리합니다.'],
 ['횃불 해석','피해=(0.8+0.1n)×공격력+2+n. 회피율 감소는 2턴간 (5+5n)%p. 자기 발화 확률은 30−5n%. 사용자가 확인한 해석입니다.'],
 ['수식 원문 유지','화염 스프레이=3+n+0.8×공격력+0.1n. 라이터 투척=1.2×공격력+0.1n+2n. 원문에서 +0.1n으로 적힌 항은 공격 계수 증가가 아니라 고정 수치 증가로 반영했습니다.'],
 ['폭발','소모한 중첩×(선택한 적 최대 체력의 2%+5)를 모든 적에게 동일하게 적용합니다. 각 적의 최대 체력으로 다시 계산하지 않습니다. 사용자가 확인한 해석입니다.'],
 ['중첩 참조 시점','불붙이기는 사용 전 선택한 적의 발화 여부를 확인합니다. 쥐불놀이는 기본 타격 직전 중첩 수만큼 추가 타격합니다. 부채질은 중첩을 2배로 만든 뒤의 선택 대상 중첩 수로 광역 피해를 계산합니다.'],
 ['가스누출','적과 자신의 피해 모두 각자의 발화 중첩당 (10+3n)% 증가합니다. 자기 기본 피해 5−n은 음수가 되면 0으로 제한합니다. 자기 피해는 문제 효율로 줄어들지 않습니다.'],
 ['확률과 회복','자기 발화 확률은 0~100%로 제한합니다. 핫팩은 기본 3+n에 적 전체 발화 합계+2n을 추가합니다. 체력 회복과 행동력 회복은 현재 최대치를 초과하지 않습니다.'],
 ['효율','직접 피해·광역 효과 피해·회복·방어막은 기존 게임의 문제 효율을 적용합니다. 발화 중첩·고정 추가 피해·행동력 회복·자기 피해는 효율로 줄이지 않습니다.'],
 ['지속시간','횃불 회피 감소와 소화 분말 명중 감소는 적용 후 다음 두 턴 종료까지 유지합니다. 소화기 회피 증가·불씨 방패 반격은 이번 턴, 태양인은 이번 턴을 포함해 3턴입니다.'],
 ['태양인','적에게 준 직접·추가·발화 피해에 반응합니다. 자신도 방어막 피해나 발화 피해를 받으면 자신에게 1중첩을 더합니다. 피해가 0인 경우 반응하지 않습니다.'],
 ['최대 횟수','횃불 3회, 핫팩·라이터·자나깨나 불조심·태양인 각 1회, 부채질 1+n회. 모두 전투당 제한입니다. 다른 스킬은 횟수 제한이 없습니다.'],
 ['열기 회수','원문대로 발화가 0이어도 기본 행동력 1을 회복합니다. 6−n 이상이면 2를 회복하므로 레벨 6부터는 발화 0에서도 조건이 충족됩니다. 필요 시 후속 밸런스 조정이 가능합니다.'],
 ['신규 이름','oo → 불씨 방패. 드문 등급 ㅇㅇ 세 개 → 화중 방어, 불씨 던지기, 열기 회수. 불주먹의 대사 속 oo는 요청한 이름 변경 대상이 아니므로 원문을 유지했습니다.'],
 ['기존 진행 데이터','이 파일은 새 플레이어 스킬 목록입니다. 삭제된 옛 스킬을 보유한 진행 중 게임이나 영구 보유 데이터는 자동으로 새 스킬로 변환하지 않습니다. 몬스터 스킬·아이템·Rewards의 다른 행은 그대로 둡니다.'],
];
notes.getRange(`A1:B${instructions.length}`).values=instructions;header(notes,'A1:B1');
notes.getRange(`A2:B${instructions.length}`).format={rowHeight:64,wrapText:true};
notes.getRange(`A1:A${instructions.length}`).format.columnWidth=24;notes.getRange(`B1:B${instructions.length}`).format.columnWidth=118;notes.freezePanes.freezeRows(1);
wb.recalculate();
for(const [name,rows] of Object.entries(sourceRows)){
 const headers=schema[name];const actual=wb.worksheets.getItem(name).getRange(`A2:${col(headers.length)}${rows.length+1}`).values;
 if(JSON.stringify(actual)!==JSON.stringify(rows.map(r=>headers.map(h=>r[h]??''))))throw new Error(`${name} round-trip mismatch`);
}
const first=summary.getRange('G14').values[0][0];if(!String(first).includes('21'))throw new Error('Level 1 torch should be 21: '+first);
const original=summary.getRange('B4').values;summary.getRange('B4').values=[[3]];wb.recalculate();
if(!String(summary.getRange('G14').values[0][0]).includes('27'))throw new Error('Level change did not recalculate torch');
if(summary.getRange('E27').values[0][0]!==4)throw new Error('Fan limit must be 4 at level 3');
summary.getRange('B4').values=original;wb.recalculate();
console.log((await wb.inspect({kind:'table',range:'스킬목록!A14:G16',include:'values',tableMaxRows:3,tableMaxCols:7,maxChars:1800})).ndjson);
console.log((await wb.inspect({kind:'match',searchTerm:'#REF!|#DIV/0!|#VALUE!|#NAME\\?|#N/A|#NUM!|#NULL!|#SPILL!|#CALC!',options:{useRegex:true,maxResults:30},summary:'final formula error scan',maxChars:1500})).ndjson);
for(const [sheetName,range,file] of [['스킬목록','A2:G16','summary'],['Skills','A1:F4','skills'],['Skills','G1:H3','skill-descriptions'],['Skills','I1:I3','json'],['Skills','J1:Q3','skill-flags'],['Skills','R1:Y3','skill-metadata'],['Effects','A1:I5','effects'],['Effects','J1:V5','effect-settings'],['EffectRules','A1:I5','rules'],['사용안내','A1:B8','instructions']]){
 const blob=await wb.render({sheetName,range,scale:1,format:'png'});await fs.writeFile(path.join(previewDir,file+'.png'),new Uint8Array(await blob.arrayBuffer()));
}
await (await SpreadsheetFile.exportXlsx(wb)).save(path.join(outputDir,'발화_스킬_18종_burn통일.xlsx'));
console.log('Exported '+path.join(outputDir,'발화_스킬_18종_burn통일.xlsx'));
