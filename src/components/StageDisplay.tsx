import { useEffect, useState, useRef } from 'react'
import type { StageData } from '../types'
import StageSlideContent from './StageSlideContent'
import StageMessageBanner from './StageMessageBanner'
import StageTimerBanner from './StageTimerBanner'
export default function StageDisplay() {
  const [data, setData] = useState<StageData>({ current: null, next: null }),
    [time, setTime] = useState(''),
    version = useRef(0)
  useEffect(() => {
    const stop = window.ipcRenderer.on('update-stage', (json: string) => {
      try {
        const parsed = JSON.parse(json) as StageData & { version: number }
        if (parsed.version <= version.current) return
        version.current = parsed.version
        setData(parsed)
      } catch {
        window.ipcRenderer.reportMediaError()
      }
    })
    window.ipcRenderer.ready()
    const tick = () =>
      setTime(
        new Date().toLocaleTimeString('ko-KR', {
          hour12: false,
          hour: '2-digit',
          minute: '2-digit',
          second: '2-digit',
        }),
      )
    tick()
    const timer = setInterval(tick, 1000)
    return () => {
      stop()
      clearInterval(timer)
    }
  }, [])
  useEffect(() => {
    if (version.current) window.ipcRenderer.acknowledge(version.current)
  }, [data])
  return (
    <div
      className="w-screen h-screen flex flex-col bg-black text-white overflow-hidden"
      data-screen="stage"
    >
      <StageMessageBanner />
      <StageTimerBanner />
      <div
        className="shrink-0 flex justify-end px-4 pt-2 font-mono opacity-70"
        style={{ fontSize: 'clamp(14px, 3vh, 24px)', lineHeight: 1.2 }}
        data-stage-clock="true"
      >
        {time}
      </div>
      <div
        className="flex-[7] min-h-0 border-b-2 border-gray-800"
        style={{ padding: 'clamp(12px, 3vh, 32px)' }}
        data-stage-section="current"
      >
        {data.source?.kind === 'pdf' ? (
          <div className="flex h-full flex-col items-center gap-2">
            <span>
              {data.source.name} · {data.source.page}/{data.source.pageCount}
            </span>
            <img
              className="min-h-0 flex-1 max-w-full object-contain"
              src={data.source.frameURL}
              alt="현재 PDF 페이지"
            />
          </div>
        ) : data.source?.kind === 'web' ? (
          <div className="flex h-full items-center justify-center text-center text-3xl">
            웹 송출 중<br />
            {data.source.name}
            <br />
            {data.source.host}
          </div>
        ) : (
          data.current && (
            <StageSlideContent
              slide={data.current}
              globalStyle={data.globalSlideStyle}
              fontSize={data.settings?.currentFontSize ?? 80}
            />
          )
        )}
      </div>
      <div
        className="flex-[3] min-h-0 flex flex-col items-center bg-gray-900 text-gray-300"
        style={{ padding: 'clamp(8px, 2vh, 24px)' }}
        data-stage-section="next"
      >
        <span
          className="shrink-0 font-semibold text-yellow-500"
          style={{
            fontSize: 'clamp(12px, 2.5vh, 20px)',
            lineHeight: 1.2,
            marginBottom: 'clamp(4px, 1vh, 8px)',
          }}
        >
          {data.source?.kind === 'pdf' ? '다음 PDF 페이지' : '다음 슬라이드'}
        </span>
        {data.source?.kind === 'pdf' ? (
          data.source.nextFrameURL ? (
            <img
              className="min-h-0 flex-1 max-w-full object-contain"
              src={data.source.nextFrameURL}
              alt="다음 PDF 페이지"
            />
          ) : (
            <span>문서 끝</span>
          )
        ) : data.source?.kind === 'web' ? (
          <span>웹페이지는 메인 화면에서 표시됩니다.</span>
        ) : data.next ? (
          <StageSlideContent
            slide={data.next}
            globalStyle={data.globalSlideStyle}
            fontSize={data.settings?.nextFontSize ?? 36}
          />
        ) : (
          <div
            className="flex-1 flex items-center justify-center text-center text-white"
            style={{ fontSize: `${data.settings?.nextFontSize ?? 36}px` }}
          >
            {data.current ? '발표 끝' : '송출 대기'}
          </div>
        )}
      </div>
    </div>
  )
}
