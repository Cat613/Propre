// Slide styles interface
export interface SlideStyles {
    fontSize?: string
    color?: string
    backgroundColor?: string
    fontWeight?: string
    textAlign?: 'left' | 'center' | 'right'
    fontFamily?: string
}

// Slide type union
export type SlideType = 'text' | 'image' | 'video' | 'bible'

// Slide label options
export type SlideLabel = 'None' | 'Intro' | 'Verse 1' | 'Verse 2' | 'Verse 3' | 'Chorus' | 'Bridge' | 'Ending'

// Label color mapping
export const LABEL_COLORS: Record<SlideLabel, string> = {
    'None': 'transparent',
    'Intro': '#8B5CF6',    // Purple
    'Verse 1': '#3B82F6',  // Blue
    'Verse 2': '#06B6D4',  // Cyan
    'Verse 3': '#14B8A6',  // Teal
    'Chorus': '#EF4444',   // Red
    'Bridge': '#22C55E',   // Green
    'Ending': '#F59E0B',   // Amber
}

// Main Slide interface
export interface Slide {
    id: string
    content: string
    type: SlideType
    styles?: SlideStyles
    backgroundUrl?: string
    label?: SlideLabel
    labelColor?: string
    bibleReference?: string // e.g., "Gen 1:1"
}

// Bible Global Style Interface
export interface BibleStyle {
    fontSize: number
    fontColor: string
    bgColor: string
    align: 'left' | 'center' | 'right'
    verticalAlign: 'top' | 'center' | 'bottom'
}

// Presentation interface
export interface Presentation {
    id: string
    title: string
    slides: Slide[]
    createdAt: string // ISO date string
    updatedAt: string // ISO date string
}

// Playlist Item interface (wrapper for presentation in playlist)
export interface PlaylistItem {
    id: string // Unix ID for playlist item
    presentationId: string
    presentation: Presentation
}

// Media Item interface for Media Bin
export interface MediaItem {
    id: string
    type: 'image' | 'video'
    url: string
    thumbnail?: string
    name: string
}

// Active Background interface for Layer 1
export interface ActiveBackground {
    type: 'image' | 'video' | 'none'
    url?: string
}

// Output State Interface (Passed via IPC)
export interface OutputState {
    type: 'state-update'
    slide: Slide | null
    background: ActiveBackground
    bibleStyle?: BibleStyle // New field for global bible style
}

// Stage Display Data
export interface StageData {
    current: Slide | null
    next: Slide | null
}
