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
