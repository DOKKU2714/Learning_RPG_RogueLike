// Run with Playwright installed, or set PLAYWRIGHT_MODULE to its bundled module path.
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const assert = require('node:assert/strict');
const { renderOutput } = require('./helpers/web-output.cjs');
const battle = fs.readFileSync('Battle.html','utf8');
const styles = fs.readFileSync('UiStyles.html','utf8');
const touch = fs.readFileSync('UiTouchInteractions.html','utf8');
const layout = battle.match(/    function bindMobileBattleLayout\([^]*?\n    \}/)[0];
const body = battle.slice(battle.indexOf('<main'),battle.indexOf("<?!= include_('UiLoadingModal')"));
const image = 'data:image/png;base64,' + fs.readFileSync('Resources/monster_001.png').toString('base64');
const output = fs.mkdtempSync(path.join(os.tmpdir(),'learning-rpg-mobile-'));
console.log('Screenshots:',output);
// Reproduce HtmlService's separate metadata injection, rather than trusting the HTML template tag.
const viewport = renderOutput('battle').output.metaTags.find(tag => tag.name === 'viewport');
assert.ok(viewport, 'WebApp.doGet must register a viewport; template meta tags are ignored');
const html = '<!doctype html><html class="battle-page-root"><head><meta name="viewport" content="' + viewport.content + '">'
  + styles + touch + '</head><body class="battle-page-body">' + body + '<script>window.actions=0;window.chooseAction=()=>actions++;window.submissions=0;window.submitQuestionAnswer=()=>submissions++;'
  + layout + ';bindMobileBattleLayout();</script></body></html>';

async function populate(page,count) {
  await page.evaluate(({count,image})=>{
    document.getElementById('monsterLayer').innerHTML=Array.from({length:count},(_,i)=>
      `<article class="monster-slot monster-count-${count}"><div class="thin-hp-bar monster-hp-bar"><span class="hp-current" style="width:65%"></span><span class="monster-shield-fill" style="left:65%;width:20%"></span><div class="monster-hp-text">65 <span class="shield-value">+ 20</span> / 100</div></div><div class="monster-intent" data-tooltip="다음 턴 공격 5"><span>⚔ 5</span></div><div class="monster-sprite-placeholder compact-monster monster-image-sprite"><img class="monster-art" src="${image}"></div><div class="monster-display-name">몬스터 ${i+1}</div></article>`).join('');
    document.getElementById('actionPanelApGauge').innerHTML='<span class="ap-label">행동력</span><span class="ap-icons"><span class="ap-pip filled"></span><span class="ap-pip filled"></span><span class="ap-pip filled"></span></span><strong>3 / 3</strong><span class="ap-cost-preview"></span>';
    document.getElementById('playerStatusRow').innerHTML='<span class="status-icon buff" data-tooltip="힘: 공격력 +1">↑<em class="status-stacks">1</em></span>';
    document.getElementById('playerHpFill').style.width='70%';
    document.getElementById('playerHpText').innerHTML='70 <span class="shield-value">+ 10</span> / 100';
    document.querySelectorAll('.active').forEach(e=>{if(!e.classList.contains('battle-hud')) e.classList.remove('active');});
  },{count,image});
  await page.waitForTimeout(100);
}

(async()=>{
  const browser=await chromium.launch({channel:process.env.PLAYWRIGHT_CHANNEL || 'msedge',headless:true});
  try {
    const mobile=await browser.newContext({viewport:{width:390,height:844},isMobile:true,hasTouch:true,reducedMotion:'reduce'});
    const page=await mobile.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    await page.setContent(html.replace(/<meta name="viewport"[^>]*>/,''));
    await populate(page,3);
    const unconfiguredWidth=await page.evaluate(()=>innerWidth);
    assert.ok(unconfiguredWidth>=980,'missing HtmlOutput viewport reproduces the shrunken desktop layout');
    await page.screenshot({path:path.join(output,'before-viewport-fix.png')});
    await page.setContent(html);
    assert.equal(await page.evaluate(()=>innerWidth),390,'registered viewport uses actual phone width');
    console.log('Viewport fix:',unconfiguredWidth,'->',390);
    for(const [width,height,count] of [[390,844,1],[390,844,2],[390,844,3],[360,640,3],[768,1024,3]]) {
      await page.setViewportSize({width,height});await populate(page,count);
      const dimensions=await page.evaluate(()=>{
        const rect=e=>{const r=e.getBoundingClientRect();return {left:r.left,right:r.right,top:r.top,bottom:r.bottom,width:r.width,height:r.height};};
        return {hud:rect(document.querySelector('.battle-hud')),button:rect(document.getElementById('attackActionButton')),
          monsters:[...document.querySelectorAll('.monster-slot')].map(rect),overflow:document.documentElement.scrollWidth>innerWidth,
          hpTextFits:[...document.querySelectorAll('.monster-hp-text')].every(e=>e.scrollWidth<=e.clientWidth)};
      });
      assert.equal(dimensions.overflow,false,JSON.stringify({width,height,dimensions}));
      assert.equal(dimensions.hpTextFits,true,'monster HP values must fit inside the bar');
      assert.ok(dimensions.button.width>=44 && dimensions.button.height>=44,'touch controls must be large enough');
      assert.ok(dimensions.monsters.every(r=>r.left>=0 && r.right<=width && r.bottom<=dimensions.hud.top+2),JSON.stringify({width,height,dimensions}));
      await page.screenshot({path:path.join(output,`${width}x${height}-${count}.png`)});
      console.log('Layout OK:',width,height,count);
    }
    await page.setViewportSize({width:390,height:844});await populate(page,3);
    await page.locator('#attackActionButton').tap();
    assert.equal(await page.evaluate(()=>actions),0,'first tap must only preview');
    assert.equal(await page.locator('.touch-preview-panel').isVisible(),true);
    assert.match(await page.locator('.touch-preview-panel').innerText(),/기본 공격/);
    assert.match(await page.locator('.touch-preview-panel').innerText(),/문제 풀이 효율/);
    const preview=await page.locator('.touch-preview-panel').boundingBox();
    assert.ok(preview.x>=0 && preview.y>=0 && preview.x+preview.width<=390 && preview.y+preview.height<=844);
    await page.screenshot({path:path.join(output,'touch-preview.png')});
    await page.locator('#attackActionButton').tap();
    assert.equal(await page.evaluate(()=>actions),1,'second tap executes once');
    await page.locator('#attackActionButton').tap();
    await page.locator('#guardActionButton').tap();
    assert.equal(await page.evaluate(()=>actions),1,'switching controls starts a new preview');
    await page.locator('#guardActionButton').tap();
    assert.equal(await page.evaluate(()=>actions),2);
    await page.locator('#attackActionButton').tap();
    await page.keyboard.press('Escape');
    await page.locator('#attackActionButton').focus();await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(()=>actions),3,'keyboard activation still executes immediately');
    await page.evaluate(()=>document.getElementById('actionPanel').insertAdjacentHTML('beforeend','<button id="disabledSkill" disabled class="skill-button"><span class="skill-detail-card">쿨타임 2턴</span></button>'));
    await page.locator('#disabledSkill').dispatchEvent('pointerup',{pointerType:'touch'});
    assert.equal(await page.locator('.touch-preview-panel').isVisible(),true,'disabled skills still show information');
    await page.locator('#battleStageText').tap();
    assert.equal(await page.locator('.touch-preview-panel').isVisible(),false,'tapping outside closes preview');
    await page.evaluate(()=>{
      const lobby=document.createElement('button');lobby.id='testLobby';lobby.className='lobby-icon-button';
      lobby.style.cssText='position:fixed;left:70px;top:12px;z-index:150;width:70px;height:50px';
      lobby.innerHTML='<span class="lobby-tooltip">문제집 관리</span>';lobby.onclick=()=>actions++;document.body.appendChild(lobby);
      const reward=document.createElement('button');reward.id='testReward';reward.className='reward-choice-card';
      reward.style.cssText='position:fixed;left:70px;top:170px;z-index:150;width:180px;min-height:80px;height:80px';
      reward.innerHTML='보상<span class="reward-detail-card">공격력 +2</span>';reward.onclick=()=>actions++;document.body.appendChild(reward);
    });
    await page.locator('#testLobby').tap();
    assert.equal(await page.evaluate(()=>actions),3);
    assert.equal(await page.locator('.touch-detail-copy').isVisible(),true,'cloned lobby tooltip remains visible');
    await page.locator('#testLobby').tap();assert.equal(await page.evaluate(()=>actions),4);
    await page.locator('#testReward').tap();assert.equal(await page.evaluate(()=>actions),4);
    await page.locator('#testReward').tap();assert.equal(await page.evaluate(()=>actions),5);
    await page.locator('#testReward').tap();
    await page.evaluate(()=>document.getElementById('testReward').remove());
    await page.waitForTimeout(30);
    assert.equal(await page.locator('.touch-preview-panel').isVisible(),false,'removed dynamic controls cannot leave stale previews');
    await page.evaluate(()=>{
      const modal=document.getElementById('questionModal');
      modal.classList.add('active');modal.setAttribute('aria-hidden','false');
      document.getElementById('questionEfficiencyPercent').textContent='50%';
      document.getElementById('questionEfficiencyActionValue').textContent='(5)';
      document.getElementById('questionEfficiencyFill').style.width='40%';
    });
    for(const width of [360,390,430]) {
      await page.setViewportSize({width,height:844});
      const gauge=await page.evaluate(()=>{
        const meter=document.getElementById('questionEfficiencyMeter');
        return {width:meter.getBoundingClientRect().width,panel:meter.parentElement.getBoundingClientRect().width,
          fill:document.getElementById('questionEfficiencyFill').style.width};
      });
      assert.ok(Math.abs(gauge.width-gauge.panel)<=2,'mobile efficiency track must fill its panel');
      assert.equal(gauge.fill,'40%','actual efficiency fill remains proportional');
    }
    await page.screenshot({path:path.join(output,'question-efficiency-full-width.png')});
    console.log('Mobile question efficiency track width OK');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(()=>{
      document.getElementById('questionPrompt').textContent='긴 지문이 있는 모바일 문제입니다. 내용을 읽고 정답을 선택하세요. '.repeat(35);
      document.getElementById('questionAnswerArea').innerHTML=[1,2,3,4].map(i=>`<label class="question-choice"><input type="radio" name="long-answer">${i}. 긴 선택지의 내용도 모두 읽을 수 있어야 합니다.</label>`).join('');
    });
    const scrollBox=page.locator('#questionModal > .question-modal');
    const scrolling=await scrollBox.evaluate(e=>({height:e.clientHeight,scrollHeight:e.scrollHeight,overflow:getComputedStyle(e).overflowY}));
    assert.ok(scrolling.scrollHeight>scrolling.height);
    assert.equal(scrolling.overflow,'auto');
    const confirm=await page.locator('#questionSubmitButton').boundingBox();
    assert.ok(confirm.y>=0 && confirm.y+confirm.height<=844,'confirmation stays in view even with a long question');
    const cdp=await mobile.newCDPSession(page);
    await cdp.send('Input.dispatchTouchEvent',{type:'touchStart',touchPoints:[{x:195,y:600}]});
    for(let y=570;y>=270;y-=30) {
      await cdp.send('Input.dispatchTouchEvent',{type:'touchMove',touchPoints:[{x:195,y}]});
      await page.waitForTimeout(16);
    }
    await cdp.send('Input.dispatchTouchEvent',{type:'touchEnd',touchPoints:[]});
    // A tap during native momentum scrolling stops inertia instead of activating a button.
    await page.waitForFunction(()=>{
      const e=document.querySelector('#questionModal > .question-modal');
      if(e.lastScrollCheck===e.scrollTop) e.stableScrollFrames=(e.stableScrollFrames || 0)+1;
      else e.stableScrollFrames=0;
      e.lastScrollCheck=e.scrollTop;
      return e.stableScrollFrames>=6;
    },null,{polling:'raf'});
    assert.ok(await scrollBox.evaluate(e=>e.scrollTop)>0,'a real touch swipe scrolls the question dialog');
    await page.locator('#questionSubmitButton').tap();
    assert.equal(await page.evaluate(()=>submissions),1,'visible confirmation remains operable');
    await page.screenshot({path:path.join(output,'long-question-scroll.png')});
    console.log('Long mobile question: sticky confirmation and touch scrolling OK');
    assert.deepEqual(errors,[]);
    const desktop=await browser.newContext({viewport:{width:1280,height:800},reducedMotion:'reduce'});
    const mouse=await desktop.newPage();await mouse.setContent(html);await populate(mouse,3);
    await mouse.locator('#attackActionButton').click();
    assert.equal(await mouse.evaluate(()=>actions),1,'mouse activation must remain one click');
    console.log('Touch, disabled controls, keyboard and desktop input OK');
    console.log('Screenshots:',output);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
