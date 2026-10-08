const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('Battle.html', 'utf8');
function setup() {
  const choices = ['a', 'b', 'c', 'rest'].map(id => ({ disabled: false, getAttribute: () => id }));
  const selected = [], confirmed = [];
  let active = true, prevented = 0;
  const c = vm.createContext({ workbookDeadlineExpired: false, rewardSelectionApplying: false,
    document: { getElementById: () => ({ classList: { contains: () => active }, querySelectorAll: () => choices }) },
    selectRewardCandidate: id => selected.push(id), confirmRewardChoice: () => confirmed.push(true) });
  vm.runInContext(html.match(/    function handleRewardKeyboard\([^]*?\n    \}/)[0], c);
  return { c, choices, selected, confirmed, hide: () => { active = false; },
    get prevented() { return prevented; }, event: (key, extra = {}) => ({ key, target: {}, preventDefault: () => prevented++, ...extra }) };
}
test('reward numbers select displayed cards; only Enter confirms through the existing flow', () => {
  const x = setup();
  for (const key of ['1', '2', '3', '4']) assert.equal(x.c.handleRewardKeyboard(x.event(key)), true);
  assert.deepEqual(x.selected, ['a', 'b', 'c', 'rest']);
  assert.equal(x.confirmed.length, 0);
  x.c.handleRewardKeyboard(x.event('Enter'));
  assert.equal(x.confirmed.length, 1);
  assert.equal(x.prevented, 5);
});
test('hidden modal, typing and modified keys do not select rewards', () => {
  const x = setup();
  for (const extra of [{ isComposing: true }, { ctrlKey: true }, { target: { tagName: 'INPUT' } }, { target: { isContentEditable: true } }]) {
    assert.equal(x.c.handleRewardKeyboard(x.event('1', extra)), false);
  }
  x.hide();
  assert.equal(x.c.handleRewardKeyboard(x.event('Enter')), false);
  assert.equal(x.selected.length + x.confirmed.length, 0);
});
test('repeated and locked inputs are consumed without duplicate selection or confirmation', () => {
  const x = setup();
  x.c.handleRewardKeyboard(x.event('Enter', { repeat: true }));
  x.c.rewardSelectionApplying = true;
  x.c.handleRewardKeyboard(x.event('1'));
  x.c.handleRewardKeyboard(x.event('Enter'));
  x.c.rewardSelectionApplying = false;
  x.c.workbookDeadlineExpired = true;
  x.c.handleRewardKeyboard(x.event('Enter'));
  assert.equal(x.confirmed.length + x.selected.length, 0);
  assert.equal(x.prevented, 4);
});
