import { useState, useEffect, useRef } from 'react'
import { usePresentationStore } from '../store'
import { useModalGuard } from '../hooks/useModalGuard'
import { patchSlide, slideText } from '../../shared/model'
import type { Slide } from '../types'
interface Props {
  isOpen: boolean
  onClose: () => void
}
export default function BulkEditModal({ isOpen, onClose }: Props) {
  const [text, setText] = useState(''),
    base = useRef<Slide[]>([]),
    latest = useRef(() => {})
  useEffect(() => {
    if (isOpen) {
      base.current = usePresentationStore.getState().slides
      setText(base.current.map(slideText).join('\n\n'))
    }
  }, [isOpen])
  const apply = () => {
    if (!isOpen) return
    const blocks = text
      .split(/\n\s*\n/)
      .map((b) => b.trim())
      .filter((b, i, all) => b || i !== all.length - 1)
    const slides = blocks.map((content, i) =>
      base.current[i]
        ? patchSlide(base.current[i], { content })
        : { id: crypto.randomUUID(), type: 'text' as const, content, styles: {} },
    )
    if (JSON.stringify(slides) !== JSON.stringify(usePresentationStore.getState().slides))
      usePresentationStore.getState().setSlides(slides)
    base.current = slides
  }
  latest.current = apply
  useModalGuard(isOpen, () => {
    latest.current()
    onClose()
  })
  useEffect(() => {
    if (!isOpen) return
    const timer = setTimeout(() => latest.current(), 350)
    const flush = () => latest.current()
    window.addEventListener('propre-flush-edits', flush)
    return () => {
      clearTimeout(timer)
      window.removeEventListener('propre-flush-edits', flush)
    }
  }, [isOpen, text])
  if (!isOpen) return null
  const close = () => {
    apply()
    onClose()
  }
  return (
    <div
      data-modal="true"
      role="dialog"
      aria-modal="true"
      aria-label="전체 텍스트 편집"
      className="fixed inset-0 z-50 flex items-center justify-center bg-black/70 p-4"
    >
      <div className="bg-gray-900 rounded-xl border border-gray-700 w-full max-w-3xl h-[80vh] flex flex-col">
        <div className="p-4 flex justify-between">
          <div>
            <h2>전체 텍스트 편집</h2>
            <p className="text-xs text-gray-400">
              빈 줄로 슬라이드를 구분합니다. 변경 내용은 자동 저장되며 현재 송출에도 반영됩니다.
            </p>
          </div>
          <button onClick={close}>닫기</button>
        </div>
        <textarea
          aria-label="전체 슬라이드 텍스트"
          className="flex-1 bg-gray-800 text-white p-4 outline-none resize-none"
          value={text}
          onChange={(e) => setText(e.target.value)}
        />
        <div className="p-3 flex justify-end">
          <button className="bg-blue-600 text-white px-4 py-2 rounded" onClick={close}>
            완료
          </button>
        </div>
      </div>
    </div>
  )
}
