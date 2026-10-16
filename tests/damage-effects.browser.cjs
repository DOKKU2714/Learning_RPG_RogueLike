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
${['spawnFloatingDamage','spawnFloatingText','spawnHpDamageFragment','populateShieldDamageShards','getHpGaugeRect','flashHpBar'].map(extract).join('\n')}
function showDamage(player,ratio,critical){
 const track=document.querySelector(player?'.player-hp-track':'.monster-hp-bar');
 const fill=track.querySelector('.hp-current,.player-hp-fill');
 fill.style.transition='none';fill.style.width='100%';void fill.offsetWidth;fill.style.transition='';
 track.damageHpRatio=ratio;track.damageNumberRatio=.65;
 spawnHpDamageFragment(track,100,ratio*100,100);
 fill.style.width=(100-ratio*100)+'%';
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
   for(const player of [false,true]) {
    const feedback=await page.evaluate(p=>{
     showDamage(p,.25,false);
     const track=document.querySelector(p?'.player-hp-track':'.monster-hp-bar'),fill=track.querySelector('.hp-current,.player-hp-fill'),fragment=document.querySelector('.hp-damage-fragment');
     const shake=track.getAnimations().find(a=>a.animationName==='hp-hit-shake');shake.pause();shake.currentTime=60;
     const shrink=fill.getAnimations().find(a=>a.transitionProperty==='width');shrink.pause();shrink.currentTime=160;
     const flight=fragment.getAnimations()[0];flight.pause();flight.currentTime=160;
     const innerWidth=track.clientWidth;
     const result={duration:getComputedStyle(fill).transitionDuration,flightDuration:flight.effect.getTiming().duration,translate:getComputedStyle(track).translate,
       hpWidth:fill.getBoundingClientRect().width,missingWidth:innerWidth-fill.getBoundingClientRect().width,whiteWidth:fragment.getBoundingClientRect().width,innerWidth};
     track.getAnimations().forEach(a=>a.finish());fill.getAnimations().forEach(a=>a.finish());fragment.remove();return result;
    },player);
    assert.equal(feedback.duration,'0.32s');assert.equal(feedback.flightDuration,720);assert.notEqual(feedback.translate,'0px');assert.notEqual(feedback.translate,'0px 0px');
    assert.ok(feedback.hpWidth>feedback.innerWidth*.75 && feedback.hpWidth<feedback.innerWidth);
    assert.ok(Math.abs(feedback.missingWidth-feedback.whiteWidth)<2,'white bar matches the HP already lost');
    await page.locator('.floating-damage').evaluateAll(elements=>elements.forEach(e=>e.remove()));
   }
   for (const [efficiency,tone,suffix] of [[.75,'damage-low-efficiency',''],[.7501,'damage-white',''],[.76,'damage-white',''],[.99,'damage-white',''],[1,'damage-efficient','!'],[1.2,'damage-efficient','!']]) {
    await page.evaluate(e=>{currentDamageEfficiency=e;showDamage(false,.1,false);},efficiency);
    assert.equal(await page.locator('.floating-damage').evaluate(e=>e.classList.contains('damage-low-efficiency')?'damage-low-efficiency':e.classList.contains('damage-efficient')?'damage-efficient':'damage-white'),tone);
    assert.equal(await page.locator('.floating-damage').textContent(),'-10'+suffix);
    await page.locator('.floating-damage,.hp-damage-fragment').evaluateAll(elements=>elements.forEach(e=>e.remove()));
   }
   await page.evaluate(()=>showDamage(false,.1,true));
   assert.equal(await page.locator('.damage-critical').count(),1);
   await page.locator('.floating-damage,.hp-damage-fragment').evaluateAll(elements=>elements.forEach(e=>e.remove()));
   const shapes=[];
   for (let hit=0;hit<2;hit++) {
    await page.evaluate(()=>spawnHpDamageFragment(document.querySelector('.monster-hp-bar'),100,40,100,true));
    const pieces=page.locator('.shield-glass-piece');
    assert.ok(await pieces.count()>=6 && await pieces.count()<=12);
    shapes.push(await pieces.evaluateAll(elements=>elements.map(e=>e.style.clipPath).join('|')));
    assert.equal(await pieces.first().evaluate(e=>getComputedStyle(e).animationName),'shield-glass-shatter');
    await page.waitForTimeout(350);
    await page.screenshot({path:path.join(output,`${width}-shield-${hit}.png`)});
    await page.waitForFunction(()=>!document.querySelector('.shield-damage-fragment'));
   }
   assert.notEqual(shapes[0],shapes[1]);
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
   await page.evaluate(()=>spawnHpDamageFragment(document.querySelector('.monster-hp-bar'),100,40,100,true));
   assert.equal(await page.locator('.shield-glass-piece').first().evaluate(e=>getComputedStyle(e).animationName),'playerImpactFade');
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
