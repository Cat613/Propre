import { useEffect, useState } from 'react'
import { createPortal } from 'react-dom'
import type { AppUpdateState } from '../../shared/app-update'
import { usePresentationStore } from '../store'
import { useModalGuard } from '../hooks/useModalGuard'

export default function AppUpdatePanel() {
  const [state, setState] = useState<AppUpdateState>()
  const [error, setError] = useState('')
  const [guide, setGuide] = useState(false)
  const output = usePresentationStore((s) => s.isOutputEnabled || s.isStageEnabled)
  const service = usePresentationStore(
    (s) => !!s.serviceSession && s.serviceSession.status !== 'finished',
  )
  useModalGuard(guide, () => setGuide(false))
  const accept = (next: AppUpdateState) =>
    setState((current) => (!current || next.revision >= current.revision ? next : current))
  useEffect(() => {
    if (!window.ipcRenderer?.getAppUpdate) return
    const off = window.ipcRenderer.on('app-update-changed', accept)
    void window.ipcRenderer
      .getAppUpdate()
      .then(accept)
      .catch(() => setError('업데이트 상태를 불러오지 못했습니다.'))
    return off
  }, [])
  if (!state) return error ? <p role="status">{error}</p> : null
  const available = ['available', 'opening', 'download-opened'].includes(state.status)
  const download = async () => {
    setError('')
    try {
      accept(await window.ipcRenderer.downloadAppUpdate())
    } catch {
      setError('다운로드를 열지 못했습니다. 잠시 뒤 다시 시도해주세요.')
    }
  }
  const action = async () => {
    if (available) {
      setGuide(true)
      return
    }
    setError('')
    try {
      accept(await window.ipcRenderer.checkAppUpdate())
    } catch {
      setError('업데이트 확인에 실패했습니다. 잠시 뒤 다시 시도해주세요.')
    }
  }
  const labels: Record<AppUpdateState['status'], string> = {
    disabled: '업데이트 주소 미설정',
    idle: '업데이트 확인',
    checking: '새 버전 확인 중…',
    available: `v${state.version} 다운로드`,
    opening: '다운로드 여는 중…',
    'download-opened': '다운로드·교체 안내',
    error: '업데이트 다시 확인',
  }
  const busy = state.status === 'opening'
  return (
    <>
      <div
        className="flex min-w-0 flex-wrap items-center gap-x-2 gap-y-1 text-[11px] text-gray-400"
        aria-label="앱 업데이트"
      >
        <span>ProPre v{state.currentVersion}</span>
        <button
          type="button"
          className="rounded px-2 py-1 text-blue-300 hover:bg-white/5 disabled:opacity-50"
          disabled={['disabled', 'checking', 'opening'].includes(state.status)}
          onClick={() => void action()}
        >
          {labels[state.status]}
        </button>
        <span role="status">
          {error ||
            state.message ||
            (state.status === 'idle' && state.checkedAt ? '최신 버전입니다.' : '')}
        </span>
      </div>
      {guide &&
        createPortal(
          <div
            className="fixed inset-0 z-[200] flex items-center justify-center bg-black/70 p-4"
            onClick={() => setGuide(false)}
          >
            <div
              role="dialog"
              aria-modal="true"
              aria-labelledby="update-guide-title"
              data-modal="true"
              className="w-full max-w-lg rounded-xl border border-gray-700 bg-gray-900 p-6 text-sm text-gray-200 shadow-xl"
              onClick={(event) => event.stopPropagation()}
            >
              <h2 id="update-guide-title" className="mb-3 text-lg font-semibold">
                새 버전 다운로드와 앱 교체
              </h2>
              <p className="mb-3">
                설치 파일은 기본 브라우저에서 받습니다. 앱 교체는 직접 진행해주세요.
              </p>
              {(output || service) && (
                <p className="mb-3 text-amber-300">
                  예배·송출 중에도 다운로드 안내를 열 수 있습니다. 앱 교체는 예배와 송출을 모두 마친
                  뒤 진행해주세요.
                </p>
              )}
              <ol className="list-decimal space-y-2 pl-5">
                <li>아래 버튼으로 설치 파일을 받고 브라우저에서 다운로드 완료를 확인합니다.</li>
                <li>예배·송출을 마치고 자동 저장 상태를 확인한 뒤 ProPre를 종료합니다.</li>
                <li>
                  받은 DMG를 열고 ProPre를 Applications(응용 프로그램) 폴더로 드래그해 기존 앱을
                  교체합니다.
                </li>
                <li>
                  ProPre를 다시 실행하고 하단의 버전을 확인합니다. 기존 자료 폴더는 삭제하지 마세요.
                </li>
              </ol>
              <p className="mt-3 text-xs text-gray-400">
                서명·공증 없는 배포본은 macOS에서 실행 확인을 요청할 수 있습니다. 신뢰할 수 있는
                배포본을 받은 경우 시스템 설정 → 개인정보 보호 및 보안에서 실행 허용 안내를
                확인하세요.
              </p>
              <p role="status" className="mt-3 text-blue-200">
                {error || state.message}
              </p>
              <div className="mt-5 flex justify-end gap-2">
                <button
                  type="button"
                  className="rounded border border-gray-600 px-3 py-2"
                  onClick={() => setGuide(false)}
                >
                  닫기
                </button>
                <button
                  type="button"
                  className="rounded bg-blue-600 px-3 py-2 text-white disabled:opacity-50"
                  disabled={busy || !available}
                  onClick={() => void download()}
                >
                  {busy
                    ? '다운로드 여는 중…'
                    : state.status === 'download-opened'
                      ? '설치 파일 다시 받기'
                      : '설치 파일 받기'}
                </button>
              </div>
            </div>
          </div>,
          document.body,
        )}
    </>
  )
}
