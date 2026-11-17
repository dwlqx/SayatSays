// Первый запуск: исходные данные из артефакта попадают в базу без потерь.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDB, loadLegacy } from './helpers.js';
import { seedIfNeeded, migrateToFsrs } from '../js/migrate.js';
import { streakInfo } from '../js/streak.js';

test('первый запуск: 13 колод, 242 карточки, 80 карточек с прогрессом', async () => {
  const db = await freshDB();
  assert.equal(await seedIfNeeded(db, loadLegacy), true);
  const decks = await db.getAll('decks');
  assert.equal(decks.length, 13);
  assert.equal(decks.reduce((n, d) => n + d.cards.length, 0), 242);
  assert.equal((await db.getAll('cardState')).length, 80);
  assert.equal((await db.getAll('reviewLog')).length, 0); // журнал начнём писать в задаче 3
  const meta = await db.get('settings', 'meta');
  assert.ok(meta.seededAt > 0);
  db.close();
});

test('колоды и прогресс SM-2 переносятся как есть', async () => {
  const db = await freshDB();
  await seedIfNeeded(db, loadLegacy);
  const { decks, progress } = await loadLegacy();
  for (const d of decks.decks) assert.deepEqual(await db.get('decks', d.id), d, 'колода ' + d.id);
  for (const [deck, p] of Object.entries(progress.progress)) {
    for (const [card, sm2] of Object.entries(p.cards)) {
      const rec = await db.get('cardState', [deck, card]);
      assert.deepEqual(rec, { deck, card, sm2 }, deck + '/' + card);
    }
  }
  db.close();
});

test('статистика дней, счётчики новых карточек и серия сохраняются', async () => {
  const db = await freshDB();
  await seedIfNeeded(db, loadLegacy);
  const { progress } = await loadLegacy();
  const days = Object.fromEntries((await db.getAll('stats')).map(d => [d.day, d]));

  const src = progress.stats.days;
  assert.deepEqual(Object.keys(days).sort(), Object.keys(src).sort());
  for (const k of Object.keys(src)) {
    assert.equal(days[k].n, src[k].n, 'день ' + k);
    assert.equal(days[k].done, src[k].done, 'день ' + k);
  }
  // nd из артефакта (сколько новых карточек колоды взято в тот день) теперь лежит в записи дня
  for (const [deck, p] of Object.entries(progress.progress)) {
    if (p.nd) assert.equal(days[p.nd.day].nw[deck], p.nd.n, 'nd колоды ' + deck);
  }
  // Серия считается так же, как считал артефакт:
  // 8 октября (день 20734) — 1 день: 5–7 октября пропущены, а заморозок на неделе две.
  assert.equal(streakInfo(days, 20734).streak, 1);
  // 24 сентября (день 20724) — 2 дня подряд.
  assert.equal(streakInfo(days, 20724).streak, 2);
  db.close();
});

test('второй запуск ничего не загружает, даже если все колоды удалены', async () => {
  const db = await freshDB();
  await seedIfNeeded(db, loadLegacy);
  await db.deleteDecks((await db.getAll('decks')).map(d => d.id));
  assert.equal((await db.getAll('decks')).length, 0);
  assert.equal((await db.getAll('cardState')).length, 0, 'вместе с колодами удаляется и прогресс');
  assert.equal(await seedIfNeeded(db, loadLegacy), false);
  assert.equal((await db.getAll('decks')).length, 0);
  db.close();
});

test('первый запуск у нового человека: колоды есть, чужого прогресса и дней нет', async () => {
  const db = await freshDB();
  const onlyDecks = async () => ({ decks: (await loadLegacy()).decks, progress: null }); // как loadStarterDecks в app.js
  assert.equal(await seedIfNeeded(db, onlyDecks), true);
  assert.equal((await db.getAll('decks')).length, 13);
  assert.equal((await db.getAll('cardState')).length, 0);
  assert.equal((await db.getAll('stats')).length, 0);
  assert.equal(streakInfo({}).streak, 0);
  // Переводить на FSRS нечего — и снимка «до FSRS» нет, кнопки «Скачать копию до перехода на FSRS» не будет.
  assert.equal(await migrateToFsrs(db), 0);
  assert.equal(await db.get('snapshots', 'before-fsrs'), undefined);
  db.close();
});
