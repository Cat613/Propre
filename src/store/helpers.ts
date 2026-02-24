import { StoreState } from './types'

export const syncOutputState = (get: () => StoreState) => {
    const state = get()
    const activeSlide = state.activeSlideId
        ? state.slides.find(s => s.id === state.activeSlideId)
        : null

    const baseLayers = {
        audio: state.activeAudio,
        background: state.activeBackground,
        slide: activeSlide || null,
        announcement: null, // To be implemented
        prop: state.activeProp,
        message: state.activeMessage
    }

    // 1. Dispatch individual targeted payloads per screen
    Object.entries(state.screenLooks).forEach(([screenId, originalLook]) => {
        // --- Single Output Window Logic (Main switches to Chroma look when toggled) ---
        // If we are evaluating what to send to the 'main' window, and Green Screen is ON,
        // we override its look with the 'chroma' look configuration.
        const look = (screenId === 'main' && state.isGreenScreen && state.screenLooks['chroma'])
            ? state.screenLooks['chroma']
            : originalLook

        const tailoredLayers = {
            audio: look.audio.isVisible ? baseLayers.audio : null,
            background: look.background.isVisible ? baseLayers.background : { type: 'none' },
            slide: look.slide.isVisible ? baseLayers.slide : null,
            announcement: look.announcement.isVisible ? baseLayers.announcement : null,
            prop: look.prop.isVisible ? baseLayers.prop : null,
            message: look.message.isVisible ? baseLayers.message : null
        }

        const screenData = {
            type: 'state-update',
            layers: tailoredLayers,
            globalSlideStyle: state.globalSlideStyle,
            isGreenScreen: state.isGreenScreen // Legacy
        }

        // Target the specific window's IPC channel via the main process router
        window.ipcRenderer.send('route-screen-update', JSON.stringify({
            screenId,
            data: screenData
        }))
    })

    // 2. Fallback legacy broadcast (for simple transitions before full migration)
    const legacyData = {
        type: 'state-update',
        layers: baseLayers,
        globalSlideStyle: state.globalSlideStyle,
        isGreenScreen: state.isGreenScreen
    }
    window.ipcRenderer.send('update-output', JSON.stringify(legacyData))
}
