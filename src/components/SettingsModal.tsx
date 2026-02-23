// src/components/SettingsModal.tsx
import React, { useState, useEffect } from 'react'
import { usePresentationStore } from '../store'

interface SettingsModalProps {
    isOpen: boolean
    onClose: () => void
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
    const { geminiApiKey, setGeminiKey } = usePresentationStore()
    const [keyInput, setKeyInput] = useState('')

    useEffect(() => {
        if (isOpen) {
            setKeyInput(geminiApiKey || '')
        }
    }, [isOpen, geminiApiKey])

    const handleSave = () => {
        setGeminiKey(keyInput.trim() || null)
        onClose()
    }

    if (!isOpen) return null

    return (
        <div className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4">
            <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-md border border-gray-700">
                <div className="flex justify-between items-center p-4 border-b border-gray-800">
                    <h2 className="text-lg font-bold text-white">애플리케이션 설정</h2>
                    <button onClick={onClose} className="text-gray-400 hover:text-white">
                        <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                            <path strokeLinecap="round" strokeLinejoin="round" strokeWidth={2} d="M6 18L18 6M6 6l12 12" />
                        </svg>
                    </button>
                </div>

                <div className="p-4 space-y-4">
                    <div>
                        <label className="block text-sm font-medium text-gray-300 mb-1">
                            Google Gemini API Key (Gemini 1.5 Pro)
                        </label>
                        <input
                            type="password"
                            value={keyInput}
                            onChange={(e) => setKeyInput(e.target.value)}
                            placeholder="AIza..."
                            className="w-full bg-gray-800 border border-gray-700 rounded p-2 text-white focus:border-blue-500 outline-none text-sm"
                        />
                        <p className="text-xs text-gray-500 mt-2">
                            악보에서 가사를 추출하는 '악보 AI 변환' 기능에 사용됩니다. 키는 브라우저 내부(로컬)에만 안전하게 저장됩니다.
                        </p>
                    </div>
                </div>

                <div className="p-4 border-t border-gray-800 flex justify-end gap-2 bg-gray-900/50 rounded-b-xl">
                    <button
                        onClick={onClose}
                        className="px-4 py-2 rounded text-sm font-medium text-gray-300 hover:bg-gray-800"
                    >
                        취소
                    </button>
                    <button
                        onClick={handleSave}
                        className="px-4 py-2 rounded text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg"
                    >
                        저장
                    </button>
                </div>
            </div>
        </div>
    )
}

export default SettingsModal
