const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const source=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>source.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
const art='data:image/png;base64,'+fs.readFileSync('resources/monster_001.png').toString('base64');
const types=['poison','bleed','shock','chill','freeze','stun'];
const helpers=['getDamageVisualType','getPixelFlameSvg','getPixelConceptSvg','resetBurnParticle','playDamageTypeEffect',
 'syncMonsterDebuffVisuals','syncMonsterShockVisual','getMonsterChillStacks','syncMonsterChillVisual','hasMonsterFreeze','syncMonsterFreezeVisual','releaseMonsterFreeze',
 'setMonsterSpriteState','resetMonsterSpriteState','animateMonsterHit','animateMonsterDeath',
 'buildStatusView','renderStatusSymbol','renderStatusStack','renderStatusIcons','renderPlayerStatuses'];
const html='<html><head>'+styles+`<style>
 body{background:#111b22;color:#eee;padding:20px;margin:0}.gallery{display:grid;grid-template-columns:repeat(3,minmax(0,1fr));gap:18px}.tile{background:#233439;border:2px solid #567073;padding:12px;min-width:0}
 .tile .monster-slot{position:relative;width:100%;height:280px;min-width:0}.tile .compact-monster{width:160px;height:180px;aspect-ratio:auto;margin:30px auto;max-width:100%}.monster-art{width:100%;height:100%;object-fit:contain}
 .tile .monster-status-row{position:static;display:flex;flex-wrap:wrap;width:auto;transform:none}.player-status-row{position:static;display:flex;gap:10px;margin:18px 0;flex-wrap:wrap}
 @media(max-width:600px){body{padding:12px}.gallery{grid-template-columns:1fr 1fr}.tile .compact-monster{width:130px;height:160px}.tile .monster-slot{height:230px}}
 </style></head><body><div id="playerStatusRow" class="status-row player-status-row"></div><div class="gallery">`+
 types.map(type=>'<section class="tile"><h3>'+type+'</h3><div class="monster-slot" data-monster-id="'+type+'"><div class="compact-monster" data-idle-src="'+art+'#idle" data-hit-src="'+art+'#hit" data-death-src="'+art+'#death"><img class="monster-art" src="'+art+'#idle"></div><span class="monster-hp-text"></span></div><div id="icons-'+type+'"></div></section>').join('')+
 '</div><script>'+helpers.map(extract).join('\n')+`
 var ATTACK_EFFECT_DELAY_MS=0,DEATH_STATE_HOLD_MS=30;
 function cssEscape(v){return CSS.escape(v)} function escapeHtml(v){return String(v).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;')}
 function getStatusIcon(){return ''} function buildStatusTooltip(s){return {main:s.name || s.effectId,stat:''}}
 function getDisplayStatusGroups(t){return {buffs:t.effects.filter(e=>e.category==='buff'),debuffs:t.effects.filter(e=>e.category!=='buff')}}
 function applyMonsterDamageDelta(){} function spawnFloatingDamage(){} function playBattleHitSound(){} function skippableAutoDelay(){return Promise.resolve()}
 function isMonsterDefeatedInDom(){return false} function startMonsterDeathRewards(){} function playBattleSound(){}
 var types=${JSON.stringify(types)},statuses=${JSON.stringify(types.map(type=>({effectId:'effect_v2_'+type,stacks:3,stackable:true,category:'debuff'})).concat([{effectId:'buff_power',category:'buff'},{effectId:'debuff_weak',category:'debuff'}]))};
 renderPlayerStatuses({effects:statuses});
 types.forEach(function(type){document.getElementById('icons-'+type).innerHTML=renderStatusIcons({effects:[{effectId:'effect_v2_'+type,stacks:3,stackable:true}]});});
 </script></body></html>`;

(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true,args:['--disable-gpu'],timeout:15000});
 const output=path.resolve('.codex-temp/pixel-status');fs.mkdirSync(output,{recursive:true});
 try{
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   page.setDefaultTimeout(15000);
   await page.route(/^https?:/,route=>route.abort());
   await page.setContent(html);
   assert.deepEqual(errors,[]);
   await page.evaluate(()=>{
    for(const type of ['poison','bleed','stun'])syncMonsterDebuffVisuals(type,{hp:10,effects:[{effectId:'effect_v2_'+type,stacks:2}]});
    syncMonsterShockVisual('shock',{hp:10,effects:[{effectId:'effect_v2_shock',stacks:3}]});
    syncMonsterChillVisual('chill',{hp:10,effects:[{effectId:'effect_v2_chill',stacks:3}]});
    syncMonsterFreezeVisual('freeze',{hp:10,effects:[{effectId:'effect_v2_freeze'}]});
   });
   assert.equal(await page.locator('.status-persistent').count(),3);
   assert.equal(await page.locator('.element-vfx-stun .element-particle').count(),3);
   const stun=page.locator('[data-monster-id="stun"] .compact-monster');
   assert.ok((await stun.locator('img').getAttribute('src')).endsWith('#hit'));
   await stun.evaluate(el=>{resetMonsterSpriteState(el);setMonsterSpriteState(el,'attack');});
   assert.ok((await stun.locator('img').getAttribute('src')).endsWith('#hit'));
   const orbit=await stun.locator('.element-particle').first().evaluate(el=>{
    const animation=el.getAnimations()[0];animation.pause();animation.currentTime=0;
    const first=getComputedStyle(el).transform;animation.currentTime=800;
    const second=getComputedStyle(el).transform;animation.play();return {first,second};
   });
   assert.notEqual(orbit.first,orbit.second,'stars move around the head during their orbit');
   const icons=page.locator('#playerStatusRow .status-icon');
   assert.equal(await icons.count(),8);
   const colors=await page.locator('#playerStatusRow [class*="status-concept-"]').evaluateAll(nodes=>nodes.map(el=>getComputedStyle(el).color));
   assert.equal(new Set(colors).size,5,'cold concepts share cyan; other concepts have distinct colors');
   assert.equal(await page.locator('#playerStatusRow .buff').evaluate(el=>getComputedStyle(el).color),'rgb(126, 226, 154)');
   assert.equal(await page.locator('#playerStatusRow .debuff:not([class*="status-concept-"])').evaluate(el=>getComputedStyle(el).color),'rgb(255, 139, 139)');
   assert.ok((await icons.first().boundingBox()).width>=38);
   assert.ok((await page.locator('.monster-status-row .status-icon').first().boundingBox()).width>=32);
   assert.ok(await page.locator('.pixel-concept-art path').evaluateAll(nodes=>nodes.every(n=>!/[CQSA]/i.test(n.getAttribute('d')))));
   await page.screenshot({path:path.join(output,'idle-'+width+'.png'),fullPage:true});
   await page.evaluate(()=>animateMonsterHit('poison',2,2,0,false,1,undefined,'poison'));
   assert.equal(await page.locator('.status-damage-pulse').count(),1);
   assert.equal(await page.locator('[data-monster-id="poison"] .monster-art').evaluate(el=>getComputedStyle(el).animationName),'monster-concept-impact');
   await page.waitForTimeout(200);await page.screenshot({path:path.join(output,'hit-'+width+'.png'),fullPage:true});
   await page.waitForTimeout(600);assert.equal(await page.locator('.status-damage-pulse').count(),0);
   await page.waitForTimeout(2600);assert.equal(await page.locator('.status-persistent').count(),3,'persistent visuals outlive application cleanup');
   await page.evaluate(()=>{for(let i=0;i<9;i++)playDamageTypeEffect('poison','monster','poison');});
   assert.equal(await page.locator('.element-vfx-poison').count(),4,'bounded bursts preserve the persistent overlay');
   await page.evaluate(()=>syncMonsterDebuffVisuals('stun',{hp:10,effects:[]}));
   assert.equal(await stun.locator('.status-persistent').count(),0);
   assert.ok((await stun.locator('img').getAttribute('src')).endsWith('#idle'));
   await page.evaluate(()=>syncMonsterDebuffVisuals('stun',{hp:10,effects:[{effectId:'debuff_stun'}]}));
   await page.emulateMedia({reducedMotion:'reduce'});
   assert.equal(await stun.locator('.element-particle').first().evaluate(el=>getComputedStyle(el).animationName),'none');
   assert.equal(await stun.locator('img').evaluate(el=>getComputedStyle(el).animationName),'none');
   await page.evaluate(()=>animateMonsterDeath('stun'));
   assert.equal(await page.locator('.element-vfx-stun').count(),0,'death removes orbiting stars immediately');
   await page.evaluate(()=>syncMonsterDebuffVisuals('bleed',{currentHp:0,effects:[{effectId:'debuff_bleed',stacks:3}]}));
   assert.equal(await page.locator('.element-vfx-bleed.status-persistent').count(),0);
   assert.deepEqual(errors,[]);await page.close();
  }
  console.log('Pixel status visuals OK: icons, concept colors, orbit, Hit pose, damage pulse, cleanup, bounded bursts and reduced motion.');
 }catch(error){console.error(error);throw error;}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
