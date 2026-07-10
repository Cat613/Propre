# ProPre (ProPresenter Alternative) 기술 명세서 (Technical Specification)

## 1. 프로젝트 개요 (Overview)
**ProPre**는 교회 및 강연 환경을 위해 제작된 가볍고 직관적인 크로스 플랫폼 프레젠테이션 송출 소프트웨어입니다. 고가의 하이엔드 방송 소프트웨어(예: ProPresenter)를 대체할 수 있는 핵심 기능을 웹 기술 기반의 데스크톱 앱으로 구현하는 것을 목표로 합니다.

## 2. 기술 스택 (Tech Stack)
- **Framework (Desktop)**: Electron, electron-builder
- **Framework (Frontend)**: React 18, Vite
- **Language**: TypeScript
- **State Management**: Zustand (전역 상태 관리), Zundo (Undo/Redo 지원)
- **Styling**: Tailwind CSS, clsx, tailwind-merge
- **Drag & Drop**: @dnd-kit/core, @dnd-kit/sortable
- **UI Components & Icons**: lucide-react, react-resizable-panels, react-rnd
- **Storage/Persistence**: electron-store
- **AI/External APIs**: @google/genai (제미나이 API 연동 가능성 포함)

## 3. 시스템 아키텍처 (System Architecture)

### 3.1. 멀티 윈도우 기반 구조 (Multi-Window Structure)
Electron의 Main Process가 여러 Renderer Process 창을 관리하여 독립적인 화면 송출을 지원합니다.
- **Main Window (Control Panel)**: 사용자가 프레젠테이션을 조작하고 편집하는 메인 컨트롤 창입니다.
- **Output Window**: 실제 청중에게 보여지는 프로젝터/디스플레이 송출용 화면입니다.
- **Stage Window (Confidence Monitor)**: 강연자나 찬양 인도자를 위한 프롬프터 화면으로, 현재 슬라이드와 다음 슬라이드를 함께 보여줍니다.

### 3.2. 상태 동기화 및 IPC 통신
- Main Process와 Renderer Process 간의 실시간 통신을 통해 화면을 제어합니다.
- Control Panel 창에서 슬라이드 변경, 배경 교체 등의 액션을 수행하면, `OutputState`와 `StageData`가 구성되어 IPC 이벤트를 통해 Output 창과 Stage 창에 즉각적으로 브로드캐스팅됩니다.

### 3.3. 상태 관리 구조 (Zustand Modularization)
`src/store/` 디렉토리를 중심으로 상태가 도메인별로 분리(Slice)되어 관리됩니다.
- `editorSlice`: 슬라이드 편집 상태 (선택된 슬라이드, 포커스 등)
- `librarySlice`: 프레젠테이션(예배/행사) 라이브러리 및 플레이리스트 관리
- `mediaSlice`: 미디어 빈(Media Bin)에 등록된 에셋(이미지, 비디오 등) 상태
- `settingsSlice`: 전역 설정, 단축키, 디스플레이 매핑 정보
- `stageSlice`: Stage(강연자용) 모니터 표시 정보 (현재/다음 슬라이드)
- `toastSlice`: 알림 메시지 상태

Zundo 패키지의 `temporal` 미들웨어를 사용하여 `slides`, `globalSlideStyle` 등 핵심 콘텐츠 상태의 **실행 취소(Undo) / 다시 실행(Redo)** 기능을 지원합니다. 메모리 보호를 위해 히스토리 제한(Limit: 50)을 적용합니다.

## 4. 렌더링 엔진 및 레이어 시스템 (Rendering Engine)

최신 로드맵(Phase 1~3)에 따라 "배경 + 텍스트"의 단순 구조에서 벗어나 **다중 독립 레이어 시스템(Multi-Layer Architecture)**을 채택하고 있습니다.

### 4.1. 출력 상태 (OutputState) 레이어 구성 (`src/types.ts`)
Z-Index 역순으로 아래와 같은 독립적인 레이어들이 오버레이되어 최종 화면을 구성합니다 (`LayerState`).
1. **Audio**: 배경 음악 및 오디오 플레이어 로직
2. **Background**: 이미지, 루프되는 비디오 등 백그라운드 미디어 레이어
3. **Slide**: 가사, 성경 구절, 메인 프레젠테이션 텍스트 및 요소 (`CanvasElement`)
4. **Announcement**: 긴급 광고 슬라이드용 별도 레이어
5. **Prop**: 시계, 타이머, 로고 등 픽스(Fix)된 컴포넌트
6. **Message**: 하단 자막(스크롤링 텍스트 등) 레이어

### 4.2. 스케일링 렌더링 (`ScaledSlide.tsx`)
- 다양한 디스플레이 해상도 환경에서도 동일한 비율과 배치를 보장하기 위해 가상의 캔버스(Virtual Canvas, 예: 1920x1080)를 기준으로 좌표를 계산합니다.
- `Auto-fit Text` 로직이 포함되어 텍스트가 캔버스를 초과할 경우 폰트 크기를 동적으로 조절하여 오버플로우를 방지합니다.

## 5. 주요 데이터 모델 (Data Models)

### 5.1. 프레젠테이션 및 플레이리스트
- **Presentation**: 프레젠테이션 단위. `id`, `title`, `slides[]`로 구성.
- **PlaylistItem**: 좌측 플레이리스트 패널에 포함되는 항목들의 래퍼.

### 5.2. Slide 및 요소 (Elements) 기반 에디터
기존 단순 텍스트(`content: string`) 기반에서 `elements: SlideElement[]` 형태로 마이그레이션 중입니다. (Phase 3)
- `TextElement`: 텍스트 콘텐츠 및 개별 스타일(글꼴, 색상, 정렬 등)
- `MediaElement`: 개별 슬라이드 내 포함되는 이미지/비디오
- `ShapeElement`: 도형(사각형, 원형, 선) 요소 지원
각 요소는 캔버스 내 절대 좌표(`x`, `y`)와 크기(`width`, `height`), `zIndex`, `rotation` 등의 속성을 가집니다.

## 6. 주요 기능 구현 (Key Features Implementation)
- **성경 파싱 (BiblePanel.tsx)**: 정규식을 통한 성경 약어/장/절 파싱으로 즉시 슬라이드 객체를 배열로 자동 생성합니다.
- **글로벌 스타일 (GlobalStylePanel.tsx)**: 전체 슬라이드 폰트, 색상, 정렬 및 텍스트 외곽선/그림자 효과를 `globalSlideStyle`을 통해 한 번에 동기화 적용합니다.
- **미디어 관리 (MediaBin.tsx)**: Electron의 네이티브 파일 시스템 API를 활용해 드래그 앤 드롭된 파일을 로컬 앱 데이터 폴더로 안전하게 복사하고(`fs`), 경로가 깨지지 않도록 관리합니다.

## 7. 향후 아키텍처 로드맵 (Next Gen Roadmap)
`NEXT_GEN_ARCHITECTURE.md`에 명시된 주요 개발 과제는 다음과 같습니다.
1. **완전 독립된 레이어 시스템 분리**: 기존 통합 렌더러 분해 및 z-index 래퍼 전환
2. **다중 출력 라우팅 & 테마(Looks) 시스템**: 메인, 로비, 방송용(크로마키 자막) 창을 분리하고 윈도우별 식별자에 맞춰 필터링된 레이어를 쏘아주는 라우팅 룰셋 적용
3. **WYSIWYG 캔버스 에디터**: 뷰포트 상대 좌표계를 통해 파워포인트 수준의 요소 단위 드래그/리사이징 인터랙티브 에디터 구축
