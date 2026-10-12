import { useState } from 'react'
import { BookOpen, Music2 } from 'lucide-react'
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
        className="workbench-resize workbench-resize-vertical"
      />
      <Panel
        id="left-library-panel"
        defaultSize={45}
        minSize={20}
        className="min-h-0 flex flex-col"
      >
        <div className="flex h-full min-h-0 flex-col border-t border-white/5">
          <nav aria-label="자료 종류" className="shrink-0 px-3 pt-3">
            <div className="workbench-tabs">
              <button
                type="button"
                aria-pressed={activeTab === 'songs'}
                onClick={() => setActiveTab('songs')}
                className="workbench-tab"
              >
                <Music2 size={14} />
                Songs
              </button>
              <button
                type="button"
                aria-pressed={activeTab === 'bible'}
                onClick={() => setActiveTab('bible')}
                className="workbench-tab"
              >
                <BookOpen size={14} />
                Bible
              </button>
            </div>
          </nav>
          <div className="flex min-h-0 flex-1 flex-col overflow-hidden">
            {activeTab === 'songs' ? <LibraryPanel /> : <BiblePanel />}
          </div>
        </div>
      </Panel>
    </PanelGroup>
  )
}
export default LeftSidebar
