const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),vm=require('node:vm'),assert=require('node:assert/strict');
const source=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const c=vm.createContext({escapeHtml:String,normalizeRewardRarity:()=> 'common',getRewardRarityLabel:()=> '일반',
 getRewardIconUrl:()=> '',getRewardDisplayTitle:()=> '보상',getRewardSkillConcept:()=> '암살',getSkillActionPointCost:()=>1,
 renderRewardRarityGems:()=>'',getSkillCooldownDisplayText:()=> '쿨타임 2턴',getSkillUseLimitText:()=>'',
 buildSkillUpgradeChangeSummary:()=>'',buildSkillFlavorDescription:()=>'',buildSkillDetailDescription:()=> '적 하나에게 <strong class="skill-damage-number">10</strong> 피해를 준다.'});
for(const name of ['renderRewardActionPointBadge','renderSkillCardContent','getRewardConceptClass','renderInlineRewardSkillDescription','renderSkillCardCornerMeta','renderDifficultyStars'])vm.runInContext(extract(name),c);
const start=source.indexOf('rewardView.choices.map(function(reward, index) {');
const template=source.slice(start,source.indexOf("}).join('');",start)+11);
c.rewardView={choices:[{rewardId:'a',type:'skill',skillDetail:{name:'백어택',level:2,difficultyBonus:2}},
 {rewardId:'b',type:'stat',description:'체력',value:5},
 {rewardId:'c',type:'skillUpgrade',skillDetail:{name:'백어택',level:3,difficultyBonus:2}}]};
const cards=vm.runInContext(template,c);
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  for(const width of [1100,390]) {
   const page=await browser.newPage({viewport:{width,height:900}});
   await page.setContent('<html><head>'+styles+'</head><body><div id="rewardChoices" class="reward-choice-grid">'+cards+'</div></body></html>');
   assert.equal(await page.locator('.reward-choice-shortcut').count(),0);
   assert.equal(await page.locator('.reward-skill-concept').count(),2);
   assert.equal(await page.locator('.reward-skill-header-meta').first().innerText(),'일반 / Lv.2\n암살');
   assert.equal(await page.locator('.reward-skill-upgrade .reward-upgrade-label').innerText(),'스킬 강화');
   assert.equal(await page.locator('.reward-skill-upgrade').evaluate(el=>getComputedStyle(el).borderTopColor),'rgb(255, 214, 92)');
   const geometry=await page.locator('.reward-inline-skill').first().evaluate(card=>{
    const el=s=>card.querySelector(s),rect=s=>el(s).getBoundingClientRect().toJSON();
    return {title:rect('.reward-choice-heading'),meta:rect('.reward-skill-header-meta'),icon:rect('.reward-choice-icon-wrap'),
     description:rect('.reward-inline-description'),corner:rect('.reward-skill-corner-meta'),card:card.getBoundingClientRect().toJSON(),
     numberSize:parseFloat(getComputedStyle(el('.skill-damage-number')).fontSize),textSize:parseFloat(getComputedStyle(el('.skill-detail-description')).fontSize),
     conceptColor:getComputedStyle(el('.reward-skill-concept')).color};
   });
   assert.ok(geometry.title.bottom<=geometry.meta.top);
   assert.ok(geometry.corner.top>=geometry.description.bottom);
   assert.ok(geometry.corner.bottom<=geometry.card.bottom);
   assert.ok(Math.abs(geometry.icon.width-(width>760?92:82.8))<1);
   assert.equal(geometry.numberSize/geometry.textSize,1.25);
   assert.equal(geometry.conceptColor,'rgb(147, 96, 181)');
   await page.close();
  }
  console.log('Reward layout OK at desktop/mobile widths');
 } finally {await browser.close();}
})();
