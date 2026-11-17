// Статистика: ответы по дням, доля «знал», прогноз, итоги.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyState } from './helpers.js';
import { answersByDay, goodShare, forecast, totals } from '../js/stats.js';
import { todayTotal, deckCounts } from '../js/decks.js';
import { startSession, nextItem, answerCard } from '../js/study.js';
import { makeScheduler, Rating } from '../js/scheduler.js';
import { dayStart } from '../js/streak.js';

const TODAY = 20773;
const NOW = dayStart(TODAY) + 8 * 3600e3;
const HOUR = 3600e3;
// Запись журнала: ответ в день d (через h часов после начала учебного дня) с оценкой rating.
let id = 0;
const log = (d, rating, h = 2) => ({ id: ++id, review: dayStart(d) + h * HOUR, rating });

test('ответы по дням: число из статистики дней, «знал» — из журнала', () => {
  const days = {
    [TODAY - 40]: { day: TODAY - 40, n: 99, done: true },  // старше 30 дней — не попадает
    [TODAY - 10]: { day: TODAY - 10, n: 12, done: true },  // день из артефакта: журнала нет
    [TODAY - 1]: { day: TODAY - 1, n: 4, done: false },
    [TODAY]: { day: TODAY, n: 3, done: false }
  };
  const logs = [log(TODAY - 1, Rating.Good), log(TODAY - 1, Rating.Again), log(TODAY - 1, Rating.Hard), log(TODAY - 1, Rating.Easy),
    log(TODAY, Rating.Good), log(TODAY, Rating.Good), log(TODAY, Rating.Again, 23.5)]; // 3:30 следующей ночи — ещё сегодня
  const r = answersByDay(days, logs, TODAY, 30);
  assert.equal(r.length, 30);
  assert.equal(r[0].day, TODAY - 29);
  assert.equal(r.at(-1).day, TODAY);
  assert.deepEqual(r.at(-1), { day: TODAY, n: 3, logged: 3, good: 2, done: false });
  assert.deepEqual(r.at(-2), { day: TODAY - 1, n: 4, logged: 4, good: 3, done: false }, '«Трудно» и «Легко» — тоже вспомнил');
  assert.deepEqual(r.at(-11), { day: TODAY - 10, n: 12, logged: 0, good: 0, done: true });
  assert.equal(r.reduce((a, x) => a + x.n, 0), 19);
});

test('доля «знал» за 7 и 30 дней', () => {
  const logs = [log(TODAY, Rating.Good), log(TODAY - 6, Rating.Again), log(TODAY - 7, Rating.Again), log(TODAY - 29, Rating.Good), log(TODAY - 30, Rating.Again)];
  assert.deepEqual(goodShare(logs, TODAY, 7), { total: 2, good: 1, share: 0.5 });
  assert.deepEqual(goodShare(logs, TODAY, 30), { total: 4, good: 2, share: 0.5 });
  assert.deepEqual(goodShare([], TODAY, 7), { total: 0, good: 0, share: null });
});

test('прогноз: сегодня — все просроченные, плюс новые = кнопка «Повторить всё»', async () => {
  const S = await legacyState(NOW);
  const fc = forecast(S, TODAY, 14);
  assert.equal(fc.length, 14);
  assert.deepEqual(fc.map(x => x.day), Array.from({ length: 14 }, (_, i) => TODAY + i));
  let fresh = 0;
  for (const id in S.decks) { const c = deckCounts(S, id, false, TODAY); fresh += c.today - countDue(S, id); }
  assert.equal(fc[0].n + fresh, todayTotal(S, TODAY));
  // Карточки, которые учат (не новые), — все где-то в прогнозе или позже двух недель.
  const t = totals(S, TODAY);
  assert.ok(fc.reduce((a, x) => a + x.n, 0) <= t.learning + t.learned);
});
// Сколько карточек колоды на повторение сегодня (без новых) — как в прогнозе.
function countDue(S, id) { return forecast({ ...S, decks: { [id]: S.decks[id] } }, TODAY, 1)[0].n; }

test('прогноз сдвигается после ответа: «Знал» убирает карточку с сегодняшнего дня', async () => {
  const S = await legacyState(NOW);
  const before = forecast(S, TODAY, 14);
  const ses = startSession(S, Object.keys(S.decks), TODAY, () => 0.5);
  ses.current = nextItem(ses, NOW);
  // Первая в очереди — повторение (не новая); после «Легко» она уйдёт на несколько дней вперёд.
  assert.ok(S.prog[ses.current.item.deck] && S.prog[ses.current.item.deck][ses.current.item.card]);
  answerCard(S, ses, makeScheduler(), Rating.Easy, NOW, TODAY);
  const after = forecast(S, TODAY, 14);
  assert.equal(after[0].n, before[0].n - 1);
  assert.equal(after.reduce((a, x) => a + x.n, 0), before.reduce((a, x) => a + x.n, 0), 'карточка в пределах двух недель');
});

test('итоги по всем колодам', async () => {
  const S = await legacyState(NOW);
  const t = totals(S, TODAY);
  assert.equal(t.total, 242);
  assert.equal(t.nw + t.learning + t.learned, 242);
  assert.equal(t.nw, 242 - 80);
  assert.equal(t.answers, Object.values(S.days).reduce((a, d) => a + (d.n || 0), 0));
  assert.equal(t.daysDone, Object.values(S.days).filter(d => d.done).length);
});
