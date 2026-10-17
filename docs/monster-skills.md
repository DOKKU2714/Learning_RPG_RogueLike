# 학교 몬스터 스탯·스킬 적용

일반 12종은 스킬 2개씩, 보스 5종은 스킬 3개씩 사용한다. 몬스터 17개 ID는 기존 값을 유지한다.
데이터는 `scripts/build-monster-pack.cjs`에 수록했으며 `node scripts/build-monster-pack.cjs`로
검증용 `tests/fixtures/monster-pack.json`을 다시 만들 수 있다. 게임 실행 시에는 이 파일의
하드코딩 값을 읽지 않고 **원본 시트와 게임 시작 시 생성한 데이터 스냅샷**을 읽는다.

## 수동 시트 반영

엑셀: `outputs/monster-skills-2026-10-17/monster-skills.xlsx`

1. 수정된 Apps Script 코드와 HTML을 업로드하고, 웹 앱이 새 코드 버전을 사용하도록 배포한다.
2. `Monsters`의 같은 `monsterId` 17개 행을 엑셀 값으로 수정한다. 다른 행은 보존한다.
3. `Skills`에 `ms_`로 시작하는 39개 행을 추가한다. 이미 같은 ID가 있다면 수정하고 중복 추가하지 않는다.
   기존 플레이어 스킬은 삭제하지 않는다.
4. `MonsterAI`에 `ai_monster_kit` 행 하나를 추가한다. 다른 AI 행은 보존한다.
5. Apps Script에서 `validateMonsterSkillSheets()`를 실행한다.
   이 팩만 있다면 `{ok:true, monsters:17, skills:39, errors:[]}`가 정상이다.
   함수는 데이터 값을 변경하지 않으며, 새 게임에 최신 값을 읽도록 정의 캐시를 비운다.
6. 새 게임을 시작한다. 진행 중인 게임의 서명된 데이터 스냅샷은 유지된다.

시트의 열 순서가 다르면 **헤더 이름으로 맞춰서** 복사한다. 엑셀의 `Skills` 열 순서는
기존 로컬 시트 기록에 맞췄으나 실제 원본에서 확인해야 한다. 헤더는 첫 행에 둔다.
`Effects`, `EffectRules`, `Stages`, `MonsterGroups`의 추가·삭제는 필요 없다.
스탯과 스킬 데이터는 엑셀의 `Monsters`, `Skills`, `MonsterAI`에서 복사하며,
`사용안내`는 게임 데이터 시트로 복사하지 않는다.

## 설정 위치

| 설정 | 실제 동작을 결정하는 셀 |
| --- | --- |
| 체력·공격력·재생·회피·치명률·치명피해·방어 | `Monsters`의 해당 컬럼 |
| 보유 스킬 | `Monsters.skillIds` JSON 배열 |
| 행동 조건·배율·부가 효과 | `Skills.effectJson.monsterSkill` |
| 일반 연타 횟수 | `Skills.hitCount` |
| 기본공격 연출 | `Monsters.attackEffect` |
| 스킬 연출 | `Skills.attackEffect` |
| 플레이어 보상에서 제외 | `Skills.rewardEnabled=FALSE` |

스킬 이름·설명은 표시용이다. 효과를 바꾸면 설명도 함께 맞춘다.
이 팩은 몬스터 전용이므로 플레이어용 `cooldown`, `actionPointCost`, `baseValue` 대신
`monsterSkill`의 주기·행동을 사용한다. `MonsterAI`의 확률은 이 팩의 행동 주기를 덮어쓰지 않는다.
기존 `monsterSkill` 설정이 없는 몬스터와 이전 게임 스냅샷은 종전 AI 처리를 사용한다.

```json
{
  "monsterSkill": {
    "trigger": "action",
    "every": 3,
    "actions": [
      {"op": "damage", "multiplier": 0.8},
      {"op": "stat", "target": "player", "stat": "attack", "mode": "percent", "value": -15, "durationTurns": 2, "requiresHit": true}
    ]
  }
}
```

위 예는 3번째 몬스터 행동마다 공격력 80% 피해를 주고, 적중 시 플레이어 공격력을 2턴간 15% 낮춘다.
`every=4`, `multiplier=1.2`, `durationTurns=1`로 바꾸면 다음 새 게임에서 그 값대로 적용된다.

### 트리거

| trigger | 발동 시점 |
| --- | --- |
| action | 자신의 행동 주기. `every`, `firstAction`, `priority`, `once` 지원 |
| battleStart | 첫 행동 예고를 만들 때 한 번. 행동 소비 없음 |
| hpBelow | 자기 턴 시작 시 `hpBelowPercent` 이하이면 한 번. 행동 소비 없음 |
| onDamaged | 살아 있는 상태에서 직접 공격 피해를 받았을 때 |
| onEvade | 플레이어 직접 공격을 회피했을 때. `oncePerTurn` 지원 |
| onBasicHit | 일반 공격이 적중해 실제 피해를 줬을 때 |
| onCritical | 공격이 치명타로 적중해 실제 피해를 줬을 때 |
| afterSkill | `afterSkillId`의 스킬 사용 직후 |

`chargeTurns=1`이면 준비하는 행동을 한 번 쓴 뒤 다음 행동에 공격한다.
`restTurns=1`이면 사용 후 한 행동을 쉰다. 휴식은 행동 횟수에 포함된다.
기절·빙결로 막힌 행동은 행동 횟수를 증가시키지 않고 충전 상태도 유지한다.
주기 스킬이 충돌하면 **기존 충전 → 휴식 → priority 내림차순 → 일반 공격** 순서로 선택한다.
동일 우선순위면 `skillIds` 순서가 우선이다. 밀린 스킬은 다음 가능한 행동에 사용하고
원래의 주기를 유지한다. 첫 사용이 3회째인 `every=3`은 3·6·9·12회째가 기준이다.

### 효과

| op | 주요 값 |
| --- | --- |
| damage | `multiplier`, 선택적 고정 피해 `value`, `shieldPiercePercent` |
| stat | `stat`, `value`, `mode=flat/percent`, 선택적 `durationTurns` |
| dot | `target=player`, `value`, `durationTurns` |
| reduction | `value` 감소율, `nextHit`, 선택적 `hpAbovePercent` |
| heal | 회복량 `value`, 최대 HP를 넘지 않음 |
| shield | 보호막 `value`, 소진될 때까지 유지 |
| overrideSkill | 대상 `skillId`, 새 `multiplier`, 새 `hitCount` |

대상은 기본적으로 몬스터 자신이다. `target=player`로 플레이어에게 적용한다.
`requiresHit=true`인 부가 효과는 앞선 공격이 한 번 이상 적중했을 때만 적용한다.
`perUse=true`, `maxStacks=5`인 stat은 사용 횟수에 따라 증가하되 최대 5회분으로 제한한다.

## 전투 규칙과 기획 조정

- 회피·치명률은 백분율 포인트다. `criticalDamage=150`은 공격력의 150%다.
- 연타는 각 타격마다 회피·치명타·방어막을 개별 처리한다. 대상이나 공격자가 죽으면 남은 타격은 멈춘다.
- HP 절반 조건은 정확히 50%도 포함한다. 자기 턴 시작에 현재 HP로 확인하며 피격 중이나
  행동 예고 계산에서는 발동하지 않는다. 행동 불가 상태여도 턴 시작 조건은 확인한다.
  죽은 몬스터는 발동하지 않고, 재부팅으로 체력이 다시 올라가도 재발동하지 않는다.
- 버프·약화는 적용 턴에는 지속시간을 차감하지 않는다. 2턴 효과는 적용 시점부터 다음 두 턴 종료까지 유지된다.
- 저주·출혈·분진은 다음 플레이어 턴 시작부터 지정 횟수만큼 HP 피해를 준다. 같은 효과는 중첩하지 않고
  갱신하며, 몬스터가 죽어도 전투가 계속되는 동안 유지된다. 새 전투에는 옮겨가지 않는다.
- 피해 감소는 직접 공격에만 적용한다. 다음 공격 감소 효과는 첫 적중 1타에 소비한다.
- 근접 기본공격과 물리 스킬은 녹슨 파편 반사를 받는다. `ranged`, `spell` 태그 또는
  `attackEffect=fire`인 스킬은 원거리로 취급한다. 반사는 치명타·회피 판정을 하지 않으며 재반사하지 않는다.
- 기존 방어 계산을 유지한다. 방어력은 방어막 생성에 쓰이고 직접 피해에서 차감하지 않는다.
  따라서 귀신의 방어 무시는 **피해의 50%가 방어막 관통**으로 구현했다.
- 일반 몬스터 2~3마리 동시 등장 시 기존 HP·공격력 보정은 유지된다.
- 오래된 컴퓨터의 기본 HP 재생은 0이다. 양수로 바꾸면 행동 가능한 자신의 행동 직전에 회복한다.
- 인체모형 보호막은 기존 일회성 방어막과 달리 턴 종료/시작에 제거되지 않고 실제로 소모된 양만 감소한다.

## 검증

`node --test --test-name-pattern="monster pack" tests/monster-pack.test.cjs`

17종/39스킬 발동, 서버·브라우저 동일 결과, 상태 직렬화, 충전·휴식, 체력 조건의 1회 발동,
반격 제한, 근접 판정, 회복, 관통, 지속 피해 만료, 보호막 유지, 주기 충돌,
최종 보스 변신과 공격 증가 상한, 시트 수치·연타·연출 수정 반영, 가져온 데이터 검사를 확인한다.

전체 기존 테스트도 실행했으며, 실패 항목은 수정 전 코드로 재현해 신규 회귀와 구분했다.
원본 Google Sheets 입력과 실제 웹 앱 배포 후 플레이 검증은 아직 수행하지 않았다.

엑셀 재생성은 번들 Node 런타임과 `@oai/artifact-tool` 패키지를 연결한
`.tmp_spreadsheet/monster-pack/node_modules`가 있는 상태에서
`node scripts/export-monster-workbook.mjs`로 실행한다.
