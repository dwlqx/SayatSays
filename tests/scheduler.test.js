// Расписание FSRS: настройки, ответы, подписи интервалов, «выучено».
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { makeScheduler, review, preview, formatInterval, isNew, isLearning, isLearned, isDue, toStored, fromStored, State, Rating, LEARNED_STABILITY } from '../js/scheduler.js';
import { dayIndex, dayStart } from '../js/streak.js';

const now = dayStart(20773) + 8 * 3600e3; // учебный день 20773, 12:00
const MIN = 60e3, DAY = 864e5;

test('настройки: FSRS-6, шаги 1m/10m и 10m, максимум 365 дней, запоминаемость 90 % по умолчанию', () => {
  const p = makeScheduler().parameters;
  assert.equal(p.w.length, 21, 'у FSRS-6 21 параметр');
  assert.equal(p.request_retention, 0.9);
  assert.equal(p.maximum_interval, 365);
  assert.equal(p.enable_fuzz, true);
  assert.deepEqual(p.learning_steps, ['1m', '10m']);
  assert.deepEqual(p.relearning_steps, ['10m']);
  assert.equal(makeScheduler(0.85).parameters.request_retention, 0.85);
});

test('«Знал» на новой карточке переводит её в Learning: снова через 10 минут', () => {
  const s = makeScheduler();
  const { next, log } = review(s, null, Rating.Good, now);
  assert.equal(next.state, State.Learning);
  assert.ok(isLearning(next));
  assert.equal(next.due - now, 10 * MIN);
  assert.equal(log.rating, Rating.Good);
  assert.equal(log.state, State.New, 'в журнале — состояние ДО ответа');
  assert.equal(log.review, now);
});

test('«Не знал» на новой карточке — снова через минуту; два «Знал» подряд — на повторение на дни', () => {
  const s = makeScheduler();
  assert.equal(review(s, null, Rating.Again, now).next.due - now, MIN);
  const a = review(s, null, Rating.Good, now).next;
  const b = review(s, a, Rating.Good, now + 10 * MIN).next;
  assert.equal(b.state, State.Review);
  assert.ok(b.due - (now + 10 * MIN) >= DAY);
});

test('подписи под кнопками совпадают с тем, что получится после ответа', () => {
  const s = makeScheduler();
  const card = { due: now, stability: 5, difficulty: 5, elapsed_days: 0, scheduled_days: 5, learning_steps: 0, reps: 3, lapses: 0, state: State.Review, last_review: now - 5 * DAY };
  const p = preview(s, card, now);
  for (const rating of [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy]) {
    assert.equal(p[rating], review(s, card, rating, now).next.due - now, 'оценка ' + rating);
  }
  assert.ok(p[Rating.Again] < p[Rating.Hard] && p[Rating.Hard] < p[Rating.Good] && p[Rating.Good] < p[Rating.Easy],
    'чем легче ответ, тем дальше следующее повторение');
  assert.equal(p[Rating.Again], 10 * MIN, 'забытая карточка — снова через 10 минут');
});

test('формат интервала', () => {
  assert.equal(formatInterval(MIN), '1 мин');
  assert.equal(formatInterval(10 * MIN), '10 мин');
  assert.equal(formatInterval(3 * 3600e3), '3 ч');
  assert.equal(formatInterval(4 * DAY), '4 дн');
  assert.equal(formatInterval(61 * DAY), '2 мес');
  assert.equal(formatInterval(365 * DAY), '1 г');
});

test('даты хранятся числами и без потерь превращаются обратно', () => {
  const { next } = review(makeScheduler(), null, Rating.Good, now);
  assert.equal(typeof next.due, 'number');
  assert.deepEqual(toStored(fromStored(next)), next);
  assert.deepEqual(JSON.parse(JSON.stringify(next)), next, 'переживает JSON резервной копии');
});

test('новая, выучено (от 21 дня стабильности), на сегодня', () => {
  const review2 = (stability, due) => ({ state: State.Review, stability, due });
  assert.equal(isNew(undefined), true);
  assert.equal(isNew({ state: State.New }), true);
  assert.equal(isLearned(review2(LEARNED_STABILITY, now)), true);
  assert.equal(isLearned(review2(20.9, now)), false);
  assert.equal(isLearned({ state: State.Learning, stability: 40 }), false);
  const today = dayIndex(now);
  assert.equal(isDue(review2(5, now + 6 * 3600e3), today), true, 'срок вечером сегодня — уже сегодня');
  assert.equal(isDue(review2(5, dayStart(today + 1)), today), false, 'завтра в 4:00 — уже завтра');
  assert.equal(isDue(undefined, today), false, 'новые считаются отдельно, по лимиту');
});
