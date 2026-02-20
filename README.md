# ProPre (ProPresenter Alternative)

ProPre는 교회 및 강연 환경을 위해 제작된 가볍고 직관적인 크로스 플랫폼 프레젠테이션 송출 소프트웨어입니다. 
Electron과 React를 기반으로 개발되었으며, 강력한 텍스트 렌더링, 성경 구절 자동 검색 및 다중 모니터 출력(Output / Stage) 기능을 지원합니다.

## ✨ 주요 기능 (Features)

- **다중 디스플레이 제어**: 메인 제어판, 실제 송출을 위한 Output 모니터, 강연자를 위한 Stage (Confidence) 모니터를 독립적으로 제어합니다.
- **성경 구절 자동 파싱 및 송출**: `요 3:16-18`과 같은 약어 및 범위 검색을 통해 즉시 성경 슬라이드를 자동 생성합니다.
- **전역 스타일링 (Global Styles)**: 
  - 일반 텍스트 슬라이드 및 성경 슬라이드에 대해 실시간으로 폰트 크기, 색상, 정렬을 한 번에 제어할 수 있는 글로벌 스타일 패널을 제공합니다.
- **자동 텍스트 스케일링 (Auto-fit Text)**: 텍스트가 화면을 넘어갈 경우 자동으로 폰트 크기를 줄여 넘침 현상을 방지합니다.
- **단축키 시스템 (Hotkeys)**: 키보드만으로 슬라이드 이동, 텍스트 지우기(F1), 모두 지우기(F2), 배경 지우기(F4) 등 신속한 라이브 제어가 가능합니다.
- **미디어 빈 (Media Bin) 및 에셋 관리**: 이미지 및 비디오(MP4 등)를 드래그 앤 드롭 또는 파일 선택으로 메인 출력 화면의 배경(Layer)으로 바로 재생합니다. 
  - 미디어 파일은 로컬 앱 데이터 폴더로 자동 복사되어 USB 이동 등 환경 변화에도 경로가 깨지지 않습니다.
- **슬라이드 편집 및 D&D**: 드래그 앤 드롭으로 슬라이드 순서를 직관적으로 변경할 수 있으며, 개별 슬라이드 수정 모달을 제공합니다.

## 🛠 기술 스택 (Tech Stack)

- **Frontend**: React 18, TypeScript, Vite, Tailwind CSS
- **State Management**: Zustand (Global Store)
- **Desktop Framework**: Electron, electron-builder
- **Drag & Drop**: @dnd-kit/core

## 🚀 설치 및 실행 방법 (Getting Started)

### 사전 요구사항
- [Node.js](https://nodejs.org/) (버전 18 이상 권장)
- npm 혹은 yarn 패키지 매니저

### 로컬 개발 시 실행 방법

1. 저장소를 클론합니다.
   ```bash
   git clone https://github.com/Cat613/Propre.git
   cd ProPre
   ```

2. 종속성 패키지를 설치합니다.
   ```bash
   npm install
   ```

3. 데스크톱 앱 개발 모드를 실행합니다. (Vite 서버와 Electron이 동시에 띄워집니다.)
   ```bash
   npm run dev
   ```

### 빌드 및 패키징 (배포용)

운영체제에 맞는 실행 파일(.exe, .dmg 등)을 생성하려면 아래 명령어를 사용합니다.

```bash
npm run build
```
빌드된 결과물은 `dist` 및 `release` 폴더에서 확인할 수 있습니다.

## 💡 단축키 가이드

- `방향키 (←, →, ↑, ↓)` 및 `Space`: 슬라이드 앞/뒤 이동
- `숫자 1~9`: 해당 번호의 슬라이드로 즉시 이동
- `F1`: 텍스트 레이어 지우기 (배경 유지)
- `F2` 또는 `Esc`: 화면 모두 지우기 (텍스트 + 배경 초기화)
- `F4`: 배경 슬라이드 지우기 (텍스트 유지)

## 📁 프로젝트 구조 요약

- `electron/`: Electron 메인 프로세스 스크립트 (`main.ts`, `preload.ts`)
- `src/`: React 프론트엔드 코드
  - `components/`: 제어판, 슬라이드 렌더러, 툴바 등 UI 요소
  - `hooks/`: 커스텀 훅 (`useHotkeys.ts` 등)
  - `utils/`: 유틸리티 함수 (`bibleParser.ts` 등)
  - `store.ts`: Zustand 상태 관리 정의
  - `types.ts`: TypeScript 타입 선언 파일

## 📄 라이선스

이 프로젝트는 MIT License를 따릅니다.
