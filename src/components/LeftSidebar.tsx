import { useState } from 'react'
import BiblePanel from './BiblePanel'
import PlaylistPanel from './PlaylistPanel'
import LibraryPanel from './LibraryPanel'

const LeftSidebar: React.FC = () => {
    const [activeTab, setActiveTab] = useState<'songs' | 'bible'>('songs')

    return (
        <div className="flex flex-col h-full">
            {/* Top Half: Playlist */}
            <PlaylistPanel />

            {/* Bottom Half: Tabs + Content */}
            <div className="flex-1 flex flex-col min-h-0 bg-gray-800/30 border-t border-gray-800">
                {/* Tabs */}
                <div className="flex border-b border-gray-800">
                    <button
                        onClick={() => setActiveTab('songs')}
                        className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'songs'
                            ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-500'
                            : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        Songs
                    </button>
                    <button
                        onClick={() => setActiveTab('bible')}
                        className={`flex-1 py-2 text-xs font-bold uppercase tracking-wider transition-colors ${activeTab === 'bible'
                            ? 'bg-gray-800 text-blue-400 border-b-2 border-blue-500'
                            : 'bg-gray-900 text-gray-500 hover:text-gray-300'
                            }`}
                    >
                        Bible
                    </button>
                </div>

                {/* Content Area */}
                <div className="flex-1 overflow-hidden flex flex-col">
                    {activeTab === 'songs' ? (
                        <LibraryPanel />
                    ) : (
                        <BiblePanel />
                    )}
                </div>
            </div>
        </div>
    )
}

export default LeftSidebar
