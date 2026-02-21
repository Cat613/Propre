import bibleDataRaw from '../assets/bible/개역개정.json'

// Cast the imported raw JSON as Record<string, string>
const BIBLE_DATA = bibleDataRaw as Record<string, string>

export interface BibleVerse {
    reference: string
    content: string
}

export const BibleService = {
    getVerses: async (bookId: string, chapter: number): Promise<BibleVerse[]> => {
        // Since we import the JSON locally, the query is instant and synchronous.
        // We still return a Promise to keep the existing API shape uniform,
        // though we could change it to synchronous later if needed.

        const prefix = `${bookId}${chapter}:` // e.g., "창1:"
        const verses: BibleVerse[] = []

        // Extract matching verses from the flat JSON map
        // Since objects don't guarantee strict numerical key sorting perfectly across all JS engines 
        // down to integer-like strings, we collect them, then optionally sort to be safe.
        for (const [key, content] of Object.entries(BIBLE_DATA)) {
            if (key.startsWith(prefix)) {
                verses.push({
                    reference: `${bookId} ${chapter}:${key.split(':')[1]}`,
                    content: content.trim()
                })
            }
        }

        // Sort by verse number (e.g., 1, 2, ..., 10) rather than lexicographical
        verses.sort((a, b) => {
            const verseA = parseInt(a.reference.split(':')[1], 10)
            const verseB = parseInt(b.reference.split(':')[1], 10)
            return verseA - verseB
        })

        return verses
    }
}
