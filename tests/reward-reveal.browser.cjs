const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const source=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const modal=source.slice(source.indexOf('  <div id="rewardModal"'),source.indexOf('  <div id="scoreModal"'));
const names=['renderRewardChoices','selectRewardCandidate','handleRewardKeyboard','renderRewardActionPointBadge','getRewardConceptClass','getRewardSkillConcept','renderInlineRewardSkillDescription','buildSkillFlavorDescription','buildSkillDetailDescription','renderSkillDescriptionTemplate','replaceSkillDescriptionTokens','escapeRegExpClient','highlightSkillStatusNames'];
const script=`
var workbookDeadlineExpired=false,selectedRewardId='',rewardSelectionApplying=false;
var currentView={clientConfig:{skillConceptKeywords:{burn:['발화','불씨'],shock:['감전','전류']}}};
function animateStageClearRegen(){} function renderBattleBackground(){}
${extract('fitRewardCardText')}
function escapeHtml(v){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');}
function normalizeRewardRarity(r){return r;} function getRewardRarityLabel(r){return r;}
function getRewardDisplayTitle(){return '스킬 획득';} function renderRewardRarityGems(){return '';}
function getSkillActionPointCost(s){return s.actionPointCost;} function getSkillDescriptionTemplateValues(){return {damage:27};}
function buildRewardSkillDetailLines(){return '<span>쿨타임 2턴</span>';}
function buildSkillUpgradeChangeSummary(){return '<span class="reward-upgrade-changes">피해 20 → 27 (+7)</span>';}
function renderRewardDetailCard(reward){if(reward.type!=='stat')throw Error('Skill selection must not create hover tooltips');return '';}
function confirmRewardChoice(){window.confirmations=(window.confirmations||0)+1;}
function getRewardIconUrl(){return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 80 80"><path fill="#ff8b26" d="M32 4H44V16H52V28H64V60H52V72H24V64H12V40H24V48H32Z"/><path fill="#ffdf7f" d="M32 36H44V48H52V60H40V68H28V52H32Z"/></svg>');}
${names.map(extract).join('\n')}
function showCards(rarities){var concepts=['발화','감전','암살'];window.view={isLevelReward:true,choices:rarities.map((rarity,i)=>({rewardId:'r'+i,type:i===2?'skillUpgrade':'skill',rarity,value:1,skillDetail:{name:['불씨 방패','전도체 투척','선제공격'][i],concept:concepts[i],tags:[],level:2,actionPointCost:i===0?0:i,description:'적에게 {damage} 피해를 입힙니다.\\n발화와 불씨, 감전과 전류에 반응합니다. 체력이 가득 찬 적에게 추가 피해를 입힙니다.\\n"불꽃은 남는다."'}}))};renderRewardChoices(view);}
document.addEventListener('keydown',handleRewardKeyboard);showCards(['common','rare','unique']);
`;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const output=process.env.REWARD_CARD_OUTPUT || path.resolve('.tmp_spreadsheet/reward-cards-2026-10-19');fs.mkdirSync(output,{recursive:true});
 try{
  for(const width of [1366,390]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setContent('<html><head>'+styles+'</head><body style="background:#1e2823">'+modal+'<script>'+script+'</script></body></html>');
   assert.equal(await page.locator('.reward-inline-description').count(),3);
   await page.evaluate(()=>{
    document.querySelector('.reward-choice-heading').textContent='아주 긴 이름을 가진 전설의 스킬 보상';
    fitRewardCardText();
   });
   const title=await page.locator('.reward-choice-heading').first().evaluate(el=>({
    whiteSpace:getComputedStyle(el).whiteSpace,fits:el.scrollWidth<=el.clientWidth,
    size:parseFloat(getComputedStyle(el).fontSize),
   }));
   assert.equal(title.whiteSpace,'nowrap');assert.ok(title.fits);assert.ok(title.size<26);
   assert.equal(await page.locator('.reward-detail-card').count(),0);
   assert.deepEqual(await page.locator('.reward-ap-badge b').allTextContents(),['0','1','2']);
   const before=await page.locator('.reward-choice-card').evaluateAll(cards=>cards.map(card=>{
    const d=card.querySelector('.skill-detail-description'),ap=card.querySelector('.reward-ap-badge'),concept=card.querySelector('.reward-skill-concept'),b=card.getBoundingClientRect(),db=d.getBoundingClientRect(),ab=ap.getBoundingClientRect();
    return {position:getComputedStyle(d).position,font:getComputedStyle(d).fontSize,numberFont:getComputedStyle(d.querySelector('.skill-damage-number')).fontSize,concept:getComputedStyle(concept).color,
     burn:[...d.querySelectorAll('.skill-status-burn')].map(n=>({text:n.textContent,color:getComputedStyle(n).color})),shock:[...d.querySelectorAll('.skill-status-shock')].map(n=>getComputedStyle(n).color),
     apCenterX:ab.left+ab.width/2-b.left,apCenterY:ab.top+ab.height/2-b.top,apSize:parseFloat(getComputedStyle(ap.querySelector('b')).fontSize),contained:db.left>=b.left && db.right<=b.right+1 && db.bottom<=b.bottom,
     rise:parseFloat(getComputedStyle(card).getPropertyValue('--aura-rise')),spread:parseFloat(getComputedStyle(card).getPropertyValue('--aura-spread'))};
   }));
   assert.ok(before.every(r=>r.contained && r.font==='13px' && r.numberFont===r.font && Math.abs(r.apCenterX-8)<=2 && Math.abs(r.apCenterY-8)<=2 && r.apSize===23));
   assert.equal(await page.locator('.reward-ap-badge .ap-pip.filled').count(),3);
   const numberFits=await page.evaluate(()=>[0,1,12,999].every(cost=>{
    const card=document.querySelector('.reward-choice-card'),original=card.querySelector('.reward-ap-badge');
    original.insertAdjacentHTML('afterend',renderRewardActionPointBadge(cost));
    const badge=original.nextElementSibling,b=badge.querySelector('b'),range=document.createRange();range.selectNodeContents(b);
    const text=range.getBoundingClientRect(),box=badge.getBoundingClientRect();
    const fits=text.left>=box.left+10 && text.right<=box.right-10 && text.top>=box.top && text.bottom<=box.bottom;
    badge.remove();return fits;
   }));
   assert.ok(numberFits,'action-point digits stay inside the centered pip');
   const layout=await page.locator('.reward-choice-card').evaluateAll(cards=>cards.map(card=>{
    const heading=card.querySelector('.reward-choice-heading').getBoundingClientRect(),b=card.getBoundingClientRect();
    const meta=card.querySelector('.reward-inline-meta'),flavor=card.querySelector('.skill-flavor-text'),description=card.querySelector('.reward-inline-description');
    return {centered:Math.abs(heading.x+heading.width/2-b.x-b.width/2)<1,footer:meta.parentElement.classList.contains('reward-card-footer'),
      separate:!description.contains(meta),quoteBelow:flavor.getBoundingClientRect().top>=meta.getBoundingClientRect().bottom,
      quoteColor:getComputedStyle(flavor).color,quotedInDescription:description.textContent.includes('불꽃은 남는다')};
   }));
   assert.ok(layout.every(r=>r.centered && r.footer && r.separate && r.quoteBelow && !r.quotedInDescription && r.quoteColor==='rgb(146, 151, 146)'));
   assert.deepEqual(before.map(r=>r.concept),['rgb(255, 118, 40)','rgb(100, 255, 242)','rgb(147, 96, 181)']);
   assert.ok(before.every(r=>r.burn.some(w=>w.text==='불씨') && r.burn.every(w=>w.color==='rgb(255, 118, 40)') && r.shock.every(c=>c==='rgb(100, 255, 242)')));
   assert.ok(before[0].rise<before[1].rise && before[1].rise<before[2].rise);
   const rises=await page.locator('.reward-choice-card').first().evaluate(card=>['common','uncommon','rare','epic','legendary','unique'].map(rarity=>{
    const node=card.cloneNode(true);node.className='reward-choice-card reward-aura-card rarity-'+rarity;card.parentElement.appendChild(node);
    const rise=parseFloat(getComputedStyle(node).getPropertyValue('--aura-rise'));node.remove();return rise;
   }));
   assert.ok(rises.every((value,i)=>i===0 || value>rises[i-1]),'all six rarities increase aura size');
   assert.equal(await page.locator('.reward-upgrade-changes').count(),1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
   const reveal=await page.locator('.reward-choice-card').evaluateAll(cards=>cards.map(card=>{
    const animations=card.getAnimations({subtree:true}),content=card.querySelector('.reward-choice-heading'),aura=card.querySelector('.reward-aura-intro');
    const revealTime=animations.find(a=>a.animationName==='reward-card-materialize').effect.getTiming().delay;
    const seek=time=>animations.forEach(a=>{a.pause();a.currentTime=time;});
    seek(0);
    const hiddenInitially=getComputedStyle(content).visibility==='hidden' && getComputedStyle(aura).opacity==='0';
    seek(revealTime-100);
    const charging=getComputedStyle(content).visibility==='hidden' && Number(getComputedStyle(card.querySelector('.reward-reveal-flash')).opacity)>0;
    seek(revealTime+400);
    return {revealTime,hiddenInitially,charging,visible:getComputedStyle(content).visibility==='visible',aura:Number(getComputedStyle(aura).opacity),color:getComputedStyle(card).getPropertyValue('--reward-gem-color').trim()};
   }));
   assert.ok(reveal.every(r=>r.hiddenInitially && r.charging && r.visible && r.aura>.7),'charge and flash precede the card and its rarity aura');
   assert.deepEqual(reveal.map(r=>Math.round(r.revealTime)),[820,1670,4670]);
   assert.deepEqual(reveal.map(r=>r.color),['#f1f1f1','#63a8ff','#ff4a4a']);
   await page.screenshot({path:path.join(output,'cards-'+width+'.png'),fullPage:true});
   await page.evaluate(()=>document.getAnimations().forEach(a=>{a.currentTime=8000;}));
   assert.equal(await page.locator('.reward-aura-intro').first().evaluate(n=>getComputedStyle(n).opacity),'0','entrance aura finishes');
   const first=page.locator('.reward-choice-card').first();await first.hover();
   await page.waitForTimeout(450);
   assert.ok(Number(await first.locator('.reward-aura-hover').evaluate(n=>getComputedStyle(n).opacity))>.7);
   assert.equal(await first.locator('.reward-aura-hover').evaluate(n=>getComputedStyle(n,'::after').animationIterationCount),'infinite');
   assert.equal(await first.locator('.reward-card-sheen').evaluate(n=>getComputedStyle(n,'::before').animationIterationCount),'1');
   await page.waitForTimeout(950);
   assert.equal(await first.locator('.reward-card-sheen').evaluate(n=>getComputedStyle(n,'::before').opacity),'0','shine runs once');
   await page.mouse.move(1,1);await page.waitForTimeout(400);
   assert.equal(await first.locator('.reward-aura-hover').evaluate(n=>getComputedStyle(n).opacity),'0','hover aura fades out');
   const idle=await page.locator('.reward-choice-card').evaluateAll(cards=>cards.map(card=>({display:getComputedStyle(card.querySelector('.reward-aura-idle')).display,
    opacity:Number(getComputedStyle(card.querySelector('.reward-aura-idle')).opacity),rays:getComputedStyle(card.querySelector('.reward-aura-hover'),'::after').backgroundImage,
    edges:['top','right','bottom','left'].map(edge=>parseFloat(getComputedStyle(card.querySelector('.reward-aura-hover'),'::after')[edge]))})));
   assert.equal(idle[0].display,'none');assert.equal(idle[1].display,'none');assert.equal(idle[2].display,'block');
   assert.ok(idle[2].opacity>0 && idle[2].opacity<.4,'unique aura stays faintly visible without hover');
   assert.ok(idle.every(r=>r.rays.includes('repeating-conic-gradient')&&r.edges.every(edge=>edge<0)),'dense rays extend beyond all four card edges');
   await page.keyboard.press('2');assert.equal(await page.evaluate(()=>selectedRewardId),'r1');
   await page.keyboard.press('Enter');assert.equal(await page.evaluate(()=>confirmations),1);
   await page.evaluate(()=>{view.choices=view.choices.map((r,i)=>({rewardId:r.rewardId,type:'stat',rarity:r.rarity,targetId:['attack','accuracy','criticalRate'][i],value:[15,10,1.5][i],description:['공격력 +15','명중률 +10%p','치명타 확률 +1.5%p'][i]}));renderRewardChoices(view);});
   assert.deepEqual(await page.locator('.reward-stat-increase').allTextContents(),['+15','+10%','+1.5%']);
   assert.deepEqual(await page.locator('.reward-choice-heading').allTextContents(),['공격력 +15','명중률 +10%p','치명타 확률 +1.5%p']);
   assert.ok(await page.locator('.reward-choice-card').evaluateAll(cards=>cards.every(card=>{
    const icon=card.querySelector('.reward-choice-icon-wrap').getBoundingClientRect(),value=card.querySelector('.reward-stat-increase').getBoundingClientRect(),box=card.getBoundingClientRect();
    return value.top>=icon.bottom && value.bottom<=box.bottom && value.left>=box.left && value.right<=box.right;
   })),'stat increases appear below icons inside their cards');
   const statEffects=await page.locator('.reward-choice-card').evaluateAll(cards=>cards.map(card=>({
    charge:!!card.querySelector('.reward-charge-light'),flash:!!card.querySelector('.reward-light-card'),
    delay:card.querySelector('.reward-aura-intro').getAnimations()[0].effect.getTiming().delay
   })));
   assert.ok(statEffects.every(r=>r.charge && r.flash));
   assert.deepEqual(statEffects.map(r=>r.delay),reveal.map(r=>r.revealTime),'stat and skill rewards share the reveal timing');
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await first.locator('.reward-aura-intro').evaluate(n=>getComputedStyle(n).animationName),'none');
   await page.evaluate(()=>showCards(['common','rare','unique']));
   if(width>1000)assert.equal(Math.round((await page.locator('.reward-modal').boundingBox()).width),1075,'reward cards gain approximately 25% width');
   assert.ok((await first.boundingBox()).height<460,'normal skill card height is reduced');
   for(const height of width>1000?[768,720]:[844,640]){
    await page.setViewportSize({width,height});
    const confirm=await page.locator('#rewardConfirmButton').boundingBox();
    assert.ok(confirm.y>=0 && confirm.y+confirm.height<=height,'confirmation remains on screen at '+width+'x'+height);
   }
   await page.evaluate(()=>{
    document.querySelector('.reward-inline-description .skill-detail-description').textContent+=' 긴 스킬 설명도 끝까지 읽을 수 있어야 합니다.'.repeat(70);
    document.querySelector('.reward-modal').scrollTop=0;
   });
   const longConfirm=await page.locator('#rewardConfirmButton').boundingBox();
   assert.ok(longConfirm.y>=0 && longConfirm.y+longConfirm.height<=page.viewportSize().height,'long descriptions cannot push confirmation offscreen');
   const descriptions=await page.locator('.reward-inline-description').evaluateAll(els=>els.map(el=>({overflow:getComputedStyle(el).overflowY,height:el.clientHeight,content:el.scrollHeight})));
   assert.ok(descriptions.every(d=>d.overflow==='visible' && d.content<=d.height+1),'reward descriptions remain complete');
   await page.locator('.reward-card-footer').last().scrollIntoViewIfNeeded();
   await page.screenshot({path:path.join(output,'compact-cards-'+width+'.png')});
   assert.deepEqual(errors,[]);await page.close();console.log('Inline skill cards, AP, configurable concepts and rarity auras OK: '+width);
  }
  console.log('Screenshots: '+output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
