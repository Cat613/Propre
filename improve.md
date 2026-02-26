ProPre 코드 리뷰 & 상용화 개선 보고서
분석일: 2026-02-26 | 대상 버전: 0.0.0 (package.json)

요약
ProPre는 Electron + Vite + React + Zustand 기반의 예배/발표용 프레젠테이션 소프트웨어로, Phase 1(레이어 시스템)과 Phase 2(멀티스크린 라우팅)이 구현되어 있습니다. Phase 3(요소 기반 캔버스 에디터)는 타입 정의와 렌더러가 부분적으로 추가된 상태입니다.

전반적으로 아키텍처는 방향이 올바르지만, 상용 소프트웨어 수준에 도달하기 위해 해결해야 할 심각한 보안·안정성·UX 문제들이 다수 확인되었습니다.

🔴 [Critical] 보안 취약점
1. webSecurity: false — 가장 시급한 문제
파일: 
electron/main.ts
L30, L74, L111

diff
- webSecurity: false,  // 모든 창에 적용됨
+ webSecurity: true,
문제: webSecurity: false는 Same-Origin Policy를 비활성화하여 renderer에서 임의 로컬 파일 접근이 가능해집니다. Electron 앱에서 이는 원격 콘텐츠 렌더링 시 전체 파일시스템 노출로 이어질 수 있는 치명적 취약점입니다.

해결: 로컬 미디어 파일 접근을 위한 커스텀 프로토콜을 등록합니다.

typescript
// electron/main.ts: app.whenReady() 이전에 추가
import { protocol, net } from 'electron'
protocol.registerSchemesAsPrivileged([
  { scheme: 'propre-media', privileges: { secure: true, supportFetchAPI: true, stream: true } }
])
// app.whenReady() 내부에서:
protocol.handle('propre-media', (request) => {
  const url = request.url.slice('propre-media://'.length)
  return net.fetch(`file://${decodeURIComponent(url)}`)
})
그리고 미디어 URL을 file://... 대신 propre-media://...로 변환하여 사용합니다.

2. Gemini API Key가 localStorage에 평문 저장
파일: 
src/store/slices/settingsSlice.ts
L14

diff
- geminiApiKey: localStorage.getItem('propre_gemini_key'),
문제: API 키가 브라우저의 localStorage에 평문으로 저장됩니다. Electron 앱에서도 DevTools를 통해 쉽게 노출됩니다.

해결: Electron의 safeStorage API를 사용하여 OS 수준 암호화를 적용합니다. electron-store의 encryptionKey 옵션 또는 safeStorage.encryptString()을 활용하세요.

typescript
// electron/main.ts에 IPC 핸들러 추가
import { safeStorage } from 'electron'
ipcMain.handle('set-api-key', (_e, key: string) => {
  const encrypted = safeStorage.encryptString(key)
  store.set('geminiKeyEncrypted', encrypted.toString('base64'))
})
ipcMain.handle('get-api-key', () => {
  const b64 = store.get('geminiKeyEncrypted') as string | undefined
  if (!b64) return null
  return safeStorage.decryptString(Buffer.from(b64, 'base64'))
})
3. IPC 브릿지에서 광범위한 any 타입 사용
파일: 
electron/preload.ts
L19, L55-58
, 
src/vite-env.d.ts
L12-16

typescript
// vite-env.d.ts: any[]를 실제 타입으로 교체
getLibrary: () => Promise<Presentation[]>       // any[] → Presentation[]
saveToLibrary: (presentation: Presentation) => Promise<boolean>
deleteFromLibrary: (id: string) => Promise<Presentation[]>
getPlaylist: () => Promise<PlaylistItem[]>
savePlaylist: (playlist: PlaylistItem[]) => Promise<boolean>
문제: 
getLibrary
, 
saveToLibrary
 등 핵심 IPC 메서드들이 any 타입을 사용하여 TypeScript의 타입 안전성이 무효화됩니다. 데이터 형식 변경 시 런타임 에러가 발생해도 컴파일 타임에 감지되지 않습니다.

🟠 [High] 아키텍처 문제
4. IPC 이중 브로드캐스트 (레거시 + 라우팅 동시 발송)
파일: 
src/store/helpers.ts
L44-57

typescript
// 현재: 매 상태 변경마다 2번 IPC를 보냄
// 1) route-screen-update (screenId별 라우팅)
// 2) update-output       (레거시 전체 브로드캐스트)
문제: 모든 상태 변경 시 각 스크린마다 1회 + 레거시 브로드캐스트 1회 추가 발송 = 불필요한 IPC 직렬화/역직렬화가 중복 수행됩니다. 또한 OutputDisplay는 update-screen과 update-output 두 채널을 독립적으로 받을 수 있어 충돌 가능성이 있습니다.

해결: 레거시 브로드캐스트를 완전히 제거하고 route-screen-update만 사용합니다. 
OutputDisplay
는 screenId를 기반으로 자신에게 해당하는 update-screen만 수신하도록 통일합니다.

5. 
Slide
 타입의 레거시/Phase 3 이중 아키텍처 공존
파일: 
src/types.ts
L79-90

typescript
export interface Slide {
    // --- Legacy / Backward Compatibility ---
    content?: string       // 레거시 텍스트 필드
    styles?: SlideStyles   // 레거시 스타일
    backgroundUrl?: string // 레거시 배경
    // --- Phase 3 Architecture ---
    elements?: CanvasElement[]  // 새 아키텍처
}
문제: 두 모델이 선택적(optional) 필드로 공존하여 
ScaledSlide.tsx
에서 slide.elements가 있으면 새 렌더러, 없으면 레거시 렌더러를 사용하는 분기가 발생합니다. 새로 만든 슬라이드와 레거시 슬라이드의 동작이 일관되지 않으며, 저장된 라이브러리 파일의 데이터 무결성을 보장하기 어렵습니다.

해결: 마이그레이션 유틸리티를 작성하여 
loadLibrary()
 시점에 레거시 슬라이드를 elements 형식으로 자동 변환합니다.

typescript
// src/utils/migrateSlide.ts
export function migrateLegacySlide(slide: Slide): Slide {
    if (slide.elements && slide.elements.length > 0) return slide  // 이미 마이그레이션됨
    if (!slide.content) return slide  // 빈 슬라이드
    const textElement: TextElement = {
        id: generateId(), type: 'text',
        x: 5, y: 5, width: 90, height: 90, zIndex: 10,
        text: slide.content,
        styles: slide.styles || {}
    }
    return { ...slide, elements: [textElement], canvasWidth: 1920, canvasHeight: 1080 }
}
6. announcement 레이어가 스텁(stub)으로 남아 있음
파일: 
src/store/helpers.ts
L13

typescript
announcement: null, // To be implemented
AdvancedLayersPanel.tsx
에 UI가 있지만 
syncOutputState
에서 announcement는 항상 null로 고정되어 있습니다. 사용자가 announcement를 설정해도 실제 출력에 반영되지 않습니다.

7. 앱 시작 시 무조건 출력 윈도우가 열림
파일: 
electron/main.ts
L143-146

typescript
app.whenReady().then(() => {
    createMainWindow()
    createOutputWindow('main')  // 항상 출력 창을 염
    createStageWindow()         // 항상 스테이지 창을 염
})
문제: 앱 시작 시 항상 출력 창과 스테이지 창이 열려, 단일 모니터 환경에서 사용하거나 앱을 켜자마자 예기치 않은 블랙 스크린이 표시됩니다.

해결: electron-store에 이전 세션의 출력 활성화 상태를 저장하고 복원합니다.

typescript
const wasOutputActive = store.get('wasOutputActive', false) as boolean
if (wasOutputActive) createOutputWindow('main')
ipcMain.handle('toggle-output', () => {
    // ...기존 로직...
    store.set('wasOutputActive', newState)
})
🟡 [Medium] UX & 안정성 문제
8. Undo/Redo(실행 취소) 기능 없음
슬라이드 삭제, 내용 변경 등의 작업에 Ctrl+Z 실행 취소가 없습니다. 상용 발표 소프트웨어의 필수 기능입니다.

해결: Zustand의 미들웨어로 히스토리를 구현합니다.

typescript
import { temporal } from 'zundo'
export const usePresentationStore = create<StoreState>()(
    temporal(
        (...a) => ({ ...allSlices }),
        { limit: 30 }  // 최대 30단계 undo
    )
)
// 컴포넌트에서: const { undo, redo } = useTemporalStore()
9. 미저장 변경사항에 대한 경고 없음
발표를 편집하다가 다른 발표를 선택하거나 앱을 종료할 때 저장되지 않은 데이터가 조용히 사라집니다.

해결:

editorSlice에 isDirty: boolean 상태 추가
app.on('before-quit')에서 IPC를 통해 확인 다이얼로그 표시
브라우저 창 닫기 전 beforeunload 이벤트 활용
10. 에러 알림 시스템 없음
라이브러리 로드/저장 실패, AI 추출 오류 등이 모두 console.error()로만 처리되어 사용자는 오류가 발생했는지 알 수 없습니다.

해결: 토스트 알림 시스템을 구현합니다.

typescript
// src/store/slices/notificationSlice.ts
interface Toast { id: string; message: string; type: 'success' | 'error' | 'info' }
// 모든 catch 블록에서:
get().addToast({ type: 'error', message: '라이브러리 로드에 실패했습니다.' })
11. 
ScaledSlide
의 폰트 크기 자동조절이 polling 방식
파일: 
src/components/ScaledSlide.tsx
L58-86

typescript
if (textEl.scrollHeight > maxHeight) {
    setAutoFontSize(currentSize * 0.9)  // 10%씩 줄이며 재렌더링 반복
}
문제: 텍스트가 넘칠 경우 0.9 배씩 줄이는 방식은 여러 번의 무의미한 렌더링을 유발합니다. 또한 ResizeObserver 대신 window.resize만 감지하므로 패널 크기 조절 시 반응하지 않습니다.

해결: ResizeObserver로 컨테이너 크기 변화를 감지하고, 이진 탐색(binary search)으로 최적 폰트 크기를 단번에 계산합니다.

12. 핫키 충돌 및 모달 내부 키 이벤트 처리
파일: 
src/hooks/useHotkeys.ts
, 
src/components/ControlPanel.tsx
L26-64

useHotkeys
 훅과 
ControlPanel
에 중복 keydown 이벤트 리스너가 등록되어 있습니다. 모달 상태를 isEditModalOpen 플래그로 확인하지만 EditModal, BulkEditModal, SettingsModal 등 각 모달이 별도 플래그를 관리합니다. 통합 모달/포커스 관리 시스템이 필요합니다.

🟡 [Medium] 코드 품질 문제
13. 
package.json
의 앱 메타데이터 미설정
파일: 
package.json
L4, L41

json
{
    "version": "0.0.0",           // 제품 버전 없음
    "build": {
        "appId": "com.example.propresenterlite",  // 예시 ID 그대로
        "productName": ???,       // 없음
        "win": ???,               // Windows 빌드 설정 없음
        "linux": ???              // Linux 빌드 설정 없음
    }
}
Windows 배포를 위한 win 섹션(NSIS 인스톨러, 서명 설정)이 없습니다.

14. electron-store에 스키마 검증 없음
파일: 
electron/main.ts
L12

typescript
const store = new Store()  // 스키마 없음
electron-store는 JSON 스키마를 통한 데이터 검증을 지원합니다. 스키마 없이 사용하면 저장된 데이터가 손상되거나 형식이 바뀌어도 감지되지 않습니다.

typescript
const store = new Store<{
    library: Presentation[],
    playlist: PlaylistItem[],
    outputDisplayId?: number,
}>({
    schema: {
        library: { type: 'array', default: [] },
        playlist: { type: 'array', default: [] },
    }
})
15. 라이브러리 슬라이드 제목 자동 생성 로직이 불안정
파일: 
src/store/slices/librarySlice.ts
L22

typescript
const title = slides.find(s => s.content)?.content.split('\n')[0].substring(0, 20) || 'Untitled'
Phase 3에서 content 대신 elements를 사용하는 슬라이드는 제목이 항상 'Untitled Presentation'이 됩니다.

16. 
aiService.ts
의 모델명 오류 가능성
파일: 
src/services/aiService.ts
L29

typescript
model: "gemini-3-flash-preview",  // 실제 최신 모델명 확인 필요
환경변수 또는 설정으로 모델명을 외부화하는 것이 권장됩니다.

🔵 [Low / Commercial Feature] 상용 소프트웨어 필수 기능
17. 자동 업데이트 (Auto-Update) 없음
electron-builder를 사용 중이므로 electron-updater를 추가하여 GitHub Releases 또는 사설 업데이트 서버를 연동합니다.

bash
npm install electron-updater
typescript
// electron/main.ts
import { autoUpdater } from 'electron-updater'
app.whenReady().then(() => autoUpdater.checkForUpdatesAndNotify())
18. 에러 경계(Error Boundary) 없음
React 컴포넌트 트리 내 오류가 전체 앱을 흰 화면으로 만듭니다. ErrorBoundary 컴포넌트를 루트에 추가해야 합니다.

typescript
// src/components/ErrorBoundary.tsx
class ErrorBoundary extends React.Component {
    componentDidCatch(error: Error) {
        // 에러 로깅 서비스 전송 (예: Sentry)
    }
    render() {
        if (this.state.hasError) return <CrashFallbackScreen />
        return this.props.children
    }
}
19. 테스트 인프라 완전 부재
유닛 테스트, 통합 테스트, E2E 테스트가 전혀 없습니다. 상용 릴리즈 전에 최소한 핵심 비즈니스 로직에 대한 테스트가 필요합니다.

bash
npm install -D vitest @testing-library/react @testing-library/user-event
우선순위 테스트 대상:

syncOutputState
 헬퍼 (라우팅 로직)
bibleParser.ts
 (파싱 정확도)
migrateLegacySlide 유틸리티
20. 접근성 (Accessibility) 미지원
키보드 네비게이션 시 포커스 인디케이터 없음
ARIA 레이블 없음 (aria-label, role 등)
색상 대비 최소 기준 미달 가능성
21. 국제화 (i18n) 없음
UI 텍스트가 하드코딩된 한국어로 되어 있어 다국어 지원이 불가능합니다. react-i18next 또는 i18next를 사용하여 번역 파일로 분리하는 것을 권장합니다.

📋 우선순위 정리
우선순위	항목	영향도	난이도
🔴 즉시	webSecurity: false 제거 + 커스텀 프로토콜	보안	중
🔴 즉시	API Key 암호화 저장 (safeStorage)	보안	중
🟠 단기	IPC 이중 브로드캐스트 제거	안정성	하
🟠 단기	레거시 Slide → elements 마이그레이션	아키텍처	중
🟠 단기	에러 토스트 알림 시스템 구현	UX	하
🟠 단기	announcement 레이어 완성	기능 완성	중
🟡 중기	Undo/Redo (zundo 미들웨어)	UX	중
🟡 중기	미저장 변경사항 경고	UX	하
🟡 중기	electron-store 스키마 추가	안정성	하
🟡 중기	
vite-env.d.ts
 any 타입 제거	타입 안전성	하
🟡 중기	앱 시작 시 출력 창 상태 복원	UX	하
🔵 장기	자동 업데이트 (electron-updater)	제품화	중
🔵 장기	에러 경계 + 크래시 리포팅	안정성	중
🔵 장기	테스트 인프라 구축 (vitest)	품질	높
🔵 장기	접근성 (ARIA, 키보드 네비게이션)	품질	높
🔵 장기	i18n 다국어 지원	기능	높
