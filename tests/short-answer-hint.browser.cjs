const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),path=require('node:path'),os=require('node:os'),assert=require('node:assert/strict');
const battle=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>battle.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const modal=battle.slice(battle.indexOf('  <div id="questionModal"'),battle.indexOf('  <div id="rewardModal"'));
const helpers=['renderAnswerArea','getSelectedAnswer','submitQuestionAnswer','giveUpCurrentQuestion','showGivenUpAnswerInInput',
  'recordWrongQuestionAttempt','revealShortAnswerHint','getQuestionAnswerDisplayText','hasClientAnswer',
  'recordRunQuestionAttempt','getRunQuestionStats','getQuestionSelectionStats','saveRunQuestionStats',
  'renderQuestionAccuracy','buildPendingStageAnswerLog','submitQuestionAnswerOnServer','setQuestionInputsDisabled',
  'showQuestionGiveUpButton','hideQuestionGiveUpButton'];
const fixture=`
var currentView={runId:'hint-run',playerId:'p',battle:{stage:{}}},currentQuestionView;
var runQuestionStats={},runQuestionStatsRunId='',pendingStageAnswerLogs=[],questionUnderstandingRatings={};
var questionStartedAt,questionTimerId,wrongCountAfterTimeout=0,shortAnswerEnterSubmitLock=false;
var workbookDeadlineExpired=false,currentDamageEfficiency=0;
var updateWorkbookCountdown=()=>{},getAuthToken=()=>'',isClientCorrectAnswer=(q,a)=>a.selectedAnswerText===q.answer;
var hasClientFatalWrongAnswerPenalty=()=>false,showQuestionUnderstanding=()=>{};
var calculateTimedEfficiency=()=>1,calculateWrongEfficiency=n=>Math.max(.1,.5-(n-1)*.1);
var updateQuestionEfficiencyMeter=n=>document.getElementById('questionEfficiencyMeter').dataset.efficiency=n;
var animateQuestionEfficiencyPenalty=()=>{},markSelectedAnswerResult=()=>{},animateQuestionEfficiencyCorrect=()=>{};
var applyClientQuestionCorrectEfficiencyModifiers=n=>n,setBattleInputLocked=()=>{};
var startQuestionResultHold=()=>{currentQuestionView.resultHolding=true},buildOptimisticNextViewFromQuestion=()=>currentView;
var receiveQuestionTurnView=()=>{},requestQuestionResultProceed=()=>{},safeJsonParseClient=(s,f)=>s?JSON.parse(s):f;
var RULE_ENGINE_SHARED={consumeWrongProtection:()=>false};
function startFixture(){currentQuestionView={question:{questionId:'q',type:'shortAnswer',answer:'제안하다',answerAliases:'[]'},actionType:'attack',maxMs:10000,finalDifficulty:1};
questionStartedAt=Date.now();wrongCountAfterTimeout=0;pendingStageAnswerLogs=[];runQuestionStats={};runQuestionStatsRunId='hint-run';
document.getElementById('questionSubmitButton').disabled=false;renderAnswerArea(currentQuestionView.question);}
`;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 const output=fs.mkdtempSync(path.join(os.tmpdir(),'short-answer-hint-'));
 try{
  for(const width of [1000,390]){
   const page=await browser.newPage({viewport:{width,height:844}}),errors=[];
   page.on('pageerror',e=>errors.push(e.message));
   await page.route('https://hint.test/',route=>route.fulfill({contentType:'text/html',body:'<!doctype html><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+modal+'<script>'+fixture+helpers.map(extract).join('\n')+'</script>'}));
   await page.goto('https://hint.test/');
   await page.evaluate(()=>{document.getElementById('questionModal').classList.add('active');document.getElementById('questionPrompt').textContent='다음 단어의 뜻을 쓰세요: suggest';Math.random=()=>.3;startFixture();});
   assert.equal(await page.locator('#shortAnswerHint').isVisible(),false);
   await page.locator('#questionSubmitButton').click();
   assert.equal(await page.evaluate(()=>pendingStageAnswerLogs.length),0,'empty input is not an attempt');
   for(const [i,wrong] of ['제안','제한하다','제안해'].entries()){
    await page.locator('#shortAnswerInput').fill(wrong);
    await page.locator('#shortAnswerInput').press('Enter');
    assert.equal(await page.evaluate(()=>getRunQuestionStats('q').totalCount),i+1);
    assert.equal(await page.locator('#shortAnswerHint').innerText(),['힌트: 제***','힌트: 제안**','힌트: 제안하*'][i]);
   }
   await page.screenshot({path:path.join(output,width+'.png')});
   await page.locator('#shortAnswerInput').fill('제안하다');await page.locator('#questionSubmitButton').click();
   assert.equal(await page.evaluate(()=>getRunQuestionStats('q').correctCount),1);
   assert.equal(await page.evaluate(()=>getRunQuestionStats('q').totalCount),4);
   assert.deepEqual(await page.evaluate(()=>pendingStageAnswerLogs.map(l=>l.selectedAnswerText)),['제안','제한하다','제안해','제안하다']);
   await page.evaluate(()=>startFixture());
   assert.equal(await page.locator('#shortAnswerHint').isVisible(),false);
   await page.locator('#shortAnswerInput').fill('오답');await page.locator('#questionSubmitButton').click();
   await page.locator('#questionGiveUpButton').click();
   assert.equal(await page.evaluate(()=>getRunQuestionStats('q').totalCount),1);
   assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   assert.deepEqual(errors,[]);console.log('Short answer hints, retry logging, success, give-up and reset OK:',width);
   await page.close();
  }
  console.log('Screenshots:',output);
 }finally{await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
