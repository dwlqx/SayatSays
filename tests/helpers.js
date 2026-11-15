// Общие помощники для тестов (сам файл — не тест).
import { readFileSync } from 'node:fs';
import { IDBFactory } from 'fake-indexeddb';
import { openDB } from '../js/db.js';

// В Node нет IndexedDB, поэтому берём его имитацию из пакета fake-indexeddb.
// Каждый вызов — новая пустая «база в памяти», тесты друг другу не мешают.
export const freshDB = () => openDB(new IDBFactory());

const readJSON = name => JSON.parse(readFileSync(new URL('../data/' + name, import.meta.url), 'utf8'));
export const readText = name => readFileSync(new URL('../data/' + name, import.meta.url), 'utf8');

// То же, что в браузере делает fetch: содержимое data/decks.json и data/progress-sm2.json.
export const loadLegacy = async () => ({ decks: readJSON('decks.json'), progress: readJSON('progress-sm2.json') });
