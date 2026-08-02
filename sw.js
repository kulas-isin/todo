/* 打勾勾 Pinky — Service Worker
   應用外殼採快取優先（背景更新），導覽請求採網路優先（離線時回落到快取）。
   改動任何被預先快取的檔案時，請把 VERSION 加一。 */

const VERSION = 'pinky-v6';
const ASSETS = [
  './',
  './index.html',
  './assets/styles.css?v=6',
  './assets/app.js?v=6',
  './manifest.webmanifest',
  './icons/icon-192-any.png',
  './icons/icon-512-any.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/apple-touch-icon.png'
];

self.addEventListener('install', (event) => {
  event.waitUntil(
    caches.open(VERSION)
      // 個別加入：單一檔案失敗不會讓整次安裝失敗
      .then((cache) => Promise.all(ASSETS.map((url) => cache.add(url).catch(() => null))))
      .then(() => self.skipWaiting())
  );
});

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

self.addEventListener('fetch', (event) => {
  const req = event.request;
  if (req.method !== 'GET') return;

  const url = new URL(req.url);
  if (url.origin !== self.location.origin) return;

  // 導覽：優先拿新版，離線時回落到快取的首頁
  if (req.mode === 'navigate') {
    event.respondWith(
      fetch(req)
        .then((res) => {
          const copy = res.clone();
          caches.open(VERSION).then((c) => c.put('./index.html', copy));
          return res;
        })
        .catch(() => caches.match('./index.html').then((hit) => hit || caches.match('./')))
    );
    return;
  }

  // 其他同源資源：快取優先，同時在背景更新
  event.respondWith(
    caches.match(req).then((hit) => {
      const network = fetch(req)
        .then((res) => {
          if (res && res.ok) {
            const copy = res.clone();
            caches.open(VERSION).then((c) => c.put(req, copy));
          }
          return res;
        })
        .catch(() => hit);
      return hit || network;
    })
  );
});
