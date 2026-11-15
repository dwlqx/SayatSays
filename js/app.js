// Интерфейс приложения: экраны, листы, учёба. Перенесён из legacy/zapomni-artifact.html.
// Расписание, серия дней, колоды, база и резервные копии — в отдельных модулях без DOM.
//
// Как устроено хранение: при запуске всё (кроме журнала) читается из базы в объект S в памяти,
// интерфейс рисуется из S. Каждое изменение сразу меняет S и записывается в базу.

import { openDB } from './db.js';
import { seedIfNeeded } from './migrate.js';
import { makeBackup, backupFileName, parseBackup, dataForRestore } from './backup.js';
import { dayIndex, weekOf, streakInfo } from './streak.js';
import { review, isNew } from './scheduler.js';
import { typeOf, uid36, childrenOf, descendants, deckCounts, buildQueue, parseDeckFile, mergeDecks } from './decks.js';

/* ---------- helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
function plural(n, a, b, c) { const m = Math.abs(n) % 100, k = m % 10; if (m > 10 && m < 20) return c; if (k > 1 && k < 5) return b; if (k === 1) return a; return c; }
let toastTimer = null;
function toast(msg) { const t = $('#toast'); t.textContent = msg; t.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => t.classList.remove('on'), 3200); }

const ICON = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
};

/* ---------- model ---------- */
const TYPES = {
  kz: { label: 'Казахский: русский → казахский', color: 'var(--kz)' },
  kzru: { label: 'Казахский: казахский → русский', color: 'var(--kz)' },
  en: { label: 'Английский: предложение с пропуском', color: 'var(--en)' },
  qa: { label: 'Предмет: вопрос и ответ', color: 'var(--qa)' }
};
const colorOf = d => TYPES[typeOf(d)].color;
const DEFAULT_SETTINGS = { newPerDay: 15, goal: 10, streak: true };

// Состояние в памяти. Что лежит в decks, prog, days и settings — см. начало decks.js.
const S = {
  db: null,
  decks: {}, prog: {}, days: {}, settings: { ...DEFAULT_SETTINGS }, meta: { key: 'meta' },
  ready: false, error: null,
  view: { name: 'home' }, session: null
};

/* ---------- storage ---------- */
// Прочитать всё из базы в S (журнал ответов не нужен для экранов — его не читаем).
async function loadAll() {
  const [decks, cardState, stats, settings] = await Promise.all(['decks', 'cardState', 'stats', 'settings'].map(n => S.db.getAll(n)));
  S.decks = {};
  for (const d of decks) S.decks[d.id] = d;
  S.prog = {};
  for (const r of cardState) (S.prog[r.deck] || (S.prog[r.deck] = {}))[r.card] = r.sm2;
  S.days = {};
  for (const d of stats) S.days[d.day] = d;
  const prefs = settings.find(s => s.key === 'prefs') || {};
  S.settings = { ...DEFAULT_SETTINGS, newPerDay: prefs.newPerDay ?? DEFAULT_SETTINGS.newPerDay, goal: prefs.goal ?? DEFAULT_SETTINGS.goal, streak: prefs.streak ?? DEFAULT_SETTINGS.streak };
  S.meta = settings.find(s => s.key === 'meta') || { key: 'meta' };
}

// Запись в базу идёт в фоне: S уже обновлён и экран нарисован. Если запись не удалась — говорим об этом.
function saved(promise) {
  return promise.catch(e => { console.error(e); toast('Не удалось сохранить на устройстве: ' + ((e && e.message) || e)); });
}
function putDeck(d) { S.decks = { ...S.decks, [d.id]: d }; return saved(S.db.write(['decks'], s => s.decks.put(d))); }
function putDay(rec) { S.days[rec.day] = rec; return saved(S.db.write(['stats'], s => s.stats.put(rec))); }

async function loadLegacyFiles() {
  const get = async url => {
    const r = await fetch(url);
    if (!r.ok) throw new Error('Не удалось загрузить ' + url + ' (ошибка ' + r.status + ').');
    return r.json();
  };
  const [decks, progress] = await Promise.all([get('./data/decks.json'), get('./data/progress-sm2.json')]);
  return { decks, progress };
}

async function init() {
  render();
  try {
    S.db = await openDB();
    const seeded = await seedIfNeeded(S.db, loadLegacyFiles);
    // Просим браузер не удалять данные при нехватке места. Браузер может и отказать — это не ошибка.
    if (seeded && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    await loadAll();
    S.ready = true;
  } catch (e) {
    console.error(e);
    S.error = (e && e.message) || String(e);
  }
  render();
}

/* ---------- rendering ---------- */
function render() {
  const app = $('#app');
  if (!S.ready) {
    app.className = '';
    app.innerHTML = S.error
      ? '<header class="top"><h1 class="brand">SayatSays</h1></header><div class="empty"><p>Не получилось открыть данные.</p><p>' + esc(S.error) + '</p></div>'
      : '<div class="empty"><p>Загружаю…</p></div>';
    return;
  }
  const v = S.view;
  app.className = v.name === 'study' ? 'is-study' : '';
  if (v.name === 'deck' && !S.decks[v.id]) S.view = { name: 'home' };
  if (S.view.name === 'home') { app.innerHTML = homeHTML(); if (maybeAutoDone()) app.innerHTML = homeHTML(); }
  else if (S.view.name === 'deck') app.innerHTML = deckHTML(S.view.id);
  else if (S.view.name === 'study') renderStudy();
}

function streakHTML() {
  const today = dayIndex(), st = streakInfo(S.days, today);
  if (!S.settings.streak) return '<p class="today-only">Сегодня ответов: <b>' + st.todayN + '</b></p>';
  const mon = weekOf(today) * 7 - 3, L = ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];
  const N = ['понедельник', 'вторник', 'среда', 'четверг', 'пятница', 'суббота', 'воскресенье'];
  const cells = L.map((l, i) => {
    const d = mon + i; let c, t;
    if (S.days[d] && S.days[d].done) { c = 'done'; t = 'занимался'; }
    else if (st.frozen.has(d)) { c = 'frozen'; t = 'заморозка'; }
    else if (d === today) { c = 'today'; t = 'сегодня'; }
    else if (d > today) { c = 'future'; t = 'впереди'; }
    else { c = 'miss'; t = 'пропуск'; }
    return '<i class="' + c + '" title="' + N[i] + ': ' + t + '">' + l + '</i>';
  }).join('');
  const goal = S.settings.goal;
  const line = st.todayDone ? 'Сегодня засчитано.' : 'Сегодня ' + st.todayN + ' из ' + goal + ' ответов.';
  return '<section class="streak"><div class="snum">' + st.streak + '</div><div><div class="slabel">' +
    plural(st.streak, 'день', 'дня', 'дней') + ' подряд</div><div class="week">' + cells + '</div></div>' +
    '<p class="sline">' + line + ' Заморозок на этой неделе осталось: ' + st.freezesLeft + '.</p></section>';
}

function rowsHTML(pid, depth) {
  if (depth > 5) return '';
  const today = dayIndex();
  return childrenOf(S.decks, pid).map(d => {
    const c = deckCounts(S, d.id, true, today);
    return '<li><button class="deck-row d' + Math.min(depth, 2) + '" data-act="open-deck" data-id="' + esc(d.id) + '" style="--c:' + colorOf(d) + '">' +
      '<span class="sw"></span><span><span class="nm">' + esc(d.name) + '</span><span class="mt">выучено ' + c.learned + ' из ' + c.total + '</span></span>' +
      '<span class="due' + (c.today ? '' : ' zero') + '" aria-label="на сегодня ' + c.today + '">' + c.today + '</span></button></li>' + rowsHTML(d.id, depth + 1);
  }).join('');
}

function homeHTML() {
  const ids = Object.keys(S.decks), today = dayIndex();
  let all = 0;
  for (const id of ids) all += deckCounts(S, id, false, today).today;
  let h = '<header class="top"><h1 class="brand">SayatSays</h1><button class="icon-btn" data-act="settings" aria-label="Настройки">' + ICON.gear + '</button></header>';
  h += streakHTML();
  if (!ids.length) {
    h += '<div class="empty"><p>Колод пока нет.</p><p>Попроси Claude в чате колоду в формате decks.json и добавь её: Настройки → Данные → «Импортировать колоды».</p>' +
      '<button class="link" style="padding-left:0" data-act="add-deck">Создать колоду самому</button></div>';
    return h;
  }
  h += '<button class="primary" data-act="study-all"' + (all ? '' : ' disabled') + '><span>' + (all ? 'Повторить всё' : 'На сегодня всё повторено') + '</span>' + (all ? '<span class="pill">' + all + '</span>' : '') + '</button>';
  h += '<div class="sec"><h2>Колоды</h2><button class="link" data-act="add-deck">Новая колода</button></div>';
  h += '<ul class="decks">' + rowsHTML(null, 0) + '</ul>';
  return h;
}

function cardSummary(type, c) {
  if (type === 'kz') return [c.ru, c.kz];
  if (type === 'kzru') return [c.kz, c.ru];
  if (type === 'en') return [c.word, [c.ru, c.def].filter(Boolean).join('; ')];
  return [c.q, c.a];
}

function deckHTML(id) {
  const d = S.decks[id], t = typeOf(d), c = deckCounts(S, id, true, dayIndex()), kids = childrenOf(S.decks, id);
  const parent = d.parent && S.decks[d.parent];
  const tot = c.total || 1;
  let h = '<div style="--c:' + colorOf(d) + '">';
  h += '<button class="back-btn" data-act="' + (parent ? 'open-deck' : 'home') + '"' + (parent ? ' data-id="' + esc(parent.id) + '"' : '') + '>' + ICON.back + (parent ? esc(parent.name) : 'Колоды') + '</button>';
  h += '<h1 class="deck-h">' + esc(d.name) + '</h1><p class="deck-type">' + TYPES[t].label + '</p>';
  h += '<div class="stack" aria-hidden="true"><span style="flex:' + c.nw / tot + '"></span><span class="s-learn" style="flex:' + c.learning / tot + '"></span><span class="s-done" style="flex:' + c.learned / tot + '"></span></div>';
  h += '<div class="legend"><div><b>' + c.nw + '</b><span><i class="k" style="background:var(--line)"></i>новые</span></div>' +
       '<div><b>' + c.learning + '</b><span><i class="k" style="background:color-mix(in srgb, var(--c) 40%, var(--line))"></i>изучаются</span></div>' +
       '<div><b>' + c.learned + '</b><span><i class="k" style="background:var(--c)"></i>выучено</span></div>' +
       '<div><b>' + c.total + '</b><span>всего</span></div></div>';
  h += '<button class="primary" data-act="study-deck" data-id="' + esc(id) + '"' + (c.today ? '' : ' disabled') + '><span>' + (c.today ? 'Учить' : 'На сегодня всё') + '</span>' + (c.today ? '<span class="pill">' + c.today + '</span>' : '') + '</button>';
  h += '<div class="sec"><h2>Подколоды</h2><button class="link" data-act="add-deck" data-parent="' + esc(id) + '">Добавить</button></div>';
  h += kids.length ? '<ul class="decks">' + rowsHTML(id, 1) + '</ul>' : '<p class="note">Нет подколод.</p>';
  const cards = d.cards || [];
  if (cards.length || !kids.length) {
    h += '<div class="sec"><h2>Карточки<span class="cnt">' + cards.length + '</span></h2><button class="link" data-act="add-card" data-id="' + esc(id) + '">Добавить</button></div>';
    if (!cards.length) h += '<p class="note">Карточек пока нет. Добавь сам или попроси Claude в чате карточки для «' + esc(d.name) + '» и импортируй их в настройках.</p>';
    else h += '<ul class="cards">' + cards.map(card => {
      const s = cardSummary(t, card);
      return '<li><div><div class="f">' + esc(s[0]) + '</div><div class="b">' + esc(s[1]) + '</div></div>' +
        '<button class="del" data-act="del-card" data-deck="' + esc(id) + '" data-card="' + esc(card.id) + '" aria-label="Удалить карточку">' + ICON.trash + '</button></li>';
    }).join('') + '</ul>';
  }
  h += '<button class="danger" data-act="del-deck" data-id="' + esc(id) + '">Удалить колоду</button>';
  return h + '</div>';
}

function cloze(s, word, mode) {
  s = String(s || ''); const m = s.match(/\{([^}]+)\}/); let pre, ans, post;
  if (m) { pre = s.slice(0, m.index); ans = m[1]; post = s.slice(m.index + m[0].length); }
  else {
    const i = word ? s.toLowerCase().indexOf(String(word).toLowerCase()) : -1;
    if (i < 0) return esc(s);
    pre = s.slice(0, i); ans = s.slice(i, i + String(word).length); post = s.slice(i + String(word).length);
  }
  const mid = mode === 'gap' ? '<span class="gap" role="img" aria-label="пропуск"></span>' : '<mark>' + esc(ans) + '</mark>';
  return esc(pre.replace(/[{}]/g, '')) + mid + esc(post.replace(/[{}]/g, ''));
}

function facesHTML(deck, card, e) {
  const t = typeOf(deck), tag = '<div class="tag">' + esc(deck.name) + '</div>';
  let f, b;
  if (t === 'kz' || t === 'kzru') {
    const q = t === 'kz' ? card.ru : card.kz, a = t === 'kz' ? card.kz : card.ru;
    f = '<div class="word">' + esc(q) + '</div><div class="prompt">' + (t === 'kz' ? 'Қазақша?' : 'По-русски?') + '</div>';
    b = '<p class="small-q c">' + esc(q) + '</p><div class="word">' + esc(a) + '</div>' + (card.note ? '<div class="prompt">' + esc(card.note) + '</div>' : '');
  } else if (t === 'en') {
    const ss = (card.sentences || []).filter(Boolean), k = (e && e.k) || 0;
    const s = ss.length ? ss[k % ss.length] : '', s2 = ss.length > 1 ? ss[(k + 1) % ss.length] : '';
    f = s ? '<p class="sentence">' + cloze(s, card.word, 'gap') + (card.def ? ' <span class="hint">(' + esc(card.def) + ')</span>' : '') + '</p>'
          : '<p class="sentence hint">' + esc(card.def || card.ru || '') + '</p>';
    b = '<div class="word">' + esc(card.word) + '</div>' + (card.ipa ? '<div class="ipa">' + esc(card.ipa) + '</div>' : '') +
        (card.ru ? '<div class="tr">' + esc(card.ru) + '</div>' : '') +
        (s ? '<p class="sentence fill">' + cloze(s, card.word, 'fill') + '</p>' : '') +
        (s2 ? '<p class="sentence alt">' + cloze(s2, card.word, 'fill') + '</p>' : '');
  } else {
    f = '<div class="qa-q">' + esc(card.q) + '</div>';
    b = '<p class="small-q">' + esc(card.q) + '</p><div class="qa-a">' + esc(card.a) + '</div>';
  }
  return '<div class="face front">' + tag + '<div class="body">' + f + '</div></div><div class="face back" aria-hidden="true">' + tag + '<div class="body">' + b + '</div></div>';
}

function actionsHTML() {
  return S.session.flipped
    ? '<button class="btn-big bad" data-act="bad">Не знал</button><button class="btn-big good" data-act="good">Знал</button>'
    : '<button class="btn-big show" data-act="flip">Показать ответ</button>';
}

function renderStudy() {
  const ses = S.session, app = $('#app');
  if (!ses) { S.view = { name: 'home' }; return render(); }
  let item = ses.queue[0], deck, card;
  while (item) {
    deck = S.decks[item.deck]; card = deck && (deck.cards || []).find(c => c.id === item.card);
    if (card) break;
    ses.queue.shift(); item = ses.queue[0];
  }
  if (!item) { app.innerHTML = doneHTML(); return; }
  const total = ses.done + ses.queue.length, pct = total ? Math.round(ses.done / total * 100) : 0;
  app.innerHTML = '<div class="study" style="--c:' + colorOf(deck) + '">' +
    '<div class="sbar"><button class="icon-btn" data-act="close" aria-label="Закончить">' + ICON.close + '</button>' +
    '<div class="pbar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><div style="width:' + pct + '%"></div></div>' +
    '<span class="left" title="осталось">' + ses.queue.length + '</span>' +
    '<button class="icon-btn" data-act="undo" aria-label="Отменить последний ответ"' + (ses.undo ? '' : ' disabled') + '>' + ICON.undo + '</button></div>' +
    '<div class="stage"><div class="swipe enter"><div class="card3d' + (ses.flipped ? ' flipped' : '') + '" data-act="flip">' + facesHTML(deck, card, (S.prog[item.deck] || {})[card.id]) + '</div></div></div>' +
    '<div class="actions">' + actionsHTML() + '</div>' +
    '<p class="hint-keys">Пробел — перевернуть, 1 — не знал, 2 — знал</p></div>';
  bindSwipe();
}

function doneHTML() {
  const ses = S.session, st = streakInfo(S.days);
  let h = '<div class="finished">';
  if (!ses.done) { h += '<h1>На сегодня всё</h1><p>Карточек к повторению нет. Загляни завтра.</p>'; }
  else {
    h += '<h1>Готово</h1><p>Ответов: ' + ses.done + ', из них «знал»: ' + ses.good + '.</p>';
    if (S.settings.streak) h += '<p>' + (st.todayDone ? 'День засчитан. Серия: ' + st.streak + ' ' + plural(st.streak, 'день', 'дня', 'дней') + '.' : 'До зачёта дня осталось ' + Math.max(0, S.settings.goal - st.todayN) + ' ответов.') + '</p>';
  }
  return h + '<button class="primary" data-act="finish">На главную</button></div>';
}

/* ---------- study logic ---------- */
function startStudy(ids, from) {
  const q = buildQueue(S, ids, dayIndex());
  S.session = { queue: q, done: 0, good: 0, flipped: false, undo: null, from: from };
  S.view = { name: 'study' }; render(); window.scrollTo(0, 0);
}
function endStudy() {
  const from = S.session && S.session.from;
  S.session = null;
  S.view = from && from.name === 'deck' && S.decks[from.id] ? from : { name: 'home' };
  render(); window.scrollTo(0, 0);
}
function flip() {
  const ses = S.session; if (!ses || !ses.queue.length) return;
  ses.flipped = !ses.flipped;
  const c = $('.card3d'); if (c) c.classList.toggle('flipped', ses.flipped);
  const fr = $('.face.front'), bk = $('.face.back');
  if (fr && bk) { fr.setAttribute('aria-hidden', ses.flipped ? 'true' : 'false'); bk.setAttribute('aria-hidden', ses.flipped ? 'false' : 'true'); }
  const a = $('.actions'); if (a) a.innerHTML = actionsHTML();
}
function answer(good) {
  const ses = S.session; if (!ses || !ses.flipped) return;
  const item = ses.queue[0]; if (!item) return;
  const today = dayIndex(), now = Date.now();
  const prog = S.prog[item.deck] || (S.prog[item.deck] = {});
  const prev = prog[item.card] || null, prevDay = S.days[today] || null;
  // Запоминаем, как было, — для кнопки «Отменить».
  ses.undo = { item, prev, prevDay, today, queue: ses.queue.slice(), done: ses.done, good: ses.good };

  const { next, requeue } = review(prev, good, { now, today, isEn: typeOf(S.decks[item.deck]) === 'en' });
  prog[item.card] = next;
  ses.queue.shift();
  if (requeue >= 0) ses.queue.splice(Math.min(requeue, ses.queue.length), 0, item);
  ses.done++; if (good) ses.good++;

  // Статистика дня: ещё один ответ; если карточка была новой — ещё одна новая из этой колоды.
  const day = { day: today, n: 0, done: false, ...prevDay };
  day.n++;
  if (isNew(prev)) day.nw = { ...day.nw, [item.deck]: ((day.nw && day.nw[item.deck]) || 0) + 1 };
  if (day.n >= S.settings.goal || !ses.queue.length) day.done = true;
  S.days[today] = day;

  saved(S.db.write(['cardState', 'stats'], s => {
    s.cardState.put({ deck: item.deck, card: item.card, sm2: next });
    s.stats.put(day);
  }));
  ses.flipped = false; renderStudy();
}
function undo() {
  const ses = S.session, u = ses && ses.undo; if (!u) return;
  const { deck, card } = u.item;
  const prog = S.prog[deck] || (S.prog[deck] = {});
  if (u.prev) prog[card] = u.prev; else delete prog[card];
  if (u.prevDay) S.days[u.today] = u.prevDay; else delete S.days[u.today];
  ses.queue = u.queue; ses.done = u.done; ses.good = u.good; ses.undo = null; ses.flipped = false;
  saved(S.db.write(['cardState', 'stats'], s => {
    if (u.prev) s.cardState.put({ deck, card, sm2: u.prev }); else s.cardState.delete([deck, card]);
    if (u.prevDay) s.stats.put(u.prevDay); else s.stats.delete(u.today);
  }));
  renderStudy();
}
// Если на сегодня повторять нечего — день засчитывается сам. Возвращает true, если засчитали.
function maybeAutoDone() {
  const today = dayIndex(), d = S.days[today]; if (d && d.done) return false;
  let total = 0, due = 0;
  for (const id in S.decks) { const c = deckCounts(S, id, false, today); total += c.total; due += c.today; }
  if (total > 0 && due === 0) { putDay({ day: today, n: 0, ...d, done: true }); return true; }
  return false;
}

let suppressClick = false;
function bindSwipe() {
  const sw = $('.swipe'); if (!sw) return;
  sw.addEventListener('animationend', () => sw.classList.remove('enter'), { once: true });
  let x0 = 0, y0 = 0, dx = 0, active = false, horiz = false;
  sw.addEventListener('pointerdown', ev => { if (!S.session || !S.session.flipped) return; x0 = ev.clientX; y0 = ev.clientY; dx = 0; active = true; horiz = false; });
  sw.addEventListener('pointermove', ev => {
    if (!active) return; const mx = ev.clientX - x0, my = ev.clientY - y0;
    if (!horiz) { if (Math.abs(mx) > 12 && Math.abs(mx) > Math.abs(my)) horiz = true; else if (Math.abs(my) > 12) { active = false; return; } else return; }
    dx = mx; sw.style.transition = 'none'; sw.style.transform = 'translateX(' + dx + 'px) rotate(' + (dx / 28) + 'deg)';
    sw.dataset.dir = dx > 50 ? 'good' : dx < -50 ? 'bad' : '';
  });
  const end = () => {
    if (!active) return; active = false; sw.style.transition = '';
    if (horiz) { suppressClick = true; setTimeout(() => { suppressClick = false; }, 350); }
    if (horiz && Math.abs(dx) > 90) answer(dx > 0);
    else { sw.style.transform = ''; sw.dataset.dir = ''; }
  };
  sw.addEventListener('pointerup', end); sw.addEventListener('pointercancel', end);
}

/* ---------- sheets ---------- */
function openSheet(html, onSubmit) {
  const el = $('#sheet');
  el.innerHTML = '<div class="sheet-wrap" data-close="1"><form class="sheet" novalidate>' + html + '</form></div>';
  const form = $('form', el);
  form.addEventListener('submit', ev => { ev.preventDefault(); onSubmit(form, ev.submitter); });
  const first = $('input,textarea,select', form); if (first && matchMedia('(hover:hover)').matches) first.focus();
  return form;
}
function closeSheet() { $('#sheet').innerHTML = ''; }
$('#sheet').addEventListener('click', ev => {
  if (ev.target.matches('.sheet-wrap') || ev.target.closest('[data-close-btn]')) closeSheet();
});

function deckOptions(sel) {
  const out = ['<option value="">Верхний уровень</option>'];
  const walk = (pid, depth) => { if (depth > 5) return; for (const d of childrenOf(S.decks, pid)) { out.push('<option value="' + esc(d.id) + '"' + (d.id === sel ? ' selected' : '') + '>' + '  '.repeat(depth) + esc(d.name) + '</option>'); walk(d.id, depth + 1); } };
  walk(null, 0); return out.join('');
}
function openDeckForm(parentId) {
  const parent = parentId && S.decks[parentId], t0 = parent ? typeOf(parent) : 'kz';
  const typeOpts = Object.keys(TYPES).map(k => '<option value="' + k + '"' + (k === t0 ? ' selected' : '') + '>' + TYPES[k].label + '</option>').join('');
  openSheet('<h2>Новая колода</h2>' +
    '<label>Название<input name="name" maxlength="80" autocomplete="off" placeholder="Например, СОЧ 2 четверть"></label>' +
    '<label>Тип карточек<select name="type">' + typeOpts + '</select></label>' +
    '<label>Где лежит<select name="parent">' + deckOptions(parentId || '') + '</select></label>' +
    '<div class="row"><button type="button" class="btn ghost" data-close-btn="1">Отмена</button><button class="btn dark">Создать</button></div>',
    form => {
      const F = n => form.elements.namedItem(n);
      const name = F('name').value.trim(); if (!name) { toast('Впиши название колоды.'); return; }
      const maxOrder = Object.values(S.decks).reduce((m, d) => Math.max(m, d.order || 0), 0);
      const d = { id: uid36('d'), name, type: F('type').value, parent: F('parent').value || null, order: maxOrder + 1, cards: [] };
      putDeck(d); closeSheet(); S.view = { name: 'deck', id: d.id }; render(); window.scrollTo(0, 0);
    });
}
function openCardForm(deckId) {
  const d = S.decks[deckId]; if (!d) return; const t = typeOf(d);
  let f;
  if (t === 'kz') f = '<label>По-русски<input name="ru" autocomplete="off"></label><label>Қазақша<input name="kz" autocomplete="off" lang="kk"></label><label>Заметка, если нужна<input name="note" autocomplete="off"></label>';
  else if (t === 'kzru') f = '<label>Қазақша<input name="kz" autocomplete="off" lang="kk"></label><label>По-русски<input name="ru" autocomplete="off"></label><label>Заметка, если нужна<input name="note" autocomplete="off"></label>';
  else if (t === 'en') f = '<label>Слово<input name="word" autocomplete="off" autocapitalize="off" lang="en"></label>' +
    '<label>Транскрипция<input name="ipa" autocomplete="off" placeholder="/ˈstʌbən/"></label>' +
    '<label>Перевод<input name="ru" autocomplete="off"></label>' +
    '<label>Пояснение на английском<input name="def" autocomplete="off" lang="en" placeholder="unwilling to change your opinion"></label>' +
    '<label>Предложения, по одному на строку<textarea name="sentences" lang="en" placeholder="He was too {stubborn} to say sorry."></textarea></label>' +
    '<p class="help">Слово в предложении возьми в фигурные скобки: на карточке на его месте будет пропуск.</p>';
  else f = '<label>Вопрос<textarea name="q"></textarea></label><label>Ответ<textarea name="a"></textarea></label>';
  openSheet('<h2>Карточка в «' + esc(d.name) + '»</h2>' + f +
    '<div class="row"><button type="button" class="btn ghost" data-close-btn="1">Готово</button><button class="btn dark">Добавить</button></div>',
    form => {
      const v = n => { const el = form.elements.namedItem(n); return el ? el.value.trim() : ''; };
      let c;
      if (t === 'kz' || t === 'kzru') { if (!v('ru') || !v('kz')) { toast('Нужны оба поля: русский и казахский.'); return; } c = { ru: v('ru'), kz: v('kz') }; if (v('note')) c.note = v('note'); }
      else if (t === 'en') {
        if (!v('word')) { toast('Впиши слово.'); return; }
        c = { word: v('word'), ipa: v('ipa'), ru: v('ru'), def: v('def'), sentences: v('sentences').split('\n').map(s => s.trim()).filter(Boolean) };
      } else { if (!v('q') || !v('a')) { toast('Нужны и вопрос, и ответ.'); return; } c = { q: v('q'), a: v('a') }; }
      c.id = uid36('c');
      const cur = S.decks[deckId]; if (!cur) { closeSheet(); return; }
      putDeck({ ...cur, cards: (cur.cards || []).concat([c]) });
      form.reset(); toast('Карточка добавлена.'); render();
      const first = $('input,textarea', form); if (first) first.focus();
    });
}

function lastBackupLine() {
  const t = S.meta.lastBackupAt;
  if (!t) return '<p class="last-backup old">Копий ещё не было.</p>';
  const n = dayIndex() - dayIndex(t);
  const when = n <= 0 ? 'сегодня' : n === 1 ? 'вчера' : n + ' ' + plural(n, 'день', 'дня', 'дней') + ' назад';
  return '<p class="last-backup' + (n >= 14 ? ' old' : '') + '">Последняя копия: ' + when + '.</p>';
}

function openSettings() {
  const st = S.settings;
  const form = openSheet('<h2>Настройки</h2>' +
    '<label>Новых карточек в день на колоду<input name="np" type="number" inputmode="numeric" min="0" max="200" value="' + st.newPerDay + '"></label>' +
    '<label>Ответов, чтобы день засчитался<input name="goal" type="number" inputmode="numeric" min="1" max="500" value="' + st.goal + '"></label>' +
    '<p class="help">День засчитывается и тогда, когда ты повторил всё, что было на сегодня, даже если ответов меньше.</p>' +
    '<label class="check"><input type="checkbox" name="streak"' + (st.streak ? ' checked' : '') + '>Показывать серию дней</label>' +
    '<p class="help">Пропуск дня не обнуляет серию, пока на неделе есть заморозки: их две. «Выучено» — карточки, которые ты помнишь хотя бы неделю.</p>' +
    '<div class="row"><button type="button" class="btn ghost" data-close-btn="1">Отмена</button><button class="btn dark">Сохранить</button></div>' +
    '<h3 class="sheet-sec">Данные</h3>' +
    '<p class="help">Колоды и прогресс хранятся только на этом устройстве. Время от времени делай резервную копию и сохраняй её в «Файлы» или в облако.</p>' +
    '<div data-last-backup>' + lastBackupLine() + '</div>' +
    '<div class="data-btns">' +
      '<button type="button" class="btn dark" data-data="backup">Сделать резервную копию</button>' +
      '<button type="button" class="btn ghost" data-data="restore">Восстановить из копии</button>' +
      '<button type="button" class="btn ghost" data-data="import">Импортировать колоды</button>' +
    '</div>' +
    '<p class="help" style="margin-top:12px">Импорт — файл в формате decks.json. Колоды с тем же id дополняются новыми карточками, прогресс не теряется.</p>' +
    '<input type="file" accept=".json,application/json" hidden data-file>',
    form => {
      const F = n => form.elements.namedItem(n);
      const np = Math.max(0, Math.min(200, parseInt(F('np').value, 10) || 0));
      const goal = Math.max(1, Math.min(500, parseInt(F('goal').value, 10) || 1));
      S.settings = { newPerDay: np, goal, streak: F('streak').checked };
      saved(S.db.write(['settings'], s => s.settings.put({ key: 'prefs', ...S.settings })));
      closeSheet(); render();
    });

  prepareBackup();
  const fileInput = $('[data-file]', form);
  let fileMode = null;
  form.addEventListener('click', ev => {
    const b = ev.target.closest('[data-data]'); if (!b) return;
    if (b.dataset.data === 'backup') doBackup();
    else { fileMode = b.dataset.data; fileInput.value = ''; fileInput.click(); }
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0]; if (!file) return;
    const text = await file.text();
    if (fileMode === 'restore') restoreFrom(text); else importDecks(text);
  });
}

/* ---------- данные: копия, восстановление, импорт ---------- */

// Содержимое базы для копии читаем заранее, когда открываются настройки. Причина: Safari разрешает
// открыть лист «Поделиться» только сразу после нажатия, и если по нажатию сначала читать базу, он может отказать.
let preparedData = null;
function prepareBackup() {
  preparedData = null;
  return S.db.exportAll().then(d => (preparedData = d)).catch(e => { console.error(e); return null; });
}

function downloadFile(file) {
  const url = URL.createObjectURL(file);
  const a = document.createElement('a');
  a.href = url; a.download = file.name;
  document.body.appendChild(a); a.click(); a.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30000);
}

async function doBackup() {
  const data = preparedData || await prepareBackup();
  if (!data) { toast('Не удалось прочитать данные для копии.'); return; }
  const now = Date.now();
  const file = new File([JSON.stringify(makeBackup(data, now), null, 2)], backupFileName(now), { type: 'application/json' });
  // На телефоне — лист «Поделиться» (там есть «Сохранить в Файлы»), на компьютере — обычное скачивание.
  const phone = matchMedia('(pointer: coarse)').matches;
  try {
    if (phone && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
    else downloadFile(file);
  } catch (e) {
    if (e && e.name === 'AbortError') return; // закрыл лист «Поделиться» — копия не сделана
    console.error(e);
    downloadFile(file); // лист не открылся — тогда просто скачиваем файл
  }
  S.meta = { ...S.meta, key: 'meta', lastBackupAt: now };
  saved(S.db.write(['settings'], s => s.settings.put(S.meta)));
  const line = $('[data-last-backup]'); if (line) line.innerHTML = lastBackupLine();
  toast('Резервная копия готова.');
}

async function restoreFrom(text) {
  let b;
  try { b = parseBackup(text); } catch (e) { toast(e.message); return; }
  const when = new Date(b.exportedAt).toLocaleString('ru-RU', { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const cards = b.data.decks.reduce((n, d) => n + d.cards.length, 0);
  if (!confirm('Восстановить копию от ' + when + '?\n\nВ ней колод: ' + b.data.decks.length + ', карточек: ' + cards + '.\n' +
    'Все текущие данные на этом устройстве — колоды, прогресс, серия и настройки — заменятся данными из копии.')) return;
  try {
    await S.db.replaceAll(dataForRestore(b));
    await loadAll();
  } catch (e) { console.error(e); toast('Не удалось восстановить: ' + ((e && e.message) || e)); return; }
  closeSheet(); S.session = null; S.view = { name: 'home' }; render(); window.scrollTo(0, 0);
  toast('Данные восстановлены из копии.');
}

async function importDecks(text) {
  let list;
  try { list = parseDeckFile(text); } catch (e) { toast(e.message); return; }
  const r = mergeDecks(S.decks, list);
  if (!r.changed.length) { toast('Ничего нового: все эти карточки уже есть.'); return; }
  try { await S.db.write(['decks'], s => r.changed.forEach(d => s.decks.put(d))); }
  catch (e) { console.error(e); toast('Не удалось сохранить колоды: ' + ((e && e.message) || e)); return; }
  S.decks = r.decks;
  closeSheet(); render();
  toast('Добавлено: ' + r.addedDecks + ' ' + plural(r.addedDecks, 'колода', 'колоды', 'колод') + ', ' +
    r.addedCards + ' ' + plural(r.addedCards, 'карточка', 'карточки', 'карточек') + '.');
}

/* ---------- удаление ---------- */
function deleteDeck(id) {
  const d = S.decks[id]; if (!d) return;
  const ids = descendants(S.decks, id);
  if (!confirm('Удалить «' + d.name + '»' + (ids.length > 1 ? ' вместе с подколодами' : '') + '? Карточки и прогресс по ним пропадут.')) return;
  const next = { ...S.decks };
  for (const x of ids) { delete next[x]; delete S.prog[x]; }
  S.decks = next;
  saved(S.db.deleteDecks(ids));
  S.view = d.parent && S.decks[d.parent] ? { name: 'deck', id: d.parent } : { name: 'home' }; render();
}
function deleteCard(deckId, cardId) {
  const d = S.decks[deckId]; if (!d) return;
  const card = (d.cards || []).find(c => c.id === cardId); if (!card) return;
  const s = cardSummary(typeOf(d), card);
  if (!confirm('Удалить карточку «' + s[0] + '»?')) return;
  const nd = { ...d, cards: d.cards.filter(c => c.id !== cardId) };
  S.decks = { ...S.decks, [deckId]: nd };
  if (S.prog[deckId]) delete S.prog[deckId][cardId];
  saved(S.db.write(['decks', 'cardState'], st => { st.decks.put(nd); st.cardState.delete([deckId, cardId]); }));
  render();
}

/* ---------- events ---------- */
$('#app').addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b || b.disabled) return;
  const act = b.dataset.act, id = b.dataset.id;
  switch (act) {
    case 'settings': openSettings(); break;
    case 'home': S.view = { name: 'home' }; render(); window.scrollTo(0, 0); break;
    case 'open-deck': S.view = { name: 'deck', id }; render(); window.scrollTo(0, 0); break;
    case 'study-all': startStudy(Object.keys(S.decks), { name: 'home' }); break;
    case 'study-deck': startStudy(descendants(S.decks, id), { name: 'deck', id }); break;
    case 'add-deck': openDeckForm(b.dataset.parent || null); break;
    case 'add-card': openCardForm(id); break;
    case 'del-card': deleteCard(b.dataset.deck, b.dataset.card); break;
    case 'del-deck': deleteDeck(id); break;
    case 'flip': if (suppressClick) return; flip(); break;
    case 'good': answer(true); break;
    case 'bad': answer(false); break;
    case 'undo': undo(); break;
    case 'close': case 'finish': endStudy(); break;
  }
});
document.addEventListener('keydown', ev => {
  if ($('#sheet').innerHTML) { if (ev.key === 'Escape') closeSheet(); return; }
  if (S.view.name !== 'study' || !S.session) return;
  if (ev.target.closest && ev.target.closest('input,textarea,select')) return;
  if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); if (S.session.queue.length) flip(); else endStudy(); }
  else if ((ev.key === '1' || ev.key === 'ArrowLeft') && S.session.flipped) answer(false);
  else if ((ev.key === '2' || ev.key === 'ArrowRight') && S.session.flipped) answer(true);
  else if (ev.key === 'Escape') endStudy();
  else if ((ev.key === 'z' || ev.key === 'я') && (ev.metaKey || ev.ctrlKey)) undo();
});

init();
