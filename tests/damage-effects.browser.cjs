const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source = fs.readFileSync('Battle.html', 'utf8');
const extract = name => source.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];
const html = `<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">
${fs.readFileSync('UiStyles.html', 'utf8')}
<style>body{background:#202a38}.fixture{position:absolute;left:80px;top:320px;width:220px}.fixture-player{top:620px}</style>
</head><body><div id="floatingLayer"></div>
<div class="fixture monster-slot"><div class="monster-hp-bar"><div class="hp-current" style="width:50%"></div></div><span id="monsterText">50 / 100</span></div>
<div class="fixture fixture-player"><div class="player-hp-track"><div class="player-hp-fill" style="width:50%"></div></div><span id="playerHpText">50 / 100</span></div>
<script>var currentDamageEfficiency=1;
${['spawnFloatingDamage','spawnFloatingText','spawnHpDamageFragment','getHpGaugeRect','flashHpBar'].map(extract).join('\n')}
function showDamage(player,ratio,critical){
 const track=document.querySelector(player?'.player-hp-track':'.monster-hp-bar');
 track.damageHpRatio=ratio;track.damageNumberRatio=.65;
 spawnHpDamageFragment(track,100,ratio*100,100);
 spawnFloatingDamage(document.getElementById(player?'playerHpText':'monsterText'),ratio*100,player?'damage-red':'damage-white',critical);
}
</script></body></html>`;
(async () => {
 const browser = await chromium.launch({channel:'msedge',headless:true});
 const output = fs.mkdtempSync(path.join(os.tmpdir(),'damage-effects-'));
 try {
  for (const width of [1280,390]) {
   const page = await browser.newPage({viewport:{width,height:844}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setContent(html);
   for (const player of [false,true]) {
    await page.evaluate(p=>showDamage(p,.499,false),player);
    assert.equal(await page.locator('.damage-heavy').count(),0);
    assert.equal(await page.locator('.damage-critical-burst').count(),0);
    await page.waitForFunction(()=>!document.querySelector('.floating-damage'));
    await page.evaluate(p=>showDamage(p,.5,true),player);
    const damage=page.locator('.floating-damage');
    assert.equal(await damage.evaluate(e=>getComputedStyle(e).animationName),'heavy-damage-rise');
    assert.equal(await page.locator('.hp-damage-heavy').count(),1);
    assert.equal(await page.locator('.damage-critical-ray').count(),8);
    const layout=await page.locator('.damage-critical-burst').evaluate(e=>{
     const r=e.getBoundingClientRect(),p=e.parentNode.getBoundingClientRect();
     return {color:getComputedStyle(e).color,parentColor:getComputedStyle(e.parentNode).color,right:r.right,top:r.top,parentRight:p.right,parentTop:p.top};
    });
    assert.equal(layout.color,layout.parentColor);
    assert.ok(layout.right>layout.parentRight && layout.top<layout.parentTop);
    await page.waitForTimeout(200);
    await page.screenshot({path:path.join(output,`${width}-${player?'player':'monster'}.png`)});
    await page.waitForFunction(()=>!document.querySelector('.floating-damage,.hp-damage-fragment'));
   }
   await page.evaluate(()=>showDamage(true,.1,true));
   assert.equal(await page.locator('.floating-damage').evaluate(e=>getComputedStyle(e).animationName),'critical-damage-rise');
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await page.locator('.floating-damage').evaluate(e=>getComputedStyle(e).animationName),'playerImpactFade');
   assert.equal(await page.locator('.damage-critical-ray').first().evaluate(e=>getComputedStyle(e).display),'none');
   await page.waitForFunction(()=>!document.querySelector('.damage-critical-burst'));
   assert.deepEqual(errors,[]);
   await page.close();
   console.log(`Damage burst, 50% threshold, color, placement, reduced motion and cleanup OK: ${width}px`);
  }
  console.log('Screenshots: '+output);
 } finally { await browser.close(); }
})().catch(e=>{console.error(e);process.exitCode=1;});
