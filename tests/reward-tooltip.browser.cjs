const { chromium } = require(process.env.PLAYWRIGHT_MODULE || 'playwright');
const fs = require('node:fs');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const battle = fs.readFileSync('Battle.html', 'utf8');
const styles = fs.readFileSync('UiStyles.html', 'utf8');
const extract = name => battle.match(new RegExp('    function ' + name + '\\([^]*?\\n    \\}'))[0];
const preview = vm.createContext({ escapeHtml: text => String(text), getRewardRarityLabel: () => '일반',
  getSkillActionPointCost: () => 1, buildRewardSkillDetailLines: () => '',
  buildSkillDetailDescription: () => '적에게 피해를 입힙니다.',
  getClientSkillUpgradeValue: (skill, key) => key === 'damage' ? (skill.level - 1) * 3 : 0,
  getSkillDisplayMetrics: skill => ({ damage: 15 + (skill.level - 1) * 3,
    minDamage: 15 + (skill.level - 1) * 3, maxDamage: 15 + (skill.level - 1) * 3 }),
});
for (const name of ['renderSkillActionPointGauge', 'renderSkillUpgradeCompareDetailCard', 'renderSkillUpgradeComparePanel', 'buildSkillUpgradeChangeSummary'])
  vm.runInContext(extract(name), preview);
const upgradeCard = preview.renderSkillUpgradeCompareDetailCard({ value: 1,
  skillDetail: { name: '강화 공격', level: 2 } }, 'common', '강화 공격');

(async () => {
  const browser = await chromium.launch({ channel: 'msedge', headless: true });
  try {
    const page = await browser.newPage({ viewport: { width: 1366, height: 768 } });
    await page.setContent('<!doctype html><html><head>' + styles + '</head><body>' +
      '<div id="rewardModal" class="active"><div id="rewardChoices" class="reward-choice-grid" style="margin-top:300px">' +
      ['a', 'b', 'c'].map((id, i) => '<button class="reward-choice-card" data-reward-id="' + id + '">' +
        '<span class="reward-choice-heading">Reward ' + id + '</span>' +
        (i === 1 ? upgradeCard : '<span class="reward-detail-card">Description ' + id + '</span>') + '</button>').join('') +
      '</div><button id="rewardConfirmButton">Confirm</button><div id="rewardMessage"></div></div>' +
      '<script>var selectedRewardId="",rewardSelectionApplying=false,workbookDeadlineExpired=false,confirmations=0;' +
      'function confirmRewardChoice(){confirmations++;}' + extract('selectRewardCandidate') + extract('handleRewardKeyboard') +
      'document.addEventListener("keydown",handleRewardKeyboard);</script></body></html>');
    for (const [key, id] of [['1', 'a'], ['2', 'b'], ['3', 'c'], ['1', 'a']]) {
      await page.keyboard.press(key);
      await page.waitForTimeout(180);
      assert.equal(await page.evaluate(() => selectedRewardId), id);
      for (const candidate of ['a', 'b', 'c']) {
        const state = await page.locator('[data-reward-id="' + candidate + '"]').evaluate(card => ({
          focused: card.matches(':focus-visible'),
          opacity: getComputedStyle(card.querySelector('.reward-detail-card')).opacity,
        }));
        assert.equal(state.focused, candidate === id);
        assert.equal(state.opacity, candidate === id ? '1' : '0');
      }
    }
    await page.locator('[data-reward-id="b"]').hover();
    await page.waitForTimeout(180);
    assert.match(await page.locator('.reward-upgrade-changes').innerText(), /피해 15 → 18 \(\+3\)/);
    assert.equal(await page.locator('.reward-upgrade-changes').evaluate(el => getComputedStyle(el.closest('.reward-detail-card')).opacity), '1');
    assert.equal(await page.evaluate(() => confirmations), 0);
    await page.keyboard.press('Enter');
    assert.equal(await page.evaluate(() => confirmations), 1);
    console.log('Reward keyboard tooltips OK: 1/2/3, upgrade comparison, switching, Enter');
  } finally {
    await browser.close();
  }
})().catch(error => { console.error(error); process.exitCode = 1; });
