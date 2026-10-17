import { create } from 'zustand'
import type { MusicItem, MusicBridgeState } from '../../shared/music'
export const useMusicState = create<{
  prepared: { item: MusicItem; setlistId: string } | null
  activeExternal: MusicItem | null
  undoPin: MusicItem | null
  bridge: MusicBridgeState
  phase: 'stopped' | 'starting' | 'playing' | 'paused' | 'error'
  position: number
  duration: number
  message: string
  busy: boolean
  preparationRequest: number
  request: number
  fadeRequest: number
  restartRequest: number
}>(() => ({
  prepared: null,
  activeExternal: null,
  undoPin: null,
  bridge: {
    connected: false,
    stale: false,
    playing: null,
    title: '',
    videoId: '',
    listId: '',
    bindingId: '',
  },
  phase: 'stopped',
  position: 0,
  duration: 0,
  message: '',
  busy: false,
  preparationRequest: 0,
  request: 0,
  fadeRequest: 0,
  restartRequest: 0,
}))

export function setMusicBridge(bridge: MusicBridgeState, phase?: 'playing' | 'paused') {
  if ((bridge.sequence ?? 0) < (useMusicState.getState().bridge.sequence ?? 0)) return false
  useMusicState.setState({ bridge, ...(phase ? { phase } : {}) })
  return true
}
