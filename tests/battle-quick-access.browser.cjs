const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const battle = fs.readFileSync('Battle.html','utf8');
const styles = fs.readFileSync('UiStyles.html','utf8');
const touch = fs.readFileSync('UiTouchInteractions.html','utf8');
const extract = name => battle.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const body = battle.slice(battle.indexOf('<main'),battle.indexOf("<?!= include_('UiLoadingModal')"));
const script = `var ASSET_BASE_URL='https://assets.test',battleQuickAccessState=null,battleQuickAccessRunKey='';
var currentView=JSON.parse(sessionStorage.getItem('fixtureCurrentView')||'null')||{
runId:'run-1',playerId:'p',currency:0,score:0,battle:{player:{hp:30,maxHp:30,shield:0,currentActionPoint:3,maxActionPoint:3,stats:{attack:8,defense:3},items:[],itemDetails:[]}}};
var isBattleResultLoading=()=>false,getClientEffectiveStats=p=>p.stats,formatScore=String;
var escapeHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('>','&gt;');
var normalizeRewardRarity=r=>r||'common',getRewardRarityLabel=()=> '일반';`;
const startingStats = `var localGameDataSnapshot={basePlayerStats:{hp:25,attack:5,defense:4,hpRegen:3,accuracy:100,evasion:0,criticalRate:5,criticalDamage:150}};`;
const funcs = ['getBattleQuickStatSignature','getBattleQuickItemCounts','saveBattleQuickAccessState','updateBattleQuickAccess',
  'markBattleQuickAccessRead','renderBattleQuickAccessIcons','toggleBattleStats','closeBattleStats','toggleBattleInventory',
  'toggleBattleMenu','closeBattleMenu','showBattleStats','formatEffectiveStat','showBattleItems','closeItemModal',
  'getOwnedItemDetailsForModal','renderOwnedItemCard','buildItemEffectDescription','buildItemFlavorDescription','bindHoverTooltips','positionHoverTooltip'];
const html = '<!doctype html><html><head><meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+touch+
  '</head><body>'+body.replaceAll('<?= getAssetBaseUrl_() ?>','https://assets.test')+'<script>'+script+
  startingStats+funcs.map(extract).join('\n')+'\nbindHoverTooltips();updateBattleQuickAccess(currentView);</script></body></html>';
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'battle-quick-access-'));
  try {
    for (const mobile of [false,true]) {
      const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},isMobile:mobile,hasTouch:mobile});
      const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.route('**/*',route=>{
        const url=route.request().url();
        if(url==='https://game.test/')return route.fulfill({contentType:'text/html',body:html});
        if(url.startsWith('https://assets.test/Resources/InGameMenu/'))return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join('..','Learning_RPG_LogueLike_Assets','Resources','InGameMenu',path.basename(url)))});
        return route.abort();
      });
      await page.goto('https://game.test/');
      const activate=async selector=>mobile?page.locator(selector).tap():page.locator(selector).click();
      assert.equal(await page.locator('#battleMenuPanel button').count(),3);
      assert.equal(await page.locator('.battle-quick-notification:not(.hidden)').count(),0);
      assert.equal(await page.locator('.battle-quick-button img').evaluateAll(images=>images.every(i=>i.complete&&i.naturalWidth>0)),true);
      await page.evaluate(()=>{currentView.battle.player.hp=20;currentView.battle.player.shield=5;currentView.battle.player.currentActionPoint=0;updateBattleQuickAccess(currentView);});
      assert.equal(await page.locator('.battle-quick-notification:not(.hidden)').count(),0);
      await page.evaluate(()=>{currentView.battle.player.stats.attack=10;currentView.battle.player.items=[{itemId:'gloves',count:1}];currentView.battle.player.itemDetails=[{itemId:'gloves',name:'장갑',effectSummary:'공격력 +2'}];updateBattleQuickAccess(currentView);});
      assert.equal(await page.locator('.battle-quick-notification:not(.hidden)').count(),2);
      if(!mobile){await page.locator('#battleStatsButton').hover();assert.equal(await page.locator('#battleStatsTooltip').isVisible(),true);}
      await page.screenshot({path:path.join(output,mobile?'mobile-badges.png':'desktop-badges.png')});
      await page.evaluate(()=>{currentView.battle.player.baseStats={attack:8,defense:4,hp:27,accuracy:100,hpRegen:4,evasion:0,criticalRate:7,criticalDamage:150};Object.assign(currentView.battle.player.stats,{hp:30,accuracy:99,hpRegen:5,evasion:0,criticalRate:7,criticalDamage:150});});
      await activate('#battleStatsButton');
      assert.equal(await page.locator('#battleStatsPanel').isVisible(),true);
      assert.equal(await page.locator('#battleStatsButton').getAttribute('aria-expanded'),'true');
      assert.equal(await page.locator('#battleStatsNotification').isVisible(),false);
      assert.equal(await page.locator('#battleInventoryNotification').isVisible(),true);
      assert.match(await page.locator('#battleStatsPanel').innerText(),/공격력.*10/s);
      const statRow=label=>page.locator('.battle-stat-row').filter({has:page.locator('span', {hasText:new RegExp('^'+label+'$')})});
      assert.equal(await statRow('공격력').locator('.stat-item-increase').innerText(),'(+5)');
      assert.equal(await statRow('방어력').locator('.stat-item-decrease').innerText(),'(-1)');
      assert.equal(await statRow('체력').locator('.stat-item-increase').innerText(),'(+5)');
      assert.equal(await statRow('명중률').locator('.stat-item-decrease').innerText(),'(-1)');
      assert.equal(await statRow('회피율').locator('.battle-stat-item-delta').count(),0);
      assert.equal(await statRow('체력 회복').locator('b').innerText(),'5 (+2)');
      assert.equal(await statRow('체력 회복').locator('b').evaluate(e=>getComputedStyle(e).color),'rgb(255, 224, 138)');
      assert.equal(await statRow('체력 회복').locator('b').evaluate(e=>getComputedStyle(e).fontWeight),'900');
      assert.equal(await statRow('치명타 확률').locator('.battle-stat-value-changed').count(),1);
      assert.equal(await statRow('치명타 확률').locator('.battle-stat-item-delta').innerText(),'(+2)');
      assert.match(await statRow('공격력').getAttribute('data-tooltip'),/스텟 보상·아이템 효과의 합계/);
      assert.equal(await statRow('회피율').locator('.battle-stat-value-changed').count(),0);
      assert.match(await statRow('체력 회복').getAttribute('data-tooltip'),/스테이지를 클리어할 때 회복/);
      assert.equal(await page.locator('.battle-stat-row[data-tooltip]').count(),12);
      if(!mobile){
        await statRow('체력 회복').locator('b').hover();
        assert.equal(await page.locator('#hoverTooltip').getAttribute('aria-hidden'),'false');
        assert.match(await page.locator('#hoverTooltip').innerText(),/최대 체력을 넘어서 회복하지 않습니다/);
        await page.mouse.move(200,200);
      }
      assert.equal(await statRow('공격력').locator('.stat-item-increase').evaluate(e=>getComputedStyle(e).color),'rgb(120, 201, 255)');
      assert.equal(await statRow('방어력').locator('.stat-item-decrease').evaluate(e=>getComputedStyle(e).color),'rgb(255, 129, 124)');
      assert.equal(await page.evaluate(()=>formatEffectiveStat({attack:5},{attack:12},'attack','',{attack:10})), '12 <span class="battle-stat-item-delta stat-item-increase" title="스텟 보상·아이템 효과 합계">(+5)</span>');
      await page.evaluate(()=>{currentView.battle.player.stats.attack=12;updateBattleQuickAccess(currentView);});
      assert.equal(await page.locator('#battleStatsNotification').isVisible(),false);
      await page.screenshot({path:path.join(output,mobile?'mobile-stats.png':'desktop-stats.png')});
      await activate('#battleInventoryButton');
      assert.equal(await page.locator('#battleStatsPanel').isVisible(),false);
      assert.equal(await page.locator('#itemModal').isVisible(),true);
      assert.match(await page.locator('#battleInventoryIcon').getAttribute('src'),/Backpack_Open\.png$/);
      assert.equal(await page.locator('#battleInventoryNotification').isVisible(),false);
      assert.match(await page.locator('#itemModalGrid').innerText(),/장갑/);
      await activate('#itemModal .modal-topline button');
      assert.match(await page.locator('#battleInventoryIcon').getAttribute('src'),/Backpack_Close\.png$/);
      await page.evaluate(()=>{currentView.battle.player.items[0].count=2;currentView.battle.player.itemDetails[0].count=2;updateBattleQuickAccess(currentView);sessionStorage.setItem('fixtureCurrentView',JSON.stringify(currentView));});
      assert.equal(await page.locator('#battleInventoryNotification').isVisible(),true);
      await page.reload();
      assert.equal(await page.locator('#battleInventoryNotification').isVisible(),true);
      assert.equal(await page.locator('#battleStatsNotification').isVisible(),false);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      await page.evaluate(()=>{currentView.runId='new-run';updateBattleQuickAccess(currentView);});
      assert.equal(await page.locator('.battle-quick-notification:not(.hidden)').count(),0);
      assert.deepEqual(errors,[]);console.log('Quick access, item images, notifications, reload and input OK:',mobile?'mobile':'desktop');
      await context.close();
    }
    console.log('Screenshots:',output);
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
