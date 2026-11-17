// Статистика: ответы по дням, доля «знал», прогноз нагрузки на две недели, итоги. Модуль без DOM — его проверяют тесты.
//
// Откуда берутся данные:
//   S.days    — сколько ответов было в каждый учебный день. Тут есть и дни из артефакта (до перехода на FSRS).
//   журнал    — каждый ответ с оценкой (хранилище reviewLog). Он ведётся только с перехода на FSRS,
//               поэтому долю «знал» можно посчитать только с этого времени.
//   S.prog    — расписание каждой карточки: по нему считается прогноз.

import { dayIndex } from './streak.js';
import { isNew, remembered } from './scheduler.js';
import { fsrsOf, deckCounts } from './decks.js';

// В какой учебный день был ответ из журнала.
const logDay = l => dayIndex(l.review != null ? l.review : l.id);

// Ответы по дням за последние count дней, сегодня — последний:
//   [{ day, n: ответов, logged: из них есть в журнале, good: из них «вспомнил», done: день засчитан }]
export function answersByDay(days, logs, today, count = 30) {
  const byDay = {};
  for (const l of logs) {
    const x = byDay[logDay(l)] || (byDay[logDay(l)] = { logged: 0, good: 0 });
    x.logged++;
    if (remembered(l.rating)) x.good++;
  }
  const out = [];
  for (let d = today - count + 1; d <= today; d++) {
    const rec = days[d], x = byDay[d] || { logged: 0, good: 0 };
    out.push({ day: d, n: Math.max((rec && rec.n) || 0, x.logged), logged: x.logged, good: x.good, done: !!(rec && rec.done) });
  }
  return out;
}

// Доля «вспомнил» (всё, кроме «Не знал») за последние count дней, считая сегодня:
// { total, good, share } — share от 0 до 1 или null, если ответов в журнале за это время нет.
export function goodShare(logs, today, count) {
  let total = 0, good = 0;
  for (const l of logs) {
    const d = logDay(l);
    if (d > today - count && d <= today) { total++; if (remembered(l.rating)) good++; }
  }
  return { total, good, share: total ? good / total : null };
}

// Прогноз: сколько карточек придёт на повторение в каждый из ближайших count дней: [{ day, n }].
// Сегодня — вместе с просроченными (как на кнопке «Повторить всё», но без новых карточек).
// Считается так, будто ты повторяешь всё вовремя; каждый ответ, конечно, двигает карточку дальше.
export function forecast(S, today, count = 14) {
  const out = Array.from({ length: count }, (_, i) => ({ day: today + i, n: 0 }));
  for (const id in S.decks) {
    for (const card of (S.decks[id].cards || [])) {
      const f = fsrsOf(S, id, card.id);
      if (isNew(f)) continue;
      const i = Math.max(0, dayIndex(f.due) - today);
      if (i < count) out[i].n++;
    }
  }
  return out;
}

// Итоги по всем колодам: { total, nw, learning, learned, answers: ответов за всё время, daysDone: засчитанных дней }.
export function totals(S, today) {
  const t = { total: 0, nw: 0, learning: 0, learned: 0, answers: 0, daysDone: 0 };
  for (const id in S.decks) {
    const c = deckCounts(S, id, false, today);
    t.total += c.total; t.nw += c.nw; t.learning += c.learning; t.learned += c.learned;
  }
  for (const d in S.days) { t.answers += S.days[d].n || 0; if (S.days[d].done) t.daysDone++; }
  return t;
}
