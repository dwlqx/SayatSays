// Service worker — помощник, которого браузер запускает в фоне отдельно от страницы.
// Он сохраняет все файлы приложения на устройстве (в кэш), поэтому SayatSays открывается и без интернета.
//
// Как выпустить новую версию: поменяй файлы и подними VERSION на 1 (здесь и в js/version.js).
// Браузер заметит, что sw.js изменился, скачает файлы в новый кэш, и приложение покажет
// плашку «Доступно обновление». Пока не нажмёшь «Обновить», работает старая версия.

const VERSION = 3;
const CACHE = 'sayatsays-v' + VERSION;

// Всё, что нужно приложению. Тест tests/sw.test.js проверяет, что список полный и все файлы существуют.
const FILES = [
  './',
  './index.html',
  './manifest.webmanifest',
  './css/app.css',
  './js/app.js',
  './js/backup.js',
  './js/config.js',
  './js/db.js',
  './js/decks.js',
  './js/migrate.js',
  './js/push.js',
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

// Сообщения от страницы: «Обновить» включает новую версию, «Проверить уведомление» — показывает напоминание сразу.
self.addEventListener('message', event => {
  if (event.data === 'skipWaiting') self.skipWaiting();
  if (event.data === 'test-reminder') event.waitUntil(remind());
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

// ---------- Напоминания (push) ----------
// GitHub Actions по расписанию присылает push (tools/send-push.mjs). О карточках push ничего не знает:
// sw.js сам читает базу на телефоне, считает карточки на сегодня и показывает уведомление.
// iPhone требует показывать уведомление на КАЖДЫЙ push (иначе отключит их), поэтому оно показывается всегда —
// даже если базу прочитать не удалось.

self.addEventListener('push', event => {
  event.waitUntil(remind());
});

// Нажатие на уведомление: вернуться в открытое приложение или открыть его.
self.addEventListener('notificationclick', event => {
  event.notification.close();
  event.waitUntil((async () => {
    const wins = await self.clients.matchAll({ type: 'window', includeUncontrolled: true });
    if (wins.length) return wins[0].focus();
    return self.clients.openWindow('./');
  })());
});

async function remind() {
  let info = null;
  try { info = await readToday(Date.now()); } catch (e) { console.error(e); }
  const text = reminderText(info);
  // tag: новое напоминание заменяет прошлое, а не копится рядом с ним.
  await self.registration.showNotification(text.title, { body: text.body, tag: 'reminder', icon: './icons/icon-192.png' });
  // Число на иконке приложения (на iPhone — когда уведомления разрешены).
  const nav = self.navigator;
  if (info && nav && nav.setAppBadge) {
    await (info.n > 0 ? nav.setAppBadge(info.n) : nav.clearAppBadge()).catch(() => {});
  }
}

// Учебный день — так же, как dayIndex в js/streak.js: день начинается в 4:00 по местному времени.
// sw.js не может подключить модули приложения, поэтому эта функция и countToday повторены здесь,
// а тест tests/push.test.js проверяет, что они считают так же, как приложение.
function dayIndex(ts) {
  const d = new Date(ts - 4 * 3600e3);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / 864e5);
}

// Сколько карточек на сегодня — то же число, что на кнопке «Повторить всё» (todayTotal в js/decks.js):
// карточки, у которых подошёл срок, плюс новые — не больше дневного лимита на колоду.
// data — содержимое базы: decks и cardState целиком, day — запись stats за сегодня, prefs — настройки.
function countToday(data, today) {
  const fsrs = {}; // fsrs[колода][карточка] — расписание карточки
  for (const r of data.cardState || []) {
    if (!fsrs[r.deck]) fsrs[r.deck] = {};
    fsrs[r.deck][r.card] = r.fsrs;
  }
  const prefs = data.prefs || {};
  const perDay = (prefs.newPerDay != null ? prefs.newPerDay : 15) | 0;
  let n = 0;
  for (const deck of data.decks || []) {
    const used = (data.day && data.day.nw && data.day.nw[deck.id]) || 0;
    let fresh = 0;
    for (const card of deck.cards || []) {
      const f = fsrs[deck.id] && fsrs[deck.id][card.id];
      if (!f || f.state === 0) fresh++;               // новая — её ещё не показывали
      else if (dayIndex(f.due) <= today) n++;         // срок повторения подошёл
    }
    n += Math.min(fresh, Math.max(0, perDay - used));
  }
  return n;
}

// Прочитать из базы, что на сегодня: { n: карточек, done: день уже засчитан }. null — базы на устройстве нет.
function readToday(now) {
  const today = dayIndex(now);
  return new Promise((resolve, reject) => {
    const req = indexedDB.open('sayatsays'); // без номера версии — открываем ту, что есть
    // Базы ещё нет. Отменяем, иначе здесь создалась бы пустая база и приложение не смогло бы её потом заполнить.
    req.onupgradeneeded = () => req.transaction.abort();
    req.onerror = () => resolve(null);
    req.onsuccess = () => {
      const db = req.result, got = {};
      try {
        const tx = db.transaction(['decks', 'cardState', 'stats', 'settings']);
        const ask = (name, r) => { r.onsuccess = () => { got[name] = r.result; }; };
        ask('decks', tx.objectStore('decks').getAll());
        ask('cardState', tx.objectStore('cardState').getAll());
        ask('day', tx.objectStore('stats').get(today));
        ask('prefs', tx.objectStore('settings').get('prefs'));
        tx.oncomplete = () => { db.close(); resolve({ n: countToday(got, today), done: !!(got.day && got.day.done) }); };
        tx.onerror = () => { db.close(); reject(tx.error); };
      } catch (e) { db.close(); reject(e); }
    };
  });
}

// 1 карточка, 2 карточки, 5 карточек.
function plural(n, one, few, many) {
  const m = Math.abs(n) % 100, k = m % 10;
  if (m > 10 && m < 20) return many;
  if (k > 1 && k < 5) return few;
  if (k === 1) return one;
  return many;
}

// Текст уведомления. info = null — базу прочитать не удалось.
function reminderText(info) {
  if (!info) return { title: 'Пора повторить карточки', body: 'Загляни в приложение: там видно, что на сегодня.' };
  const n = info.n, cards = n + ' ' + plural(n, 'карточка', 'карточки', 'карточек');
  if (n === 0) return { title: 'На сегодня всё повторено', body: 'Можно отдыхать.' };
  if (info.done) return { title: 'Цель на сегодня выполнена', body: 'Ещё ' + cards + ' — если захочешь.' };
  return { title: cards + ' ' + plural(n, 'ждёт', 'ждут', 'ждут') + ' повторения', body: '' };
}
