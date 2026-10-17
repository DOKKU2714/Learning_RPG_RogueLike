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

## 동기부여 최소 효율 — 2026-10-16

동기부여는 다음 문제의 최대 효율 50% 증가(기본 125% → 187.5%)에 더해,
최소 효율을 50%p 올립니다(기본 50% → 100%). 첫 오답과 시간 만료 시의
기본 효율도 100%이며, 기존 추가 오답 감점과 포기 시 0% 처리는 유지합니다.
문제를 처리하면 최대·최소 효율 증가가 함께 소모되며, 재사용해도 중첩되지 않습니다.

`EffectRules`의 `buff_motivation`에 두 번째 규칙을 추가합니다:
`passive / modifyStat / questionMinEfficiencyPercent / flat / value*stacks`.
서버와 브라우저는 같은 규칙에서 최소 효율 증가량을 읽고 아이템의 증가량과 합산합니다.
최소 효율의 기존 100% 상한은 유지합니다. 일반 전투 능력치에는 이 값을 넣지 않습니다.

게임 DB의 `Skills!F43`, `Effects!N20` 설명과 `EffectRules!A29:I29`를 함께 갱신했습니다.
적용하려면 수정한 Apps Script 코드를 배포해야 합니다. 이미 진행 중인 게임은
시작 시 고정한 스냅샷을 사용하므로 새 게임에서 갱신된 효과 정의를 받습니다.

검증: `tests/support-skills.test.cjs`의 동기부여·최소 효율 테스트와
`tests/effects-schema-v2.test.cjs`, `tests/new-items.test.cjs`의 관련 회귀 검사.

## 보상 새로고침과 카드 빛 연출 — 2026-10-16

새로고침 문제 선정은 미풀이 문제를 계속 제외하되, 아직 시트에 정산되지 않은
현재 게임의 답안 기록도 합산합니다. 이미 서버에 반영한 전투는 중복 집계하지 않고,
전투 중 미리 만든 보상 계획도 승리 확정 시 최신 답안으로 출제 가능 여부를 갱신합니다.
이 과정은 승리·회복·보상 지급을 미리 확정하지 않습니다.

출제할 문제가 없으면 새로고침 기회를 소모하지 않고 사유를 표시합니다.
출제 실패나 통신 오류 시 기존 카드와 선택 상태를 유지하며 등장 연출을 재생하지 않습니다.
정답 후 다시 뽑는 일반 보상은 이전 카드의 종류·대상·수치와 겹치지 않게 합니다.
층 정비의 고정 휴식 선택지, 이미 지급한 통화·재생, 스테이지당 1회 제한은 유지합니다.

카드 빛은 회전 없이 중심에서 대칭으로 확장하고, 약 110ms 동안 빠르게 수축한 뒤
약 600ms 동안 중앙 잔광이 사라집니다. 서버와 클라이언트 코드를 함께 배포한 뒤
열린 게임 페이지도 새로고침해야 수정된 출제와 응답 처리를 사용합니다.

## 크록스 — 2026-10-16

실제 Items!D20 크록스 방어력 효과의 valut=3 오타를 value=3으로 수정했습니다.
단일 보유 시 방어력 +3·회피율 +5, 중복 보유 시 개수 합산을 검증했습니다.
진행 중 게임은 시작 시 데이터 스냅샷을 사용하므로 최신 데이터 적용에는 새 게임이 필요합니다.
