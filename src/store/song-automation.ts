import type { SongJob } from '../../shared/song-preparation'
import { usePresentationStore as store } from '../store'
import { withOperatorLock } from './preparation'
export function installSongAutomation() {
  const attempted = new Set<string>()
  return window.ipcRenderer.on('song-job-changed', (job: SongJob) => {
    if (!job.automatic || job.status !== 'ready' || attempted.has(job.id)) return
    attempted.add(job.id)
    const dialog =
      document.querySelector<HTMLElement>('[data-song-preparation="true"]') || undefined
    void withOperatorLock(
      () => store.getState().songJobOperation('apply', job.id, job.draftRevision),
      dialog,
    )
      .then(() =>
        store.getState().addToast('AI가 찬양과 콘티 순서를 준비해 저장했습니다.', 'success'),
      )
      .catch(() =>
        store.getState().addToast('AI 준비 내용을 확인한 뒤 플레이리스트에 적용해주세요.', 'info'),
      )
  })
}
