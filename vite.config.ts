import react from '@vitejs/plugin-react'
import { defineConfig } from 'vite'

/**
 * Tide — a Home Screen web app for iPhone, the same approach as Recallo: Mobile (static files, no server).
 * Offline mode (service worker) and the SQLite WebAssembly database come in phase 2.
 */
export default defineConfig({
  // Relative paths: the app may live in a subfolder (for example, GitHub Pages).
  base: './',
  plugins: [react()],
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'safari17'
  }
})
