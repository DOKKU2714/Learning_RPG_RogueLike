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
기존 AI 컬럼은 참고용으로 남으며 삭제하지 않습니다. 함수 재실행은 기존 설정을 덮어쓰지 않습니다.

예: `Monsters.attackEffect=blunt`인 몬스터가 `Skills.attackEffect=fire`인 스킬을 쓰면
기본공격에는 타격, 그 스킬에는 화염이 표시됩니다. 변경 후 게임을 새로 시작하여 데이터 스냅샷을 갱신합니다.
