# 구현·자산·문서 현황

갱신: 2026-10-08 · 제품 0.1.0 로컬 변경 · [성경 삽입 검증](../quality/verification-2026-10-05-bible-insert.md) · [모니터 검증](../quality/verification-2026-10-05-stage-style.md) · [초기 후속 검증](../quality/verification-2026-10-04-implementation.md)

초기 검토에서 확인한 문제를 코드로 개선했다. 아래는 현재 동작이며 실장비·사용자·공개 배포 확인을 코드/자동/네이티브 결과와 구분한다.

| 영역                  | 최종 구현                                                                                                                   | 근거·남은 확인                                                                                                                                                                                           |
| --------------------- | --------------------------------------------------------------------------------------------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 진입·창 구분          | 컨트롤/메인/모니터 역할별 로드·고유 제목·Dock/창 메뉴·오류 경계                                                             | [App](../../src/App.tsx), [WindowManager](../../electron/services/windows.ts), N02                                                                                                                       |
| 자동 저장             | ID별 작업본 대기·400ms 기록·journal 복구·저장 상태/마지막 시각·재시도·종료 보호                                             | [runtime](../../src/store/runtime.ts), [persistence](../../src/store/persistence.ts), N01/05/07/10/11/12                                                                                                 |
| 라이브러리            | 새 자료/가져오기/성경의 새 ID, 최신 자료·스타일 복원                                                                        | [librarySlice](../../src/store/slices/librarySlice.ts), 단위/계약·N12                                                                                                                                    |
| 순서                  | 발표 ID 참조·최신 표시·고아 참조 제거·기록 직렬화                                                                           | [Repository](../../electron/services/repository.ts), 계약 검사                                                                                                                                           |
| 슬라이드/Undo         | 중앙 발행·의미 있는 편집 이력·자료 전환 경계                                                                                | [store](../../src/store.ts), [editor](../../src/store/slices/editorSlice.ts), 계약 검사                                                                                                                  |
| 인라인/일괄/캔버스    | 공통 텍스트 의미·모달 안 자동 적용/저장·단위 보존                                                                           | [model](../../shared/model.ts), [EditModal](../../src/components/EditModal.tsx), N01/03/10                                                                                                               |
| 성경                  | 큰 장/숫자 권 파싱·장별 색인·빈/부분 결과 보호·새 자료                                                                      | [BibleService](../../src/services/BibleService.ts), [parser](../../src/utils/bibleParser.ts), 데이터 출처/원문 품질 확인 필요                                                                            |
| 찬양에 성경 구절 추가 | 본문 확인·구절 선택·맨 앞/중간/뒤 삽입, 같은 자료·현재 라이브 유지, 자동 저장·일괄 Undo/Redo·재시작 복원                    | [BibleInsertModal](../../src/components/BibleInsertModal.tsx), [성경 삽입 검증](../quality/verification-2026-10-05-bible-insert.md), REQ-035/TASK-030/TC-035                                             |
| 스타일/설정           | 자료별 스타일·프리셋·라우팅·Stage 크기·크로마키 영속                                                                        | [settings](../../src/store/slices/settingsSlice.ts), N11                                                                                                                                                 |
| 기본 프리셋 자동 적용 | 기존/새/가져온 자료·첫 송출·찬양/성경 종류 전환, 현재 기본값 즉시 적용, 같은 종류의 직접 조정 유지                          | [presets](../../src/store/presets.ts), [2026-10-05 검증](../quality/verification-2026-10-05-default-presets.md)                                                                                          |
| 모니터 찬양·성경      | 현재/다음·시계 구성 유지, 메인 본문 스타일 연동, 각 성경 구절과 긴 본문 맞춤                                                | [StageSlideContent](../../src/components/StageSlideContent.tsx), [2026-10-05 검증](../quality/verification-2026-10-05-stage-style.md)                                                                    |
| 미디어                | 종류·등록 URL·영속 목록·특수문자·legacy 변환·누락 재연결·참조 보호 정리                                                     | [Repository](../../electron/services/repository.ts), N08/13                                                                                                                                              |
| 오디오/전체 중단      | 컨트롤 단일 audio, 탭 독립·전체 레이어/소리 중단                                                                            | [AudioPlayer](../../src/components/AudioPlayer.tsx), N14. 실제 스피커 확인 필요                                                                                                                          |
| 메인/모니터           | 최신 캐시·ready/applied/version·재열기·장비 이벤트·중단 재생성                                                              | [WindowManager](../../electron/services/windows.ts), N02/05/06. 물리 연결/분리 필요                                                                                                                      |
| 미리보기/캔버스       | 공통 합성·Look/광고/크로마키·논리 크기·percent/pixel·video·맞춤                                                             | [CompositeFrame](../../src/components/CompositeFrame.tsx), [ScaledSlide](../../src/components/ScaledSlide.tsx), 해상도/폰트 조합 확인 필요                                                               |
| AI 찬양 준비          | 오른쪽 아래 실행 버튼, 높이 조절 가능한 Songs·Bible 영역, Gemini/OpenAI/Claude 연결·PDF/이미지 입력·MCP 송폼 구성·콘티 적용 | [AI 연결](../../electron/services/ai-profiles.ts), [제공자](../../electron/services/song-providers.ts), [준비 화면](../../src/components/SongPreparationPanel.tsx). 실제 계정·한국어 악보 수용 평가 필요 |
| 키                    | OS 암호화만 영구 저장·legacy 정리·상태만 반환                                                                               | [KeyVault](../../electron/services/security.ts), 합성 계약 검사                                                                                                                                          |
| IPC/탐색              | sandbox·contextIsolation·webSecurity·CSP·역할/frame/origin·입력 제한                                                        | [main](../../electron/main.ts), [preload](../../electron/preload.ts), N02/08/13                                                                                                                          |
| 파일/백업             | 버전 JSON·스타일/미디어·전체 자료/순서/설정·키 제외·원본/직전 기록 보호                                                     | [Repository](../../electron/services/repository.ts), 다른 임시 환경 왕복·N07/08                                                                                                                          |
| 모달/키               | 입력/select/IME/모달 보호·포커스 순환·Escape 닫기·Space 진행                                                                | [useModalGuard](../../src/hooks/useModalGuard.ts), N03/09. 실제 IME/VoiceOver 수용 필요                                                                                                                  |
| 성능/진단             | 역할/성경 지연 로드·색인·좁은 구독·영상 preload 제한·JS 예산·숫자 측정                                                      | [bundle 검사](../../scripts/check-bundle.mjs), 지정 규모 장시간 검사 필요                                                                                                                                |
| 검사/빌드             | 성경 삽입 검사 시점의 lint·타입·93개 계약/단위·22개 Electron·번들 예산·앱 패키징                                            | [성경 삽입 검증](../quality/verification-2026-10-05-bible-insert.md), 동시 AI 작업의 전체 형식 미통과는 해당 기록에서 구분. 원격 CI 미실행                                                               |
| 배포/권리             | 이름/appId/0.1.0·macOS arm64 .app·권리 상태/릴리즈 증거 검사                                                                | [고지](../../THIRD_PARTY_NOTICES.md), 서명/공증·실제 설치/권리 확인 필요                                                                                                                                 |

Main/Chroma는 기존 하나의 메인 출력에 대한 Look 전환이다. 임의 N개 독립 출력 UI·자동 업데이트·계정 서버는 구현 범위에 추가하지 않았다. 광고 레이어의 상태/렌더링과 clock/timer Prop 렌더링은 있으나 별도의 완전한 제작 UI를 추가했다고 표시하지 않는다.

## 영속·일시 상태

| 데이터                                 | 위치·정책                                                                             |
| -------------------------------------- | ------------------------------------------------------------------------------------- |
| 자료·작업본·순서·설정·미디어 목록·장비 | Main workspace-v1.json, 5개 직전 기록                                                 |
| 중단 직전 편집                         | 컨트롤 origin의 journal, 확정 저장 후 정리                                            |
| 보호 키                                | Main key-v1.json OS 암호문. UI에는 configured만                                       |
| 등록 미디어                            | Main media와 내부 filename, 화면에는 asset ID URL                                     |
| 실제 라이브·선택·재생 상태             | 실행 중 상태. 컨트롤 재개에는 최신 라이브 전달, 전체 시작 때 본문/소리 자동 재개 없음 |
| 휴대용 .ppros                          | 버전 JSON·미디어 해시/base64. 단일 자료 또는 전체 백업 구분                           |
| 성경                                   | 기존 JSON을 별도 지연 자원으로 유지. 권리와 원문 품질 미확인                          |

변경 전 근거는 [초기 검토](project-review.md)에 보존한다. 최종 정책은 [ADR-008](../governance/decisions.md), 24개 대응은 [구현 반영표](../operations/implementation-2026-10-04.md)다.

## 2026-10-05 플레이리스트 파일 이동

플레이리스트의 파일 저장/불러오기 버튼, `kind: playlist` 휴대 파일, 순서 확인 후 개별 곡 등록·현재 순서 교체를 구현했다. 반복·슬라이드 색상·자료 스타일·참조 미디어를 보존하고 동일 내용 재사용/다른 내용 새 자료/원자 적용/실패 복귀를 따른다. 현재 선택·draft·송출은 유지한다. `PlaylistPanel`, `librarySlice`, Control 전용 Main/preload 계약과 Repository가 대응한다. 여러 콘티 보관함은 후속 범위다. REQ-036/TASK-031/TC-036/ADR-013 및 [검증 기록](../quality/verification-2026-10-05-playlist-files.md)을 참고한다.

## 2026-10-06 콘티 보관함·독립 곡 사본

이름/날짜별 보관함·열기/복제/검색/이름 변경/휴지통/복원, 독립 사본 자동 저장·별도 원곡 반영을 구현했다. 현재 작업/송출을 유지하고 파일/전체 백업/AI/journal을 사본 맥락에 연결했다. 기존 workspace-v1 원본을 보존하며 workspace-v2로 이전한다. REQ-038/TASK-033/TC-038/ADR-015 및 [검증](../quality/verification-2026-10-06-setlist-library.md)을 따른다. 이전 “여러 보관함은 후속 범위” 기록은 이번 적용으로 대체한다.
