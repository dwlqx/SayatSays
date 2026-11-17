// Колоды от Claude. Сам Claude в приложение ничего записать не может: данные лежат только на телефоне.
// Поэтому перенос идёт через буфер обмена:
//   1. «Скопировать инструкцию для Claude» — текст для чата: формат карточек и список твоих колод (claudeInstructions).
//   2. Claude отвечает блоком JSON. Копируешь ответ, в приложении — «Вставить от Claude».
//   3. Приложение достаёт из ответа JSON (parsePasted), проверяет каждую карточку и показывает, что добавится.
// Модуль без DOM — его проверяют тесты (tests/claude.test.js). Инструкция — на языке интерфейса (t() из i18n.js),
// а формат и примеры в ней одинаковые на любом языке.

import { parseDeckFile, typeOf, childrenOf, cardLabel } from './decks.js';
import { t } from './i18n.js';

// Блоки кода из ответа Claude: ```json … ```. Язык после ``` может быть любым или не быть совсем.
const CODE_BLOCK = /```[^\n`]*\n?([\s\S]*?)```/g;

// Из текста — JSON от первой { или [ до последней } или ].
function jsonPart(text) {
  const start = text.search(/[[{]/), end = Math.max(text.lastIndexOf('}'), text.lastIndexOf(']'));
  return start >= 0 && end > start ? text.slice(start, end + 1) : null;
}

// Разбирает вставленный ответ Claude и возвращает список колод (как parseDeckFile).
// Понимает: один или несколько блоков ```json, голый JSON, JSON с текстом до и после.
// Неразрывные пробелы (иногда появляются при копировании) заменяет обычными.
export function parsePasted(text) {
  const s = String(text || '').replace(/ /g, ' ').trim();
  if (!s) throw new Error(t('Поле пустое: вставь сюда ответ Claude.'));
  const blocks = [...s.matchAll(CODE_BLOCK)].map(m => m[1].trim()).filter(b => /[[{]/.test(b));
  const parts = (blocks.length ? blocks : [s]).map(jsonPart);
  if (parts.some(p => !p)) throw new Error(t('В тексте не нашлось колод: нужен JSON, который начинается с { и заканчивается }.'));
  const list = [];
  parts.forEach((p, i) => {
    try { list.push(...parseDeckFile(p)); }
    catch (e) { throw new Error((parts.length > 1 ? t('Блок №{n}', { n: i + 1 }) + ': ' : '') + e.message); }
  });
  return list;
}

const TYPE_HELP = {
  kz: 'русский → казахский',
  kzru: 'казахский → русский',
  en: 'английский, слово в предложении',
  qa: 'вопрос и ответ'
};

// Дерево колод строками: «- id — «название» — тип, N карточек», подколоды с отступом.
function deckLines(decks) {
  const out = [];
  const walk = (pid, depth) => {
    if (depth > 5) return;
    for (const d of childrenOf(decks, pid)) {
      const n = (d.cards || []).length;
      out.push('  '.repeat(depth) + '- ' + d.id + ' — ' + t('«{deck}»', { deck: d.name }) + ' — ' + typeOf(d) + ', ' + t('карточек: {n}', { n }));
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0);
  return out;
}

// Текст для чата с Claude: что от него нужно, формат, пример и список колод.
// targetId — колода, для которой нужны карточки (кнопка на экране колоды): тогда в тексте есть её карточки,
// чтобы Claude не повторял то, что уже есть.
export function claudeInstructions(decks, targetId = null) {
  const target = targetId && decks[targetId];
  const L = [];
  L.push(t('Сделай карточки для моего приложения SayatSays (интервальное повторение).'));
  L.push(t('Ответь одним блоком кода ```json. Внутри — только JSON, без комментариев.'));
  L.push('');
  L.push(t('Формат: {"decks": [колода, …]}'));
  L.push(t('Колода: {"id": "…", "name": "…", "type": "…", "parent": "…", "cards": [карточка, …]}'));
  L.push(t('- id колоды — латиница, цифры и дефис, например "kz-qala". Новой колоде дай id, которого нет в списке ниже.'));
  L.push(t('- Чтобы добавить карточки в мою колоду, возьми её id, name и type из списка и положи в cards только новые карточки.'));
  L.push(t('- parent — id колоды, внутрь которой положить новую колоду; null — на верхний уровень.'));
  L.push(t('- id карточкам не нужны: приложение сделает их само.'));
  L.push('');
  L.push(t('Типы колод (type) и поля карточек:'));
  L.push(t('- "kz" — русский → казахский: {"ru": "город", "kz": "қала"}. Можно добавить "note" — короткую подсказку.'));
  L.push(t('- "kzru" — казахский → русский, поля те же: {"kz": "қала", "ru": "город"}.'));
  L.push(t('- "en" — английское слово, на карточке предложение с пропуском:'));
  L.push('  {"word": "stubborn", "ipa": "/ˈstʌbən/", "ru": "упрямый", "def": "unwilling to change your opinion",');
  L.push('   "sentences": ["He was too {stubborn} to say sorry.", "She is {stubborn} about small things."]}');
  L.push(t('  В каждом предложении слово (в нужной форме) — в {фигурных скобках}. Предложений 2–3, def — по-английски.'));
  L.push(t('- "qa" — вопрос и ответ по любому предмету: {"q": "…", "a": "…"}.'));
  L.push('');
  L.push(t('Казахские буквы пиши правильно: ә, ғ, қ, ң, ө, ұ, ү, һ, і.'));
  L.push('');
  L.push(t('Пример ответа:'));
  L.push('```json');
  L.push('{"decks": [{"id": "kz-qala", "name": "Қала", "type": "kz", "parent": null, "cards": [');
  L.push('  {"ru": "город", "kz": "қала"},');
  L.push('  {"ru": "улица", "kz": "көше"}');
  L.push(']}]}');
  L.push('```');
  L.push('');
  const lines = deckLines(decks);
  L.push(lines.length ? t('Мои колоды сейчас (id — название — тип):') : t('Колод у меня пока нет.'));
  L.push(...lines);
  if (target) {
    const type = typeOf(target);
    L.push('');
    L.push(t('Сейчас нужны новые карточки в колоду «{deck}» (id "{id}", type "{type}" — {help}).', { deck: target.name, id: target.id, type, help: t(TYPE_HELP[type]) }));
    const have = (target.cards || []).map(c => cardLabel(type, c)).filter(Boolean);
    if (have.length) L.push(t('В ней уже есть, не повторяй: {list}.', { list: have.join('; ') }));
  }
  L.push('');
  L.push(t('Что сделать — напишу ниже.'));
  return L.join('\n');
}
