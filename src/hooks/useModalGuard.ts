import { useEffect, useRef } from 'react'
import { usePresentationStore } from '../store'
let count = 0
export function useModalGuard(open: boolean, onClose?: () => void) {
  const close = useRef(onClose)
  close.current = onClose
  useEffect(() => {
    if (!open) return
    count++
    usePresentationStore.getState().setModalOpen(true)
    const previous = document.activeElement as HTMLElement | null
    const dialogs = document.querySelectorAll<HTMLElement>('[data-modal="true"]')
    const modal = dialogs.item(dialogs.length - 1)
    const focusable = () =>
      modal
        ? Array.from(
            modal.querySelectorAll<HTMLElement>(
              'button:not(:disabled), input:not(:disabled), textarea:not(:disabled), select:not(:disabled), summary, [tabindex="0"]',
            ),
          ).filter((node) => node.getClientRects().length > 0)
        : []
    if (modal) {
      modal.tabIndex = -1
      queueMicrotask(() => {
        if (modal.isConnected) {
          const nodes = focusable()
          ;(
            nodes.find((node) => node.dataset.autofocus === 'true') ||
            nodes.find((node) =>
              node.matches('textarea, input:not([type="checkbox"]):not([type="range"])'),
            ) ||
            nodes[0] ||
            modal
          ).focus()
        }
      })
    }
    const handleKey = (event: KeyboardEvent) => {
      const stack = document.querySelectorAll<HTMLElement>('[data-modal="true"]')
      if (!modal || stack.item(stack.length - 1) !== modal) return
      if (event.key === 'Escape' && !event.isComposing) {
        event.preventDefault()
        event.stopPropagation()
        close.current?.()
      } else if (event.key === 'Tab') {
        const nodes = focusable(),
          first = nodes[0],
          last = nodes.at(-1)
        if (
          !first ||
          (event.shiftKey && document.activeElement === first) ||
          (!event.shiftKey && document.activeElement === last) ||
          !modal.contains(document.activeElement)
        ) {
          event.preventDefault()
          ;(event.shiftKey ? last || modal : first || modal).focus()
        }
      }
    }
    window.addEventListener('keydown', handleKey, true)
    return () => {
      window.removeEventListener('keydown', handleKey, true)
      if (previous?.isConnected) previous.focus()
      count = Math.max(0, count - 1)
      usePresentationStore.getState().setModalOpen(count > 0)
    }
  }, [open])
}
export function hotkeysBlocked(e: KeyboardEvent) {
  const target = e.target as HTMLElement | null
  return (
    usePresentationStore.getState().isModalOpen ||
    !!document.querySelector('[data-modal="true"]') ||
    e.isComposing ||
    target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.tagName === 'SELECT' ||
    !!target?.isContentEditable
  )
}
