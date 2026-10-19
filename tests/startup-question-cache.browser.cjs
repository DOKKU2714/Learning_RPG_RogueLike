const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync('Battle.html','utf8');
const extract=name=>html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const store=fs.readFileSync('QuestionSnapshotStore.html','utf8').match(/<script>([^]*?)<\/script>/)[1];
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 const context=await browser.newContext();
 await context.route('https://startup.test/**',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><html><body></body></html>'}));
 const page=await context.newPage();await page.goto('https://startup.test/');await page.addScriptTag({content:store});
 await page.evaluate(()=>LearningRpgQuestionStore.replace({workbookId:'w',questions:[{questionId:'q',prompt:'로컬 문제'}]}));
 await page.reload(); // A new page must read IndexedDB, rather than the store's memory cache.
 await page.setContent('<html><body><div id="questionCacheStatus"></div>'+['attackActionButton','guardActionButton','skillToggleButton','passTurnButton','battleMenuButton'].map(id=>'<button id="'+id+'">'+id+'</button>').join('')+'</body></html>');
 await page.addScriptTag({content:store});
 await page.addScriptTag({content:`
 var currentView={runId:'r',battle:{status:'active'}},questionCacheRefillInFlight=false,questionCachePreloadFailed=false,localWorkbookQuestions=[],localQuestionSnapshot=null;
 var workbookDeadlineExpired=false,floorIntermissionActionPending=false;
 function getSelectedWorkbookId(){return 'w'}function isBattleResultLoading(){return false}function updatePlayerTurnActionAttention(){}
 function loadQuestionUnderstandingRatings(){return new Promise(function(){});}
 function updateBattleInputLockState(){setBattleInputLocked(false);}
 ${['preloadMissingBattleQuestionCache','setBattleInputLocked','isInitialQuestionCachePreparing','isLocalQuestionSnapshotUnavailable'].map(extract).join('\n')}
 `});
 const initial=await page.evaluate(()=>{preloadMissingBattleQuestionCache();return document.getElementById('attackActionButton').disabled;});assert.equal(initial,true);
 await page.waitForFunction(()=>!document.getElementById('attackActionButton').disabled,{timeout:3000});
 assert.equal(await page.evaluate(()=>localWorkbookQuestions[0].questionId),'q');
 assert.equal(await page.locator('#questionCacheStatus').evaluate(el=>el.classList.contains('hidden')),true);
 assert.equal(await page.locator('#guardActionButton').isEnabled(),true);assert.equal(await page.locator('#skillToggleButton').isEnabled(),true);
 console.log('Startup: real IndexedDB questions unlock attack, guard and skills without any ratings-server response.');
}finally{await browser.close();}})().catch(error=>{console.error(error);process.exitCode=1;});
