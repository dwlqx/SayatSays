// Колоды от Claude: разбор вставленного ответа и инструкция для чата.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyState } from './helpers.js';
import { parsePasted, claudeInstructions } from '../js/claude.js';
import { mergeDecks } from '../js/decks.js';
import { dayStart } from '../js/streak.js';

const NOW = dayStart(20773) + 8 * 3600e3;
const deck = { id: 'kz-qala', name: 'Қала', type: 'kz', parent: 'kz-lex', cards: [{ ru: 'город', kz: 'қала' }, { ru: 'улица', kz: 'көше' }] };
const json = JSON.stringify({ decks: [deck] }, null, 2);

test('ответ Claude: JSON находится в блоке кода, без блока и среди текста', () => {
  const variants = [
    json,
    '```json\n' + json + '\n```',
    'Вот колода «Қала»:\n\n```json\n' + json + '\n```\n\nЕсли нужно больше карточек — скажи!',
    'Готово, вот JSON: ' + json + ' — вставляй.',
    '```\n' + json + '\n```',
    json.replace(/ {2}/g, '  ') // неразрывные пробелы после копирования
  ];
  for (const v of variants) {
    const list = parsePasted(v);
    assert.equal(list.length, 1);
    assert.equal(list[0].id, 'kz-qala');
    assert.equal(list[0].cards.length, 2);
  }
  // Несколько блоков — колоды из всех.
  const two = '```json\n' + json + '\n```\nИ ещё одна:\n```json\n' +
    JSON.stringify({ id: 'qa-bio', name: 'Биология', type: 'qa', cards: [{ q: 'Клетка?', a: 'Единица жизни' }] }) + '\n```';
  assert.deepEqual(parsePasted(two).map(d => d.id), ['kz-qala', 'qa-bio']);
});

test('ответ Claude: понятные ошибки, по которым Claude может исправиться', () => {
  assert.throws(() => parsePasted('   '), /Поле пустое/);
  assert.throws(() => parsePasted('Извини, не могу помочь.'), /не нашлось колод/);
  assert.throws(() => parsePasted('```json\n{"decks": [ {"id": "x" }\n```'), /не JSON/); // Claude оборвал ответ
  const bad = c => JSON.stringify({ decks: [{ ...deck, cards: [{ ru: 'город', kz: 'қала' }, c] }] });
  assert.throws(() => parsePasted(bad({ ru: 'улица' })), /Колода «Қала», карточка №2 \(«улица»\): не заполнено поле «қазақша \(kz\)»/);
  const en = c => JSON.stringify({ id: 'en-x', name: 'Words', type: 'en', cards: [c] });
  assert.throws(() => parsePasted(en({ word: 'stubborn', sentences: ['He was too proud to say sorry.'] })),
    /в предложении «He was too proud to say sorry\.» нет слова «stubborn» — возьми его в \{фигурные скобки\}/);
  assert.throws(() => parsePasted(en({ word: 'stubborn' })), /хотя бы одно предложение/);
  assert.throws(() => parsePasted(en({ word: 'stubborn', ru: 'упрямый', sentences: 'He is {stubborn}.' })), /списком предложений/);
  // Вторая колода с ошибкой в отдельном блоке — номер блока в сообщении.
  assert.throws(() => parsePasted('```json\n' + json + '\n```\n```json\n{"id":"q","name":"Q","type":"qa","cards":[{"q":"?"}]}\n```'),
    /Блок №2: Колода «Q», карточка №1 \(«\?»\): не заполнено поле «ответ \(a\)»/);
});

test('инструкция для Claude: формат, список колод, пример проходит проверку', async () => {
  const S = await legacyState(NOW);
  const text = claudeInstructions(S.decks);
  for (const t of ['"kz"', '"kzru"', '"en"', '"qa"', '{фигурных скобках}', 'ә, ғ, қ, ң, ө, ұ, ү, һ, і']) assert.ok(text.includes(t), 'есть ' + t);
  // Все колоды — с id и типом; подколоды — с отступом.
  for (const d of Object.values(S.decks)) assert.ok(text.includes('- ' + d.id + ' — «' + d.name + '» — ' + d.type), d.id);
  assert.match(text, /\n {4}- kz-lex-verbs — «/, 'подколода второго уровня — с отступом в 4 пробела');
  // Пример из инструкции приложение примет — сама инструкция не учит Claude неправильному формату.
  const example = parsePasted(text.slice(text.indexOf('Пример ответа:')));
  assert.equal(example[0].id, 'kz-qala');
  assert.equal(mergeDecks(S.decks, example).addedCards, 2);
  assert.ok(!text.includes('В ней уже есть'), 'без колоды — без списка её карточек');
});

test('инструкция для одной колоды: её id и карточки, которые уже есть', async () => {
  const S = await legacyState(NOW);
  const verbs = S.decks['kz-lex-verbs'];
  const text = claudeInstructions(S.decks, 'kz-lex-verbs');
  assert.ok(text.includes('в колоду «' + verbs.name + '» (id "kz-lex-verbs", type "kz" — русский → казахский)'));
  for (const c of verbs.cards) assert.ok(text.includes(c.ru), 'уже есть: ' + c.ru);
  assert.match(claudeInstructions({}), /Колод у меня пока нет/);
});
