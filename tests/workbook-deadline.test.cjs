const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const path = require('node:path');
const root = path.resolve(__dirname, '..');
const read = name => fs.readFileSync(path.join(root, name), 'utf8');
function serverContext() {
  let now = Date.parse('2026-10-06T05:30:00Z');
  class ClockDate extends Date {
    constructor(...args) { super(...(args.length ? args : [now])); }
    static now() { return now; }
  }
  const context = vm.createContext({ Date: ClockDate, console });
  for (const file of ['Constants.gs', 'WorkbookService.gs', 'BattleService.gs']) vm.runInContext(read(file), context);
  context.setNow = value => { now = value; };
  return context;
}
function clientContext() {
  const c = vm.createContext({ localVictoryPendingResponse: null, Math, String, Number, isFinite, performance: { now: () => 0 } });
  const html = read('Battle.html');
  for (const name of ['formatWorkbookCountdown', 'forceWorkbookDeadlineDefeat', 'applyWorkbookPlayWindow', 'updateWorkbookCountdown', 'saveWorkbookDeadlineResult']) {
    const match = html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'));
    assert.ok(match, name);
    vm.runInContext(match[0], c);
  }
  return c;
}

test('deadline boundary is inclusive and no deadline permits play', () => {
  const c = serverContext();
  assert.equal(c.buildWorkbookPlayWindow_({}).expired, false);
  assert.equal(c.buildWorkbookPlayWindow_({ playEndsAt: '2026-10-06T05:30:01Z' }).expired, false);
  assert.equal(c.buildWorkbookPlayWindow_({ playEndsAt: '2026-10-06T05:30:00Z' }).expired, true);
  assert.equal(c.buildWorkbookPlayWindow_({ playEndsAt: '2026-10-06T05:29:59Z' }).expired, true);
});

test('Korean editor time becomes UTC, empty clears limit, invalid input is rejected', () => {
  const c = serverContext();
  assert.equal(c.normalizeWorkbookPlayEndsAt_('2026-10-06T14:30:00+09:00'), '2026-10-06T05:30:00.000Z');
  assert.equal(c.normalizeWorkbookPlayEndsAt_(''), '');
  assert.throws(() => c.normalizeWorkbookPlayEndsAt_('14:30'));
  assert.throws(() => c.normalizeWorkbookPlayEndsAt_('2026-99-06T14:30:00+09:00'));
  assert.equal(c.normalizeWorkbookPayload_({ workbookName: 'test' }).playEndsAt, undefined);
});

test('new starts and active run requests use fresh workbook deadline', () => {
  const c = serverContext();
  const workbook = { workbookId: 'w', status: 'active', playEnabled: true, playEndsAt: '' };
  c.getCurrentPlayer_ = () => ({ playerId: 'p' });
  c.ensureTableColumns_ = () => {};
  c.toBoolean_ = Boolean;
  c.findRowByKey_ = () => workbook;
  c.requireWorkbook_ = () => workbook;
  c.getRunWorkbookContext_ = () => ({ workbookId: 'w' });
  assert.equal(c.canStartWorkbookPlay('token', 'w').allowed, true);
  workbook.playEndsAt = '2026-10-06T05:30:00Z';
  assert.equal(c.canStartWorkbookPlay('token', 'w').allowed, false);
  assert.throws(() => c.requireActiveWorkbookForRunStart_('w'), /종료/);
  assert.throws(() => c.requireRunBeforeWorkbookDeadline_({}), /종료/);
});

test('expired victory is saved as defeat with accumulated monster score and retry is idempotent', () => {
  const c = serverContext();
  let saves = 0, awards = 0, totalScore = 1255;
  const battle = { battleId: 'b', status: 'active', player: { hp: 20 }, monsters: [] };
  const stage = { battle, scoreState: {} };
  const run = { runId: 'r', playerId: 'p', status: 'active', score: totalScore };
  Object.assign(c, {
    ensureTableColumns_: () => {}, getCurrentPlayer_: () => ({ playerId: 'p' }), requireRun_: () => run,
    getStageState_: () => stage, getRunWorkbookContext_: () => ({ workbookId: 'w' }),
    getWorkbookPlayWindow_: () => ({ expired: true }),
    normalizeBattleStateEffects_: () => {}, normalizeBattleMonsters_: () => {},
    mergeMonsterScoreStateForCommit_: () => {}, mergeQuestionReactionScoreStateForCommit_: () => {},
    normalizeUsedQuestionIds_: () => {}, mergeUsedQuestionIds_: () => [], mergeStageFallbackEvents_: () => [],
    awardCommittedMonsterScoreIfNeeded_: (_, state, result) => {
      awards++;
      totalScore += result.monsterScoreState.monsterScore;
      state.scoreState.monsterScore = result.monsterScoreState.monsterScore;
    },
    flushQueuedBattleAnswerLogs_: () => {},
    saveStageState_: (_, state, result) => {
      saves++; run.status = 'failed'; run.score = totalScore; stage.battle = result; return run;
    },
    buildStageResultCommitView_: () => ({ score: totalScore, battle: stage.battle }),
  });
  const payload = { runId: 'r', battle: { battleId: 'b', status: 'victory', player: { hp: 20 }, monsters: [], monsterScoreState: { monsterScore: 230 } }, answerLogs: [], stageState: {} };
  const result = c.commitStageResultUnlocked_(payload, 'token');
  assert.equal(result.battle.status, 'defeat');
  assert.equal(result.battle.player.hp, 0);
  assert.equal(result.score, 1485);
  assert.match(result.battle.lastMessage, /종료 시간/);
  assert.equal(c.commitStageResultUnlocked_(payload, 'token').score, 1485);
  assert.equal(saves, 1); assert.equal(awards, 1);
});

test('countdown uses ceil seconds, reaches 00:00, and supports more than 59 minutes', () => {
  const c = clientContext();
  assert.equal(c.formatWorkbookCountdown(0), '00:00');
  assert.equal(c.formatWorkbookCountdown(1), '00:01');
  assert.equal(c.formatWorkbookCountdown(90000), '01:30');
  assert.equal(c.formatWorkbookCountdown(3600000), '60:00');
});

test('deadline defeat retains score and closes pending action', () => {
  const c = clientContext();
  const view = { score: 1485, battle: { status: 'active', player: { hp: 10, shield: 5 }, pendingAction: {} }, showReward: true, rewardView: {} };
  c.forceWorkbookDeadlineDefeat(view);
  assert.equal(view.score, 1485); assert.equal(view.battle.status, 'defeat');
  assert.equal(view.battle.player.hp, 0); assert.equal(view.battle.pendingAction, null);
  assert.equal(view.showReward, false);
});

test('same clock response cannot rewind timer and zero remaining triggers expiry', () => {
  const c = clientContext();
  let elapsed = 0, expired = 0;
  const value = { textContent: '' };
  const timer = { classList: { toggle() {} } };
  Object.assign(c, {
    workbookClockRevision: 0, workbookClockServerMs: 0, workbookClockPerformanceMs: 0,
    workbookDeadlineMs: 0, defeatSequenceStarted: false,
    document: { getElementById: id => id === 'workbookCountdown' ? timer : value },
    performance: { now: () => elapsed }, expireWorkbookPlay: () => { expired++; },
  });
  c.applyWorkbookPlayWindow({ serverNowMs: 1000, endsAtMs: 3000 });
  assert.equal(value.textContent, '00:02');
  elapsed = 1000;
  c.applyWorkbookPlayWindow({ serverNowMs: 1000, endsAtMs: 3000 });
  c.updateWorkbookCountdown(); assert.equal(value.textContent, '00:01');
  elapsed = 2000;
  c.updateWorkbookCountdown(); assert.equal(value.textContent, '00:00'); assert.equal(expired, 1);
});

test('expiry waits for an in-flight victory save before saving defeat', () => {
  const c = clientContext(); let scheduled;
  Object.assign(c, {
    workbookDeadlineSaved: false, workbookDeadlineSaveScheduled: false, stageResultCommitInFlight: true,
    currentView: { battle: { player: {} } }, window: { setTimeout: fn => { scheduled = fn; } },
    commitStageResultIfNeeded: () => { throw Error('must wait'); },
  });
  c.saveWorkbookDeadlineResult();
  assert.equal(c.workbookDeadlineSaveScheduled, true);
  c.stageResultCommitInFlight = false;
  c.buildOutcomeContext = () => ({}); c.refreshOutcomeResult = () => {};
  c.commitStageResultIfNeeded = success => success();
  scheduled(); assert.equal(c.workbookDeadlineSaved, true);
});

test('expired stale stage payload cannot award an already saved previous battle again', () => {
  const c = serverContext();
  const serverBattle = { battleId: 'new-battle', stage: { floor: 1, stage: 2 }, player: {}, monsters: [] };
  const payload = { runId: 'r', battle: { battleId: 'old-battle', stage: { floor: 1, stage: 1 }, monsterScoreState: { monsterScore: 230 } }, answerLogs: [{ questionId: 'q' }] };
  const sanitized = c.sanitizeWorkbookDeadlinePayload_(payload, { currentFloor: 1, currentStage: 2 }, { battle: serverBattle });
  assert.equal(sanitized.battle, serverBattle);
  assert.equal(sanitized.answerLogs.length, 0);
  assert.equal(sanitized.battle.monsterScoreState, undefined);
});

test('countdown monitor is started on battle entry and deployment excludes local tests', () => {
  const html = read('Battle.html');
  const initial = html.match(/    function applyInitialBattleView\([^]*?\n    \}/)[0];
  assert.match(initial, /initializeBattleView\(view\)/);
  const initialization = html.match(/    function initializeBattleView\([^]*?\n    \}/)[0];
  assert.match(initialization, /startWorkbookDeadlineMonitor\(\)/);
  assert.match(html, /getRunPlayWindow\(getAuthToken\(\), currentView.runId\)/);
  assert.match(read('.claspignore'), /tests\/\*\*/);
});

test('deadline defeat next opens final score, confirm returns to home button', () => {
  const elements = new Map();
  function element(id) {
    if (!elements.has(id)) {
      const classes = new Set();
      elements.set(id, {
        classList: { add: x => classes.add(x), remove: x => classes.delete(x), contains: x => classes.has(x) },
        setAttribute() {}, closest() { return this; }, focus() {}, insertAdjacentHTML() {},
      });
    }
    return elements.get(id);
  }
  const c = vm.createContext({
    workbookDeadlineExpired: true,
    currentOutcomeContext: { scoreSummary: { scoreDelta: 230, totalScore: 1485, showDetailedBreakdown: true } },
    document: { getElementById: element },
    normalizeClientScoreSummary: x => x, clearScoreAnimation() {},
    buildScoreBreakdownRows: () => [], buildScoreMetaRows: () => [],
    queueScoreAnimation() {},
    preloadNextBattleAfterReward() { throw Error('final outcome must not preload another battle'); },
    closeScoreModal() { element('scoreModal').classList.remove('active'); },
    buildOutcomeContext: () => ({}),
  });
  for (const name of ['showScoreModal', 'confirmScoreModal', 'showOutcomeScoreDetails', 'completeOutcomeScoreDetails']) {
    const fn = read('Battle.html').match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];
    vm.runInContext(fn, c);
  }
  element('defeatOverlay').classList.add('active');
  element('defeatHomeButton').classList.add('hidden');
  assert.equal(c.showScoreModal({}, { nextBattlePending: true }), false);
  assert.equal(element('defeatOverlay').classList.contains('active'), true);
  c.showOutcomeScoreDetails();
  assert.equal(element('scoreModal').classList.contains('active'), true);
  assert.equal(element('defeatOverlay').classList.contains('active'), false);
  c.confirmScoreModal();
  assert.equal(element('scoreModal').classList.contains('active'), false);
  assert.equal(element('defeatOverlay').classList.contains('active'), true);
  assert.equal(element('defeatHomeButton').classList.contains('hidden'), false);
});

test('direct time edit only updates deadline, validates owner and allows clearing', () => {
  const c = serverContext();
  let patch, releases = 0;
  const workbook = { workbookId: 'w', createdBy: 'teacher', status: 'active', workbookName: 'original', playEnabled: true };
  Object.assign(c, {
    requireWorkbookManager_: () => ({ player: { playerId: 'teacher' } }),
    LockService: { getScriptLock: () => ({ waitLock() {}, releaseLock() { releases++; } }) },
    ensureTableColumns_() {}, findRowByKey_: () => workbook,
    updateRowByKey_: (_, __, ___, update) => { patch = update; return { ...workbook, ...update }; },
    clearTableCache_() {}, toClientObject_: x => x,
  });
  const saved = c.setWorkbookPlayEndsAt('token', 'w', '2026-10-06T14:30:00+09:00');
  assert.equal(saved.workbook.playEndsAt, '2026-10-06T05:30:00.000Z');
  assert.deepEqual(Object.keys(patch).sort(), ['playEndsAt', 'playTimeLimitEnabled', 'updatedAt']);
  assert.equal(saved.workbook.workbookName, 'original');
  assert.equal(saved.workbook.playEnabled, true);
  assert.equal(c.setWorkbookPlayEndsAt('token', 'w', '').workbook.playEndsAt, '');
  workbook.createdBy = 'another-teacher';
  assert.throws(() => c.setWorkbookPlayEndsAt('token', 'w', ''), /자신이 만든/);
  assert.equal(releases, 3);
});

test('management switch replaces summary and reveals settings only when enabled', () => {
  const html = read('WorkbookManagement.html');
  const c = vm.createContext({ Date, isFinite });
  for (const name of ['formatKoreaDateTimeInput', 'isWorkbookTimeLimitEnabled']) {
    vm.runInContext(html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0], c);
  }
  assert.equal(c.formatKoreaDateTimeInput('2026-10-06T05:30:00Z'), '2026-10-06T14:30');
  assert.equal(c.isWorkbookTimeLimitEnabled({ playEndsAt: 'date' }), true);
  assert.equal(c.isWorkbookTimeLimitEnabled({ playEndsAt: 'date', playTimeLimitEnabled: false }), false);
  assert.ok(!html.includes('wm-play-window-summary'));
  assert.ok(html.includes('role="switch"'));
  assert.ok(html.includes('<span>까지</span>'));
  assert.ok(html.includes('hidden = !toggle.checked'));
});

test('disabling deadline retains its timestamp but stops expiry, re-enabling restores it', () => {
  const c = serverContext();
  c.toBoolean_ = value => value === true || String(value).toLowerCase() === 'true';
  const workbook = { playEndsAt: '2026-10-06T05:30:00Z', playTimeLimitEnabled: false };
  assert.equal(c.buildWorkbookPlayWindow_(workbook).endsAtMs, 0);
  assert.equal(c.buildWorkbookPlayWindow_(workbook).expired, false);
  workbook.playTimeLimitEnabled = true;
  assert.equal(c.buildWorkbookPlayWindow_(workbook).expired, true);
});
