const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const source=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>source.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const modal=source.slice(source.indexOf('  <div id="scoreModal"'),source.indexOf('  <div id="itemModal"'));
const helpers=['offerBossItemBeforeReward','getBossItemChoiceKey','claimBossItemReward','hasConfirmedBossItemScorePreview',
 'showScoreModal','renderBossItemRewardRow','finishScoreAnimationNow','clearScoreAnimation','queueScoreAnimation','updateScoreModalConfirmButton'];
const fixture=`var currentView={runId:'run'},currentRewardView={runId:'run',stageId:'boss-stage',scorePreviewSummary:{scoreDelta:120,totalScore:620},
bossItemRewards:{reward:{targetId:'gloves',itemDetail:{name:'장갑',rarity:'rare',effectSummary:'공격력 +2'}}}};
var pendingBossItemChoice=null,approvedBossItemChoiceKey='',workbookDeadlineExpired=false,rewardSelectionApplying=false;
var scoreAnimationTimers=[],scoreAnimationDone=true,pendingScoreModalResponse=null,scoreModalAwaitingFinalResponse=false,scoreModalDismissedWhileWaiting=false,currentScoreModalSummary=null;
var animationRuns=0,claims=0;
var normalizeClientScoreSummary=s=>s,buildScoreBreakdownRows=s=>[{label:'몬스터 점수',value:s.scoreDelta}],buildScoreMetaRows=()=>[];
var formatScore=n=>n+'점',escapeHtml=s=>String(s).replaceAll('&','&amp;').replaceAll('<','&lt;').replaceAll('"','&quot;');
var normalizeRewardRarity=r=>r,getRewardRarityLabel=()=> '희귀',preloadNextBattleAfterReward=()=>{};
var animateScoreSequence=s=>{animationRuns++;finishScoreAnimationNow()};
var selectRewardChoice=id=>{claims++;showScoreModal(currentRewardView.scorePreviewSummary,{bonusItemReward:currentRewardView.bossItemRewards[id]})};`;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try{
  for(const width of [1280,390]){
   const page=await browser.newPage({viewport:{width,height:844}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setContent('<!doctype html><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+'<div id="rewardModal"></div>'+modal+'<script>'+fixture+helpers.map(extract).join('\n')+'</script>');
   await page.evaluate(()=>offerBossItemBeforeReward('reward'));
   await page.waitForFunction(()=>animationRuns===1&&scoreAnimationDone);
   await page.locator('#bossItemClaimButton').click();
   await page.waitForTimeout(350);
   assert.equal(await page.evaluate(()=>animationRuns),1);
   assert.equal(await page.evaluate(()=>claims),1);
   assert.equal(await page.locator('#scoreDeltaText').innerText(),'+120점');
   assert.equal(await page.locator('#scoreTotalText').innerText(),'620점');
   assert.equal(await page.locator('.boss-item-claimed').innerText(),'획득 완료');
   await page.evaluate(()=>{claimBossItemReward();currentRewardView={runId:'run',stageId:'next-stage'};showScoreModal({scoreDelta:50,totalScore:670},{})});
   await page.waitForFunction(()=>animationRuns===2&&scoreAnimationDone);
   assert.equal(await page.evaluate(()=>claims),1);
   assert.deepEqual(errors,[]);console.log('Boss claim preserves score without replay; later stage animates normally:',width);await page.close();
  }
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
