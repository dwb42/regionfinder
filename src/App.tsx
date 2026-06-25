import { lazy, Suspense } from 'react'
import './App.css'

const ApiApp = lazy(() => import('./ApiApp'))
const LegacyApp = lazy(() => import('./legacy/LegacyApp'))

function App() {
  const dataMode = import.meta.env.VITE_REGIONFINDER_DATA_MODE ?? 'api'
  const AppComponent = dataMode === 'legacy' ? LegacyApp : ApiApp

  return (
    <Suspense fallback={<main className="api-shell loading-shell">Regionfinder wird geladen...</main>}>
      <AppComponent />
    </Suspense>
  )
}

export default App
