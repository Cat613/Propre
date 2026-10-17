import { useShallow } from 'zustand/react/shallow'
import { useModalGuard } from '../hooks/useModalGuard'
// src/components/SettingsModal.tsx
import React, { useState } from 'react'
import { usePresentationStore } from '../store'
import { LayerType } from '../types'
import AIProfilesPanel from './AIProfilesPanel'
import AIConnectionPanel from './AIConnectionPanel'

interface SettingsModalProps {
  isOpen: boolean
  onClose: () => void
}

const SettingsModal: React.FC<SettingsModalProps> = ({ isOpen, onClose }) => {
  useModalGuard(isOpen, onClose)
  const {
    screenLooks,
    updateScreenLook,
    stageCurrentFontSize,
    setStageCurrentFontSize,
    stageNextFontSize,
    setStageNextFontSize,
  } = usePresentationStore(
    useShallow((state) => ({
      screenLooks: state.screenLooks,
      updateScreenLook: state.updateScreenLook,
      stageCurrentFontSize: state.stageCurrentFontSize,
      setStageCurrentFontSize: state.setStageCurrentFontSize,
      stageNextFontSize: state.stageNextFontSize,
      setStageNextFontSize: state.setStageNextFontSize,
    })),
  )
  const [activeTab, setActiveTab] = useState<'routing' | 'stage' | 'connection'>('connection')

  const layers: { id: LayerType; label: string }[] = [
    { id: 'audio', label: '오디오' },
    { id: 'background', label: '배경 (이미지/영상)' },
    { id: 'slide', label: '슬라이드 (가사/성경)' },
    { id: 'announcement', label: '광고' },
    { id: 'prop', label: '프롭 (로고/시계)' },
    { id: 'message', label: '하단 자막' },
  ]

  if (!isOpen) return null

  return (
    <div
      data-modal="true"
      role="dialog"
      aria-modal="true"
      aria-label="시스템 환경 설정"
      className="fixed inset-0 bg-black/80 flex items-center justify-center z-[60] p-4"
    >
      <div className="bg-gray-900 rounded-xl shadow-2xl w-full max-w-xl border border-gray-700">
        <div className="flex justify-between items-center p-4 border-b border-gray-800">
          <div className="flex space-x-4">
            <button
              onClick={() => setActiveTab('connection')}
              className={`text-sm font-bold pb-1 border-b-2 transition-colors ${activeTab === 'connection' ? 'text-white border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}
            >
              AI 연결
            </button>
            <button
              onClick={() => setActiveTab('routing')}
              className={`text-lg font-bold pb-1 border-b-2 transition-colors ${activeTab === 'routing' ? 'text-white border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}
            >
              출력 라우팅
            </button>
            <button
              onClick={() => setActiveTab('stage')}
              className={`text-lg font-bold pb-1 border-b-2 transition-colors ${activeTab === 'stage' ? 'text-white border-blue-500' : 'text-gray-500 border-transparent hover:text-gray-300'}`}
            >
              무대 모니터
            </button>
          </div>

          <button aria-label="창 닫기" onClick={onClose} className="text-gray-400 hover:text-white">
            <svg className="w-6 h-6" fill="none" stroke="currentColor" viewBox="0 0 24 24">
              <path
                strokeLinecap="round"
                strokeLinejoin="round"
                strokeWidth={2}
                d="M6 18L18 6M6 6l12 12"
              />
            </svg>
          </button>
        </div>

        <div className="p-4 overflow-y-auto max-h-[60vh]">
          {activeTab === 'connection' && (
            <div className="space-y-4">
              <AIProfilesPanel />
              <AIConnectionPanel />
            </div>
          )}
          {activeTab === 'routing' && (
            <div className="space-y-4">
              <p className="text-sm text-gray-400 mb-2">
                물리적인 출력망(화면)별로 표시할 레이어를 개별적으로 설정합니다. 체크박스를 해제하면
                해당 화면에서는 그 레이어가 송출되지 않습니다.
              </p>

              <div className="border border-gray-700 rounded-lg overflow-hidden">
                <table className="w-full text-sm text-left text-gray-300">
                  <thead className="text-xs text-gray-400 bg-gray-800 uppercase border-b border-gray-700">
                    <tr>
                      <th className="px-4 py-3 border-r border-gray-700">레이어</th>
                      <th className="px-4 py-3 text-center border-r border-gray-700">
                        메인 화면 (Main)
                      </th>
                      <th className="px-4 py-3 text-center">크로마키 (Chroma)</th>
                    </tr>
                  </thead>
                  <tbody>
                    {layers.map((layer) => (
                      <tr
                        key={layer.id}
                        className="border-b border-gray-800 bg-gray-900 hover:bg-gray-800/50"
                      >
                        <td className="px-4 py-2 font-medium border-r border-gray-700 text-gray-200">
                          {layer.label}
                        </td>
                        <td className="px-4 py-2 text-center border-r border-gray-700">
                          <input
                            type="checkbox"
                            className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                            checked={screenLooks['main']?.[layer.id]?.isVisible ?? true}
                            onChange={(e) =>
                              updateScreenLook('main', layer.id, { isVisible: e.target.checked })
                            }
                          />
                        </td>
                        <td className="px-4 py-2 text-center">
                          <input
                            type="checkbox"
                            className="w-4 h-4 text-blue-600 bg-gray-700 border-gray-600 rounded focus:ring-blue-500"
                            checked={screenLooks['chroma']?.[layer.id]?.isVisible ?? true}
                            onChange={(e) =>
                              updateScreenLook('chroma', layer.id, { isVisible: e.target.checked })
                            }
                          />
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
              </div>
            </div>
          )}

          {activeTab === 'stage' && (
            <div className="space-y-6">
              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-300">
                    현재 슬라이드 본문 크기
                  </label>
                  <span className="text-sm text-blue-400">{stageCurrentFontSize}px</span>
                </div>
                <input
                  type="range"
                  min="20"
                  max="200"
                  value={stageCurrentFontSize}
                  onChange={(e) => setStageCurrentFontSize(parseInt(e.target.value, 10))}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  현재 찬양·성경 본문의 최대 크기입니다. 긴 본문은 영역에 맞춰 작아집니다.
                </p>
              </div>

              <div>
                <div className="flex items-center justify-between mb-1">
                  <label className="text-sm font-medium text-gray-300">
                    다음 슬라이드 본문 크기
                  </label>
                  <span className="text-sm text-blue-400">{stageNextFontSize}px</span>
                </div>
                <input
                  type="range"
                  min="10"
                  max="100"
                  value={stageNextFontSize}
                  onChange={(e) => setStageNextFontSize(parseInt(e.target.value, 10))}
                  className="w-full h-2 bg-gray-700 rounded-lg appearance-none cursor-pointer accent-blue-500"
                />
                <p className="text-xs text-gray-500 mt-1">
                  다음 찬양·성경 본문의 최대 크기입니다. 글꼴·색상·정렬은 메인 스타일을 따릅니다.
                </p>
              </div>
            </div>
          )}
        </div>

        <div className="p-4 border-t border-gray-800 flex justify-end bg-gray-900/50 rounded-b-xl">
          <button
            onClick={onClose}
            className="px-4 py-2 rounded text-sm font-bold bg-blue-600 hover:bg-blue-700 text-white shadow-lg"
          >
            완료
          </button>
        </div>
      </div>
    </div>
  )
}

export default SettingsModal
