# ProPre 프로젝트 문서 관리

작성일: 2026-10-04 (Asia/Seoul) · 문서 기준: `develop`, `3f625e3` · 상태: 구현·로컬 검증 반영 / 운영·배포 확인 대기

이 폴더는 검토·기획·구현·검증·운영 산출물의 기준점이다. 사용자의 후속 요청에 따라 운영 개선 코드·자동 저장·창 구분을 반영했다. **현재 구현의 근거는 검토·현황 문서에, 앞으로 구현할 동작은 기획·설계 문서에 기록한다.** 문서를 작성했다는 사실을 기능 구현이나 배포 완료로 해석하지 않는다.

## 먼저 읽을 문서

- [예배별 콘티 보관·편집](operations/setlist-library.md), [설계](engineering/setlist-library.md), [검증](quality/verification-2026-10-06-setlist-library.md): 여러 콘티와 독립 곡 사본, 명시적 원곡 반영 및 v2 이전.

- [PDF와 이미지의 AI 찬양 준비 설계](engineering/ai-song-preparation.md): 여러 AI 등록·선택, 송폼과 반복 슬라이드, 플레이리스트 새 구성/추가, 원자 적용·복구. 2026-10-07 구현·격리 검증 완료. 실제 API 품질 평가는 대기다. [사용 안내](operations/ai-song-preparation.md), [검증](quality/verification-2026-10-07-ai-song-preparation.md)을 연결한다.

- [플레이리스트 파일 저장·불러오기](operations/playlist-files.md), [검증 기록](quality/verification-2026-10-05-playlist-files.md): 순서와 개별 곡·미디어 이동, 동일 곡 재사용과 기존 작업/송출 보존.

- [AI에서 ProPre 사용하기](operations/ai-connection.md): 로컬 MCP 연결 허용·등록·자료 준비·미리보기·해제·실패 복구.
- [AI 연결 설계](engineering/ai-connection.md), [AI 연결 검증](quality/verification-2026-10-05-ai-connection.md): REQ-034/TASK-029/TC-034/ADR-011의 구현과 실제 SDK·Electron·패키지 검사.
- [찬양 자료에 성경 구절 추가](quality/verification-2026-10-05-bible-insert.md): 구절 검색·선택·위치 지정, 현재 자료·송출 보존과 자동 저장·재시작 검사.
- [모니터 찬양·성경 스타일 연동](quality/verification-2026-10-05-stage-style.md): 선택한 방향, 표시 규칙과 실제 앱 검사.
- [기본 프리셋 자동 적용 복구](quality/verification-2026-10-05-default-presets.md): 누락 원인, 적용 시점·직접 조정 정책과 저장/재시작 검사.

- [24개 개선 반영 결과](operations/implementation-2026-10-04.md): 최종 동작과 코드 대응, 운영 확인 대기.
- [개발 시작 복구 검증](quality/verification-2026-10-04-startup-recovery.md): 개발 실행 검은 화면의 원인·수정·추가 회귀 검사와 실제 실행 복구.
- [초기 개선 후속 검증](quality/verification-2026-10-04-implementation.md): 당시 68개 계약/단위·14개 빌드된 앱 검사와 패키징. 개발 실행은 이후 별도 검증했다.
- [운영 가이드](operations/runbook.md): 자동 저장·창 재개·파일·백업·장애 대응.

아래 초기 검토·기획 기록은 변경 전 판단과 비교안을 보존한다.

1. [전체 검토 보고서](review/project-review.md): 무엇이 구현되어 있고 무엇이 위험한지 확인한다.
2. [제품 기획서](product/product-plan.md): 대상 사용자, 목표, 범위와 대안을 확인한다.
3. [요구사항·추적표](product/requirements.md): 요구사항과 개발 작업, 테스트를 연결한다.
4. [개발 로드맵](delivery/roadmap.md) → [작업 백로그](delivery/backlog.md): 실행 순서와 완료 조건을 확인한다.
5. [실제 검증 기록](quality/verification-2026-10-04.md): 이번에 수행한 검사와 미검증 범위를 확인한다.

## 산출물 목록과 관리 기준

| 문서 | 관리하는 내용 | 현재 상태 | 향후 관리 역할 |
| --- | --- | --- | --- |
| [AI 찬양 준비 설계](engineering/ai-song-preparation.md) | 다중 AI 선택·파일 분석·송폼·순서 적용·개발/검증 계약 | 구현·격리 검증 완료 / 실 API 평가 대기 | 제품·개발·QA |
| [개선 반영](operations/implementation-2026-10-04.md) | 최종 동작·24개 대응·잔여 운영 확인 | 구현·로컬 검증 | 개발·QA |
| [후속 검증](quality/verification-2026-10-04-implementation.md) | 자동/네이티브·패키지 실행 근거 | 통과·미실행 분리 | QA·개발 |
| [전체 검토](review/project-review.md) | 문제, 영향, 근거, 우선순위 | 검토 완료 | 개발·QA |
| [구현 현황](review/feature-inventory.md) | 기능별 코드 존재 여부와 제약 | 현황 기록 | 개발 |
| [제품 기획](product/product-plan.md) | 사용자, 가치, 범위, 성공 기준 | 제안 | 제품 담당 |
| [요구사항](product/requirements.md) | REQ와 수용 기준·추적 관계 | 제안 | 제품·개발·QA |
| [사용자 흐름](product/user-flows.md) | 진입, 현재 상태, 다음 행동, 실패·복귀 | 제안 | 제품·디자인 |
| [화면 명세](product/screen-spec.md) | 정보 구조, 상태 표시, 인터랙션 | 제안 | 디자인·개발 |
| [아키텍처](engineering/architecture.md) | 현재 구조와 목표 구조 | 현황 + 제안 | 개발 |
| [데이터·IPC 계약](engineering/data-ipc-contracts.md) | 저장 형식, 마이그레이션, 통신·권한 | 제안 | 개발 |
| [로드맵](delivery/roadmap.md) | 마일스톤, 선행 조건, 종료 기준 | 제안 | 제품·개발 |
| [백로그](delivery/backlog.md) | TASK별 작업 범위와 완료 조건 | 20개 로컬 완료 / 8개 운영·외부 검증 대기 | 개발·QA |
| [테스트 계획](quality/test-plan.md) | TC별 환경, 절차, 예상 결과 | 계획 | QA·개발 |
| [검증 기록](quality/verification-2026-10-04.md) | 실행 결과, 환경, 한계, 재현 방법 | 실행 기록 | QA·개발 |
| [운영 가이드](operations/runbook.md) | 준비, 리허설, 진행, 장애, 종료·복구 | 구현 기준·실장비 검사 대기 | 운영 담당 |
| [릴리즈 기준](operations/release-checklist.md) | 설치, 장비, 권리, 복원, 배포 증거 | 미충족 항목 기록 | 릴리즈 담당 |
| [결정 기록](governance/decisions.md) | 결정, 제안, 대안, 변경 영향 | 초기 비교안 보존 / ADR-008 구현 기준 | 제품·개발 |
| [위험·미결 질문](governance/risks-and-questions.md) | 위험 대응과 필요한 제품 결정 | 열림 | 제품·개발 |
| [변경 이력](governance/change-log.md) | 문서·범위·검증 기준의 변경 | 작성 완료 | 변경 수행자 |
| [산출물 템플릿](templates/artifact-templates.md) | 기능 기획, 작업, 결정, QA, 릴리즈 양식 | 사용 가능 | 모든 역할 |

역할은 관리 책임의 제안이며 실제 담당자가 배정되었다는 뜻이 아니다. 개인별 담당자·일정은 백로그에 추후 기록한다.

## 문서와 개발을 함께 갱신하는 순서

1. 요구사항을 `REQ-###`로 기록하고 상태를 `제안`으로 둔다. 기존 동작을 바꾸는 경우 대안과 영향도 함께 기록한다.
2. 제품 정책이 확정되면 `ADR-###`와 결정 날짜를 남기고 관련 REQ를 갱신한다.
3. `TASK-###`에 관련 `REV-###`, `REQ-###`, `TC-###`, 작업 범위, 선행 작업, 완료 조건을 연결한다.
4. 구현 후 구현 현황을 갱신한다. 코드가 존재하면 `코드 확인`, 실제 검사까지 통과하면 해당 증거를 함께 기록한다.
5. 테스트는 별도의 실행 기록에 기준 커밋·환경·명령·예상·실제·결과·미검증 항목을 남긴다. 기존 날짜의 검증 기록을 새 결과로 덮어쓰지 않는다.
6. 완료 조건과 필요한 증거를 충족할 때만 TASK를 `완료`로 변경한다. 릴리즈는 설치·실장비·운영 검증을 따로 확인한다.
7. 관련 문서의 상대 링크와 ID를 확인하고 변경 이력을 갱신한다.

## 상태와 ID 규칙

| 구분 | 값 / 사용법 |
| --- | --- |
| 기획·결정 | 제안 → 확정 → 대체됨. 현재 구현 정책은 ADR-008, 초기 비교안은 보존한다. |
| 개발 작업 | 대기 → 진행 → 검증 대기 → 완료. 외부 조건으로 멈추면 차단 사유를 기록한다. |
| 테스트 실행 | 통과 / 실패 / 미실행 / 해당 없음. `계획`을 `통과`로 쓰지 않는다. |
| 검토 근거 | 코드 확인 / 격리 재현 / 빌드 확인 / 네이티브 확인 / 실장비 확인 / 사용자 확인 |
| REQ / REV / TASK / TC / ADR / RISK / Q | 번호를 재사용하지 않는다. 삭제 대신 폐기 또는 대체 관계를 남긴다. |

파일은 UTF-8 Markdown으로 저장한다. 문서 내부 연결은 저장소를 옮겨도 유지되는 상대 경로를 사용한다. Mermaid 도식은 지원하지 않는 뷰어에서도 주변 설명과 표로 내용을 이해할 수 있게 작성한다.

API 키, 실제 사용자의 자료·경로·개인정보는 문서와 검증 로그에 저장하지 않는다. 샘플은 합성 데이터를 사용한다.

## 현재 기준과 보존 범위

- 초기 작업은 검토·Markdown 작성이었다. 후속 사용자 요청으로 코드 개선·자동 저장·창 구분·로컬 검사/패키징·문서 갱신까지 반영했다. 공개 배포는 수행하지 않았다.
- 작업 시작 전 `dist-electron/main.js`, `dist-electron/preload.mjs`에 이미 변경이 있었다. 로컬 사본을 보존한 뒤 검증된 새 번들로 반영했다.
- 기존 루트의 [기술 명세](../TECHNICAL_SPECIFICATION.md), [차세대 로드맵](../NEXT_GEN_ARCHITECTURE.md), [이전 개선 보고서](../improve.md)는 이전 기록으로 유지한다. 현행 상태와 작업 우선순위는 이 폴더의 문서를 따른다.
- 작업 도중 추가된 [별도 운영 검토](../OPERATIONS_REVIEW.md)도 보존한다. 그 문서의 번호·우선순위·실행 표본은 독립된 기록이며, 후속 구현은 반영표와 이 인덱스의 REQ·REV·TASK·TC를 연결한다.
- Markdown 파일은 Git으로 변경 이력을 관리할 수 있다. 이번 작업은 커밋·원격 푸시·릴리즈를 수행하지 않았다.
