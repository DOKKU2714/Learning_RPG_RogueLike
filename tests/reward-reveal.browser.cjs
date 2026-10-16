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
    assert.deepEqual(timings.map(t => t.duration), [300,2000,8000]);
    const lightColors = await cards.evaluateAll(nodes => nodes.map(el => {
      const light = getComputedStyle(el.querySelector('.reward-charge-light'));
      const flash = getComputedStyle(el.querySelector('.reward-reveal-flash'));
      return light.backgroundImage + light.boxShadow + flash.backgroundImage + getComputedStyle(el,'::before').boxShadow;
    }));
    for (const color of lightColors) {
      for (const match of color.matchAll(/rgba?\((\d+),\s*(\d+),\s*(\d+)/g)) {
        assert.equal(match[1], match[2]); assert.equal(match[2], match[3]);
      }
    }
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
    await page.waitForTimeout(timings[2].duration - 1100 + 650);
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
    await page.emulateMedia({ reducedMotion: 'reduce' });
    await page.evaluate(() => renderRewardChoices(view));
    assert.equal(await cards.nth(2).evaluate(el => getComputedStyle(el).animationName), 'none');
    assert.equal(await cards.nth(2).evaluate(el => getComputedStyle(el).visibility), 'visible');
    console.log('Reward reveal OK: simultaneous lights, rarity charge duration/vibration/flash, blue-or-higher sheen, no idle shake, selection, tooltip, reduced motion.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
