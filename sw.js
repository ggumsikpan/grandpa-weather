// 앱 화면을 저장해 두어서 인터넷이 약해도 켜지도록 함 (날씨 자료 /api/ 는 저장하지 않음)
const CACHE = 'grandpa-weather-v2';
const SHELL = ['./', 'index.html', 'style.css', 'app.js', 'manifest.webmanifest',
  'icons/icon-192.png', 'icons/apple-touch-icon.png',
  'https://unpkg.com/leaflet@1.9.4/dist/leaflet.css', 'https://unpkg.com/leaflet@1.9.4/dist/leaflet.js'];

self.addEventListener('install', (e) => {
  e.waitUntil(caches.open(CACHE).then((c) => c.addAll(SHELL)).then(() => self.skipWaiting()));
});
self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys().then((ks) => Promise.all(ks.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});
self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === location.origin;
  const isLeaflet = url.hostname === 'unpkg.com';
  if (!sameOrigin && !isLeaflet) return;            // 날씨·지도 자료는 항상 새로 받음
  if (sameOrigin && url.pathname.includes('/api/')) return; // 중계 서버 응답은 저장 안 함
  if (isLeaflet) {
    e.respondWith(caches.match(e.request).then((r) => r || fetch(e.request)));
    return;
  }
  // 앱 파일: 새 버전 먼저, 안 되면 저장본
  e.respondWith(
    fetch(e.request).then((res) => {
      if (res.ok) { const copy = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, copy)); }
      return res;
    }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((r) => r || caches.match('index.html')))
  );
});
