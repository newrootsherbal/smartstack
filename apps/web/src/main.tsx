import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { BrowserRouter } from 'react-router'
import { registerSW } from 'virtual:pwa-register'
import { App } from './App'
import { AppStateProvider } from './state/AppStateProvider'
import './styles/global.css'

if ('serviceWorker' in navigator) {
  // autoUpdate: a new deploy takes over on the next open (skipWaiting + clientsClaim).
  registerSW({ immediate: true })
}

const container = document.getElementById('root')
if (!container) throw new Error('#root not found')

createRoot(container).render(
  <StrictMode>
    <BrowserRouter>
      <AppStateProvider>
        <App />
      </AppStateProvider>
    </BrowserRouter>
  </StrictMode>,
)
