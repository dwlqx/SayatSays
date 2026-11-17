// Отправка напоминания с GitHub Actions: понятные ошибки, никаких секретов в логе, расписание.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { createECDH, randomBytes } from 'node:crypto';
import webpush from 'web-push';
import { readSubscription, sendOptions, pushHost, explainFailure } from '../tools/push-lib.mjs';
import { VAPID_PUBLIC_KEY, VAPID_SUBJECT } from '../js/config.js';

const root = new URL('../', import.meta.url);

// Подписка, как её выдаёт iPhone: адрес у Apple и ключи шифрования телефона.
function fakeSubscription() {
  const phone = createECDH('prime256v1');
  phone.generateKeys();
  return {
    endpoint: 'https://web.push.apple.com/QGuQyavXutnMH8Ec9vB0KQ' + randomBytes(6).toString('hex'),
    expirationTime: null,
    keys: { p256dh: phone.getPublicKey().toString('base64url'), auth: randomBytes(16).toString('base64url') }
  };
}

test('подписка из секрета: понятные ошибки без содержимого секрета', () => {
  const sub = fakeSubscription();
  assert.deepEqual(readSubscription(JSON.stringify(sub)), { endpoint: sub.endpoint, keys: sub.keys });
  assert.equal(pushHost(sub), 'web.push.apple.com');

  assert.throws(() => readSubscription(undefined), /Нет секрета PUSH_SUBSCRIPTION/);
  assert.throws(() => readSubscription('  '), /Нет секрета PUSH_SUBSCRIPTION/);
  const broken = JSON.stringify(sub).slice(0, -5);
  assert.throws(() => readSubscription(broken), e => /не JSON/.test(e.message) && !e.message.includes(sub.endpoint));
  assert.throws(() => readSubscription(JSON.stringify({ endpoint: sub.endpoint })), /не хватает адреса или ключей/);
  assert.throws(() => readSubscription(JSON.stringify({ ...sub, endpoint: 'http://x' })), /не хватает адреса или ключей/);
});

test('ошибки отправки объясняются, а секреты в тексте заменяются на ***', () => {
  const sub = fakeSubscription();
  for (const code of [404, 410]) {
    const msg = explainFailure({ statusCode: code, body: '', endpoint: sub.endpoint });
    assert.match(msg, /Подписка устарела/);
    assert.match(msg, /подпишись заново/);
    assert.ok(!msg.includes(sub.endpoint));
  }
  const bad = explainFailure({ statusCode: 403, body: '{"reason":"BadJwtToken"}' });
  assert.match(bad, /403, BadJwtToken/);
  assert.match(bad, /VAPID_PRIVATE_KEY/);
  assert.equal(explainFailure({ statusCode: 500, body: '{"reason":"<b>что-то</b> ' + sub.endpoint + '"}' }),
    'Сервер push ответил 500. Попробуй запустить ещё раз позже.', 'странную «причину» не показываем');
  const net = explainFailure(new Error('connect ETIMEDOUT ' + sub.endpoint), [sub.endpoint]);
  assert.equal(net, 'Не получилось отправить push: connect ETIMEDOUT ***');
});

test('сообщение для Apple подписано нашим ключом и доставляется сразу', () => {
  const sub = fakeSubscription();
  const { privateKey } = webpush.generateVAPIDKeys(); // тестовый ключ: настоящий лежит только в GitHub Secrets
  const req = webpush.generateRequestDetails(sub, '{"kind":"reminder"}',
    sendOptions({ subject: VAPID_SUBJECT, publicKey: VAPID_PUBLIC_KEY, privateKey }));
  assert.equal(req.endpoint, sub.endpoint);
  assert.equal(req.headers.TTL, 10800);
  assert.equal(req.headers.Urgency, 'high');
  assert.equal(req.headers.Topic, 'reminder');
  const auth = req.headers.Authorization;
  assert.ok(auth.endsWith(', k=' + VAPID_PUBLIC_KEY), 'в подписи — публичный ключ из js/config.js');
  const jwt = JSON.parse(Buffer.from(auth.slice('vapid t='.length).split('.')[1], 'base64url').toString());
  assert.equal(jwt.aud, 'https://web.push.apple.com');
  assert.equal(jwt.sub, VAPID_SUBJECT);
});

// Запустить tools/send-push.mjs, как его запускает GitHub Actions, но с нашими переменными.
function runSend(env) {
  const clean = { ...process.env };
  delete clean.VAPID_PRIVATE_KEY; delete clean.PUSH_SUBSCRIPTION;
  return spawnSync(process.execPath, ['tools/send-push.mjs'], { cwd: root, env: { ...clean, ...env }, encoding: 'utf8' });
}

test('send-push.mjs: без секретов — понятная ошибка, и подписка не попадает в лог', () => {
  let r = runSend({});
  assert.equal(r.status, 1);
  assert.match(r.stderr, /VAPID_PRIVATE_KEY/);

  r = runSend({ VAPID_PRIVATE_KEY: 'x' });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /Нет секрета PUSH_SUBSCRIPTION/);

  const sub = fakeSubscription();
  r = runSend({ VAPID_PRIVATE_KEY: 'x', PUSH_SUBSCRIPTION: JSON.stringify(sub).slice(0, -3) });
  assert.equal(r.status, 1);
  assert.match(r.stderr, /не JSON/);
  assert.ok(!(r.stdout + r.stderr).includes(sub.endpoint));
});

test('workflow: два напоминания в нужное время, ручной запуск и нужные секреты', () => {
  const yml = readFileSync(new URL('.github/workflows/reminder.yml', root), 'utf8');
  // cron — по UTC; в Алматы UTC+5.
  const almaty = [...yml.matchAll(/cron: '(\d+) (\d+) \* \* \*'/g)]
    .map(m => ((+m[2] + 5) % 24) + ':' + m[1].padStart(2, '0'));
  assert.deepEqual(almaty, ['7:09', '18:45']);
  assert.match(yml, /workflow_dispatch:/);
  assert.match(yml, /run: node tools\/send-push\.mjs/);
  for (const name of ['VAPID_PRIVATE_KEY', 'PUSH_SUBSCRIPTION']) {
    assert.ok(yml.includes(name + ': ${{ secrets.' + name + ' }}'), 'workflow передаёт секрет ' + name);
  }
});
