// Колоды: импорт из файла, счётчики и очередь.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { freshDB, loadLegacy, readText } from './helpers.js';
import { legacyToRecords, seedIfNeeded } from '../js/migrate.js';
import { parseDeckFile, mergeDecks, contentId, descendants, deckCounts, buildQueue } from '../js/decks.js';

// Состояние S, как его собирает app.js после чтения базы.
async function legacyState(settings = { newPerDay: 15, goal: 10, streak: true }) {
  const { decks, progress } = await loadLegacy();
  const rec = legacyToRecords(decks, progress);
  const S = { decks: {}, prog: {}, days: {}, settings };
  for (const d of rec.decks) S.decks[d.id] = d;
  for (const r of rec.cardState) (S.prog[r.deck] || (S.prog[r.deck] = {}))[r.card] = r.sm2;
  for (const d of rec.stats) S.days[d.day] = d;
  return S;
}

test('файл колод: понимает три вида и объясняет ошибки', () => {
  assert.equal(parseDeckFile(readText('decks.json')).length, 13);
  const one = { id: 'x', name: 'Икс', type: 'qa', cards: [{ id: 'c1', q: '?', a: '!' }] };
  assert.equal(parseDeckFile(JSON.stringify([one])).length, 1);
  assert.equal(parseDeckFile(JSON.stringify(one)).length, 1);
  assert.throws(() => parseDeckFile('{oops'), /не JSON/);
  assert.throws(() => parseDeckFile('{"app":"SayatSays","format":1,"data":{}}'), /резервная копия/);
  assert.throws(() => parseDeckFile(JSON.stringify([{ ...one, type: 'de' }])), /неизвестный тип «de»/);
  assert.throws(() => parseDeckFile(JSON.stringify([{ ...one, id: '' }])), /нет id/);
  assert.throws(() => parseDeckFile('{"decks":[]}'), /нет ни одной колоды/);
});

test('импорт: новая колода целиком, в существующую — только новые карточки', async () => {
  const S = await legacyState();
  const verbs = S.decks['kz-lex-verbs'];
  const incoming = [
    { id: 'new-deck', name: 'Новая', type: 'qa', cards: [{ id: 'q1', q: '1', a: '1' }, { id: 'q2', q: '2', a: '2' }] },
    { id: 'kz-lex-verbs', name: 'Другое имя', type: 'kz', cards: [
      { ...verbs.cards[0], kz: 'изменено' },        // уже есть — не трогаем
      { id: 'verbs-new', ru: 'прыгать', kz: 'секіру' } // новая
    ] }
  ];
  const r = mergeDecks(S.decks, incoming);
  assert.equal(r.addedDecks, 1);
  assert.equal(r.addedCards, 3);
  assert.equal(r.changed.length, 2);
  const v = r.decks['kz-lex-verbs'];
  assert.equal(v.name, verbs.name, 'название не меняется');
  assert.equal(v.cards.length, verbs.cards.length + 1);
  assert.deepEqual(v.cards[0], verbs.cards[0], 'старая карточка не меняется');
  assert.equal(S.decks['kz-lex-verbs'], verbs, 'исходный объект не изменён');

  const again = mergeDecks(r.decks, incoming);
  assert.equal(again.changed.length, 0, 'повторный импорт ничего не добавляет');
});

test('карточки без id получают id по содержимому и не задваиваются', () => {
  const file = [{ id: 'd', name: 'Д', type: 'qa', cards: [{ q: 'a', a: 'b' }, { q: 'c', a: 'd' }] }];
  const r1 = mergeDecks({}, file);
  assert.equal(r1.addedCards, 2);
  assert.equal(r1.decks.d.cards[0].id, contentId({ q: 'a', a: 'b' }));
  assert.equal(mergeDecks(r1.decks, file).changed.length, 0);
});

test('импорт через базу не трогает прогресс', async () => {
  const db = await freshDB();
  await seedIfNeeded(db, loadLegacy);
  const statesBefore = await db.getAll('cardState');
  const current = Object.fromEntries((await db.getAll('decks')).map(d => [d.id, d]));
  const { decks } = await loadLegacy();
  const file = decks.decks.map(d => d.id === 'kz-exam-gram' ? { ...d, cards: [...d.cards, { id: 'extra', kz: 'жаңа', ru: 'новый' }] } : d);
  const r = mergeDecks(current, file);
  assert.equal(r.addedCards, 1);
  await db.write(['decks'], s => r.changed.forEach(d => s.decks.put(d)));
  assert.deepEqual(await db.getAll('cardState'), statesBefore);
  assert.equal((await db.get('decks', 'kz-exam-gram')).cards.length, 25);
  db.close();
});

test('счётчики колод на исходных данных', async () => {
  const S = await legacyState();
  // «Казахский» + 3 подколоды, одна из которых («Лексика») содержит ещё 6
  assert.equal(descendants(S.decks, 'kz').length, 10);
  const kz = deckCounts(S, 'kz', true, 20734), en = deckCounts(S, 'en', true, 20734);
  assert.equal(kz.total, 177);
  assert.equal(en.total, 65);
  assert.equal(kz.nw + kz.learning + kz.learned + en.nw + en.learning + en.learned, 242);
  assert.equal(242 - kz.nw - en.nw, 80, 'с прогрессом — 80 карточек');
});

test('очередь: изучаемые первыми, новых не больше лимита на колоду', async () => {
  const S = await legacyState();
  const today = 20740;
  const q = buildQueue(S, ['kz-lex-verbs'], today, () => 0.5);
  assert.equal(q.length, 15, 'в колоде 18 новых карточек, лимит 15');
  S.days[today] = { day: today, n: 10, done: true, nw: { 'kz-lex-verbs': 10 } };
  assert.equal(buildQueue(S, ['kz-lex-verbs'], today, () => 0.5).length, 5);

  const learning = Object.entries(S.prog['en-nuet-ct']).filter(([, e]) => e.s === 1).map(([id]) => id);
  const q2 = buildQueue(S, ['en-nuet-ct'], today, () => 0.5);
  assert.deepEqual(q2.slice(0, learning.length).map(x => x.card).sort(), learning.sort());
});
