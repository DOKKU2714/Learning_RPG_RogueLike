const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs');
const path=require('node:path');
const assert=require('node:assert/strict');
const client=fs.readFileSync('Battle.html','utf8'),server=fs.readFileSync('BattleService.gs','utf8');
const styles=fs.readFileSync('UiStyles.html','utf8');
const extract=(source,name)=>source.match(new RegExp('(?:    )?(?:async )?function '+name+'\\([^]*?\\n'+(source===client?'    ':'')+'\\}'))[0];
const panel=client.slice(client.indexOf('  <div id="levelUpBanner"'),client.indexOf('  <div id="questionModal"'));
const script=`
var levelAllocationActive=false,levelAllocationCancel=null,workbookDeadlineExpired=false,localGameDataSnapshot={},victoryRewardPreload={},victoryRewardResultPayload={},currentView={battle:{status:'victory',player:{hp:30,maxHp:30,baseStats:{hp:30,attack:10,criticalRate:5,levelProgress:{level:2,xp:20,points:3,spent:{}}},stats:{hp:30},items:[]}},availableSkills:[]};
var locked=false;function setBattleInputLocked(value){locked=value;}
function escapeHtml(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');}
function cssEscape(s){return CSS.escape(s);}
function renderBattle(view){renderPlayerExperience(view.battle.player);}
function calculateStatsWithItemEffects_(stats){return {...stats};}
${['getLevelStatOptions_','ensureLevelProgress_','allocateLevelStats_'].map(name=>extract(server,name)).join('\n')}
window.LearningRpgLocalRunEngine={levelOptions:getLevelStatOptions_,allocate:(_,b,a)=>allocateLevelStats_(b,a),skills:()=>[]};
${['getStatDescription','bindHoverTooltips','positionHoverTooltip','getPlayerLevelProgress','renderPlayerExperience','animateExperienceRewards','presentLevelStatAllocation','spawnFloatingText'].map(name=>extract(client,name)).join('\n')}
bindHoverTooltips();
`;
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    for(const viewport of [{width:1366,height:768},{width:390,height:844}]) {
      const page=await browser.newPage({viewport});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.setContent('<!doctype html><html><head>'+styles+'</head><body style="margin:0;background:#101920">'+
        '<div data-monster-id="m" style="position:absolute;top:100px;left:100px;width:80px;height:80px">몬스터</div>'+
        '<div style="position:absolute;bottom:30px;left:20px;right:20px"><div style="height:20px;background:#b34141">HP 30 / 30</div>'+
        '<div class="player-exp-row"><span id="playerLevelLabel"></span><div id="playerExpTrack" class="player-exp-track"><span id="playerExpFill"></span></div><span id="playerExpText"></span></div></div>'+
        '<div id="floatingLayer" style="position:fixed;inset:0;pointer-events:none"></div>'+panel+'<script>'+script+'</script></body></html>');
      await page.evaluate(()=>{
        window.flight=animateExperienceRewards([{type:'experience',monsterId:'m',amount:30,before:{level:1,xp:90},after:{level:2,xp:20}}]);
      });
      await page.waitForSelector('.experience-orb');
      assert.equal(await page.locator('.experience-orb').count(),5);
      await page.evaluate(()=>window.flight);
      assert.equal(await page.locator('#playerLevelLabel').textContent(),'Lv.2');
      assert.equal(await page.locator('#playerExpText').textContent(),'20 / 125');
      assert.equal(await page.locator('#playerLevelLabel').isVisible(),false);
      assert.equal(await page.locator('#playerExpText').isVisible(),false);
      const xpWidth=await page.locator('#playerExpFill').evaluate(e=>e.style.width);
      await page.evaluate(()=>renderPlayerExperience({hp:20,maxHp:30,stats:{hp:30}}));
      assert.equal(await page.locator('#playerExpFill').evaluate(e=>e.style.width),xpWidth,'HP previews preserve experience');
      const xpBounds=await page.locator('#playerExpTrack').boundingBox();
      assert.equal(xpBounds.y+xpBounds.height,viewport.height,'experience bar touches the viewport bottom');
      assert.equal(xpBounds.x,0);
      assert.equal(xpBounds.width,viewport.width);
      assert.ok(await page.locator('.experience-text').count());
      await page.evaluate(()=>{window.investment=presentLevelStatAllocation(currentView);});
      await page.waitForSelector('#levelStatModal.active');
      assert.equal(await page.locator('.level-stat-row').count(),9);
      const descriptions=[
        '기본공격이나 스킬의 피해량을 높여주는 수치 입니다.',
        '방어막 획득량이 증가하는 수치입니다.',
        '체력이 0 이하로 감소하면 게임에 패배합니다.',
        '스테이지 종료 후 회복하는 체력의 양 입니다.',
        '상대에게 공격이 적중 할 확률 입니다. 100% 이상의 수치는 상대의 회피율을 같은 양 만큼 상쇄 시킵니다.',
        '상대의 공격을 무시 할 확률 입니다.',
        '공격 시 적에게 추가 피해를 입힐 확률 입니다.',
        '치명타 발생 시 추가로 입히는 피해 배율 입니다.',
        '문제 풀이 시의 효율이 증가합니다.'
      ];
      for(let i=0;i<9;i++){
        const label=page.locator('.level-stat-label').nth(i);
        assert.equal(await label.getAttribute('data-tooltip'),descriptions[i]);
        await label.hover();
        assert.equal(await page.locator('#hoverTooltip').innerText(),descriptions[i]);
        assert.equal(await page.locator('#hoverTooltip').isVisible(),true);
      }
      assert.ok(await page.locator('#hoverTooltip').evaluate(e=>Number(getComputedStyle(e).zIndex))>9200);
      await page.locator('.level-stat-label').first().focus();
      assert.equal(await page.locator('#hoverTooltip').innerText(),descriptions[0]);
      assert.equal(await page.locator('#levelStatConfirm').isDisabled(),true);
      await page.keyboard.press('Escape');assert.equal(await page.locator('#levelStatModal').getAttribute('aria-hidden'),'false');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),true);
      if(process.env.LEVEL_PREVIEW_DIR){fs.mkdirSync(process.env.LEVEL_PREVIEW_DIR,{recursive:true});await page.screenshot({path:path.join(process.env.LEVEL_PREVIEW_DIR,`level-up-${viewport.width}.png`)});}
      for(const key of ['attack','criticalRate','questionEfficiency']) await page.locator(`[data-level-key="${key}"][data-level-delta="1"]`).click();
      assert.equal(await page.locator('#levelStatPoints').textContent(),'0');
      await page.locator('[data-level-key="attack"][data-level-delta="-1"]').click();
      assert.equal(await page.locator('#levelStatConfirm').isDisabled(),true);
      await page.locator('[data-level-key="attack"][data-level-delta="1"]').click();
      await page.locator('#levelStatConfirm').click();
      await page.evaluate(()=>window.investment);
      assert.equal(await page.locator('#levelStatModal').getAttribute('aria-hidden'),'true');
      const stats=await page.evaluate(()=>currentView.battle.player.baseStats);
      assert.equal(stats.attack,11);assert.equal(stats.criticalRate,6.5);assert.equal(stats.questionEfficiency,2);assert.equal(stats.levelProgress.points,0);
      assert.equal(await page.evaluate(()=>victoryRewardPreload===null && victoryRewardResultPayload===null),true);
      await page.evaluate(()=>{currentView.battle.player.baseStats.levelProgress.points=3;window.expiring=presentLevelStatAllocation(currentView);});
      await page.waitForSelector('#levelStatModal.active');
      await page.evaluate(()=>{workbookDeadlineExpired=true;levelAllocationCancel();});
      await page.evaluate(()=>window.expiring);
      assert.equal(await page.locator('#levelStatModal').getAttribute('aria-hidden'),'true');
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('Level system browser checks passed: desktop/mobile, EXP flight, level modal, allocations, overflow.');
  } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
