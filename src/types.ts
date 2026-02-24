export interface SlideStyles {
    fontSize?: string
    color?: string
    backgroundColor?: string
    backgroundDim?: number // Opacity for black overlay (0 to 1)
    fontWeight?: string
    textAlign?: 'left' | 'center' | 'right'
    fontFamily?: string
    textShadow?: boolean // Add drop shadow
    textOutline?: boolean // Add stroke outline
    useCustomStyle?: boolean // Explicitly opt-in to local text style overrides
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

// --- Phase 3: Element-Based Slide Canvas ---

export type SlideElementType = 'text' | 'image' | 'video' | 'shape'

export interface SlideElement {
    id: string
    type: SlideElementType
    x: number      // Percentage (0-100) or pixels, relative to canvas width
    y: number      // Percentage (0-100) or pixels, relative to canvas height
    width: number  // Percentage or pixels
    height: number // Percentage or pixels
    zIndex: number
    opacity?: number
    rotation?: number // Degrees
}

export interface TextElement extends SlideElement {
    type: 'text'
    text: string
    styles: SlideStyles
}

export interface MediaElement extends SlideElement {
    type: 'image' | 'video'
    url: string
    objectFit?: 'contain' | 'cover' | 'fill'
}

export interface ShapeElement extends SlideElement {
    type: 'shape'
    shapeType: 'rectangle' | 'ellipse' | 'line'
    backgroundColor?: string
    borderColor?: string
    borderWidth?: number
}

// Ensure type safety when accessing specific element properties
export type CanvasElement = TextElement | MediaElement | ShapeElement

// Main Slide interface (Updated for Phase 3)
export interface Slide {
    id: string
    type: SlideType
    label?: SlideLabel
    labelColor?: string
    bibleReference?: string // e.g., "Gen 1:1"

    // --- Legacy / Backward Compatibility ---
    // These properties might be present in older .ppros files
    content?: string
    styles?: SlideStyles
    backgroundUrl?: string

    // --- Phase 3 Architecture ---
    // The new source of truth for slide content
    elements?: CanvasElement[]
    canvasWidth?: number  // Virtual canvas width (e.g., 1920)
    canvasHeight?: number // Virtual canvas height (e.g., 1080)
}

// Global Slide Style Interface for regular standard slides
export interface GlobalSlideStyle {
    fontSize: number
    fontColor: string
    fontFamily: string
    align: 'left' | 'center' | 'right'
    verticalAlign: 'top' | 'center' | 'bottom'
    backgroundDim?: number // Global opacity for black overlay (0 to 1)
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

export interface ActiveBackground {
    type: 'image' | 'video' | 'none'
    url?: string
}

// Layer System Types
export type LayerType = 'audio' | 'background' | 'slide' | 'announcement' | 'prop' | 'message'

export interface AudioItem {
    id: string
    url: string
    name: string
    volume?: number
    loop?: boolean
}

export interface PropItem {
    id: string
    type: 'logo' | 'clock' | 'timer' | 'text'
    content?: string // For text/timer
    url?: string     // For logo
    position: 'top-left' | 'top-right' | 'bottom-left' | 'bottom-right' | 'center'
}

export interface MessageItem {
    id: string
    content: string
    isScrolling: boolean
    speed?: number
}

// The comprehensive state of all independent layers
export interface LayerState {
    audio: AudioItem | null
    background: ActiveBackground // Maintains 'none' type instead of null for backward compatibility
    slide: Slide | null
    announcement: Slide | null
    prop: PropItem | null
    message: MessageItem | null
}

// ------ Phase 2: Multi-Screen Routing & Looks ------

export interface LookLayerOverride {
    isVisible: boolean
    // Future expansion: style overrides etc.
}

// A specific configuration for a single output screen
export interface ScreenLook {
    audio: LookLayerOverride
    background: LookLayerOverride
    slide: LookLayerOverride
    announcement: LookLayerOverride
    prop: LookLayerOverride
    message: LookLayerOverride
}

// Dictionary mapping screen IDs (e.g., 'main', 'chroma') to their configured looks
export type LooksState = Record<string, ScreenLook>

export const DEFAULT_SCREEN_LOOK: ScreenLook = {
    audio: { isVisible: true },
    background: { isVisible: true },
    slide: { isVisible: true },
    announcement: { isVisible: true },
    prop: { isVisible: true },
    message: { isVisible: true },
}

// ---------------------------------------------------

// Output State Interface (Passed via IPC)
export interface OutputState {
    type: 'state-update'
    layers: LayerState
    globalSlideStyle?: GlobalSlideStyle // New field for standard slide global style
    isGreenScreen?: boolean
}

// Stage Display Data
export interface StageData {
    current: Slide | null
    next: Slide | null
}
