# 스킬 시트 작성과 운영 반영

스킬 기획의 105개 플레이어 스킬을 Skills의 실행 JSON으로 작성했다. 스킬 ID에 따른 신규 코드 분기 없이 공통 규칙을 사용한다. 데이터 예시는 tests/fixtures/skill-rework-2026-10-17.json에 들어 있다.

## 운영에 적용하는 순서

1. 변경된 Apps Script 코드와 HTML을 함께 배포한다.
2. 수정된 엑셀의 Skills·Effects·EffectRules를 운영 시트에 반영한다. Skills의 기존 플레이어 스킬은 교체하고, 몬스터 AI나 Monsters.skillIds가 참조하는 전용 스킬 행은 남긴다. 해당 행은 rewardEnabled=0으로 설정한다.
3. Effects·EffectRules는 effectId 및 effectId+ruleOrder 기준으로 병합한다. 운영에서 별도로 추가한 상태 정의를 지우지 않는다. 엑셀에는 알려진 기존 몬스터·아이템 효과 20개도 호환용으로 포함했다. 출혈은 개편 플레이어 스킬에서 사용하지 않는다.
4. 반영 후 Apps Script에서 clearMasterTableCaches_()를 실행하고 새 런을 시작한다. 진행 중인 런은 시작할 때 서명한 데이터 스냅샷을 계속 사용하므로 도중에 규칙이 바뀌지 않는다.

엑셀만 교체하면 이전에 배포한 코드가 새 JSON을 해석하지 못한다. 이 작업에서는 로컬 코드와 원본 엑셀을 수정하며, 운영 Google Sheets 및 배포 버전은 자동으로 변경하지 않는다.

## 기존 열과 추가 항목

Skills의 기존 열 순서를 유지한다. effectJson에 actions와 combat을 작성하고, Effects의 마지막 선택 열 behaviorJson에 상태의 행동을 작성한다. EffectRules는 상태의 능력치·지속 피해·행동 차단 규칙이다. 빈 behaviorJson은 기존 동작을 유지한다.

| 위치 | 용도 |
| --- | --- |
| Skills.effectJson.damageFormula / shieldFormula | 공격·방어막 수식 |
| Skills.effectJson.applyEffects | 사용 완료 후 상태 부여 |
| Skills.effectJson.combat.onEachHit | 직접 공격이 명중한 각 타격 직후 상태 부여 |
| Skills.effectJson.actions | 순서가 있는 스택·피해·회복·선택·보상 동작 |
| Skills.effectJson.combat | 연계·체력 비용·이번 공격 판정·주사위 등 |
| Effects.behaviorJson.control | 빙결의 행동 스킵·피격 파괴·자연 해제 |
| Effects.behaviorJson.combat | 공격 강화·상태 피해 보정·치명타 횟수 등 |

n은 스킬 레벨−1이다. 고정 계수와 레벨 계수는 수식에서 바꾼다. 강화 불가 스킬은 conditionJson과 upgradeJson의 notUpgradable을 유지한다. 105개 모두 rewardEnabled=1이며 개별 강화 가능 여부는 별도로 검사한다.

## 수식과 타격 연계

기존 attack, defense, hp, maxHp, enemyHp, enemyMaxHp, enemyShield, efficiency에 다음 값을 추가했다.

| 변수 | 의미 |
| --- | --- |
| comboCount | 이번 턴 앞선 타격 공격 수와 사용할 수 있는 보존분 |
| comboDistinct | 이번 턴 앞선 서로 다른 타격 공격 수 |
| comboBattleBonus | 이번 전투 앞선 타격 공격 수, 최대 12 |
| poisonShield | 생존 적의 중독 합계, 최대 30 |
| targetPoison / targetCold / targetShock | 해당 대상의 현재 상태 스택 |
| poisonWeakPercent | 중독 스택당 −2%, 최대 −30% |
| consumedStacks / movedStacks | 현재 대상에서 실제 소모·이전한 양 |
| totalConsumedStacks | 앞선 동작에서 모든 대상으로부터 소모한 합계 |

combat.combo는 extraHitIfPrior, hitPerPrior, maxHits, requiredDistinct, distinctHitCount, resetAfter를 설정한다. 피해 수식이 있는 타격 스킬만 집계하고 유틸리티는 제외한다. 현재 스킬은 계산 뒤 집계한다. storeCombo로 저장한 최대 2회는 다음 턴 첫 타격 공격에만 적용하고, 서로 다른 스킬 수에는 포함하지 않는다.

## 순서가 있는 동작

actions는 기본 공격·기본 applyEffects 이후 실행한다. onUse/onCorrect/onWrong 또는 이벤트 안에도 넣을 수 있다. target을 생략하면 현재 대상이며 self, allEnemies, secondary를 명시할 수 있다.

| operation | 주요 필드 |
| --- | --- |
| damage | amount / amountFormula, damageKind |
| shield | amount / amountFormula, 선택 retainEffectId |
| heal | amount / amountFormula; 최대 체력 제한 |
| applyEffect | effectId, stacks, value / valueFormula, durationTurns, chance |
| removeEffect | effectId |
| consumeStacks | effectId, amount; 실제 소비량 기록 |
| moveStacks / copyStacks | effectId, amount; 플레이어가 보조 대상 선택 |
| spreadStacks | effectId, fraction, max; 원본을 다른 적 각각에 복사 |
| gatherStacks | effectId, fraction; 다른 적에서 지정 대상으로 이전 |
| distributeStacks | effectId, max; 체력이 낮은 순으로 균등 분배 |
| explosion | 소모량 기준 max, centerRate, otherRate, centerAddFormula |
| counterAttack | hitCount, amountFormula; 직접 공격과 별도 반격 |
| breakControl | 원격 빙결 파괴, otherwiseEffectId, otherwiseStacks |
| cooldownSelect | tag, amount; 쿨타임 중인 다른 보유 스킬 선택 |
| storeCombo / resetCombo | max 또는 턴 연계 초기화 |
| cleanseLongest | 가장 긴 해제 가능한 디버프 제거; 동률은 부여 순 |
| clearShield | 현재 방어막 및 출처별 유지량 제거 |
| rewardBonus | currencyPercent / extraChoices / jackpot |

각 동작에 requireStacks:{effectId,min}, requireEffect, excludeEffect를 추가할 수 있다. 이전은 수신 상한을 넘는 스택을 원본에 남긴다. 처치 전이의 수신 불가능한 잔여량은 소멸한다. 복사는 원본을 유지한다.

## 이벤트와 횟수 제한

기존 onDamaged/onBlock/onTurnStart/onTurnEnd에 onHit/onCritical/onMiss/onEvade/onKill/onEffectRemoved/onDamage/onBeforeMonsterTurn/onExplosion을 추가했다. actions로 후속 동작을 작성한다.

actor, damageKind, targetId, requireTargetEffect, selfTurnOnly로 발동 대상을 제한한다. maxActivations, maxActivationsPerTurn, oncePerTarget, oncePerAction으로 횟수를 제한한다. oncePerTarget은 턴별 대상 단위다. 같은 소스의 제한 이벤트 재등록은 중복 구독을 교체한다. 발동 횟수는 콜백 전에 확보하고 사망은 몬스터 인스턴스당 1회 기록한다.

피해 종류는 direct, dot, additional, shatter, explosion, reflect, counter, effect다. 직접 타격만 감전과 빙결 파괴를 유발한다. 전류·반격·폭발·파괴가 다시 감전을 발생시키지 않는다.

## 상태의 행동

behaviorJson.combat에서 다음 묶음을 사용할 수 있다.

| 항목 | 주요 설정 |
| --- | --- |
| outgoing | tag, kind, multiplier, addValue, uses; 다음 스킬의 모든 타격에 적용 |
| incomingMultiplier / retaliationMultiplier | 직접 피격 또는 결투 표적의 공격 배율 |
| critical | add, charges; 빗나가도 타격 시도마다 1회 소모 |
| criticalBank | max, perStack; 비치명 명중 적립·치명 명중 초기화 |
| random | reroll, uses, minMultiplier, maxMultiplier, floorRatio, badLuck |
| dot | effectId, multiplier, addValue, uses, preserveDecay, extraStacksFromValue, onNaturalZero |
| additional | effectId, multiplier, shieldMultiplier, uses |
| relay | effectId, ratio; 기본 감전 추가분 기준 전달 |
| preserveDecayEffect | 해당 효과의 다음 자연 스택 감소 보존 |
| blockShield / fatalGuard | 방어막 획득 금지 / 치명적인 직접 피해 1회 생존 |

자연 상태 피해 배율은 출처별 증가율을 더하고 최대 2배다. 도체와 과전압도 증가율을 합산한다. 절연 파괴의 증가분은 방어막에만 적용하며 체력으로 넘치지 않는다. 잔류독은 자연 감소만 감지하고 소비·이전에는 반응하지 않는다.

## 빙결·자기 빙결

control:{skipActions:1,breakOnDirectHit:true,stackEffectId:"effect_v2_chill",damagePerStack:5}는 다음 해당 몬스터 턴의 행동을 1회 건너뛰고 상태를 유지한다. 그다음 해당 몬스터 턴 시작에 자연 해제한다. 직접 공격이 먼저 명중하면 빙결을 해제하고 공격 전 냉기 스택당 파괴 피해를 준다. 냉기는 소모하지 않는다. 같은 턴의 중복 조회와 재부여로 해제 시점을 늘리지 않는다.

자기 빙결은 blockImmediately:true를 사용하고 breakOnDirectHit를 생략한다. retainShield:true와 shield 동작의 retainEffectId를 연결하면 그 출처의 방어막만 턴 전환을 넘어 유지된다. 자연 해제 시 잔여 방어막을 제거한다. healMissingFromValue:true는 value%의 잃은 체력을 1회 회복한다. 빙하의 관은 20+5*n%, 최대 100%다.

invulnerable:true는 직접·지속·반사 피해를 막는다. 상태 부여와 체력 비용은 별도로 처리하고, 무적 중에도 중독 스택은 자연 감소한다.

## 주사위와 보상

Skills.effectJson.combat.random에는 dice(1 또는 2), sides(2~20), attackPerPoint 또는 multipliers 배열, doublesMultiplier, criticalOnMax를 지정한다. 원래 눈을 기록하고, 재추첨으로 최종 피해가 더 큰 결과를 선택한 뒤 판돈 범위 및 운명 교환 하한을 적용한다. 미리보기는 가능한 눈을 열거하여 피해 범위를 표시한다.

황금 손길은 기본 전투 재화에 +20%를 한 번 더한다. 보물의 예감은 후보만 하나 늘린다. 잭팟은 시전 턴의 직접 치명타 2회와 승리를 요구하며 고유를 제외한 후보 하나만 한 단계 올린다. 미리 준비한 보상도 마지막 전투 상태로 갱신한다. 보너스 후보는 전투별로 안정적으로 선택하며 새로고침과 서명 재검증으로 중복 지급하지 않는다.

신규 스킬의 컨셉 가중치는 보유한 해당 컨셉 스킬 1개당 +0.5, 기본 가중치 대비 최대 3배다. 다른 컨셉의 가중치는 1을 유지한다. 등급 추첨과 강화 가능 여부는 기존 규칙을 따른다.

## 검증

tests/rework-skills.test.cjs는 105개 개별 결과를 서버와 내보낸 브라우저 엔진에서 각각 검사한다. 강화·지속시간·상태 조합·스택 상한·비용 거절·보상 예약 후 발동·서명된 지급 재생도 검사한다. tests/rework-selection.browser.cjs는 실제 숨김 브라우저에서 쿨타임 대상·보조 대상·취소 동작을 확인한다. 기존 common-combat, complex-skills, effects-schema-v2 테스트도 함께 실행한다.
