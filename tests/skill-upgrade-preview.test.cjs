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
