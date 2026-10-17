// Standard Short Korean Names used in the JSON (e.g., 창, 출, 마)
export const BOOK_MAPPING: Record<string, string> = {
  // Old Testament (구약)
  창: '창',
  창세기: '창',
  출: '출',
  출애굽기: '출',
  레: '레',
  레위기: '레',
  민: '민',
  민수기: '민',
  신: '신',
  신명기: '신',
  수: '수',
  여호수아: '수',
  삿: '삿',
  사사기: '삿',
  룻: '룻',
  룻기: '룻',
  삼상: '삼상',
  사무엘상: '삼상',
  삼하: '삼하',
  사무엘하: '삼하',
  왕상: '왕상',
  열왕기상: '왕상',
  왕하: '왕하',
  열왕기하: '왕하',
  대상: '대상',
  역대상: '대상',
  대하: '대하',
  역대하: '대하',
  스: '스',
  에스라: '스',
  느: '느',
  느헤미야: '느',
  에: '에',
  에스더: '에',
  욥: '욥',
  욥기: '욥',
  시: '시',
  시편: '시',
  잠: '잠',
  잠언: '잠',
  전: '전',
  전도서: '전',
  아: '아',
  아가: '아',
  사: '사',
  이사야: '사',
  렘: '렘',
  예레미야: '렘',
  애: '애',
  예레미야애가: '애',
  겔: '겔',
  에스겔: '겔',
  단: '단',
  다니엘: '단',
  호: '호',
  호세아: '호',
  욜: '욜',
  요엘: '욜',
  암: '암',
  아모스: '암',
  옵: '옵',
  오바댜: '옵',
  욘: '욘',
  요나: '욘',
  미: '미',
  미가: '미',
  나: '나',
  나훔: '나',
  합: '합',
  하박국: '합',
  습: '습',
  스바냐: '습',
  학: '학',
  학개: '학',
  슥: '슥',
  스가랴: '슥',
  말: '말',
  말라기: '말',

  // New Testament (신약)
  마: '마',
  마태복음: '마',
  막: '막',
  마가복음: '막',
  누: '눅',
  눅: '눅',
  누가복음: '눅',
  요: '요',
  요한복음: '요',
  행: '행',
  사도행전: '행',
  롬: '롬',
  로마서: '롬',
  고전: '고전',
  고린도전서: '고전',
  고후: '고후',
  고린도후서: '고후',
  갈: '갈',
  갈라디아서: '갈',
  엡: '엡',
  에베소서: '엡',
  빌: '빌',
  빌립보서: '빌',
  골: '골',
  골로새서: '골',
  살전: '살전',
  데살로니가전서: '살전',
  살후: '살후',
  데살로니가후서: '살후',
  딤전: '딤전',
  디모데전서: '딤전',
  딤후: '딤후',
  디모데후서: '딤후',
  딛: '딛',
  디도서: '딛',
  몬: '몬',
  빌레몬서: '몬',
  히: '히',
  히브리서: '히',
  약: '약',
  야고보서: '약',
  벧전: '벧전',
  베드로전서: '벧전',
  벧후: '벧후',
  베드로후서: '벧후',
  요1: '요일',
  요일: '요일',
  요한일서: '요일',
  요2: '요이',
  요이: '요이',
  요한이서: '요이',
  요3: '요삼',
  요삼: '요삼',
  요한삼서: '요삼',
  유: '유',
  유다서: '유',
  계: '계',
  요한계시록: '계',
}

interface ParsedBibleQuery {
  bookId: string | null // e.g., '창', '요'
  chapter: number | null
  verseStart: number | null
  verseEnd: number | null
  originalQuery: string
}

export const parseBibleQuery = (query: string): ParsedBibleQuery => {
  const trimmed = query.trim()

  const invalid = {
    bookId: null,
    chapter: null,
    verseStart: null,
    verseEnd: null,
    originalQuery: query,
  }
  const name = Object.keys(BOOK_MAPPING)
    .sort((a, b) => b.length - a.length)
    .find(
      (book) =>
        trimmed.startsWith(book) &&
        (/\d$/.test(book) ? /^\s+\d/ : /^\s*\d/).test(trimmed.slice(book.length)),
    )
  if (!name) return invalid
  const match = trimmed
    .slice(name.length)
    .trim()
    .match(/^(\d+)(?:[:\s]+(\d+)(?:[-~](\d+))?)?$/)
  if (!match) return invalid
  const chapter = Number(match[1]),
    verseStart = match[2] ? Number(match[2]) : null,
    verseEnd = match[3] ? Number(match[3]) : verseStart
  if (
    chapter < 1 ||
    chapter > 150 ||
    (verseStart !== null && verseStart < 1) ||
    (verseEnd !== null && (verseEnd < verseStart! || verseEnd > 200))
  )
    return invalid
  return { bookId: BOOK_MAPPING[name], chapter, verseStart, verseEnd, originalQuery: query }
}
