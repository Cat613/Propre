# ProPre (프로프리) 차세대 아키텍처 로드맵

현재 프로프리의 구조를 실제 하이엔드 방송 S/W(ProPresenter 등) 수준으로 고도화하기 위한 단계별 상세 구현 로드맵입니다. 가장 파급력이 크고 시스템 안정성을 높일 수 있는 순서대로 우선순위를 배정했습니다.

---

## 🎯 Phase 1: 다중 독립 레이어 시스템 (Multi-Layer Architecture)
가장 시급한 과제입니다. 현재 "배경 + 텍스트"로 묶여 있는 렌더링 구조를 6개의 완전 독립 레이어로 분리하여 방송 사고를 방지하고 유연성을 극대화합니다.

### 1. 상태(State) 구조 변경
- [ ] `src/types.ts` 내 `OutputState` 리팩토링
  - `background`, `slide` 대신 `layers: LayerState` 객체 도입
  - 레이어의 Z-Index 역순: `Audio` (백그라운드), `Background` (루프 미디어), `Slide` (가사/성경), `Announcement` (광고), `Prop` (로고/시계), `Message` (하단 자막)
- [ ] 각 레이어별 독립 속성 부여
  - 예: `Message` 레이어는 스크롤 방향, 속도 등의 속성을 가짐

### 2. Zustand Store (`editorSlice`, `mediaSlice`) 분할 및 재설계
- [ ] `triggerMedia(layerType, mediaItem)` 등 액션을 범용적으로 수정
- [ ] 기존 `clearAll()` 외에 `clearLayer('layerName')` 메서드 구현
- [ ] Audio 플레이어의 상태를 앱 내부 상태가 아닌 IPC `OutputState` 레이어의 일부로 병합

### 3. 화면 렌더러 (`OutputDisplay.tsx`) 개편
- [ ] Z-Index를 기반으로 각 레이어를 독립적인 래퍼(div)로 분리
- [ ] 화면 전환(Transition) 효과 초기 도입 (framer-motion 또는 CSS Transition 활용해 페이드 인/아웃 적용)

---

## 🎯 Phase 2: 다중 출력 라우팅 및 테마 룩스 (Multi-Screen Routing & Looks)
메인 화면, 로비, 방송용 크로마키 자막 등 여러 목적에 맞게 송출 화면을 다변화합니다. 1단계의 레이어 시스템 기반 위에서 동작합니다.

### 1. 다중 윈도우 지원 (Electron Main)
- [ ] `electron/main.ts`의 윈도우 생성 로직 수정
- [ ] `ControlToolbar`에서 사용자가 N개의 'Output Window'를 동적으로 켜고 끌 수 있는 기능 추가
- [ ] 윈도우별 식별자(ID) 부여 (`Main`, `Broadcast (Chroma)`, `Stage` 등)

### 2. 테마 "Looks" 시스템 구현
- [ ] `LooksState` (송출 라우팅 룰셋) 정의
  - 각 스크린 ID별로 보여줄 레이어 설정 (예: 방송용 창은 Background 레이어 표시 안함)
  - 각 스크린 ID별 오버라이드 스타일 설정 (글로벌 폰트 크기, 위치, 텍스트 아웃라인 강제 적용 여부)
- [ ] `settingsSlice` 또는 새로운 `routingSlice`에서 스크린별 룰셋 관리 UI (행렬 형태의 체크박스 그리드) 구현

### 3. 개별 라우팅 통신 구조 도입
- [ ] `syncOutputState()` 헬퍼 수정
  - 단순히 객체를 뿌리는 것이 아니라, 각 윈도우가 자신이 받을 설정(Look)에 맞게 최종 가공된 데이터를 IPC로 필터링해서 받을 수 있도록 고도화

---

## 🎯 Phase 3: 요소 기반 슬라이드 엔진 (Element-Based Editor)
텍스트 덩어리를 벗어나 파워포인트 수준의 오브젝트 단위 편집기를 도입하여 디자인 자유도를 폭발적으로 높입니다.

### 1. Slide 데이터 모델 마이그레이션 도구 작성
- [ ] 기존 `content: string` 형태를 `elements: SlideElement[]` 형태로 변환하는 레거시 변환 유틸리티 작성
- [ ] `SlideElement` 타입 정의 (텍스트, 도형, 이미지 등)
- [ ] X, Y 뷰포트 상대 좌표계(%) 개념 도입

### 2. WYSIWYG 캔버스 에디터 구현 (`ControlPanel.tsx` 업그레이드)
- [ ] `PreviewPanel`을 단순 미리보기가 아닌 '인터랙티브 캔버스'로 전환
- [ ] 텍스트 요소 클릭 시 포커스 및 외곽선 표시 (선택 상태)
- [ ] 드래그 앤 드롭 객체 이동 및 리사이징 로직 구현 (react-rnd 등 라이브러리 검토)
- [ ] 우측 Inspector 패널 신설
  - 선택된 요소의 폰트, 색상, 정렬, 윤곽선, 그림자 등을 디테일하게 개별 조정하는 속성 창 구현

### 3. 디테일 렌더러 (`ScaledSlide.tsx` 완전 개편)
- [ ] 기존 텍스트 중앙 정렬 렌더링 폐기
- [ ] `elements` 배열을 map으로 순회하여 절대 좌표(Absolute Position)와 크기를 1920x1080 비율에 맞추어 정확하게 렌더링하는 컴포넌트트리로 교체 
