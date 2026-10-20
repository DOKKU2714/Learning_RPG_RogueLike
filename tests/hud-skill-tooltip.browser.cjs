const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const actions=['attackActionButton','guardActionButton'].map(id=>source.match(new RegExp('<button id="'+id+'"[^]*?</button>'))[0]).join('');
const script=`
var currentView={};
function escapeHtml(v){return String(v)}function getCurrentActionPoint(){return 3}function getSkillActionPointCost(){return 1}
function hasClientActionPoint(){return true}function isClientSkillAvailableNow(){return true}function updateZeroCostSkillAttention(){}
function getSkillCooldownDisplayText(){return '쿨타임 2턴'}function getSkillUseLimitText(){return '사용 횟수 2회'}function getSkillDifficultyBonusText(){return '난이도 +1'}function getSkillDifficultyBonusClass(){return 'skill-detail-line'}
function getRewardRarityLabel(){return '희귀'}function normalizeRewardRarity(v){return v}
function buildSkillDetailDescription(skill){return highlightSkillStatusNames(skill.description)}function buildSkillFlavorDescription(){return ''}
${['highlightSkillStatusNames','renderRewardActionPointBadge','renderSkillActionPointGauge','renderSkills'].map(extract).join('\n')}
renderSkills([{skillId:'s',name:'치명적인 일격',rarity:'rare',level:2,description:'고정 피해를 입힙니다. 행동력 1, 치명타 확률 10%, 치명타 피해 20% 증가.'}]);
`;
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const output=path.resolve('.tmp_spreadsheet/hud-skill-tooltip');fs.mkdirSync(output,{recursive:true});
 for(const width of [1366,390]){
 const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html><head><meta charset="utf-8">'+styles+'</head><body><main style="width:min(600px,calc(100vw - 56px));margin:400px 28px">'+actions+'<div id="skillPanel" class="skill-panel"></div></main><script>'+script+'</script></body></html>');
 for(const selector of ['#attackActionButton','#guardActionButton','.skill-button']){
 await page.locator(selector).hover();await page.waitForTimeout(250);
 const result=await page.locator(selector+' .hud-skill-detail').evaluate(card=>{
 const b=card.getBoundingClientRect(),ap=card.querySelector('.reward-ap-badge').getBoundingClientRect(),name=card.querySelector('.skill-detail-name'),footer=card.querySelector('.hud-skill-footer').getBoundingClientRect(),desc=card.querySelector('.skill-detail-description').getBoundingClientRect();
 return {apX:ap.x+ap.width/2-b.x-card.clientLeft,apY:ap.y+ap.height/2-b.y-card.clientTop,titleAlign:getComputedStyle(name).textAlign,footerBelow:footer.top>=desc.bottom,
 terms:[...card.querySelectorAll('.skill-status-name')].map(el=>({color:getComputedStyle(el).color,weight:getComputedStyle(el).fontWeight})),footer:card.querySelector('.hud-skill-footer').innerText};
 });
 assert.ok(Math.abs(result.apX-8)<2&&Math.abs(result.apY-8)<2,'HUD pip matches reward-card corner offset: '+JSON.stringify(result));
 assert.equal(result.titleAlign,'right');assert.equal(result.footerBelow,true);
 if(selector==='.skill-button'){
 assert.deepEqual(result.terms.map(t=>t.color),['rgb(141, 85, 183)','rgb(255, 216, 74)','rgb(255, 216, 74)','rgb(255, 141, 54)']);assert.ok(result.terms.every(t=>Number(t.weight)>=800));
 assert.match(result.footer,/쿨타임 2턴/);assert.match(result.footer,/사용 횟수 2회/);assert.match(result.footer,/난이도 \+1/);
 await page.screenshot({path:path.join(output,'hud-'+width+'.png')});
 }
 }
 assert.deepEqual(errors,[]);await page.close();
 }
 console.log('HUD skill tooltips passed: shared corner AP badge, right-aligned titles, separate metadata and bold semantic colors (desktop/mobile).');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
