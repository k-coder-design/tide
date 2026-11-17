import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import { keepStorage, startOffline } from './offline'
import { App } from './ui/App'
import { markStandalone } from './viewport'
import './ui/styles.css'

markStandalone()
startOffline()
keepStorage()

const root = document.getElementById('root')
if (!root) throw new Error('No #root element')

createRoot(root).render(
  <StrictMode>
    <App />
  </StrictMode>
)
