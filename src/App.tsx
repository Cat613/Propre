import { useEffect, useState } from 'react'
import ControlPanel from './components/ControlPanel'
import OutputDisplay from './components/OutputDisplay'
import StageDisplay from './components/StageDisplay'
import ToastContainer from './components/ToastContainer'

function App() {
    const [currentHash, setCurrentHash] = useState(window.location.hash)

    useEffect(() => {
        // Initial check
        setCurrentHash(window.location.hash)

        const handleHashChange = () => {
            setCurrentHash(window.location.hash)
        }

        window.addEventListener('hashchange', handleHashChange)
        return () => window.removeEventListener('hashchange', handleHashChange)
    }, [])

    // Routing
    if (currentHash.startsWith('#output-display')) {
        return <OutputDisplay />
    }

    if (currentHash.startsWith('#stage-display')) {
        return <StageDisplay />
    }

    // Default to Control Panel
    return (
        <>
            <ControlPanel />
            <ToastContainer />
        </>
    )
}

export default App
