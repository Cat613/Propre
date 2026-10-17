import { useEffect, useRef, useState } from 'react'
import type { PDFDocumentProxy, RenderTask } from 'pdfjs-dist'
export default function SongSourcePreview({
  jobId,
  sourceId,
  page,
}: {
  jobId: string
  sourceId: string
  page: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null)
  const [image, setImage] = useState('')
  const [pdf, setPdf] = useState<PDFDocumentProxy | null>(null)
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState('')
  const [retry, setRetry] = useState(0)
  useEffect(() => {
    let disposed = false,
      cleanup: undefined | (() => void)
    setError('')
    setLoading(true)
    setImage('')
    setPdf(null)
    void (async () => {
      const source = await window.ipcRenderer.songSource(jobId, sourceId)
      if (disposed) return
      if (source.mime !== 'application/pdf') {
        setImage(`data:${source.mime};base64,${source.data}`)
        return
      }
      const pdfjs = await import('pdfjs-dist')
      if (disposed) return
      const worker = new Worker(new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url), {
        type: 'module',
      })
      const pdfWorker = new pdfjs.PDFWorker({ port: worker } as unknown as ConstructorParameters<
        typeof pdfjs.PDFWorker
      >[0])
      const task = pdfjs.getDocument({
        data: Uint8Array.from(atob(source.data), (c) => c.charCodeAt(0)),
        worker: pdfWorker,
        isEvalSupported: false,
        useSystemFonts: true,
      })
      cleanup = () => {
        void task.destroy().catch(() => {})
        pdfWorker.destroy()
        worker.terminate()
      }
      const document = await task.promise
      if (!disposed) setPdf(document)
    })().catch(() => {
      if (!disposed) {
        setError('원본 미리보기를 읽지 못했습니다. 파일을 확인해주세요.')
        setLoading(false)
      }
    })
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [jobId, sourceId, retry])
  useEffect(() => {
    if (!pdf) return
    let disposed = false
    let render: RenderTask | undefined
    setLoading(true)
    setError('')
    void (async () => {
      const documentPage = await pdf.getPage(Math.max(1, Math.min(page, pdf.numPages)))
      if (disposed || !canvas.current) return
      const viewport = documentPage.getViewport({
        scale: Math.min(1.4, 900 / documentPage.getViewport({ scale: 1 }).width),
      })
      const node = canvas.current
      node.width = viewport.width
      node.height = viewport.height
      const context = node.getContext('2d')
      if (!context) throw new Error('Canvas unavailable')
      render = documentPage.render({ canvasContext: context, canvas: node, viewport })
      await render.promise
      if (!disposed) setLoading(false)
    })().catch(() => {
      if (!disposed) {
        setError('이 페이지를 표시하지 못했습니다. 다시 불러오거나 다른 페이지를 확인해주세요.')
        setLoading(false)
      }
    })
    return () => {
      disposed = true
      render?.cancel()
    }
  }, [pdf, page])
  return (
    <div className="song-source-preview rounded overflow-auto max-h-[45vh]" aria-busy={loading}>
      {error ? (
        <div className="p-3">
          <p role="alert">{error}</p>
          <button
            type="button"
            className="mt-2 underline text-sm"
            onClick={() => setRetry((n) => n + 1)}
          >
            원본 다시 불러오기
          </button>
        </div>
      ) : (
        loading && <p className="p-3 text-sm">원본을 불러오는 중…</p>
      )}
      {image && (
        <img
          alt="분석 원본"
          src={image}
          className="w-full object-contain"
          hidden={loading || !!error}
          onLoad={() => setLoading(false)}
          onError={() => {
            setError('이미지를 표시하지 못했습니다. 파일을 확인해주세요.')
            setLoading(false)
          }}
        />
      )}
      <canvas
        aria-label={`PDF 원문 ${page}페이지`}
        ref={canvas}
        className="max-w-full h-auto"
        hidden={loading || !!error || !!image}
      />
    </div>
  )
}
