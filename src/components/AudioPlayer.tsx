import { useEffect, useRef } from 'react'
import { usePresentationStore } from '../store'
import { mediaKind } from '../../shared/model'
export default function AudioPlayer() {
  const audio = usePresentationStore((s) => s.activeAudio),
    showAudioPlayer = usePresentationStore((s) => s.showAudioPlayer),
    green = usePresentationStore((s) => s.isGreenScreen),
    looks = usePresentationStore((s) => s.screenLooks),
    ref = useRef<HTMLAudioElement>(null)
  const audible = looks[green ? 'chroma' : 'main'].audio.isVisible
  useEffect(() => {
    const el = ref.current
    if (!el) return
    el.volume = audio?.volume ?? 1
    el.loop = !!audio?.loop
    if (audio?.playing && audible)
      void el.play().catch(() => {
        usePresentationStore.setState((s) => ({
          activeAudio:
            s.activeAudio?.id === audio.id ? { ...s.activeAudio, playing: false } : s.activeAudio,
        }))
        usePresentationStore
          .getState()
          .addToast('오디오를 재생하지 못했습니다. 파일 형식을 확인해주세요.', 'error')
      })
    else el.pause()
  }, [audio?.id, audio?.url, audio?.volume, audio?.playing, audio?.loop, audible])
  const select = async () => {
    try {
      const files = await window.ipcRenderer.selectMediaFiles(),
        url = files.find((f) => mediaKind(f) === 'audio')
      if (!url) {
        if (files.length)
          usePresentationStore.getState().addToast('오디오 파일을 선택해주세요.', 'info')
        return
      }
      usePresentationStore.getState().addMediaToBin(files)
      usePresentationStore.setState({
        activeAudio: {
          id: crypto.randomUUID(),
          url,
          name: decodeURIComponent(url.split('/').pop() || '오디오'),
          playing: false,
          volume: 1,
        },
      })
    } catch {
      usePresentationStore.getState().addToast('오디오 등록에 실패했습니다.', 'error')
    }
  }
  return (
    <div
      className={`bg-gray-900 border-b border-gray-700 px-3 py-1 ${showAudioPlayer ? 'flex' : 'hidden'} items-center justify-end gap-3 text-xs`}
    >
      <audio
        ref={ref}
        src={audio?.url}
        onEnded={() =>
          usePresentationStore.setState((s) => ({
            activeAudio: s.activeAudio ? { ...s.activeAudio, playing: false } : null,
          }))
        }
        onError={() => window.ipcRenderer.reportMediaError()}
      />
      <button onClick={() => void select()} className="text-gray-300">
        {audio?.name || '오디오 선택'}
      </button>
      <button
        aria-label={audio?.playing ? '오디오 일시정지' : '오디오 재생'}
        disabled={!audio}
        onClick={() =>
          usePresentationStore.setState((s) => ({
            activeAudio: s.activeAudio
              ? { ...s.activeAudio, playing: !s.activeAudio.playing }
              : null,
          }))
        }
      >
        {audio?.playing ? '일시정지' : '재생'}
      </button>
      <input
        aria-label="오디오 음량"
        type="range"
        min="0"
        max="1"
        step=".05"
        value={audio?.volume ?? 1}
        onChange={(e) =>
          usePresentationStore.setState((s) => ({
            activeAudio: s.activeAudio
              ? { ...s.activeAudio, volume: Number(e.target.value) }
              : null,
          }))
        }
      />
      <button onClick={() => usePresentationStore.getState().clearLayer('audio')}>
        오디오 중지
      </button>
    </div>
  )
}
