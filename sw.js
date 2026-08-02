/* 打勾勾 Pinky — Service Worker
   應用外殼採快取優先（背景更新），導覽請求採網路優先（離線時回落到快取）。
   改動任何被預先快取的檔案時，請把 VERSION 加一。 */

const VERSION = 'pinky-v8';
const ASSETS = [
  './',
  './index.html',
  './assets/styles.css?v=8',
  './assets/app.js?v=8',
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

const KEEP = [/* 版本快取之外要保留的 */ 'pinky-state'];

self.addEventListener('activate', (event) => {
  event.waitUntil(
    caches.keys()
      .then((keys) => Promise.all(keys.filter((k) => k !== VERSION && !KEEP.includes(k)).map((k) => caches.delete(k))))
      .then(() => self.clients.claim())
  );
});

/* 背景喚醒罵人（Android 安裝到主畫面後才可能觸發；其他平台不會註冊成功） */
self.addEventListener('periodicsync', (event) => {
  if (event.tag === 'pinky-nag') event.waitUntil(nagFromBackground());
});

async function nagFromBackground() {
  try {
    const cache = await caches.open('pinky-state');
    const res = await cache.match('./nag-state.json');
    if (!res) return;
    const s = await res.json();
    if (!s.enabled || !s.lines || !s.lines.length) return;
    if ((s.overdue || 0) + (s.todayDue || 0) === 0) return;
    const line = s.lines[Math.floor(Math.random() * s.lines.length)];
    await self.registration.showNotification('打勾勾', {
      body: line,
      icon: 'icons/icon-192-any.png',
      badge: 'icons/icon-192.png',
      tag: 'pinky-nag'
    });
  } catch (err) { /* 背景喚醒失敗就等下一次 */ }
}

self.addEventListener('notificationclick', (event) => {
  event.notification.close();
  event.waitUntil(
    self.clients.matchAll({ type: 'window', includeUncontrolled: true }).then((list) => {
      for (const c of list) { if ('focus' in c) return c.focus(); }
      return self.clients.openWindow('./');
    })
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
