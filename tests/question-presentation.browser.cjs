const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),path=require('node:path'),assert=require('node:assert/strict');
const html=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>html.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
const modal=html.slice(html.indexOf('  <div id="questionModal"'),html.indexOf('  <div id="rewardModal"'));
const keyboard=html.slice(html.indexOf("    document.addEventListener('keydown', function(event) {"),html.indexOf('    var CLIENT_BASE_GUARD_SHIELD'));
const helpers=['formatSecond','openQuestionModal','prepareQuestionPresentation','syncQuestionEfficiencyDock','startQuestionSolving',
  'renderAnswerArea','selectQuestionChoiceByNumber','getSelectedAnswer','tickQuestionTimer','calculateTimedEfficiency',
  'getQuestionMinAnswerEfficiency','getQuestionMaxAnswerEfficiency','updateQuestionEfficiencyMeter','getQuestionActionValueText',
  'formatQuestionActionEvents','calculateQuestionActionActualValue','updateQuestionActionValueText','resetQuestionEfficiencyFeedback','calculateWrongEfficiency',
  'animateQuestionEfficiencyPenalty','animateQuestionEfficiencyCorrect','submitQuestionAnswer','markSelectedAnswerResult',
  'setQuestionInputsDisabled','hideQuestionGiveUpButton','showQuestionGiveUpButton','showQuestionUnderstanding','resetQuestionUnderstanding',
  'chooseQuestionUnderstanding','receiveQuestionTurnView','requestQuestionResultProceed','continueAfterQuestionResult',
  'animateQuestionActionRelease','closeQuestionModal'];
const fixture=`
var currentView={runId:'r',battle:{player:{hp:50,stats:{attack:10}},monsters:[{instanceId:'a',currentHp:100}]}},currentQuestionView=null;
var pendingCombatSkillChoice=null,questionStartedAt=0,questionTimerId=null,questionPresentationTimer=null,wrongCountAfterTimeout=0;
var shortAnswerEnterSubmitLock=false,workbookDeadlineExpired=false,MIN_ANSWER_EFFICIENCY=.5,MAX_ANSWER_EFFICIENCY=1.25,EXTRA_WRONG_EFFICIENCY_PENALTY=.1,CLIENT_BASE_GUARD_SHIELD=0;
var currentDamageEfficiency=1.25,localGameDataSnapshot={},pendingTurnResolutionActive=false,pendingTurnResolutionLoading=false,pendingQuestionTurnIsOptimistic=false;
var pendingQuestionTurnView=null,pendingQuestionTurnError=null,pendingServerTurnView=null,questionResultProceedRequested=false,isAnimatingTurn=false,pendingActionPointVisualCost=0;
var QUESTION_ACTION_START_DELAY_MS=0,plays=0,submitted=[],wrongAttempts=0;
function resetQuestionResultHold(){} function recordQuestionExposure(){} function renderDifficultyStars(){return '★★★';}
function formatSecond(ms){return (ms/1000).toFixed(1);} function renderQuestionMetadata(){} function renderQuestionAccuracy(){document.getElementById('questionAccuracy').textContent='정답률 72% · 18회';}
function renderQuestionReactionView(){} function cssEscape(s){return CSS.escape(s);} function escapeHtml(s){return String(s).replaceAll('&','&amp;').replaceAll('<','&lt;');}
function shuffleArray(a){return a;} function updateWorkbookCountdown(){} function getAuthToken(){return 'auth';}
function getClientLocalQuestionModifiers(){return {};} function getClientEffectiveStat(p,key){return p.stats[key] || 0;}
function applyClientOutgoingItemDamageModifiers(b,d){return d;} function applyClientQuestionCorrectEfficiencyModifiers(n){return n;}
function findAvailableSkill(){return {skillId:'s',level:1,type:'damage',name:'불붙이기'};} function getSkillActionPointCost(){return 1;}
function hasClientAnswer(){return true;} function isClientCorrectAnswer(q,a){return q.type==='shortAnswer'?a.selectedAnswerText===q.answer:a.selectedChoiceIndex===q.answer;}
function recordWrongQuestionAttempt(){wrongAttempts++;} function revealShortAnswerHint(){} function hasClientFatalWrongAnswerPenalty(){return false;}
function setBattleInputLocked(){} function spawnAnswerCorrectBurst(){} function normalizeBattleView(v){return v;} function hideLoadingModal(){}
function handleRewardKeyboard(){return false;} function handleTargetSelectionKeyboard(){return false;} function handleBattleActionKeyboard(){return false;} function advanceDescriptionByInput(){return false;}
function startQuestionResultHold(){currentQuestionView.resultHolding=true;pendingTurnResolutionActive=true;questionResultProceedRequested=false;showQuestionUnderstanding();document.getElementById('questionSubmitButton').disabled=false;document.getElementById('questionSubmitButton').textContent='건너뛰기';}
function playTurnSequence(v){plays++;currentView=v;} function delay(ms){return new Promise(r=>setTimeout(r,ms));}
function submitQuestionAnswerOnServer(payload){submitted.push(payload);receiveQuestionTurnView({battle:{player:{hp:50,stats:{attack:10}},monsters:[{instanceId:'a',currentHp:0}],lastTurnEvents:[{actor:'player',type:'skill',targetMonsterId:'a',damage:1,displayDamage:5}]}});}
window.LearningRpgLocalRunEngine={previewSkill(snapshot,battle,skill,target,eff){return {lastTurnEvents:eff>0?[{actor:'player',type:'skill',targetMonsterId:'a',damage:Math.round(10*eff)},{actor:'player',type:'debuff',targetMonsterId:'a',effectName:'발화',appliedStacks:Math.round(5*eff)}]:[]};}};
var RULE_ENGINE_SHARED={capQuestionEfficiencyBonus:n=>n,consumeWrongProtection:()=>false};
function openFixture(type='multipleChoice',skill=true){
  openQuestionModal({actionType:skill?'skill':'attack',skillId:skill?'s':'',targetId:'a',actionPointCost:1,maxMs:1500,maxAnswerEfficiency:1.25,finalDifficulty:3,
    questionModifiers:{},question:{questionId:'q',prompt:'서로 다른 두 물질이 만나 새로운 물질이 만들어지는 변화는 무엇일까요?',type,answer:type==='shortAnswer'?'화학 변화':'2',choice1:'상태 변화',choice2:'화학 변화',choice3:'혼합',choice4:'분리',creatorId:'teacher',creatorName:'과학 선생님'}},false);
}
`;
(async()=>{
 const browser=await chromium.launch({channel:'msedge',headless:true});
 try {
  const output=path.resolve('.tmp_spreadsheet/question-presentation');fs.mkdirSync(output,{recursive:true});
  for(const [width,height] of [[1440,1000],[1366,768],[390,844],[360,640]]) {
   const page=await browser.newPage({viewport:{width,height}}),errors=[];page.on('pageerror',e=>errors.push(e.message));
   await page.setContent('<html><head><meta charset="utf-8">'+styles+'</head><body><div class="player-hp-track" style="position:fixed;bottom:8px;left:12px;right:12px;height:42px">HP</div><button class="skill-button" data-skill-id="s" style="position:absolute;left:0;top:0"><span class="hud-skill-card-source"><span class="reward-choice-card reward-inline-skill hud-skill-card rarity-rare"><span class="reward-choice-heading">불붙이기</span><span class="reward-choice-icon-wrap">✦</span><span class="reward-inline-description">적에게 피해와 발화 중첩을 부여합니다.</span></span></span></button>'+modal+'<script>'+fixture+helpers.map(extract).join('\n')+keyboard+'</script></body></html>');
   await page.evaluate(()=>openFixture());
   assert.equal(await page.locator('#questionModal').evaluate(el=>el.classList.contains('skill-question-opening')),true);
   assert.equal(await page.locator('#questionStartButton').isDisabled(),true);
   assert.equal(await page.locator('#questionAnswerArea input').count(),0);
   const initial=await page.locator('#questionEfficiencyPercent').innerText();
   await page.waitForTimeout(760);assert.equal(await page.locator('#questionEfficiencyPercent').innerText(),initial,'reading time never consumes efficiency');
   assert.equal(await page.evaluate(()=>questionStartedAt),0);
   const appearance=await page.evaluate(()=>{
    const style=id=>getComputedStyle(document.getElementById(id));
    return {promptFont:style('questionPrompt').fontFamily,accuracyFont:style('questionAccuracy').fontFamily,
      valueFont:style('questionEfficiencyActionValue').fontFamily,promptSize:parseFloat(style('questionPrompt').fontSize),
      backdrop:style('questionModal').backgroundColor,startFill:style('questionStartButton').backgroundImage,
      scrollbars:getComputedStyle(document.querySelector('#questionModal>.question-modal')).scrollbarWidth};
   });
   assert.equal(appearance.promptFont,appearance.accuracyFont);assert.equal(appearance.valueFont,appearance.accuracyFont);
   assert.ok(appearance.promptSize<=18);assert.equal(appearance.backdrop,'rgba(0, 0, 0, 0.52)');
   assert.equal(appearance.startFill,'none');assert.equal(appearance.scrollbars,'none');
   await page.screenshot({path:path.join(output,`reading-${width}.png`)});
   await page.keyboard.press('1');assert.equal(await page.locator('input[name=questionChoice]:checked').count(),0);
   await page.keyboard.press('Enter');assert.equal(await page.locator('#questionStartButton').isVisible(),false);
   assert.equal(await page.locator('.question-choice').count(),4);
   await page.waitForTimeout(220);assert.ok(Number((await page.locator('#questionEfficiencyPercent').innerText()).replace('%',''))<125);
   assert.match(await page.locator('#questionEfficiencyActionValue').innerText(),/피해량 : \d+, 발화 중첩 : \d+/);
   const remaining=await page.locator('#questionRemainingTime').innerText();
   assert.match(remaining,/^\d+\.\ds$/);assert.ok(parseFloat(remaining)<1.5);
   const timerBox=await page.locator('#questionRemainingTime').boundingBox();
   assert.ok(timerBox.x>width/2 && timerBox.x+timerBox.width<width,'live timer stays on the right of the meter');
   assert.match(await page.locator('#questionEfficiencyText').innerText(),/^\d+%$/);
   const dock=await page.locator('#questionEfficiencyMeter').boundingBox();assert.ok(Math.abs(dock.y-(height-50))<2);assert.ok(Math.abs(dock.width-(width-24))<2);
   await page.keyboard.press('1');await page.locator('#questionSubmitButton').click();
   assert.equal(await page.evaluate(()=>wrongAttempts),1);assert.equal(await page.locator('#questionEfficiencyPercent').innerText(),'50%');
   assert.equal(await page.locator('#questionEfficiencyMeter').evaluate(el=>el.classList.contains('efficiency-penalty')),true);
   assert.equal(await page.locator('#questionEfficiencyActionValue').evaluate(el=>el.classList.contains('value-changing')),true);
   await page.keyboard.press('2');await page.locator('#questionSubmitButton').click();
   assert.equal(await page.locator('.question-choice.answer-correct').count(),1);assert.equal(await page.locator('#questionUnderstanding').isVisible(),true);
   assert.equal(await page.locator('#questionEfficiencyActionValue').evaluate(el=>el.classList.contains('value-correct')),true);
   await page.waitForTimeout(260);
   assert.ok(await page.locator('#questionEfficiencyActionValue').evaluate(el=>new DOMMatrixReadOnly(getComputedStyle(el).transform).m42<0),'correct action values rise above the efficiency meter');
   assert.equal(await page.locator('#questionEfficiencyActionValue').innerText(),'피해량 : 5, 발화 중첩 : 3','enemy HP and death never truncate the action values');
   const color=await page.locator('#questionEfficiencyActionValue').evaluate(el=>({base:getComputedStyle(el).color,brightness:Number(el.style.getPropertyValue('--action-value-brightness'))}));
   assert.equal(color.base,'rgb(255, 255, 255)');assert.ok(color.brightness<1 && color.brightness>=.8,'white action text fades to gray');
   assert.equal(await page.evaluate(()=>plays),0,'survey holds action presentation');
   await page.screenshot({path:path.join(output,`correct-${width}.png`)});
   await page.locator('#questionSubmitButton').click();
   await page.waitForTimeout(70);assert.equal(await page.locator('.question-action-flight').isVisible(),true);assert.equal(await page.evaluate(()=>plays),0);
   await page.waitForFunction(()=>plays===1);assert.equal(await page.locator('#questionModal').evaluate(el=>el.classList.contains('active')),false);
   assert.equal(await page.locator('.question-action-flight').count(),0);assert.equal(await page.locator('.player-hp-track').isVisible(),true);
   assert.ok(await page.evaluate(()=>submitted[0].elapsedMs<1500),'elapsed time excludes reading and entry animation');
   await page.evaluate(()=>openFixture('shortAnswer',false));await page.keyboard.press('Enter');
   await page.locator('#shortAnswerInput').fill('화학 변화');await page.locator('#shortAnswerInput').press('Enter');
   assert.equal(await page.locator('#shortAnswerInput').evaluate(el=>el.classList.contains('answer-correct')),true);
   await page.evaluate(()=>currentQuestionView.isDummy=true);
   await page.locator('[data-rating="3"]').click();await page.waitForFunction(()=>plays===2);
   await page.evaluate(()=>{currentQuestionView={actionType:'attack',maxAnswerEfficiency:1.25,questionModifiers:{questionEfficiencyBonusPercent:10}};updateQuestionEfficiencyMeter(.5);});
   assert.equal(await page.locator('#questionEfficiencyPercent').innerText(),'60%');
   assert.equal(await page.locator('#questionEfficiencyFill').evaluate(el=>el.classList.contains('efficiency-mid')),true);
   assert.deepEqual(errors,[]);assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
   await page.close();
  }
  console.log('Question presentation: card flash, read/start/Enter gate, docked percent-only meter, damage+stacks, wrong bounce, correct glow, survey hold and delayed flight passed at four sizes.');
 } finally {await browser.close();}
})().catch(e=>{console.error(e);process.exitCode=1;});
