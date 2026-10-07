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

## Complex skill audit — 2026-10-07

Read the live `Skills` (39 definitions) and `Effects` tabs in the spreadsheet configured by `CONFIG.SPREADSHEET_ID`. The reference was read only; its definitions are captured in `tests/fixtures/live-skill-definitions.json` for reproducible tests.

Browser skill execution, availability, reactive effects, and turn effect processing now call the shipped server functions in `LearningRpgLocalRunEngine`, using the downloaded game-data snapshot. This restores cooldown modification and `onUse`/reactive rules without adding server requests or duplicating kill scoring.

| Skill | Verified behavior / correction |
| --- | --- |
| 흡수 | Three hits; healing uses actual shield/HP damage, excludes overkill, and applies efficiency once. |
| 신중한 방어 | Gains shield and reduces another active skill cooldown. |
| 올인 | Uses all remaining AP, including item/skill-modified maxima; requires at least one AP. |
| 흉내내기 | Copies the selected enemy's shield and buff stacks, retaining remaining turn duration. |
| 비상탈출 | Its own wrong answer or a later wrong answer/HP damage causes defeat; the penalty expires after the current turn, including end-of-turn damage. |
| 모 아니면 도 | Maximum AP increases for the battle; the next turn refills to the new maximum; difficulty persists through the battle. |
| 가시 방패 | Reflects blocked damage to the attacking monster, with kill scoring preserved. |
| 마무리 타격 | Uses preceding strike counts; multi-hit skills count as one use. |

Additional fixes cover `(진) 타격` AP formulas, `고통 감내` player-turn reactions, `타격의 달인` bonuses in the browser, random targets per hit for `무지성 타격`, implicit multiplication in `범위 타격`'s `2n` formula, and excluding non-upgradable skills from upgrade rewards. A narrow compatibility fallback repairs the malformed legacy `마구 찌르기` JSON only when its stored JSON cannot be parsed; valid sheet edits take precedence.

Run `node --test tests/*.test.cjs` to check the skill regressions alongside battle UI, rewards, sessions, and persistence. Changes are local source changes and require Apps Script deployment to affect the live game.
