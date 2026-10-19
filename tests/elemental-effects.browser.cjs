const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source=fs.readFileSync('Battle.html','utf8');
const extract=name=>source.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
const types=['burn','explosion','chill','freeze','poison','shock'];
const labels=['발화','폭발','냉기','빙결','중독','감전'];
const art='data:image/png;base64,'+fs.readFileSync('resources/monster_001.png').toString('base64');
const styles=fs.readFileSync('UiStyles.html','utf8');
const html=`<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">${styles}
<style>body{background:#101827;color:#e7f2ff;padding:28px;margin:0;font-family:Arial}h1{font-size:22px;margin:0 0 8px}p{color:#9aacc5;font-size:13px;margin:0 0 24px}.gallery{display:grid;grid-template-columns:repeat(3,1fr);gap:18px}.tile{border:1px solid #34445e;background:radial-gradient(ellipse at 50% 60%,#334057,#172234 70%);border-radius:16px;padding:16px;overflow:hidden}.tile h2{font-size:17px;margin:0}.compact-monster{width:180px!important;height:190px!important;max-width:none!important;aspect-ratio:auto;margin:22px auto!important}.monster-art{object-fit:contain;width:100%;height:100%}.monster-slot{position:relative;height:240px!important;width:100%!important;min-width:0!important;align-items:center!important}.tile{height:300px}.player-compact-panel{position:relative;width:100px;height:50px}@media(max-width:500px){body{padding:12px}.gallery{grid-template-columns:1fr}.tile{padding:12px}.compact-monster{width:190px!important}}</style>
</head><body><h1>상태 효과 · Elemental VFX</h1><p>발화 / 폭발 / 냉기 / 빙결 / 중독 / 감전</p><div class="gallery">
${types.map((type,i)=>`<section class="tile"><h2>${labels[i]}</h2><div class="monster-slot" data-monster-id="${type}"><div class="compact-monster monster-image-sprite"><img class="monster-art" src="${art}"></div><div class="monster-hp-text"></div></div></section>`).join('')}
</div><div class="player-compact-panel"><div id="playerHpText"></div></div><script>
${['getDamageVisualType','getPixelFlameSvg','resetBurnParticle','playDamageTypeEffect','playLegacyDamageTypeEffect','playTurnEffectEvent','animateMonsterHit','animatePlayerHit','setMonsterSpriteState','resetMonsterSpriteState','syncMonsterBurnVisual','syncMonsterShockVisual','presentPlayerBurn'].map(extract).join('\n')}
var currentView={battle:{}};var ATTACK_EFFECT_DELAY_MS=0,DEATH_STATE_HOLD_MS=0;
function cssEscape(v){return CSS.escape(v)}
function pushLog(){} function finishActionDescription(){return Promise.resolve()}
function skippableAutoDelay(){return Promise.resolve()}
function applyMonsterDamageDelta(){} function applyPlayerDamageDelta(){} function spawnFloatingDamage(){}
function isMonsterDefeatedInDom(){return false}
function playBattleHitSound(){}
function animatePlayerAttack(){throw Error('Generic weapon effect must not play for elemental damage')}
function playEfficientAttackSound(){throw Error('Generic hit effect must not play for elemental damage')}
</script></body></html>`;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const output=process.env.ELEMENT_VFX_OUTPUT || fs.mkdtempSync(path.join(os.tmpdir(),'element-vfx-'));
 fs.mkdirSync(output,{recursive:true});
 try{
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:width===390?1800:850}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setContent(html);await page.locator('img').first().evaluate(i=>i.decode());
   await page.evaluate(()=>{
    for(const type of ['burn','explosion','chill','freeze','poison','shock']){
     const id=type==='explosion'?type:'effect_v2_'+type;
     if(!playDamageTypeEffect(id,'monster',type))throw Error('Missing visual '+type);
    }
   });
   assert.equal(await page.locator('.element-vfx').count(),6);
   assert.equal(await page.locator('.element-ice').count(),1);
   assert.equal(await page.locator('.bolt-core').count(),10);
   assert.equal(await page.locator('.element-vfx-burn .element-particle svg').count(),7,'fire uses fewer, larger flame silhouettes');
   const burstFlames=await page.locator('.element-vfx-burn .element-particle').evaluateAll(nodes=>nodes.map(n=>({width:parseFloat(getComputedStyle(n).width),duration:parseFloat(getComputedStyle(n).animationDuration)})));
   assert.ok(burstFlames.every(p=>p.width>=24 && p.duration<=1.6));
   assert.ok(await page.locator('.element-vfx-burn svg').evaluateAll(nodes=>nodes.every(svg=>svg.getAttribute('shape-rendering')==='crispEdges' && [...svg.querySelectorAll('path')].every(p=>!/[CQSA]/i.test(p.getAttribute('d'))))),'flames use stepped pixel outlines without curves');
   assert.equal(await page.locator('.element-vfx-burn .element-particle').first().evaluate(e=>getComputedStyle(e).backgroundImage),'none','fire has no orange circle background');
   assert.equal(await page.locator('.monster-art.element-tint-poison').count(),1);
   assert.equal(await page.locator('.incoming-slash,.incoming-fire,.monster-hit-red').count(),0);
   await page.evaluate(()=>document.getAnimations().forEach(a=>{a.pause();a.currentTime=a.effect.target.closest('.element-vfx-chill')?650:390;}));
   await page.screenshot({path:path.join(output,'elements-'+width+'.png'),fullPage:true});
   await page.waitForFunction(()=>!document.querySelector('.element-vfx,.element-tint-poison,.element-tint-freeze'));
   await page.evaluate(async()=>{
    for(const type of ['burn','explosion','chill','freeze','poison','shock'])await playTurnEffectEvent({actor:'effect',target:'monster',targetMonsterId:type,effectId:type==='explosion'?'':'effect_v2_'+type,damageKind:type==='explosion'?'explosion':'dot',damage:3,hpDamage:3,attackEffect:'slash'});
    await playTurnEffectEvent({actor:'effect',target:'player',effectId:'effect_v2_poison',damage:2,hpDamage:2});
   });
   assert.equal(await page.locator('.monster-dot-hit').count(),6,'elemental damage keeps its hit motion');
   assert.equal(await page.locator('[data-monster-id="shock"] .monster-art').evaluate(el=>getComputedStyle(el).animationName),'monster-shock-impact');
   assert.equal(await page.locator('[data-monster-id="shock"] .monster-hit-red').count(),0);
   await page.waitForFunction(()=>!document.querySelector('.element-vfx'));
   await page.evaluate(()=>{syncMonsterShockVisual('shock',{hp:10,effects:[{effectId:'effect_v2_shock',stacks:2}]});syncMonsterShockVisual('shock',{hp:10,effects:[{effectId:'effect_v2_shock',stacks:2}]});});
   assert.equal(await page.locator('.shock-persistent').count(),1,'idle shock is bounded to one overlay');
   assert.equal(await page.locator('.shock-idle-bolt').count(),3,'idle shock uses fewer and thinner bolts');
   assert.equal(await page.locator('.shock-persistent').evaluate(el=>getComputedStyle(el).opacity),'0.5');
   await page.waitForTimeout(2700);
   assert.equal(await page.locator('.shock-persistent').count(),1,'idle shock survives burst cleanup');
   await page.evaluate(()=>syncMonsterShockVisual('shock',{hp:10,effects:[]}));
   assert.equal(await page.locator('.shock-persistent').count(),0,'consuming all stacks removes idle shock');
   await page.evaluate(()=>{for(let i=0;i<12;i++)playDamageTypeEffect('effect_v2_shock','monster','shock')});
   assert.equal(await page.locator('.element-vfx-shock').count(),3);
   await page.waitForFunction(()=>!document.querySelector('.element-vfx'));
   await page.evaluate(()=>{
    playDamageTypeEffect('effect_v2_poison','monster','poison');
    playDamageTypeEffect('effect_v2_freeze','monster','poison');
   });
   await page.waitForFunction(()=>!document.querySelector('.element-vfx,.element-tint-poison,.element-tint-freeze'));
   await page.evaluate(()=>syncMonsterBurnVisual('burn',{hp:10,effects:[{effectId:'effect_v2_burn',stacks:3}]}));
   assert.equal(await page.locator('.burn-persistent').count(),1);
   assert.equal(await page.locator('.element-tint-burn').count(),0,'idle burning does not tint the monster');
   const idleFlames=await page.locator('.burn-persistent .element-particle').evaluateAll(nodes=>nodes.map(n=>({position:n.style.cssText,width:parseFloat(getComputedStyle(n).width),duration:parseFloat(getComputedStyle(n).animationDuration)})));
   assert.ok(idleFlames.every(p=>p.width<=22 && p.duration>=2.2),'idle flames are smaller and slower than the burst');
   await page.locator('[data-monster-id="burn"]').screenshot({path:path.join(output,'burn-idle-'+width+'.png')});
   await page.waitForTimeout(3300);
   assert.equal(await page.locator('.burn-persistent').count(),1,'flames persist beyond the original burst timeout');
   const respawned=await page.locator('.burn-persistent .element-particle').evaluateAll(nodes=>nodes.map(n=>n.style.cssText));
   assert.ok(respawned.every((position,i)=>position!==idleFlames[i].position),'each flame respawns in a new position and follows a new path');
   assert.equal(await page.locator('.burn-persistent .element-particle').count(),7,'respawning reuses a bounded pool');
   await page.evaluate(()=>animateMonsterHit('burn',2,2,0,false,1,undefined,true));
   assert.equal(await page.locator('.burn-damage-pulse').count(),1);
   await page.waitForTimeout(200);
   assert.equal(await page.locator('.burn-persistent svg').first().evaluate(n=>getComputedStyle(n).animationName),'burn-flame-flare');
   assert.ok(await page.locator('.burn-persistent svg').first().evaluate(n=>new DOMMatrix(getComputedStyle(n).transform).a>1.5),'damage briefly enlarges the individual flames');
   await page.locator('[data-monster-id="burn"]').screenshot({path:path.join(output,'burn-hit-'+width+'.png')});
   await page.waitForTimeout(750);
   assert.equal(await page.locator('.burn-damage-pulse').count(),0);
   await page.evaluate(()=>presentPlayerBurn(5));
   assert.equal(await page.locator('.player-burn-alert strong').textContent(),'발화 5');
   await page.screenshot({path:path.join(output,'burn-alert-'+width+'.png'),fullPage:true});
   await page.waitForTimeout(1600);
   assert.equal(await page.locator('.player-burn-alert').count(),0);
   await page.evaluate(()=>syncMonsterBurnVisual('burn',{hp:10,effects:[]}));
   assert.equal(await page.locator('.burn-persistent').count(),0,'removing burn removes the flames');
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.evaluate(()=>syncMonsterBurnVisual('burn',{hp:10,effects:[{effectId:'effect_v2_burn',stacks:3}]}));
   assert.equal(await page.locator('.burn-persistent .element-particle').first().evaluate(n=>getComputedStyle(n).animationName),'none','reduced motion keeps persistent fire still');
   await page.evaluate(()=>syncMonsterBurnVisual('burn',{currentHp:0,effects:[{effectId:'effect_v2_burn',stacks:3}]}));
   assert.equal(await page.locator('.burn-persistent').count(),0,'death removes persistent fire');
   await page.evaluate(()=>playDamageTypeEffect('effect_v2_shock','monster','shock'));
   assert.equal(await page.locator('.element-vfx-shock .element-particle').first().evaluate(e=>getComputedStyle(e).animationName),'element-reduced');
   assert.deepEqual(errors,[]);await page.close();
   console.log('Element visuals, routing, cleanup, reduced motion OK: '+width);
  }
  console.log('Screenshots: '+output);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
