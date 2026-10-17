import React, { lazy, Suspense, useState } from 'react'
import BulkEditModal from './BulkEditModal'
import ToolbarActions from './ToolbarActions'
const BibleInsertModal = lazy(() => import('./BibleInsertModal'))

const ControlToolbar: React.FC = () => {
  const [isBulkEditOpen, setIsBulkEditOpen] = useState(false)
  const [isBibleInsertOpen, setIsBibleInsertOpen] = useState(false)

  const handleOpenBulkEdit = () => setIsBulkEditOpen(true)

  return (
    <div className="shrink-0 px-4 pt-1 pb-2">
      <ToolbarActions
        onOpenBulkEdit={handleOpenBulkEdit}
        onOpenBibleInsert={() => setIsBibleInsertOpen(true)}
      />

      <BulkEditModal
        isOpen={isBulkEditOpen}
        onClose={() => {
          setIsBulkEditOpen(false)
        }}
      />
      {isBibleInsertOpen && (
        <Suspense
          fallback={
            <p role="status" className="text-xs">
              성경 도구 불러오는 중…
            </p>
          }
        >
          <BibleInsertModal onClose={() => setIsBibleInsertOpen(false)} />
        </Suspense>
      )}
    </div>
  )
}

export default ControlToolbar
