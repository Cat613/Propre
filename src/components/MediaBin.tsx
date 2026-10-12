import { Image, Plus } from 'lucide-react'
import { useShallow } from 'zustand/react/shallow'

import { usePresentationStore } from '../store'
import type { MediaItem } from '../types'

const MediaBin: React.FC = () => {
  const { mediaBin, addMediaToBin, removeMediaFromBin, triggerBackground } = usePresentationStore(
    useShallow((state) => ({
      mediaBin: state.mediaBin,
      addMediaToBin: state.addMediaToBin,
      removeMediaFromBin: state.removeMediaFromBin,
      triggerBackground: state.triggerBackground,
    })),
  )

  const handleImport = async () => {
    try {
      const filePaths = await window.ipcRenderer.selectMediaFiles()
      if (filePaths.length > 0) {
        // In a real app we might copy files to a project folder
        // For now we just use the paths
        addMediaToBin(filePaths)
      }
    } catch (error) {
      usePresentationStore
        .getState()
        .addToast('미디어를 가져오지 못했습니다. 파일 형식과 접근 권한을 확인해주세요.', 'error')
    }
  }

  const handleMediaClick = (media: MediaItem) => {
    triggerBackground(media)
  }

  return (
    <div className="flex min-h-0 flex-1 flex-col">
      <div className="flex shrink-0 items-center justify-between gap-2 px-4 pt-4 pb-3">
        <div>
          <h2 className="workbench-heading">미디어 라이브러리</h2>
          <p className="mt-1 text-[10px] text-gray-500">이미지·영상·오디오 {mediaBin.length}개</p>
        </div>
        <button
          type="button"
          onClick={() => void handleImport()}
          className="workbench-button"
          aria-label="미디어 가져오기"
        >
          <Plus size={13} />
          가져오기
        </button>
      </div>
      {/* Media Grid */}
      <div className="workbench-scroll min-h-0 flex-1 overflow-y-auto p-4 pt-0">
        {mediaBin.length === 0 ? (
          <div className="flex h-full min-h-44 flex-col items-center justify-center rounded-xl border border-dashed border-white/10 px-3 py-6 text-center">
            <Image size={28} strokeWidth={1.4} className="mb-3 text-gray-600" />
            <p className="text-xs text-gray-400">배경을 더해보세요</p>
            <p className="mt-2 text-[10px] leading-relaxed text-gray-500">
              미디어를 가져온 뒤 선택하면
              <br />
              배경이나 오디오로 송출됩니다.
            </p>
            <button
              type="button"
              onClick={() => void handleImport()}
              className="workbench-button mt-4"
            >
              <Plus size={13} />
              파일 가져오기
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-2 2xl:grid-cols-3 gap-2">
            {mediaBin.map((media) => (
              <div
                key={media.id}
                role="button"
                tabIndex={0}
                aria-label={`${media.name} 송출`}
                onKeyDown={(e) => {
                  if (e.target === e.currentTarget && (e.key === 'Enter' || e.key === ' ')) {
                    e.preventDefault()
                    e.stopPropagation()
                    handleMediaClick(media)
                  }
                }}
                onClick={() => handleMediaClick(media)}
                className="group relative aspect-video workbench-media-surface rounded-lg overflow-hidden cursor-pointer border border-transparent hover:border-blue-500"
              >
                {media.type === 'audio' ? (
                  <div className="h-full flex items-center justify-center text-xl">♪</div>
                ) : media.type === 'video' ? (
                  <video
                    src={media.url}
                    className="w-full h-full object-cover"
                    muted
                    preload="none"
                    loop // Preview loop
                    onMouseOver={(e) => {
                      void e.currentTarget.play().catch(() => {})
                    }}
                    onMouseOut={(e) => e.currentTarget.pause()}
                  />
                ) : (
                  <img
                    loading="lazy"
                    src={media.url}
                    alt={media.name}
                    className="w-full h-full object-cover"
                  />
                )}

                {/* Type Badge */}
                <span className="absolute bottom-1 right-1 px-1 py-0.5 text-[8px] bg-black/60 text-white rounded uppercase">
                  {media.type}
                </span>

                {/* Name Overlay */}
                <div className="absolute inset-x-0 bottom-0 bg-gradient-to-t from-black/80 to-transparent p-1 opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-opacity">
                  <p className="text-[10px] text-white truncate">{media.name}</p>
                </div>

                {/* Delete Button */}
                <button
                  aria-label={`미디어 삭제: ${media.name}`}
                  onClick={(e) => {
                    e.stopPropagation()
                    removeMediaFromBin(media.id)
                  }}
                  className="absolute top-1 right-1 p-1 bg-black/50 hover:bg-red-600 text-white rounded opacity-0 group-hover:opacity-100 group-focus-within:opacity-100 transition-all"
                >
                  <svg className="w-3 h-3" fill="none" stroke="currentColor" viewBox="0 0 24 24">
                    <path
                      strokeLinecap="round"
                      strokeLinejoin="round"
                      strokeWidth={2}
                      d="M6 18L18 6M6 6l12 12"
                    />
                  </svg>
                </button>
              </div>
            ))}
          </div>
        )}
      </div>
    </div>
  )
}

export default MediaBin
