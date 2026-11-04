// Network-first service worker: always try for fresh files, fall back to the cache offline.
// v2: the page itself is always revalidated with the server (a stale index.html pointed at
// script files a newer deploy had removed, which left a blank page), and error responses
// are never cached.
const CACHE = 'durak-v2'

self.addEventListener('install', () => self.skipWaiting())
self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  ),
)

self.addEventListener('fetch', (event) => {
  const { request } = event
  if (request.method !== 'GET' || new URL(request.url).origin !== self.location.origin) return
  const page = request.mode === 'navigate'
  event.respondWith(
    (page ? fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' }) : fetch(request))
      .then((response) => {
        if (response.ok) {
          const copy = response.clone()
          caches.open(CACHE).then((cache) => cache.put(request, copy))
        }
        return response
      })
      .catch(() => caches.match(request).then((hit) => hit || caches.match('./'))),
  )
})
