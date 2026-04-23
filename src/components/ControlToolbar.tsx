import React, { useState } from 'react'
import BulkEditModal from './BulkEditModal'
import ToolbarActions from './ToolbarActions'

const ControlToolbar: React.FC = () => {
    const [isBulkEditOpen, setIsBulkEditOpen] = useState(false)
    const [initialBulkText, setInitialBulkText] = useState<string | undefined>(undefined)

    const handleOpenBulkEdit = (initialText?: string) => {
        if (initialText) setInitialBulkText(initialText)
        setIsBulkEditOpen(true)
    }

    return (
        <div className="bg-gray-800 border-b border-gray-700 p-2 flex flex-wrap items-center justify-between gap-y-3 gap-x-2 shadow-sm">
            {/* Left: Toolbar Actions (Clear, Add, AI) */}
            <ToolbarActions
                onOpenSettings={() => { }} // Disabled as settings moved
                onOpenBulkEdit={handleOpenBulkEdit}
            />

            {/* Right: Audio Player, Stage Toggle, Screen Select, Settings */}
            <div className="flex flex-wrap items-center gap-3">
                {/* Simplified Toolbar can hold quick actions here if needed */}
                <div className="text-[10px] text-gray-500 flex items-center pr-2">
                    오디오 및 디스플레이 설정은 '설정' 탭을 이용하세요.
                </div>
            </div>

            <BulkEditModal
                isOpen={isBulkEditOpen}
                onClose={() => {
                    setIsBulkEditOpen(false)
                    setInitialBulkText(undefined)
                }}
                initialTextOverride={initialBulkText}
            />
        </div>
    )
}

export default ControlToolbar
