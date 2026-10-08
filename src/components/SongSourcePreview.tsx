import { useEffect, useRef, useState } from 'react'
export default function SongSourcePreview({
  jobId,
  sourceId,
  page,
}: {
  jobId: string
  sourceId: string
  page: number
}) {
  const canvas = useRef<HTMLCanvasElement>(null),
    [image, setImage] = useState(''),
    [error, setError] = useState('')
  useEffect(() => {
    let disposed = false,
      cleanup: undefined | (() => void)
    setError('')
    setImage('')
    void (async () => {
      const source = await window.ipcRenderer.songSource(jobId, sourceId)
      if (disposed) return
      if (source.mime !== 'application/pdf') {
        setImage(`data:${source.mime};base64,${source.data}`)
        return
      }
      const pdfjs = await import('pdfjs-dist')
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
        void task.destroy()
        pdfWorker.destroy()
        worker.terminate()
      }
      if (disposed) {
        cleanup()
        return
      }
      const pdf = await task.promise,
        p = await pdf.getPage(Math.min(page, pdf.numPages))
      if (disposed || !canvas.current) return
      const viewport = p.getViewport({
        scale: Math.min(1.4, 900 / p.getViewport({ scale: 1 }).width),
      })
      const node = canvas.current
      node.width = viewport.width
      node.height = viewport.height
      const context = node.getContext('2d')
      if (!context) return
      await p.render({ canvasContext: context, canvas: node, viewport }).promise
    })().catch(() => {
      if (!disposed) setError('원본 미리보기를 읽지 못했습니다. 파일을 확인해주세요.')
    })
    return () => {
      disposed = true
      cleanup?.()
    }
  }, [jobId, sourceId, page])
  return (
    <div className="bg-white rounded overflow-auto max-h-[45vh]">
      {error ? (
        <p role="alert" className="text-red-700 p-3">
          {error}
        </p>
      ) : image ? (
        <img alt="분석 원본" src={image} className="w-full object-contain" />
      ) : (
        <canvas aria-label={`PDF 원문 ${page}페이지`} ref={canvas} className="max-w-full h-auto" />
      )}
    </div>
  )
}
