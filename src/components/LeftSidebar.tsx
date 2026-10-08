import { useState } from 'react'
import BiblePanel from './BiblePanel'
import PlaylistPanel from './PlaylistPanel'
import LibraryPanel from './LibraryPanel'
import { Panel, PanelGroup, PanelResizeHandle } from 'react-resizable-panels'

const LeftSidebar: React.FC = () => {
  const [activeTab, setActiveTab] = useState<'songs' | 'bible'>('songs')

  return (
    <PanelGroup
      direction="vertical"
      autoSaveId="propre-left-sidebar-panels"
      className="h-full min-h-0 flex flex-col"
    >
      <Panel
        id="left-playlist-panel"
        defaultSize={55}
        minSize={25}
        maxSize={80}
        className="min-h-0 flex flex-col"
      >
        <PlaylistPanel />
      </Panel>

      <PanelResizeHandle
        aria-label="플레이리스트와 Songs·Bible 영역 높이 조절"
        title="끌어서 플레이리스트와 Songs·Bible 영역 높이 조절"
        className="h-1 shrink-0 bg-gray-800 hover:bg-blue-600 transition-colors cursor-row-resize"
      />

      <Panel
        id="left-library-panel"
        defaultSize={45}
        minSize={20}
        className="min-h-0 flex flex-col"
      >
        <div className="flex h-full min-h-0 flex-col bg-gray-800/30">
          {/* Tabs */}
          <div className="flex border-b border-gray-800">
            <button
              onClick={() => setActiveTab('songs')}
              className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                activeTab === 'songs'
                  ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-500'
                  : 'bg-gray-900 text-gray-500 hover:text-gray-300'
              }`}
            >
              Songs
            </button>
            <button
              onClick={() => setActiveTab('bible')}
              className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${
                activeTab === 'bible'
                  ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-500'
                  : 'bg-gray-900 text-gray-500 hover:text-gray-300'
              }`}
            >
              Bible
            </button>
          </div>

          {/* Content Area */}
          <div className="flex-1 overflow-hidden flex flex-col">
            {activeTab === 'songs' ? <LibraryPanel /> : <BiblePanel />}
          </div>
        </div>
      </Panel>
    </PanelGroup>
  )
}

export default LeftSidebar
