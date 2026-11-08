// Service worker for the installable web version.
// - The page itself is always revalidated with the server (a stale index.html pointed at script
//   files a newer deploy had removed, which left a blank page), and error responses are never cached.
// - Built files carry a hash in their name and never change, so they come from the cache first.
// - Everything the game needs is fetched at install, so a home-screen copy plays offline from day one.
const CACHE = 'durak-v3'
const PRECACHE = __PRECACHE__

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches
      .open(CACHE)
      .then((cache) => Promise.all(['./', ...PRECACHE].map((url) => cache.add(url).catch(() => {}))))
      .then(() => self.skipWaiting()),
  )
})

self.addEventListener('activate', (event) =>
  event.waitUntil(
    caches
      .keys()
      .then((keys) => Promise.all(keys.filter((key) => key !== CACHE).map((key) => caches.delete(key))))
      .then(() => self.clients.claim()),
  ),
)

const store = (request, response) => {
  if (response.ok) {
    const copy = response.clone()
    caches.open(CACHE).then((cache) => cache.put(request, copy))
  }
  return response
}

self.addEventListener('fetch', (event) => {
  const { request } = event
  const url = new URL(request.url)
  if (request.method !== 'GET' || url.origin !== self.location.origin) return
  if (request.mode === 'navigate') {
    event.respondWith(
      fetch(request.url, { cache: 'no-cache', credentials: 'same-origin' })
        .then((response) => store(request, response))
        .catch(() => caches.match(request).then((hit) => hit || caches.match('./'))),
    )
    return
  }
  if (url.pathname.includes('/assets/')) {
    event.respondWith(caches.match(request).then((hit) => hit || fetch(request).then((response) => store(request, response))))
    return
  }
  event.respondWith(
    fetch(request)
      .then((response) => store(request, response))
      .catch(() => caches.match(request)),
  )
})
