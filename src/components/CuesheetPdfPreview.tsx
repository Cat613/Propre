import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy } from 'pdfjs-dist'
export default function CuesheetPdfPreview({
  url,
  page,
  onReady,
}: {
  url: string
  page: number
  onReady: (ready: boolean) => void
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    callback = useRef(onReady)
  callback.current = onReady
  const [document, setDocument] = useState<PDFDocumentProxy | null>(null),
    [error, setError] = useState(''),
    [rendering, setRendering] = useState(true)
  useEffect(() => {
    let disposed = false,
      destroy: (() => Promise<void>) | undefined
    const abort = new AbortController()
    void (async () => {
      const response = await fetch(url, { signal: abort.signal })
      if (!response.ok) throw new Error('expired')
      const bytes = new Uint8Array(await response.arrayBuffer()),
        pdfjs = await import('pdfjs-dist')
      if (disposed) return
      const worker = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), {
          type: 'module',
        }),
        pdfWorker = new pdfjs.PDFWorker({ port: worker } as unknown as ConstructorParameters<
          typeof pdfjs.PDFWorker
        >[0])
      const task = pdfjs.getDocument({
        data: bytes,
        worker: pdfWorker,
        isEvalSupported: false,
        useSystemFonts: true,
        disableFontFace: true,
      })
      destroy = async () => {
        await task.destroy()
        pdfWorker.destroy()
        worker.terminate()
      }
      try {
        const doc = await task.promise
        if (!disposed) setDocument(doc)
      } catch (failure) {
        if (!disposed) throw failure
      }
    })().catch(() => {
      if (!disposed) {
        setError('PDF 미리보기를 표시하지 못했습니다. 다시 만들어주세요.')
        callback.current(false)
      }
    })
    return () => {
      disposed = true
      abort.abort()
      void destroy?.().catch(() => {})
    }
  }, [url])
  useEffect(() => {
    if (!document || !canvas.current) return
    let disposed = false,
      cancel: (() => void) | undefined
    setRendering(true)
    setError('')
    callback.current(false)
    void (async () => {
      const pdfPage = await document.getPage(page),
        base = pdfPage.getViewport({ scale: 1 }),
        viewport = pdfPage.getViewport({ scale: Math.min(1200 / base.width, 1800 / base.height) }),
        target = canvas.current
      if (!target || disposed) return
      target.width = Math.ceil(viewport.width)
      target.height = Math.ceil(viewport.height)
      const context = target.getContext('2d')
      if (!context) throw new Error('canvas')
      const render = pdfPage.render({ canvas: target, canvasContext: context, viewport })
      cancel = () => render.cancel()
      await render.promise
      if (!disposed) {
        setRendering(false)
        callback.current(true)
      }
    })().catch(() => {
      if (!disposed) {
        setRendering(false)
        setError('이 PDF 페이지를 표시하지 못했습니다. 다른 페이지를 선택하거나 다시 만들어주세요.')
        callback.current(false)
      }
    })
    return () => {
      disposed = true
      cancel?.()
    }
  }, [document, page])
  return (
    <div className="mx-auto w-full max-w-3xl">
      {error && (
        <p role="alert" className="mb-2 text-xs text-red-300">
          {error}
        </p>
      )}
      {rendering && !error && (
        <p className="p-6 text-center text-xs text-gray-500" role="status">
          PDF 페이지 표시 중…
        </p>
      )}
      <canvas
        ref={canvas}
        aria-label={`큐시트 PDF ${page}페이지`}
        className={`w-full bg-white shadow-xl ${rendering || error ? 'hidden' : ''}`}
      />
    </div>
  )
}
