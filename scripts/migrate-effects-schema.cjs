// Build a reviewable migration from an exported Effects value rectangle.
// This script never writes to Google Sheets or deploys Apps Script.
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const root = path.resolve(__dirname, '..');
const c = vm.createContext({console});
for (const name of ['Constants.gs', 'SharedRuleEngine.gs']) {
  vm.runInContext(fs.readFileSync(path.join(root, name), 'utf8'), c, {filename:name});
}
const input = process.argv[2], output = process.argv[3];
if (!input || !output) throw new Error('Usage: node scripts/migrate-effects-schema.cjs <values.json> <migration.json>');
const [headers, ...rows] = JSON.parse(fs.readFileSync(input, 'utf8'));
const legacyEffects = rows.filter(row => row[0]).map(row => Object.fromEntries(headers.map((header, i) => [header, row[i] ?? ''])));
const engine = c.getSharedRuleEngine_();
const migrated = engine.migrateLegacyEffectDefinitions(legacyEffects);
engine.compileEffectDefinitions(migrated.effects, migrated.rules);
const result = {
  source:'https://docs.google.com/spreadsheets/d/1FgaAkjv-2h-bBqBgC9SzmOqjLJDgyFOoqBxKwdaIUF4/edit',
  legacyEffects,
  effectHeaders:Array.from(c.DB_COLUMNS.EFFECTS),
  ruleHeaders:Array.from(c.DB_COLUMNS.EFFECT_RULES),
  effects:migrated.effects,
  rules:migrated.rules,
};
fs.writeFileSync(output, JSON.stringify(result, null, 2) + '\n');
console.log(`${result.effects.length} effects, ${result.rules.length} rules; legacy values preserved.`);
