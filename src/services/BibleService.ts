export interface BibleBook {
    id: string
    name: string
    chapters: number
}

export interface BibleVerse {
    reference: string
    content: string
}

// Mock Data
const BOOKS: BibleBook[] = [
    { id: 'Gen', name: '창세기', chapters: 50 },
    { id: 'Psa', name: '시편', chapters: 150 },
    { id: 'John', name: '요한복음', chapters: 21 },
    { id: 'Rom', name: '로마서', chapters: 16 },
]

export const BibleService = {
    getBooks: async (): Promise<BibleBook[]> => {
        // Simulate async delay
        return new Promise((resolve) => {
            setTimeout(() => resolve(BOOKS), 100)
        })
    },

    getVerses: async (bookId: string, chapter: number): Promise<BibleVerse[]> => {
        return new Promise((resolve) => {
            setTimeout(() => {
                const verses: BibleVerse[] = []

                // Simple mock logic
                if (bookId === 'Gen' && chapter === 1) {
                    verses.push({ reference: '창 1:1', content: '태초에 하나님이 천지를 창조하시니라' })
                    verses.push({ reference: '창 1:2', content: '땅이 혼돈하고 공허하며 흑암이 깊음 위에 있고 하나님의 영은 수면 위에 운행하시니라' })
                    verses.push({ reference: '창 1:3', content: '하나님이 이르시되 빛이 있으라 하시니 빛이 있었고' })
                } else if (bookId === 'Psa' && chapter === 23) {
                    verses.push({ reference: '시 23:1', content: '여호와는 나의 목자시니 내게 부족함이 없으리로다' })
                    verses.push({ reference: '시 23:2', content: '그가 나를 푸른 풀밭에 누이시며 쉴 만한 물 가로 인도하시는도다' })
                    verses.push({ reference: '시 23:3', content: '내 영혼을 소생시키시고 자기 이름을 위하여 의의 길로 인도하시는도다' })
                } else if (bookId === 'John' && chapter === 3) {
                    verses.push({ reference: '요 3:16', content: '하나님이 세상을 이처럼 사랑하사 독생자를 주셨으니 이는 그를 믿는 자마다 멸망하지 않고 영생을 얻게 하려 하심이라' })
                } else {
                    // Generic Fillers
                    for (let i = 1; i <= 5; i++) {
                        verses.push({ reference: `${bookId} ${chapter}:${i}`, content: `테스트 말씀 내용입니다. ${bookId} ${chapter}장 ${i}절의 말씀.` })
                    }
                }

                resolve(verses)
            }, 200)
        })
    }
}
