// SM-2 из артефакта: те же переходы между состояниями.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { review, isNew, isLearned, isDue } from '../js/scheduler.js';

const now = 1_791_500_000_000, today = 20735;
const opts = { now, today, random: () => 0.5 }; // random 0.5 — разброс интервала ровно 0

test('новая карточка: «Знал» два раза подряд → на повторение через день', () => {
  const a = review(null, true, opts);
  assert.deepEqual(a.next, { s: 1, st: 1, ts: now + 10 * 60e3, t: now });
  assert.equal(a.requeue, 5);
  const b = review(a.next, true, opts);
  assert.deepEqual(b.next, { s: 2, iv: 1, e: 2.5, d: today + 1, t: now });
  assert.equal(b.requeue, -1);
});

test('новая карточка: «Не знал» → снова через 3 карточки', () => {
  const a = review(null, false, opts);
  assert.deepEqual(a.next, { s: 1, st: 0, ts: now + 60e3, t: now });
  assert.equal(a.requeue, 3);
});

test('на повторении: «Знал» умножает интервал на лёгкость', () => {
  const { next } = review({ s: 2, iv: 3, e: 2.5, d: today, t: 1 }, true, opts);
  assert.equal(next.iv, 8); // round(3 × 2.5) = 8
  assert.equal(next.d, today + 8);
  assert.equal(next.r, 1);
});

test('на повторении: «Не знал» → переучивание, потом один «Знал» возвращает на повторение', () => {
  const a = review({ s: 2, iv: 10, e: 2.5, d: today, t: 1 }, false, opts);
  assert.deepEqual(a.next, { s: 1, iv: 3, e: 2.3, d: today, r: 1, l: 1, st: 0, rl: 1, ts: now + 60e3, t: now });
  const b = review(a.next, true, opts);
  assert.equal(b.next.s, 2);
  assert.equal(b.next.iv, 3);
  assert.equal(b.next.d, today + 3);
  assert.equal(b.next.rl, undefined);
});

test('английские карточки меняют пример, старое состояние не портится', () => {
  const prev = { s: 2, iv: 1, e: 2.5, d: today, k: 4, t: 1 };
  const { next } = review(prev, true, { ...opts, isEn: true });
  assert.equal(next.k, 5);
  assert.equal(prev.k, 4);
  assert.equal(prev.iv, 1);
});

test('новая, выучено, на сегодня', () => {
  assert.equal(isNew(undefined), true);
  assert.equal(isNew({ s: 0 }), true);
  assert.equal(isLearned({ s: 2, iv: 7 }), true);
  assert.equal(isLearned({ s: 2, iv: 6 }), false);
  assert.equal(isLearned({ s: 1, iv: 30 }), false);
  assert.equal(isDue({ s: 1 }, today), true);
  assert.equal(isDue({ s: 2, d: today }, today), true);
  assert.equal(isDue({ s: 2, d: today + 1 }, today), false);
});
