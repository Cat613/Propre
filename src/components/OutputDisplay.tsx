import { useEffect, useState, useRef } from 'react'
import type { OutputState } from '../types'
import CompositeFrame from './CompositeFrame'
const empty: OutputState = {
  type: 'state-update',
  layers: {
    audio: null,
    background: { type: 'none' },
    slide: null,
    announcement: null,
    props: [],
    message: null,
  },
}
export default function OutputDisplay() {
  const [state, setState] = useState(empty),
    version = useRef(0)
  useEffect(() => {
    const stop = window.ipcRenderer.on('update-screen', (json: string) => {
      try {
        const data = JSON.parse(json) as OutputState & { version: number }
        if (data.version <= version.current) return
        version.current = data.version
        setState(data)
      } catch {
        window.ipcRenderer.reportMediaError()
      }
    })
    window.ipcRenderer.ready()
    return stop
  }, [])
  useEffect(() => {
    if (version.current) window.ipcRenderer.acknowledge(version.current)
  }, [state])
  return (
    <div className="h-screen w-screen bg-black" data-screen="main">
      <CompositeFrame state={state} />
    </div>
  )
}
