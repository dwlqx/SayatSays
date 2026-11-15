// Дни и серия.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { dayIndex, weekOf, streakInfo } from '../js/streak.js';

const at = (y, m, d, h, min = 0) => new Date(y, m - 1, d, h, min).getTime(); // местное время

test('день начинается в 4:00', () => {
  assert.equal(dayIndex(at(2026, 10, 11, 12)), 20737);
  assert.equal(dayIndex(at(2026, 10, 11, 3, 59)), 20736, 'в 3:59 ещё вчера');
  assert.equal(dayIndex(at(2026, 10, 11, 4, 0)), 20737);
});

test('неделя — с понедельника по воскресенье', () => {
  const mon = dayIndex(at(2026, 10, 5, 12)), sun = dayIndex(at(2026, 10, 11, 12)), prevSun = dayIndex(at(2026, 10, 4, 12));
  assert.equal(weekOf(mon), weekOf(sun));
  assert.notEqual(weekOf(prevSun), weekOf(mon));
});

test('две заморозки в неделю сохраняют серию, третий пропуск обрывает', () => {
  // Пн 20731 — занимался, Вт и Ср — пропуски, Чт 20734 и Пт 20735 — занимался.
  const days = { 20731: { n: 10, done: true }, 20734: { n: 10, done: true }, 20735: { n: 10, done: true } };
  const st = streakInfo(days, 20735);
  assert.equal(st.streak, 3);
  assert.deepEqual([...st.frozen].sort(), [20732, 20733]);
  assert.equal(st.freezesLeft, 0);

  // Пропущены Вт, Ср и Чт — заморозок не хватает.
  const days2 = { 20731: { n: 10, done: true }, 20735: { n: 10, done: true } };
  assert.equal(streakInfo(days2, 20735).streak, 1);
});

test('сегодня ещё не занимался — серия считается со вчера', () => {
  const days = { 20735: { n: 10, done: true }, 20736: { n: 3, done: false } };
  const st = streakInfo(days, 20736);
  assert.equal(st.streak, 1);
  assert.equal(st.todayDone, false);
  assert.equal(st.todayN, 3);
});
