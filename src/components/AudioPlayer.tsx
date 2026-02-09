import { useState, useRef } from 'react'

const AudioPlayer: React.FC = () => {
    const [audioSrc, setAudioSrc] = useState<string | null>(null)
    const [isPlaying, setIsPlaying] = useState(false)
    const [volume, setVolume] = useState(1)
    const [fileName, setFileName] = useState('')
    const audioRef = useRef<HTMLAudioElement>(null)

    const handleFileSelect = async () => {
        try {
            const filePaths = await window.ipcRenderer.selectMediaFiles() // We can reuse this, or make a specific audio one
            if (filePaths.length > 0) {
                const filePath = filePaths[0]
                // Basic check for audio extensions could be added here or in main process filter
                setAudioSrc(`file://${filePath}`)
                setFileName(filePath.split(/[/\\]/).pop() || 'Audio')
                setIsPlaying(false) // Auto-play is annoying usually
            }
        } catch (error) {
            console.error('Failed to select audio:', error)
        }
    }

    const togglePlay = () => {
        if (!audioRef.current) return
        if (isPlaying) {
            audioRef.current.pause()
        } else {
            audioRef.current.play()
        }
        setIsPlaying(!isPlaying)
    }

    const handleVolumeChange = (e: React.ChangeEvent<HTMLInputElement>) => {
        const newVolume = parseFloat(e.target.value)
        setVolume(newVolume)
        if (audioRef.current) {
            audioRef.current.volume = newVolume
        }
    }

    return (
        <div className="bg-gray-800 rounded-lg p-2 flex items-center gap-2 border border-gray-700 min-w-[200px]">
            <audio ref={audioRef} src={audioSrc || undefined} onEnded={() => setIsPlaying(false)} />

            {/* Play/Pause Button */}
            <button
                onClick={togglePlay}
                disabled={!audioSrc}
                className="w-8 h-8 flex items-center justify-center rounded-full bg-blue-600 hover:bg-blue-700 disabled:bg-gray-700 disabled:text-gray-500 text-white transition-colors"
            >
                {isPlaying ? (
                    <svg className="w-4 h-4" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M6 4h4v16H6V4zm8 0h4v16h-4V4z" />
                    </svg>
                ) : (
                    <svg className="w-4 h-4 ml-0.5" fill="currentColor" viewBox="0 0 24 24">
                        <path d="M8 5v14l11-7z" />
                    </svg>
                )}
            </button>

            {/* Info & Volume */}
            <div className="flex-1 min-w-0 flex flex-col gap-1">
                <div
                    className="text-xs text-gray-300 truncate cursor-pointer hover:text-white"
                    onClick={handleFileSelect}
                    title={fileName || "Click to load audio"}
                >
                    {fileName || "Click to load audio"}
                </div>
                <input
                    type="range"
                    min="0"
                    max="1"
                    step="0.1"
                    value={volume}
                    onChange={handleVolumeChange}
                    className="w-full h-1 bg-gray-600 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
            </div>

            {/* Clear Button */}
            {audioSrc && (
                <button
                    onClick={() => {
                        setAudioSrc(null)
                        setFileName('')
                        setIsPlaying(false)
                    }}
                    className="text-gray-500 hover:text-red-400"
                >
                    <svg className="w-4 h-4" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                        <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                    </svg>
                </button>
            )}
        </div>
    )
}

export default AudioPlayer
