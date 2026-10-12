const test = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const { context, start, copy } = require('./run-session.test.cjs');
const lines = fs.readFileSync('docs/skill-packs/new-skills-2026-10-12.tsv', 'utf8').trim().split(/\r?\n/);
const headers = lines.shift().split('\t');
const skills = lines.map(line => {
  const cells = line.split('\t');
  assert.equal(cells.length, headers.length);
  const row = Object.fromEntries(headers.map((key, i) => [key, cells[i]]));
  for (const key of ['conditionJson', 'effectJson', 'upgradeJson', 'tags']) JSON.parse(row[key]);
  return row;
});
test('the eight paste-ready skills execute identically on server and local engine', () => {
  const x = context();
  x.seed(x.c.DB_SHEETS.SKILLS, skills);
  const snapshot = start(x).gameDataSnapshot;
  const engine = vm.runInNewContext(x.c.getLocalRunEngineSource_(), { Date: x.c.Date, Math: x.c.Math });
  const initial = { battleId: 'pack', status: 'active', turn: 1, stage: { floor: 1, stage: 1 },
    player: { hp: 30, maxHp: 100, shield: 0, stats: { hp: 100, attack: 10, defense: 2, accuracy: 100, criticalRate: 0 }, effects: [],
      baseMaxActionPoint: 3, maxActionPoint: 3, currentActionPoint: 3 },
    monsters: ['a', 'b'].map(instanceId => ({ instanceId, monsterId: instanceId, currentHp: 200, maxHp: 200,
      attack: 10, defense: 0, evasion: 0, shield: 10, effects: [] })),
    usedSkillCountByTagThisTurn: { strike: 2 }, lastTurnEvents: [] };
  for (const definition of skills) for (const level of [1, 3]) {
    const skill = x.c.hydrateSkill_(definition, level);
    const server = copy(initial), browser = copy(initial);
    x.c.applySkillEffect(server, { ...skill, targetId: 'a' }, 1, true);
    engine.skill(snapshot, browser, skill, 'a', 1, true);
    assert.ok(server.lastTurnEvents.some(e => e.skillId === skill.skillId), skill.name);
    if (skill.skillId !== 'skill_dice_storm') {
      assert.deepEqual(copy(browser.lastTurnEvents), copy(server.lastTurnEvents), skill.name);
      assert.equal(browser.player.hp, server.player.hp);
      assert.equal(browser.player.shield, server.player.shield);
    } else {
      for (const battle of [server, browser]) {
        const hits = battle.lastTurnEvents.filter(e => e.type === 'skill');
        assert.equal(hits.length, 2);
        assert.ok(hits.every(e => e.damage >= 6 + 2 * (level - 1) && e.damage <= 16 + 2 * (level - 1)));
      }
    }
    assert.ok(!server.lastTurnEvents.some(e => e.type === 'ruleWarning'), skill.name);
    const hit = server.lastTurnEvents.find(e => e.type === 'skill');
    if (skill.skillId === 'skill_blood_wager') { assert.equal(server.player.hp, 25); assert.equal(hit.damage, 18 + 3 * (level - 1)); }
    if (skill.skillId === 'skill_comeback_punch') assert.equal(hit.damage, Math.round(25.5 + 3 * (level - 1)));
    if (skill.skillId === 'skill_shield_cracker') assert.equal(hit.damage, 14 + 2 * (level - 1));
    if (skill.skillId === 'skill_combo_receipt') assert.equal(hit.damage, 16 + 2 * (level - 1));
    if (skill.skillId === 'skill_catch_breath') { assert.equal(server.player.hp, 38 + 3 * (level - 1)); assert.equal(server.player.shield, 5 + 2 * (level - 1)); }
    if (skill.skillId === 'skill_perfect_finish') assert.equal(hit.damage, 2 * (11 + 3 * (level - 1)));
  }
});
