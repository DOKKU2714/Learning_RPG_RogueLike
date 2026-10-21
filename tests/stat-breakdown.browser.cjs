const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const source=fs.readFileSync('Battle.html','utf8');
const extract=name=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const funcs=['showBattleStats','getStatDescription','getBattleStatStartingStats','formatEffectiveStat','buildBattleStatTooltipContent','bindGlossaryTooltips','bindHoverTooltips','positionHoverTooltip'];
const output=path.resolve('.codex-temp/stat-breakdown');fs.mkdirSync(output,{recursive:true});
const html='<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+fs.readFileSync('UiStyles.html','utf8')+fs.readFileSync('UiTouchInteractions.html','utf8')+'</head><body style="background:#182230;min-height:100vh"><div id="battleStatsPanel" class="battle-stats-panel battle-quick-panel hidden"></div><script>'+`
var localGameDataSnapshot=null;
var currentView={currency:20,score:100,battle:{player:{hp:95,maxHp:120,shield:0,baseMaxActionPoint:4,maxActionPoint:5,currentActionPoint:3,
 startingStats:{hp:100,attack:10,defense:0,hpRegen:3,accuracy:100,evasion:0,criticalRate:5,criticalDamage:150},
 baseStats:{hp:110,attack:15,defense:0,hpRegen:5,accuracy:100,evasion:0,criticalRate:5,criticalDamage:150},
 stats:{hp:120,attack:17,defense:0,hpRegen:5,accuracy:98,evasion:0,criticalRate:6,criticalDamage:150},itemModifiers:{actionPoint:1}}}};
function escapeHtml(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;').replaceAll('"','&quot;');}
function getClientEffectiveStats(p){return {...p.stats,attack:21,criticalRate:8};}
var markBattleQuickAccessRead=()=>{},renderBattleQuickAccessIcons=()=>{},formatScore=String;
`+funcs.map(extract).join('\n')+'\nshowBattleStats();bindHoverTooltips();</script></body></html>';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const mobile of [false,true]){
   const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));await page.setContent(html);
   const row=label=>page.locator('.battle-stat-row').filter({has:page.locator('span',{hasText:new RegExp('^'+label+'$')})});
   assert.equal(await row('체력 회복').locator('b').innerText(),'5');
   assert.equal(await row('체력 회복').locator('b').evaluate(e=>getComputedStyle(e).color),'rgb(255, 224, 138)');
   assert.equal(await row('회피율').locator('b').getAttribute('class'),null);
   assert.equal(await row('공격력').locator('b').innerText(),'21');
   assert.equal(await row('공격력').getAttribute('data-stat-reward'),'5');
   assert.equal(await row('공격력').getAttribute('data-stat-item'),'2');
   assert.equal(await row('공격력').getAttribute('data-stat-buff'),'4');
   if(mobile)await row('공격력').tap();else await row('공격력').hover();
   const tooltip=page.locator(mobile?'.touch-preview-panel':'#hoverTooltip');
   assert.match(await tooltip.innerText(),/기본공격이나 스킬의 피해량을 높여주는 수치 입니다.*보상.*\+5.*아이템.*\+2.*버프·디버프.*\+4/s);
   for(const [key,color]of [['reward','rgb(120, 201, 255)'],['item','rgb(120, 201, 255)'],['buff','rgb(120, 201, 255)']]){
    assert.equal(await tooltip.locator('.stat-source-'+key).evaluate(e=>getComputedStyle(e).color),color);
   }
   const rect=await tooltip.boundingBox();assert.ok(rect.x>=0&&rect.x+rect.width<=(mobile?390:1280));
   await page.screenshot({path:path.join(output,mobile?'mobile.png':'desktop.png')});
   if(mobile)await page.locator('body').tap({position:{x:5,y:750}});else await page.mouse.move(20,750);
   if(mobile)await row('명중률').tap();else await row('명중률').hover();
   assert.equal(await tooltip.locator('.stat-source-negative strong').innerText(),'-2%p');
   assert.equal(await tooltip.locator('.stat-source-negative').evaluate(e=>getComputedStyle(e).color),'rgb(255, 129, 124)');
   assert.equal(await row('행동력').getAttribute('data-stat-item'),'1');assert.equal(await row('행동력').getAttribute('data-stat-buff'),'1');
   // Reproduce an older run whose baseline object was overwritten by rewards.
   await page.evaluate(()=>{
     const original={...currentView.battle.player.startingStats};
     CLIENT_STARTING_STATS_JSON=encodeURIComponent(JSON.stringify(original));
     const rewarded={...original,hp:103,evasion:5};
     localGameDataSnapshot={basePlayerStats:rewarded};
     Object.assign(currentView.battle.player,{hp:94,maxHp:103,startingStats:rewarded,baseStats:rewarded,stats:rewarded,itemModifiers:{}});
     showBattleStats();
   });
   assert.equal(await row('체력').getAttribute('data-stat-reward'),'3');
   assert.equal(await row('체력').locator('b').evaluate(e=>getComputedStyle(e).color),'rgb(255, 224, 138)');
   if(mobile)await page.locator('body').tap({position:{x:5,y:750}});else await page.mouse.move(20,750);
   if(mobile)await row('체력').tap();else await row('체력').hover();
   assert.equal(await tooltip.locator('.stat-source-reward strong').innerText(),'+3');
   await page.screenshot({path:path.join(output,mobile?'mobile-legacy-hp.png':'desktop-legacy-hp.png')});
   assert.deepEqual(errors,[]);await page.close();console.log('Stat colors and source breakdown OK:',mobile?'mobile':'desktop');
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
