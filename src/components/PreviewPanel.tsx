import { useShallow } from 'zustand/react/shallow'
import { Monitor } from 'lucide-react'
import { usePresentationStore } from '../store'
import { outputSnapshot } from '../store/helpers'
import CompositeFrame from './CompositeFrame'
import { OutputClearActions } from './ToolbarActions'
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
  const health = usePresentationStore((s) => s.screenHealth.find((h) => h.screen === 'main'))
  const enabled = usePresentationStore((s) => s.isOutputEnabled)
  const label = !enabled
    ? '송출 창 닫힘'
    : health?.status === 'applied'
      ? '화면 적용됨'
      : health?.status === 'error'
        ? '화면 오류'
        : '화면 연결 중'
  const statusColor = !enabled
    ? 'text-gray-500'
    : health?.status === 'error'
      ? 'text-red-300'
      : health?.status === 'applied'
        ? 'text-emerald-400'
        : 'text-amber-300'
  const activeIndex = state.slides.findIndex((slide) => slide.id === state.activeSlideId)
  return (
    <section aria-label="메인 송출 미리보기" className="shrink-0 border-b border-white/5 p-4">
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h2 className="workbench-heading flex items-center gap-2">
          <Monitor size={15} className="text-gray-500" />
          송출 미리보기
        </h2>
        <span
          className={`inline-flex items-center gap-1.5 text-[10px] ${statusColor}`}
          title={health?.error}
        >
          <span className="h-1.5 w-1.5 rounded-full bg-current" />
          {label}
        </span>
      </div>
      <div
        data-output-surface="true"
        className="relative aspect-video w-full overflow-hidden rounded-lg border border-white/10 bg-black shadow-lg"
      >
        <CompositeFrame state={outputSnapshot(state as Parameters<typeof outputSnapshot>[0])} />
      </div>
      <div className="mb-3 mt-2 flex items-center justify-between text-[10px] text-gray-500">
        <span>{activeIndex < 0 ? '대기 화면' : '현재 슬라이드'}</span>
        <span className="tabular-nums">
          {activeIndex < 0 ? '—' : `${activeIndex + 1} / ${state.slides.length}`}
        </span>
      </div>
      <OutputClearActions />
    </section>
  )
}
