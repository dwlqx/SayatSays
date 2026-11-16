// Отправить push-напоминание на телефон. Его запускает GitHub Actions по расписанию (.github/workflows/reminder.yml).
//
// Нужны переменные окружения — на GitHub они берутся из Secrets:
//   VAPID_PRIVATE_KEY  приватный ключ, пара к VAPID_PUBLIC_KEY из js/config.js
//   PUSH_SUBSCRIPTION  подписка телефона — JSON из приложения (Настройки → Напоминания)
//
// В самом push нет ни числа карточек, ни текста: их телефон берёт из своей базы (sw.js).
// Логи Actions видны всем, поэтому подписка и ключи здесь никогда не печатаются.

import webpush from 'web-push';
import { VAPID_PUBLIC_KEY, VAPID_SUBJECT } from '../js/config.js';
import { readSubscription, sendOptions, pushHost, explainFailure } from './push-lib.mjs';

const privateKey = (process.env.VAPID_PRIVATE_KEY || '').trim();
let sub = null;
try {
  if (!VAPID_PUBLIC_KEY) throw new Error('В js/config.js нет публичного ключа. Создай ключи: node tools/make-vapid.mjs');
  if (!privateKey) throw new Error('Нет секрета VAPID_PRIVATE_KEY. Создай ключи: node tools/make-vapid.mjs — он сам положит ключ в Secrets.');
  sub = readSubscription(process.env.PUSH_SUBSCRIPTION);
  const options = sendOptions({ subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey });
  const res = await webpush.sendNotification(sub, JSON.stringify({ kind: 'reminder' }), options);
  console.log('Готово: ' + pushHost(sub) + ' принял напоминание (ответ ' + res.statusCode + ').');
} catch (e) {
  const secrets = [privateKey, sub && sub.endpoint, sub && sub.keys.p256dh, sub && sub.keys.auth];
  console.error(explainFailure(e, secrets));
  process.exitCode = 1;
}
