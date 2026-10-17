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
${['getDamageVisualType','playDamageTypeEffect','playLegacyDamageTypeEffect','playTurnEffectEvent','animateMonsterHit','animatePlayerHit'].map(extract).join('\n')}
var currentView={battle:{}};var ATTACK_EFFECT_DELAY_MS=0,DEATH_STATE_HOLD_MS=0;
function cssEscape(v){return CSS.escape(v)}
function pushLog(){} function finishActionDescription(){return Promise.resolve()}
function skippableAutoDelay(){return Promise.resolve()}
function applyMonsterDamageDelta(){} function applyPlayerDamageDelta(){} function spawnFloatingDamage(){}
function isMonsterDefeatedInDom(){return false}
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
   assert.equal(await page.locator('.monster-art.element-tint-poison').count(),1);
   assert.equal(await page.locator('.incoming-slash,.incoming-fire,.monster-hit-red').count(),0);
   await page.evaluate(()=>document.getAnimations().forEach(a=>{a.pause();a.currentTime=a.effect.target.closest('.element-vfx-chill')?650:390;}));
   await page.screenshot({path:path.join(output,'elements-'+width+'.png'),fullPage:true});
   await page.waitForFunction(()=>!document.querySelector('.element-vfx,.element-tint-poison,.element-tint-freeze'));
   await page.evaluate(async()=>{
    for(const type of ['burn','explosion','chill','freeze','poison','shock'])await playTurnEffectEvent({actor:'effect',target:'monster',targetMonsterId:type,effectId:type==='explosion'?'':'effect_v2_'+type,damageKind:type==='explosion'?'explosion':'dot',damage:3,hpDamage:3,attackEffect:'slash'});
    await playTurnEffectEvent({actor:'effect',target:'player',effectId:'effect_v2_poison',damage:2,hpDamage:2});
   });
   await page.waitForFunction(()=>!document.querySelector('.element-vfx'));
   await page.evaluate(()=>{for(let i=0;i<12;i++)playDamageTypeEffect('effect_v2_shock','monster','shock')});
   assert.equal(await page.locator('.element-vfx-shock').count(),3);
   await page.waitForFunction(()=>!document.querySelector('.element-vfx'));
   await page.evaluate(()=>{
    playDamageTypeEffect('effect_v2_poison','monster','poison');
    playDamageTypeEffect('effect_v2_freeze','monster','poison');
   });
   await page.waitForFunction(()=>!document.querySelector('.element-vfx,.element-tint-poison,.element-tint-freeze'));
   await page.emulateMedia({reducedMotion:'reduce'});
   await page.evaluate(()=>playDamageTypeEffect('effect_v2_shock','monster','shock'));
   assert.equal(await page.locator('.element-vfx-shock .element-particle').first().evaluate(e=>getComputedStyle(e).animationName),'element-reduced');
   assert.deepEqual(errors,[]);await page.close();
   console.log('Element visuals, routing, cleanup, reduced motion OK: '+width);
  }
  console.log('Screenshots: '+output);
 }finally{await browser.close()}
})().catch(e=>{console.error(e);process.exitCode=1});
