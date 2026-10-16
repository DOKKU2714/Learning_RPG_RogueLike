# Effects / EffectRules v2

The live `Effects` sheet now holds shared effect identity, defaults and lifetime
settings. `EffectRules` holds one or more behavior rows per effect. This is a
structural migration: it deliberately preserves the game calculations that
existed immediately before the change.

## Editing effects

Use `Effects!A:N` for normal authoring:

| Column | Meaning |
| --- | --- |
| effectId / name / category | Stable ID, display name, buff/debuff |
| baseValue | Default `value` supplied to rule formulas; skill overrides still take precedence |
| durationType / durationTurns | Existing turn/stage/battle/question lifetime and default turns |
| stackMode / maxStacks | `add` or `replace`, and the stack cap |
| reapplyDurationPolicy | `max`, `refresh`, `extend`, or `keep` when adding stacks |
| durationClock | `turns` counts down turns; `stacks` uses stacks as the remaining lifetime |
| decayTiming / decayStacks | `none`, `onTrigger`, or `turnEnd`, and the amount consumed |
| decrementOnApplyTurn | Whether the application turn counts toward expiration |
| description | Display description |

The hidden `O:U` columns are `rulesVersion` and the six original behavior
columns. Set `rulesVersion=2` for a new effect. The original fields remain intact
so the currently deployed code can continue reading the sheet during rollout.
Once the new code is deployed, edit `baseValue` and `EffectRules` for v2 effects.
Do not delete the compatibility fields while an older deployment still uses them.

For a new effect, add its ID to both sheets. `EffectRules` columns are:

| Column | Meaning |
| --- | --- |
| effectId / ruleOrder | Parent ID and unique positive integer order within that effect |
| triggerTiming | Event at which this rule applies |
| operation | `modifyStat`, `damage`, `blockAction`, `damageTakenMultiplier`, or `removeOnHit` |
| statKey | Attribute affected by a `modifyStat` rule |
| valueMode | `flat` adds an amount; `percent` multiplies by `1 + amount/100` |
| valueFormula | Game expression using `value`, `stacks`, `maxHp`, and `remainingTurns` |
| shieldPolicy | `absorb` or `bypass` for damage |
| description | Optional authoring note |

Formulas are literal strings, not spreadsheet formulas starting with `=`.
`value` is the instance's effective value, including skill overrides. `stacks`
is applied by a formula exactly once; the engine does not multiply a rule's
result by stacks again. Use `value*stacks` for a normal stacking modifier or `1`
for a constant modifier. Probabilities represented by `flat` use percentage
points; question time uses seconds.

Supported timing names preserve existing call sites:

- `passive`: stat modifiers and action blocking.
- `turnStart`, `turnEnd`, `onAction`: the existing timed-effect callbacks.
- `beforeAction`: stack damage before control checks, including bleed on a
  monster that cannot act.
- `beforeMonsterTurn`: the existing monster-burn callback, before monster shields
  are cleared in the server turn flow. It is intentionally not a new player-burn event.
- `onHit`: the existing frozen-damage multiplier/removal callback.

Stat rules require `passive`; hit modifier/removal rules require `onHit`.
Stack-clock damage consumes `decayStacks` once after the last damage rule at the
same event when `decayTiming=onTrigger`. Damage is rounded and clamped to at
least 1, exactly as existing stacked damage was.

The initial migration intentionally keeps several quirks:

- Empty damage `value` cells remain zero. The minimum-damage clamp still applies.
- Caffeine adds **3 percentage points** to question efficiency and **0.3 seconds**
  per stack, matching the code rather than the old description.
- `debuff_foolish` adds exactly one difficulty and keeps its special saved-state
  normalization. `debuff_foolish_99` remains a separate, normally scaling effect.
- `sleek` is preserved as a stat key; it is not silently changed to `evasion`.
- DOT rows retain their old passive HP-stat projection as a second rule. This
  matters when a skill supplies a nonzero value and must not be removed as cleanup.
- Existing ID references, turn ordering, saved-state normalization and old
  deployment fields remain compatible. This migration does not rebalance effects
  or move legacy turn callbacks.

## Runtime and rollout

`Database.readTable_(Effects)` validates and attaches ordered rules to v2
definitions. The compiled definitions and rule table are captured in the immutable
run snapshot. Browser battle rules use that same snapshot; cache eviction and
intermediate stage transitions do not replace a running game's definitions.
Snapshots without v2 rules continue down the legacy path.

The live spreadsheet migration is already applied. Repository code must be
pushed/deployed through the project's normal Apps Script release process to
activate v2 authoring in the running web app. No Apps Script deployment was
changed as part of this task. Before that rollout, the hidden legacy columns
remain the deployed app's source of behavior. Avoid changing v2-only rules until
the new application version is active.

`seedMasterData` preserves already migrated v2 effects instead of overwriting
their settings with legacy defaults. New or unmigrated installations can still
load legacy definitions if the optional rule sheet is absent.

## Verification and recovery

`tests/fixtures/effects-schema-v2.json` records the 20 original live rows plus
the 20 migrated definitions and 27 rules. It preserves original IDs and values.
`scripts/migrate-effects-schema.cjs` rebuilds the migration from a JSON value
rectangle without making network writes.

Run the focused regression suite:

```powershell
node --test --test-name-pattern='^effects v2:' tests/effects-schema-v2.test.cjs
```

It compares legacy and v2 calculations for every live effect across stacks
1/3/99, explicit zero and positive/negative overrides, reapplication, damage,
shields, question modifiers and expiration. It also verifies the browser bundle,
snapshot pinning, new effect IDs and malformed rule rejection.

For rollback of application code, the original legacy columns already preserve
the old reader contract. To return the sheet to its exact pre-migration layout,
restore the `legacyEffects` data from the fixture in its original header order
or use Google Sheets version history. Do not replace unrelated sheets or player
progress when rolling back effect definitions.
