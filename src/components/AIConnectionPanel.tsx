import { useEffect, useState } from 'react'
import { AI_TOOL_INFO, type AIConnectionState, type AIPermission } from '../../shared/automation'
const initial: AIConnectionState = {
  enabled: false,
  permission: 'read',
  connected: false,
  lastActivityAt: null,
  lastOperation: null,
}
export default function AIConnectionPanel() {
  const [state, setState] = useState(initial)
  const [permission, setPermission] = useState<AIPermission>('read')
  const [format, setFormat] = useState<'codex' | 'json'>('codex')
  const [busy, setBusy] = useState(false)
  const [message, setMessage] = useState('')
  useEffect(() => {
    let active = true
    const update = (value: AIConnectionState) => {
      if (active) {
        setState(value)
        setPermission(value.permission)
      }
    }
    const load = () =>
      window.ipcRenderer
        .getAIConnection()
        .then(update)
        .catch(() => {
          if (active) setMessage('연결 상태를 확인하지 못했습니다. 다시 열어주세요.')
        })
    void load()
    const dispose = window.ipcRenderer.on('ai-connection-changed', update)
    const timer = setInterval(() => {
      void load()
    }, 15000)
    return () => {
      active = false
      dispose()
      clearInterval(timer)
    }
  }, [])
  const change = async (enabled: boolean) => {
    setBusy(true)
    setMessage('')
    try {
      setState(await window.ipcRenderer.setAIConnection(enabled, permission))
      setMessage(
        enabled
          ? '연결을 허용했습니다. AI 클라이언트를 연결한 뒤 이 설정창을 닫아주세요.'
          : 'AI 연결을 해제했습니다.',
      )
    } catch {
      setMessage('연결을 변경하지 못했습니다. 다시 시도해주세요.')
    } finally {
      setBusy(false)
    }
  }
  const copy = async () => {
    try {
      await window.ipcRenderer.copyAIConnectionConfig(format)
      setMessage('연결 설정을 복사했습니다. AI 클라이언트에 추가하고 연결해주세요.')
    } catch {
      setMessage('설정을 복사하지 못했습니다. 다시 시도해주세요.')
    }
  }
  return (
    <section className="space-y-4 text-sm" aria-label="AI 연결">
      <div className="rounded-lg border border-gray-700 bg-gray-800 p-3">
        <p className="font-semibold text-white">
          {!state.enabled ? 'AI 연결 꺼짐' : state.connected ? 'AI 연결됨' : 'AI 연결 대기 중'}
        </p>
        <p className="mt-1 text-xs text-gray-400">
          같은 컴퓨터의 AI에서 자료를 검색하고 준비합니다. 허용은 앱을 종료할 때까지 유지됩니다.
        </p>
      </div>
      <fieldset disabled={busy || state.enabled} className="space-y-2">
        <legend className="mb-2 font-medium text-gray-300">허용할 작업</legend>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="ai-permission"
            value="read"
            checked={permission === 'read'}
            onChange={() => setPermission('read')}
            className="mt-1"
          />
          <span>
            조회와 미리보기
            <span className="block text-xs text-gray-400">
              자료·진행 순서·성경을 읽고 슬라이드를 확인합니다.
            </span>
          </span>
        </label>
        <label className="flex items-start gap-2">
          <input
            type="radio"
            name="ai-permission"
            value="prepare"
            checked={permission === 'prepare'}
            onChange={() => setPermission('prepare')}
            className="mt-1"
          />
          <span>
            조회와 자료 준비
            <span className="block text-xs text-gray-400">
              새 자료·본문·스타일·진행 순서를 변경하고 저장합니다.
            </span>
          </span>
        </label>
      </fieldset>
      <p className="text-xs leading-relaxed text-gray-400">
        허용한 자료 내용과 미리보기는 연결한 AI 서비스에서 처리할 수 있습니다. 준비 작업은 현재
        선택을 유지하며, 송출 중인 자료의 수정은 제한됩니다. 자료를 준비할 때는 입력이나 편집창을
        닫아주세요.
      </p>
      <button
        disabled={busy}
        onClick={() => void change(!state.enabled)}
        className={`rounded px-4 py-2 font-medium disabled:opacity-50 ${state.enabled ? 'bg-gray-700 text-white' : 'bg-blue-600 text-white'}`}
      >
        {busy ? '연결 변경 중…' : state.enabled ? 'AI 연결 해제' : 'AI 연결 허용'}
      </button>
      {state.enabled && (
        <div className="space-y-2 border-t border-gray-700 pt-4">
          <label className="block text-gray-300" htmlFor="ai-client-format">
            연결할 AI 클라이언트
          </label>
          <select
            id="ai-client-format"
            className="w-full rounded bg-gray-800 p-2"
            value={format}
            onChange={(e) => setFormat(e.target.value as 'codex' | 'json')}
          >
            <option value="codex">Codex</option>
            <option value="json">다른 MCP 클라이언트</option>
          </select>
          <button className="rounded bg-gray-700 px-3 py-2 text-white" onClick={() => void copy()}>
            연결 설정 복사
          </button>
          <p className="text-xs leading-relaxed text-gray-400">
            {format === 'codex'
              ? '복사한 설정을 Codex의 MCP 설정에 추가하고 서버를 다시 연결해주세요.'
              : '복사한 설정을 AI 클라이언트의 MCP 서버 설정에 추가해주세요.'}{' '}
            연결 후 이 창을 닫고 “ProPre에서 자료 목록을 보여줘”로 확인할 수 있습니다. 앱 설치
            위치를 바꾼 경우 연결 설정을 다시 복사해주세요.
          </p>
          {state.lastOperation && (
            <p className="text-xs text-gray-400">
              최근 작업: {AI_TOOL_INFO[state.lastOperation.tool].title} ·{' '}
              {state.lastOperation.status === 'completed' ? '완료' : '앱 상태 확인 필요'}
            </p>
          )}
        </div>
      )}
      <p role="status" className="text-xs leading-relaxed text-blue-300">
        {message}
      </p>
    </section>
  )
}
