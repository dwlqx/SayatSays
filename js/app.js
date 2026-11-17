// Интерфейс приложения: экраны, листы, учёба. Перенесён из legacy/zapomni-artifact.html.
// Расписание, серия дней, колоды, база и резервные копии — в отдельных модулях без DOM.
//
// Как устроено хранение: при запуске всё (кроме журнала) читается из базы в объект S в памяти,
// интерфейс рисуется из S. Каждое изменение сразу меняет S и записывается в базу.
//
// Тексты интерфейса — по-русски через t('…'), английский перевод — в js/i18n.js.

import { openDB } from './db.js';
import { seedIfNeeded, migrateToFsrs } from './migrate.js';
import { makeBackup, backupFileName, parseBackup, dataForRestore } from './backup.js';
import { dayIndex, dayStart, weekOf, streakInfo } from './streak.js';
import { makeScheduler, preview, formatInterval, DEFAULT_RETENTION, Rating, ANSWERS } from './scheduler.js';
import { typeOf, uid36, childrenOf, descendants, deckCounts, todayTotal, fsrsOf, parseDeckFile, mergeDecks,
  cardProblem, cardFromForm, updateCard, canMove } from './decks.js';
import { parsePasted, claudeInstructions } from './claude.js';
import { answersByDay, goodShare, forecast, totals } from './stats.js';
import { THEMES, DEFAULT_THEME, isTheme, THEME_KEY } from './themes.js';
import { startSession, nextItem, dropItem, leftInSession, answerCard, undoAnswer } from './study.js';
import { pushStatus, currentSubscription, subscriptionText, enablePush, testReminder, setBadge,
  repoFromLocation, badgeStatus, enableBadge } from './push.js';
import { t, count, word, setLang, getLang, isLang, systemLang, locale, LANG_KEY } from './i18n.js';
import { VERSION } from './version.js';

/* ---------- helpers ---------- */
const $ = (s, r) => (r || document).querySelector(s);
const esc = s => String(s == null ? '' : s).replace(/[&<>"']/g, c => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
let toastTimer = null;
function toast(msg) { const el = $('#toast'); el.textContent = msg; el.classList.add('on'); clearTimeout(toastTimer); toastTimer = setTimeout(() => el.classList.remove('on'), 3200); }
const errText = e => (e && e.message) || String(e);

const ICON = {
  close: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
  undo: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 14L4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 010 11H11"/></svg>',
  gear: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3"/><path d="M19.4 15a1.7 1.7 0 00.3 1.8l.1.1a2 2 0 11-2.8 2.8l-.1-.1a1.7 1.7 0 00-1.8-.3 1.7 1.7 0 00-1 1.5V21a2 2 0 11-4 0v-.1a1.7 1.7 0 00-1.1-1.5 1.7 1.7 0 00-1.8.3l-.1.1a2 2 0 11-2.8-2.8l.1-.1a1.7 1.7 0 00.3-1.8 1.7 1.7 0 00-1.5-1H3a2 2 0 110-4h.1a1.7 1.7 0 001.5-1.1 1.7 1.7 0 00-.3-1.8l-.1-.1a2 2 0 112.8-2.8l.1.1a1.7 1.7 0 001.8.3H9a1.7 1.7 0 001-1.5V3a2 2 0 114 0v.1a1.7 1.7 0 001 1.5 1.7 1.7 0 001.8-.3l.1-.1a2 2 0 112.8 2.8l-.1.1a1.7 1.7 0 00-.3 1.8V9a1.7 1.7 0 001.5 1H21a2 2 0 110 4h-.1a1.7 1.7 0 00-1.5 1z"/></svg>',
  back: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>',
  chart: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><path d="M5 20v-7M12 20V5M19 20v-10"/></svg>',
  pencil: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 20h4L19 9l-4-4L4 16v4z"/><path d="M13.5 6.5l4 4"/></svg>',
  trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/></svg>'
};

/* ---------- model ---------- */
// label — название типа по-русски; на экран оно выводится через t(), то есть на языке интерфейса.
const TYPES = {
  kz: { label: 'Казахский: русский → казахский', color: 'var(--kz)' },
  kzru: { label: 'Казахский: казахский → русский', color: 'var(--kz)' },
  en: { label: 'Английский: предложение с пропуском', color: 'var(--en)' },
  qa: { label: 'Предмет: вопрос и ответ', color: 'var(--qa)' }
};
const typeLabel = type => t(TYPES[type].label);
const colorOf = d => TYPES[typeOf(d)].color;
// theme — тема оформления (список в themes.js); buttons — сколько кнопок ответа: 2 или 4;
// lang — язык интерфейса: 'auto' (как на телефоне), 'ru' или 'en'.
const DEFAULT_SETTINGS = { newPerDay: 15, goal: 10, streak: true, retention: DEFAULT_RETENTION, theme: DEFAULT_THEME, buttons: 2, lang: 'auto' };

// Состояние в памяти. Что лежит в decks, prog, days и settings — см. начало decks.js.
// scheduler — планировщик FSRS с текущей целевой запоминаемостью.
const S = {
  db: null, scheduler: makeScheduler(),
  decks: {}, prog: {}, days: {}, settings: { ...DEFAULT_SETTINGS }, meta: { key: 'meta' },
  ready: false, error: null,
  view: { name: 'home' }, session: null
};

/* ---------- язык ---------- */
// Какой язык показывать: выбранный в настройках, а для «Как на телефоне» — по языку телефона.
// Копия в localStorage нужна, чтобы «Загружаю…» при запуске было уже на нужном языке (база открывается позже).
function applyLang(choice) {
  const lang = choice === 'ru' || choice === 'en' ? choice : systemLang(navigator.languages || [navigator.language]);
  setLang(lang);
  document.documentElement.lang = lang;
  try { localStorage.setItem(LANG_KEY, lang); } catch (e) { /* в приватном режиме localStorage может не работать */ }
}

/* ---------- storage ---------- */
// Прочитать всё из базы в S (журнал ответов не нужен для экранов — его не читаем).
// fresh — база только что заполнена в первый раз (новый человек).
async function loadAll(fresh = false) {
  const [decks, cardState, stats, settings] = await Promise.all(['decks', 'cardState', 'stats', 'settings'].map(n => S.db.getAll(n)));
  S.decks = {};
  for (const d of decks) S.decks[d.id] = d;
  S.prog = {};
  for (const r of cardState) (S.prog[r.deck] || (S.prog[r.deck] = {}))[r.card] = r;
  S.days = {};
  for (const d of stats) S.days[d.day] = d;
  const prefs = settings.find(s => s.key === 'prefs') || {};
  S.settings = {};
  for (const k in DEFAULT_SETTINGS) S.settings[k] = prefs[k] ?? DEFAULT_SETTINGS[k];
  if (!isTheme(S.settings.theme)) S.settings.theme = DEFAULT_THEME;
  if (S.settings.buttons !== 4) S.settings.buttons = 2;
  // Язык. У тех, кто пользовался приложением до английской версии (у Ромы), в настройках языка нет —
  // им оставляем русский, даже если телефон на английском. Новым людям — язык телефона.
  if (!isLang(prefs.lang)) S.settings.lang = fresh ? 'auto' : 'ru';
  if (fresh) saved(S.db.write(['settings'], s => s.settings.put({ key: 'prefs', ...S.settings })));
  applyLang(S.settings.lang);
  S.scheduler = makeScheduler(S.settings.retention);
  applyTheme(S.settings.theme);
  S.meta = settings.find(s => s.key === 'meta') || { key: 'meta' };
  S.hasFsrsSnapshot = !!(await S.db.get('snapshots', 'before-fsrs'));
}

// Запись в базу идёт в фоне: S уже обновлён и экран нарисован. Если запись не удалась — говорим об этом.
function saved(promise) {
  return promise.catch(e => { console.error(e); toast(t('Не удалось сохранить на устройстве: {e}', { e: errText(e) })); });
}
function putDeck(d) { S.decks = { ...S.decks, [d.id]: d }; return saved(S.db.write(['decks'], s => s.decks.put(d))); }
function putDay(rec) { S.days[rec.day] = rec; return saved(S.db.write(['stats'], s => s.stats.put(rec))); }
const savePrefs = () => saved(S.db.write(['settings'], s => s.settings.put({ key: 'prefs', ...S.settings })));

// Первый запуск: стартовые колоды из data/decks.json. Прогресс (data/progress-sm2.json) не загружаем:
// это история Ромы из артефакта, у него она уже в базе, а у других людей приложение должно начинаться с нуля.
async function loadStarterDecks() {
  const r = await fetch('./data/decks.json');
  if (!r.ok) throw new Error(t('Не удалось загрузить {url} (ошибка {code}).', { url: './data/decks.json', code: r.status }));
  return { decks: await r.json(), progress: null };
}

async function init() {
  let stored = null, storedLang = null;
  try { stored = localStorage.getItem(THEME_KEY); storedLang = localStorage.getItem(LANG_KEY); } catch (e) { /* нет localStorage — не страшно */ }
  applyTheme(stored); // настоящие настройки придут из базы в loadAll
  applyLang(storedLang);
  render();
  let seeded = false, migrated = 0;
  try {
    S.db = await openDB();
    seeded = await seedIfNeeded(S.db, loadStarterDecks);
    // Просим браузер не удалять данные при нехватке места. Браузер может и отказать — это не ошибка.
    if (seeded && navigator.storage && navigator.storage.persist) navigator.storage.persist().catch(() => {});
    // Один раз: перевести прогресс с SM-2 на FSRS (перед этим сохраняется снимок всей базы).
    migrated = await migrateToFsrs(S.db);
    await loadAll(seeded);
    S.ready = true;
  } catch (e) {
    console.error(e);
    S.error = errText(e);
  }
  render();
  if (migrated && !seeded) toast(t('Расписание теперь считает FSRS. Копия данных до перехода — в Настройки → Данные.'));
  // Первый раз: в Safari на iPhone — как установить на экран «Домой», иначе — короткое знакомство.
  if (S.ready && inIosSafari && !S.meta.installHintAt) showInstallHint();
  else if (S.ready && seeded && !S.meta.welcomeAt) showWelcome();
}

/* ---------- rendering ---------- */
function render() {
  const app = $('#app');
  if (!S.ready) {
    app.className = '';
    app.innerHTML = S.error
      ? '<header class="top"><h1 class="brand">SayatSays</h1></header><div class="empty"><p>' + t('Не получилось открыть данные.') + '</p><p>' + esc(S.error) + '</p></div>'
      : '<div class="empty"><p>' + t('Загружаю…') + '</p></div>';
    return;
  }
  const v = S.view;
  app.className = v.name === 'study' ? 'is-study' : '';
  if (v.name === 'deck' && !S.decks[v.id]) S.view = { name: 'home' };
  if (S.view.name === 'stats') { app.innerHTML = statsHTML(); return; }
  if (S.view.name === 'home') { app.innerHTML = homeHTML(); if (maybeAutoDone()) app.innerHTML = homeHTML(); updateBadge(); }
  else if (S.view.name === 'deck') app.innerHTML = deckHTML(S.view.id);
  else if (S.view.name === 'study') renderStudy();
}

function streakHTML() {
  const today = dayIndex(), st = streakInfo(S.days, today);
  if (!S.settings.streak) return '<p class="today-only">' + t('Сегодня ответов: {n}', { n: '<b>' + st.todayN + '</b>' }) + '</p>';
  const mon = weekOf(today) * 7 - 3;
  const L = getLang() === 'en' ? ['M', 'T', 'W', 'T', 'F', 'S', 'S'] : ['П', 'В', 'С', 'Ч', 'П', 'С', 'В'];
  const cells = L.map((l, i) => {
    const d = mon + i; let c, s;
    if (S.days[d] && S.days[d].done) { c = 'done'; s = t('занимался'); }
    else if (st.frozen.has(d)) { c = 'frozen'; s = t('заморозка'); }
    else if (d === today) { c = 'today'; s = t('сегодня'); }
    else if (d > today) { c = 'future'; s = t('впереди'); }
    else { c = 'miss'; s = t('пропуск'); }
    return '<i class="' + c + '" title="' + esc(dayLabel(d, { weekday: 'long' }) + ': ' + s) + '">' + l + '</i>';
  }).join('');
  const line = st.todayDone ? t('Сегодня засчитано.') : t('Сегодня {n} из {goal} ответов.', { n: st.todayN, goal: S.settings.goal });
  return '<section class="streak"><div class="snum">' + st.streak + '</div><div><div class="slabel">' +
    t('{days} подряд', { days: word(st.streak, 'день', 'дня', 'дней') }) + '</div><div class="week">' + cells + '</div></div>' +
    '<p class="sline">' + line + ' ' + t('Заморозок на этой неделе осталось: {n}.', { n: st.freezesLeft }) + '</p></section>';
}

function rowsHTML(pid, depth) {
  if (depth > 5) return '';
  const today = dayIndex();
  return childrenOf(S.decks, pid).map(d => {
    const c = deckCounts(S, d.id, true, today);
    return '<li><button class="deck-row d' + Math.min(depth, 2) + '" data-act="open-deck" data-id="' + esc(d.id) + '" style="--c:' + colorOf(d) + '">' +
      '<span class="sw"></span><span><span class="nm">' + esc(d.name) + '</span><span class="mt">' + t('выучено {n} из {total}', { n: c.learned, total: c.total }) + '</span></span>' +
      '<span class="due' + (c.today ? '' : ' zero') + '" aria-label="' + esc(t('на сегодня {n}', { n: c.today })) + '">' + c.today + '</span></button></li>' + rowsHTML(d.id, depth + 1);
  }).join('');
}

function homeHTML() {
  const ids = Object.keys(S.decks), today = dayIndex();
  const all = todayTotal(S, today);
  let h = '<header class="top"><h1 class="brand">SayatSays</h1><div class="top-btns">' +
    '<button class="icon-btn" data-act="stats" aria-label="' + t('Статистика') + '">' + ICON.chart + '</button>' +
    '<button class="icon-btn" data-act="settings" aria-label="' + t('Настройки') + '">' + ICON.gear + '</button></div></header>';
  h += streakHTML();
  if (!ids.length) {
    h += '<div class="empty"><p>' + t('Колод пока нет.') + '</p><p>' + t('Попроси Claude сделать карточки и перенеси их сюда — или создай колоду сам.') + '</p>' +
      '<button class="link" style="padding-left:0" data-act="add">' + t('Добавить колоды') + '</button></div>';
    return h;
  }
  h += '<button class="primary" data-act="study-all"' + (all ? '' : ' disabled') + '><span>' + (all ? t('Повторить всё') : t('На сегодня всё повторено')) + '</span>' + (all ? '<span class="pill">' + all + '</span>' : '') + '</button>';
  h += '<div class="sec"><h2>' + t('Колоды') + '</h2><button class="link" data-act="add">' + t('Добавить') + '</button></div>';
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
  const d = S.decks[id], type = typeOf(d), c = deckCounts(S, id, true, dayIndex()), kids = childrenOf(S.decks, id);
  const parent = d.parent && S.decks[d.parent];
  const tot = c.total || 1;
  let h = '<div style="--c:' + colorOf(d) + '">';
  h += '<button class="back-btn" data-act="' + (parent ? 'open-deck' : 'home') + '"' + (parent ? ' data-id="' + esc(parent.id) + '"' : '') + '>' + ICON.back + (parent ? esc(parent.name) : t('Колоды')) + '</button>';
  h += '<div class="deck-title"><h1 class="deck-h">' + esc(d.name) + '</h1>' +
    '<button class="icon-btn" data-act="edit-deck" data-id="' + esc(id) + '" aria-label="' + t('Изменить название и место колоды') + '">' + ICON.pencil + '</button></div>' +
    '<p class="deck-type">' + typeLabel(type) + '</p>';
  h += '<div class="stack" aria-hidden="true"><span style="flex:' + c.nw / tot + '"></span><span class="s-learn" style="flex:' + c.learning / tot + '"></span><span class="s-done" style="flex:' + c.learned / tot + '"></span></div>';
  h += '<div class="legend"><div><b>' + c.nw + '</b><span><i class="k" style="background:var(--line)"></i>' + t('новые') + '</span></div>' +
       '<div><b>' + c.learning + '</b><span><i class="k" style="background:color-mix(in srgb, var(--c) 40%, var(--line))"></i>' + t('изучаются') + '</span></div>' +
       '<div><b>' + c.learned + '</b><span><i class="k" style="background:var(--c)"></i>' + t('выучено') + '</span></div>' +
       '<div><b>' + c.total + '</b><span>' + t('всего') + '</span></div></div>';
  h += '<button class="primary" data-act="study-deck" data-id="' + esc(id) + '"' + (c.today ? '' : ' disabled') + '><span>' + (c.today ? t('Учить') : t('На сегодня всё')) + '</span>' + (c.today ? '<span class="pill">' + c.today + '</span>' : '') + '</button>';
  h += '<div class="sec"><h2>' + t('Подколоды') + '</h2><button class="link" data-act="add-deck" data-parent="' + esc(id) + '">' + t('Добавить') + '</button></div>';
  h += kids.length ? '<ul class="decks">' + rowsHTML(id, 1) + '</ul>' : '<p class="note">' + t('Нет подколод.') + '</p>';
  const cards = d.cards || [];
  if (cards.length || !kids.length) {
    h += '<div class="sec"><h2>' + t('Карточки') + '<span class="cnt">' + cards.length + '</span></h2><span>' +
      '<button class="link" data-act="add" data-id="' + esc(id) + '">' + t('От Claude') + '</button>' +
      '<button class="link" data-act="add-card" data-id="' + esc(id) + '">' + t('Добавить') + '</button></span></div>';
    if (!cards.length) h += '<p class="note">' + t('Карточек пока нет. Добавь сам или попроси Claude: «От Claude» — там инструкция для чата.') + '</p>';
    else h += '<p class="note">' + t('Нажми на карточку, чтобы исправить её.') + '</p><ul class="cards">' + cards.map(card => {
      const s = cardSummary(type, card);
      return '<li><button class="card-row" data-act="edit-card" data-deck="' + esc(id) + '" data-card="' + esc(card.id) + '">' +
        '<span class="f">' + esc(s[0]) + '</span><span class="b">' + esc(s[1]) + '</span></button>' +
        '<button class="del" data-act="del-card" data-deck="' + esc(id) + '" data-card="' + esc(card.id) + '" aria-label="' + t('Удалить карточку') + '">' + ICON.trash + '</button></li>';
    }).join('') + '</ul>';
  }
  h += '<button class="danger" data-act="del-deck" data-id="' + esc(id) + '">' + t('Удалить колоду') + '</button>';
  return h + '</div>';
}

function cloze(s, w, mode) {
  s = String(s || ''); const m = s.match(/\{([^}]+)\}/); let pre, ans, post;
  if (m) { pre = s.slice(0, m.index); ans = m[1]; post = s.slice(m.index + m[0].length); }
  else {
    const i = w ? s.toLowerCase().indexOf(String(w).toLowerCase()) : -1;
    if (i < 0) return esc(s);
    pre = s.slice(0, i); ans = s.slice(i, i + String(w).length); post = s.slice(i + String(w).length);
  }
  const mid = mode === 'gap' ? '<span class="gap" role="img" aria-label="' + t('пропуск в предложении') + '"></span>' : '<mark>' + esc(ans) + '</mark>';
  return esc(pre.replace(/[{}]/g, '')) + mid + esc(post.replace(/[{}]/g, ''));
}

function facesHTML(deck, card, e) {
  const type = typeOf(deck), tag = '<div class="tag">' + esc(deck.name) + '</div>';
  let f, b;
  if (type === 'kz' || type === 'kzru') {
    const q = type === 'kz' ? card.ru : card.kz, a = type === 'kz' ? card.kz : card.ru;
    f = '<div class="word">' + esc(q) + '</div><div class="prompt">' + (type === 'kz' ? 'Қазақша?' : t('По-русски?')) + '</div>';
    b = '<p class="small-q c">' + esc(q) + '</p><div class="word">' + esc(a) + '</div>' + (card.note ? '<div class="prompt">' + esc(card.note) + '</div>' : '');
  } else if (type === 'en') {
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

// Кнопки ответа: две («Не знал», «Знал») или четыре — это выбирается в настройках.
// Под каждой — когда карточка вернётся, если ответить так (считает FSRS).
const ANSWER_BTN = {
  [Rating.Again]: { label: 'Не знал', cls: 'bad' },
  [Rating.Hard]: { label: 'Трудно', cls: 'hard' },
  [Rating.Good]: { label: 'Знал', cls: 'good' },
  [Rating.Easy]: { label: 'Легко', cls: 'easy' }
};
const fourButtons = () => S.settings.buttons === 4;
const answerRatings = () => fourButtons() ? ANSWERS : [Rating.Again, Rating.Good];
function actionsHTML() {
  const ses = S.session;
  if (!ses.flipped) return '<button class="btn-big show" data-act="flip">' + t('Показать ответ') + '</button>';
  const sub = ms => ses.preview ? '<small>' + formatInterval(ms) + '</small>' : '';
  return answerRatings().map(r => '<button class="btn-big ' + ANSWER_BTN[r].cls + '" data-act="answer" data-rating="' + r + '">' +
    t(ANSWER_BTN[r].label) + sub(ses.preview && ses.preview[r]) + '</button>').join('');
}

function renderStudy() {
  const ses = S.session, app = $('#app');
  if (!ses) { S.view = { name: 'home' }; return render(); }
  let pick, deck, card;
  while ((pick = nextItem(ses, Date.now()))) {
    deck = S.decks[pick.item.deck]; card = deck && (deck.cards || []).find(c => c.id === pick.item.card);
    if (card) break;
    dropItem(ses, pick); // карточку удалили, пока шло занятие
  }
  ses.current = pick;
  if (!pick) { app.innerHTML = doneHTML(); return; }
  const left = leftInSession(ses), total = ses.done + left, pct = total ? Math.round(ses.done / total * 100) : 0;
  app.innerHTML = '<div class="study" style="--c:' + colorOf(deck) + '">' +
    '<div class="sbar"><button class="icon-btn" data-act="close" aria-label="' + t('Закончить') + '">' + ICON.close + '</button>' +
    '<div class="pbar" role="progressbar" aria-valuenow="' + pct + '" aria-valuemin="0" aria-valuemax="100"><div style="width:' + pct + '%"></div></div>' +
    '<span class="left" title="' + t('осталось') + '">' + left + '</span>' +
    '<button class="icon-btn" data-act="edit-current" aria-label="' + t('Исправить карточку') + '">' + ICON.pencil + '</button>' +
    '<button class="icon-btn" data-act="undo" aria-label="' + t('Отменить последний ответ') + '"' + (ses.undo ? '' : ' disabled') + '>' + ICON.undo + '</button></div>' +
    '<div class="stage"><div class="swipe enter"><div class="card3d' + (ses.flipped ? ' flipped' : '') + '" data-act="flip">' + facesHTML(deck, card, (S.prog[pick.item.deck] || {})[card.id]) + '</div></div></div>' +
    '<div class="actions' + (fourButtons() ? ' four' : '') + '">' + actionsHTML() + '</div>' +
    '<p class="hint-keys">' + (fourButtons() ? t('Пробел — перевернуть, 1 — не знал, 2 — трудно, 3 — знал, 4 — легко') : t('Пробел — перевернуть, 1 — не знал, 2 — знал')) + '</p></div>';
  bindSwipe();
}

function doneHTML() {
  const ses = S.session, st = streakInfo(S.days);
  let h = '<div class="finished">';
  if (!ses.done) { h += '<h1>' + t('На сегодня всё') + '</h1><p>' + t('Карточек к повторению нет. Загляни завтра.') + '</p>'; }
  else {
    h += '<h1>' + t('Готово') + '</h1><p>' + (fourButtons() ? t('Ответов: {n}, из них вспомнил: {good}.', { n: ses.done, good: ses.good })
      : t('Ответов: {n}, из них «знал»: {good}.', { n: ses.done, good: ses.good })) + '</p>';
    if (S.settings.streak) h += '<p>' + (st.todayDone ? t('День засчитан. Серия: {days}.', { days: count(st.streak, 'день', 'дня', 'дней') })
      : t('До зачёта дня осталось ответов: {n}.', { n: Math.max(0, S.settings.goal - st.todayN) })) + '</p>';
  }
  return h + '<button class="primary" data-act="finish">' + t('На главную') + '</button></div>';
}

/* ---------- study logic ---------- */
// Очередь, ответы и отмена — в study.js; здесь только экран и запись в базу.
function startStudy(ids, from) {
  S.session = { ...startSession(S, ids, dayIndex()), flipped: false, from };
  S.view = { name: 'study' }; render(); window.scrollTo(0, 0);
}
function endStudy() {
  const from = S.session && S.session.from;
  S.session = null;
  S.view = from && from.name === 'deck' && S.decks[from.id] ? from : { name: 'home' };
  render(); window.scrollTo(0, 0);
}
function flip() {
  const ses = S.session; if (!ses || !ses.current) return;
  ses.flipped = !ses.flipped;
  if (ses.flipped) {
    // Время ответа считаем с момента, когда открыт ответ: тогда подписи под кнопками
    // точно совпадут с тем, что запишется после нажатия.
    ses.answerAt = Date.now();
    const { item } = ses.current;
    ses.preview = preview(S.scheduler, fsrsOf(S, item.deck, item.card), ses.answerAt);
  }
  const c = $('.card3d'); if (c) c.classList.toggle('flipped', ses.flipped);
  const fr = $('.face.front'), bk = $('.face.back');
  if (fr && bk) { fr.setAttribute('aria-hidden', ses.flipped ? 'true' : 'false'); bk.setAttribute('aria-hidden', ses.flipped ? 'false' : 'true'); }
  const a = $('.actions'); if (a) a.innerHTML = actionsHTML();
}
// Ответ: новое состояние карточки, статистика дня и запись журнала — одной транзакцией.
// rating — оценка: Rating.Again («Не знал»), Hard («Трудно»), Good («Знал»), Easy («Легко»).
function answer(rating) {
  const ses = S.session; if (!ses || !ses.flipped || !ses.current) return;
  if (!answerRatings().includes(rating)) return;
  const { rec, day, log } = answerCard(S, ses, S.scheduler, rating, ses.answerAt, dayIndex(ses.answerAt));
  saved(S.db.write(['cardState', 'stats', 'reviewLog'], s => {
    s.cardState.put(rec);
    s.stats.put(day);
    s.reviewLog.put(log);
  }));
  ses.flipped = false; renderStudy();
}
// Отмена: возвращаем прежнее состояние карточки и день, запись журнала удаляем.
function undo() {
  const ses = S.session; if (!ses) return;
  const u = undoAnswer(S, ses); if (!u) return;
  ses.flipped = false;
  saved(S.db.write(['cardState', 'stats', 'reviewLog'], s => {
    if (u.prevRec) s.cardState.put(u.prevRec); else s.cardState.delete([u.deck, u.card]);
    if (u.prevDay) s.stats.put(u.prevDay); else s.stats.delete(u.today);
    s.reviewLog.delete(u.logId);
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
    if (horiz && Math.abs(dx) > 90) answer(dx > 0 ? Rating.Good : Rating.Again); // свайп вправо — «Знал», влево — «Не знал»
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
// Кнопки внизу листа: «Отмена» (закрыть) и главная (отправить форму).
const sheetRow = (cancel, ok) => '<div class="row"><button type="button" class="btn ghost" data-close-btn="1">' + cancel + '</button><button class="btn dark">' + ok + '</button></div>';

// Список колод для «Где лежит». skip — колоды, которых в списке быть не должно (вместе с их подколодами).
function deckOptions(sel, skip = []) {
  const out = ['<option value="">' + t('Верхний уровень') + '</option>'];
  const walk = (pid, depth) => {
    if (depth > 5) return;
    for (const d of childrenOf(S.decks, pid)) {
      if (skip.includes(d.id)) continue;
      out.push('<option value="' + esc(d.id) + '"' + (d.id === sel ? ' selected' : '') + '>' + '  '.repeat(depth) + esc(d.name) + '</option>');
      walk(d.id, depth + 1);
    }
  };
  walk(null, 0); return out.join('');
}
function openDeckForm(parentId) {
  const parent = parentId && S.decks[parentId], t0 = parent ? typeOf(parent) : 'kz';
  const typeOpts = Object.keys(TYPES).map(k => '<option value="' + k + '"' + (k === t0 ? ' selected' : '') + '>' + typeLabel(k) + '</option>').join('');
  openSheet('<h2>' + t('Новая колода') + '</h2>' +
    '<label>' + t('Название') + '<input name="name" maxlength="80" autocomplete="off" placeholder="' + esc(t('Например, СОЧ 2 четверть')) + '"></label>' +
    '<label>' + t('Тип карточек') + '<select name="type">' + typeOpts + '</select></label>' +
    '<label>' + t('Где лежит') + '<select name="parent">' + deckOptions(parentId || '') + '</select></label>' +
    sheetRow(t('Отмена'), t('Создать')),
    form => {
      const F = n => form.elements.namedItem(n);
      const name = F('name').value.trim(); if (!name) { toast(t('Впиши название колоды.')); return; }
      const maxOrder = Object.values(S.decks).reduce((m, d) => Math.max(m, d.order || 0), 0);
      const d = { id: uid36('d'), name, type: F('type').value, parent: F('parent').value || null, order: maxOrder + 1, cards: [] };
      putDeck(d); closeSheet(); S.view = { name: 'deck', id: d.id }; render(); window.scrollTo(0, 0);
    });
}
// Изменить колоду: название и где она лежит. Тип не меняется — у разных типов разные поля карточек.
function openDeckEdit(id) {
  const d = S.decks[id]; if (!d) return;
  const parent = d.parent && S.decks[d.parent] ? d.parent : '';
  openSheet('<h2>' + t('Колода') + '</h2>' +
    '<label>' + t('Название') + '<input name="name" maxlength="80" autocomplete="off" value="' + esc(d.name) + '"></label>' +
    '<label>' + t('Где лежит') + '<select name="parent">' + deckOptions(parent, [id]) + '</select></label>' +
    '<p class="help">' + t('Тип: {type}. Его не поменять: у разных типов разные поля карточек.', { type: esc(typeLabel(typeOf(d))) }) + '</p>' +
    sheetRow(t('Отмена'), t('Сохранить')),
    form => {
      const F = n => form.elements.namedItem(n);
      const name = F('name').value.trim(); if (!name) { toast(t('Впиши название колоды.')); return; }
      const cur = S.decks[id]; if (!cur) { closeSheet(); return; }
      const to = F('parent').value || null;
      if (!canMove(S.decks, id, to)) { toast(t('Колоду нельзя положить внутрь неё самой.')); return; }
      putDeck({ ...cur, name, parent: to }); closeSheet(); render(); toast(t('Колода сохранена.'));
    });
}

// Поля формы карточки. c — карточка, которую исправляем (для новой — пустой объект).
function cardFieldsHTML(type, c) {
  const val = k => ' value="' + esc(c[k] || '') + '"';
  if (type === 'kz' || type === 'kzru') {
    const ru = '<label>' + t('По-русски') + '<input name="ru" autocomplete="off"' + val('ru') + '></label>';
    const kz = '<label>Қазақша<input name="kz" autocomplete="off" lang="kk"' + val('kz') + '></label>';
    return (type === 'kz' ? ru + kz : kz + ru) + '<label>' + t('Заметка, если нужна') + '<input name="note" autocomplete="off"' + val('note') + '></label>';
  }
  if (type === 'en') return '<label>' + t('Слово') + '<input name="word" autocomplete="off" autocapitalize="off" lang="en"' + val('word') + '></label>' +
    '<label>' + t('Транскрипция') + '<input name="ipa" autocomplete="off" placeholder="/ˈstʌbən/"' + val('ipa') + '></label>' +
    '<label>' + t('Перевод') + '<input name="ru" autocomplete="off"' + val('ru') + '></label>' +
    '<label>' + t('Пояснение на английском') + '<input name="def" autocomplete="off" lang="en" placeholder="unwilling to change your opinion"' + val('def') + '></label>' +
    '<label>' + t('Предложения, по одному на строку') + '<textarea name="sentences" lang="en" placeholder="He was too {stubborn} to say sorry.">' + esc((c.sentences || []).join('\n')) + '</textarea></label>' +
    '<p class="help">' + t('Слово в предложении возьми в фигурные скобки: на карточке на его месте будет пропуск.') + '</p>';
  return '<label>' + t('Вопрос') + '<textarea name="q">' + esc(c.q || '') + '</textarea></label><label>' + t('Ответ') + '<textarea name="a">' + esc(c.a || '') + '</textarea></label>';
}

// Добавить карточку (cardId не задан) или исправить карточку cardId. after — что сделать после сохранения
// исправления (во время занятия — перерисовать карточку); по умолчанию — перерисовать экран.
function openCardForm(deckId, cardId = null, after = render) {
  const d = S.decks[deckId]; if (!d) return; const type = typeOf(d);
  const old = cardId ? (d.cards || []).find(c => c.id === cardId) : null;
  if (cardId && !old) return;
  openSheet('<h2>' + (old ? t('Исправить карточку') : t('Карточка в «{deck}»', { deck: esc(d.name) })) + '</h2>' + cardFieldsHTML(type, old || {}) +
    (old ? '<p class="help">' + t('Прогресс по карточке сохранится.') + '</p>' : '') +
    sheetRow(old ? t('Отмена') : t('Готово'), old ? t('Сохранить') : t('Добавить')),
    form => {
      const card = cardFromForm(type, n => { const el = form.elements.namedItem(n); return el ? el.value : ''; });
      const problem = cardProblem(type, card);
      if (problem) { toast(problem[0].toUpperCase() + problem.slice(1) + '.'); return; }
      const cur = S.decks[deckId]; if (!cur) { closeSheet(); return; }
      if (old) {
        putDeck(updateCard(cur, cardId, card)); closeSheet(); after(); toast(t('Карточка сохранена.'));
        return;
      }
      putDeck({ ...cur, cards: (cur.cards || []).concat([{ ...card, id: uid36('c') }]) });
      form.reset(); toast(t('Карточка добавлена.')); render();
      const first = $('input,textarea', form); if (first) first.focus();
    });
}

/* ---------- добавить колоды: от Claude и из файла ---------- */
// Как это устроено — см. начало js/claude.js.

const nCards = n => count(n, 'карточка', 'карточки', 'карточек');

// Что добавится — список под полем, до нажатия «Добавить».
function importPreviewHTML(r) {
  const items = r.details.map(x => {
    const where = x.parent && r.decks[x.parent] ? ' · ' + t('внутри «{deck}»', { deck: esc(r.decks[x.parent].name) }) : '';
    const name = esc(x.name);
    if (x.isNew) return '<li><b>' + t('Новая колода «{deck}»', { deck: name }) + '</b>: ' + nCards(x.added) + where +
      (x.skipped ? ', ' + t('повторы пропущены: {n}', { n: x.skipped }) : '') + '</li>';
    if (x.added) return '<li><b>' + t('«{deck}»', { deck: name }) + '</b>: +' + nCards(x.added) + (x.skipped ? ', ' + t('уже были: {n}', { n: x.skipped }) : '') + '</li>';
    return '<li><b>' + t('«{deck}»', { deck: name }) + '</b>: ' + t('ничего нового, все {cards} уже есть', { cards: nCards(x.skipped) }) + '</li>';
  });
  return '<p class="add-ok">' + t('Добавится:') + '</p><ul class="add-list">' + items.join('') + '</ul>';
}

function openAddSheet(targetId = null) {
  const target = targetId && S.decks[targetId] ? S.decks[targetId] : null;
  const form = openSheet('<h2>' + (target ? t('Карточки от Claude') : t('Добавить колоды')) + '</h2>' +
    (target ? '<p class="lead">' + t('Для колоды «{deck}». Инструкция подскажет Claude, какие карточки в ней уже есть.', { deck: esc(target.name) }) + '</p>' : '') +
    '<ol class="steps">' +
      '<li>' + t('Скопируй инструкцию и вставь её в чат с Claude. Ниже допиши, что нужно, например: «30 карточек на тему "Қала"».') + '</li>' +
      '<li>' + t('В ответе Claude нажми «Копировать» у блока с кодом.') + '</li>' +
      '<li>' + t('Вернись сюда, нажми «Вставить ответ Claude», проверь, что добавится, и нажми «Добавить».') + '</li>' +
    '</ol>' +
    '<div class="data-btns">' +
      '<button type="button" class="btn ghost" data-add="copy">' + t('Скопировать инструкцию для Claude') + '</button>' +
      '<button type="button" class="btn ghost" data-add="paste">' + t('Вставить ответ Claude') + '</button>' +
    '</div>' +
    '<div data-copy-box></div>' +
    '<label class="paste-box">' + t('Ответ Claude') + '<textarea name="paste" autocomplete="off" autocorrect="off" autocapitalize="off" spellcheck="false" placeholder=\'{"decks": [ … ]}\'></textarea></label>' +
    '<div data-add-preview></div>' +
    '<div class="row"><button type="button" class="btn ghost" data-close-btn="1">' + t('Отмена') + '</button><button class="btn dark" data-add-ok disabled>' + t('Добавить') + '</button></div>' +
    (target ? '' :
      '<h3 class="sheet-sec">' + t('Или') + '</h3>' +
      '<div class="data-btns">' +
        '<button type="button" class="btn ghost" data-add="new">' + t('Создать колоду самому') + '</button>' +
        '<button type="button" class="btn ghost" data-add="file">' + t('Добавить из файла') + '</button>' +
      '</div>' +
      '<p class="help" style="margin-top:12px">' + t('Файл — в формате decks.json. Колоды с тем же id дополняются новыми карточками, прогресс не теряется.') + '</p>' +
      '<input type="file" accept=".json,application/json" hidden data-file>'),
    () => importText(area.value, parsePasted));

  const area = form.elements.namedItem('paste'), box = $('[data-add-preview]', form), ok = $('[data-add-ok]', form);
  let lastError = '', timer = null;
  // Пока вставляешь или правишь текст — сразу показываем, что добавится, или что не так.
  const update = () => {
    lastError = ''; ok.disabled = true;
    if (!area.value.trim()) { box.innerHTML = ''; return; }
    try {
      const r = mergeDecks(S.decks, parsePasted(area.value));
      box.innerHTML = importPreviewHTML(r);
      ok.disabled = !r.changed.length;
    } catch (e) {
      lastError = e.message;
      box.innerHTML = '<p class="add-err">' + esc(e.message) + '</p>' +
        '<p class="help">' + t('Перешли эту ошибку Claude — он исправит.') + ' <button type="button" class="link inline" data-add="copy-err">' + t('Скопировать ошибку') + '</button></p>';
    }
  };
  area.addEventListener('input', () => { clearTimeout(timer); timer = setTimeout(update, 200); });

  // Скопировать текст. Если браузер не дал, показываем текст в поле и выделяем его — останется нажать
  // «Скопировать» в меню iPhone.
  const copyBox = $('[data-copy-box]', form);
  const copy = (text, done) => navigator.clipboard.writeText(text).then(() => { copyBox.innerHTML = ''; toast(done); })
    .catch(() => {
      copyBox.innerHTML = '<textarea readonly class="copy-area" aria-label="' + t('Текст для копирования') + '"></textarea>';
      const el = $('textarea', copyBox); el.value = text; el.focus(); el.select();
      toast(t('Не получилось скопировать само — текст выделен ниже, скопируй его.'));
    });
  const fileInput = $('[data-file]', form);
  if (fileInput) fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0]; if (!file) return;
    importText(await file.text(), parseDeckFile);
  });
  form.addEventListener('click', ev => {
    const b = ev.target.closest('[data-add]'); if (!b) return;
    const act = b.dataset.add;
    if (act === 'copy') copy(claudeInstructions(S.decks, target && target.id), t('Инструкция скопирована. Вставь её в чат с Claude и допиши, что нужно.'));
    else if (act === 'copy-err') copy(t('Приложение не приняло карточки: {e} Исправь, пожалуйста, и пришли JSON целиком заново.', { e: lastError }), t('Ошибка скопирована — вставь её в чат с Claude.'));
    else if (act === 'paste') {
      // На iPhone появится кнопка «Вставить» — её нужно нажать: так iOS спрашивает разрешение на буфер обмена.
      navigator.clipboard.readText()
        .then(text => { area.value = text; update(); })
        .catch(() => { area.focus(); toast(t('Не получилось вставить само: нажми в поле и выбери «Вставить».')); });
    }
    else if (act === 'new') { closeSheet(); openDeckForm(null); }
    else if (act === 'file') { fileInput.value = ''; fileInput.click(); }
  });
}

// Добавить колоды из текста. parse — как его разбирать: parsePasted (ответ Claude) или parseDeckFile (файл).
async function importText(text, parse) {
  let r;
  try { r = mergeDecks(S.decks, parse(text)); } catch (e) { toast(e.message); return; }
  if (!r.changed.length) { toast(t('Ничего нового: все эти карточки уже есть.')); return; }
  try { await S.db.write(['decks'], st => r.changed.forEach(d => st.decks.put(d))); }
  catch (e) { console.error(e); toast(t('Не удалось сохранить колоды: {e}', { e: errText(e) })); return; }
  S.decks = r.decks;
  closeSheet();
  // Одна колода — сразу открываем её, чтобы было видно, что добавилось.
  const touched = r.details.filter(x => x.isNew || x.added);
  if (touched.length === 1) S.view = { name: 'deck', id: touched[0].id };
  render(); window.scrollTo(0, 0);
  toast(t('Добавлено: {decks}, {cards}.', { decks: count(r.addedDecks, 'колода', 'колоды', 'колод'), cards: nCards(r.addedCards) }));
}

function lastBackupLine() {
  const at = S.meta.lastBackupAt;
  if (!at) return '<p class="last-backup old">' + t('Копий ещё не было.') + '</p>';
  const n = dayIndex() - dayIndex(at);
  const when = n <= 0 ? t('сегодня') : n === 1 ? t('вчера') : t('{days} назад', { days: count(n, 'день', 'дня', 'дней') });
  return '<p class="last-backup' + (n >= 14 ? ' old' : '') + '">' + t('Последняя копия: {when}.', { when }) + '</p>';
}

function openSettings() {
  const st = S.settings;
  const opt = (v, label, cur) => '<option value="' + v + '"' + (v === cur ? ' selected' : '') + '>' + label + '</option>';
  const form = openSheet('<h2>' + t('Настройки') + '</h2>' +
    // Подпись на двух языках: если язык выбран по ошибке, всё равно понятно, где его поменять.
    '<label>' + (getLang() === 'en' ? 'Language · Язык' : 'Язык · Language') + '<select name="lang" data-lang>' +
      opt('auto', t('Как на телефоне'), st.lang) + opt('ru', 'Русский', st.lang) + opt('en', 'English', st.lang) + '</select></label>' +
    '<label>' + t('Новых карточек в день на колоду') + '<input name="np" type="number" inputmode="numeric" min="0" max="200" value="' + st.newPerDay + '"></label>' +
    '<label>' + t('Ответов, чтобы день засчитался') + '<input name="goal" type="number" inputmode="numeric" min="1" max="500" value="' + st.goal + '"></label>' +
    '<p class="help">' + t('День засчитывается и тогда, когда ты повторил всё, что было на сегодня, даже если ответов меньше.') + '</p>' +
    '<label class="check"><input type="checkbox" name="streak"' + (st.streak ? ' checked' : '') + '>' + t('Показывать серию дней') + '</label>' +
    '<p class="help">' + t('Пропуск дня не обнуляет серию, пока на неделе есть заморозки: их две.') + '</p>' +
    '<label>' + t('Целевая запоминаемость:') + ' <b data-ret-val>' + Math.round(st.retention * 100) + ' %</b>' +
      '<input name="ret" type="range" min="80" max="95" step="1" value="' + Math.round(st.retention * 100) + '"></label>' +
    '<p class="help">' + t('Какую долю карточек ты вспоминаешь, когда они приходят на повторение. Выше — меньше забываешь, но больше повторений каждый день. 90 % — хороший выбор. Новое значение действует со следующих ответов.') + '</p>' +
    '<p class="help">' + t('«Выучено» — карточки, которые ты, по расчёту FSRS, будешь помнить хотя бы 3 недели.') + '</p>' +
    '<label>' + t('Кнопки ответа') + '<select name="btns">' +
      opt('2', t('Две: «Не знал» и «Знал»'), String(st.buttons)) + opt('4', t('Четыре: ещё «Трудно» и «Легко»'), String(st.buttons)) + '</select></label>' +
    '<p class="help">' + t('«Трудно» — вспомнил, но с трудом: карточка вернётся чуть раньше, чем после «Знал». «Легко» — знал сразу: вернётся намного позже. Свайпы те же: влево — «Не знал», вправо — «Знал».') + '</p>' +
    sheetRow(t('Отмена'), t('Сохранить')) +
    '<h3 class="sheet-sec">' + t('Тема') + '</h3>' +
    '<div class="themes" data-themes>' + themesHTML() + '</div>' +
    '<p class="help">' + t('Тема меняется сразу.') + '</p>' +
    '<div data-push-box></div>' +
    '<h3 class="sheet-sec">' + t('Данные') + '</h3>' +
    '<p class="help">' + t('Колоды и прогресс хранятся только на этом устройстве. Время от времени делай резервную копию и сохраняй её в «Файлы» или в облако.') + '</p>' +
    '<div data-last-backup>' + lastBackupLine() + '</div>' +
    '<div class="data-btns">' +
      '<button type="button" class="btn dark" data-data="backup">' + t('Сделать резервную копию') + '</button>' +
      '<button type="button" class="btn ghost" data-data="restore">' + t('Восстановить из копии') + '</button>' +
      (S.hasFsrsSnapshot ? '<button type="button" class="btn ghost" data-data="snapshot">' + t('Скачать копию до перехода на FSRS') + '</button>' : '') +
    '</div>' +
    '<p class="help" style="margin-top:12px">' + t('Новые колоды — от Claude или из файла — добавляются кнопкой «Добавить» на главном экране.') + '</p>' +
    (S.hasFsrsSnapshot ? '<p class="help">' + t('Копия до перехода на FSRS — данные в том виде, какими они были до обновления. Её можно восстановить кнопкой «Восстановить из копии».') + '</p>' : '') +
    '<input type="file" accept=".json,application/json" hidden data-file>' +
    '<div class="help-links"><button type="button" class="link" data-welcome>' + t('Как пользоваться') + '</button>' +
    (inIosSafari ? '<button type="button" class="link" data-install-hint>' + t('Как установить на экран «Домой»') + '</button>' : '') + '</div>' +
    '<p class="version">' + t('SayatSays, версия {v}', { v: VERSION }) + '</p>',
    form => {
      const F = n => form.elements.namedItem(n);
      const np = Math.max(0, Math.min(200, parseInt(F('np').value, 10) || 0));
      const goal = Math.max(1, Math.min(500, parseInt(F('goal').value, 10) || 1));
      const retention = Math.max(80, Math.min(95, parseInt(F('ret').value, 10) || 90)) / 100;
      S.settings = { ...S.settings, newPerDay: np, goal, streak: F('streak').checked, retention, buttons: F('btns').value === '4' ? 4 : 2 };
      S.scheduler = makeScheduler(retention);
      savePrefs();
      closeSheet(); render();
    });

  prepareBackup();
  const pushBox = $('[data-push-box]', form);
  fillPush(pushBox);
  const ret = form.elements.namedItem('ret');
  ret.addEventListener('input', () => { $('[data-ret-val]', form).textContent = ret.value + ' %'; });
  // Язык меняется сразу: сохраняем, перерисовываем экран и заново открываем настройки уже на новом языке.
  form.elements.namedItem('lang').addEventListener('change', ev => {
    const lang = ev.target.value; if (!isLang(lang)) return;
    S.settings = { ...S.settings, lang };
    savePrefs(); applyLang(lang); render(); openSettings();
  });
  const fileInput = $('[data-file]', form);
  let fileMode = null;
  form.addEventListener('click', ev => {
    if (ev.target.closest('[data-install-hint]')) { showInstallHint(); return; }
    if (ev.target.closest('[data-welcome]')) { showWelcome(); return; }
    const th = ev.target.closest('[data-theme-id]'); if (th) { chooseTheme(th.dataset.themeId, form); return; }
    const p = ev.target.closest('[data-push]'); if (p) { pushAction(p.dataset.push, pushBox); return; }
    const b = ev.target.closest('[data-data]'); if (!b) return;
    if (b.dataset.data === 'backup') doBackup();
    else if (b.dataset.data === 'snapshot') downloadSnapshot();
    else { fileMode = b.dataset.data; fileInput.value = ''; fileInput.click(); }
  });
  fileInput.addEventListener('change', async () => {
    const file = fileInput.files && fileInput.files[0]; if (!file) return;
    const text = await file.text();
    if (fileMode === 'restore') restoreFrom(text);
  });
}

/* ---------- напоминания ---------- */
// Как устроены напоминания — см. начало js/push.js. Здесь только раздел в настройках и число на иконке.

// Число на иконке приложения — сколько карточек на сегодня, как на кнопке «Повторить всё».
function updateBadge() { if (S.ready) setBadge(todayTotal(S, dayIndex())); }
document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') updateBadge(); });

// Репозиторий, из которого открыт сайт (у копии проекта — её собственный), и ссылки в нём.
const REPO_URL = repoFromLocation(location.hostname, location.pathname);
const SECRETS_URL = REPO_URL + '/settings/secrets/actions';
const REMINDERS_DOC_URL = REPO_URL + '/blob/main/docs/DEVELOPMENT.md#напоминания';

// Раздел в настройках. Напоминания по расписанию присылает GitHub, и настроить их может только владелец
// копии проекта на GitHub. Поэтому:
//   — если этот телефон уже подписан на напоминания (так у Ромы), раздел «Напоминания» — как раньше;
//   — иначе раздел «Число на иконке» (работает у всех), а напоминания — свёрнутым пунктом для владельцев копий.
// justEnabled — только что подписались: сразу раскрыть инструкцию.
async function fillPush(box, justEnabled) {
  const status = pushStatus();
  let sub = null;
  if (status !== 'install' && status !== 'unsupported') {
    try { sub = await currentSubscription(); } catch (e) { console.error(e); }
  }
  box.innerHTML = sub ? '<h3 class="sheet-sec">' + t('Напоминания') + '</h3>' + subscribedHTML(sub, justEnabled)
    : '<h3 class="sheet-sec">' + t('Число на иконке') + '</h3>' + badgeHTML() + (status === 'ready' ? ownerRemindersHTML() : '');
}

function badgeHTML() {
  const st = badgeStatus();
  const help = text => '<p class="help">' + text + '</p>';
  if (st === 'install') return help(t('Когда откроешь SayatSays с экрана «Домой», на иконке можно будет показывать, сколько карточек на сегодня.'));
  if (st === 'unsupported') return help(t('Это устройство не умеет показывать число на иконке. На iPhone нужна iOS 16.4 или новее.'));
  if (st === 'on') return help(t('Включено: на иконке — сколько карточек на сегодня, как на кнопке «Повторить всё».'));
  if (st === 'denied') return help(t('Уведомления для SayatSays запрещены, поэтому iPhone не показывает число на иконке. Включить: Настройки iPhone → Уведомления → SayatSays → разреши уведомления и «Наклейки».'));
  return help(t('Сколько карточек на сегодня — прямо на иконке приложения. iPhone покажет число, только если разрешить уведомления; присылать уведомления приложение не будет.')) +
    '<div class="data-btns"><button type="button" class="btn ghost" data-push="badge">' + t('Показывать число на иконке') + '</button></div>';
}

// Свёрнутый пункт для тех, у кого своя копия проекта на GitHub.
function ownerRemindersHTML() {
  const link = '<a href="' + REMINDERS_DOC_URL + '" target="_blank" rel="noopener">' + t('в инструкции для разработчиков') + '</a>';
  return '<details class="push-sub owner"><summary>' + t('Напоминания по расписанию') + '</summary>' +
    '<p class="help">' + t('Утром и вечером присылает GitHub из репозитория проекта. Поэтому они работают только у того, кто сделал свою копию проекта на GitHub и настроил ключи: как это сделать — {link}. Если копия твоя — включай:', { link }) + '</p>' +
    '<div class="data-btns"><button type="button" class="btn ghost" data-push="enable">' + t('Включить напоминания') + '</button></div></details>';
}

function subscribedHTML(sub, justEnabled) {
  const link = '<a href="' + SECRETS_URL + '" target="_blank" rel="noopener">' + t('секреты репозитория на GitHub') + '</a>';
  return '<p class="help">' + t('Напоминания включены на этом телефоне. Время задаётся на GitHub, в файле .github/workflows/reminder.yml.') + '</p>' +
    '<details class="push-sub"' + (justEnabled ? ' open' : '') + '><summary>' + t('Подписка для GitHub') + '</summary>' +
      '<ol class="steps">' +
        '<li>' + t('Нажми «Скопировать».') + '</li>' +
        '<li>' + t('Открой {link} и нажми «New repository secret».', { link }) + '</li>' +
        '<li>' + t('Name: {name}, в Secret вставь скопированное, нажми «Add secret». Если такой секрет уже есть — нажми карандаш рядом с ним и вставь новое.', { name: '<b>PUSH_SUBSCRIPTION</b>' }) + '</li>' +
        '<li>' + t('Проверь: на GitHub открой Actions → «Напоминание» → «Run workflow».') + '</li>' +
      '</ol>' +
      '<textarea readonly data-sub-text>' + esc(subscriptionText(sub)) + '</textarea>' +
      '<div class="data-btns">' +
        '<button type="button" class="btn dark" data-push="copy">' + t('Скопировать') + '</button>' +
        '<button type="button" class="btn ghost" data-push="renew">' + t('Создать новую подписку') + '</button>' +
      '</div>' +
      '<p class="help" style="margin-top:12px">' + t('Новая подписка нужна, если GitHub пишет «подписка устарела». После неё обнови секрет PUSH_SUBSCRIPTION.') + '</p>' +
    '</details>' +
    '<div class="data-btns"><button type="button" class="btn ghost" data-push="test">' + t('Проверить уведомление') + '</button></div>';
}

function pushAction(act, box) {
  if (act === 'badge') {
    // Тоже прямо из нажатия: иначе iPhone не спросит разрешение.
    enableBadge()
      .then(p => { fillPush(box); updateBadge(); toast(p === 'granted' ? t('Готово: на иконке будет число карточек на сегодня.') : t('Без разрешения iPhone не покажет число на иконке.')); })
      .catch(e => { console.error(e); toast(t('Не получилось: {e}', { e: errText(e) })); });
  } else if (act === 'enable' || act === 'renew') {
    if (act === 'renew' && !confirm(t('Старая подписка перестанет работать, и секрет PUSH_SUBSCRIPTION на GitHub нужно будет обновить. Создать новую?'))) return;
    // enablePush вызываем сразу из нажатия: иначе iPhone не покажет вопрос о разрешении.
    enablePush(act === 'renew')
      .then(() => { fillPush(box, true); updateBadge(); toast(t('Напоминания включены. Осталось добавить подписку на GitHub.')); })
      .catch(e => { console.error(e); toast((e && e.message) || t('Не получилось включить напоминания.')); fillPush(box); });
  } else if (act === 'copy') {
    const area = $('[data-sub-text]', box);
    navigator.clipboard.writeText(area.value)
      .then(() => toast(t('Скопировано. Теперь вставь на GitHub.')))
      .catch(() => { area.focus(); area.select(); toast(t('Не получилось скопировать само — текст выделен, скопируй его.')); });
  } else if (act === 'test') {
    testReminder()
      .then(() => toast(t('Готово. Если уведомления не видно — смахни вниз от верхнего края экрана.')))
      .catch(e => { console.error(e); toast(t('Не получилось: {e}', { e: errText(e) })); });
  }
}

/* ---------- данные: копия, восстановление, импорт ---------- */

// Содержимое базы для копии читаем заранее, когда открываются настройки. Причина: Safari разрешает
// открыть лист «Поделиться» только сразу после нажатия, и если по нажатию сначала читать базу, он может отказать.
let preparedData = null, preparedSnapshot = null;
function prepareBackup() {
  preparedData = null;
  if (S.hasFsrsSnapshot) S.db.get('snapshots', 'before-fsrs').then(s => (preparedSnapshot = s)).catch(e => console.error(e));
  return S.db.exportAll().then(d => (preparedData = d)).catch(e => { console.error(e); return null; });
}

// Отдать файл: на телефоне — лист «Поделиться» (там есть «Сохранить в Файлы»), на компьютере — скачивание.
// Возвращает false, если лист «Поделиться» закрыли, ничего не сохранив.
async function deliverFile(file) {
  const phone = matchMedia('(pointer: coarse)').matches;
  try {
    if (phone && navigator.canShare && navigator.canShare({ files: [file] })) await navigator.share({ files: [file] });
    else downloadFile(file);
  } catch (e) {
    if (e && e.name === 'AbortError') return false;
    console.error(e);
    downloadFile(file); // лист не открылся — тогда просто скачиваем файл
  }
  return true;
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
  if (!data) { toast(t('Не удалось прочитать данные для копии.')); return; }
  const now = Date.now();
  const file = new File([JSON.stringify(makeBackup(data, now), null, 2)], backupFileName(now), { type: 'application/json' });
  if (!(await deliverFile(file))) return; // закрыл лист «Поделиться» — копия не сделана
  S.meta = { ...S.meta, key: 'meta', lastBackupAt: now };
  saved(S.db.write(['settings'], s => s.settings.put(S.meta)));
  const line = $('[data-last-backup]'); if (line) line.innerHTML = lastBackupLine();
  toast(t('Резервная копия готова.'));
}

// Снимок базы перед переходом на FSRS — в том же формате, что обычная резервная копия.
async function downloadSnapshot() {
  const snap = preparedSnapshot || await S.db.get('snapshots', 'before-fsrs');
  if (!snap) { toast(t('Копии до перехода на FSRS нет.')); return; }
  const name = backupFileName(snap.createdAt).replace('backup', 'before-fsrs');
  const file = new File([JSON.stringify(makeBackup(snap.data, snap.createdAt), null, 2)], name, { type: 'application/json' });
  if (await deliverFile(file)) toast(t('Копия до перехода на FSRS готова.'));
}

async function restoreFrom(text) {
  let b;
  try { b = parseBackup(text); } catch (e) { toast(e.message); return; }
  const when = new Date(b.exportedAt).toLocaleString(locale(), { day: 'numeric', month: 'long', year: 'numeric', hour: '2-digit', minute: '2-digit' });
  const cards = b.data.decks.reduce((n, d) => n + d.cards.length, 0);
  if (!confirm(t('Восстановить копию от {when}?', { when }) + '\n\n' + t('В ней колод: {decks}, карточек: {cards}.', { decks: b.data.decks.length, cards }) + '\n' +
    t('Все текущие данные на этом устройстве — колоды, прогресс, серия и настройки — заменятся данными из копии.'))) return;
  try {
    await S.db.replaceAll(dataForRestore(b));
    await migrateToFsrs(S.db); // копия могла быть сделана ещё до FSRS — тогда карточки переводятся так же
    await loadAll();
  } catch (e) { console.error(e); toast(t('Не удалось восстановить: {e}', { e: errText(e) })); return; }
  closeSheet(); S.session = null; S.view = { name: 'home' }; render(); window.scrollTo(0, 0);
  toast(t('Данные восстановлены из копии.'));
}

/* ---------- удаление ---------- */
function deleteDeck(id) {
  const d = S.decks[id]; if (!d) return;
  const ids = descendants(S.decks, id);
  if (!confirm((ids.length > 1 ? t('Удалить «{deck}» вместе с подколодами?', { deck: d.name }) : t('Удалить «{deck}»?', { deck: d.name })) +
    ' ' + t('Карточки и прогресс по ним пропадут.'))) return;
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
  if (!confirm(t('Удалить карточку «{card}»?', { card: s[0] }))) return;
  const nd = { ...d, cards: d.cards.filter(c => c.id !== cardId) };
  S.decks = { ...S.decks, [deckId]: nd };
  if (S.prog[deckId]) delete S.prog[deckId][cardId];
  saved(S.db.write(['decks', 'cardState'], st => { st.decks.put(nd); st.cardState.delete([deckId, cardId]); }));
  render();
}

/* ---------- темы ---------- */
// Список тем — в js/themes.js, цвета — в css/app.css. Тема — атрибут data-theme у <html>;
// «Как в системе» — без атрибута, тогда светлая или тёмная выбирается по настройке iPhone.

// Включить тему: атрибут, цвет полосы со временем вверху экрана и копия в localStorage для index.html.
function applyTheme(id) {
  const theme = isTheme(id) ? id : DEFAULT_THEME, root = document.documentElement;
  if (theme === DEFAULT_THEME) delete root.dataset.theme; else root.dataset.theme = theme;
  try { localStorage.setItem(THEME_KEY, theme); } catch (e) { /* в приватном режиме localStorage может не работать */ }
  const bg = getComputedStyle(root).getPropertyValue('--bg').trim();
  for (const m of document.querySelectorAll('meta[name="theme-color"]')) {
    if (!m.dataset.system) m.dataset.system = m.content; // исходные цвета из index.html — для «Как в системе»
    m.content = theme === DEFAULT_THEME ? m.dataset.system : bg;
  }
}

// Образцы тем в настройках. Каждый образец рисуется цветами своей темы: атрибут data-swatch
// подставляет её переменные (см. css/app.css).
function themesHTML() {
  return THEMES.map(th => '<button type="button" class="theme-sw" data-theme-id="' + th.id + '" aria-pressed="' + (S.settings.theme === th.id) + '">' +
    '<span class="pv" data-swatch="' + th.id + '" aria-hidden="true"><span class="pv-card"><i></i><i></i></span>' +
    '<span class="pv-dots"><i style="background:var(--kz)"></i><i style="background:var(--en)"></i><i style="background:var(--qa)"></i></span>' +
    '<span class="pv-btn"></span></span>' +
    '<span class="nm">' + esc(t(th.name)) + '</span></button>').join('');
}

function chooseTheme(id, form) {
  if (!isTheme(id)) return;
  S.settings = { ...S.settings, theme: id };
  applyTheme(id);
  savePrefs();
  for (const b of form.querySelectorAll('[data-theme-id]')) b.setAttribute('aria-pressed', String(b.dataset.themeId === id));
}

/* ---------- статистика ---------- */
// Подсчёты — в js/stats.js. Журнал ответов в памяти не держим: читаем его из базы, когда открывается экран.

function openStats() {
  S.view = { name: 'stats' }; S.statsLogs = null; S.statsSel = { answers: 29, forecast: 0 };
  render(); window.scrollTo(0, 0);
  S.db.getAll('reviewLog')
    .then(logs => { S.statsLogs = logs; })
    .catch(e => { console.error(e); S.statsLogs = []; toast(t('Не удалось прочитать журнал ответов.')); })
    .then(() => { if (S.view.name === 'stats') render(); });
}

// Даты — на языке интерфейса.
function dayLabel(d, opts) { return new Date(dayStart(d)).toLocaleDateString(locale(), opts); }
const dayFull = d => { const s = dayLabel(d, { weekday: 'short', day: 'numeric', month: 'long' }); return s[0].toUpperCase() + s.slice(1); };
const pct = x => x == null ? '—' : Math.round(x * 100) + ' %';
const nAnswers = n => count(n, 'ответ', 'ответа', 'ответов');

// Столбики без библиотек. items — [{ n, … }], sel — выбранный столбик (его подпись показана под графиком),
// label(x, i) — подпись под столбиком (может быть пустой), describe(x, i) — полный текст про столбик.
function barsHTML(chart, items, sel, label, describe) {
  const top = Math.max(0, ...items.map(x => x.n)), max = top || 1;
  // Линия сверху — самое большое значение (подпись справа); если всё по нулям, линии нет.
  let h = '<div class="chart"><div class="bars">' + (top ? '<span class="gmax">' + top + '</span>' : '');
  items.forEach((x, i) => {
    h += '<button type="button" data-act="bar" data-chart="' + chart + '" data-i="' + i + '" aria-pressed="' + (i === sel) + '" aria-label="' + esc(describe(x, i)) + '">' +
      (x.n ? '<i style="height:' + (x.n / max * 100).toFixed(1) + '%"></i>' : '') + '</button>';
  });
  h += '</div><div class="axis" aria-hidden="true">' + items.map((x, i) => '<span' + (i === sel ? ' class="on"' : '') + '>' + label(x, i) + '</span>').join('') + '</div>';
  return h + '<p class="readout" aria-live="polite">' + esc(describe(items[sel], sel)) + '</p></div>';
}

function tableHTML(head, rows) {
  return '<details class="tbl"><summary>' + t('Числа таблицей') + '</summary><table><thead><tr>' + head.map(x => '<th>' + x + '</th>').join('') + '</tr></thead><tbody>' +
    rows.map(r => '<tr>' + r.map(x => '<td>' + esc(x) + '</td>').join('') + '</tr>').join('') + '</tbody></table></details>';
}

function statsHTML() {
  let h = '<button class="back-btn" data-act="home">' + ICON.back + t('Колоды') + '</button><h1 class="deck-h stats-h">' + t('Статистика') + '</h1>';
  if (!S.statsLogs) return h + '<div class="empty"><p>' + t('Загружаю…') + '</p></div>';
  const today = dayIndex(), logs = S.statsLogs, sel = S.statsSel;
  const days = answersByDay(S.days, logs, today, 30), fc = forecast(S, today, 14), tt = totals(S, today);
  const week = goodShare(logs, today, 7), month = goodShare(logs, today, 30);
  const sum = days.reduce((a, d) => a + d.n, 0), done = days.filter(d => d.done).length;
  const tile = (label, value, sub) => '<div class="tile"><span class="lb">' + label + '</span><b class="vl">' + value + '</b><span class="sub">' + sub + '</span></div>';

  h += '<div class="tiles">' +
    tile(t('Ответов за 30 дней'), sum, t('засчитано дней: {n}', { n: done })) +
    tile(t('«Знал» за 7 дней'), pct(week.share), t('за 30 дней: {p}', { p: pct(month.share) })) +
    tile(t('Выучено'), tt.learned, t('из {cards}', { cards: nCards(tt.total) })) +
    tile(t('Изучаются'), tt.learning, t('новых: {n}', { n: tt.nw })) +
  '</div>';

  const describeDay = x => {
    if (!x.n) return t('{day}: ответов не было', { day: dayFull(x.day) });
    if (!x.logged) return t('{day}: {answers} (до перехода на FSRS оценки не записывались)', { day: dayFull(x.day), answers: nAnswers(x.n) });
    return t('{day}: {answers}, «знал» — {good} ({p})', { day: dayFull(x.day), answers: nAnswers(x.n), good: x.good, p: pct(x.good / x.logged) });
  };
  h += '<div class="sec"><h2>' + t('Ответы по дням') + '</h2></div>' +
    barsHTML('answers', days, sel.answers, (x, i) => (days.length - 1 - i) % 7 ? '' : dayLabel(x.day, { day: 'numeric', month: 'numeric' }), describeDay) +
    tableHTML([t('День'), t('Ответов'), t('«Знал»')], days.slice().reverse().map(x => [dayFull(x.day), String(x.n), x.logged ? x.good + ' (' + pct(x.good / x.logged) + ')' : '—']));

  const describeFc = (x, i) => i ? t('{day}: {cards} на повторение', { day: dayFull(x.day), cards: nCards(x.n) })
    : t('Сегодня: {cards} на повторение, вместе с просроченными', { cards: nCards(x.n) });
  h += '<div class="sec"><h2>' + t('Прогноз на 2 недели') + '</h2></div>' +
    barsHTML('forecast', fc, sel.forecast, x => dayLabel(x.day, { day: 'numeric' }), describeFc) +
    '<p class="note">' + t('Сколько карточек придёт на повторение, если повторять всё вовремя. Новые не считаются: их до {n} в день на колоду.', { n: S.settings.newPerDay }) + '</p>' +
    tableHTML([t('День'), t('Карточек')], fc.map((x, i) => [i ? dayFull(x.day) : t('Сегодня'), String(x.n)]));

  h += '<p class="note stats-foot">' + t('За всё время: {answers}, засчитано дней: {n}.', { answers: nAnswers(tt.answers), n: tt.daysDone }) +
    (logs.length < tt.answers ? ' ' + t('Доля «знал» считается с перехода на FSRS: раньше оценки не записывались.') : '') + '</p>';
  return h;
}

/* ---------- events ---------- */
$('#app').addEventListener('click', ev => {
  const b = ev.target.closest('[data-act]'); if (!b || b.disabled) return;
  const act = b.dataset.act, id = b.dataset.id;
  switch (act) {
    case 'settings': openSettings(); break;
    case 'stats': openStats(); break;
    case 'bar': S.statsSel = { ...S.statsSel, [b.dataset.chart]: +b.dataset.i }; render(); break;
    case 'add': openAddSheet(id || null); break;
    case 'edit-deck': openDeckEdit(id); break;
    case 'edit-card': openCardForm(b.dataset.deck, b.dataset.card); break;
    case 'edit-current': { const c = S.session && S.session.current; if (c) openCardForm(c.item.deck, c.item.card, renderStudy); break; }
    case 'home': S.view = { name: 'home' }; render(); window.scrollTo(0, 0); break;
    case 'open-deck': S.view = { name: 'deck', id }; render(); window.scrollTo(0, 0); break;
    case 'study-all': startStudy(Object.keys(S.decks), { name: 'home' }); break;
    case 'study-deck': startStudy(descendants(S.decks, id), { name: 'deck', id }); break;
    case 'add-deck': openDeckForm(b.dataset.parent || null); break;
    case 'add-card': openCardForm(id); break;
    case 'del-card': deleteCard(b.dataset.deck, b.dataset.card); break;
    case 'del-deck': deleteDeck(id); break;
    case 'flip': if (suppressClick) return; flip(); break;
    case 'answer': answer(+b.dataset.rating); break;
    case 'undo': undo(); break;
    case 'close': case 'finish': endStudy(); break;
  }
});
document.addEventListener('keydown', ev => {
  if ($('#sheet').innerHTML) { if (ev.key === 'Escape') closeSheet(); return; }
  if (S.view.name !== 'study' || !S.session) return;
  if (ev.target.closest && ev.target.closest('input,textarea,select')) return;
  if (ev.key === ' ' || ev.key === 'Enter') { ev.preventDefault(); if (S.session.current) flip(); else endStudy(); }
  else if (S.session.flipped && (ev.key === 'ArrowLeft' || ev.key === 'ArrowRight')) answer(ev.key === 'ArrowLeft' ? Rating.Again : Rating.Good);
  else if (S.session.flipped && /^[1-4]$/.test(ev.key)) {
    // 1 — «Не знал», последняя цифра — «Знал» или «Легко»: 1–2 для двух кнопок, 1–4 для четырёх.
    const r = answerRatings()[+ev.key - 1];
    if (r) answer(r);
  }
  else if (ev.key === 'Escape') endStudy();
  else if ((ev.key === 'z' || ev.key === 'я') && (ev.metaKey || ev.ctrlKey)) undo();
});

/* ---------- установка на экран «Домой» и обновления ---------- */

// Открыто в Safari на iPhone или iPad, а не с экрана «Домой». Свойство navigator.standalone есть только
// в Safari на iOS: false — обычная вкладка, true — приложение с экрана «Домой». В других браузерах его нет.
const inIosSafari = navigator.standalone === false;

// Подсказка, как поставить приложение на экран «Домой». Сама показывается один раз, потом — из настроек.
function showInstallHint() {
  S.meta = { ...S.meta, key: 'meta', installHintAt: Date.now() };
  saved(S.db.write(['settings'], s => s.settings.put(S.meta)));
  openSheet('<h2>' + t('Установи на экран «Домой»') + '</h2>' +
    '<p class="lead">' + t('Так SayatSays откроется как обычное приложение: на весь экран, со своей иконкой и без интернета.') + '</p>' +
    '<ol class="steps">' +
      '<li>' + t('Нажми «Поделиться» — квадрат со стрелкой вверх. В новых iOS он может быть в меню «•••».') + '</li>' +
      '<li>' + t('Выбери «На экран Домой» и нажми «Добавить».') + '</li>' +
      '<li>' + t('Дальше открывай SayatSays иконкой с экрана «Домой».') + '</li>' +
    '</ol>' +
    '<p class="help">' + t('Важно: у Safari и у приложения на экране «Домой» разные данные, прогресс отсюда сам туда не перейдёт. Если ты уже занимался здесь, в Safari, сделай резервную копию (Настройки → Данные) и восстанови её в приложении.') + '</p>' +
    '<div class="row"><button class="btn dark">' + t('Понятно') + '</button></div>',
    () => closeSheet());
}

// Знакомство с приложением: само показывается один раз на новом устройстве, потом — из настроек («Как пользоваться»).
function showWelcome() {
  S.meta = { ...S.meta, key: 'meta', welcomeAt: Date.now() };
  saved(S.db.write(['settings'], s => s.settings.put(S.meta)));
  openSheet('<h2>' + t('Привет!') + '</h2>' +
    '<p class="lead">' + t('SayatSays — карточки для интервального повторения. Приложение само решает, какую карточку когда показать, чтобы ты повторял её как раз перед тем, как забудешь.') + '</p>' +
    '<ol class="steps">' +
      '<li>' + t('Для начала здесь есть колоды: казахский (слова и термины для экзамена) и английский для NUET. Не нужны — открой колоду и нажми «Удалить колоду» внизу.') + '</li>' +
      '<li>' + t('«Повторить всё» — занятие по всем колодам. Подумай, переверни карточку и честно ответь «Не знал» или «Знал». Можно смахнуть: влево — не знал, вправо — знал.') + '</li>' +
      '<li>' + t('Свои карточки — кнопка «Добавить» на главном экране. Проще всего попросить Claude: там есть инструкция для него.') + '</li>' +
      '<li>' + t('Всё хранится только на этом устройстве. Время от времени делай резервную копию: Настройки → Данные.') + '</li>' +
    '</ol>' +
    '<p class="help">' + t('В настройках — язык, темы, четыре кнопки ответа вместо двух и число на иконке, значок со столбиками — статистика.') + '</p>' +
    '<div class="row"><button class="btn dark">' + t('Начать') + '</button></div>',
    () => closeSheet());
}

// Service worker (sw.js) хранит приложение на устройстве и скачивает новые версии.
// Новая версия сначала ждёт: показываем плашку, и по «Обновить» включаем её и перезагружаем страницу.
let reloadOnUpdate = false;
async function setupServiceWorker() {
  // Service worker работает только по https и на localhost. По http с другого компьютера его не будет.
  if (!('serviceWorker' in navigator)) return;
  try {
    const reg = await navigator.serviceWorker.register('./sw.js');
    // controller есть, если страницей уже управляет прошлая версия, — значит, это обновление, а не первая установка.
    const offer = () => { if (reg.waiting && navigator.serviceWorker.controller) showUpdateBar(reg.waiting); };
    offer();
    reg.addEventListener('updatefound', () => {
      const sw = reg.installing;
      if (sw) sw.addEventListener('statechange', () => { if (sw.state === 'installed') offer(); });
    });
    navigator.serviceWorker.addEventListener('controllerchange', () => { if (reloadOnUpdate) location.reload(); });
    // iPhone сам проверяет обновления редко, поэтому проверяем каждый раз, когда возвращаешься в приложение.
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'visible') reg.update().catch(() => {}); });
  } catch (e) {
    console.error('Service worker не зарегистрировался', e);
  }
}

function showUpdateBar(worker) {
  if ($('#update-bar')) return;
  const bar = document.createElement('div');
  bar.id = 'update-bar';
  bar.setAttribute('role', 'status');
  bar.innerHTML = '<span>' + t('Доступно обновление') + '</span><button type="button">' + t('Обновить') + '</button>';
  bar.querySelector('button').addEventListener('click', ev => {
    ev.currentTarget.disabled = true;
    reloadOnUpdate = true;
    worker.postMessage('skipWaiting'); // sw.js включит новую версию, после этого сработает controllerchange
  });
  document.body.appendChild(bar);
}

init();
setupServiceWorker();
