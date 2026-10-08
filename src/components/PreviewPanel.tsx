import { useShallow } from 'zustand/react/shallow'
import { usePresentationStore } from '../store'
import { outputSnapshot } from '../store/helpers'
import CompositeFrame from './CompositeFrame'
export default function PreviewPanel() {
  const state = usePresentationStore(
    useShallow((s) => ({
      activeSlideId: s.activeSlideId,
      slides: s.slides,
      globalSlideStyle: s.globalSlideStyle,
      activeBackground: s.activeBackground,
      activeAudio: s.activeAudio,
      activeProps: s.activeProps,
      activeMessage: s.activeMessage,
      activeAnnouncement: s.activeAnnouncement,
      screenLooks: s.screenLooks,
      isGreenScreen: s.isGreenScreen,
    })),
  )
  const health = usePresentationStore((s) => s.screenHealth.find((h) => h.screen === 'main')),
    enabled = usePresentationStore((s) => s.isOutputEnabled)
  const label = !enabled
    ? '송출 창 닫힘'
    : health?.status === 'applied'
      ? '화면 적용됨'
      : health?.status === 'error'
        ? '화면 오류'
        : '화면 연결 중'
  return (
    <div className="flex-none bg-gray-950 border-b border-gray-800 p-3">
      <div className="flex justify-between text-xs text-gray-400 mb-2">
        <span>메인 송출 미리보기</span>
        <span
          className={
            health?.status === 'error'
              ? 'text-red-400'
              : health?.status === 'applied'
                ? 'text-green-400'
                : ''
          }
          title={health?.error}
        >
          {label}
        </span>
      </div>
      <div className="aspect-video w-full bg-black relative rounded overflow-hidden">
        <CompositeFrame state={outputSnapshot(state as Parameters<typeof outputSnapshot>[0])} />
      </div>
    </div>
  )
}
