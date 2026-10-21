const {test}=require('node:test'),assert=require('node:assert/strict'),fs=require('node:fs'),vm=require('node:vm');
const html=fs.readFileSync('Battle.html','utf8');
const extract=name=>html.match(new RegExp('    function '+name+'\\([^]*?\\n    \\}'))[0];

test('skill rows show runtime cooldowns and exhausted uses independently of action points',()=>{
 const c=vm.createContext({currentView:{battle:{skillCooldowns:{cooling:2}}},getSkillUseLimitText:s=>s.useLimitText || ''});
 vm.runInContext(extract('getSkillListStatusText'),c);
 assert.equal(c.getSkillListStatusText({skillId:'cooling',unavailableReason:'행동력이 부족합니다.'}),'2턴 남음');
 assert.equal(c.getSkillListStatusText({unavailableReason:'쿨타임 1턴 남았습니다.'}),'1턴 남음');
 assert.equal(c.getSkillListStatusText({useLimitText:'사용 가능 횟수: 전투 0/3회'}),'횟수 소진');
 assert.equal(c.getSkillListStatusText({unavailableReason:'이번 전투에서 더 이상 사용할 수 없습니다.'}),'횟수 소진');
 assert.equal(c.getSkillListStatusText({useLimitText:'전투 2/3회',unavailableReason:'행동력이 부족합니다.'}),'');
});

test('stage HUD displays the current base difficulty rather than skill or effect modifiers',()=>{
 const elements={battleStageText:{},battleStageDifficulty:{}};
 const noop=()=>{};
 const c=vm.createContext({MAX_QUESTION_DIFFICULTY:5,isPlayerTurn:true,document:{getElementById:id=>elements[id]},
  normalizeBattleView:v=>v,getDisplayFloorParts:f=>({floorLabel:f+'층'}),isFloorIntermissionBattle:()=>false,
  isDefaultPlayerTurnPrompt:()=>true,renderBattleBackground:noop,renderMonsters:noop,renderPlayerHud:noop,
  renderCombatActions:noop,renderSkills:noop,renderActionTooltips:noop,updateBattleQuickAccess:noop,
  setPlayerTurn:noop,updateBattleInputLockState:noop,prepareBattleRewardsInBackground:noop});
 vm.runInContext(extract('renderBattle')+'\n'+extract('renderDifficultyStars'),c);
 for(const difficulty of [1,3,5]){
  c.renderBattle({battle:{stage:{floor:2,stage:4,baseDifficulty:difficulty,questionDifficultyBonus:2},status:'active'}});
  assert.equal(elements.battleStageText.textContent,'2층 4스테이지');
  assert.equal((elements.battleStageDifficulty.innerHTML.match(/class="difficulty-star"/g)||[]).length,difficulty);
 }
});
