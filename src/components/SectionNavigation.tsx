import { useEffect, useState } from 'react'
import { usePresentationStore as store } from '../store'
import { sectionIndex, nearestSection, type SectionOccurrence } from '../../shared/sections'
import { flushPersistence } from '../store/persistence'
import { withOperatorLock } from '../store/preparation'
export default function SectionNavigation() {
  const id = store((state) => state.currentPresentationId),
    slides = store((state) => state.slides),
    active = store((state) => state.activeSlideId),
    generation = store((state) => state.externalOutput.generation),
    source = store((state) => state.externalOutput.source.kind)
  const saved = store(
    (state) =>
      state.library.find((p) => p.id === id) ||
      state.setlistSongs.find((p) => p.presentation.id === id)?.presentation ||
      state.cuePresentations.find((p) => p.presentation.id === id)?.presentation,
  )
  const [selected, setSelected] = useState<{
      section: SectionOccurrence
      presentationId: string
      revision: number
      generation: number
    } | null>(null),
    [immediate, setImmediate] = useState(false),
    [error, setError] = useState(''),
    [busy, setBusy] = useState(false)
  useEffect(() => {
    store.setState({ preparedSectionSlideId: null })
  }, [id, saved?.revision, generation])
  if (!slides.length || !id) return null
  const presentation = { ...saved!, slides },
    index = sectionIndex(presentation)
  const groups = new Map<string, SectionOccurrence[]>()
  for (const occurrence of index.occurrences) {
    const key = occurrence.partId || occurrence.label
    groups.set(key, [...(groups.get(key) || []), occurrence])
  }
  const valid =
    selected?.presentationId === id &&
    selected.revision === (saved?.revision || 0) &&
    selected.generation === generation &&
    index.occurrences.some(
      (section) =>
        section.key === selected.section.key &&
        section.firstSlideId === selected.section.firstSlideId,
    )
  const take = async (choice: NonNullable<typeof selected>) => {
    const origin = document.activeElement as HTMLElement | null
    if (origin instanceof HTMLSelectElement) origin.blur()
    setBusy(true)
    setError('')
    try {
      await withOperatorLock(async () => {
        await flushPersistence()
        await window.ipcRenderer.takeSection({
          presentationId: choice.presentationId,
          presentationRevision: choice.revision,
          firstSlideId: choice.section.firstSlideId,
          expectedOutputGeneration: choice.generation,
        })
      })
      setSelected(null)
    } catch (failure) {
      setError(
        failure instanceof Error
          ? failure.message.replace(/^Error invoking remote method '[^']+': (Error: )?/, '')
          : '구간을 송출하지 못했습니다. 다시 선택해주세요.',
      )
    } finally {
      setBusy(false)
      requestAnimationFrame(() => {
        if (origin?.isConnected) origin.focus()
      })
    }
  }
  const choose = (section: SectionOccurrence) => {
    const choice = { section, presentationId: id, revision: saved?.revision || 0, generation }
    setSelected(choice)
    setError('')
    store.setState({ preparedSectionSlideId: section.firstSlideId, selectedSlideIds: [] })
    document
      .querySelector<HTMLElement>(`[data-slide-id="${section.firstSlideId}"]`)
      ?.scrollIntoView({ block: 'nearest' })
    if (immediate) void take(choice)
  }
  return (
    <details
      className="mb-3 rounded-lg border border-white/10 px-3 py-2"
      aria-label="구간 바로가기"
    >
      <summary className="cursor-pointer text-xs text-gray-400">
        구간 {immediate ? '· 즉시 송출' : '· 선택 후 준비'}
      </summary>
      <div className="mt-3 space-y-2">
        <label className="flex items-center gap-2 text-[11px] text-gray-400">
          <input
            type="checkbox"
            checked={immediate}
            disabled={busy}
            onChange={(event) => setImmediate(event.target.checked)}
          />
          구간 클릭 즉시 송출
        </label>
        {index.warning && (
          <p className="text-[11px] text-amber-200">
            구간 정보 확인 필요 · 현재 슬라이드 라벨을 기준으로 표시합니다.
          </p>
        )}
        {index.occurrences.every((section) => section.label === '미지정') ? (
          <p className="text-xs text-gray-500">
            슬라이드에 구간 이름을 지정하면 바로갈 수 있습니다.
          </p>
        ) : (
          <div className="flex flex-wrap gap-2" role="group" aria-label="구간 선택">
            {[...groups.entries()].map(([key, occurrences], groupIndex) => {
              const live =
                  source === 'slides' &&
                  occurrences.some((section) => section.slideIds.includes(active || '')),
                chosen =
                  valid && occurrences.some((section) => section.key === selected!.section.key)
              return (
                <div key={key} className="flex min-w-0 items-center gap-1">
                  <button
                    type="button"
                    className={`workbench-button ${chosen ? 'border-blue-400/70' : ''}`}
                    aria-label={`${occurrences[0].label} 구간 선택`}
                    aria-pressed={!!chosen}
                    disabled={busy}
                    data-section-chip={groupIndex}
                    onClick={() =>
                      choose(
                        nearestSection(occurrences, slides, source === 'slides' ? active : null),
                      )
                    }
                    onKeyDown={(event) => {
                      if (event.nativeEvent.isComposing) return
                      if (event.key === 'ArrowLeft' || event.key === 'ArrowRight') {
                        event.preventDefault()
                        event.stopPropagation()
                        const next =
                          (groupIndex + (event.key === 'ArrowLeft' ? -1 : 1) + groups.size) %
                          groups.size
                        event.currentTarget
                          .closest('[aria-label="구간 선택"]')
                          ?.querySelector<HTMLButtonElement>(`[data-section-chip="${next}"]`)
                          ?.focus()
                      }
                    }}
                  >
                    {occurrences[0].label}
                    {live ? ' · 송출 중' : ''}
                    {chosen ? ' · 선택' : ''}
                  </button>
                  {occurrences.length > 1 && (
                    <select
                      className="workbench-field max-w-28 text-[10px]"
                      aria-label={`${occurrences[0].label} 발생 위치`}
                      value={chosen ? selected!.section.key : ''}
                      disabled={busy}
                      onChange={(event) => {
                        const section = occurrences.find((item) => item.key === event.target.value)
                        if (section) choose(section)
                      }}
                    >
                      <option value="" disabled>
                        발생 선택
                      </option>
                      {occurrences.map((section, position) => (
                        <option key={section.key} value={section.key}>
                          {position + 1}번째 · {section.slideIds.length}장
                          {position === occurrences.length - 1 ? ' · 마지막' : ''}
                        </option>
                      ))}
                    </select>
                  )}
                </div>
              )
            })}
          </div>
        )}
        {selected && selected.presentationId === id && (
          <div className="flex flex-wrap items-center justify-between gap-2 text-[11px] text-gray-400">
            <span>
              {valid
                ? `선택: ${selected.section.label} · ${slides.findIndex((slide) => slide.id === selected.section.firstSlideId) + 1}번 슬라이드`
                : '내용이나 송출이 바뀌었습니다. 구간을 다시 선택해주세요.'}
            </span>
            <button
              type="button"
              className="workbench-button workbench-button-primary"
              disabled={!valid || busy}
              onClick={() => selected && void take(selected)}
            >
              이 구간 송출
            </button>
          </div>
        )}
        {error && (
          <p role="alert" className="break-words text-xs text-red-300">
            {error}
          </p>
        )}
      </div>
    </details>
  )
}
