const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict'),path=require('node:path');
const manager=fs.readFileSync('UiGameStartLoading.html','utf8');
const theme=fs.readFileSync('UiStyles.html','utf8');
const tips=[{tipId:'rarity_order',text:'"일반-드문-희귀-영웅-전설-고유" 순서로 좋은 등급입니다.'},{tipId:'next',text:'두 번째 팁 <img src=x onerror=alert(1)>'}];
const parent=`<!doctype html><html><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">${theme}</head><body style="margin:0;background:#25352b"><button id="start">게임 시작</button><div id="loadingModal">기존 로딩 화면</div><script>
window.google={script:{run:{withSuccessHandler(fn){this.success=fn;return this},withFailureHandler(){return this},getGameStartTips(){this.success(${JSON.stringify(tips)})}}}};
window.resetMainNavigation=()=>window.reset=true;
Math.random=()=>0;
</script>${manager}<script>document.getElementById('start').onclick=()=>{LearningRpgGameStart.begin();LearningRpgGameStart.navigate('https://entry.test/battle?entryToken=test');};</script></body></html>`;
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const output=path.resolve('.tmp_spreadsheet/game-start-loading');fs.mkdirSync(output,{recursive:true});
 for(const width of [1366,390]){
 const page=await browser.newPage({viewport:{width,height:900}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
 await page.route('https://lobby.test/**',r=>r.fulfill({contentType:'text/html',body:parent}));
 await page.route('https://entry.test/**',r=>{const channel=new URL(r.request().url()).searchParams.get('gameStartChannel');return r.fulfill({contentType:'text/html',body:'<html><head><meta charset="utf-8"></head><body style="margin:0;background:black"><iframe id="sandboxFrame" style="width:100vw;height:100vh;border:0" allow="fullscreen; autoplay" src="https://sandbox.test/wrapper?gameStartChannel='+channel+'"></iframe></body></html>'})});
 await page.route('https://sandbox.test/**',r=>{const channel=new URL(r.request().url()).searchParams.get('gameStartChannel');return r.fulfill({contentType:'text/html',body:'<html><head><meta charset="utf-8"></head><body style="margin:0;background:black"><iframe id="userHtmlFrame" style="width:100vw;height:100vh;border:0" allow="fullscreen; autoplay" src="https://battle.test/view?gameStartChannel='+channel+'"></iframe></body></html>'})});
 await page.route('https://battle.test/**',r=>{const channel=new URL(r.request().url()).searchParams.get('gameStartChannel');return r.fulfill({contentType:'text/html',body:'<html><head><meta charset="utf-8"></head><body style="margin:0;background:black;color:white"><script>window.GAME_START_CHANNEL='+JSON.stringify(channel)+';</script>'+manager+'<div id="stageTitle" hidden>1층 · 첫 번째 교실</div></body></html>'})});
 await page.route('https://apps.test/**',r=>r.fulfill({contentType:'text/html',body:'<iframe allow="fullscreen" style="position:fixed;inset:0;width:100%;height:100%;border:0" src="https://lobby-wrapper.test/"></iframe>'}));
 await page.route('https://lobby-wrapper.test/**',r=>r.fulfill({contentType:'text/html',body:'<iframe allow="fullscreen" sandbox="allow-scripts allow-same-origin" style="position:fixed;inset:0;width:100%;height:100%;border:0" src="https://lobby.test/"></iframe>'}));
 await page.goto('https://apps.test/');
 const lobby=page.frames().find(f=>f.url().startsWith('https://lobby.test/'));assert.ok(lobby);
 await lobby.locator('#start').click();
 assert.deepEqual(await lobby.locator('#gameStartTip').evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderTopWidth,outline:s.outlineStyle,shadow:s.boxShadow}}),{border:'0px',outline:'none',shadow:'none'},'idle tip has no inherited inset border');
 assert.equal(await lobby.evaluate(()=>document.fullscreenElement.id),'gameStartViewport','the shared loading/battle surface owns fullscreen');
 assert.equal(await lobby.locator('#loadingModal').evaluate(el=>getComputedStyle(el).visibility),'hidden');
 await page.waitForTimeout(500);
 const dots=[];
 for(let i=0;i<5;i++){dots.push(await lobby.locator('#gameStartLoadingDots').innerText());await page.waitForTimeout(510);}
 assert.ok(dots.every(text=>/^\.{0,3}$/.test(text)));
 assert.equal(new Set(dots).size,4,'dots cycle from zero through three');
 await lobby.locator('#gameStartTip').hover();
 const tipStyle=await lobby.locator('#gameStartTip').evaluate(el=>{const s=getComputedStyle(el);return {border:s.borderTopWidth,outline:s.outlineStyle,shadow:s.boxShadow}});
 assert.deepEqual(tipStyle,{border:'0px',outline:'none',shadow:'none'});
 await lobby.locator('#gameStartTip').focus();
 assert.equal(await lobby.locator('#gameStartTip').evaluate(el=>getComputedStyle(el).outlineStyle),'none');
 const early=await lobby.locator('#gameStartLoading').evaluate(el=>Number(getComputedStyle(el).opacity));assert.ok(early>0&&early<1,'black fades in slowly');
 assert.equal(await lobby.locator('#gameStartTipText span').count(),6);
 await page.waitForTimeout(2200);
 assert.match(await lobby.locator('#gameStartTipText').innerText(),/두 번째/);
 assert.equal(await lobby.locator('#gameStartTipText img').count(),0,'sheet text cannot inject HTML');
 await lobby.locator('#gameStartTip').click();assert.match(await lobby.locator('#gameStartTipText').innerText(),/일반-드문/);
 await lobby.waitForFunction(()=>document.getElementById('gameStartFrame'));
 await page.screenshot({path:path.join(output,'loading-'+width+'.png')});
 assert.equal(await lobby.evaluate(()=>!!document.fullscreenElement),true,'loading battle in a child frame preserves fullscreen');
 const battle=page.frames().find(f=>f.url().startsWith('https://battle.test/'));assert.ok(battle);
 await battle.evaluate(()=>{window.introStarted=false;LearningRpgGameStart.ready().then(()=>{introStarted=true;document.getElementById('stageTitle').hidden=false;});});
 await lobby.waitForFunction(()=>document.getElementById('gameStartLoading').classList.contains('finishing'));
 assert.equal(await battle.evaluate(()=>introStarted),false,'intro waits for tip/spinner fade');
 await lobby.waitForFunction(()=>document.getElementById('gameStartLoading').hidden);
 await battle.waitForFunction(()=>introStarted);
 assert.equal(await lobby.locator('#gameStartFrame').isVisible(),true);
 assert.equal(await lobby.evaluate(()=>document.fullscreenElement.id),'gameStartViewport','handoff keeps fullscreen active');
 assert.equal(await lobby.evaluate(()=>document.elementFromPoint(innerWidth/2,innerHeight/2).id),'gameStartFrame','battle receives the visible surface without exiting fullscreen');
 await page.screenshot({path:path.join(output,'started-'+width+'.png')});
 assert.ok(await lobby.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
 assert.deepEqual(errors,[]);
 await page.close();
 }
 // Failure recovery removes both loading UI and the embedded page.
 const page=await browser.newPage();await page.route('https://lobby.test/**',r=>r.fulfill({contentType:'text/html',body:parent}));await page.goto('https://lobby.test/');
 await page.locator('#start').click();await page.evaluate(()=>LearningRpgGameStart.fail('연결 실패'));
 assert.match(await page.locator('#gameStartLoadingError').innerText(),/연결 실패/);
 await page.locator('#gameStartLoadingBack').click();assert.equal(await page.locator('#gameStartLoading').isVisible(),false);assert.equal(await page.evaluate(()=>reset),true);
 await page.waitForTimeout(4100);assert.equal(await page.locator('#gameStartFrame').count(),0,'aborted navigation stays canceled');
 await page.close();
 console.log('Game start loading passed: fullscreen, slow fade, five-second/click tips, grade colors, cross-frame handoff, intro ordering and error recovery (desktop/mobile).');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
