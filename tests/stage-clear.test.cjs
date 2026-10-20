const test = require('node:test'), assert = require('node:assert/strict');
const fs = require('node:fs'), vm = require('node:vm');
const html = fs.readFileSync('Battle.html', 'utf8');
const extract = name => html.match(new RegExp('    (?:async )?function ' + name + '\\([^]*?\\n    \\}'))[0];

test('clear banner and sound happen once and rewards wait until the banner finishes', async () => {
  const events = [], timers = [];
  const c = vm.createContext({ stageClearPresentation: null,
    currentView: { battle: { status: 'victory' } }, workbookDeadlineExpired: false,
    victoryRewardFlowStarted: false, victoryRewardRecoveryComplete: false,
    getVictoryRewardKey: () => 'run:battle:stage',
    showTurnBanner: text => events.push(text),
    window: { LEARNING_RPG_AUDIO: { playReward: () => events.push('sound') }, setTimeout: (fn, ms) => timers.push({fn, ms}) },
    buildStageResultPayload: () => ({}), preloadVictoryRewardChoices: () => null,
    presentStageClearRegen: () => { events.push('regen'); return {alreadyApplied: true}; },
    showPreparedVictoryReward: () => events.push('reward'),
  });
  for (const name of ['presentStageClear', 'openRewardAfterVictory']) vm.runInContext(extract(name), c);
  c.openRewardAfterVictory();
  c.openRewardAfterVictory();
  assert.deepEqual(events, ['STAGE CLEAR', 'sound']);
  assert.equal(timers.length, 1);
  assert.equal(timers[0].ms, 1200);
  timers[0].fn();
  await Promise.resolve();
  assert.equal(events.filter(x => x === 'regen').length, 1);
  assert.equal(events.filter(x => x === 'sound').length, 1);
  assert.ok(events.indexOf('reward') > events.indexOf('sound'));
});

test('turn playback waits for clear presentation before level and item rewards', () => {
  const playback = extract('playTurnSequence');
  const clear = playback.indexOf('await presentStageClear()');
  assert.ok(clear >= 0);
  assert.ok(clear < playback.indexOf('await presentLevelStatAllocation(currentView)'));
  assert.ok(clear < playback.indexOf('await presentMonsterItemDrops(currentView)'));
});

test('kill XP defers stat rewards on victory while non-final kills still offer them', async () => {
  for (const status of ['victory','active']) {
    let offered=0;
    const nodes={playerExpTrack:{getBoundingClientRect:()=>({left:0,top:0,width:10,height:10})},playerExpFill:{style:{}},experienceGainText:{remove(){}}};
    const c=vm.createContext({deathRewardPresentation:{view:{battle:{status}},progress:{level:1,xp:7}},
      levelAllocationActive:false,workbookDeadlineExpired:false,
      document:{getElementById:id=>nodes[id]||null,querySelector:()=>null,createElement:()=>({style:{},setAttribute(){},remove(){}}),body:{appendChild(){}}},
      window:{innerWidth:1000,innerHeight:700,setTimeout:fn=>fn(),matchMedia:()=>({matches:true})},
      cssEscape:s=>s,renderPlayerExperience(){},playBattleSound(){},presentLevelUpFlash:()=>Promise.resolve(),presentLevelStatAllocation:()=>{offered++;return Promise.resolve();}});
    vm.runInContext(extract('animateExperienceRewards'),c);
    await c.animateExperienceRewards([{type:'experience',monsterId:'m',amount:1,before:{level:1,xp:7},after:{level:2,xp:0}}]);
    assert.equal(offered,status==='victory'?0:1,status);
  }
});
