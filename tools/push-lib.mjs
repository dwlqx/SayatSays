// Помощники для tools/send-push.mjs. Лежат отдельно, чтобы их можно было проверить тестами (tests/tools.test.js).
//
// Важно: логи GitHub Actions в публичном репозитории видны всем. GitHub прячет в логах значения секретов,
// но только целиком — кусок секрета (например, адрес из подписки) он не узнает. Поэтому здесь ничего
// из подписки и ключей не попадает в тексты ошибок.

// Подписка из секрета PUSH_SUBSCRIPTION — JSON, скопированный из приложения (Настройки → Напоминания).
export function readSubscription(text) {
  if (!text || !text.trim()) {
    throw new Error('Нет секрета PUSH_SUBSCRIPTION. Включи напоминания в приложении (Настройки → Напоминания), ' +
      'скопируй подписку и добавь её в GitHub Secrets — см. README.');
  }
  let sub;
  try { sub = JSON.parse(text); } catch {
    throw new Error('PUSH_SUBSCRIPTION — не JSON. Скопируй подписку из приложения ещё раз, целиком, и обнови секрет.');
  }
  const ok = sub && typeof sub.endpoint === 'string' && sub.endpoint.startsWith('https://') &&
    sub.keys && typeof sub.keys.p256dh === 'string' && typeof sub.keys.auth === 'string';
  if (!ok) throw new Error('В PUSH_SUBSCRIPTION не хватает адреса или ключей. Скопируй подписку из приложения ещё раз, целиком, и обнови секрет.');
  return { endpoint: sub.endpoint, keys: { p256dh: sub.keys.p256dh, auth: sub.keys.auth } };
}

// Настройки отправки для web-push: чем подписать сообщение и как его доставлять.
export function sendOptions({ subject, publicKey, privateKey }) {
  return {
    vapidDetails: { subject, publicKey, privateKey },
    TTL: 3 * 3600,      // телефон был без сети — доставить в течение 3 часов, позже напоминание уже не нужно
    urgency: 'high',    // доставить сразу, даже если телефон экономит заряд
    topic: 'reminder'   // недоставленное прошлое напоминание заменяется новым, а не копится
  };
}

// Чей сервер push принимает сообщение (web.push.apple.com у iPhone) — только имя сервера, без адреса телефона.
export const pushHost = sub => new URL(sub.endpoint).host;

// Что написать в лог, если отправка не удалась. e — ошибка от web-push (у неё есть statusCode и body).
// secrets — строки, которые нельзя показывать: если какая-то попадёт в текст, она заменится на «***».
export function explainFailure(e, secrets = []) {
  const code = e && e.statusCode;
  // Apple объясняет отказ одним словом, например {"reason":"BadJwtToken"}. Показываем только такое слово.
  let reason = '';
  try { const r = JSON.parse(e.body).reason; if (/^[A-Za-z]+$/.test(r)) reason = ', ' + r; } catch { /* причины нет */ }
  let msg;
  if (code === 404 || code === 410) {
    msg = 'Подписка устарела (ответ ' + code + '): телефон больше не принимает push по этому адресу, подпишись заново. ' +
      'В приложении: Настройки → Напоминания → «Создать новую подписку» (или «Включить напоминания»), ' +
      'потом обнови секрет PUSH_SUBSCRIPTION.';
  } else if (code === 403) {
    msg = 'Сервер push не принял подпись (ответ 403' + reason + '). Скорее всего, VAPID_PRIVATE_KEY в Secrets — ' +
      'не пара к публичному ключу в js/config.js. Если ключи меняли, создай в приложении новую подписку и обнови PUSH_SUBSCRIPTION.';
  } else if (code) {
    msg = 'Сервер push ответил ' + code + reason + '. Попробуй запустить ещё раз позже.';
  } else {
    msg = 'Не получилось отправить push: ' + ((e && e.message) || e);
  }
  for (const s of secrets) if (s) msg = msg.split(s).join('***');
  return msg;
}
