import { useEffect, useState } from 'react'
import type { ConnectionProfile, Provider } from '../../shared/song-preparation'
const providerNames: Record<Provider, string> = {
  gemini: 'Google Gemini',
  openai: 'OpenAI',
  claude: 'Anthropic Claude',
}
const defaultModels: Record<Provider, string> = {
  gemini: 'gemini-3.8-flash',
  openai: 'gpt-6.1-sol',
  claude: 'claude-sonnet-5-5',
}
const fresh = (): ConnectionProfile => ({
  id: crypto.randomUUID(),
  name: '',
  provider: 'gemini',
  model: defaultModels.gemini,
})
export default function AIProfilesPanel({ onChanged }: { onChanged?: () => void }) {
  const [profiles, setProfiles] = useState<(ConnectionProfile & { configured: boolean })[]>([])
  const [profile, setProfile] = useState(fresh),
    [key, setKey] = useState(''),
    [defaultId, setDefaultId] = useState<string | null>(null)
  const [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  const savedProfile = profiles.find((p) => p.id === profile.id)
  const needsKey =
    !savedProfile || savedProfile.provider !== profile.provider || !savedProfile.configured
  const load = async () => {
    const state = await window.ipcRenderer.listAIProfiles()
    setProfiles(state.profiles)
    setDefaultId(state.defaultId)
  }
  useEffect(() => {
    void load().catch(() => setError('AI 연결 설정을 읽지 못했습니다.'))
  }, [])
  const save = async () => {
    setBusy(true)
    setError('')
    try {
      await window.ipcRenderer.saveAIProfile(
        { ...profile, name: profile.name || providerNames[profile.provider] },
        key.trim() || null,
        true,
      )
      setKey('')
      await load()
      onChanged?.()
    } catch {
      setError('연결을 저장하지 못했습니다. 이름·모델 ID·키와 보호 저장소를 확인해주세요.')
    } finally {
      setBusy(false)
    }
  }
  return (
    <section className="space-y-3 border border-gray-700 rounded p-3">
      <h3 className="font-bold text-sm">파일 분석에 사용할 AI</h3>
      <p className="text-xs text-gray-400">
        API 연결을 등록하고 작업마다 선택합니다. 선택한 파일과 이번 작업의 지시·준비 중인 곡 내용을
        해당 AI에 전송하며 API 이용 비용은 제공자 계정에 청구됩니다.
      </p>
      <div className="flex flex-wrap gap-2">
        {profiles.map((p) => (
          <button
            type="button"
            key={p.id}
            onClick={() => {
              setProfile(p)
              setKey('')
            }}
            className="bg-gray-800 p-2 text-xs rounded"
          >
            {p.name} · {providerNames[p.provider]} · {p.configured ? '키 등록됨' : '키 필요'}
            {p.id === defaultId ? ' · 기본' : ''}
          </button>
        ))}
        <button
          type="button"
          className="text-xs text-blue-300"
          onClick={() => {
            setProfile(fresh())
            setKey('')
          }}
        >
          새 AI 연결
        </button>
      </div>
      <label className="block text-xs">
        연결 이름
        <input
          aria-label="AI 연결 이름"
          className="block bg-gray-800 p-2 w-full"
          value={profile.name}
          onChange={(e) => setProfile({ ...profile, name: e.target.value })}
        />
      </label>
      <label className="block text-xs">
        AI 제공자
        <select
          aria-label="AI 제공자"
          className="block bg-gray-800 p-2 w-full"
          value={profile.provider}
          onChange={(e) => {
            const provider = e.target.value as Provider
            const knownName =
              !profile.name ||
              profile.name === profile.provider ||
              profile.name === providerNames[profile.provider]
            setProfile({
              ...profile,
              name: knownName ? providerNames[provider] : profile.name,
              provider,
              model: defaultModels[provider],
            })
            setKey('')
          }}
        >
          <option value="gemini">Google Gemini</option>
          <option value="openai">OpenAI</option>
          <option value="claude">Anthropic Claude</option>
        </select>
      </label>
      <label className="block text-xs">
        모델 ID
        <input
          aria-label="AI 모델 ID"
          className="block bg-gray-800 p-2 w-full"
          value={profile.model}
          onChange={(e) => setProfile({ ...profile, model: e.target.value })}
        />
      </label>
      <p className="text-xs text-gray-400">
        기본 모델 ID를 입력했습니다. 계정에서 사용할 수 있는 PDF·이미지 및 도구 호출 지원 모델로
        바꿀 수 있습니다.
      </p>
      <label className="block text-xs">
        API 키
        <input
          aria-label="AI API 키"
          type="password"
          autoComplete="off"
          className="block bg-gray-800 p-2 w-full"
          value={key}
          onChange={(e) => setKey(e.target.value)}
          placeholder="등록된 키를 유지하려면 비워두세요"
        />
      </label>
      {error && (
        <p role="alert" className="text-red-300 text-xs">
          {error}
        </p>
      )}
      <div className="flex gap-3">
        <button
          type="button"
          disabled={busy || !profile.model || (needsKey && !key.trim())}
          onClick={() => void save()}
          className="bg-blue-600 p-2 text-xs rounded disabled:opacity-40"
        >
          연결 저장 · 기본으로 사용
        </button>
        {profiles.some((p) => p.id === profile.id) && (
          <button
            type="button"
            disabled={busy}
            className="text-xs text-red-300"
            onClick={() => {
              setBusy(true)
              void window.ipcRenderer
                .removeAIProfile(profile.id)
                .then(async () => {
                  setProfile(fresh())
                  setKey('')
                  await load()
                  onChanged?.()
                })
                .catch(() => setError('연결을 삭제하지 못했습니다.'))
                .finally(() => setBusy(false))
            }}
          >
            이 연결 삭제
          </button>
        )}
      </div>
    </section>
  )
}
