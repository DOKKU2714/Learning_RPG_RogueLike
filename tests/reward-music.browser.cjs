const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const manager=fs.readFileSync('UiLoadingModal.html','utf8');
const fixture=`<script>
window.ASSET_BASE_URL='https://assets.test';window.audioSamples=[];
window.currentView={battle:{stage:{floor:3},status:'active'}};
window.Audio=function(src){const a=document.createElement('audio');let source=src||'';
Object.defineProperty(a,'src',{get:()=>source,set:v=>source=v});Object.defineProperty(a,'paused',{get:()=>!a.testPlaying});
a.pause=()=>{a.testPlaying=false};a.load=()=>{};audioSamples.push(a);return a;};
HTMLMediaElement.prototype.play=function(){this.testPlaying=true;return Promise.resolve()};
localStorage.setItem('learningRpgSoundVolume','0.7');localStorage.setItem('learningRpgSoundEnabled','1');
window.renderRewardChoices=()=>{};window.startBattleEntrance=()=>{};window.revealStageEntranceMonsters=()=>{};
window.startFloorIntermissionEntrance=()=>{};window.renderBattle=()=>{};
</script><main id="battleShell"></main>`;
(async()=>{
const browser=await chromium.launch({channel:'msedge',headless:true});
try{
 const page=await browser.newPage(),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://game.test/',r=>r.fulfill({contentType:'text/html',body:'<!doctype html>'+fixture+manager}));
 await page.goto('https://game.test/');
 await page.waitForFunction(()=>renderRewardChoices.__learningRpgAudioPatched&&startBattleEntrance.__learningRpgAudioPatched&&revealStageEntranceMonsters.__learningRpgAudioPatched&&startFloorIntermissionEntrance.__learningRpgAudioPatched&&renderBattle.__learningRpgAudioPatched);
 await page.evaluate(()=>revealStageEntranceMonsters());
 await page.waitForFunction(()=>LEARNING_RPG_AUDIO.getCurrent()?.kind==='battle');
 await page.evaluate(()=>{window.previousBgm=audioSamples.find(a=>a.testPlaying&&a.src.includes('/BGM/Battle/')&&!a.src.includes('/Reward'));currentView.battle.status='victory';renderRewardChoices();});
 assert.equal(await page.evaluate(()=>previousBgm.testPlaying),false,'BGM pauses before reward audio starts');
 assert.equal(await page.evaluate(()=>LEARNING_RPG_AUDIO.getCurrent()),null);
 assert.equal(await page.evaluate(()=>audioSamples.some(a=>a.testPlaying&&a.src.includes('/Reward'))),true);
 await page.evaluate(()=>{previousBgm.dispatchEvent(new Event('error'));LEARNING_RPG_AUDIO.setVolume(.4);LEARNING_RPG_AUDIO.playBattle();});
 assert.equal(await page.evaluate(()=>LEARNING_RPG_AUDIO.getCurrent()),null,'volume changes and stale errors cannot restart BGM during rewards');
 await page.evaluate(()=>{currentView.battle.status='active';startBattleEntrance();revealStageEntranceMonsters();});
 await page.waitForFunction(()=>LEARNING_RPG_AUDIO.getCurrent()?.kind==='battle');
 assert.equal(await page.evaluate(()=>audioSamples.some(a=>a.testPlaying&&a.src.includes('/Reward'))),false);
 await page.evaluate(()=>{currentView.battle.stage.stage=6;renderBattle();startFloorIntermissionEntrance();LEARNING_RPG_AUDIO.setVolume(.8);revealStageEntranceMonsters();renderRewardChoices();});
 assert.equal(await page.evaluate(()=>LEARNING_RPG_AUDIO.getCurrent()),null);
 assert.equal(await page.evaluate(()=>audioSamples.some(a=>a.testPlaying&&a.src.includes('/BGM/'))),false,'rest stage must not play battle or reward music');
 await page.evaluate(()=>{currentView.battle.stage.stage=1;startBattleEntrance();revealStageEntranceMonsters();});
 await page.waitForFunction(()=>LEARNING_RPG_AUDIO.getCurrent()?.kind==='battle');
 assert.deepEqual(errors,[]);console.log('BGM stops for rewards and stage 6, stays stopped on volume changes, and resumes in the next battle.');
}finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
