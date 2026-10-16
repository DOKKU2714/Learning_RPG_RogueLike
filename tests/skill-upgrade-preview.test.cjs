const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const html = fs.readFileSync('Battle.html', 'utf8');
const extract = name => html.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];
function setup() {
  const c = vm.createContext({ currentView: { battle: { player: { stats: { attack: 10, defense: 2 } } } },
    getClientEffectiveStats: player => player.stats, escapeHtml: text => String(text),
  });
  for (const name of ['buildSkillUpgradeChangeSummary', 'getSkillDisplayMetrics', 'getClientSkillUpgradeValue',
    'safeJsonParseClient', 'evaluateSkillDisplayFormula', 'escapeRegExpClient', 'getSkillPreviewDamageRange',
    'getSkillFormulaDamageRange', 'getSkillEffectDisplayMetrics', 'getSkillTagBonusDisplayMetrics',
    'getSkillDisplayShield', 'getSkillRuleDisplayShield', 'collectSkillRuleShieldFormulas',
    'appendSkillRuleShieldFormula', 'getSkillPreviewShieldValue', 'getSkillDisplayHeal',
    'getSkillDisplayHealPercent', 'getSkillHitCount']) vm.runInContext(extract(name), c);
  return c;
}
test('fixed descriptions show actual damage increase across multiple upgrade levels', () => {
  const c = setup();
  const skill = { type: 'damage', baseValue: 5, description: '적에게 피해를 입힙니다.', upgradeJson: '{"damage":3}' };
  const result = c.buildSkillUpgradeChangeSummary({ ...skill, level: 2 }, { ...skill, level: 4 });
  assert.match(result, /피해 18 → 24 \(\+6\)/);
});
test('formula-based shields and hit counts display increases', () => {
  const c = setup();
  const skill = { type: 'shield', baseValue: 5, upgradeJson: '{"effect":4}',
    effectJson: '{"shieldFormula":"base+defense+effectUpgrade","hitCount":"1+n"}' };
  const result = c.buildSkillUpgradeChangeSummary({ ...skill, level: 1 }, { ...skill, level: 2 });
  assert.match(result, /방어막 7 → 11 \(\+4\)/);
  assert.match(result, /타수 1회 → 2회 \(\+1회\)/);
});
test('cached effect details still expose configured buff and debuff upgrades', () => {
  const c = setup();
  const skill = { type: 'buff', effectDetails: [{ name: '힘', value: 3, chance: 100 }],
    upgradeJson: '{"buffValue":2,"debuffChance":5}' };
  const result = c.buildSkillUpgradeChangeSummary({ ...skill, level: 1 }, { ...skill, level: 2 });
  assert.match(result, /버프 수치 강화 0 → 2 \(\+2\)/);
  assert.match(result, /디버프 확률 강화 0% → 5% \(\+5%\)/);
});
test('unchanged values omit the summary and damage ranges show both endpoints', () => {
  const c = setup();
  assert.equal(c.buildSkillUpgradeChangeSummary({ level: 1 }, { level: 2 }), '');
  const skill = { type: 'damage', effectJson: '{"damageFormula":"1d6+n*2"}' };
  const result = c.buildSkillUpgradeChangeSummary({ ...skill, level: 1 }, { ...skill, level: 2 });
  assert.match(result, /최소 피해 1 → 3 \(\+2\)/);
  assert.match(result, /최대 피해 6 → 8 \(\+2\)/);
});

test('implicit multiplication in upgrade formulas matches actual skill calculations', () => {
  const c = setup();
  const skill = { type: 'damage', effectJson: '{"damageFormula":"attack+5+2n"}' };
  const result = c.buildSkillUpgradeChangeSummary({ ...skill, level: 1 }, { ...skill, level: 2 });
  assert.match(result, /피해 15 → 17 \(\+2\)/);
  assert.equal(c.evaluateSkillDisplayFormula('attack*(1+0.1n)', {attack:10,n:2}, 'max'), 12);
});

test('victory refresh preserves the upgraded level after reward choices are sanitized', () => {
  const c = setup();
  const source = fs.readFileSync('RewardService.gs', 'utf8');
  const skill = { skillId:'strike', name:'Strike', type:'damage', baseValue:5, upgradeJson:'{"damage":3}' };
  Object.assign(c, {
    DB_SHEETS: {SKILLS:'Skills'}, REWARD_TYPES: {SKILL:'skill',SKILL_UPGRADE:'skillUpgrade',REST:'rest'},
    findCachedRowByKey_: () => skill,
    hydrateSkill_: (definition, level) => ({...definition, level}),
    buildRewardSkillPreviewBattleState_: () => ({}),
    buildSkillCooldownText_: () => '', buildSkillUseLimitText_: () => '', getRarityLabel_: () => '',
    buildSkillEffectDetails_: () => [], buildSkillPreviewText_: () => '',
    previewStageClearRegen_: () => ({amount:0,nextHp:30,maxHp:30}),
    buildScorePreviewSummaryForRewardView_: () => ({}),
  });
  for (const name of ['buildRewardSkillDetail_', 'refreshPreparedRewardView_']) {
    vm.runInContext(source.match(new RegExp('function ' + name + '\\([^]*?\\n\\}'))[0], c);
  }
  for (const [ownedLevel, increment] of [[1,1],[2,2],[5,1]]) {
    const reward = {type:'skillUpgrade',targetId:'strike',value:increment};
    reward.skillDetail = c.buildRewardSkillDetail_({...reward,level:ownedLevel+increment}, {});
    const view = {choices:[reward]};
    // Prepared rewards are refreshed again when the victory callback arrives.
    c.refreshPreparedRewardView_({}, {battle:{}}, view);
    c.refreshPreparedRewardView_({}, {battle:{}}, view);
    const after = view.choices[0].skillDetail;
    assert.equal(after.level, ownedLevel+increment);
    const summary = c.buildSkillUpgradeChangeSummary({...after,level:ownedLevel}, after);
    assert.ok(summary.includes('(+' + (3*increment) + ')'));
  }
});
