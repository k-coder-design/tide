import { createHash } from 'node:crypto'
import { readFileSync, readdirSync } from 'node:fs'
import { join, relative } from 'node:path'
import { fileURLToPath } from 'node:url'
import react from '@vitejs/plugin-react'
import { defineConfig, type Plugin } from 'vite'

const publicDir = fileURLToPath(new URL('./public', import.meta.url))

/**
 * Tide — a Home Screen web app for iPhone, the same approach as Recallo: Mobile (static files, no server).
 * The database is SQLite WebAssembly in a Worker, stored encrypted (docs/DATA_MODEL.md).
 */
export default defineConfig({
  // Relative paths: the app may live in a subfolder (for example, GitHub Pages).
  base: './',
  plugins: [react(), offlineWorker()],
  // The SQLite package finds sqlite3.wasm next to itself; Vite pre-bundling breaks that.
  optimizeDeps: { exclude: ['@sqlite.org/sqlite-wasm'] },
  worker: { format: 'es' },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    target: 'safari17'
  }
})

/**
 * Offline mode: at build time writes sw.js with the list of all app files (as in Recallo: Mobile).
 * The service worker saves them on the phone at install and serves them from the cache; the start page
 * comes fresh from the network when online. Each build has its own cache (by a hash of all file contents).
 * Only the app's own files are involved — the service worker never sees journal data.
 */
function offlineWorker(): Plugin {
  return {
    name: 'tide-offline-worker',
    apply: 'build',
    generateBundle(_options, bundle) {
      const hash = createHash('sha256')
      const files = ['./']
      for (const [name, output] of Object.entries(bundle).sort(([a], [b]) => a.localeCompare(b))) {
        files.push(`./${name}`)
        hash.update(name).update(output.type === 'chunk' ? output.code : output.source)
      }
      for (const file of listFiles(publicDir).sort()) {
        const name = relative(publicDir, file).split('\\').join('/')
        files.push(`./${name}`)
        hash.update(name).update(readFileSync(file))
      }
      const version = hash.digest('hex').slice(0, 12)
      this.emitFile({ type: 'asset', fileName: 'sw.js', source: serviceWorker(version, files) })
    }
  }
}

function listFiles(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) =>
    entry.isDirectory() ? listFiles(join(dir, entry.name)) : entry.name.startsWith('.') ? [] : [join(dir, entry.name)]
  )
}

function serviceWorker(version: string, files: string[]): string {
  return `// Tide — offline mode. Generated at build time (vite.config.ts), do not edit by hand.
const CACHE = 'tide-${version}'
const FILES = ${JSON.stringify(files, null, 2)}

// The start page: fresh from the network when online (it names this build's program files),
// the saved copy only offline or when the network is too slow.
const START_TIMEOUT_MS = 4000

self.addEventListener('install', (event) => {
  // Fresh copies from the server, never from the browser's HTTP cache: a stale start page would point
  // to program files of an older build that no longer exist.
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => cache.addAll(FILES.map((url) => new Request(url, { cache: 'reload' }))))
      .then(() => self.skipWaiting())
  )
})

// Old versions are removed once the new one becomes active.
self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key.startsWith('tide-') && key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim())
  )
})

const savedStartPage = () => caches.match('./', { ignoreVary: true })

function freshStartPage(request) {
  const network = fetch(request.url, { cache: 'no-store', credentials: 'same-origin' }).then((response) => {
    if (response.ok) {
      const copy = response.clone()
      caches.open(CACHE).then((cache) => cache.put('./', copy))
    }
    return response
  })
  const slow = new Promise((resolve) => setTimeout(resolve, START_TIMEOUT_MS)).then(savedStartPage)
  return Promise.race([network, slow])
    .then((response) => response || network)
    .catch(() => savedStartPage().then((hit) => hit || Response.error()))
}

self.addEventListener('fetch', (event) => {
  const request = event.request
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(freshStartPage(request))
    return
  }
  event.respondWith(caches.match(request, { ignoreSearch: true, ignoreVary: true }).then((hit) => hit || fetch(request)))
})
`
}
