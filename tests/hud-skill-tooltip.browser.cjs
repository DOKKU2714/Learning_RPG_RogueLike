const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8'),touch=fs.readFileSync('UiTouchInteractions.html','utf8');
const extract=name=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const actions=['attackActionButton','guardActionButton'].map(id=>source.match(new RegExp('<button id="'+id+'"[^]*?</button>'))[0]).join('');
const script=`
var chosenSkills=[],currentView={clientConfig:{glossary:[{keyword:'치명타',description:'치명타 피해와 확률을 설명합니다.'}]}};
function chooseSkill(id){chosenSkills.push(id)}
function escapeHtml(v){return String(v)}function getCurrentActionPoint(){return 3}function getSkillActionPointCost(){return 1}
function hasClientActionPoint(){return true}function isClientSkillAvailableNow(){return true}function updateZeroCostSkillAttention(){}
function getSkillCooldownDisplayText(){return '쿨타임 2턴'}function getSkillUseLimitText(){return '사용 횟수 2회'}function getSkillDifficultyBonusText(){return '난이도 +1'}function getSkillDifficultyBonusClass(){return 'skill-detail-line'}
function getRewardRarityLabel(){return '희귀'}function normalizeRewardRarity(v){return v}
function buildSkillDetailDescription(skill){return highlightSkillStatusNames(skill.description)}function buildSkillFlavorDescription(){return ''}
function getRewardIconUrl(){return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="gold" d="M50 0L90 90H10Z"/></svg>'.replaceAll('"','&quot;')}
function getRewardSkillConcept(){return '타격'}function getRewardConceptClass(){return 'strike'}
${['highlightSkillStatusNames','renderRewardActionPointBadge','renderRewardRarityGems','renderInlineRewardSkillDescription','buildRewardSkillDetailLines','renderSkillActionPointGauge','renderSkills','bindGlossaryTooltips'].map(extract).join('\n')}
renderSkills([{skillId:'s',name:'치명적인 일격',rarity:'rare',level:2,description:'고정 피해를 입힙니다. 행동력 1, 치명타 확률 10%, 치명타 피해 20% 증가.'}]);
bindGlossaryTooltips();
`;
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const output=path.resolve('.tmp_spreadsheet/hud-skill-tooltip');fs.mkdirSync(output,{recursive:true});
 for(const width of [1366,390]){
 const page=await browser.newPage({viewport:{width,height:1000},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html><head><meta charset="utf-8">'+styles+touch+'</head><body class="battle-page-body"><main id="battleShell" class="battle-shell battle-video-shell"><section class="battle-scene" style="background:#176a59"><button id="battleMenuButton" class="battle-menu-button">메뉴</button></section><section class="battle-hud"><div id="hudMarker" class="battle-stage-hud" style="background:#224466">현재 스테이지 5층</div><div id="actionPanel" class="action-panel compact-actions">'+actions+'<div id="skillPanel" class="skill-panel"></div></div></section></main><script>'+script+'</script></body></html>');
 const markerBox=await page.locator('#hudMarker').boundingBox(),markerPixel={x:Math.ceil(markerBox.x)+3,y:Math.ceil(markerBox.y)+3,width:1,height:1};
 const hudBefore=await page.screenshot({clip:markerPixel});
 for(const selector of ['#attackActionButton','#guardActionButton']){
 await page.locator(selector).hover();await page.waitForTimeout(250);
 const result=await page.locator(selector+' .hud-skill-detail').evaluate(card=>{
 const b=card.getBoundingClientRect(),ap=card.querySelector('.reward-ap-badge').getBoundingClientRect(),name=card.querySelector('.skill-detail-name'),footer=card.querySelector('.hud-skill-footer').getBoundingClientRect(),desc=card.querySelector('.skill-detail-description').getBoundingClientRect();
 return {apX:ap.x+ap.width/2-b.x-card.clientLeft,apY:ap.y+ap.height/2-b.y-card.clientTop,titleAlign:getComputedStyle(name).textAlign,footerBelow:footer.top>=desc.bottom,
 terms:[...card.querySelectorAll('.skill-status-name')].map(el=>({color:getComputedStyle(el).color,weight:getComputedStyle(el).fontWeight})),footer:card.querySelector('.hud-skill-footer').innerText};
 });
 assert.ok(Math.abs(result.apX-8)<2&&Math.abs(result.apY-8)<2,'HUD pip matches reward-card corner offset: '+JSON.stringify(result));
 assert.equal(result.titleAlign,'right');assert.equal(result.footerBelow,true);
 }
 await page.locator('.skill-button').hover();await page.waitForTimeout(60);
 const card=page.locator('#hudSkillPreview > .hud-skill-card');
 assert.equal(await card.isVisible(),true);
 assert.equal(await page.locator('.skill-button > .skill-detail-card').isVisible(),false);
 const box=await card.boundingBox();assert.ok(Math.abs(box.x+box.width/2-width/2)<2,JSON.stringify({width,box,style:await card.evaluate(el=>({transform:getComputedStyle(el).transform,left:getComputedStyle(el).left}))}));assert.ok(Math.abs(box.y+box.height/2-500)<2);
 assert.match(await card.innerText(),/치명적인 일격/);assert.match(await card.innerText(),/쿨타임 2턴/);assert.match(await card.innerText(),/사용 횟수 2회/);assert.match(await card.innerText(),/난이도 \+1/);
 const terms=await card.locator('.skill-detail-description .skill-status-name').evaluateAll(els=>els.map(el=>({color:getComputedStyle(el).color,weight:getComputedStyle(el).fontWeight})));
 assert.deepEqual(terms.map(t=>t.color),['rgb(141, 85, 183)','rgb(255, 216, 74)','rgb(255, 216, 74)','rgb(255, 141, 54)']);assert.ok(terms.every(t=>Number(t.weight)>=800));
 assert.equal(await page.locator('#glossaryTooltip').isVisible(),true);
 if(width>1000)assert.ok((await page.locator('#glossaryTooltip').boundingBox()).x>=box.x+box.width);
 assert.equal(await page.locator('#hudSkillPreview').evaluate(el=>getComputedStyle(el,'::before').backgroundColor),'rgb(0, 0, 0)');
 const hudAfter=await page.screenshot({clip:markerPixel});
 assert.equal(hudAfter.equals(hudBefore),true,'HUD remains undimmed '+width);
 assert.ok(await page.locator('#battleMenuButton').evaluate(el=>Number(getComputedStyle(el).zIndex)>3),'menu remains above the backdrop');
 await page.screenshot({path:path.join(output,'hud-'+width+'.png')});
 await page.keyboard.press('Escape');assert.equal(await card.isVisible(),false);
 await page.locator('.skill-button').focus();assert.equal(await card.isVisible(),true);
 await page.evaluate(()=>document.getElementById('skillPanel').classList.add('hidden'));await page.waitForTimeout(20);assert.equal(await card.isVisible(),false);
 await page.evaluate(()=>{document.getElementById('skillPanel').classList.remove('hidden');currentView.clientConfig.glossary=[];});
 await page.locator('.skill-button').hover({position:{x:4,y:10}});assert.equal(await card.isVisible(),true);assert.equal(await page.locator('#glossaryTooltip').isVisible(),false);
 await page.locator('.skill-button').click({position:{x:4,y:10}});assert.deepEqual(await page.evaluate(()=>chosenSkills),['s']);assert.equal(await card.isVisible(),false);
 await page.evaluate(()=>{isClientSkillAvailableNow=()=>false;renderSkills([{skillId:'locked',name:'사용 불가 스킬',rarity:'rare',description:'기절 1턴'}]);});
 await page.locator('.skill-button').hover({position:{x:4,y:10}});assert.equal(await card.isVisible(),true);assert.match(await card.innerText(),/사용 불가 스킬/);
 await page.evaluate(()=>renderSkills([{skillId:'long',name:'아주 긴 설명을 가진 스킬 카드',rarity:'rare',description:'적에게 기절과 고정 피해를 부여합니다. '.repeat(100)}]));
 await page.locator('.skill-button').hover({position:{x:4,y:10}});assert.equal(await card.isVisible(),true);
 assert.ok((await card.boundingBox()).height<=960);
 assert.ok(await card.locator('.reward-inline-description').evaluate(el=>el.scrollHeight>el.clientHeight));
 await page.evaluate(()=>renderSkills([]));await page.waitForTimeout(20);assert.equal(await card.isVisible(),false);
 await page.evaluate(()=>{isClientSkillAvailableNow=()=>true;renderSkills([{skillId:'touch',name:'터치 스킬',rarity:'rare',description:'고정 피해'}]);});
 await page.locator('.skill-button').tap({position:{x:4,y:10}});
 assert.equal(await page.locator('.touch-preview-panel').isVisible(),true);assert.equal(await card.isVisible(),false);assert.deepEqual(await page.evaluate(()=>chosenSkills),['s']);
 await page.locator('.skill-button').tap({position:{x:4,y:10}});assert.deepEqual(await page.evaluate(()=>chosenSkills),['s','touch']);
 assert.deepEqual(errors,[]);await page.close();
 }
 console.log('HUD: basic tooltips retained; centered skill cards replace old hover windows, preserve glossary and metadata, and close on Escape/panel hide (desktop/mobile).');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
