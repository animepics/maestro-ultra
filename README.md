# maestro

Claude Maestro — Claude가 지휘자가 되어 Codex 세션들을 관찰하고, 작업 프롬프트를 디스패치하고(병렬/단일은 Claude가 판단), 결과를 검증하는 오케스트레이션 하네스.

## Components

- **Observe** — Codex 세션들의 상태/진행/결과 확인 (codex app-server, WebSocket JSON-RPC)
- **Dispatch** — Claude가 수용 기준(acceptance criteria)을 명세한 작업 프롬프트를 Codex에게 전달, 병렬 N개 vs 단일 실행 판단
- **Verify** — 기준별 체크 + diff 코드리뷰 + 빌드/테스트 실행, 미달 시 재작업 지시 (최대 3회 후 에스컬레이션)
- **Skill** — 위 전체를 `/maestro "작업 설명"` 한 번으로 호출하는 스킬 패키징
