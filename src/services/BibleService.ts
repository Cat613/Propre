import { parseBibleQuery } from '../utils/bibleParser'

export interface BibleVerse {
  reference: string
  content: string
  verseStart: number
  verseEnd: number
}
let indexPromise: Promise<Map<string, BibleVerse[]>> | undefined
async function index() {
  if (!indexPromise)
    indexPromise = import('../assets/bible/개역개정.json?url')
      .then(async (raw) => {
        const response = await fetch(raw.default)
        if (!response.ok) throw new Error('성경 자료를 불러오지 못했습니다.')
        const data = (await response.json()) as Record<string, string>
        const result = new Map<string, BibleVerse[]>()
        for (const [reference, content] of Object.entries(data)) {
          const match = reference.match(/^([가-힣]+)(\d+):(\d+)(?:-(\d+))?$/)
          if (!match) continue
          const key = `${match[1]}:${match[2]}`,
            list = result.get(key) || []
          list.push({
            reference: `${match[1]} ${match[2]}:${match[3]}${match[4] ? '-' + match[4] : ''}`,
            content: content.trim(),
            verseStart: Number(match[3]),
            verseEnd: Number(match[4] || match[3]),
          })
          result.set(key, list)
        }
        for (const verses of result.values()) verses.sort((a, b) => a.verseStart - b.verseStart)
        return result
      })
      .catch((error) => {
        indexPromise = undefined
        throw error
      })
  return indexPromise
}
export const BibleService = {
  getVerses: async (book: string, chapter: number): Promise<BibleVerse[]> => [
    ...((await index()).get(`${book}:${chapter}`) || []),
  ],
  searchVerses: async (query: string): Promise<BibleVerse[]> => {
    const parsed = parseBibleQuery(query)
    if (!parsed.bookId || !parsed.chapter)
      throw new Error('성경 위치를 확인해주세요. 예: 요 3:16, 시편 23:1-6, 창 1')

    const data = await BibleService.getVerses(parsed.bookId, parsed.chapter)
    const verses =
      parsed.verseStart === null
        ? data
        : data.filter(
            (verse) => verse.verseStart >= parsed.verseStart! && verse.verseEnd <= parsed.verseEnd!,
          )
    const covered = new Set(
      verses.flatMap((verse) =>
        Array.from(
          { length: verse.verseEnd - verse.verseStart + 1 },
          (_, i) => verse.verseStart + i,
        ),
      ),
    )
    if (
      !verses.length ||
      (parsed.verseStart !== null && covered.size !== parsed.verseEnd! - parsed.verseStart + 1)
    )
      throw new Error(
        '해당 장·절 범위를 찾지 못했습니다. 원본에서 여러 절을 묶은 구절은 전체 범위로 검색해주세요.',
      )
    return verses
  },
}
