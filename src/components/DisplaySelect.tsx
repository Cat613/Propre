import React from 'react'

interface DisplayInfo {
    id: number
    label: string
    bounds: { x: number, y: number, width: number, height: number }
}

interface DisplaySelectProps {
    displays: DisplayInfo[]
    outputDisplay: number | ''
    stageDisplay: number | ''
    onOutputChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
    onStageChange: (e: React.ChangeEvent<HTMLSelectElement>) => void
}

const DisplaySelect: React.FC<DisplaySelectProps> = ({
    displays,
    outputDisplay,
    stageDisplay,
    onOutputChange,
    onStageChange
}) => {
    return (
        <div className="flex flex-wrap items-center gap-3 py-1">
            {/* Output Display Settings */}
            <div className="flex items-center gap-2 bg-gray-900/40 px-2 py-1 rounded-lg border border-gray-700/50">
                <span className="text-[10px] text-gray-400 font-bold uppercase tracking-wider">메인 출력</span>
                <select
                    value={outputDisplay}
                    onChange={onOutputChange}
                    className="bg-transparent text-xs font-medium text-gray-200 focus:outline-none cursor-pointer hover:text-white transition-colors"
                >
                    <option value="" className="bg-gray-800">화면 선택...</option>
                    {displays.map(d => (
                        <option key={d.id} value={d.id} className="bg-gray-800">
                            {d.label} ({d.bounds.width}x{d.bounds.height})
                        </option>
                    ))}
                </select>
            </div>

            {/* Stage Display Settings */}
            <div className="flex items-center gap-2 bg-gray-900/40 px-2 py-1 rounded-lg border border-gray-700/50">
                <span className="text-[10px] text-purple-400 font-bold uppercase tracking-wider">무대 모니터</span>
                <select
                    value={stageDisplay}
                    onChange={onStageChange}
                    className="bg-transparent text-xs font-medium text-gray-200 focus:outline-none cursor-pointer hover:text-white transition-colors"
                >
                    <option value="" className="bg-gray-800">화면 선택...</option>
                    {displays.map(d => (
                        <option key={d.id} value={d.id} className="bg-gray-800">
                            {d.label} ({d.bounds.width}x{d.bounds.height})
                        </option>
                    ))}
                </select>
            </div>
        </div>
    )
}

export default DisplaySelect
