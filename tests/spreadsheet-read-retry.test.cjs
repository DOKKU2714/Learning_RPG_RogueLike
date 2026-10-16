const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');

function setup(failures) {
  const sleeps = [];
  let reads = 0;
  const values = [['stageId', 'name'], ['stage_1_1', 'First stage']];
  const sheet = {
    getLastRow: () => 2,
    getLastColumn: () => 2,
    getRange: () => ({ getValues() {
      const failure = failures[reads++];
      if (failure) throw failure;
      return values;
    } }),
  };
  const context = vm.createContext({ Utilities: { sleep: ms => sleeps.push(ms) } });
  vm.runInContext(fs.readFileSync('Database.gs', 'utf8'), context);
  context.getSheet_ = () => sheet;
  return { context, sleeps, reads: () => reads };
}

test('stage table read recovers from transient INTERNAL errors without replaying a reward', () => {
  const g = setup([new Error('스프레드시트에서 읽는 중 서버 오류가 발생했습니다. 오류 코드: INTERNAL')]);
  const rows = g.context.readTableUncached_('Stages');
  assert.equal(rows[0].stageId, 'stage_1_1');
  assert.equal(g.reads(), 2);
  assert.deepEqual(g.sleeps, [250]);
});

test('persistent server errors stop after three read attempts and preserve the error', () => {
  const error = new Error('Internal error');
  const g = setup([error, error, error]);
  assert.throws(() => g.context.readTableUncached_('Stages'), e => e === error);
  assert.equal(g.reads(), 3);
  assert.deepEqual(g.sleeps, [250, 750]);
});

test('permission errors are returned immediately', () => {
  const error = new Error('Permission denied');
  const g = setup([error]);
  assert.throws(() => g.context.readTableUncached_('Stages'), e => e === error);
  assert.equal(g.reads(), 1);
  assert.deepEqual(g.sleeps, []);
});

test('successful reads add no delay', () => {
  const g = setup([]);
  assert.equal(g.context.readTableUncached_('Stages').length, 1);
  assert.equal(g.reads(), 1);
  assert.deepEqual(g.sleeps, []);
});
