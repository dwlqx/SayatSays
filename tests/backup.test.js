// Резервная копия: «копия → восстановление» ничего не теряет.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDB, loadLegacy, readText } from './helpers.js';
import { seedIfNeeded } from '../js/migrate.js';
import { makeBackup, parseBackup, dataForRestore, backupFileName } from '../js/backup.js';

const EXPORTED = Date.UTC(2026, 9, 11, 10, 0);

test('копия → восстановление в другую базу → те же данные', async () => {
  const a = await freshDB();
  await seedIfNeeded(a, loadLegacy);
  // Добавляем по записи в каждое хранилище, чтобы проверить все пять.
  await a.write(['settings', 'reviewLog', 'cardState', 'stats'], s => {
    s.settings.put({ key: 'prefs', newPerDay: 20, goal: 12, streak: false });
    s.reviewLog.put({ deck: 'kz-lex-verbs', card: 'c1', good: true, ts: 1 });
    s.reviewLog.put({ deck: 'kz-lex-verbs', card: 'c1', good: false, ts: 2 });
    s.cardState.put({ deck: 'kz-lex-verbs', card: 'c1', sm2: { s: 1, st: 0, ts: 5, t: 4 } });
    s.stats.put({ day: 20737, n: 3, done: false, nw: { 'kz-lex-verbs': 1 } });
  });
  const before = await a.exportAll();
  const text = JSON.stringify(makeBackup(before, EXPORTED), null, 2);

  // В базе, куда восстанавливаем, уже есть свои данные — после восстановления их быть не должно.
  const b = await freshDB();
  await seedIfNeeded(b, loadLegacy);
  await b.write(['decks', 'reviewLog'], s => {
    s.decks.put({ id: 'junk', name: 'Лишняя', type: 'qa', cards: [] });
    s.reviewLog.put({ deck: 'junk', card: 'x', good: true, ts: 9 });
  });
  await b.replaceAll(dataForRestore(parseBackup(text)));
  const after = await b.exportAll();

  for (const name of ['decks', 'cardState', 'reviewLog', 'stats']) assert.deepEqual(after[name], before[name], name);
  const get = (data, key) => data.settings.find(s => s.key === key);
  assert.deepEqual(get(after, 'prefs'), get(before, 'prefs'));
  // В служебной записи меняется только «последняя копия»: теперь это копия, из которой восстановились.
  assert.deepEqual(get(after, 'meta'), { ...get(before, 'meta'), lastBackupAt: EXPORTED });
  assert.equal(after.settings.length, before.settings.length);

  a.close(); b.close();
});

test('копия копии совпадает с первой копией', async () => {
  const a = await freshDB();
  await seedIfNeeded(a, loadLegacy);
  const first = JSON.stringify(makeBackup(await a.exportAll(), EXPORTED));
  const b = await freshDB();
  await b.replaceAll(parseBackup(first).data);
  const second = JSON.stringify(makeBackup(await b.exportAll(), EXPORTED));
  assert.equal(second, first);
  a.close(); b.close();
});

test('чужие и испорченные файлы не принимаются', () => {
  assert.throws(() => parseBackup('не json'), /не JSON/);
  assert.throws(() => parseBackup(readText('decks.json')), /файл с колодами/);
  assert.throws(() => parseBackup('{"app":"Другое","format":1,"data":{}}'), /не резервная копия/);
  assert.throws(() => parseBackup('{"app":"SayatSays","format":2,"data":{}}'), /более новой версией/);
  assert.throws(() => parseBackup('{"app":"SayatSays","format":1,"data":{"decks":[]}}'), /нет раздела/);
  const broken = { app: 'SayatSays', format: 1, data: { decks: [{ name: 'без id', cards: [] }], cardState: [], reviewLog: [], settings: [], stats: [] } };
  assert.throws(() => parseBackup(JSON.stringify(broken)), /ошибка в разделе «decks»/);
});

test('имя файла копии содержит дату', () => {
  assert.equal(backupFileName(new Date(2026, 9, 5, 12, 0).getTime()), 'sayatsays-backup-2026-10-05.json');
});
