// Поля карточек, исправление карточек, перенос колод и безопасный импорт.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyState, readText } from './helpers.js';
import { cardProblem, cardFromForm, updateCard, canMove, mergeDecks, parseDeckFile, contentId, deckCounts } from '../js/decks.js';
import { dayStart, dayIndex } from '../js/streak.js';

const NOW = dayStart(20773) + 8 * 3600e3;

test('все карточки из data/decks.json проходят проверку', () => {
  for (const d of parseDeckFile(readText('decks.json'))) {
    for (const c of d.cards) assert.equal(cardProblem(d.type, c), null, d.id + '/' + c.id);
  }
});

test('проверка карточки по типу', () => {
  assert.equal(cardProblem('kz', { ru: 'город', kz: 'қала' }), null);
  assert.match(cardProblem('kz', { ru: 'город', kz: '  ' }), /қазақша/);
  assert.match(cardProblem('kzru', { kz: 'қала', ru: 'город', note: 5 }), /заметка \(note\)» должно быть текстом/);
  assert.match(cardProblem('qa', { q: 'Вопрос' }), /ответ \(a\)/);
  assert.equal(cardProblem('en', { word: 'integer', sentences: ['−3 and 7 are {integers}.'] }), null, 'форма слова в скобках');
  assert.equal(cardProblem('en', { word: 'integer', sentences: ['An integer has no fraction.'] }), null, 'слово без скобок тоже находится');
  assert.equal(cardProblem('en', { word: 'stubborn', ru: 'упрямый' }), null, 'без предложений, но с переводом');
});

test('карточка из формы: пробелы убираются, пустое не сохраняется, предложения по строкам', () => {
  const form = { word: ' stubborn ', ipa: '', ru: 'упрямый', def: '', sentences: ' He is {stubborn}. \n\n She was {stubborn} too.\n' };
  assert.deepEqual(cardFromForm('en', k => form[k]),
    { word: 'stubborn', ru: 'упрямый', sentences: ['He is {stubborn}.', 'She was {stubborn} too.'] });
  assert.deepEqual(cardFromForm('kz', k => ({ ru: 'город ', kz: ' қала', note: ' ' })[k]), { ru: 'город', kz: 'қала' });
});

test('исправление карточки: тот же id и прогресс, пропавшие поля удаляются, чужие поля остаются', async () => {
  const S = await legacyState(NOW);
  const d = S.decks['kz-lex-edu'];
  const withNote = d.cards.find(c => c.note);
  const fixed = updateCard({ ...d, cards: d.cards.map(c => c === withNote ? { ...c, extra: 'от Claude' } : c) },
    withNote.id, { ru: 'образование', kz: 'білім беру' });
  const c = fixed.cards.find(x => x.id === withNote.id);
  assert.deepEqual(c, { id: withNote.id, ru: 'образование', kz: 'білім беру', extra: 'от Claude' });
  assert.equal(fixed.cards.length, d.cards.length);
  assert.deepEqual(fixed.cards.filter(x => x.id !== withNote.id), d.cards.filter(x => x.id !== withNote.id));
  // Прогресс хранится отдельно по id карточки — счётчики колоды не меняются.
  const before = deckCounts(S, 'kz-lex-edu', false, dayIndex(NOW));
  S.decks = { ...S.decks, 'kz-lex-edu': fixed };
  assert.deepEqual(deckCounts(S, 'kz-lex-edu', false, dayIndex(NOW)), before);
});

test('перенос колоды: можно куда угодно, кроме себя и своих подколод', async () => {
  const S = await legacyState(NOW);
  assert.ok(canMove(S.decks, 'kz-lex-verbs', null));
  assert.ok(canMove(S.decks, 'kz-lex-verbs', 'en'));
  assert.ok(!canMove(S.decks, 'kz-lex', 'kz-lex'));
  assert.ok(!canMove(S.decks, 'kz', 'kz-lex-verbs'), 'внутрь своей подколоды — круг');
  assert.ok(!canMove(S.decks, 'kz-lex', 'нет-такой'));
});

test('импорт: другой тип у существующей колоды — ошибка, ничего не меняется', async () => {
  const S = await legacyState(NOW);
  assert.throws(() => mergeDecks(S.decks, [{ id: 'kz-lex-verbs', name: 'Глаголы', type: 'qa', cards: [{ q: '?', a: '!' }] }]),
    /уже есть, и у неё тип kz, а в тексте — qa/);
});

test('импорт: неизвестный родитель — на верхний уровень; родитель из того же файла — внутрь', async () => {
  const S = await legacyState(NOW);
  const r = mergeDecks(S.decks, [
    { id: 'a', name: 'A', type: 'qa', parent: 'нет-такой', cards: [] },
    { id: 'b', name: 'B', type: 'qa', parent: 'b', cards: [] },
    { id: 'c', name: 'C', type: 'qa', parent: 'd', cards: [] },
    { id: 'd', name: 'D', type: 'qa', parent: 'kz', cards: [] }
  ]);
  assert.deepEqual(['a', 'b', 'c', 'd'].map(id => r.decks[id].parent), [null, null, 'd', 'kz']);
});

test('импорт: та же карточка с другим id не задваивается; подробности для показа', async () => {
  const S = await legacyState(NOW);
  const verbs = S.decks['kz-lex-verbs'];
  const old = verbs.cards[0];
  const r = mergeDecks(S.decks, [
    { id: 'kz-lex-verbs', name: 'что угодно', type: 'kz', cards: [{ ru: old.ru, kz: old.kz }, { ru: 'прыгать', kz: 'секіру' }, { ru: 'прыгать', kz: 'секіру' }] },
    { id: 'new', name: 'Новая', type: 'qa', parent: 'kz', cards: [{ q: '1', a: '1' }] },
    { id: 'kz-lex-edu', name: 'Образование', type: 'kz', cards: [] }
  ]);
  assert.deepEqual(r.details, [
    { id: 'kz-lex-verbs', name: verbs.name, isNew: false, parent: 'kz-lex', added: 1, skipped: 2 },
    { id: 'new', name: 'Новая', isNew: true, parent: 'kz', added: 1, skipped: 0 },
    { id: 'kz-lex-edu', name: S.decks['kz-lex-edu'].name, isNew: false, parent: 'kz-lex', added: 0, skipped: 0 }
  ]);
  assert.equal(r.decks['kz-lex-verbs'].cards.at(-1).id, contentId({ ru: 'прыгать', kz: 'секіру' }));
  assert.deepEqual(r.changed.map(d => d.id), ['kz-lex-verbs', 'new']);
});
