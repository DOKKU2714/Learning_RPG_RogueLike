# 스킬과 효과 데이터 작성

- 스킬 추가·수정은 연결된 스프레드시트의 `Skills`, `Effects`, `EffectRules`를 최대한 사용한다.
- 효과 수식, 조건, 지속시간과 계수는 시트에서 관리한다. 코드에는 여러 스킬이 재사용할 수 있는 실행 기능만 추가한다.
- 일회성 피해·조건·자원 처리는 `Skills.effectJson`에 두고, 지속 상태나 후속 사건에 반응하는 효과만 `Effects`/`EffectRules`에 등록한다. 명중 저하·기절 등 기존 공통 효과를 재사용하고 스킬마다 불필요한 효과 행을 만들지 않는다.
- 새 규칙이 기존 코드와 중복되면 중복 정의를 제거하고 시트 정의를 기준으로 실행한다.
- 변경 후 서버와 클라이언트의 동작 일치 및 실제 시트에 저장된 값을 검증한다.

# 배포

- 코드 수정 요청은 운영 배포 권한을 포함하지 않는다. 사용자가 명시적으로 배포를 요청할 때만 업로드·버전 생성·배포를 수행한다.

<!-- code-review-graph MCP tools -->
## MCP Tools: code-review-graph

**This project has a knowledge graph. Start with the code-review-graph
MCP tools to narrow scope, then read the source.** The graph is cheaper than scanning files and
gives you structural context (callers, dependents, test coverage) that file search cannot.

### When to use graph tools FIRST

- **Exploring code**: `semantic_search_nodes_tool` or `query_graph_tool` instead of Grep
- **Understanding impact**: `get_impact_radius_tool` instead of manually tracing imports
- **Code review**: `detect_changes_tool` + `get_review_context_tool` instead of reading entire files
- **Finding relationships**: `query_graph_tool` with callers_of/callees_of/imports_of/tests_for
- **Architecture questions**: `get_architecture_overview_tool` + `list_communities_tool`

### Verify in the source

- Narrow scope with the graph, then read the source. Do not change code from graph output alone.
- For any non-trivial change, read the implementation and the relevant tests before concluding.
- Verify the exact source when touching behavior, database logic, migrations, retries, fallbacks,
  recovery, or compatibility code.
- When the graph and the source disagree, the source wins. The graph may be stale or may not
  model that relationship.
- An empty graph result can mean "not indexed" or "not statically visible", not "does not exist".

### Key Tools

| Tool | Use when |
| ------ | ---------- |
| `detect_changes_tool` | Reviewing code changes — gives risk-scored analysis |
| `get_review_context_tool` | Need source snippets for review — token-efficient |
| `get_impact_radius_tool` | Understanding blast radius of a change |
| `get_affected_flows_tool` | Finding which execution paths are impacted |
| `query_graph_tool` | Tracing callers, callees, imports, tests, dependencies |
| `semantic_search_nodes_tool` | Finding functions/classes by name or keyword |
| `get_architecture_overview_tool` | Understanding high-level codebase structure |
| `refactor_tool` | Planning renames, finding dead code |

### Workflow

1. The graph auto-updates on file changes (via hooks).
2. Use `detect_changes_tool` for code review.
3. Use `get_affected_flows_tool` to understand impact.
4. Use `query_graph_tool` pattern="tests_for" to check coverage.
<!-- /code-review-graph MCP tools -->
