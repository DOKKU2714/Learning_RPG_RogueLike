const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const sharedContext=vm.createContext({});vm.runInContext(fs.readFileSync('SharedRuleEngine.gs','utf8'),sharedContext);
const sharedSource=sharedContext.getSharedRuleEngineSource_();
const html = fs.readFileSync('Battle.html', 'utf8');
const extract = name => html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];
const modals = html.slice(html.indexOf('  <div id="questionModal"'), html.indexOf('  <div id="scoreModal"'));

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    const errors = []; page.on('pageerror', error => errors.push(error.message));
    await page.setContent('<html><head>' + fs.readFileSync('UiStyles.html', 'utf8') + '</head><body>' + modals + '<script>' + sharedSource + `
      var rewardRerollBusy=false,rewardRerollQuestion=null,rewardRerollAnswer=null,rewardSelectionApplying=false,workbookDeadlineExpired=false,victoryRewardPreload=null;
      var currentQuestionView=null,questionTimerId=null,questionPresentationTimer=null,questionStartedAt=0,wrongCountAfterTimeout=0,shortAnswerEnterSubmitLock=false,pendingActionPointVisualCost=0;
      var currentView={},calls=[],renderCount=0,bridgeMode='normal',MIN_ANSWER_EFFICIENCY=.1,MAX_ANSWER_EFFICIENCY=1.25;
      var currentRewardView={localTransitionToken:'signed',choices:[{description:'기존 보상'}],rerollQuestion:{questionId:'weak',prompt:'정답률이 가장 낮은 문제',type:'multipleChoice',choice1:'오답',choice2:'정답',answer:'2',answerAliases:'[]',difficulty:5}};
      function resetQuestionResultHold(){} function resetQuestionEfficiencyFeedback(){} function renderQuestionMetadata(){}
      function renderQuestionAccuracy(){} function resetQuestionUnderstanding(){} function renderQuestionReactionView(){}
      function recordQuestionExposure(){throw Error('reroll must not affect combat exposure');}
      function renderDifficultyStars(){return '★★★★★';} function formatSecond(ms){return (ms/1000).toFixed(1);}
      function hideQuestionGiveUpButton(){document.getElementById('questionGiveUpButton').classList.add('hidden');}
      function showQuestionGiveUpButton(){} function markSelectedAnswerResult(){} function updateWorkbookCountdown(){}
      function calculateTimedEfficiency(){return 1;} function calculateQuestionActionActualValue(e){return e;}
      function calculateClientLocalQuestionTimeMs(){return 10000;} function shuffleArray(a){return a;}
      function rememberRunSession(){} function ensureClientRewardState(){} function getAuthToken(){return 'auth';}
      function buildStageResultPayload(){return {};} function safeJsonParseClient(s,d){try{return JSON.parse(s);}catch{return d;}}
      function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/"/g,'&quot;');}
      function renderRewardChoices(view){renderCount++;rewardSelectionApplying=false;document.getElementById('rewardModal').classList.add('active');document.getElementById('rewardChoices').textContent=view.choices[0].description;document.getElementById('rewardRerollButton').disabled=!!view.rerollUsed||!!view.rerollUnavailable;}
      var bridge={withSuccessHandler(fn){this.success=fn;return this;},withFailureHandler(fn){this.failure=fn;return this;},previewRewardChoicesForStageResult(payload){
        calls.push(payload);var callback=this.success,failure=this.failure;setTimeout(function(){
          if(payload.rewardRerollAction==='start') {
            if(bridgeMode==='network'){failure({message:'출제 요청 실패'});return;}
            if(bridgeMode==='legacy'){callback({choices:currentRewardView.choices});return;}
            if(bridgeMode==='unavailable'){callback({rerollStatus:'unavailable',rerollMessage:'풀이 기록이 있는 문제가 없습니다.',rewardView:{...currentRewardView,rerollUnavailable:true,rerollUnavailableReason:'풀이 기록이 있는 문제가 없습니다.'}});return;}
            callback({rerollStatus:'pending',rerollQuestion:{questionId:'weak',prompt:'기존 보상의 새로고침 문제',type:'multipleChoice',choice1:'오답',choice2:'정답',answer:'2',answerAliases:'[]',difficulty:5},rewardView:{...currentRewardView,rerollUsed:true}});return;
          }
          var correct=payload.rerollAnswer && String(payload.rerollAnswer.selectedChoiceIndex)==='2';
          callback({rerollStatus:correct?'success':'failed',rewardView:{localTransitionToken:'signed',rerollUsed:true,choices:[{description:correct?'새 보상':'기존 보상'}]}});
        },500);
      }};var google={script:{run:bridge}};
    ` + ['openQuestionModal', 'renderAnswerArea', 'getSelectedAnswer', 'isClientCorrectAnswer', 'normalizeClientAnswer', 'normalizeClientShortAnswer',
      'setQuestionInputsDisabled', 'tickQuestionTimer', 'getQuestionMaxAnswerEfficiency', 'updateQuestionEfficiencyMeter', 'closeQuestionModal',
      'prepareQuestionPresentation','syncQuestionEfficiencyDock','startQuestionSolving','getQuestionActionValueText','updateQuestionActionValueText',
      'openRewardRerollQuestion', 'startRewardReroll', 'finishRewardReroll', 'submitRewardRerollAnswer', 'requestRewardReroll', 'submitQuestionAnswer'].map(extract).join('\n') +
      ';renderRewardChoices(currentRewardView);</script></body></html>');
    await page.locator('#rewardRerollButton').click();
    assert.equal(await page.locator('#questionModal').evaluate(el => el.classList.contains('active')), true);
    assert.equal(await page.evaluate(() => calls.length), 0, 'question opens without a server request');
    await page.locator('#questionStartButton').click();
    await page.locator('[data-choice-value="1"]').click();
    assert.equal(await page.locator('#questionEfficiencyPercent').innerText(), '0%', errors.join('\n'));
    assert.equal(await page.locator('input[name="questionChoice"]:enabled').count(), 0);
    await page.evaluate(() => tickQuestionTimer());
    assert.equal(await page.locator('#questionEfficiencyPercent').innerText(), '0%');
    await page.evaluate(() => document.querySelector('[data-choice-value="2"]').click());
    assert.equal(await page.evaluate(() => calls.length), 1, 'cannot retry the question while saving');
    await page.waitForFunction(() => currentQuestionView.rerollComplete);
    await page.locator('#questionSubmitButton').click();
    assert.equal(await page.locator('#rewardRerollButton').isDisabled(), true);
    assert.equal(await page.locator('#rewardChoices').innerText(), '기존 보상');
    await page.evaluate(() => {currentRewardView.rerollUsed=false;currentRewardView.rerollQuestion={questionId:'weak',prompt:'문제',type:'multipleChoice',choice1:'오답',choice2:'정답',answer:'2',answerAliases:'[]',difficulty:5};renderRewardChoices(currentRewardView);});
    await page.locator('#rewardRerollButton').click();
    await page.locator('#questionStartButton').click();
    await page.locator('[data-choice-value="2"]').click();
    await page.waitForFunction(() => currentQuestionView.rerollComplete);
    await page.locator('#questionSubmitButton').click();
    assert.equal(await page.locator('#rewardChoices').innerText(), '새 보상');

    const reset = async mode => page.evaluate(mode=>{
      bridgeMode=mode;currentQuestionView=null;rewardRerollQuestion=null;rewardRerollAnswer=null;
      currentRewardView={localTransitionToken:'signed',rerollUsed:false,choices:[{description:'기존 보상'}]};
      renderRewardChoices(currentRewardView);
    },mode);
    await reset('normal');
    let renders=await page.evaluate(()=>renderCount);
    await page.locator('#rewardRerollButton').click();
    await page.waitForFunction(()=>currentQuestionView && currentQuestionView.isRewardReroll);
    assert.equal(await page.locator('#questionTitle').innerText(),'보상 새로고침 문제');
    assert.equal(await page.evaluate(()=>renderCount),renders,'server-fetched challenge does not redraw old cards');
    await page.locator('#questionStartButton').click();
    await page.locator('[data-choice-value="2"]').click();
    await page.waitForFunction(()=>currentQuestionView.rerollComplete);
    await page.locator('#questionSubmitButton').click();
    assert.equal(await page.locator('#rewardChoices').innerText(),'새 보상');

    for(const [mode,message] of [['network','출제 요청 실패'],['legacy','배포 버전'],['unavailable','풀이 기록']]) {
      await reset(mode);renders=await page.evaluate(()=>renderCount);
      await page.locator('#rewardRerollButton').click();
      await page.waitForFunction(()=>!rewardRerollBusy);
      assert.match(await page.locator('#rewardMessage').innerText(),new RegExp(message));
      assert.equal(await page.locator('#rewardChoices').innerText(),'기존 보상');
      assert.equal(await page.evaluate(()=>renderCount),renders,'failed or unavailable request preserves the same cards without a reveal');
      assert.equal(await page.evaluate(()=>rewardSelectionApplying),false);
      assert.equal(await page.locator('#rewardRerollButton').isDisabled(),mode==='unavailable');
    }
    assert.deepEqual(errors, []);
    console.log('Reroll OK: preloaded and fetched questions, success replaces rewards, unavailable/network/old-server errors preserve cards without reanimation, selection unlocks.');
  } finally { await browser.close(); }
})().catch(error => { console.error(error); process.exitCode = 1; });
