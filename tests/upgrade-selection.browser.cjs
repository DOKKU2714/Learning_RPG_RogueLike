const {chromium}=require(process.env.PLAYWRIGHT_MODULE||'playwright');
const fs=require('node:fs'),assert=require('node:assert/strict');
const html=fs.readFileSync('Battle.html','utf8'),styles=fs.readFileSync('UiStyles.html','utf8');
const extract=name=>html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];
const script=`
var rewardSelectionApplying=false,selectedRewardId='',workbookDeadlineExpired=false,applied=0;
var currentRewardView={choices:[{rewardId:'up',type:'skillUpgrade',value:1,rarity:'rare',skillDetail:{name:'강화 스킬',level:3}}]};
function escapeHtml(s){return String(s)} function normalizeRewardRarity(s){return s}
function buildSkillUpgradeChangeSummary(){return '<span class="reward-upgrade-changes">피해 10 → 15</span>'}
function renderSkillUpgradeComparePanel(skill,reward,rarity,title,label){return '<strong>'+label+'</strong><span>Lv.'+skill.level+'</span>'}
function selectRewardChoice(){applied++}
${['selectRewardCandidate','showSkillUpgradePreview','cancelSkillUpgradePreview','renderSkillUpgradeCompareDetailCard','confirmRewardChoice'].map(extract).join('\n')}
`;
(async()=>{const browser=await chromium.launch({channel:'msedge',headless:true});try{
 for(const width of [1366,390]){
 const page=await browser.newPage({viewport:{width,height:1000}});
 await page.setContent('<html><head>'+styles+'</head><body><div id="rewardChoices"><button class="reward-choice-card" data-reward-id="up" onclick="selectRewardCandidate(\'up\')"><span class="reward-choice-heading">강화 스킬</span></button></div><div id="rewardUpgradePreview" class="reward-upgrade-preview" hidden></div><div class="reward-confirm-row"><button id="rewardUpgradeCancelButton" hidden onclick="cancelSkillUpgradePreview()">취소</button><button id="rewardConfirmButton" onclick="confirmRewardChoice()" disabled>확인</button></div><button id="rewardRerollButton"></button><div id="rewardMessage"></div><script>'+script+'</script></body></html>');
 await page.locator('.reward-choice-card').hover();assert.equal(await page.locator('#rewardUpgradePreview').isVisible(),false);
 await page.locator('.reward-choice-card').click();assert.equal(await page.locator('#rewardChoices').isVisible(),false);
 assert.equal(await page.locator('.reward-upgrade-panel').count(),2);
 assert.match(await page.locator('#rewardUpgradePreview').innerText(),/Lv.2/);assert.match(await page.locator('#rewardUpgradePreview').innerText(),/Lv.3/);
 assert.equal(await page.evaluate(()=>applied),0);
 await page.locator('#rewardUpgradeCancelButton').click();assert.equal(await page.locator('#rewardChoices').isVisible(),true);assert.equal(await page.evaluate(()=>selectedRewardId),'');
 await page.locator('.reward-choice-card').click();await page.locator('#rewardConfirmButton').click();assert.equal(await page.evaluate(()=>applied),1);
 assert.ok(await page.evaluate(()=>document.documentElement.scrollWidth<=innerWidth));await page.close();
 }
 console.log('Upgrade selection: click-only comparison, before/after cards, cancel and confirm passed on desktop/mobile.');
}finally{await browser.close()}})().catch(e=>{console.error(e);process.exitCode=1});
