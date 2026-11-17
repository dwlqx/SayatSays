// Колоды: дерево, счётчики, очередь занятия, поля карточек и импорт новых колод. Модуль без DOM — его проверяют тесты.
//
// Почти все функции получают S — состояние приложения в памяти:
//   S.decks    { [id колоды]: { id, name, type, parent, order, cards: [...] } }
//   S.prog     { [id колоды]: { [id карточки]: запись cardState { deck, card, fsrs, sm2?, k? } } }
//   S.days     { [номер дня]: { n, done, nw: { [id колоды]: сколько новых карточек взято } } }
//   S.settings { newPerDay, goal, streak, retention }

import { isNew, isLearning, isLearned, isDue } from './scheduler.js';
import { t } from './i18n.js';

export const DECK_TYPES = ['kz', 'kzru', 'en', 'qa'];
export const typeOf = d => (d && DECK_TYPES.includes(d.type)) ? d.type : 'qa';

// Случайный id для новой колоды или карточки: префикс + время + случайные символы.
export function uid36(p) { return p + Date.now().toString(36) + Math.random().toString(36).slice(2, 6); }

// Подколоды. pid = null — колоды верхнего уровня (и те, чей родитель пропал).
export function childrenOf(decks, pid) {
  return Object.values(decks)
    .filter(d => pid ? d.parent === pid : (!d.parent || !decks[d.parent]))
    .filter(d => d.id !== pid)
    .sort((a, b) => ((a.order || 0) - (b.order || 0)) || String(a.name).localeCompare(String(b.name), 'ru'));
}

// Колода и все её подколоды на любой глубине. seen защищает от «колоды внутри самой себя».
export function descendants(decks, id, seen = new Set()) {
  if (seen.has(id)) return [];
  seen.add(id);
  const out = [id];
  for (const k of childrenOf(decks, id)) out.push(...descendants(decks, k.id, seen));
  return out;
}

// Сколько новых карточек из колоды ещё можно взять сегодня.
export function newLeft(S, deckId, today) {
  const day = S.days[today];
  const used = (day && day.nw && day.nw[deckId]) || 0;
  return Math.max(0, (S.settings.newPerDay | 0) - used);
}

// Расписание карточки (поле fsrs записи) или undefined, если карточку ещё не показывали.
export const fsrsOf = (S, deckId, cardId) => { const r = (S.prog[deckId] || {})[cardId]; return r && r.fsrs; };

// Счётчики для экрана: всего, новые, изучаются, выучено и сколько карточек на сегодня.
export function deckCounts(S, id, withKids, today) {
  const ids = withKids ? descendants(S.decks, id) : [id];
  const c = { total: 0, nw: 0, learning: 0, learned: 0, today: 0 };
  for (const x of ids) {
    const d = S.decks[x]; if (!d) continue;
    let fresh = 0;
    for (const card of (d.cards || [])) {
      c.total++;
      const e = fsrsOf(S, x, card.id);
      if (isNew(e)) { c.nw++; fresh++; }
      else {
        if (isLearned(e)) c.learned++; else c.learning++;
        if (isDue(e, today)) c.today++;
      }
    }
    c.today += Math.min(fresh, newLeft(S, x, today));
  }
  return c;
}

// Сколько карточек на сегодня во всех колодах: число на кнопке «Повторить всё» и на иконке приложения.
// Такое же число считает sw.js для напоминания (тест tests/push.test.js проверяет, что они совпадают).
export function todayTotal(S, today) {
  let n = 0;
  for (const id in S.decks) n += deckCounts(S, id, false, today).today;
  return n;
}

function shuffle(a, random) {
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(random() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

// Очередь занятия: сначала изучаемые (по сроку), потом повторения вперемешку с новыми — три к одной.
export function buildQueue(S, ids, today, random = Math.random) {
  const learn = [], rev = [], fresh = [];
  for (const id of ids) {
    const d = S.decks[id]; if (!d) continue;
    let left = newLeft(S, id, today);
    for (const card of (d.cards || [])) {
      const e = fsrsOf(S, id, card.id);
      if (isNew(e)) { if (left > 0) { fresh.push({ deck: id, card: card.id }); left--; } }
      else if (!isDue(e, today)) continue;
      else if (isLearning(e)) learn.push({ deck: id, card: card.id, due: e.due });
      else rev.push({ deck: id, card: card.id });
    }
  }
  learn.sort((a, b) => a.due - b.due);
  shuffle(rev, random);
  const mixed = [];
  let i = 0, j = 0;
  while (i < rev.length || j < fresh.length) {
    for (let k = 0; k < 3 && i < rev.length; k++) mixed.push(rev[i++]);
    if (j < fresh.length) mixed.push(fresh[j++]);
  }
  return learn.map(x => ({ deck: x.deck, card: x.card })).concat(mixed);
}

/* ---------- поля карточек ---------- */

// Какие поля у карточек каждого типа: need — обязательные, opt — необязательные.
// У английских карточек ещё список предложений sentences.
export const CARD_FIELDS = {
  kz: { need: ['ru', 'kz'], opt: ['note'] },
  kzru: { need: ['kz', 'ru'], opt: ['note'] },
  en: { need: ['word'], opt: ['ipa', 'ru', 'def'] },
  qa: { need: ['q', 'a'], opt: [] }
};
const FIELD_NAMES = {
  ru: 'по-русски (ru)', kz: 'қазақша (kz)', note: 'заметка (note)', word: 'слово (word)', ipa: 'транскрипция (ipa)',
  def: 'пояснение (def)', q: 'вопрос (q)', a: 'ответ (a)'
};
const isText = v => typeof v === 'string' && v.trim() !== '';

// Есть ли в предложении пропуск: слово в {фигурных скобках} или само слово (так его ищет карточка).
export const hasGap = (sentence, word) => /\{[^}]+\}/.test(sentence) || sentence.toLowerCase().includes(String(word).toLowerCase());

// Что не так с карточкой — текст для человека (и для Claude, если карточку сделал он) или null, если всё хорошо.
export function cardProblem(type, card) {
  const f = CARD_FIELDS[type];
  for (const k of f.need) if (!isText(card[k])) return t('не заполнено поле «{field}»', { field: t(FIELD_NAMES[k]) });
  for (const k of f.opt) if (card[k] != null && typeof card[k] !== 'string') return t('поле «{field}» должно быть текстом', { field: t(FIELD_NAMES[k]) });
  if (type === 'en') {
    const ss = card.sentences;
    if (ss != null && (!Array.isArray(ss) || ss.some(x => typeof x !== 'string'))) return t('sentences должно быть списком предложений');
    const list = (ss || []).filter(isText);
    if (!list.length && !isText(card.def) && !isText(card.ru)) return t('нужно хотя бы одно предложение, пояснение (def) или перевод (ru)');
    const bad = list.find(x => !hasGap(x, card.word));
    if (bad) return t('в предложении «{s}» нет слова «{word}» — возьми его в {фигурные скобки}', { s: bad, word: card.word });
  }
  return null;
}

// Короткая подпись карточки для сообщений: первое заполненное обязательное поле.
export function cardLabel(type, card) {
  const k = CARD_FIELDS[type].need.find(n => isText(card[n]));
  const s = k ? card[k].trim() : '';
  return s.length > 40 ? s.slice(0, 39) + '…' : s;
}

// Карточка из полей формы. value(имя поля) — текст из поля. Пробелы по краям убираются, пустые необязательные
// поля не сохраняются, предложения — по одному на строку. id не ставится: его добавляет тот, кто сохраняет.
export function cardFromForm(type, value) {
  const f = CARD_FIELDS[type], card = {};
  for (const k of [...f.need, ...f.opt]) { const v = String(value(k) || '').trim(); if (v) card[k] = v; }
  if (type === 'en') card.sentences = String(value('sentences') || '').split('\n').map(x => x.trim()).filter(Boolean);
  return card;
}

// Колода с исправленной карточкой. id карточки не меняется, поэтому прогресс по ней сохраняется.
// Поля, которых нет в форме (например, добавленные Claude сверх формата), тоже не теряются.
export function updateCard(deck, cardId, card) {
  const f = CARD_FIELDS[typeOf(deck)];
  return {
    ...deck,
    cards: (deck.cards || []).map(c => {
      if (c.id !== cardId) return c;
      const next = { ...c };
      for (const k of [...f.need, ...f.opt, 'sentences']) delete next[k];
      return { ...next, ...card, id: cardId };
    })
  };
}

// Можно ли положить колоду id внутрь колоды parent (null — на верхний уровень).
// Нельзя внутрь самой себя и внутрь своих же подколод — получился бы круг.
export function canMove(decks, id, parent) {
  if (!parent) return true;
  return !!decks[parent] && !descendants(decks, id).includes(parent);
}

/* ---------- импорт колод из файла ---------- */

// Разбирает текст файла с колодами. Понимает три вида:
//   { "decks": [ … ] } — как data/decks.json;   [ … ] — просто список колод;   { "id": …, "cards": [ … ] } — одна колода.
// Если что-то не так — бросает ошибку с понятным текстом.
export function parseDeckFile(text) {
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error(t('Не получается прочитать: это не JSON.')); }
  if (json && json.app === 'SayatSays') throw new Error(t('Это резервная копия, а не колоды. Её открывают кнопкой «Восстановить из копии».'));
  const list = Array.isArray(json) ? json
    : (json && Array.isArray(json.decks)) ? json.decks
    : (json && typeof json.id === 'string' && Array.isArray(json.cards)) ? [json]
    : null;
  if (!list) throw new Error(t('Колод не нашлось. Нужен файл в формате decks.json: { "decks": [ … ] }.'));
  if (!list.length) throw new Error(t('В файле нет ни одной колоды.'));
  list.forEach((d, i) => {
    const where = (d && typeof d.name === 'string' && d.name) ? t('Колода «{deck}»', { deck: d.name }) : t('Колода №{n}', { n: i + 1 });
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(where + ': ' + t('это не колода.'));
    if (typeof d.id !== 'string' || !d.id.trim()) throw new Error(where + ': ' + t('нет id.'));
    if (typeof d.name !== 'string' || !d.name.trim()) throw new Error(where + ': ' + t('нет названия (name).'));
    if (!DECK_TYPES.includes(d.type)) throw new Error(where + ': ' + t('неизвестный тип «{type}». Бывают: {types}.', { type: d.type, types: DECK_TYPES.join(', ') }));
    if (d.cards != null && !Array.isArray(d.cards)) throw new Error(where + ': ' + t('cards должно быть списком.'));
    (d.cards || []).forEach((c, j) => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(where + ': ' + t('карточка №{n} — не объект.', { n: j + 1 }));
      const problem = cardProblem(d.type, c);
      if (problem) {
        const label = cardLabel(d.type, c);
        throw new Error(where + ', ' + (label ? t('карточка №{n} («{label}»)', { n: j + 1, label }) : t('карточка №{n}', { n: j + 1 })) + ': ' + problem + '.');
      }
    });
  });
  return list;
}

// id для карточки без id: короткий «отпечаток» её содержимого (хэш FNV-1a).
// Одинаковые карточки получают одинаковый id, поэтому повторный импорт того же файла их не задвоит.
export function contentId(card) {
  const s = JSON.stringify(Object.keys(card).sort().map(k => [k, card[k]]));
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) { h ^= s.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; }
  return 'h' + h.toString(36);
}

// Содержимое карточки без id — по нему узнаём одинаковые карточки с разными id.
const sameContent = c => { const { id, ...rest } = c; return contentId(rest); };

// Добавляет колоды из файла к текущим.
//   — Колоды с новым id добавляются целиком. Если указанного родителя (parent) нет ни в приложении,
//     ни в файле, колода ложится на верхний уровень.
//   — В колоду с уже существующим id добавляются только новые карточки: с новым id и с новым содержимым
//     (карточка, которая слово в слово уже есть, пропускается). Название, тип, место и старые карточки
//     не меняются, прогресс (он хранится отдельно) не трогается.
//   — Если у существующей колоды другой тип, бросает ошибку: поля карточек у типов разные.
// Возвращает { decks: все колоды после слияния, changed: колоды, которые надо сохранить, addedDecks, addedCards,
//   details: по каждой колоде из файла { id, name, isNew, parent, added, skipped } — чтобы показать до добавления }.
export function mergeDecks(current, incoming) {
  const next = { ...current };
  const changed = new Map(), details = [];
  const inFile = new Set(incoming.map(d => d.id));
  let addedDecks = 0, addedCards = 0;
  let maxOrder = Object.values(next).reduce((m, d) => Math.max(m, d.order || 0), 0);
  for (const raw of incoming) {
    const cards = (raw.cards || []).map(c => (c.id != null && c.id !== '') ? { ...c, id: String(c.id) } : { ...c, id: contentId(c) });
    const cur = next[raw.id];
    if (cur && typeOf(cur) !== raw.type) {
      throw new Error(t('Колода «{deck}» (id {id}) уже есть, и у неё тип {type}, а в тексте — {other}. Карточки другого типа в неё не добавить: поменяй тип или придумай новой колоде другой id.',
        { deck: cur.name, id: cur.id, type: typeOf(cur), other: raw.type }));
    }
    const parentOk = raw.parent && raw.parent !== raw.id && (current[raw.parent] || inFile.has(raw.parent));
    const base = cur || { ...raw, parent: parentOk ? raw.parent : null, order: raw.order != null ? raw.order : ++maxOrder, cards: [] };
    const have = new Set((base.cards || []).map(c => c.id));
    const haveContent = new Set((base.cards || []).map(sameContent));
    const fresh = [];
    let skipped = 0;
    for (const c of cards) {
      const key = sameContent(c);
      if (have.has(c.id) || haveContent.has(key)) { skipped++; continue; }
      have.add(c.id); haveContent.add(key); fresh.push(c);
    }
    if (!cur) addedDecks++;
    if (!cur || fresh.length) {
      const d = { ...base, cards: (base.cards || []).concat(fresh) };
      next[d.id] = d;
      changed.set(d.id, d);
      addedCards += fresh.length;
    }
    details.push({ id: raw.id, name: next[raw.id].name, isNew: !cur, parent: next[raw.id].parent || null, added: fresh.length, skipped });
  }
  return { decks: next, changed: [...changed.values()], addedDecks, addedCards, details };
}
