import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import '@fontsource/teko/500.css'
import '@fontsource/teko/600.css'
import './themes.css'
import './index.css'
import App from './App.tsx'
import { applyTheme } from './ui/theme'

applyTheme()

createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
