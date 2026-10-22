import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
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
