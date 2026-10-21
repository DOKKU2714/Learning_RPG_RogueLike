const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const source=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8'),touch=fs.readFileSync('UiTouchInteractions.html','utf8');
const extract=name=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const hud=source.slice(source.indexOf('    <section class="battle-hud">'),source.indexOf('  </main>')).replace('<div class="battle-stage-hud">','<div id="hudMarker" class="battle-stage-hud" style="background:#224466">');
const script=`
var chosenSkills=[],skillPanelOpen=false,narrationAdvances=0,MAX_QUESTION_DIFFICULTY=5,currentView={clientConfig:{glossary:[{keyword:'치명타',description:'치명타 피해와 확률을 설명합니다.'}]}};
function chooseSkill(id){chosenSkills.push(id);closeSkillPanel();} function cancelTargetSelection(){}
function advanceDescriptionByInput(){narrationAdvances++;return true;}
function escapeHtml(v){return String(v)}function getCurrentActionPoint(){return 3}function getSkillActionPointCost(){return 1}
function hasClientActionPoint(){return true}function isClientSkillAvailableNow(){return true}function updateZeroCostSkillAttention(){}
function getSkillCooldownDisplayText(){return '쿨타임 2턴'}function getSkillUseLimitText(){return '사용 횟수 2회'}function getSkillDifficultyBonusText(){return '난이도 +1'}function getSkillDifficultyBonusClass(){return 'skill-detail-line'}
function getRewardRarityLabel(){return '희귀'}function normalizeRewardRarity(v){return v}
function buildSkillDetailDescription(skill){return highlightSkillStatusNames(skill.description)}function buildSkillFlavorDescription(){return ''}
function getRewardIconUrl(){return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="gold" d="M50 0L90 90H10Z"/></svg>'.replaceAll('"','&quot;')}
function getRewardSkillConcept(){return '타격'}function getRewardConceptClass(){return 'strike'}
${['highlightSkillStatusNames','renderRewardActionPointBadge','renderRewardRarityGems','renderInlineRewardSkillDescription','renderSkillCardCornerMeta','renderDifficultyStars','buildRewardSkillDetailLines','renderSkillActionPointGauge','renderSkills','bindGlossaryTooltips','renderActionMode','toggleSkillPanel','closeSkillPanel','bindBattleLogReveal'].map(extract).join('\n')}
renderSkills([{skillId:'s',name:'치명적인 일격',rarity:'rare',level:2,difficultyBonus:2,description:'고정 피해를 입힙니다. 행동력 1, 치명타 확률 10%, 치명타 피해 20% 증가.'}]);
bindGlossaryTooltips();
bindBattleLogReveal();
`;
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const output=path.resolve('.tmp_spreadsheet/hud-skill-tooltip');fs.mkdirSync(output,{recursive:true});
 for(const width of [1366,390]){
 const page=await browser.newPage({viewport:{width,height:1000},hasTouch:true}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.setContent('<html><head><meta charset="utf-8">'+styles+touch+'</head><body class="battle-page-body"><main id="battleShell" class="battle-shell battle-video-shell"><section class="battle-scene" style="background:#176a59"><button id="battleMenuButton" class="battle-menu-button">메뉴</button></section>'+hud+'</main><script>'+script+'</script></body></html>');
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
 await page.locator('#skillToggleButton').click();
 assert.equal(await page.locator('#battleLog').isVisible(),false);
 assert.equal(await page.locator('#attackActionButton').isVisible(),true);
 assert.equal(await page.locator('#skillToggleButton').getAttribute('aria-expanded'),'true');
 assert.equal(await page.locator('#skillPanel').evaluate(el=>el.parentElement.classList.contains('battle-log-compact')),true);
 assert.equal(await page.locator('.skill-button > .skill-ap-gauge .reward-ap-badge b').innerText(),'1');
 assert.equal(await page.locator('.skill-button > .skill-ap-gauge .ap-icons').count(),0,'skill list uses a numeric AP badge');
 await page.waitForTimeout(450);
 const markerBox=await page.locator('#hudMarker').boundingBox(),markerPixel={x:Math.floor(markerBox.x+markerBox.width)-4,y:Math.ceil(markerBox.y)+3,width:1,height:1};
 const hudBefore=await page.screenshot({clip:markerPixel});
 await page.locator('.skill-button').hover();await page.waitForTimeout(60);
 const card=page.locator('#hudSkillPreview > .hud-skill-card');
 assert.equal(await card.isVisible(),true);
 assert.equal(await page.locator('.skill-button > .skill-detail-card').isVisible(),false);
 const box=await card.boundingBox();if(width>1000)assert.ok(Math.abs(box.x+box.width/2-width/2)<2);assert.ok(Math.abs(box.y+box.height/2-500)<2);
 if(width>1000)assert.ok(Math.abs(box.width-320)<2,'skill card uses its original width');
 assert.ok(box.height<=600,'card keeps complete text within its maximum height');
 assert.match(await card.innerText(),/치명적인 일격/);assert.match(await card.innerText(),/쿨타임 2턴/);assert.match(await card.innerText(),/2회 사용가능/);
 assert.equal(await card.locator('.reward-skill-difficulty .difficulty-star').count(),2);
 assert.equal(await card.locator('.reward-inline-meta').count(),0,'metadata moved from the footer');
 const corner=await card.locator('.reward-skill-corner-meta').boundingBox(),heading=await card.locator('.reward-choice-heading').boundingBox();
 assert.ok(corner.y+corner.height<=heading.y && corner.x>box.x+box.width/2,'metadata occupies the upper-right space without covering the title');
 assert.ok(Math.abs((await card.locator(':scope > .reward-ap-badge').boundingBox()).width-57.2)<1,'upper-left AP badge is 10% larger');
 const terms=await card.locator('.skill-detail-description .skill-status-name').evaluateAll(els=>els.map(el=>({color:getComputedStyle(el).color,weight:getComputedStyle(el).fontWeight})));
 assert.deepEqual(terms.map(t=>t.color),['rgb(141, 85, 183)','rgb(255, 216, 74)','rgb(255, 216, 74)','rgb(255, 141, 54)']);assert.ok(terms.every(t=>Number(t.weight)>=800));
 assert.equal(await page.locator('#glossaryTooltip').isVisible(),true);
 const glossary=await page.locator('#glossaryTooltip').boundingBox();
 assert.ok(glossary.x>=box.x+box.width || glossary.x+glossary.width<=box.x,'glossary stays strictly beside the skill card, including narrow screens');
 assert.ok(glossary.y<box.y+box.height && glossary.y+glossary.height>box.y,'glossary never moves above or below the card');
 assert.ok(glossary.x>=0 && glossary.x+glossary.width<=width);
 assert.equal(await page.locator('#hudSkillPreview').evaluate(el=>getComputedStyle(el,'::before').backgroundColor),'rgba(0, 0, 0, 0.42)');
 const hudAfter=await page.screenshot({clip:markerPixel});
 await page.screenshot({path:path.join(output,'hud-'+width+'.png')});
 assert.equal(hudAfter.equals(hudBefore),true,'HUD remains undimmed '+width);
 assert.ok(await page.locator('#battleMenuButton').evaluate(el=>Number(getComputedStyle(el).zIndex)>3),'menu remains above the backdrop');
 await page.keyboard.press('Escape');assert.equal(await card.isVisible(),false);
 await page.locator('.skill-button').focus();assert.equal(await card.isVisible(),true);
 await page.evaluate(()=>document.getElementById('skillPanel').classList.add('hidden'));await page.waitForTimeout(20);assert.equal(await card.isVisible(),false);
 await page.evaluate(()=>{document.getElementById('skillPanel').classList.remove('hidden');currentView.clientConfig.glossary=[];});
 await page.locator('.skill-button').hover({position:{x:4,y:10}});assert.equal(await card.isVisible(),true);assert.equal(await page.locator('#glossaryTooltip').isVisible(),false);
 await page.locator('.skill-button').click({position:{x:4,y:10}});assert.deepEqual(await page.evaluate(()=>chosenSkills),['s']);assert.equal(await card.isVisible(),false);
 assert.equal(await page.evaluate(()=>narrationAdvances),0,'choosing a skill never advances the narration underneath');
 assert.equal(await page.locator('#battleLog').isVisible(),true);
 await page.locator('#battleLog').click();assert.equal(await page.evaluate(()=>narrationAdvances),1);
 await page.evaluate(()=>{isClientSkillAvailableNow=()=>false;renderSkills([{skillId:'locked',name:'사용 불가 스킬',rarity:'rare',description:'기절 1턴'}]);});
 await page.locator('#skillToggleButton').click();
 await page.locator('.skill-button').hover({position:{x:4,y:10}});assert.equal(await card.isVisible(),true);assert.match(await card.innerText(),/사용 불가 스킬/);
 await page.evaluate(()=>renderSkills([{skillId:'long',name:'아주 긴 설명을 가진 스킬 카드',rarity:'rare',description:'적에게 기절과 고정 피해를 부여합니다. '.repeat(100)}]));
 await page.locator('.skill-button').hover({position:{x:4,y:10}});assert.equal(await card.isVisible(),true);
 assert.ok((await card.boundingBox()).height<=600,'long skill cards stay compact and scroll their complete descriptions');
 assert.ok(await card.locator('.reward-inline-description').evaluate(el=>el.scrollHeight>el.clientHeight));
 for(const height of [768,640]){
  await page.setViewportSize({width,height});await page.locator('.skill-button').hover({position:{x:4,y:10}});
  const previewBox=await card.boundingBox(),listBox=await page.locator('#skillPanel').boundingBox();
  assert.ok(previewBox.y>=0 && previewBox.y+previewBox.height<=listBox.y-10,'hover card leaves the entire skill list visible at '+width+'x'+height);
 }
 await page.setViewportSize({width,height:1000});
 await page.evaluate(()=>renderSkills(Array.from({length:12},(_,i)=>({skillId:'many'+i,name:'스킬 '+i,rarity:'rare',description:'고정 피해'}))));
 assert.ok(await page.locator('#skillPanel').evaluate(el=>el.scrollHeight>el.clientHeight),'many skills scroll within the narration slot');
 await page.evaluate(()=>{const list=document.getElementById('skillPanel');list.scrollTop=list.scrollHeight;});
 assert.equal(await page.locator('.skill-button').last().isVisible(),true);
 await page.evaluate(()=>renderSkills([]));await page.waitForTimeout(20);assert.equal(await card.isVisible(),false);
 await page.locator('.skill-cancel-button').click();
 assert.equal(await page.locator('#battleLog').isVisible(),true);assert.equal(await page.locator('#skillPanel').isVisible(),false);
 assert.equal(await page.locator('#skillToggleButton').getAttribute('aria-expanded'),'false');
 await page.evaluate(()=>{isClientSkillAvailableNow=()=>true;renderSkills([{skillId:'touch',name:'터치 스킬',rarity:'rare',description:'고정 피해'}]);});
 await page.locator('#skillToggleButton').click();
 await page.locator('.skill-button').tap({position:{x:4,y:10}});
 assert.equal(await page.locator('.touch-preview-panel').isVisible(),true);assert.equal(await card.isVisible(),false);assert.deepEqual(await page.evaluate(()=>chosenSkills),['s']);
 await page.locator('.skill-button').tap({position:{x:4,y:10}});assert.deepEqual(await page.evaluate(()=>chosenSkills),['s','touch']);
 await page.evaluate(()=>{
  currentView.clientConfig.glossary=[{keyword:'치명타',description:'치명타 설명'}];
  const edge=document.createElement('div');edge.id='leftGlossaryAnchor';edge.className='battle-stat-row';edge.textContent='치명타';
  edge.style.cssText='position:fixed;right:12px;top:100px;width:100px;height:40px;z-index:30000';document.body.appendChild(edge);
 });
 await page.locator('#leftGlossaryAnchor').hover();await page.waitForTimeout(30);
 const edgeBox=await page.locator('#leftGlossaryAnchor').boundingBox(),leftGlossary=await page.locator('#glossaryTooltip').boundingBox();
 assert.ok(leftGlossary.x+leftGlossary.width<=edgeBox.x,'right-edge anchors use the left side');
 assert.ok(leftGlossary.y<edgeBox.y+edgeBox.height && leftGlossary.y+leftGlossary.height>edgeBox.y);
 assert.deepEqual(errors,[]);await page.close();
 }
 console.log('HUD: basic tooltips retained; centered skill cards replace old hover windows, preserve glossary and metadata, and close on Escape/panel hide (desktop/mobile).');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
