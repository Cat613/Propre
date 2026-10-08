# ProPre 프로젝트 구조와 운영 개선 목록

> 이 문서는 변경 전 검토 기록입니다. 현재 구현과 검증 결과는 [후속 개선 기록](docs/operations/implementation-2026-10-04.md)을 기준으로 읽습니다.

현재 구조는 Electron의 제어창, 송출창, 무대창을 분리하고 Zustand 상태를 기능별로 나눈 점에서 적절한 기반을 갖췄다. 다만 편집 자료의 식별자와 실제 송출 상태, 저장 성공 여부를 일관되게 관리하지 못해 자료 덮어쓰기와 화면 불일치가 발생할 수 있다. 안정적인 현장 운영을 위해서는 아래 P1 항목을 먼저 보완해야 한다.

검토일은 2026년 10월 4일이며, 대상은 `develop` 브랜치의 `3f625e3` 커밋과 현재 소스다. 서버 서비스보다 발표 현장의 로컬 데스크톱 앱 운영을 기준으로 검토했다. 기존 생성물의 변경은 보존했고, 이번 작업은 검토 문서 작성 범위다.

## 현재 구조 평가

| 영역 | 평가 | 운영상 의미 |
| --- | --- | --- |
| 제어창과 송출창 분리 | 적절한 기반 | 각 화면을 별도 창으로 제어할 수 있다. 다만 창의 존재와 실제 렌더링 준비 상태를 구분해야 한다. |
| 기능별 상태 분리 | 적절한 기반 | 편집, 라이브러리, 미디어, 설정 등을 slice로 나눴다. 편집 상태와 실제 송출 상태의 책임은 추가 분리가 필요하다. |
| 파일 시스템 접근 | 일부 적절 | 가져온 미디어를 앱 데이터 폴더에 복사한다. 파일 수명, 복구, 이동 가능성은 관리하지 않는다. |
| 보안 경계 | 우선 보완 필요 | 모든 창의 `webSecurity`가 꺼져 있고 IPC 호출자의 권한 검증이 없다. |
| 자료 저장과 복구 | 우선 보완 필요 | 수동 저장 중심이며 미저장 작업, 전체 백업, 손상 복구를 다루는 흐름이 없다. |
| 화면 동기화 | 우선 보완 필요 | 각 액션에서 개별적으로 메시지를 전송해 누락이 발생한다. 재생성된 창에 현재 상태를 재전송하지 않는다. |
| 배포와 검증 | 우선 보완 필요 | 타입 검사와 번들 생성은 성공하지만 지원 버전의 불일치, 회귀 테스트 및 배포 절차의 공백이 있다. |

유지할 부분은 프로세스 분리, 기존 slice 분리, 공통 슬라이드 렌더러, OS 암호화 API 도입, 창 상태 알림이다. 개선의 중심은 저장소와 화면 간 계약을 명확하게 만드는 것이다.

## 확인한 범위와 검증 결과

| 확인 방법 | 결과 | 해석 범위 |
| --- | --- | --- |
| 현재 소스의 TypeScript 검사 | 통과 | 타입 오류가 없다는 근거이며 런타임 데이터 검증이나 운영 안정성의 근거는 아니다. |
| 소스를 복사한 임시 작업 폴더에서 Vite 프로덕션 빌드 | 통과 | 프런트엔드, Electron main, preload 번들 생성 확인. 설치 파일 패키징, 코드 서명, 실제 설치 후 실행은 별도다. |
| 실제 store 액션과 렌더러를 이용한 격리 검증 | 17개 조건 확인 | 자료 식별자, 삭제와 수정 후 동기화, Undo, 저장 실패, 미디어 URL, 성경 파서, 요소 렌더링 확인. 정상 파서 대조 조건 1개를 포함한다. |
| 실제 Electron main 코드에 창과 저장소 모형을 연결한 검증 | 6개 조건 확인 | 창 복원, 상태 재전송 누락, IPC 발신자 검증 누락, 평문 잔존, 제어창 재열기 문제 확인. 실제 OS 창이나 물리 디스플레이 검증은 아니다. |
| 기존 `test-run.js` 실행 | 실패 | 존재하지 않는 `src/services/BibleService.js`를 가져와 `ERR_MODULE_NOT_FOUND`가 발생한다. |
| 전체 의존성 `npm audit` | 취약 패키지 집계 39개 | Critical 2, High 30, Moderate 4, Low 3. 실제 공격 가능성이나 서로 다른 취약점의 개수를 의미하지 않는다. |
| 개발 의존성을 제외한 `npm audit` | 취약 패키지 집계 7개 | Critical 1, High 4, Moderate 2. Electron은 개발 의존성으로 선언되어도 최종 앱의 실행 기반이므로 이 집계만으로 배포 위험을 판단하면 안 된다. |

실제 사용자 자료와 저장된 API 키는 조회하지 않았다. 실물 다중 모니터, 실제 오디오 출력, 장시간 송출, 디스크 장애, 서명된 설치 파일의 업데이트와 복원은 이번 검증 범위에 포함되지 않는다.

## 개선 우선순위

P1은 자료 손실, 의도하지 않은 송출, 보안 경계, 실행 및 복구에 영향을 주므로 일상적인 현장 운영 전에 보완할 항목이다. P2는 기능 일관성과 유지보수, 운영 편의 개선 항목이다. 항목 번호는 후속 구현과 검증을 연결하기 위한 것이다.

| 번호 | 우선순위 | 개선 항목 |
| --- | --- | --- |
| 01 | P1 | 불러온 자료와 성경 검색의 식별자 분리 |
| 02 | P1 | 미저장 작업 보호와 복구 |
| 03 | P1 | 송출 상태의 중앙 동기화와 재전송 |
| 04 | P1 | 자료별 실행 취소 이력 관리 |
| 05 | P1 | 창과 모니터의 생명주기 및 장애 복구 |
| 06 | P1 | Electron과 IPC의 권한 경계 |
| 07 | P1 | 저장 데이터와 가져오기 형식 검증 |
| 08 | P1 | 백업과 복원 및 파일 저장 안전성 |
| 09 | P1 | 저장 실패와 성공 표시의 일치 |
| 10 | P1 | API 키 저장과 접근 범위 |
| 11 | P1 | 슬라이드 콘텐츠 모델 통일 |
| 12 | P1 | 모달과 단축키의 조작 범위 |
| 13 | P1 | 오디오 재생 상태와 수명 관리 |
| 14 | P1 | 실행 기반의 호환 버전과 취약 의존성 |
| 15 | P1 | 핵심 회귀 테스트와 배포 전 검사 |
| 16 | P1 | 플레이리스트와 라이브러리의 참조 정합성 |
| 17 | P2 | 미디어 자산의 지속 저장과 수명 관리 |
| 18 | P2 | 미리보기와 실제 송출의 렌더링 일치 |
| 19 | P2 | 설정 저장 정책과 저장 취소 동작 |
| 20 | P2 | 성경 검색 파서와 잘못된 입력 처리 |
| 21 | P2 | AI 요청의 복구와 설정 진입 |
| 22 | P2 | 모듈 책임과 공통 계약 정리 |
| 23 | P2 | 릴리스 절차와 문서의 현재 상태 정리 |
| 24 | P2 | 송출 성능과 메모리 기준 설정 |

## P1 개선 상세

### 01 불러온 자료와 성경 검색의 식별자 분리

단일 프로젝트 가져오기와 성경 검색은 `setSlides()`로 슬라이드만 교체한다. 이 액션은 기존 `currentPresentationId`와 제목을 유지한다. 자료 A를 선택한 상태에서 다른 파일이나 성경 내용을 가져온 뒤 저장하면 A를 덮어쓸 수 있다. 실제 store 액션으로 이 흐름을 재현했다.

근거: [LibraryPanel.tsx](/Users/hm/workspace/ai_project/Propre/src/components/LibraryPanel.tsx:87), [BiblePanel.tsx](/Users/hm/workspace/ai_project/Propre/src/components/BiblePanel.tsx:105), [editorSlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/editorSlice.ts:198), [librarySlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/librarySlice.ts:51).

개선 방향은 새 자료 열기, 기존 자료 교체, 현재 자료 편집을 별도 액션으로 구분하는 것이다. 가져온 제목과 자료 식별자를 함께 설정하고, 성경 검색은 독립 작업 자료로 다룬다. 완료 기준은 A를 선택한 상태에서 B를 가져오거나 성경을 검색하고 저장해도 A가 보존되는 것이다.

### 02 미저장 작업 보호와 복구

자료 선택과 새 자료 만들기는 현재 편집 내용을 즉시 교체한다. 미저장 여부, 자동 임시 저장, 종료 시 보호, 재실행 후 작업 복구가 없다. 편집 모달의 저장이나 일괄 편집의 저장도 실제로는 메모리 상태를 바꾸며, 라이브러리 저장은 별도다.

근거: [librarySlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/librarySlice.ts:82), [EditModal.tsx](/Users/hm/workspace/ai_project/Propre/src/components/EditModal.tsx:99), [BulkEditModal.tsx](/Users/hm/workspace/ai_project/Propre/src/components/BulkEditModal.tsx:62), [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:49).

마지막 저장본과 작업 중인 자료를 구분하고, 변경 여부와 마지막 저장 시각을 표시한다. 일정 간격의 임시 저장과 저장 실패 시 재시도를 제공한다. 완료 기준은 자료 전환, 종료, 비정상 종료 후에도 편집 내용을 보존하거나 복구할 수 있고, 적용과 영구 저장의 의미가 UI에서 구분되는 것이다.

### 03 송출 상태의 중앙 동기화와 재전송

현재 메시지는 존재하는 창으로 전달될 뿐 보관되지 않는다. 송출창을 뒤늦게 열거나 출력 모니터를 바꿔 창을 재생성하면 현재 상태를 받지 못한다. 또한 단일 슬라이드 삭제, `setSlides()`, 재정렬, Undo는 필요한 갱신을 보내지 않으며, `updateSlide()`는 송출창만 갱신하고 무대창은 갱신하지 않는다. 격리 검증에서 각 누락을 확인했다.

근거: [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:198), [editorSlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/editorSlice.ts:209), [store helpers.ts](/Users/hm/workspace/ai_project/Propre/src/store/helpers.ts:1), [OutputDisplay.tsx](/Users/hm/workspace/ai_project/Propre/src/components/OutputDisplay.tsx:24).

한 경로에서 송출용 상태와 무대용 상태를 계산하고, main 프로세스에 화면별 최신 상태를 보관한다. 창이 구독 준비를 마치면 최신 상태를 요청하게 하고, 상태 버전과 적용 확인을 통해 창 생성과 렌더링 준비를 구분한다. 완료 기준은 창 재열기, 모니터 변경, 수정, 삭제, 순서 변경, Undo 이후 제어창과 실제 화면이 같은 상태로 수렴하는 것이다.

### 04 자료별 실행 취소 이력 관리

Zundo의 `partialize`는 추적 필드를 좁히지만 동일 상태를 건너뛰는 비교 함수가 없다. 선택 변경만 반복해도 50개 이력을 소모해 실제 편집 기록을 밀어낸다. 자료 전환 시 이력을 비우거나 자료별로 분리하지 않고, 식별자는 추적하지 않아 A의 슬라이드를 B의 식별자로 복원한 뒤 B를 덮어쓰는 흐름도 재현했다.

근거: [store.ts](/Users/hm/workspace/ai_project/Propre/src/store.ts:21), [librarySlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/librarySlice.ts:146), [useHotkeys.ts](/Users/hm/workspace/ai_project/Propre/src/hooks/useHotkeys.ts:26).

콘텐츠가 바뀐 경우만 이력을 저장하고, 자료별 이력과 편집 작업 단위를 정의한다. 복원 후에는 선택과 송출 참조도 유효한 상태로 정리한다. 완료 기준은 선택 변경이 편집 이력을 소모하지 않고, 자료 전환 후 Undo가 다른 자료의 콘텐츠를 현재 자료에 넣지 않는 것이다.

### 05 창과 모니터의 생명주기 및 장애 복구

무대창 복원 시 새 창의 기본 `show`가 `false`여서 이전 활성 상태가 저장되어 있어도 창이 숨겨진다. macOS에서 제어창을 닫고 송출창이나 무대창을 남겨두면 `activate`가 전체 창 수만 확인해 제어창을 다시 만들지 않는다. 두 흐름 모두 창 모형을 통해 재현했다. 디스플레이 연결 변경, 페이지 로딩 실패, 렌더러 종료와 응답 없음에 대한 처리도 확인되지 않는다.

근거: [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:120), [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:170), [SettingsTabPanel.tsx](/Users/hm/workspace/ai_project/Propre/src/components/SettingsTabPanel.tsx:23).

제어창 존재, 출력 요청, 창 생성, 페이지 준비, 적용 완료를 따로 관리한다. 모니터 분리와 복귀 시 사용자가 복구 경로를 이해할 수 있게 하고, 설정한 모니터가 없을 때 기본 모니터로 송출하는 정책도 명시한다. 완료 기준은 제어창 재열기와 무대창 복원이 정상 동작하고, 출력 실패 및 모니터 변경을 제어창이 감지하는 것이다.

### 06 Electron과 IPC의 권한 경계

모든 BrowserWindow에서 `webSecurity: false`를 사용한다. preload는 일부 채널을 제한하지만 일반 `invoke(channel, ...args)`도 노출하며, main 핸들러는 발신 창과 프레임을 검증하지 않는다. 같은 preload가 송출창과 무대창에도 라이브러리 변경과 키 접근 기능을 제공한다. 임의의 비제어창 발신자를 넣어도 라우팅을 수락하는 것을 격리 검증으로 확인했다. CSP와 탐색 및 새 창 생성 제한도 확인되지 않는다.

근거: [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:33), [electron preload.ts](/Users/hm/workspace/ai_project/Propre/electron/preload.ts:66), [index.html](/Users/hm/workspace/ai_project/Propre/index.html:3).

Electron 공식 문서는 `webSecurity` 유지, 제한적인 CSP, IPC 발신자 검증, 탐색 제한을 권장한다. [Electron 보안 지침](https://www.electronjs.org/docs/latest/tutorial/security).

제어창에만 수정 권한을 부여하고 화면별 preload API를 최소화한다. 로컬 미디어는 승인된 자산 ID를 앱 내부 경로로 해석하는 프로토콜로 제공한다. 요청 URL을 그대로 로컬 파일 경로로 변환하는 방식은 경로 제한을 보장하지 못한다. 완료 기준은 송출창의 저장 및 키 접근과 허용되지 않은 IPC 호출이 거부되고, 보안을 켠 상태에서 승인된 미디어가 재생되는 것이다. 실제 외부 공격이나 코드 실행 가능성을 입증한 결과는 아니다.

### 07 저장 데이터와 가져오기 형식 검증

저장소 스키마는 라이브러리와 플레이리스트가 배열인지 정도만 검증한다. 파일 가져오기도 `slides` 또는 `data`가 배열인지 확인하며 항목 내부를 검증하지 않는다. 제목 타입, 필수 식별자, 중복 ID, 요소 종류, 좌표와 스타일, 참조 관계, 데이터 크기 제한, 파일 형식 버전 및 마이그레이션 계약이 없다.

근거: [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:12), [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:383), [LibraryPanel.tsx](/Users/hm/workspace/ai_project/Propre/src/components/LibraryPanel.tsx:91), [types.ts](/Users/hm/workspace/ai_project/Propre/src/types.ts:98).

IPC 입력과 저장본 및 가져오기 파일에 공통 런타임 스키마를 적용한다. 파일 크기와 항목 수를 제한하고 `schemaVersion`에 따라 옛 형식을 변환한다. 검증이 완료된 자료만 기존 상태에 반영한다. 완료 기준은 잘못된 파일이 기존 자료를 훼손하지 않고 거부되며, 지원하는 이전 버전 파일이 동일한 내부 모델로 변환되는 것이다.

### 08 백업과 복원 및 파일 저장 안전성

프로젝트 내보내기는 파일에 직접 `writeFile()`을 수행한다. 전체 라이브러리 내보내기에는 플레이리스트, 설정, 실제 미디어 파일이 포함되지 않는다. 저장소는 시작 시 즉시 열리며 앱 수준의 손상 복구 안내나 복원 절차가 없다. 다중 앱 실행을 막는 잠금도 없어 동일 저장소를 여러 프로세스가 수정하는 상황을 제어하지 않는다.

근거: [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:338), [LibraryPanel.tsx](/Users/hm/workspace/ai_project/Propre/src/components/LibraryPanel.tsx:73), [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:12).

현재 `electron-store`의 하위 저장 구현에는 원자적 파일 쓰기가 있다. 그 기능을 앱 수준의 백업과 복구, 여러 항목의 일관된 저장까지 보장하는 것으로 해석하면 안 된다. 직접 내보내는 파일에는 임시 파일 후 교체를 적용하고, 자료와 자산을 함께 복원할 수 있는 백업 단위를 정의한다. 손상 원본은 보존하고 정상 백업 선택 경로를 제공한다. 완료 기준은 중단된 내보내기가 이전 파일을 보존하고, 빈 앱 데이터 환경에서도 백업으로 자료와 자산을 복원할 수 있는 것이다.

### 09 저장 실패와 성공 표시의 일치

`importPresentations()`는 오류를 알림으로 표시한 뒤 성공처럼 Promise를 완료한다. 호출하는 UI는 그 뒤 성공 알림을 추가한다. 플레이리스트 수정은 먼저 화면 상태를 바꾼 뒤 저장하며 저장 실패 시 원상 복원이나 재시도가 없다. 새 자료 저장은 실제 저장 전에 식별자를 설정한다. 가져오기 실패가 호출자에게 전달되지 않는 흐름과 플레이리스트의 화면 및 저장 상태 불일치를 재현했다.

근거: [librarySlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/librarySlice.ts:20), [LibraryPanel.tsx](/Users/hm/workspace/ai_project/Propre/src/components/LibraryPanel.tsx:92), [librarySlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/librarySlice.ts:114).

성공, 취소, 실패를 구분하는 공통 결과 형식을 사용하고 저장 확인 이후 성공을 표시한다. 실패한 작업에는 사용자가 이해할 수 있는 원인과 재시도 경로를 제공한다. 필요한 경우 변경 전 상태를 복원한다. 완료 기준은 저장소 오류를 넣었을 때 성공 알림이 나오지 않고 자료를 보존한 채 재시도가 가능한 것이다.

### 10 API 키 저장과 접근 범위

OS 암호화가 불가능하면 API 키를 평문으로 저장한다. 이후 암호화 저장을 해도 과거 평문 필드를 지우지 않아 평문이 남는 것을 모형 저장소에서 확인했다. 키를 모든 창의 Zustand 초기화 과정에서 읽어오고 renderer에서 외부 요청을 수행하므로 키 접근 범위도 넓다. 설정 화면은 저장 성공을 확인하지 않고 닫힌다.

근거: [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:399), [settingsSlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/settingsSlice.ts:13), [SettingsModal.tsx](/Users/hm/workspace/ai_project/Propre/src/components/SettingsModal.tsx:36), `src/services/aiService.ts` (초기 검토 당시 경로, 후속 구현에서 삭제).

영구 평문 저장을 제거하고, 암호화가 불가능한 환경에서는 저장 제한과 세션 사용 정책을 명확히 한다. 암호화 전환 시 이전 평문을 삭제하고 renderer에는 키 설정 여부만 전달한다. AI 호출은 권한을 제한한 main 서비스로 옮긴다. Linux 지원 시 `basic_text` 백엔드도 별도로 처리해야 한다. [Electron safeStorage 문서](https://www.electronjs.org/docs/latest/api/safe-storage).

완료 기준은 저장 파일에 평문이 남지 않고 송출창과 무대창이 키를 요청할 수 없으며, 키 저장 실패가 설정 화면에 표시되는 것이다.

### 11 슬라이드 콘텐츠 모델 통일

`content`와 `elements[].text`가 함께 존재하지만 모든 편집기가 두 필드를 함께 갱신하지 않는다. 인라인 편집과 일괄 편집은 `content`만 바꾸고 `ScaledSlide`는 요소가 있으면 `elements`를 표시한다. 편집한 가사가 실제 화면에 반영되지 않는 것을 store와 렌더러로 재현했다. 무대창과 슬라이드 목록은 `content`만 사용하므로 요소만 있는 자료도 다른 화면과 일치하지 않는다.

근거: [SlideGrid.tsx](/Users/hm/workspace/ai_project/Propre/src/components/SlideGrid.tsx:71), [BulkEditModal.tsx](/Users/hm/workspace/ai_project/Propre/src/components/BulkEditModal.tsx:41), [ScaledSlide.tsx](/Users/hm/workspace/ai_project/Propre/src/components/ScaledSlide.tsx:230), [StageDisplay.tsx](/Users/hm/workspace/ai_project/Propre/src/components/StageDisplay.tsx:49).

저장 모델의 기준 필드를 하나로 정하고 이전 자료는 로드 시 변환한다. 단순 텍스트 편집이 수정할 요소를 명시하고 목록 및 무대용 텍스트는 같은 모델에서 계산한다. 완료 기준은 기존 파일과 요소 기반 파일 모두에서 인라인, 일괄, 캔버스 편집 결과가 송출과 무대에 동일하게 반영되는 것이다.

### 12 모달과 단축키의 조작 범위

전역 단축키는 `isModalOpen`을 확인하지만 이를 설정하는 실제 호출이 없다. `SlideGrid`의 모달 상태 콜백도 제어판에서 연결하지 않는다. 따라서 편집 모달의 버튼에 포커스가 있을 때 방향키나 Escape가 배경 송출을 조작할 수 있다. 저장 단축키는 입력 및 모달 검사보다 먼저 실행되어 모달에서 작성 중인 로컬 값이 반영되기 전에 기존 자료를 저장할 수 있다. `clearAll()`은 고정 안내인 props를 남긴다.

근거: [useHotkeys.ts](/Users/hm/workspace/ai_project/Propre/src/hooks/useHotkeys.ts:8), [ControlPanel.tsx](/Users/hm/workspace/ai_project/Propre/src/components/ControlPanel.tsx:143), [SlideGrid.tsx](/Users/hm/workspace/ai_project/Propre/src/components/SlideGrid.tsx:279), [mediaSlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/mediaSlice.ts:118).

편집, 모달, 송출 제어의 단축키 범위를 한곳에서 정의한다. 전체 송출 중단은 실제 보이는 모든 레이어와 재생 중인 오디오를 포함하도록 의미를 정한다. 완료 기준은 모달 안에서 입력, 저장, 취소를 해도 배경 송출이 바뀌지 않고 전체 중단 후 안내 텍스트와 오디오가 남지 않는 것이다. props 잔존은 격리 재현했으며 실제 키보드 UI 동작은 코드 경로 확인 수준이다.

### 13 오디오 재생 상태와 수명 관리

사용자가 사용하는 `AudioPlayer`는 store의 `activeAudio`와 연결되지 않은 자체 상태와 `<audio>` 요소를 사용한다. 미디어 탭에서 다른 탭으로 이동하면 조건부 렌더링 때문에 플레이어가 제거되어 재생과 선택 상태를 잃는다. store의 오디오 레이어 지우기나 전체 지우기도 이 플레이어를 제어하지 못한다.

근거: [AudioPlayer.tsx](/Users/hm/workspace/ai_project/Propre/src/components/AudioPlayer.tsx:3), [ControlPanel.tsx](/Users/hm/workspace/ai_project/Propre/src/components/ControlPanel.tsx:183), [mediaSlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/mediaSlice.ts:87), [OutputDisplay.tsx](/Users/hm/workspace/ai_project/Propre/src/components/OutputDisplay.tsx:96).

재생을 담당하는 주체와 오디오 상태를 하나로 정하고 UI 탭의 수명과 분리한다. 재생 성공, 실패, 종료 이벤트로 상태를 갱신한다. 완료 기준은 탭 전환이 재생을 끊지 않고 전체 중단이 실제 음원을 멈추며, 재생 실패 시 UI가 재생 중으로 표시하지 않는 것이다. 실제 장치의 소리 출력은 별도 확인이 필요하다.

### 14 실행 기반의 호환 버전과 취약 의존성

설치된 Electron은 28.3.3이며 내장 Node는 18.18.2다. 설치된 `electron-store` 11.0.2는 Node 20 이상과 Electron 30 이상을 요구한다. 버전 요구가 일치하지 않는다. 번들 생성은 성공했지만 이 조합의 정식 지원과 설치 환경의 동작을 보장하지는 않는다. [electron-store 11.0.2 요구 사항](https://raw.githubusercontent.com/sindresorhus/electron-store/v11.0.2/readme.md).

근거: [package.json](/Users/hm/workspace/ai_project/Propre/package.json:18), [package.json](/Users/hm/workspace/ai_project/Propre/package.json:33). 런타임 의존성 검사에서도 `@google/genai`를 통해 들어오는 `protobufjs`를 포함한 취약 패키지가 발견됐다. 집계는 검토 시점의 advisory 결과이며 공격 경로별 도달 가능성은 추가 평가 대상이다.

서로 호환되는 지원 버전 조합을 정하고 lockfile, 개발 Node 버전, 배포 OS 및 아키텍처를 함께 고정한다. 보안 갱신은 저장본 호환과 설치 후 실행 검증을 동반해야 한다. 완료 기준은 지원 버전 조건이 일치하고 남는 advisory의 적용 여부와 대응이 기록되며, 실제 패키지에서 시작, 저장, 미디어, 다중 창 기능이 확인되는 것이다. [Electron 릴리스 지원 정책](https://www.electronjs.org/docs/latest/tutorial/electron-timelines).

### 15 핵심 회귀 테스트와 배포 전 검사

정식 테스트 스크립트와 CI 설정이 확인되지 않는다. 기존 점검용 파일도 실행에 실패한다. 타입 검사가 통과해도 이번 검토에서 재현한 자료 덮어쓰기, 상태 전송 누락, 실행 취소와 콘텐츠 모델 불일치를 검출하지 못한다.

근거: [package.json](/Users/hm/workspace/ai_project/Propre/package.json:7), `test-run.js` (초기 검토 당시 경로, 정식 검사로 대체).

첫 회귀 대상은 자료 가져오기 후 저장, 자료 전환 후 Undo, 잘못된 파일 거부, 저장 실패, 모든 레이어 중단, 창 구독 후 최신 상태 복원이다. 임시 자료 폴더를 사용해 실제 사용자 자료와 테스트를 분리하고, 검사와 번들 생성 및 패키징을 독립된 단계로 실행한다. 완료 기준은 이 경로를 자동으로 반복 확인할 수 있고 실패한 변경이 릴리스 대상에 포함되지 않는 것이다.

### 16 플레이리스트와 라이브러리의 참조 정합성

플레이리스트는 자료 식별자와 함께 Presentation 전체를 복사해 보관한다. 이후 자료를 수정하거나 가져오기로 덮어써도 복사본을 갱신하지 않아 제목과 내용이 낡을 수 있다. 자료 삭제 시 플레이리스트 항목은 남으며, 해당 항목을 눌러도 라이브러리에서 자료를 찾을 수 없다. 수정 후 제목 잔존과 삭제 후 항목 잔존을 격리 검증으로 확인했다.

근거: [librarySlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/librarySlice.ts:119), [librarySlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/librarySlice.ts:101), [SortablePlaylistItem.tsx](/Users/hm/workspace/ai_project/Propre/src/components/SortablePlaylistItem.tsx:42), [types.ts](/Users/hm/workspace/ai_project/Propre/src/types.ts:145).

라이브러리 자료를 참조하는 목록인지 특정 시점의 자료를 보존하는 목록인지 정책을 정한다. 참조형이면 저장, 가져오기, 삭제 시 정합성을 유지하고, 스냅샷형이면 버전을 명시하며 선택 시 그 버전의 내용을 연다. 완료 기준은 제목과 실제 선택된 내용이 일치하고 삭제된 자료를 가리키는 항목을 명확하게 정리하거나 복구하는 것이다.

## P2 개선 상세

### 17 미디어 자산의 지속 저장과 수명 관리

선택한 파일은 복사하지만 `mediaBin` 자체는 메모리에만 존재한다. 항목을 지워도 복사된 파일은 남는다. 확장자 기반 분류는 MP3와 WAV를 이미지로 취급하고, 직접 조합한 `file://` URL은 `#`가 포함된 파일명을 잘못 해석한다. 절대 경로만 들어 있는 프로젝트 파일은 다른 컴퓨터에 옮겨도 자산을 함께 제공하지 못한다.

근거: [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:301), [mediaSlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/mediaSlice.ts:14), [ToolbarActions.tsx](/Users/hm/workspace/ai_project/Propre/src/components/ToolbarActions.tsx:37).

자산 ID, 유형, 원본 이름, 저장 위치, 참조 관계를 저장하고 표준 URL 변환을 사용한다. 누락 파일 확인, 재연결, 부분 복사 실패 표시, 사용하지 않는 파일 정리 및 자료와 자산을 함께 내보내는 경로를 제공한다. 완료 기준은 재실행 후 미디어 목록이 복구되고 특수문자 파일과 지원 음원 형식이 정상 처리되며 다른 컴퓨터에서도 패키지의 미디어가 열리는 것이다.

### 18 미리보기와 실제 송출의 렌더링 일치

미리보기는 화면별 라우팅, 크로마키, announcement를 실제 출력과 같은 방식으로 반영하지 않는다. 좌표가 100 이하이면 백분율로 간주하는 규칙과 고정 1920×1080 캔버스가 함께 쓰이며, 모델의 `canvasWidth`와 `canvasHeight`는 렌더링에 반영되지 않는다. 요소의 video는 `<img>`로 출력되는 것을 재현했다. 자동 글자 크기 조절도 일반 텍스트와 요소 텍스트까지 적용되는 구현은 아니다.

근거: [PreviewPanel.tsx](/Users/hm/workspace/ai_project/Propre/src/components/PreviewPanel.tsx:46), [ScaledSlide.tsx](/Users/hm/workspace/ai_project/Propre/src/components/ScaledSlide.tsx:58), [ScaledSlide.tsx](/Users/hm/workspace/ai_project/Propre/src/components/ScaledSlide.tsx:296), [types.ts](/Users/hm/workspace/ai_project/Propre/src/types.ts:63).

공통 레이어 합성 및 화면별 상태 계산을 미리보기와 출력에서 사용한다. 좌표 단위와 캔버스 크기를 명시하고 지원 요소별 렌더러를 구분한다. 완료 기준은 같은 화면 설정의 미리보기와 실제 출력이 같고, 창 크기 및 화면 비율 변경과 긴 텍스트에서 잘림 여부가 검증되는 것이다.

### 19 설정 저장 정책과 저장 취소 동작

라이브러리 및 디스플레이 설정은 `electron-store`, 프리셋과 무대 글자 크기는 `localStorage`, 라우팅과 크로마키 및 현재 전역 스타일은 메모리에 분산되어 있다. 현재 Presentation 모델에는 전역 스타일이 저장되지 않는다. 설정 모달의 라우팅과 무대 크기는 즉시 반영되어 취소해도 원복되지 않지만 API 키는 저장 버튼을 사용한다.

근거: [settingsSlice.ts](/Users/hm/workspace/ai_project/Propre/src/store/slices/settingsSlice.ts:19), [SettingsModal.tsx](/Users/hm/workspace/ai_project/Propre/src/components/SettingsModal.tsx:122), [types.ts](/Users/hm/workspace/ai_project/Propre/src/types.ts:136).

앱 설정, 자료별 스타일, 실행 중 송출 상태를 구분하고 저장소와 복원 규칙을 정한다. 즉시 적용과 저장 후 적용 중 하나의 명확한 정책을 쓰며 숫자 범위와 프리셋 참조도 검증한다. 완료 기준은 재실행 후 필요한 설정이 유지되고 취소 버튼이 실제 변경 취소 의미를 가지며 자료를 다시 열었을 때 의도한 스타일이 재현되는 것이다.

### 20 성경 검색 파서와 잘못된 입력 처리

책 이름 정규식이 숫자를 탐욕적으로 포함해 공백 없는 두 자리 이상 장 번호를 잘못 해석한다. `창10:1`, `시119:105`는 인식에 실패하고 `요한복음3:16`은 정상인 것을 재현했다. 범위 역전이나 존재하지 않는 장과 절이 빈 결과가 되면 현재 슬라이드를 빈 배열로 교체할 수 있다.

근거: [bibleParser.ts](/Users/hm/workspace/ai_project/Propre/src/utils/bibleParser.ts:92), [BiblePanel.tsx](/Users/hm/workspace/ai_project/Propre/src/components/BiblePanel.tsx:92).

알려진 책 이름을 먼저 확정하고 장 및 절을 분리한다. 존재 범위와 범위 역전을 확인하고 결과가 없을 때 기존 자료를 유지한다. 완료 기준은 공백 유무, 다중 숫자 장, 숫자 포함 책 이름, 잘못된 범위에 대한 회귀 사례가 통과하는 것이다.

### 21 AI 요청의 복구와 설정 진입

API 키가 없을 때 설정을 열도록 설계했지만 실제 툴바의 `onOpenSettings`는 빈 함수다. 요청에는 앱 수준의 취소, 처리 시간 제한, 재시도 분류, 입력 크기 제한이 없고 preview 모델명이 코드에 고정되어 있다. 선택 이미지를 외부 API로 전달하지만 설정 안내는 키가 로컬에 저장된다는 내용에 집중한다.

근거: [ControlToolbar.tsx](/Users/hm/workspace/ai_project/Propre/src/components/ControlToolbar.tsx:18), [useAIExtraction.ts](/Users/hm/workspace/ai_project/Propre/src/hooks/useAIExtraction.ts:13), `src/services/aiService.ts` (초기 검토 당시 경로, 후속 구현에서 삭제).

설정 진입을 연결하고 요청 상태, 취소, 시간 제한 및 재시도 가능한 오류를 정의한다. 모델 선택은 설정과 유효성 확인 경로를 두고, 전송 대상과 추출 결과의 적용 범위를 사용자가 이해하게 한다. 완료 기준은 키 미설정, 네트워크 단절, 제한 응답, 빈 결과에서도 기존 자료를 유지하고 복구 경로를 제공하는 것이다. 해당 모델의 현재 제공 여부나 실제 API 호출 성공을 이번 검토에서 확인한 것은 아니다.

### 22 모듈 책임과 공통 계약 정리

`electron/main.ts`가 창 생성, 라우팅, 저장, 파일 복사, 프로젝트 입출력, 키 관리를 함께 담당한다. renderer 컴포넌트에도 내보내기 형식과 파일 분류 규칙이 들어 있다. IPC 계약은 preload와 선언 파일에 나뉘며, store 초기화가 모든 창에서 키 및 창 상태 조회를 수행한다. 남아 있는 `update-output` 채널은 현재 주된 라우팅 경로와 별도로 유지된다.

근거: [electron main.ts](/Users/hm/workspace/ai_project/Propre/electron/main.ts:182), [electron preload.ts](/Users/hm/workspace/ai_project/Propre/electron/preload.ts:19), [vite-env.d.ts](/Users/hm/workspace/ai_project/Propre/src/vite-env.d.ts:3), [App.tsx](/Users/hm/workspace/ai_project/Propre/src/App.tsx:10).

main의 창 관리자, IPC 등록, 자료 저장, 자산 관리, 키 관리 서비스를 구분한다. 데이터 타입, 런타임 스키마와 IPC 결과는 공통 계약으로 관리한다. renderer는 창 역할에 필요한 초기화만 수행하고, 편집 작업과 실제 송출용 상태 계산의 책임을 구분한다. 완료 기준은 각 책임을 UI 없이 검증할 수 있고 계약 변경을 한곳에서 관리하는 것이다.

### 23 릴리스 절차와 문서의 현재 상태 정리

버전은 `0.0.0`, 앱 ID는 예제 값이며 검사, 빌드, 패키징이 한 명령에 묶여 있다. 생성물이 ignore에 있어도 일부 `dist-electron` 파일은 Git으로 추적된다. 지원 OS와 아키텍처, 서명 및 공증, 설치 후 점검, 업데이트 전 자료 백업과 복원, 롤백 절차가 문서화되어 있지 않다. README는 MIT 라이선스를 안내하지만 LICENSE 파일과 성경 데이터 출처 및 배포 조건의 기록은 확인되지 않는다.

근거: [package.json](/Users/hm/workspace/ai_project/Propre/package.json:4), [.gitignore](/Users/hm/workspace/ai_project/Propre/.gitignore:1), [README.md](/Users/hm/workspace/ai_project/Propre/README.md:78), [improve.md](/Users/hm/workspace/ai_project/Propre/improve.md:1), [NEXT_GEN_ARCHITECTURE.md](/Users/hm/workspace/ai_project/Propre/NEXT_GEN_ARCHITECTURE.md:8).

제품 버전과 지원 환경을 정하고 재현 가능한 설치 파일 및 릴리스 확인 절차를 만든다. 기능 명세, 구현 완료 상태, 운영 확인 결과를 구분한다. 특히 현재는 독립된 main 및 chroma 동시 송출보다 단일 main 출력의 look 전환이 구현되어 있으므로 문서가 이 범위를 정확히 설명해야 한다. 데이터의 출처와 배포 조건은 확인 결과를 기록한다. 완료 기준은 담당자가 같은 절차로 패키지를 만들고 확인하며 이전 자료를 보존한 채 복구할 수 있는 것이다.

### 24 송출 성능과 메모리 기준 설정

임시 프로덕션 빌드에서 renderer JS는 약 2.84 MB였고 큰 청크 경고가 발생했다. 성경 JSON은 약 5.12 MB, 31,089개 항목이며 검색할 때마다 전체 항목을 순회한다. App은 모든 화면 컴포넌트를 정적으로 가져오고, 많은 컴포넌트가 store 전체를 구독한다. 영상 썸네일도 개별 video 요소를 사용한다. 실제 시작 시간, 프레임 손실, 장시간 메모리 증가를 측정한 결과는 없다.

근거: [App.tsx](/Users/hm/workspace/ai_project/Propre/src/App.tsx:1), [BibleService.ts](/Users/hm/workspace/ai_project/Propre/src/services/BibleService.ts:23), [MediaBin.tsx](/Users/hm/workspace/ai_project/Propre/src/components/MediaBin.tsx:66), [ControlPanel.tsx](/Users/hm/workspace/ai_project/Propre/src/components/ControlPanel.tsx:26).

창 역할별 코드 로드, 성경 장별 인덱스, 필요한 상태만 구독하는 selector, 영상 썸네일 생성과 제한을 적용한다. 지원할 자료 및 미디어 규모를 정하고 시작 시간, 조작부터 실제 화면 적용까지의 지연, 장시간 메모리를 측정한다. 완료 기준은 정한 운영 환경과 자료 규모에서 성능 예산을 충족하는 것이다.

## 권장 구조 정리

기존 React, Electron, Zustand 구조를 유지하면서 다음 책임을 분리하는 방향이 적절하다.

| 책임 | 권장 경계 | 해결하려는 문제 |
| --- | --- | --- |
| 앱 시작과 종료 | main의 조립 코드 | 시작 및 복구 순서를 명확히 한다. |
| 제어창과 출력창 및 모니터 | 창 관리자 | 창 준비, 연결 변경, 장애 상태를 관리한다. |
| IPC 계약과 검증 | 공통 계약 및 main의 핸들러 등록 | 호출 권한, 데이터 형식, 성공 및 실패를 통일한다. |
| 자료와 작업 중 초안 | 자료 저장 서비스 | 식별자, 저장 버전, 임시 저장, 백업을 관리한다. |
| 자산 | 자산 저장 서비스 | 파일 복사, 안전한 제공, 참조, 누락 및 정리를 관리한다. |
| 실제 송출 상태 | 송출 상태 계산 및 전달 서비스 | 최신 화면 상태와 적용 확인을 일관되게 유지한다. |
| 키와 AI 호출 | 권한을 제한한 main 서비스 | 비밀값을 화면에서 분리하고 요청 복구를 관리한다. |
| 편집과 라이브러리 및 설정 UI | 기존 slice와 기능별 컴포넌트 | 화면 역할과 조작 범위를 명확하게 한다. |

편집 중인 자료, 마지막 저장본, 현재 송출 중인 내용의 관계를 먼저 정의해야 한다. 편집 변경을 즉시 송출할지 현재 송출 내용을 유지할지는 명시적인 정책으로 정하고 모든 액션이 같은 규칙을 따른다.

## 권장 실행 순서와 운영 확인

1. 공통 데이터 및 IPC 계약, 지원 버전 조합, 최소 회귀 검증을 마련한다. 06, 07, 10, 14, 15가 해당한다.
2. 자료 식별자, 초안 보존, Undo, 저장 결과, 콘텐츠 모델, 플레이리스트와 백업을 정리한다. 01, 02, 04, 08, 09, 11, 16이 해당한다.
3. 송출 상태 전달, 창 복구, 단축키, 오디오와 미리보기 일치를 정리한다. 03, 05, 12, 13, 18이 해당한다.
4. 자산 관리, 설정 복원, 성경과 AI의 오류 복구, 모듈 및 릴리스 문서와 성능 기준을 보완한다. 나머지 P2 항목이 해당한다.

각 단계에서 회귀 검증을 함께 추가한다. 현장 사용 준비 확인에는 실제 설치 파일로 시작과 재실행, 다중 모니터 연결 및 분리, 송출창 재열기, 오디오 탭 전환과 전체 중단, 자료 저장과 백업 복원, 장시간 송출을 별도로 확인해야 한다. 이번 타입 검사, 번들 생성과 격리 재현 결과를 그 현장 확인의 대체 근거로 사용하지 않는다.

## 기존 개선 문서와 달라진 판단

[improve.md](/Users/hm/workspace/ai_project/Propre/improve.md:1)의 이전 검토 내용 중 상태 slice 분리, OS 암호화 도입, 일부 IPC 메서드의 타입 정의, 창 상태 알림 등은 현재 구현에 반영되어 있다. 현재 helper는 주로 화면별 라우팅을 사용하므로 과거의 이중 브로드캐스트 설명을 그대로 적용하지 않았다. announcement도 현재 상태 전달과 렌더링 경로에 연결되어 있어 항상 null이라는 과거 설명을 유지하지 않았다.

새로운 검토에서는 암호화 실패 시 평문 처리와 접근 범위, 송출 상태 재전송, 자료 식별자, 실행 취소, 저장 실패 및 현재 콘텐츠 모델의 일관성을 실제 코드와 격리 재현 결과로 다시 평가했다.
