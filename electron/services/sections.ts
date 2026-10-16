import { sectionIndex, SectionRequest } from '../../shared/sections'
import type { Repository, RepositoryState } from './repository'
import type { WindowManager } from './windows'
import type { OutputSource } from './output-source'
export class SectionNavigation {
  private busy = false
  constructor(
    private repo: Repository,
    private windows: WindowManager,
    private sources: OutputSource,
    private otherBusy: () => boolean,
  ) {
    const guard = repo.assertServiceMutation
    repo.assertServiceMutation = (state) => {
      guard?.(state)
      if (
        this.executing() &&
        this.current &&
        this.find(state, this.current.id)?.revision !== this.current.revision
      )
        throw new Error('구간 송출을 마친 뒤 자료를 수정해주세요.')
    }
  }
  private current?: { id: string; revision: number }
  private find(state: RepositoryState, id: string) {
    return [
      ...state.library,
      ...state.setlistSongs.map((entry) => entry.presentation),
      ...state.cuePresentations.map((entry) => entry.presentation),
    ].find((p) => p.id === id)
  }
  executing() {
    return this.busy
  }
  async take(raw: unknown) {
    if (this.busy || this.otherBusy())
      throw new Error('진행 중인 송출을 마친 뒤 다시 시도해주세요.')
    const request = SectionRequest.parse(raw),
      p = this.find(this.repo.state, request.presentationId)
    if (
      !p ||
      p.revision !== request.presentationRevision ||
      this.sources.generation !== request.expectedOutputGeneration ||
      !sectionIndex(p).occurrences.some((section) => section.firstSlideId === request.firstSlideId)
    )
      throw new Error('구간이나 송출 화면이 바뀌었습니다. 다시 선택해주세요.')
    const index = p.slides.findIndex((slide) => slide.id === request.firstSlideId),
      slide = p.slides[index]
    const previous = this.windows.live()
    this.busy = true
    this.current = { id: p.id, revision: p.revision || 0 }
    try {
      await this.sources.commitSlides(
        {
          type: 'state-update',
          isGreenScreen: previous?.isGreenScreen,
          globalSlideStyle: p.globalSlideStyle,
          layers: {
            ...(previous?.layers || {
              audio: null,
              background: { type: 'none' },
              announcement: null,
              message: null,
              props: [],
            }),
            slide,
            ...(slide.backgroundUrl
              ? {
                  background: {
                    type: slide.type === 'video' ? 'video' : 'image',
                    url: slide.backgroundUrl,
                  },
                }
              : {}),
          },
        },
        {
          current: slide,
          next: p.slides[index + 1] || null,
          globalSlideStyle: p.globalSlideStyle,
          settings: this.windows.stageLive()?.settings,
        },
      )
      this.windows.notify('service-cue-applied', {
        presentation: p,
        slideId: slide.id,
        visual: 'bound',
        audio: 'keep',
        manual: true,
      })
    } finally {
      this.busy = false
      this.current = undefined
    }
  }
}
