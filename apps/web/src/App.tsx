import { ENGINE_VERSION } from '@smartstack/engine'

// Placeholder until the web-app milestone. Proves the workspace wiring
// (React 19 + Vite + engine import) end to end.
export function App() {
  return (
    <main style={{ fontFamily: 'system-ui, sans-serif', padding: 16 }}>
      <h1>SmartStack</h1>
      <p>Scaffold OK. Engine {ENGINE_VERSION}.</p>
    </main>
  )
}
