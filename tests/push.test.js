// Напоминания на телефоне: sw.js считает то же число, что приложение, показывает уведомление
// с правильным текстом и не портит базу. Плюс проверка публичного VAPID-ключа.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import vm from 'node:vm';
import { createPublicKey } from 'node:crypto';
import { IDBFactory } from 'fake-indexeddb';
import { legacyState, loadLegacy } from './helpers.js';
import { todayTotal } from '../js/decks.js';
import { dayIndex, dayStart } from '../js/streak.js';
import { openDB, STORES } from '../js/db.js';
import { seedIfNeeded, migrateToFsrs } from '../js/migrate.js';
import { keyToBytes } from '../js/push.js';
import { VAPID_PUBLIC_KEY, VAPID_SUBJECT } from '../js/config.js';

const HOUR = 3600e3;
const TODAY = 20773;                          // 16 ноября 2026
const NOW = dayStart(TODAY) + 3 * HOUR + 9 * 60e3; // 7:09 утра

// sw.js — обычный скрипт, а не модуль. Запускаем его в отдельной «песочнице» (vm), как браузер запускает
// service worker, и достаём оттуда функции. Обработчики событий запоминаем, чтобы вызвать их как браузер.
function loadSW({ indexedDB = new IDBFactory(), windows = [] } = {}) {
  const on = {}, shown = [], badge = [], opened = [];
  const self = {
    addEventListener: (type, fn) => { on[type] = fn; },
    registration: { showNotification: async (title, opts) => { shown.push({ title, ...opts }); } },
    navigator: {
      setAppBadge: async n => { badge.push(n); },
      clearAppBadge: async () => { badge.push(0); }
    },
    clients: {
      matchAll: async () => windows,
      openWindow: async url => { opened.push(url); }
    }
  };
  const sw = vm.createContext({ self, indexedDB, console });
  vm.runInContext(readFileSync(new URL('../sw.js', import.meta.url), 'utf8'), sw);
  // Вызвать обработчик так, как это делает браузер, и дождаться всего, что он попросил подождать.
  sw.fire = async (type, event = {}) => {
    const wait = [];
    on[type]({ ...event, waitUntil: p => wait.push(p) });
    await Promise.all(wait);
  };
  return Object.assign(sw, { shown, badge, opened });
}

// Данные в том виде, в каком sw.js читает их из базы.
const asData = (S, today) => ({
  decks: Object.values(S.decks),
  cardState: Object.values(S.prog).flatMap(m => Object.values(m)),
  day: S.days[today],
  prefs: S.settings
});

// Объекты из песочницы — «чужие», поэтому перед сравнением копируем их в обычные.
const plain = o => JSON.parse(JSON.stringify(o));

test('учебный день в sw.js считается так же, как в приложении', () => {
  const sw = loadSW();
  for (let t = dayStart(TODAY - 200); t < dayStart(TODAY + 200); t += HOUR + 7 * 60e3) {
    assert.equal(sw.dayIndex(t), dayIndex(t), new Date(t).toString());
  }
});

test('число в напоминании совпадает с числом на кнопке «Повторить всё»', async () => {
  const sw = loadSW();
  const S = await legacyState(NOW);
  // Карточка, которой уже нет в колоде, и колода, которой уже нет, не считаются.
  S.prog['kz-exam-gram']['нет-такой'] = { deck: 'kz-exam-gram', card: 'нет-такой', fsrs: { state: 2, due: NOW } };
  S.prog['нет-колоды'] = { x: { deck: 'нет-колоды', card: 'x', fsrs: { state: 2, due: NOW } } };
  const seen = new Set();
  for (const today of [TODAY - 40, TODAY - 35, TODAY - 30, TODAY - 20, TODAY, TODAY + 400]) {
    for (const newPerDay of [15, 5, 0]) {
      S.settings = { ...S.settings, newPerDay };
      const n = sw.countToday(asData(S, today), today);
      assert.equal(n, todayTotal(S, today), 'день ' + today + ', новых в день ' + newPerDay);
      seen.add(n);
    }
  }
  // Сегодня уже взяты новые карточки из одной колоды — лимит учитывается так же.
  S.settings = { ...S.settings, newPerDay: 15 };
  S.days[TODAY] = { day: TODAY, n: 12, nw: { 'kz-lex-verbs': 12 } };
  assert.equal(sw.countToday(asData(S, TODAY), TODAY), todayTotal(S, TODAY));
  assert.ok(seen.size > 3, 'проверили разные числа, а не одно и то же');
});

test('тексты уведомления', () => {
  const sw = loadSW();
  const t = info => plain(sw.reminderText(info));
  assert.deepEqual(t({ n: 12, done: false }), { title: '12 карточек ждут повторения', body: '' });
  const titles = { 1: '1 карточка ждёт', 2: '2 карточки ждут', 5: '5 карточек ждут', 11: '11 карточек ждут',
    21: '21 карточка ждёт', 22: '22 карточки ждут', 111: '111 карточек ждут' };
  for (const n in titles) assert.equal(t({ n: +n, done: false }).title, titles[n] + ' повторения');
  assert.deepEqual(t({ n: 5, done: true }), { title: 'Цель на сегодня выполнена', body: 'Ещё 5 карточек — если захочешь.' });
  assert.deepEqual(t({ n: 0, done: true }), { title: 'На сегодня всё повторено', body: 'Можно отдыхать.' });
  assert.deepEqual(t({ n: 0, done: false }), { title: 'На сегодня всё повторено', body: 'Можно отдыхать.' });
  assert.equal(t(null).title, 'Пора повторить карточки');
});

// База, как на телефоне: исходные данные, переведённые на FSRS.
async function phoneDB(factory) {
  const db = await openDB(factory);
  await seedIfNeeded(db, loadLegacy, NOW - 1000);
  await migrateToFsrs(db, NOW - 500);
  return db;
}
// Состояние S из базы — так же, как его собирает app.js.
async function stateFrom(db) {
  const S = { decks: {}, prog: {}, days: {}, settings: { newPerDay: 15 } };
  for (const d of await db.getAll('decks')) S.decks[d.id] = d;
  for (const r of await db.getAll('cardState')) (S.prog[r.deck] || (S.prog[r.deck] = {}))[r.card] = r;
  for (const d of await db.getAll('stats')) S.days[d.day] = d;
  return S;
}

test('sw.js читает базу телефона: то же число, что в приложении, и отметку «день засчитан»', async () => {
  const factory = new IDBFactory();
  const db = await phoneDB(factory);
  const sw = loadSW({ indexedDB: factory });
  const expected = todayTotal(await stateFrom(db), TODAY);
  assert.ok(expected > 0);
  assert.deepEqual(plain(await sw.readToday(NOW)), { n: expected, done: false });

  await db.write(['stats'], s => s.stats.put({ day: TODAY, n: 10, done: true, nw: {} }));
  assert.deepEqual(plain(await sw.readToday(NOW)), { n: todayTotal(await stateFrom(db), TODAY), done: true });
  db.close();
});

test('если базы ещё нет, sw.js её не создаёт — приложение потом откроется как обычно', async () => {
  const factory = new IDBFactory();
  const sw = loadSW({ indexedDB: factory });
  assert.equal(await sw.readToday(NOW), null);
  const db = await phoneDB(factory); // первый запуск приложения после этого
  for (const name of [...STORES, 'snapshots']) assert.ok(db.idb.objectStoreNames.contains(name), 'есть хранилище ' + name);
  assert.equal((await db.getAll('cardState')).length, 80);
  db.close();
});

test('push: уведомление показывается всегда, на иконке — число карточек', async () => {
  const factory = new IDBFactory();
  const db = await phoneDB(factory);
  const sw = loadSW({ indexedDB: factory });
  await sw.fire('push');
  const info = plain(await sw.readToday(Date.now()));
  assert.equal(sw.shown.length, 1);
  assert.equal(sw.shown[0].title, sw.reminderText(info).title);
  assert.equal(sw.shown[0].tag, 'reminder', 'новое напоминание заменяет старое');
  assert.deepEqual(plain(sw.badge), [info.n]);
  db.close();

  // Базы нет (или она не читается) — уведомление всё равно есть, а число на иконке не трогаем.
  const empty = loadSW();
  await empty.fire('push');
  assert.equal(empty.shown.length, 1);
  assert.equal(empty.shown[0].title, 'Пора повторить карточки');
  assert.equal(empty.badge.length, 0);
});

test('«Проверить уведомление» делает то же, что push', async () => {
  const sw = loadSW();
  await sw.fire('message', { data: 'test-reminder' });
  assert.equal(sw.shown.length, 1);
});

test('нажатие на уведомление открывает приложение или возвращает в открытое', async () => {
  const closed = [];
  const notification = { close: () => closed.push(1) };
  const sw = loadSW();
  await sw.fire('notificationclick', { notification });
  assert.deepEqual(plain(sw.opened), ['./']);
  assert.equal(closed.length, 1);

  const focused = [];
  const open = loadSW({ windows: [{ focus: async () => focused.push(1) }] });
  await open.fire('notificationclick', { notification });
  assert.equal(focused.length, 1);
  assert.equal(open.opened.length, 0, 'второе окно не открываем');
});

test('публичный VAPID-ключ — настоящий ключ P-256, отправитель — адрес сайта', () => {
  assert.ok(VAPID_PUBLIC_KEY, 'в js/config.js нет ключа: запусти node tools/make-vapid.mjs');
  const bytes = keyToBytes(VAPID_PUBLIC_KEY);
  assert.deepEqual([...bytes], [...Buffer.from(VAPID_PUBLIC_KEY, 'base64url')]);
  assert.equal(bytes.length, 65);
  assert.equal(bytes[0], 4, 'несжатая точка начинается с байта 4');
  const b64 = a => Buffer.from(a).toString('base64url');
  // Бросит ошибку, если точка не лежит на кривой P-256.
  createPublicKey({ key: { kty: 'EC', crv: 'P-256', x: b64(bytes.slice(1, 33)), y: b64(bytes.slice(33)) }, format: 'jwk' });
  assert.equal(VAPID_SUBJECT, 'https://dwlqx.github.io/SayatSays/');
});
