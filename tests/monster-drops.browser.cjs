const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const client=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>client.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
const markup=client.slice(client.indexOf('  <div id="monsterDropModal"'),client.indexOf('  <div id="itemModal"'));
const script=`
var ASSET_BASE_URL='',monsterDropActive=false,monsterDropCancel=null,workbookDeadlineExpired=false,localGameDataSnapshot={},victoryRewardPreload={},victoryRewardResultPayload={};
var currentView={battle:{status:'victory',player:{hp:30,items:[]}},availableSkills:[]},decisions=[];
var stageClearPresentation=null;
function showTurnBanner(){}
var drops={a:{dropId:'a',monsterName:'녹슨 실외기',status:'pending',reward:{itemDetail:{itemId:'a',name:'튼튼한 운동화',rarity:'rare',rarityLabel:'희귀',effectSummary:'방어력 +2 / 회피율 +5%',description:'가벼운 발걸음으로 교실을 누빈다.'}}},
b:{dropId:'b',monsterName:'보스',status:'pending',reward:{itemDetail:{itemId:'b',name:'집중의 펜',rarity:'epic',rarityLabel:'영웅',effectSummary:'최대 문제 풀이 효율 +10%p',description:'한 번 더 생각하게 하는 펜.'}}}};
window.LearningRpgLocalRunEngine={itemDrops:()=>drops,skills:()=>[],decideDrop:(_,battle,id,claim)=>{drops[id].status=claim?'claimed':'ignored';decisions.push([id,claim]);if(claim)battle.player.items.push({itemId:id});}};
function cssEscape(s){return CSS.escape(s);}function setBattleInputLocked(){}function renderBattle(){}function getRewardRarityLabel(){return '희귀';}
function escapeHtml(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');}
${['animateMonsterItemPickup','presentMonsterItemDrops','renderOwnedItemCard','buildItemEffectDescription','buildItemFlavorDescription','normalizeRewardRarity','bindHoverTooltips','positionHoverTooltip','hideActiveHoverTooltips','refreshFinalVictoryRewardView','presentStageClear','openRewardAfterVictory','presentStageClearRegen','getVictoryRewardKey'].map(extract).join('\n')}
bindHoverTooltips();
`;
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try{
    for(const viewport of [{width:1366,height:768},{width:390,height:844}]){
      const page=await browser.newPage({viewport});const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.setContent('<!doctype html><html><head>'+styles+'</head><body style="background:#101920">'+markup+'<script>'+script+'</script></body></html>');
      await page.evaluate(()=>{window.result=presentMonsterItemDrops(currentView);});
      await page.waitForSelector('#monsterDropModal.active');
      assert.equal(await page.locator('#monsterDropTitle').textContent(),'아이템 획득!');
      await page.locator('#monsterDropCard .item-card').hover();
      await page.waitForSelector('#hoverTooltip.active');
      assert.ok((await page.locator('#hoverTooltip').textContent()).includes('방어력 +2'));
      assert.ok(await page.evaluate(()=>Number(getComputedStyle(document.getElementById('hoverTooltip')).zIndex)>Number(getComputedStyle(document.getElementById('monsterDropModal')).zIndex)));
      assert.ok(await page.locator('#hoverTooltip').evaluate(el=>{const r=el.getBoundingClientRect();return r.left>=0&&r.right<=innerWidth&&r.top>=0&&r.bottom<=innerHeight;}));
      if(process.env.DROP_PREVIEW_DIR){fs.mkdirSync(process.env.DROP_PREVIEW_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.DROP_PREVIEW_DIR,'item-drop-'+viewport.width+'.png')});}
      await page.locator('#monsterDropClaim').click();
      await page.waitForFunction(()=>document.getElementById('monsterDropCard').textContent.includes('집중의 펜'));
      assert.equal(await page.locator('#monsterDropModal').getAttribute('aria-hidden'),'false');
      await page.keyboard.press('Escape');assert.equal(await page.locator('#monsterDropModal').getAttribute('aria-hidden'),'false');
      await page.locator('#monsterDropIgnore').click();await page.evaluate(()=>window.result);
      assert.equal(await page.locator('#monsterDropModal').getAttribute('aria-hidden'),'true');
      assert.deepEqual(await page.evaluate(()=>decisions),[['a',true],['b',false]]);
      assert.deepEqual(await page.evaluate(()=>currentView.battle.player.items),[{itemId:'a'}]);
      assert.equal(await page.evaluate(()=>victoryRewardPreload!==null&&victoryRewardResultPayload!==null),true);
      await page.evaluate(()=>{
        Object.assign(window,{victoryRewardFlowStarted:false,victoryRewardRecoveryComplete:false,victoryRegenPresentationKey:'',preparedCount:0,logs:[]});
        currentView.runId='test-run';currentView.battle.battleId='final';currentView.battle.stage={stageId:'5-5',floor:5,stage:5};
        currentView.battle.monsterItemDrops=drops;Object.assign(currentView.battle.player,{maxHp:100,stats:{hp:100,hpRegen:5}});
        window.preloadVictoryRewardChoices=view=>{window.capturedDrops=JSON.parse(JSON.stringify(view.battle.monsterItemDrops));};
        window.buildStageResultPayload=view=>JSON.parse(JSON.stringify(view));
        window.showPreparedVictoryReward=()=>{preparedCount++;};window.pushLog=text=>logs.push(text);
        window.waitForBattleLogAdvance=()=>Promise.resolve();window.renderPlayerHud=()=>{};
        window.animatePlayerStatusEffect=()=>{};window.spawnFloatingText=()=>{};
        openRewardAfterVictory();
      });
      await page.waitForFunction(()=>preparedCount===1);
      assert.equal(await page.evaluate(()=>currentView.battle.player.hp),35);
      assert.equal(await page.evaluate(()=>capturedDrops.b.status),'ignored');
      assert.match(await page.evaluate(()=>logs.join(' ')),/5 재생/);
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      await page.evaluate(()=>{drops.a.status='pending';window.expiring=presentMonsterItemDrops(currentView);});
      await page.waitForSelector('#monsterDropModal.active');
      await page.evaluate(()=>{workbookDeadlineExpired=true;monsterDropCancel();});await page.evaluate(()=>window.expiring);
      assert.equal(await page.locator('#monsterDropModal').getAttribute('aria-hidden'),'true');
      assert.deepEqual(errors,[]);await page.close();
    }
    console.log('Monster drop UI passed: desktop/mobile, hover details, claim/ignore queue, expiry cleanup.');
  }finally{await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
