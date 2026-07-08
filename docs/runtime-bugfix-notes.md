# Runtime bugfix notes

## 타격의 달인

`skill_strike_master` uses `effectJson.onUse.tagBonus` to apply a battle-long damage bonus to tagged skills. The existing rule engine marked this as a rule-based skill but did not process `onUse.tagBonus`, so the skill could appear to resolve like a normal action without applying the intended buff.

The runtime patch registers `onUse.tagBonus` as `battleState.activeTagBonuses` and applies it only when later damage skills have the matching tag. It does not deal direct damage when the buff skill itself is used.

## 1-5 boss

The live spreadsheet had `Stages.floor_1_stage_5.bossMonsterId = boss_floor_1`, while the customized Monsters row is `boss_Door`. That caused runtime to fall back to the generic master boss row instead of the sheet boss data.

The live sheet was corrected to use `boss_Door`, and the code now also supports aliases for old IDs:

- `boss_floor_1 -> boss_Door`
- `boss_floor_2 -> boss_Ghost`

Run `auditStageBossMonsterReferences()` in Apps Script to find stale boss references in the sheet.
