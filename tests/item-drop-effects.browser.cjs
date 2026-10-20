const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>html.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
const art=fs.readFileSync('../Learning_RPG_LogueLike_Assets/Resources/Item.png');
const script=`var ASSET_BASE_URL='https://assets.test',pickupAnimations=[],flights=[],battleQuickAccessState=null;
${['animateMonsterItemPickup','normalizeRewardRarity','renderBattleQuickAccessIcons'].map(extract).join('\n')}
var nativeAnimate=Element.prototype.animate;
Element.prototype.animate=function(frames,options){var animation=nativeAnimate.call(this,frames,options);if(this.matches('.monster-item-pickup')){animation.pause();animation.currentTime=options.duration*.45;pickupAnimations.push(animation);}return animation;};
function drop(rarity,x,y){flights.push(animateMonsterItemPickup({reward:{rarity:rarity}}, {left:x,top:y,width:0,height:0}));}
async function finishDrops(){
 var reduced=matchMedia('(prefers-reduced-motion: reduce)').matches;
 pickupAnimations.forEach(a=>a.finish());await Promise.resolve();await Promise.resolve();
 var bag=document.getElementById('battleInventoryIcon');
 if(!reduced){
  if(!bag.getAttribute('src').endsWith('Backpack_Open.png'))throw Error('bag opens during flight');
  if(pickupAnimations.at(-1).effect.getTiming().duration!==900)throw Error('slow flight duration');
  renderBattleQuickAccessIcons();
  if(!bag.getAttribute('src').endsWith('Backpack_Open.png'))throw Error('render preserves open bag');
  if(!bag.getAnimations().some(a=>a.effect.getKeyframes().some(k=>k.transform.includes('rotate(-7deg)'))))throw Error('bag grows and shakes');
 }
 document.getAnimations().forEach(a=>{if(a.effect.getTiming().iterations!==Infinity)a.finish();});
 await Promise.all(flights);
 if(!bag.getAttribute('src').endsWith('Backpack_Close.png'))throw Error('bag closes after all arrivals');
 if(Number(bag.dataset.pickupCount||0)!==0)throw Error('pickup count cleared');
 pickupAnimations=[];flights=[];
}
`;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const output=path.resolve('.tmp_spreadsheet/item-drop-effects-2026-10-19');fs.mkdirSync(output,{recursive:true});
 try{
  for(const width of [1366,390]){
   const page=await browser.newPage({viewport:{width,height:1000}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://assets.test/Resources/Item.png',r=>r.fulfill({contentType:'image/png',body:art}));
   await page.setContent('<html><head>'+styles+'</head><body style="margin:0;background:#17251f;color:white"><p>아이템 드롭 · 등급별 빛</p><div id="battleInventoryIcon" style="position:fixed;right:20px;bottom:20px;width:36px;height:36px">가방</div><script>'+script+'</script></body></html>');
   if(width>500){
    await page.evaluate(()=>['common','uncommon','rare','epic','legendary','unique'].forEach((rarity,i)=>drop(rarity,190+(i%3)*450,340+Math.floor(i/3)*490)));
    const result=await page.locator('.monster-item-pickup').evaluateAll(nodes=>nodes.map(n=>({size:parseFloat(getComputedStyle(n).width),aura:parseFloat(getComputedStyle(n.querySelector('.item-drop-aura')).width),pillar:getComputedStyle(n.querySelector('.item-drop-pillar')).display,height:parseFloat(getComputedStyle(n.querySelector('.item-drop-pillar')).height)})));
    assert.ok(result.every(r=>r.size===42*4));assert.deepEqual(result.map(r=>r.pillar),['none','none','none','none','block','block']);
    assert.ok(result.every((r,i)=>i===0 || r.aura>result[i-1].aura));assert.ok(result[4].height>=400 && result[5].height>result[4].height);
    assert.deepEqual(await page.evaluate(()=>pickupAnimations.map(a=>a.effect.getTiming().duration)),[1400,1400,1400,1400,2200,2200]);
    await page.locator('.monster-item-pickup img').first().evaluate(i=>i.decode());
    await page.screenshot({path:path.join(output,'all-rarities.png')});
    await page.evaluate(()=>finishDrops());assert.equal(await page.locator('.monster-item-pickup').count(),0);
   }else{
    for(const x of [0,390]){
     await page.evaluate(x=>drop('전설',x,350),x);
     const box=await page.locator('.monster-item-pickup').boundingBox();assert.ok(box.x>=0 && box.x+box.width<=390,'4x icon stays visible at either screen edge');
     assert.equal(await page.locator('.item-drop-pillar').evaluate(n=>getComputedStyle(n).display),'block','reward rarity fallback activates the legendary pillar');
     await page.locator('.monster-item-pickup img').evaluate(i=>i.decode());
     await page.screenshot({path:path.join(output,'legendary-mobile-'+x+'.png')});
     await page.evaluate(()=>finishDrops());
    }
   }
   await page.emulateMedia({reducedMotion:'reduce'});await page.evaluate(()=>drop('unique',innerWidth/2,350));
   assert.equal(await page.evaluate(()=>pickupAnimations[0].effect.getTiming().duration),80);
   assert.equal(await page.locator('.item-drop-pillar').evaluate(n=>getComputedStyle(n).animationName),'none');
   await page.evaluate(()=>finishDrops());assert.equal(await page.locator('.monster-item-pickup').count(),0);
   assert.deepEqual(errors,[]);await page.close();console.log('4x item icons, rarity glow, legendary pillars and cleanup OK: '+width);
  }
  console.log('Screenshots: '+output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});

