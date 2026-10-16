import { useEffect } from 'react'
export default function PdfOutputHelper() {
  useEffect(() => {
    let disposed = false
    const stop = window.ipcRenderer.on(
      'pdf-output-render',
      (request: {
        id: string
        url: string
        page: number
        rotation: number
        width: number
        height: number
      }) => {
        void (async () => {
          const response = await fetch(request.url)
          if (!response.ok) throw new Error('PDF source unavailable')
          const bytes = new Uint8Array(await response.arrayBuffer())
          const pdfjs = await import('pdfjs-dist')
          const worker = new Worker(
            new URL('pdfjs-dist/build/pdf.worker.min.mjs', import.meta.url),
            { type: 'module' },
          )
          const pdfWorker = new pdfjs.PDFWorker({
            port: worker,
          } as unknown as ConstructorParameters<typeof pdfjs.PDFWorker>[0])
          const task = pdfjs.getDocument({
            data: bytes,
            worker: pdfWorker,
            isEvalSupported: false,
            useSystemFonts: true,
            disableFontFace: true,
          })
          try {
            const doc = await task.promise,
              page = await doc.getPage(request.page)
            if (doc.numPages < 1 || doc.numPages > 1000) throw new Error('PDF page limit')
            const viewport = page.getViewport({
              scale: 1,
              rotation: (page.rotate + request.rotation) % 360,
            })
            const scale = Math.min(
              request.width / viewport.width,
              request.height / viewport.height,
              4096 / Math.max(viewport.width, viewport.height),
              Math.sqrt(12000000 / (viewport.width * viewport.height)),
            )
            const sized = page.getViewport({
                scale,
                rotation: (page.rotate + request.rotation) % 360,
              }),
              canvas = document.createElement('canvas')
            canvas.width = Math.ceil(sized.width)
            canvas.height = Math.ceil(sized.height)
            const context = canvas.getContext('2d')
            if (!context) throw new Error('canvas')
            await page.render({ canvasContext: context, canvas, viewport: sized }).promise
            if (!disposed)
              window.ipcRenderer.pdfOutputResult({
                id: request.id,
                pages: doc.numPages,
                png: canvas.toDataURL('image/png').split(',')[1],
              })
          } finally {
            await task.destroy()
            pdfWorker.destroy()
            worker.terminate()
          }
        })().catch(() => {
          if (!disposed) window.ipcRenderer.pdfOutputResult({ id: request.id, error: true })
        })
      },
    )
    window.ipcRenderer.pdfOutputReady()
    return () => {
      disposed = true
      stop()
    }
  }, [])
  return null
}
