// Общие помощники для тестов (сам файл — не тест).
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from '../js/db.js';
import { legacyToRecords, sm2ToFsrs } from '../js/migrate.js';
import { makeScheduler } from '../js/scheduler.js';

// В Node нет IndexedDB, поэтому берём его имитацию из пакета fake-indexeddb.
// Каждый вызов — новая пустая «база в памяти», тесты друг другу не мешают.
export const freshDB = () => openDB(new IDBFactory());

// Состояние S, как его собирает app.js после чтения базы: исходные данные, уже переведённые на FSRS в момент now.
export async function legacyState(now, settings = { newPerDay: 15, goal: 10, streak: true, retention: 0.9 }) {
  const { decks, progress } = await loadLegacy();
  const rec = legacyToRecords(decks, progress);
  const scheduler = makeScheduler();
  const S = { decks: {}, prog: {}, days: {}, settings };
  for (const d of rec.decks) S.decks[d.id] = d;
  for (const r of rec.cardState) (S.prog[r.deck] || (S.prog[r.deck] = {}))[r.card] = { ...r, fsrs: sm2ToFsrs(r.sm2, now, scheduler) };
  for (const d of rec.stats) S.days[d.day] = d;
  return S;
}

const readJSON = name => JSON.parse(readFileSync(new URL('../data/' + name, import.meta.url), 'utf8'));
export const readText = name => readFileSync(new URL('../data/' + name, import.meta.url), 'utf8');

// То же, что в браузере делает fetch: содержимое data/decks.json и data/progress-sm2.json.
export const loadLegacy = async () => ({ decks: readJSON('decks.json'), progress: readJSON('progress-sm2.json') });
