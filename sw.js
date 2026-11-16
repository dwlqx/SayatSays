// Service worker — помощник, которого браузер запускает в фоне отдельно от страницы.
// Он сохраняет все файлы приложения на устройстве (в кэш), поэтому SayatSays открывается и без интернета.
//
// Как выпустить новую версию: поменяй файлы и подними VERSION на 1 (здесь и в js/version.js).
// Браузер заметит, что sw.js изменился, скачает файлы в новый кэш, и приложение покажет
// плашку «Доступно обновление». Пока не нажмёшь «Обновить», работает старая версия.

const VERSION = 2;
const CACHE = 'sayatsays-v' + VERSION;

// Всё, что нужно приложению. Тест tests/sw.test.js проверяет, что список полный и все файлы существуют.
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/backup.js',
  './js/db.js',
  './js/decks.js',
  './js/migrate.js',
  './js/scheduler.js',
  './js/streak.js',
  './js/study.js',
  './js/version.js',
  './vendor/ts-fsrs.mjs',
  './fonts/golos-text-cyrillic-ext-wght-normal.woff2',
  './fonts/golos-text-cyrillic-wght-normal.woff2',
  './fonts/golos-text-latin-ext-wght-normal.woff2',
  './fonts/golos-text-latin-wght-normal.woff2',
  './fonts/literata-cyrillic-ext-opsz-normal.woff2',
  './fonts/literata-cyrillic-opsz-normal.woff2',
  './fonts/literata-latin-ext-opsz-normal.woff2',
  './fonts/literata-latin-opsz-normal.woff2',
  './icons/apple-touch-icon.png',
  './icons/icon-192.png',
  './icons/icon-512.png',
  './icons/icon-maskable-192.png',
  './icons/icon-maskable-512.png',
  './data/decks.json',
  './data/progress-sm2.json'
];

// Установка: скачиваем все файлы в новый кэш.
// cache: 'reload' — мимо обычного кэша браузера, иначе можно положить в новый кэш старые копии файлов.
// skipWaiting здесь НЕ вызываем: новая версия ждёт, пока пользователь нажмёт «Обновить».
self.addEventListener('install', event => {
  event.waitUntil(
    caches.open(CACHE).then(cache => cache.addAll(FILES.map(f => new Request(f, { cache: 'reload' }))))
  );
});

// Включение новой версии: удаляем кэши прошлых версий и берём под управление открытые страницы.
self.addEventListener('activate', event => {
  event.waitUntil((async () => {
    for (const key of await caches.keys()) {
      if (key.startsWith('sayatsays-') && key !== CACHE) await caches.delete(key);
    }
    await self.clients.claim();
  })());
});

// Страница просит включить новую версию — это кнопка «Обновить».
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
});

// Каждый запрос страницы: сначала ищем в кэше, если нет — идём в сеть.
// ignoreSearch: адрес «./?что-то» отдаём так же, как «./».
self.addEventListener('fetch', event => {
  const req = event.request;
  if (req.method !== 'GET' || new URL(req.url).origin !== self.location.origin) return;
  event.respondWith(
    caches.open(CACHE)
      .then(cache => cache.match(req, { ignoreSearch: true }))
      .then(hit => hit || fetch(req))
  );
});
