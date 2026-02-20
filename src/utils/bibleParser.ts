
// Bible Book Mapping
// You can expand this list as needed.
const BOOK_MAPPING: Record<string, string> = {
    // Old Testament (구약)
    '창': 'Gen', '창세기': 'Gen',
    '출': 'Exo', '출애굽기': 'Exo',
    '레': 'Lev', '레위기': 'Lev',
    '민': 'Num', '민수기': 'Num',
    '신': 'Deu', '신명기': 'Deu',
    '수': 'Jos', '여호수아': 'Jos',
    '삿': 'Jdg', '사사기': 'Jdg',
    '룻': 'Rut', '룻기': 'Rut',
    '삼상': '1Sa', '사무엘상': '1Sa',
    '삼하': '2Sa', '사무엘하': '2Sa',
    '왕상': '1Ki', '열왕기상': '1Ki',
    '왕하': '2Ki', '열왕기하': '2Ki',
    '대상': '1Ch', '역대상': '1Ch',
    '대하': '2Ch', '역대하': '2Ch',
    '스': 'Ezr', '에스라': 'Ezr',
    '느': 'Neh', '느헤미야': 'Neh',
    '에': 'Est', '에스더': 'Est',
    '욥': 'Job', '욥기': 'Job',
    '시': 'Psa', '시편': 'Psa',
    '잠': 'Pro', '잠언': 'Pro',
    '전': 'Ecc', '전도서': 'Ecc',
    '아': 'Son', '아가': 'Son',
    '사': 'Isa', '이사야': 'Isa',
    '렘': 'Jer', '예레미야': 'Jer',
    '애': 'Lam', '예레미야애가': 'Lam',
    '겔': 'Eze', '에스겔': 'Eze',
    '단': 'Dan', '다니엘': 'Dan',
    '호': 'Hos', '호세아': 'Hos',
    '욜': 'Joe', '요엘': 'Joe',
    '암': 'Amo', '아모스': 'Amo',
    '옵': 'Oba', '오바댜': 'Oba',
    '욘': 'Jon', '요나': 'Jon',
    '미': 'Mic', '미가': 'Mic',
    '나': 'Nah', '나훔': 'Nah',
    '합': 'Hab', '하박국': 'Hab',
    '습': 'Zep', '스바냐': 'Zep',
    '학': 'Hag', '학개': 'Hag',
    '슥': 'Zec', '스가랴': 'Zec',
    '말': 'Mal', '말라기': 'Mal',

    // New Testament (신약)
    '마': 'Mat', '마태복음': 'Mat',
    '막': 'Mar', '마가복음': 'Mar',
    '누': 'Luk', '누가복음': 'Luk',
    '요': 'John', '요한복음': 'John',
    '행': 'Act', '사도행전': 'Act',
    '롬': 'Rom', '로마서': 'Rom',
    '고전': '1Co', '고린도전서': '1Co',
    '고후': '2Co', '고린도후서': '2Co',
    '갈': 'Gal', '갈라디아서': 'Gal',
    '엡': 'Eph', '에베소서': 'Eph',
    '빌': 'Phi', '빌립보서': 'Phi',
    '골': 'Col', '골로새서': 'Col',
    '살전': '1Th', '데살로니가전서': '1Th',
    '살후': '2Th', '데살로니가후서': '2Th',
    '딤전': '1Ti', '디모데전서': '1Ti',
    '딤후': '2Ti', '디모데후서': '2Ti',
    '딛': 'Tit', '디도서': 'Tit',
    '몬': 'Phm', '빌레몬서': 'Phm',
    '히': 'Heb', '히브리서': 'Heb',
    '약': 'Jam', '야고보서': 'Jam',
    '벧전': '1Pe', '베드로전서': '1Pe',
    '벧후': '2Pe', '베드로후서': '2Pe',
    '요1': '1Jo', '요한일서': '1Jo',
    '요2': '2Jo', '요한이서': '2Jo',
    '요3': '3Jo', '요한삼서': '3Jo',
    '유': 'Jud', '유다서': 'Jud',
    '계': 'Rev', '요한계시록': 'Rev',
}

interface ParsedBibleQuery {
    bookId: string | null
    chapter: number | null
    verseStart: number | null
    verseEnd: number | null
    originalQuery: string
}

export const parseBibleQuery = (query: string): ParsedBibleQuery => {
    const trimmed = query.trim()

    // Regex: [BookName] [Chapter][:VerseStart][-VerseEnd]
    // Supports: 요 3:16, 요3:16-18, 요한복음 3 16, 창1
    // Group 1: Book Name (Hangul)
    // Group 2: Chapter (Digits)
    // Group 3: Verse Start (Digits, Optional)
    // Group 4: Verse End (Digits, Optional)

    const regex = /^([가-힣a-zA-Z0-9]+)\s*([0-9]+)(?:[:\s]([0-9]+)(?:[-~]([0-9]+))?)?$/
    const match = trimmed.match(regex)

    if (!match) {
        return { bookId: null, chapter: null, verseStart: null, verseEnd: null, originalQuery: query }
    }

    const bookRaw = match[1]
    const chapterRaw = match[2]
    const verseStartRaw = match[3]
    const verseEndRaw = match[4]

    // Resolve Book ID
    const bookId = BOOK_MAPPING[bookRaw] || null
    const chapter = parseInt(chapterRaw, 10)
    const verseStart = verseStartRaw ? parseInt(verseStartRaw, 10) : null
    const verseEnd = verseEndRaw ? parseInt(verseEndRaw, 10) : verseStart // Default to start if no end

    return {
        bookId,
        chapter,
        verseStart,
        verseEnd,
        originalQuery: query
    }
}
