// Напоминания — часть на стороне приложения: разрешение, подписка на push, проверка, число на иконке.
//
// Как устроены напоминания целиком:
//   1. Здесь телефон подписывается на push. Подписка — адрес этого телефона у сервера push (у iPhone это Apple)
//      и ключи, которыми шифруется сообщение.
//   2. Рома копирует подписку в GitHub Secrets (PUSH_SUBSCRIPTION).
//   3. GitHub Actions по расписанию (.github/workflows/reminder.yml) отправляет на этот адрес push (tools/send-push.mjs).
//   4. Телефон будит sw.js: тот сам считает карточки на сегодня и показывает уведомление.

import { VAPID_PUBLIC_KEY } from './config.js';

// Ключ записан в base64url (буквы, цифры, «-» и «_»), а браузеру он нужен байтами.
export function keyToBytes(b64url) {
  const b64 = b64url.replace(/-/g, '+').replace(/_/g, '/') + '='.repeat((4 - b64url.length % 4) % 4);
  return Uint8Array.from(atob(b64), c => c.charCodeAt(0));
}

// Открыто как приложение с экрана «Домой», а не во вкладке браузера.
export const isStandalone = () => navigator.standalone === true || matchMedia('(display-mode: standalone)').matches;

// Что можно сделать на этом устройстве:
//   'install'     — открыто в браузере: push на iPhone работает только в приложении с экрана «Домой»;
//   'unsupported' — push нет (например, iOS старше 16.4);
//   'denied'      — уведомления запрещены в настройках;
//   'ready'       — можно включать.
export function pushStatus() {
  if (!isStandalone()) return 'install';
  if (!VAPID_PUBLIC_KEY || !('serviceWorker' in navigator) || !('PushManager' in window) || !('Notification' in window)) return 'unsupported';
  if (Notification.permission === 'denied') return 'denied';
  return 'ready';
}

// Текущая подписка этого телефона или null.
export async function currentSubscription() {
  const reg = await navigator.serviceWorker.ready;
  return reg.pushManager.getSubscription();
}

// Подписка в виде текста для секрета PUSH_SUBSCRIPTION: { endpoint, expirationTime, keys: { p256dh, auth } }.
export const subscriptionText = sub => JSON.stringify(sub.toJSON());

// Подписка сделана с нашим публичным ключом? Если ключи сменили (tools/make-vapid.mjs --force), старая не годится.
function sameKey(sub) {
  const k = sub.options && sub.options.applicationServerKey;
  if (!k) return true; // браузер не говорит, каким ключом подписан, — считаем, что нашим
  const a = new Uint8Array(k), b = keyToBytes(VAPID_PUBLIC_KEY);
  return a.length === b.length && a.every((x, i) => x === b[i]);
}

// Включить напоминания и вернуть подписку. Вызывать прямо из нажатия на кнопку: iPhone спрашивает
// разрешение только в ответ на нажатие, поэтому разрешение запрашивается первым делом.
// fresh = true — выбросить старую подписку и сделать новую (если GitHub пишет, что подписка устарела).
export async function enablePush(fresh = false) {
  const permission = await Notification.requestPermission();
  if (permission === 'denied') throw new Error('Уведомления запрещены. Включи их: Настройки iPhone → Уведомления → SayatSays.');
  if (permission !== 'granted') throw new Error('Без разрешения на уведомления напоминания не придут.');
  const reg = await navigator.serviceWorker.ready;
  let sub = await reg.pushManager.getSubscription();
  if (sub && (fresh || !sameKey(sub))) { await sub.unsubscribe(); sub = null; }
  // userVisibleOnly: каждое push-сообщение обязательно показывается уведомлением (без этого iPhone не подпишет).
  if (!sub) sub = await reg.pushManager.subscribe({ userVisibleOnly: true, applicationServerKey: keyToBytes(VAPID_PUBLIC_KEY) });
  return sub;
}

// Проверка без GitHub: sw.js делает то же, что при настоящем push, — считает карточки и показывает уведомление.
export async function testReminder() {
  const reg = await navigator.serviceWorker.ready;
  reg.active.postMessage('test-reminder');
}

// Число на иконке приложения; 0 — убрать. На iPhone работает, когда уведомления разрешены.
export function setBadge(n) {
  if (!('setAppBadge' in navigator)) return;
  (n > 0 ? navigator.setAppBadge(n) : navigator.clearAppBadge()).catch(() => {});
}
