// Колоды: дерево, счётчики, очередь занятия и импорт новых колод. Модуль без DOM — его проверяют тесты.
//
// Почти все функции получают S — состояние приложения в памяти:
//   S.decks    { [id колоды]: { id, name, type, parent, order, cards: [...] } }
//   S.prog     { [id колоды]: { [id карточки]: запись cardState { deck, card, fsrs, sm2?, k? } } }
//   S.days     { [номер дня]: { n, done, nw: { [id колоды]: сколько новых карточек взято } } }
//   S.settings { newPerDay, goal, streak, retention }

import { isNew, isLearning, isLearned, isDue } from './scheduler.js';

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

/* ---------- импорт колод из файла ---------- */

// Разбирает текст файла с колодами. Понимает три вида:
//   { "decks": [ … ] } — как data/decks.json;   [ … ] — просто список колод;   { "id": …, "cards": [ … ] } — одна колода.
// Если что-то не так — бросает ошибку с понятным текстом.
export function parseDeckFile(text) {
  let json;
  try { json = JSON.parse(text); } catch (e) { throw new Error('Файл не читается: это не JSON.'); }
  if (json && json.app === 'SayatSays') throw new Error('Это резервная копия, а не колоды. Её открывают кнопкой «Восстановить из копии».');
  const list = Array.isArray(json) ? json
    : (json && Array.isArray(json.decks)) ? json.decks
    : (json && typeof json.id === 'string' && Array.isArray(json.cards)) ? [json]
    : null;
  if (!list) throw new Error('Колод не нашлось. Нужен файл в формате decks.json: { "decks": [ … ] }.');
  if (!list.length) throw new Error('В файле нет ни одной колоды.');
  list.forEach((d, i) => {
    const where = (d && typeof d.name === 'string' && d.name) ? 'Колода «' + d.name + '»' : 'Колода №' + (i + 1);
    if (!d || typeof d !== 'object' || Array.isArray(d)) throw new Error(where + ': это не колода.');
    if (typeof d.id !== 'string' || !d.id.trim()) throw new Error(where + ': нет id.');
    if (typeof d.name !== 'string' || !d.name.trim()) throw new Error(where + ': нет названия (name).');
    if (!DECK_TYPES.includes(d.type)) throw new Error(where + ': неизвестный тип «' + d.type + '». Бывают: ' + DECK_TYPES.join(', ') + '.');
    if (d.cards != null && !Array.isArray(d.cards)) throw new Error(where + ': cards должно быть списком.');
    (d.cards || []).forEach((c, j) => {
      if (!c || typeof c !== 'object' || Array.isArray(c)) throw new Error(where + ': карточка №' + (j + 1) + ' — не объект.');
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

// Добавляет колоды из файла к текущим.
//   — Колоды с новым id добавляются целиком.
//   — В колоду с уже существующим id добавляются только карточки с новыми id.
//     Название, тип, место и старые карточки не меняются, прогресс (он хранится отдельно) не трогается.
// Возвращает { decks: все колоды после слияния, changed: колоды, которые надо сохранить, addedDecks, addedCards }.
export function mergeDecks(current, incoming) {
  const next = { ...current };
  const changed = new Map();
  let addedDecks = 0, addedCards = 0;
  let maxOrder = Object.values(next).reduce((m, d) => Math.max(m, d.order || 0), 0);
  for (const raw of incoming) {
    const cards = (raw.cards || []).map(c => (c.id != null && c.id !== '') ? { ...c, id: String(c.id) } : { ...c, id: contentId(c) });
    const cur = next[raw.id];
    const base = cur || { ...raw, parent: raw.parent || null, order: raw.order != null ? raw.order : ++maxOrder, cards: [] };
    const have = new Set((base.cards || []).map(c => c.id));
    const fresh = [];
    for (const c of cards) if (!have.has(c.id)) { have.add(c.id); fresh.push(c); }
    if (!cur) addedDecks++;
    if (!cur || fresh.length) {
      const d = { ...base, cards: (base.cards || []).concat(fresh) };
      next[d.id] = d;
      changed.set(d.id, d);
      addedCards += fresh.length;
    }
  }
  return { decks: next, changed: [...changed.values()], addedDecks, addedCards };
}
