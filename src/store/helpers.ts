import { StoreState } from './types'

export const syncOutputState = (get: () => StoreState) => {
    const state = get()
    const activeSlide = state.activeSlideId
        ? state.slides.find(s => s.id === state.activeSlideId)
        : null

    const outputData = {
        type: 'state-update',
        slide: activeSlide || null,
        background: state.activeBackground,
        globalSlideStyle: state.globalSlideStyle,
        isGreenScreen: state.isGreenScreen
    }

    window.ipcRenderer.send('update-output', JSON.stringify(outputData))
}
