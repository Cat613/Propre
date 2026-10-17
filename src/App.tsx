import { lazy, Suspense, useEffect, useState } from 'react'
import ErrorBoundary from './components/ErrorBoundary'
const Control = lazy(() => import('./components/ControlPanel'))
const Output = lazy(() => import('./components/OutputDisplay'))
const Stage = lazy(() => import('./components/StageDisplay'))
const PdfHelper = lazy(() => import('./components/PdfOutputHelper'))
const Preparation = lazy(() => import('./components/PreparationPreview'))
function ControlRoot() {
  const [ready, setReady] = useState(false),
    [error, setError] = useState(false)
  useEffect(() => {
    let canceled = false,
      dispose: (() => void) | undefined
    void import('./store/runtime')
      .then((m) => m.initializeControl())
      .then(
        (cleanup) => {
          if (canceled) cleanup()
          else {
            dispose = cleanup
            setReady(true)
          }
        },
        () => setError(true),
      )
    return () => {
      canceled = true
      dispose?.()
    }
  }, [])
  return error ? (
    <div className="p-8 bg-gray-900 text-white h-screen">
      자료를 불러오지 못했습니다. <button onClick={() => location.reload()}>다시 시도</button>
    </div>
  ) : ready ? (
    <Control />
  ) : (
    <div className="h-screen bg-gray-900 text-white p-8">자동 저장 자료를 불러오는 중…</div>
  )
}
export default function App() {
  const role = window.ipcRenderer?.role || 'control'
  useEffect(() => {
    document.title =
      role === 'control'
        ? 'ProPre · 컨트롤'
        : role === 'main'
          ? 'ProPre · 메인 송출'
          : 'ProPre · 모니터'
  }, [role])
  return (
    <ErrorBoundary>
      <Suspense fallback={<div className="h-screen bg-black" />}>
        {role === 'pdf-helper' ? (
          <PdfHelper />
        ) : role === 'control' ? (
          <ControlRoot />
        ) : role === 'preview' ? (
          <Preparation />
        ) : role === 'stage' ? (
          <Stage />
        ) : (
          <Output />
        )}
      </Suspense>
    </ErrorBoundary>
  )
}
