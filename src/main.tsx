import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { App } from './ui/App'
import { markStandalone } from './viewport'
import './ui/styles.css'

markStandalone()

const root = document.getElementById('root')
if (!root) throw new Error('No #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
