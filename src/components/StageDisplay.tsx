import { useEffect, useState } from 'react'
import type { StageData } from '../types'

const StageDisplay: React.FC = () => {
    const [data, setData] = useState<StageData>({ current: null, next: null })
    const [time, setTime] = useState('')

    useEffect(() => {
        // 1. Listen for updates
        const removeListener = window.ipcRenderer.on('update-stage', (json: string) => {
            try {
                const parsed = JSON.parse(json)
                setData(parsed)
            } catch (e) {
                console.error("Failed to parse stage data", e)
            }
        })

        // 2. Clock Timer
        const timer = setInterval(() => {
            const now = new Date()
            const timeString = now.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' })
            setTime(timeString)
        }, 1000)

        // Initial time set
        const now = new Date()
        setTime(now.toLocaleTimeString('ko-KR', { hour12: false, hour: '2-digit', minute: '2-digit', second: '2-digit' }))

        return () => {
            removeListener()
            clearInterval(timer)
        }
    }, [])

    return (
        <div className="w-screen h-screen flex flex-col bg-black text-white overflow-hidden">
            {/* Clock Overlay (Top Right) */}
            <div className="absolute top-4 right-4 text-2xl font-mono opacity-70 z-50">
                {time}
            </div>

            {/* Current Slide (Top 70%) */}
            <div className="flex-[7] flex items-center justify-center p-12 border-b-2 border-gray-800">
                <div
                    className="text-center font-bold text-white whitespace-pre-wrap leading-tight"
                    style={{ fontSize: '5rem' }} // text-7xl or 8xl equivalent, responsive
                >
                    {data.current?.content || ""}
                </div>
            </div>

            {/* Next Slide (Bottom 30%) */}
            <div className="flex-[3] flex flex-col items-center justify-center p-6 bg-gray-900 text-gray-300">
                <span className="text-xl font-semibold text-yellow-500 mb-2 uppercase tracking-widest">
                    Next Slide
                </span>
                <div
                    className="text-center font-medium whitespace-pre-wrap line-clamp-3 text-white"
                    style={{ fontSize: '2.25rem' }} // text-4xl
                >
                    {data.next?.content || "(End of Presentation)"}
                </div>
            </div>
        </div>
    )
}

export default StageDisplay
