// Service worker for the installable web version.
// - The page itself is always revalidated with the server (a stale index.html pointed at script
//   files a newer deploy had removed, which left a blank page), and error responses are never cached.
// - Built files carry a hash in their name and never change, so they come from the cache first.
// - Everything the game needs is fetched at install, so a home-screen copy plays offline from day one.
const CACHE = 'durak-v3'
const PRECACHE = ["./assets/onest-cyrillic-400-normal-BTdD9fLi.woff2","./assets/onest-cyrillic-500-normal-CJRUgmys.woff2","./assets/onest-latin-400-normal-9AYXx_QC.woff2","./assets/onest-latin-500-normal-2-RsuwM3.woff2","./assets/onest-cyrillic-600-normal-BZYKVyuq.woff2","./assets/onest-latin-600-normal-DM19Lk_j.woff2","./assets/onest-cyrillic-700-normal-3rOSeAdn.woff2","./assets/onest-latin-700-normal-DMkYZIUB.woff2","./assets/unbounded-cyrillic-600-normal-DW6uzIMB.woff2","./assets/unbounded-latin-600-normal-oRSANpZr.woff2","./assets/unbounded-cyrillic-800-normal--HlTIRd4.woff2","./assets/unbounded-latin-800-normal-CN2Hxyoo.woff2","./assets/card-slide-2-CkJTeMCJ.mp3","./assets/card-slide-3-CaQA0Okf.mp3","./assets/card-slide-4-C26CpkOs.mp3","./assets/card-slide-5-Blst3cox.mp3","./assets/card-slide-1-Bw-TBfyV.mp3","./assets/card-slide-6-rd3sdzHj.mp3","./assets/card-place-1-2_zVc64J.mp3","./assets/card-place-2-BI6PHmfW.mp3","./assets/card-place-3-BN1gOl8c.mp3","./assets/card-shove-1-Cjmc6q03.mp3","./assets/card-place-4-BA3p73SJ.mp3","./assets/card-shove-2-DisHVJcN.mp3","./assets/card-shove-3-D9F0t5rW.mp3","./assets/card-shove-4-2FHsopX2.mp3","./assets/index-D8bM_ReP.css","./assets/motion-CjTsdLcd.js","./assets/react-XjUVasKe.js","./assets/index-DqV15kf0.js","./assets/bundler-Dd3e74l-.js","./assets/web-ClC2vgQY.js","./assets/web-CQPzcbCb.js","./assets/web-BSh77tii.js","./assets/durak_engine-BtPsBUrG.wasm","./assets/botWorker-DQjbxH8J.js"]

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
