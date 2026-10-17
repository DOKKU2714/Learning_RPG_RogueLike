# 몬스터 공격 이펙트 설정

기본공격은 `Monsters.attackEffect`, 스킬은 `Skills.attackEffect`를 사용합니다.
`MonsterAI.attackEffect`와 `MonsterAI.skillAttackEffect`는 더 이상 전투 설정에 사용하지 않습니다.

| 값 | 연출 |
| --- | --- |
| slash | 긁기 / 베기 |
| blunt | 둔탁한 타격 |
| thrust | 찌르기 |
| fire | 화염 |
| none | 공격 이펙트 생략 |

빈칸이면 기본공격과 피해형 스킬은 `slash`, 나머지 스킬은 `none`입니다.
회복·방어막·버프 전용 연출, 피해량 숫자, 치명타와 방어 피드백은 별도로 유지됩니다.
지속 피해에는 긁기 효과를 추가하지 않습니다.
같은 스킬 ID는 플레이어와 몬스터가 같은 `Skills` 행을 공유합니다.

## 기존 시트 적용

코드 업로드 후 Apps Script 편집기에서 `migrateMonsterAttackEffects()`를 한 번 실행합니다.
이 함수는 필요한 컬럼을 추가하고, 새 설정이 빈 셀에만 기존 AI 설정을 복사합니다.
동일 몬스터/스킬의 기존 AI 설정이 서로 다르거나 지원하지 않는 값이면 복사하지 않고
실행 로그의 `conflicts`에 기록합니다. 해당 ID는 새 컬럼에 직접 값을 지정합니다.
이관 결과를 확인한 뒤 기존 AI 컬럼은 삭제할 수 있습니다. `DB_COLUMNS.MONSTER_AI`에서도
제외했으므로 DB 초기화 시 다시 생기지 않습니다. 함수 재실행은 기존 설정을 덮어쓰지 않습니다.

### 시트 정리 — 2026-10-16

- `Monsters!N1:N18`에 `attackEffect` 컬럼과 몬스터 17종의 기본공격 이펙트를 등록했습니다.
  기존 AI별 공격 설정을 옮겼으며, `punch`는 지원 값인 `blunt`로 통일했습니다.
- `Skills!Q2:Q65`는 스킬별 이펙트 설정입니다. 기존 설정을 유지하면서 `punch` 17건을
  `blunt`로, `thurst` 오타 1건을 `thrust`로 수정했고, 이펙트가 없는 스킬은 `none`으로 명시했습니다.
- 두 이펙트 컬럼에 `slash / blunt / thrust / fire / none` 입력 검증을 설정했습니다.
- 기존 `MonsterAI!I:I`의 `attackEffect`는 이관 후 삭제했습니다. `skillAttackEffect` 컬럼은
  실제 시트에 없었습니다. AI 패턴의 나머지 8개 컬럼과 23개 행은 유지했습니다.
- 삭제 전 값과 변경 계획은 로컬 `outputs/monster-attack-effects-sheet-before.json`에 보관했습니다.

클라이언트에 전달하는 `monsterAiRules.skillAttackEffect`는 `Skills`에서 만들어지는 파생값으로,
시트의 옛 컬럼과는 별개이므로 유지합니다.

예: `Monsters.attackEffect=blunt`인 몬스터가 `Skills.attackEffect=fire`인 스킬을 쓰면
기본공격에는 타격, 그 스킬에는 화염이 표시됩니다. 변경 후 게임을 새로 시작하여 데이터 스냅샷을 갱신합니다.
