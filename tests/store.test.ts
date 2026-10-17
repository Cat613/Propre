import { beforeAll, beforeEach, afterAll, describe, it, expect, vi } from 'vitest'
import type { StoreState } from '../src/store/types'
import type { usePresentationStore as Store } from '../src/store'
import { outputSnapshot, stageSnapshot } from '../src/store/helpers'
import { DEFAULT_STYLE } from '../shared/model'
let store: typeof Store
let initial: StoreState
const ipc = {
  savePlaylist: vi.fn(async () => true),
  mergeToLibrary: vi.fn(async () => []),
  deleteFromLibrary: vi.fn(async () => []),
  saveDraft: vi.fn(async () => []),
  saveToLibrary: vi.fn(async () => true),
}
beforeAll(async () => {
  vi.stubGlobal('window', { ipcRenderer: ipc })
  store = (await import('../src/store')).usePresentationStore
  initial = store.getState()
})

beforeEach(() => {
  store.setState(initial, true)
  store.temporal.getState().clear()
  vi.clearAllMocks()
})
afterAll(() => vi.unstubAllGlobals())
const now = '2026-10-04T00:00:00.000Z'
const presentation = (id: string) => ({
  id,
  title: id,
  slides: [{ id: id + '-s', type: 'text' as const, content: id }],
  createdAt: now,
  updatedAt: now,
})
describe('editing boundaries', () => {
  it('importing and Bible replacement change identity', () => {
    store.setState({ library: [presentation('a')] })
    store.getState().selectPresentation('a')
    store.getState().openPresentation(presentation('b'))
    expect(store.getState().currentPresentationId).not.toBe('a')
    expect(store.getState().slides[0].content).toBe('b')
  })
  it('undo never moves another document content into current identity', () => {
    store.setState({ library: [presentation('a'), presentation('b')] })
    store.getState().selectPresentation('a')
    store.getState().updateSlide('a-s', { content: 'edit-a' })
    store.getState().selectPresentation('b')
    store.temporal.getState().undo()
    expect(store.getState().currentPresentationId).toBe('b')
    expect(store.getState().slides[0].content).toBe('b')
    expect(store.temporal.getState().pastStates).toHaveLength(0)
  })
  it('selection and toasts do not evict edits from history', () => {
    store.getState().setSlides(presentation('a').slides)
    store.temporal.getState().clear()
    store.getState().updateSlide('a-s', { content: 'edited' })
    for (let i = 0; i < 80; i++) store.getState().setSelectedSlideIds(i % 2 ? ['a-s'] : [])
    expect(store.temporal.getState().pastStates).toHaveLength(1)
    store.temporal.getState().undo()
    expect(store.getState().slides[0].content).toBe('a')
  })
  it('deleting, updating, reordering and undo are reflected in whole snapshots', () => {
    store.getState().setSlides([...presentation('a').slides, ...presentation('b').slides])
    store.getState().setActiveSlide('a-s')
    store.getState().updateSlide('a-s', { content: 'new' })
    expect(stageSnapshot(store.getState()).current?.content).toBe('new')
    store.getState().reorderSlides(1, 0)
    expect(stageSnapshot(store.getState()).next).toBeNull()
    store.getState().deleteSlide('a-s')
    expect(outputSnapshot(store.getState()).layers.slide).toBeNull()
    expect(stageSnapshot(store.getState()).current).toBeNull()
  })
  it('clearing all stops every visual and audio layer', () => {
    store.setState({
      activeSlideId: 'a-s',
      activeBackground: { type: 'image', url: 'media://asset/a/image.png' },
      activeAudio: { id: 'a', url: 'media://asset/a/audio.mp3', name: 'audio', playing: true },
      activeProps: [{ id: 'p', type: 'text', content: 'logo', position: 'center' }],
      activeMessage: { id: 'm', content: 'text', isScrolling: false },
      activeAnnouncement: presentation('a').slides[0],
    })
    store.getState().clearAll()
    expect(outputSnapshot(store.getState()).layers).toEqual({
      audio: null,
      background: { type: 'none' },
      slide: null,
      announcement: null,
      props: [],
      message: null,
    })
  })
  it('preserves the presentation saved style when reopening', () => {
    store.setState({
      library: [
        {
          ...presentation('a'),
          globalSlideStyle: {
            fontSize: 99,
            fontColor: '#ffffff',
            fontFamily: 'serif',
            align: 'left',
            verticalAlign: 'bottom',
          },
        },
      ],
    })
    store.getState().selectPresentation('a')
    expect(store.getState().globalSlideStyle.fontSize).toBe(99)
  })
  it('does not optimistically change playlist when persistence fails', async () => {
    store.setState({ library: [presentation('a')] })
    ipc.savePlaylist.mockRejectedValueOnce(new Error('disk'))
    await expect(store.getState().addToPlaylist('a')).rejects.toThrow()
    expect(store.getState().playlist).toEqual([])
  })
  it('propagates import failure so callers cannot show success', async () => {
    ipc.mergeToLibrary.mockRejectedValueOnce(new Error('disk'))
    await expect(store.getState().importPresentations([presentation('a')])).rejects.toThrow()
  })
  it('recognizes audio and stores a registered URL without file prefix or fragments', () => {
    store.getState().addMediaToBin(['media://asset/a/name%20one.mp3', 'media://asset/b/image.png'])
    expect(store.getState().mediaBin[0]).toMatchObject({
      type: 'audio',
      url: 'media://asset/a/name%20one.mp3',
      name: 'name one.mp3',
    })
  })
})

describe('automatic presentation presets', () => {
  const song = {
    id: 'song-preset',
    name: '찬양',
    style: { ...DEFAULT_STYLE, fontColor: '#60a5fa' },
  }
  const bible = {
    id: 'bible-preset',
    name: '성경',
    style: { ...DEFAULT_STYLE, fontFamily: 'serif', align: 'left' as const },
  }
  const scripture = {
    ...presentation('bible'),
    slides: [{ id: 'bible-s', type: 'bible' as const, content: '합성 본문' }],
  }
  beforeEach(() =>
    store.setState({
      globalStylePresets: [song, bible],
      defaultSongPresetId: song.id,
      defaultBiblePresetId: bible.id,
    }),
  )

  it('applies configured presets when selecting existing song and scripture documents', () => {
    store.setState({ library: [presentation('song'), scripture] })
    store.getState().selectPresentation('song')
    expect(store.getState()).toMatchObject({
      globalSlideStyle: song.style,
      activePresetId: song.id,
    })
    store.getState().selectPresentation('bible')
    expect(store.getState()).toMatchObject({
      globalSlideStyle: bible.style,
      activePresetId: bible.id,
    })
    expect(store.temporal.getState().pastStates).toHaveLength(0)
  })
  it('applies presets to new and imported documents without sharing mutable style objects', () => {
    store.getState().createNewPresentation()
    expect(store.getState().globalSlideStyle).toEqual(song.style)
    expect(store.getState().globalSlideStyle).not.toBe(song.style)
    store.getState().openPresentation(scripture)
    expect(store.getState().globalSlideStyle).toEqual(bible.style)
    expect(store.getState().globalSlideStyle).not.toBe(bible.style)
  })
  it('applies on first broadcast and type changes while preserving manual changes within a type', () => {
    store
      .getState()
      .setSlides([
        ...presentation('song').slides,
        ...presentation('next').slides,
        ...scripture.slides,
      ])
    store.getState().setActiveSlide('song-s')
    expect(store.getState().globalSlideStyle).toEqual(song.style)
    store.getState().updateGlobalSlideStyle({ fontColor: '#ff0000' })
    store.getState().setActiveSlide('next-s')
    expect(store.getState().globalSlideStyle.fontColor).toBe('#ff0000')
    store.getState().setActiveSlide('bible-s')
    expect(store.getState().globalSlideStyle).toEqual(bible.style)
    expect(outputSnapshot(store.getState()).globalSlideStyle).toEqual(
      stageSnapshot(store.getState()).globalSlideStyle,
    )
    store.getState().setActiveSlide('song-s')
    expect(store.getState().globalSlideStyle).toEqual(song.style)
  })
  it('changing the current type default applies immediately without applying the other type', () => {
    store.setState({
      slides: presentation('song').slides,
      globalSlideStyle: { ...DEFAULT_STYLE, fontSize: 99 },
    })
    store.getState().setDefaultPreset('bible', bible.id)
    expect(store.getState().globalSlideStyle.fontSize).toBe(99)
    store.getState().setDefaultPreset('song', song.id)
    expect(store.getState().globalSlideStyle).toEqual(song.style)
  })
  it('keeps saved styles when no preset is selected or the configured preset is missing', () => {
    const saved = { ...presentation('saved'), globalSlideStyle: { ...DEFAULT_STYLE, fontSize: 99 } }
    store.setState({ library: [saved], defaultSongPresetId: 'missing-preset' })
    store.getState().selectPresentation(saved.id)
    store.getState().setActiveSlide('saved-s')
    expect(store.getState().globalSlideStyle.fontSize).toBe(99)
    store.getState().setDefaultPreset('song', null)
    expect(store.getState().globalSlideStyle.fontSize).toBe(99)
  })
  it('removing a preset clears its assignments and retains the current style', () => {
    store.getState().createNewPresentation()
    store.getState().deleteGlobalStylePreset(song.id)
    expect(store.getState()).toMatchObject({
      defaultSongPresetId: null,
      activePresetId: null,
      globalSlideStyle: song.style,
    })
  })
})

describe('inserting scripture into a song', () => {
  const verses = [
    { id: 'verse-1', type: 'bible' as const, content: '말씀 본문 1', bibleReference: '합성 1:1' },
    { id: 'verse-2', type: 'bible' as const, content: '말씀 본문 2', bibleReference: '합성 1:2' },
  ]
  beforeEach(() => {
    store.setState({ library: [presentation('song')] })
    store.getState().selectPresentation('song')
    store.getState().addSlide({ id: 'song-end', type: 'text', content: '찬양 마지막' })
    store.getState().setActiveSlide('song-s')
    store.temporal.getState().clear()
  })
  it('inserts a range atomically, preserves identity and live song, and updates the next monitor slide', () => {
    const style = store.getState().globalSlideStyle
    expect(store.getState().insertSlides(verses, 'song-s')).toBe(true)
    expect(store.getState().slides.map((slide) => slide.id)).toEqual([
      'song-s',
      'verse-1',
      'verse-2',
      'song-end',
    ])
    expect(store.getState()).toMatchObject({
      currentPresentationId: 'song',
      currentPresentationTitle: 'song',
      activeSlideId: 'song-s',
      selectedSlideIds: ['verse-1', 'verse-2'],
      globalSlideStyle: style,
    })
    expect(outputSnapshot(store.getState()).layers.slide?.id).toBe('song-s')
    expect(stageSnapshot(store.getState()).next?.bibleReference).toBe('합성 1:1')
    expect(store.temporal.getState().pastStates).toHaveLength(1)
    store.temporal.getState().undo()
    expect(store.getState().slides.map((slide) => slide.id)).toEqual(['song-s', 'song-end'])
    expect(store.getState().activeSlideId).toBe('song-s')
    store.temporal.getState().redo()
    expect(store.getState().slides.map((slide) => slide.id)).toEqual([
      'song-s',
      'verse-1',
      'verse-2',
      'song-end',
    ])
  })
  it('supports beginning, end and an empty presentation', () => {
    store.getState().insertSlides([verses[0]], null)
    store.getState().insertSlides([verses[1]])
    expect(store.getState().slides.map((slide) => slide.id)).toEqual([
      'verse-1',
      'song-s',
      'song-end',
      'verse-2',
    ])
    store.getState().setSlides([])
    store.getState().insertSlides(verses)
    expect(store.getState().slides.map((slide) => slide.id)).toEqual(['verse-1', 'verse-2'])
  })
  it('rejects a deleted insertion point or an empty selection without changing the song', () => {
    const before = store.getState().slides
    expect(store.getState().insertSlides(verses, 'deleted')).toBe(false)
    expect(store.getState().insertSlides([])).toBe(false)
    expect(store.getState().slides).toBe(before)
    expect(store.temporal.getState().pastStates).toHaveLength(0)
  })
})

it('a late audio handoff cannot restart sound or restore an external source after full stop', async () => {
  const status = {
    source: { kind: 'web', resourceId: 'web', name: 'web', host: 'localhost' },
    generation: 7,
    browser: {
      resourceId: 'web',
      url: 'http://localhost',
      loading: false,
      live: true,
      muted: false,
      zoom: 1,
    },
  } as const
  let release!: (value: unknown) => void
  const mute = vi.fn(
    () =>
      new Promise((resolve) => {
        release = resolve
      }),
  )
  Object.assign(ipc, {
    getExternalOutput: vi.fn(async () => status),
    browserOutputCommand: mute,
    stopExternalOutput: vi.fn(async () => {}),
  })
  store.setState({ externalOutput: status })
  const playing = store
    .getState()
    .playAudio({ id: 'audio', type: 'audio', name: 'clip', url: 'media://asset/a/clip.wav' })
  await vi.waitFor(() => expect(mute).toHaveBeenCalled())
  store.getState().clearAll()
  store.setState({ externalOutput: { source: { kind: 'slides' }, generation: 8 } })
  release({ ...status, browser: { ...status.browser, muted: true } })
  await playing
  expect(store.getState().activeAudio).toBeNull()
  expect(store.getState().externalOutput).toEqual({ source: { kind: 'slides' }, generation: 8 })
})
