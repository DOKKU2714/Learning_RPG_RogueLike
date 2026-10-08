const fs=require('node:fs');
const path=require('node:path');
const os=require('node:os');
const assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const source=fs.readFileSync('Battle.html','utf8');
const extract=name=>source.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
const funcs=['animateMonsterAttack','resetMonsterSpriteState','playMonsterAttackImpact','playMonsterMultiHitSequence','animatePlayerHit','animatePlayerMiss','animatePlayerShieldBlock','spawnPlayerScreenImpact','restartScreenFlash'];
const styles=fs.readFileSync('UiStyles.html','utf8');
const script=`var MONSTER_ATTACK_WINDUP_MS=180,MONSTER_ATTACK_IMPACT_DELAY_MS=120,MONSTER_ATTACK_LUNGE_MS=680,MULTI_HIT_EFFECT_INTERVAL_MS=250,HIT_STATE_HOLD_MS=350;
var workbookDeadlineExpired=false,hp=100,shield=20,impacts=[],states=[];
var cssEscape=String,pushLog=()=>{},playBattleSound=()=>{},playBattleHitSound=()=>{},spawnFloatingDamage=()=>{},spawnFloatingText=()=>{},spawnShieldBlockIcon=()=>{};
var applyPlayerDamageDelta=(h,s)=>{hp-=h;shield-=s;impacts.push({at:performance.now(),hp:h,shield:s});};
var skippableAutoDelay=ms=>new Promise(r=>setTimeout(r,ms));
var setMonsterSpriteState=(target,state)=>{target.querySelector('img').src=target.dataset.attackSrc;states.push({state,at:performance.now()});};`;
const markup='<main id="battleShell" class="battle-shell battle-video-shell"><section class="battle-scene" style="background:url(https://assets.test/Resources/Background/Battle/5-1.png) center/cover"><div id="screenDamageFlash" class="screen-damage-flash"></div><div class="monster-layer"><article class="monster-slot" data-monster-id="m"><div class="compact-monster monster-image-sprite" data-idle-src="https://assets.test/Resources/Monsters/monster_Write/Idle.png" data-attack-src="https://assets.test/Resources/Monsters/monster_Write/Attack.png"><div class="monster-contrast-backdrop"></div><img class="monster-art" src="https://assets.test/Resources/Monsters/monster_Write/Idle.png"></div><div class="monster-display-name">떠도는 필기</div></article></div></section><span id="playerHpText">100 / 100</span></main>';
const html='<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+'</head><body class="battle-page-body">'+markup+'<script>'+script+funcs.map(extract).join('\n')+'</script></body></html>';
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'player-impact-'));
 try{
  for(const mobile of [false,true]){
   const page=await browser.newPage({viewport:mobile?{width:390,height:844}:{width:1280,height:800}});
   const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('**/*',route=>{
    const url=route.request().url();
    if(url==='https://game.test/')return route.fulfill({contentType:'text/html',body:html});
    if(url.startsWith('https://assets.test/'))return route.fulfill({contentType:'image/png',body:fs.readFileSync(path.join('..','Learning_RPG_LogueLike_Assets',url.slice('https://assets.test/'.length)))});
    return route.abort();
   });
   await page.goto('https://game.test/');
   await page.evaluate(()=>{window.sequence=playMonsterAttackImpact({monsterId:'m',damage:10,hpDamage:10},true);});
   assert.match(await page.locator('.monster-art').getAttribute('src'),/Attack.png/);
   assert.equal(await page.locator('.player-screen-impact').count(),0);
   assert.equal(await page.evaluate(()=>hp),100);
   await page.waitForSelector('.player-screen-impact');
   const timing=await page.evaluate(()=>impacts[0].at-states[0].at);
   assert.ok(timing>=280&&timing<700,'impact follows attack image after a short windup: '+timing);
   assert.equal(await page.evaluate(()=>hp),90);
   const rect=await page.locator('.player-screen-impact').evaluate(e=>e.getBoundingClientRect().toJSON());
   assert.ok(rect.width>=(mobile?390:1280));
   await page.screenshot({path:path.join(output,mobile?'mobile.png':'desktop.png')});
   await page.evaluate(()=>window.sequence);
   assert.match(await page.locator('.monster-art').getAttribute('src'),/Idle.png/);
   await page.waitForFunction(()=>!document.querySelector('.player-screen-impact'));
   await page.evaluate(()=>playMonsterAttackImpact({monsterId:'m',missed:true},true));
   assert.equal(await page.evaluate(()=>hp),90);assert.equal(await page.locator('.player-screen-impact').count(),0);
   await page.evaluate(()=>{window.sequence=playMonsterMultiHitSequence([{monsterId:'m',damage:5,hpDamage:5,isCritical:true},{monsterId:'m',damage:4,hpDamage:4}]);});
   await page.waitForSelector('.critical-impact');
   await page.evaluate(()=>window.sequence);
   assert.equal(await page.evaluate(()=>hp),81);
   assert.equal(await page.evaluate(()=>impacts.length),3);
   await page.waitForFunction(()=>!document.querySelector('.player-screen-impact'));
   await page.evaluate(()=>animatePlayerHit(4,0,4));
   assert.equal(await page.locator('.blocked-impact').count(),1);assert.equal(await page.evaluate(()=>hp),81);
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await page.locator('.player-impact-slashes').evaluate(e=>getComputedStyle(e).animationName),'none');
   await page.waitForFunction(()=>!document.querySelector('.player-screen-impact'));
   assert.deepEqual(errors,[]);console.log('Impact timing, damage, multi-hit, miss, shield and cleanup OK: '+(mobile?'mobile':'desktop'));
   await page.close();
  }
  console.log('Screenshots: '+output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
