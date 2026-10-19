const {chromium}=require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync('Battle.html','utf8');
const extract=name=>html.match(new RegExp('    (?:async )?function '+name+'\\([^]*?\\n    \\}'))[0];
const modal=html.slice(html.indexOf('  <div id="rewardModal"'),html.indexOf('  <div id="scoreModal"'));
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  try {
    for(const width of [1366,390]){
      const page=await browser.newPage({viewport:{width,height:900},reducedMotion:'reduce'});
      const errors=[];page.on('pageerror',e=>errors.push(e.message));
      await page.setContent('<html><head>'+fs.readFileSync('UiStyles.html','utf8')+'</head><body>'+modal+
        '<div class="battle-hud"><div id="actionPanel"></div></div><div id="questionTitle"></div><div id="questionMessage"></div><button id="questionSubmitButton"></button><script>'+`
        var workbookDeadlineExpired=false,rewardSelectionApplying=false,selectedRewardId='',currentRewardView=null;
        var levelRewardResolve=null,levelAllocationCancel=null,localGameDataSnapshot={},victoryRewardPreload={},victoryRewardResultPayload={};
        var currentView={runId:'run',battle:{stage:{stage:2},player:{hp:30,baseStats:{levelProgress:{level:3,xp:0,points:0,skillRewards:[]}}}},availableSkills:[]};
        function setBattleInputLocked(){} function renderBattle(){} function animateStageClearRegen(){} function renderBattleBackground(){} function fitRewardCardText(){}
        function escapeHtml(v){return String(v);} function getRewardIconUrl(){return '';}
        function normalizeRewardRarity(v){return v;} function getRewardRarityLabel(v){return v;}
        function getRewardDisplayTitle(){return '스킬 획득';} function getRewardSkillConcept(){return '스킬';}
        function renderRewardDetailCard(){return '';} function renderRewardRarityGems(){return '';}
        var rewardRerollBusy=false,rewardRerollQuestion=null,rewardRerollAnswer=null;
        var localWorkbookQuestions=[{questionId:'reroll',workbookId:'w',snapshotSignature:'signed',totalCount:5,correctCount:1,difficulty:1}];
        function getCurrentFloorIntermissionRewardView(){return null;}
        function calculateClientLocalQuestionTimeMs(){return 10000;}
        function renderFloorRestDetailContent(){return '회복';}
        var stageIntroPlaying=false,floorIntermissionActionPending=false,skillPanelOpen=false,currentQuestionView=null,currentDamageEfficiency=.85;
        var pendingStageAnswerLogs=[];function isFloorIntermissionView(){return true;} function isBattleResultLoading(){return false;}
        function pushLog(message){window.lastLog=message;} function setPlayerTurn(){} function getVictoryRewardKey(){return 'rest';}
        function openQuestionModal(view){currentQuestionView=view;} function showQuestionGiveUpButton(){}
        function loadFloorIntermissionRewardView(done){done({floorRestChoice:true,choices:[{rewardId:'xp',type:'experience',questionView:{question:{questionId:'q'},maxMs:10000}}]});}
        function recordRunQuestionAttempt(){} function buildPendingStageAnswerLog(answer){return answer;}
        function resetQuestionResultHold(){} function closeQuestionModal(){currentQuestionView=null;}
        window.LearningRpgLocalRunEngine={
          rewardChoices:(_,b)=>{var p=b.player.baseStats.levelProgress,level=p.skillRewards.length+2;return ((p.skillRewardRerolls || {})[level]?['d','e','f']:['a','b','c']).map(id=>({rewardId:id,type:'skill',targetId:id,description:id,rarity:'common'}));},
          claimLevelReward:(_,b,skills,id)=>{b.player.baseStats.levelProgress.skillRewards.push(id);return skills.concat({skillId:id,level:1});},
          rerollLevelReward:(_,b,record)=>{var p=b.player.baseStats.levelProgress;p.skillRewardRerolls=p.skillRewardRerolls || {};p.skillRewardRerolls[p.skillRewards.length+2]=record;return true;},
          skills:(_,b,skills)=>skills
        };
        `+['getPlayerLevelProgress','getLevelRewardRerollQuestion','presentLevelSkillRewards','renderRewardChoices','selectRewardCandidate','handleRewardKeyboard','confirmRewardChoice','selectRewardChoice',
          'renderFloorIntermissionActions','chooseFloorIntermissionAction','getFloorIntermissionChoice','submitQuestionAnswerOnServer','requestQuestionResultProceed','finishFloorExperienceSelection',
          'startRewardReroll','openRewardRerollQuestion','requestRewardReroll','finishRewardReroll','buildSignedQuestionResultSnapshot'].map(extract).join('\n')+
        ';document.addEventListener("keydown",handleRewardKeyboard);window.rewards=presentLevelSkillRewards(currentView);</script></body></html>');
      for(let i=0;i<2;i++){
        await page.waitForSelector('#rewardModal.active');
        assert.equal(await page.locator('#rewardTitle').textContent(),'레벨업 · 스킬 보상');
        assert.equal(await page.locator('.reward-choice-card').count(),3);
        assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth),'level reward modal fits the viewport');
        if(i===0){
          assert.equal(await page.locator('#rewardRerollButton').isDisabled(),false);
          assert.equal(await page.locator('#rewardRerollButton').getAttribute('title'),'문제를 맞히면 새로고침 · 1회');
          await page.locator('#rewardRerollButton').click();
          await page.evaluate(()=>requestRewardReroll('answer',{selectedAnswer:'1',selectedChoiceIndex:'1'}));
          await page.evaluate(()=>finishRewardReroll());
          assert.equal(await page.locator('#rewardRerollButton').isDisabled(),true);
          assert.equal(await page.locator('.reward-choice-card').first().getAttribute('data-reward-id'),'d');
        }
        if(i===0 && process.env.LEVEL_REWARD_SCREENSHOT_DIR)await page.screenshot({path:process.env.LEVEL_REWARD_SCREENSHOT_DIR+'/level-reward-'+width+'.png'});
        await page.keyboard.press(String(i+1));await page.keyboard.press('Enter');
        if(i===0)await page.waitForFunction(()=>currentView.battle.player.baseStats.levelProgress.skillRewards.length===1);
      }
      await page.evaluate(()=>window.rewards);
      assert.deepEqual(await page.evaluate(()=>currentView.availableSkills.map(s=>s.skillId)),['d','b']);
      assert.equal(await page.evaluate(()=>currentView.battle.stage.stage),2,'claiming a level reward does not advance the stage');
      assert.equal(await page.locator('#rewardModal').getAttribute('aria-hidden'),'true');
      await page.evaluate(()=>renderFloorIntermissionActions());
      assert.deepEqual(await page.locator('#actionPanel > button').allTextContents(),['휴식회복','경험치 획득','스킬 강화']);
      assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));
      await page.locator('#floorExperienceButton').click();
      assert.equal(await page.evaluate(()=>currentQuestionView.isFloorExperience),true);
      await page.evaluate(()=>submitQuestionAnswerOnServer({elapsedMs:6500,wrongCountAfterTimeout:0,giveUp:false}));
      assert.equal(await page.locator('#questionMessage').textContent(),'경험치 +85');
      await page.evaluate(()=>{window.selected=null;selectRewardChoice=id=>{window.selected=id;finishFloorExperienceSelection({message:'저장 오류'});};requestQuestionResultProceed();});
      assert.equal(await page.evaluate(()=>window.selected),'floor_rest_experience');
      assert.equal(await page.evaluate(()=>currentView.floorExperienceAnswer.elapsedMs),6500);
      assert.equal(await page.locator('#questionSubmitButton').textContent(),'경험치 반영 재시도');
      assert.equal(await page.locator('#questionSubmitButton').isDisabled(),false);
      await page.evaluate(()=>{selectRewardChoice=()=>finishFloorExperienceSelection();requestQuestionResultProceed();});
      assert.equal(await page.evaluate(()=>currentQuestionView),null);
      assert.equal(await page.evaluate(()=>floorIntermissionActionPending),false);
      assert.deepEqual(errors,[]);
      await page.close();
    }
    console.log('Level rewards browser checks passed: queued claims, unchanged stage, three rest actions, efficiency XP, desktop/mobile.');
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
