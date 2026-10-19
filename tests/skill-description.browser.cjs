const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const highlight=html.match(/    function highlightSkillStatusNames\([^]*?\n    \}/)[0];
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  const page=await browser.newPage();
  for(const width of [1366,390]){
   await page.setViewportSize({width,height:844});
   for(const rarity of ['common','uncommon','rare','epic','legendary','unique']){
    await page.setContent('<html><head>'+styles+'</head><body><button class="reward-choice-card rarity-'+rarity+'" style="position:relative;margin-top:300px"><strong>스킬 획득</strong><span class="reward-detail-card"><span class="skill-detail-description">일반 텍스트 <strong class="skill-damage-number">123</strong> <span id="statuses"></span><br>직접 줄바꿈 이후의 문장입니다.</span></span></button><script>'+highlight+';document.getElementById("statuses").innerHTML=highlightSkillStatusNames("발화 감전 행운 암살 중독 타격 냉기 공용");</script></body></html>');
    const result=await page.locator('.reward-detail-card').evaluate(card=>{
      const d=card.querySelector('.skill-detail-description'),style=getComputedStyle(d),number=d.querySelector('.skill-damage-number');
      return {font:style.fontSize,family:style.fontFamily,whiteSpace:style.whiteSpace,width:card.getBoundingClientRect().width,
        max:getComputedStyle(card).maxWidth,overflow:getComputedStyle(card).overflowX,breaks:d.querySelectorAll('br').length,
        number:{font:getComputedStyle(number).fontSize,family:getComputedStyle(number).fontFamily,display:getComputedStyle(number).display,color:getComputedStyle(number).color},
        rarityColor:getComputedStyle(card.parentElement).color,contentWidth:d.scrollWidth,backgroundWidth:card.clientWidth,
        statuses:[...d.querySelectorAll('.skill-status-name')].map(el=>({name:el.textContent,font:getComputedStyle(el).fontSize,family:getComputedStyle(el).fontFamily,color:getComputedStyle(el).color}))};
    });
    assert.equal(result.font,'13px');assert.equal(result.number.font,result.font);assert.equal(result.number.family,result.family);
    assert.equal(result.number.display,'inline');assert.equal(result.whiteSpace,'nowrap');assert.equal(result.breaks,1);
    assert.equal(result.number.color,result.rarityColor);assert(result.contentWidth<=result.backgroundWidth,'tooltip background must contain its full content');
    assert.equal(result.overflow,'visible');assert.equal(result.max,'none');assert(result.width>280);
    assert(result.statuses.every(s=>s.font===result.font&&s.family===result.family));
    assert.deepEqual(result.statuses.map(s=>s.color),['rgb(255, 118, 40)','rgb(100, 255, 242)','rgb(119, 217, 133)','rgb(147, 96, 181)','rgb(168, 75, 232)','rgb(255, 216, 74)','rgb(155, 233, 255)','rgb(170, 170, 170)']);
   }
  }
  console.log('Skill descriptions: six rarities at desktop/mobile sizes preserve equal text size, readable font, concept colors, explicit breaks and no tooltip scrolling.');
 }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
