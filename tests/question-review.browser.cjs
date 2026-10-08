const {chromium} = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
const assert = require('node:assert/strict');
const battle = fs.readFileSync('Battle.html','utf8');
const styles = fs.readFileSync('UiStyles.html','utf8');
const extract = name => battle.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const modal = battle.slice(battle.indexOf('  <div id="questionModal"'),battle.indexOf('  <div id="rewardModal"'));
const script = `var currentQuestionView={question:{questionId:'q'},resultHolding:true};
var currentView={playerId:'p'},questionUnderstandingRatings={},questionUnderstandingPending={},questionUnderstandingLoadKey='',questionResultProceedRequested=false;
var pendingTurnResolutionActive=true,questionResultProceedRequested=false;
var getSelectedWorkbookId=()=> 'w',getAuthToken=()=> 'auth';
var getQuestionSelectionStats=()=>({correctCount:3,totalCount:10});
var runQuestionStats={},getRunQuestionStats=id=>runQuestionStats[id]||(runQuestionStats[id]={}),saveRunQuestionStats=()=>{};
var storage=new Map();var localStorage={getItem:k=>storage.get(k)||null,setItem:(k,v)=>storage.set(k,v)};
var google={script:{run:new Proxy({},{get(){throw Error('unexpected RPC');}})}};`;
const html = '<!doctype html><html><head><meta name="viewport" content="width=device-width,initial-scale=1">'+styles+'</head><body>'+modal+'<script>'+script+
 ['renderQuestionAccuracy','resetQuestionUnderstanding','showQuestionUnderstanding','getQuestionUnderstandingStorageKey','readQuestionUnderstandingStore','writeQuestionUnderstandingStore','getPendingQuestionUnderstanding','acknowledgeQuestionUnderstanding','chooseQuestionUnderstanding'].map(extract).join('\n')+'</script></body></html>';
(async()=>{
  const browser=await chromium.launch({channel:'msedge',headless:true});
  const output=fs.mkdtempSync(path.join(os.tmpdir(),'question-review-'));
  try {
    const page=await browser.newPage();
    const errors=[];page.on('pageerror',e=>errors.push(e.message));
    for (const [width,height] of [[1000,1000],[390,844],[360,640]]) {
      await page.setViewportSize({width,height});await page.setContent(html);
      await page.evaluate(()=>{
        document.getElementById('questionModal').classList.add('active');
        document.getElementById('questionPrompt').textContent='다음 영단어의 뜻은? conclude';
        document.getElementById('questionAnswerArea').innerHTML='<label class="question-choice">1. 결론짓다</label><label class="question-choice">2. 변화시키다</label>';
        renderQuestionAccuracy({questionId:'q'});resetQuestionUnderstanding();showQuestionUnderstanding();
      });
      assert.match(await page.locator('#questionAccuracy').innerText(),/30%.*10회/);
      await page.locator('[data-rating="2"]').click();
      assert.equal(await page.locator('[data-rating="2"]').isDisabled(),false);
      assert.equal(await page.locator('#questionSubmitButton').isDisabled(),false);
      assert.equal(await page.evaluate(()=>questionUnderstandingRatings.q),2);
      assert.equal(await page.evaluate(()=>getPendingQuestionUnderstanding()[0].rating),2);
      await page.locator('[data-rating="3"]').click();
      assert.equal(await page.locator('[data-rating="3"]').getAttribute('aria-pressed'),'true');
      assert.equal(await page.evaluate(()=>questionUnderstandingRatings.q),3);
      assert.equal(await page.locator('#questionSubmitButton').innerText(),'확인');
      assert.equal(await page.evaluate(()=>document.documentElement.scrollWidth>innerWidth),false);
      const bounds=await page.locator('#questionUnderstanding').boundingBox();
      assert.ok(bounds.x>=0 && bounds.x+bounds.width<=width);
      await page.screenshot({path:path.join(output,width+'.png')});
      console.log('Question review UI OK:',width,height);
    }
    assert.deepEqual(errors,[]);console.log('Screenshots:',output);
  } finally {await browser.close();}
})().catch(error=>{console.error(error);process.exitCode=1;});
