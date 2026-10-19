const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('Battle.html', 'utf8');
const extract = name => html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];
const modal = html.slice(html.indexOf('  <div id="rewardModal"'), html.indexOf('  <div id="scoreModal"'));

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 900 } });
    const errors = [];
    page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html><head>' + fs.readFileSync('UiStyles.html', 'utf8') + '</head><body>' + modal +
      '<div id="starBurstLayer"><span class="star-particle-correct">★</span></div><script>' + `
      var workbookDeadlineExpired=false,selectedRewardId='',rewardSelectionApplying=false;
      function animateStageClearRegen(){} function renderBattleBackground(){} function fitRewardCardText(){}
      function escapeHtml(v){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');}
      function getRewardIconUrl(){return 'data:image/svg+xml,'+encodeURIComponent('<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 100 100"><path fill="silver" stroke="white" stroke-width="2" d="M50 8 78 30 64 72 36 72 22 30Z"/><path fill="#778899" d="M50 8 64 72 50 92 36 72Z"/></svg>');}
      function normalizeRewardRarity(v){return v;} function getRewardRarityLabel(v){return v;}
      function getRewardDisplayTitle(){return '능력 강화';}
      function renderRewardDetailCard(){return '<span class="reward-detail-card">보상 설명</span>';}
      function renderRewardRarityGems(){return '';}
      function startRewardReroll(){} function confirmRewardChoice(){}
      var view={localTransitionToken:'signed',choices:['common','rare','unique'].map((rarity,i)=>({rewardId:'r'+i,type:'stat',rarity,description:['힘 +1','지혜 +2','체력 +5'][i]}))};
      ` + ['renderRewardChoices', 'selectRewardCandidate', 'handleRewardKeyboard'].map(extract).join('\n') +
      ';document.addEventListener("keydown",handleRewardKeyboard);renderRewardChoices(view);</script></body></html>');
    assert.equal(await page.locator('#starBurstLayer').innerHTML(), '');
    const cards = page.locator('.reward-choice-card');
    const timings = await cards.evaluateAll(nodes => nodes.map(el => ({
      duration:parseFloat(getComputedStyle(el).getPropertyValue('--reward-charge-time')),
      delay:parseFloat(getComputedStyle(el.querySelector('.reward-charge-light')).animationDelay),
      halo:parseFloat(getComputedStyle(el).getPropertyValue('--reward-halo')),
      shake:parseFloat(getComputedStyle(el).getPropertyValue('--reward-shake')),
      flash:parseFloat(getComputedStyle(el).getPropertyValue('--reward-flash-scale')),
      sheen:getComputedStyle(el,'::after').content,
    })));
    assert.deepEqual(timings.map(t => t.delay), [0,0,0], 'all lights start together');
    assert.deepEqual(timings.map(t => t.duration), [300,1150,4150]);
    const rhythm = await cards.evaluateAll(nodes => nodes.map(card => ({
      charge:card.querySelector('.reward-charge-light').getAnimations().map(a=>({name:a.animationName,duration:a.effect.getTiming().duration,iterations:a.effect.getTiming().iterations})),
      flicker:card.querySelector('.reward-charge-star').getAnimations()[0].effect.getTiming(),
      spectrum:card.querySelector('.reward-charge-spectrum').getAnimations()[0].effect.getTiming(),
    })));
    rhythm.forEach(t => {
      assert.equal(t.charge.find(a=>a.name==='reward-charge-grow').duration,300);
      assert.deepEqual(t.charge.find(a=>a.name==='reward-charge-vibrate'),{name:'reward-charge-vibrate',duration:120,iterations:Infinity});
      assert.equal(t.flicker.duration,240); assert.equal(t.flicker.iterations,Infinity);
      assert.equal(t.spectrum.duration,800); assert.equal(t.spectrum.iterations,Infinity);
    });
    const allChargeTimes = await cards.nth(0).evaluate(el => ['common','uncommon','rare','epic','legendary','unique'].map(rarity=>{
      const copy=el.cloneNode(true);copy.className='reward-choice-card rarity-'+rarity;el.parentElement.appendChild(copy);
      const time=parseFloat(getComputedStyle(copy).getPropertyValue('--reward-charge-time'));copy.remove();return time;
    }));
    assert.deepEqual(allChargeTimes,[300,650,1150,1900,2900,4150]);
    assert.match(await cards.nth(2).locator('.reward-charge-star').evaluate(el => getComputedStyle(el,'::before').clipPath), /polygon\(50% 0%, 54% 44%/);
    assert.match(await cards.nth(2).locator('.reward-charge-spectrum').evaluate(el => getComputedStyle(el).backgroundImage), /conic-gradient/);
    assert.equal(await cards.nth(0).locator('.reward-dust-particle').count(), 0);
    assert.equal(await cards.nth(1).locator('.reward-dust-particle').count(), 0);
    assert.equal(await cards.nth(2).locator('.reward-dust-particle').count(), 40);
    assert.ok(timings[0].duration < timings[1].duration && timings[1].duration < timings[2].duration);
    assert.ok(timings[0].halo < timings[1].halo && timings[1].halo < timings[2].halo);
    assert.ok(timings[0].shake < timings[1].shake && timings[1].shake < timings[2].shake);
    assert.ok(timings[0].flash < timings[1].flash && timings[1].flash < timings[2].flash);
    assert.equal(timings[0].sheen, 'none');
    assert.notEqual(timings[1].sheen, 'none');
    const highHeading = cards.nth(2).locator('.reward-choice-heading');
    assert.equal(await highHeading.evaluate(el => getComputedStyle(el).visibility), 'hidden');
    await page.keyboard.press('3');
    assert.equal(await page.evaluate(() => selectedRewardId), '');
    await page.waitForTimeout(1100);
    assert.equal(await cards.nth(0).locator('.reward-choice-heading').evaluate(el => getComputedStyle(el).visibility), 'visible');
    assert.equal(await highHeading.evaluate(el => getComputedStyle(el).visibility), 'hidden');
    assert.ok(Number(await cards.nth(2).locator('.reward-charge-light').evaluate(el => getComputedStyle(el).opacity)) > 0);
    if (process.env.REWARD_CHARGE_SCREENSHOT) await page.screenshot({ path:process.env.REWARD_CHARGE_SCREENSHOT });
    await page.waitForTimeout(timings[2].duration - 1100 + 1000);
    assert.equal(await highHeading.evaluate(el => getComputedStyle(el).visibility), 'visible');
    assert.equal(await cards.nth(2).locator('.reward-choice-icon-wrap').evaluate(el => el.getAnimations().length), 0);
    await page.waitForFunction(() => getComputedStyle(document.querySelector('.rarity-unique .reward-charge-light')).visibility === 'hidden', null, {timeout:5000});
    await cards.nth(2).click();
    await page.waitForTimeout(270);
    assert.equal(await page.evaluate(() => selectedRewardId), 'r2');
    assert.equal(await page.locator('#rewardConfirmButton').isDisabled(), false);
    assert.equal(await cards.nth(2).evaluate(el => getComputedStyle(el).transform), 'matrix(1, 0, 0, 1, 0, -5)');
    await cards.nth(2).hover();
    await page.waitForTimeout(170);
    assert.equal(await cards.nth(2).locator('.reward-detail-card').evaluate(el => getComputedStyle(el).opacity), '1');
    if (process.env.REWARD_REVEAL_SCREENSHOT) await page.screenshot({ path: process.env.REWARD_REVEAL_SCREENSHOT });

    // Freeze each rarity at the same point in its own reveal, so the actual
    // interpolated cross -> rectangle -> contraction can be inspected reliably.
    await page.evaluate(() => {
      view.choices = ['epic','legendary','unique'].map((rarity,i) => ({rewardId:'r'+i,type:'stat',rarity,description:'힘 +' + (i+3)}));
      renderRewardChoices(view);
      window.revealAnimations = Array.from(document.querySelectorAll('.reward-choice-card'), card => ({
        charge: parseFloat(getComputedStyle(card).getPropertyValue('--reward-charge-time')),
        animations: card.getAnimations({subtree:true}),
      }));
      revealAnimations.forEach(({animations}) => animations.forEach(a => a.pause()));
      document.querySelector('.reward-modal').getAnimations().forEach(a => a.finish());
    });
    const seek = async offset => {
      await page.evaluate(offset => revealAnimations.forEach(({charge,animations}) => animations.forEach(a => {a.currentTime = charge + offset;})), offset);
    };
    assert.deepEqual(await cards.evaluateAll(nodes => nodes.map(el => el.querySelectorAll('.reward-dust-particle').length)), [24,32,40]);
    const dustColors = await cards.evaluateAll(nodes => nodes.map(el => ({
      particle:getComputedStyle(el.querySelector('.reward-dust-particle')).color,
      rarity:getComputedStyle(el).getPropertyValue('--reward-gem-color').trim(),
    })));
    assert.deepEqual(dustColors.map(c => c.particle), ['rgb(223, 114, 255)','rgb(255, 141, 54)','rgb(255, 74, 74)']);
    await seek(-700);
    const chargeTint = () => cards.evaluateAll(nodes => nodes.map(card => ({
      color:getComputedStyle(card.querySelector('.reward-charge-star'),'::before').backgroundColor,
      aura:Number(getComputedStyle(card.querySelector('.reward-charge-light'),'::after').opacity),
    })));
    const initialTint = await chargeTint();
    initialTint.forEach(state => { assert.equal(state.color,'rgb(255, 255, 255)'); assert.equal(state.aura,0); });
    await seek(-350);
    const halfwayTint = await chargeTint();
    halfwayTint.forEach((state,i) => {
      assert.notEqual(state.color,initialTint[i].color,'rarity tint begins before the card morph');
      assert.notEqual(state.color,dustColors[i].particle,'tint blends gradually');
      assert.ok(state.aura > 0 && state.aura < .65);
    });
    await seek(0);
    assert.deepEqual((await chargeTint()).map(state => state.color),dustColors.map(state => state.particle));
    await seek(-150);
    const sustainedCharge = await cards.evaluateAll(nodes => nodes.map(card => ({
      scale:Number(getComputedStyle(card.querySelector('.reward-charge-light')).scale),
      target:Number(getComputedStyle(card).getPropertyValue('--reward-charge-scale')),
      flicker:card.querySelector('.reward-charge-star').getAnimations()[0].playState,
    })));
    sustainedCharge.forEach(state=>assert.equal(state.scale,state.target,'growth finishes at the same speed and holds while the effects repeat'));
    if (process.env.REWARD_SPECTRUM_SCREENSHOT) await page.screenshot({path:process.env.REWARD_SPECTRUM_SCREENSHOT});
    await seek(85);
    const crossShape = await cards.nth(0).locator('.reward-light-card').evaluate(el => getComputedStyle(el).clipPath);
    await seek(370);
    const lightCardState = await cards.nth(0).locator('.reward-light-card').evaluate(el => ({
      shape:getComputedStyle(el).clipPath, scale:new DOMMatrixReadOnly(getComputedStyle(el).transform).a,
    }));
    assert.notEqual(crossShape, lightCardState.shape);
    assert.match(lightCardState.shape, /polygon\(50% 0%, 100% 0%, 100% 0%/);
    assert.ok(lightCardState.scale > 1, 'light reaches the full card silhouette');
    const rarityFlash = await cards.evaluateAll(nodes => nodes.map(card => ({
      color:getComputedStyle(card.querySelector('.reward-light-card'),'::after').backgroundColor,
      opacity:Number(getComputedStyle(card.querySelector('.reward-light-card'),'::after').opacity),
    })));
    assert.deepEqual(rarityFlash.map(s=>s.color),['rgb(223, 114, 255)','rgb(255, 141, 54)','rgb(255, 74, 74)']);
    rarityFlash.forEach(state=>assert.equal(state.opacity,1,'the full card silhouette flashes in its rarity color'));
    assert.equal(await cards.nth(0).locator('.reward-choice-heading').evaluate(el => getComputedStyle(el).visibility), 'hidden');
    if (process.env.REWARD_MORPH_SCREENSHOT) await page.screenshot({path:process.env.REWARD_MORPH_SCREENSHOT});
    for (const offset of [85,200,370,450,520,850]) {
      await seek(offset);
      const geometry=await cards.nth(0).locator('.reward-light-card').evaluate(el=>{
        const style=getComputedStyle(el),m=new DOMMatrixReadOnly(style.transform);
        return {a:m.a,b:m.b,c:m.c,d:m.d,points:Array.from(style.clipPath.matchAll(/([\d.]+)% ([\d.]+)%/g),match=>[Number(match[1]),Number(match[2])])};
      });
      assert.equal(geometry.b,0,'light never rotates');assert.equal(geometry.c,0);
      assert.equal(geometry.a,geometry.d,'light scales uniformly from its center');
      assert.equal(geometry.points.length,12);
      for(let i=1;i<6;i++) {
        const mirror=geometry.points[12-i];
        assert.ok(Math.abs(geometry.points[i][0]+mirror[0]-100)<.01,'morph stays symmetric horizontally');
        assert.ok(Math.abs(geometry.points[i][1]-mirror[1])<.01);
      }
    }
    await seek(620);
    assert.equal(await cards.nth(0).locator('.reward-light-card').evaluate(el=>Number(getComputedStyle(el,'::after').opacity)),0,'rarity flash ends after contraction');
    const contractedScale = await cards.nth(0).locator('.reward-light-card').evaluate(el => new DOMMatrixReadOnly(getComputedStyle(el).transform).a);
    assert.ok(contractedScale < lightCardState.scale * .2, 'card light rapidly contracts before disappearing');
    assert.equal(await cards.nth(0).locator('.reward-choice-heading').evaluate(el => getComputedStyle(el).visibility), 'visible');
    assert.ok(Number(await cards.nth(0).locator('.reward-dust-particle').first().evaluate(el => getComputedStyle(el).opacity)) > 0);
    await seek(850);
    const lingering=await cards.nth(0).locator('.reward-reveal-flash').evaluate(el=>({opacity:Number(getComputedStyle(el).opacity),glow:Number(getComputedStyle(el,'::after').opacity),visibility:getComputedStyle(el).visibility}));
    assert.equal(lingering.visibility,'visible');
    assert.ok(lingering.opacity>0 && lingering.opacity<1 && lingering.glow>0,'bright afterglow fades after the fast collapse');
    if (process.env.REWARD_DUST_SCREENSHOT) await page.screenshot({path:process.env.REWARD_DUST_SCREENSHOT});
    await seek(2800);
    const halos = await cards.evaluateAll(nodes => nodes.map(card => {
      const style=getComputedStyle(card,'::before');
      return {shadow:style.boxShadow,opacity:Number(style.opacity),layer:style.zIndex,blur:style.filter};
    }));
    halos.forEach((state,i) => {
      assert.ok(state.shadow.includes(dustColors[i].particle),'persistent halo uses the card rarity color');
      assert.ok(state.opacity > 0 && state.opacity < .6,'halo stays subtle after the reveal');
      assert.equal(state.layer,'-1','halo sits behind the card content');
      assert.equal(state.blur,'blur(8px)');
    });
    assert.ok((await page.locator('.reward-dust-particle').evaluateAll(nodes => nodes.map(el => getComputedStyle(el).opacity))).every(v => Number(v) === 0), 'burst finishes instead of running indefinitely');
    assert.equal(await cards.nth(0).locator('.reward-reveal-flash').evaluate(el => getComputedStyle(el).visibility), 'hidden');
    await page.setViewportSize({width:390,height:844});
    await page.evaluate(() => renderRewardChoices(view));
    assert.equal(await cards.count(), 3);
    assert.ok(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'effects do not widen the mobile viewport');
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => renderRewardChoices(view));
    assert.equal(await cards.nth(2).evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.equal(await cards.nth(2).evaluate(el => getComputedStyle(el).visibility), 'visible');
    assert.equal(await cards.nth(2).locator('.reward-choice-heading').evaluate(el => getComputedStyle(el).visibility), 'visible');
    assert.equal(await page.locator('.reward-reveal-effect').evaluateAll(nodes => nodes.every(el => getComputedStyle(el).display === 'none')), true);
    assert.equal(await cards.nth(2).locator('.reward-dust-particle').first().evaluate(el => el.getAnimations().length), 0);
    assert.deepEqual(errors, []);
    console.log('Reward reveal OK: spectral pointed cross, card morph and contraction, rarity-colored finite dust, charge timing, selection, tooltip, mobile, reduced motion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
