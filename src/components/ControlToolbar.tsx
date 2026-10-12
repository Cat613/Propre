import React, { useState } from 'react'
import BulkEditModal from './BulkEditModal'
import ToolbarActions from './ToolbarActions'
import BibleInsertModal from './BibleInsertModal'
import SongPreparationPanel from './SongPreparationPanel'

const ControlToolbar: React.FC = () => {
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false)
  const [isBibleInsertOpen, setIsBibleInsertOpen] = useState(false)
  const [isSongPreparationOpen, setIsSongPreparationOpen] = useState(false)

  const handleOpenBulkEdit = () => setIsBulkEditOpen(true)

  return (
    <div className="shrink-0 border-b border-white/5 px-4 py-3">
      {/* Left: Toolbar Actions (Clear, Add, AI) */}
      <ToolbarActions
        onOpenBulkEdit={handleOpenBulkEdit}
        onOpenBibleInsert={() => setIsBibleInsertOpen(true)}
        onOpenSongPreparation={() => setIsSongPreparationOpen(true)}
      />

      <BulkEditModal
        isOpen={isBulkEditOpen}
        onClose={() => {
          setIsBulkEditOpen(false)
        }}
      />
      {isBibleInsertOpen && <BibleInsertModal onClose={() => setIsBibleInsertOpen(false)} />}
      {isSongPreparationOpen && (
        <SongPreparationPanel onClose={() => setIsSongPreparationOpen(false)} />
      )}
    </div>
  )
}

export default ControlToolbar
