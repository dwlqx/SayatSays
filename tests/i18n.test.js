// Английский интерфейс: у каждого текста есть перевод, подстановки и числа работают, язык выбирается правильно.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { t, count, word, setLang, getLang, systemLang, locale, EN, WORDS } from '../js/i18n.js';
import { THEMES } from '../js/themes.js';
import { formatInterval } from '../js/scheduler.js';
import { claudeInstructions, parsePasted } from '../js/claude.js';
import { cardProblem, parseDeckFile } from '../js/decks.js';
import { legacyState } from './helpers.js';
import { dayStart } from '../js/streak.js';

const FILES = ['app', 'claude', 'decks', 'backup', 'push', 'migrate', 'db', 'scheduler'].map(n => 'js/' + n + '.js');
const read = f => readFileSync(new URL('../' + f, import.meta.url), 'utf8');
// Код без строк-комментариев: в комментариях тоже бывает t('…'), это не тексты интерфейса.
const code = f => read(f).split('\n').filter(l => !/^\s*\/\//.test(l)).join('\n');
const literals = (src, re) => [...src.matchAll(re)].map(m => m[1]);

// Все тексты интерфейса: t('…') в коде и подписи, которые переводятся через t(переменная).
function usedKeys() {
  const keys = new Set();
  for (const f of FILES) for (const k of literals(code(f), /\bt\('((?:[^'\\]|\\.)*)'/g)) keys.add(k);
  const app = code('js/app.js'), decks = code('js/decks.js'), claude = code('js/claude.js');
  for (const k of literals(app, /\blabel: '([^']+)'/g)) keys.add(k);                                   // типы колод, кнопки ответа
  for (const k of literals(decks.slice(decks.indexOf('FIELD_NAMES'), decks.indexOf('const isText')), /: '([^']+)'/g)) keys.add(k);
  for (const k of literals(claude.slice(claude.indexOf('TYPE_HELP'), claude.indexOf('// Дерево колод')), /: '([^']+)'/g)) keys.add(k);
  for (const th of THEMES) keys.add(th.name);
  return keys;
}

test('у каждого текста интерфейса есть английский перевод', () => {
  const keys = usedKeys();
  assert.ok(keys.size > 250, 'нашлись тексты: ' + keys.size);
  const missing = [...keys].filter(k => EN[k] == null);
  assert.deepEqual(missing, [], 'добавь перевод в EN в js/i18n.js');
});

test('в словаре нет лишних переводов (с опечатками в ключе или для удалённых текстов)', () => {
  const keys = usedKeys();
  assert.deepEqual(Object.keys(EN).filter(k => !keys.has(k)), []);
});

test('подстановки {…} в переводе те же, что в русском тексте', () => {
  const names = s => [...s.matchAll(/\{(\w+)\}/g)].map(m => m[1]).sort().join(',');
  for (const [ru, en] of Object.entries(EN)) assert.equal(names(en), names(ru), ru);
});

test('числа со словом: русские формы и английские', () => {
  for (const f of FILES) {
    for (const k of literals(code(f), /\b(?:count|word)\([^,]+,\s*'([^']+)'/g)) assert.ok(WORDS[k], 'нет английских форм для «' + k + '» в WORDS');
  }
  setLang('ru');
  assert.deepEqual([1, 2, 5, 11, 21, 22, 111].map(n => count(n, 'карточка', 'карточки', 'карточек')),
    ['1 карточка', '2 карточки', '5 карточек', '11 карточек', '21 карточка', '22 карточки', '111 карточек']);
  setLang('en');
  assert.deepEqual([1, 2, 21].map(n => count(n, 'карточка', 'карточки', 'карточек')), ['1 card', '2 cards', '21 cards']);
  assert.equal(word(1, 'день', 'дня', 'дней'), 'day');
  setLang('ru');
});

test('t(): перевод, подстановки, русский по умолчанию', () => {
  setLang('ru');
  assert.equal(getLang(), 'ru');
  assert.equal(t('Сегодня {n} из {goal} ответов.', { n: 3, goal: 10 }), 'Сегодня 3 из 10 ответов.');
  assert.equal(locale(), 'ru-RU');
  setLang('en');
  assert.equal(t('Сегодня {n} из {goal} ответов.', { n: 3, goal: 10 }), 'Today 3 of 10 answers.');
  assert.equal(t('Текст, которого нет в словаре'), 'Текст, которого нет в словаре', 'нет перевода — русский текст');
  assert.equal(t('Добавлено: {decks}, {cards}.', { decks: '1 deck' }), 'Added: 1 deck, {cards}.', 'неизвестная подстановка остаётся как есть');
  assert.equal(locale(), 'en-GB');
  assert.equal(formatInterval(10 * 60e3), '10 min');
  assert.equal(formatInterval(4 * 864e5), '4 d');
  setLang('fr');
  assert.equal(getLang(), 'ru', 'незнакомый язык — русский');
});

test('язык «как на телефоне»', () => {
  assert.equal(systemLang(['ru-RU', 'en-US']), 'ru');
  assert.equal(systemLang(['kk-KZ']), 'ru', 'казахский телефон — русский интерфейс (казахского пока нет)');
  assert.equal(systemLang(['uk']), 'ru');
  assert.equal(systemLang(['en-US', 'ru-RU']), 'en');
  assert.equal(systemLang(['de-DE']), 'en');
  assert.equal(systemLang([]), 'en');
});

test('ошибки и инструкция для Claude — тоже по-английски, а формат тот же', async () => {
  setLang('en');
  try {
    assert.equal(cardProblem('kz', { ru: 'город' }), 'the field “Kazakh (kz)” is empty');
    assert.throws(() => parseDeckFile('{oops'), /Can’t read it: this isn’t JSON\./);
    const S = await legacyState(dayStart(20773) + 8 * 3600e3);
    const text = claudeInstructions(S.decks, 'kz-lex-verbs');
    assert.match(text, /^Make flashcards for my app SayatSays/);
    assert.match(text, /My decks now/);
    assert.match(text, /Now I need new cards for the deck “Глаголы” \(id "kz-lex-verbs", type "kz" — Russian → Kazakh\)/);
    // Пример в английской инструкции тоже проходит проверку приложения.
    assert.equal(parsePasted(text.slice(text.indexOf('Example reply:')))[0].id, 'kz-qala');
  } finally {
    setLang('ru');
  }
});
