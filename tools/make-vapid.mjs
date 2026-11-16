// Создать пару VAPID-ключей для напоминаний. Запускается на компьютере, в папке проекта:
//   node tools/make-vapid.mjs
//
// Что делает:
//   1. Создаёт пару ключей (библиотека web-push).
//   2. Приватный ключ сразу отправляет в GitHub Secrets (VAPID_PRIVATE_KEY) через программу gh.
//      На экран и в файлы он не попадает — в публичный репозиторий его не закоммитить даже случайно.
//   3. Публичный ключ записывает в js/config.js: его можно хранить в открытом коде.
//
// Если ключи уже есть, скрипт их не тронет: с новыми ключами старая подписка телефона перестанет работать.
// Сменить всё же можно флагом --force — потом в приложении нужно создать новую подписку и обновить PUSH_SUBSCRIPTION.

import webpush from 'web-push';
import { spawnSync } from 'node:child_process';
import { readFileSync, writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('..', import.meta.url));
const CONFIG = new URL('../js/config.js', import.meta.url);
const LINE = /export const VAPID_PUBLIC_KEY = '([^']*)';/;

function fail(msg) { console.error(msg); process.exit(1); }

const config = readFileSync(CONFIG, 'utf8');
const found = config.match(LINE);
if (!found) fail('В js/config.js не нашлась строка VAPID_PUBLIC_KEY — проверь файл.');
if (found[1] && !process.argv.includes('--force')) {
  fail('Ключи уже есть, ничего не меняю. С новыми ключами старая подписка телефона перестанет работать.\n' +
    'Если точно нужно сменить: node tools/make-vapid.mjs --force — потом создай в приложении новую подписку.');
}

const keys = webpush.generateVAPIDKeys();

// Сначала приватный ключ — в Secrets. gh читает значение секрета из стандартного ввода (input), не из командной строки.
const gh = spawnSync('gh', ['secret', 'set', 'VAPID_PRIVATE_KEY'], { cwd: ROOT, input: keys.privateKey, encoding: 'utf8' });
if (gh.error || gh.status !== 0) {
  fail('Не получилось положить приватный ключ в GitHub Secrets через gh:\n' +
    (gh.error ? gh.error.message : (gh.stderr || gh.stdout)) +
    '\nПроверь, что gh установлен и ты вошёл: gh auth status. js/config.js не изменён.');
}

// Только когда секрет сохранён — публичный ключ в js/config.js. Так ключи не разойдутся.
writeFileSync(CONFIG, config.replace(LINE, "export const VAPID_PUBLIC_KEY = '" + keys.publicKey + "';"));
console.log('Готово.\n' +
  '  Приватный ключ — в GitHub Secrets (VAPID_PRIVATE_KEY).\n' +
  '  Публичный ключ — в js/config.js.');
