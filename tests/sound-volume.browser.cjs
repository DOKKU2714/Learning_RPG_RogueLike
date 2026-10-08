const fs=require('node:fs');
const assert=require('node:assert/strict');
const path=require('node:path');
const os=require('node:os');
const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const styles=fs.readFileSync('UiStyles.html','utf8');
const manager=fs.readFileSync('UiLoadingModal.html','utf8');
const fixture=`<script>
window.ASSET_BASE_URL='https://assets.test';window.audioSamples=[];
window.Audio=function(src){
 const a=document.createElement('audio');let source=src||'';
 Object.defineProperty(a,'src',{get:()=>source,set:v=>source=v});
 Object.defineProperty(a,'paused',{get:()=>!a.testPlaying});
 a.pause=()=>{a.testPlaying=false;};a.load=()=>{};
 audioSamples.push(a);return a;
};
HTMLMediaElement.prototype.play=function(){this.testPlaying=true;return Promise.resolve();};
</script>`;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'sound-volume-'));
 try{
  for(const mobile of [false,true]){
   const context=await browser.newContext({viewport:mobile?{width:390,height:844}:{width:1280,height:800},hasTouch:mobile,isMobile:mobile});
   const page=await context.newPage();const errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://game.test/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+fixture+'<button id="menuSoundToggleButton" class="sound-toggle-button menu-sound-toggle" onclick="toggleSoundVolume(event)">♫</button>'+manager}));
   await page.goto('https://game.test/');
   await page.locator('#menuSoundToggleButton').click();
   const slider=page.locator('#soundVolumePanel input');
   assert.equal(await slider.inputValue(),'0');
   assert.equal(await page.locator('#menuSoundToggleButton').getAttribute('aria-expanded'),'true');
   assert.equal(await slider.evaluate(e=>getComputedStyle(e).writingMode),'vertical-lr');
   const rect=await slider.boundingBox();
   assert.ok(rect.height>rect.width*3);
   await slider.fill('50');
   await page.waitForFunction(()=>audioSamples.some(a=>a.testPlaying&&a.src.includes('/BGM/')&&Math.abs(a.volume-.1575)<.001));
   assert.equal(await page.locator('#soundVolumePanel output').innerText(),'50%');
   const music=await page.evaluate(()=>audioSamples.find(a=>a.testPlaying&&a.src.includes('/BGM/')).volume);
   assert.ok(Math.abs(music-.42*.75*.5)<.001);
   await page.evaluate(()=>{window.sfx=new Audio('https://assets.test/Resources/Sounds/Attack/Swing.mp3');sfx.volume=.75;sfx.play();});
   assert.ok(Math.abs(await page.evaluate(()=>sfx.volume)-.75*.7*.5)<.001);
   await slider.fill('20');
   assert.ok(Math.abs(await page.evaluate(()=>sfx.volume)-.75*.7*.2)<.001,'playing SFX changes immediately');
   await slider.press('ArrowUp');assert.equal(await slider.inputValue(),'21');
   await slider.press('ArrowDown');assert.equal(await slider.inputValue(),'20');
   await slider.fill('0');assert.equal(await page.evaluate(()=>sfx.muted),true);
   await slider.fill('65');
   assert.equal(await page.evaluate(()=>localStorage.getItem('learningRpgSoundVolume')),'0.65');
   assert.equal(await page.evaluate(()=>localStorage.getItem('learningRpgSoundEnabled')),'1');
   await page.screenshot({path:path.join(output,mobile?'mobile.png':'desktop.png')});
   await slider.press('Escape');assert.equal(await page.locator('#soundVolumePanel').isVisible(),false);
   await page.reload();await page.locator('#menuSoundToggleButton').click();
   assert.equal(await slider.inputValue(),'65');
   await page.mouse.click(200,300);assert.equal(await page.locator('#soundVolumePanel').isVisible(),false);
   assert.deepEqual(errors,[]);
   console.log((mobile?'Mobile':'Desktop')+': vertical slider, live BGM/SFX gain, mute, keyboard, reload and close OK');
   await context.close();
  }
  console.log('Screenshots: '+output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
