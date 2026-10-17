import fs from 'node:fs/promises'
import { describe, expect, it, vi, afterAll } from 'vitest'
import { parseBibleQuery } from '../src/utils/bibleParser'
import { BibleService } from '../src/services/BibleService'
import { parseProject, parsePresentation, parseOutput } from '../shared/schema'
import { normalizeSlide, patchSlide, slideText } from '../shared/model'
const date = '2026-10-04T00:00:00.000Z'
export const fixture = {
  id: 'a',
  title: 'A',
  slides: [{ id: 's1', type: 'text' as const, content: 'hello' }],
  createdAt: date,
  updatedAt: date,
}
describe('Bible queries and indexed content', () => {
  vi.stubGlobal(
    'fetch',
    async () =>
      new Response(
        await fs.readFile(new URL('../src/assets/bible/개역개정.json', import.meta.url)),
      ),
  )
  afterAll(() => vi.unstubAllGlobals())
  it.each([
    ['창10:1', '창', 10, 1],
    ['요10:1', '요', 10, 1],
    ['요12:1', '요', 12, 1],
    ['요21:25', '요', 21, 25],
    ['시119:105', '시', 119, 105],
    ['요한복음 3:16-18', '요', 3, 16],
    ['요1 3:16', '요일', 3, 16],
    ['요한일서 3:16', '요일', 3, 16],
    ['창 1', '창', 1, null],
  ])('parses %s', (query, book, chapter, verse) => {
    expect(parseBibleQuery(String(query))).toMatchObject({
      bookId: book,
      chapter,
      verseStart: verse,
    })
  })
  it.each(['창0:1', '시151:1', '요3:18-16', '요3:0', '임의10:1', '창1:1suffix'])(
    'rejects %s',
    (query) => expect(parseBibleQuery(query).bookId).toBeNull(),
  )
  it('resolves numbered-book aliases to actual dataset book IDs', async () => {
    expect(await BibleService.getVerses('요일', 1)).toHaveLength(10)
    expect(await BibleService.getVerses('요이', 1)).toHaveLength(13)
  })
  it('retains source entries combining multiple verses', async () => {
    const verses = await BibleService.getVerses('대상', 16)
    expect(verses.some((v) => v.verseStart === 12 && v.verseEnd === 13)).toBe(true)
  })
  it('indexes chapter 119 in verse order and keeps invalid results empty', async () => {
    const verses = await BibleService.getVerses('시', 119)
    expect(verses.length).toBe(176)
    expect(verses[104].reference).toBe('시 119:105')
    expect(await BibleService.getVerses('창', 999)).toEqual([])
  })
  it('searches full chapters and exact ranges in source order', async () => {
    expect((await BibleService.searchVerses('시편 23')).map((v) => v.reference)).toEqual([
      '시 23:1',
      '시 23:2',
      '시 23:3',
      '시 23:4',
      '시 23:5',
      '시 23:6',
    ])
    expect((await BibleService.searchVerses('요한복음 3:16-18')).map((v) => v.reference)).toEqual([
      '요 3:16',
      '요 3:17',
      '요 3:18',
    ])
    expect((await BibleService.searchVerses('요1 3:16'))[0].reference).toBe('요일 3:16')
  })
  it.each(['요 3:999', '요 3:35-40', '요 22:1', '아무개 1', '대상 16:12'])(
    'rejects absent, partial, invalid or split source ranges: %s',
    async (query) => {
      await expect(BibleService.searchVerses(query)).rejects.toThrow()
    },
  )
  it('keeps combined source verses together when searching their full range', async () => {
    expect(await BibleService.searchVerses('대상 16:12-13')).toMatchObject([
      { reference: '대상 16:12-13', verseStart: 12, verseEnd: 13 },
    ])
  })
})
describe('versioned documents and canonical content', () => {
  it('migrates legacy documents with fresh identities', () => {
    const a = parseProject(JSON.stringify({ title: 'legacy', slides: fixture.slides }))
        .presentations[0],
      b = parseProject(JSON.stringify({ title: 'legacy', slides: fixture.slides })).presentations[0]
    expect(a.id).not.toBe(b.id)
    expect(a.schemaVersion).toBe(1)
    expect(a.globalSlideStyle?.fontSize).toBe(60)
  })
  it.each([
    { ...fixture, schemaVersion: 99 },
    { ...fixture, slides: [{ id: 's1', type: 'script' }] },
    { ...fixture, slides: [fixture.slides[0], fixture.slides[0]] },
    { ...fixture, globalSlideStyle: { fontSize: NaN } },
  ])('rejects invalid nested input', (raw) => expect(() => parsePresentation(raw)).toThrow())
  it('rejects future project versions before applying', () =>
    expect(() =>
      parseProject(
        JSON.stringify({
          format: 'propre-project',
          schemaVersion: 2,
          kind: 'presentation',
          presentations: [fixture],
        }),
      ),
    ).toThrow())
  it('keeps all text entry paths consistent with element content', () => {
    const slide = {
      id: 's',
      type: 'text' as const,
      content: 'old',
      elements: [
        {
          id: 'e1',
          type: 'text' as const,
          text: 'old',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 1,
          styles: {},
        },
        {
          id: 'e2',
          type: 'text' as const,
          text: 'second',
          x: 0,
          y: 0,
          width: 100,
          height: 100,
          zIndex: 2,
          styles: {},
        },
      ],
    }
    const next = patchSlide(slide, { content: 'new\ntext' })
    expect(slideText(next)).toBe('new\ntext')
    expect(next.content).toBe('new\ntext')
    expect(next.elements?.length).toBe(1)
  })
  it('converts ambiguous legacy units once, while preserving explicit pixels', () => {
    const e = {
      id: 'e',
      type: 'text' as const,
      text: 'test',
      x: 200,
      y: 30,
      width: 1800,
      height: 80,
      zIndex: 1,
      styles: {},
    }
    const a = normalizeSlide({ id: 's', type: 'text', elements: [e] })
    expect(a.elements?.[0].x).toBeCloseTo((200 / 1920) * 100)
    expect(a.elements?.[0].y).toBe(30)
    expect(normalizeSlide(a)).toEqual(a)
    expect(
      normalizeSlide({ id: 's', type: 'text', elements: [{ ...e, coordinateUnit: 'pixel' }] })
        .elements?.[0].x,
    ).toBe(200)
  })
  it('rejects unsafe URLs and out of bounds runtime layers', () =>
    expect(() =>
      parseOutput({
        type: 'state-update',
        layers: {
          audio: null,
          background: { type: 'image', url: 'https://evil.example/a' },
          slide: null,
          announcement: null,
          props: [],
          message: null,
        },
      }),
    ).toThrow())
})
