// Расписание повторений: FSRS-6 через библиотеку ts-fsrs (vendor/ts-fsrs.mjs).
// FSRS для каждой карточки помнит две главные величины:
//   stability  — стабильность: через сколько дней вероятность вспомнить упадёт до 90 %;
//   difficulty — сложность от 1 до 10: насколько трудно растёт стабильность у этой карточки.
// По ним и целевой запоминаемости FSRS решает, когда показать карточку снова.
//
// Состояние карточки в базе (поле fsrs записи cardState) — объект Card из ts-fsrs, но даты в нём числа (мс),
// а не Date: так они без изменений переживают резервную копию в JSON.
//   state  0 — новая, 1 — изучается, 2 — на повторении, 3 — переучивается после «Не знал»
//   due    когда показать;  last_review — когда был последний ответ;  reps, lapses — ответов и провалов

import { fsrs, generatorParameters, createEmptyCard, Rating, State } from '../vendor/ts-fsrs.mjs';
import { dayIndex } from './streak.js';

export { Rating, State };

export const DEFAULT_RETENTION = 0.9;
// «Выучено» — на повторении и стабильность от 3 недель.
export const LEARNED_STABILITY = 21;

// Планировщик с нашими настройками. retention — целевая запоминаемость (0.8–0.95):
// какую долю карточек ты должен вспомнить в момент повторения. Выше — меньше забываешь, но больше повторений.
export function makeScheduler(retention = DEFAULT_RETENTION) {
  return fsrs(generatorParameters({
    request_retention: retention,
    maximum_interval: 365,      // не дольше года между повторениями
    enable_fuzz: true,          // небольшой разброс интервалов, чтобы карточки не приходили пачками
    enable_short_term: true,
    learning_steps: ['1m', '10m'],  // новая карточка: через минуту, потом через 10 минут, потом — на дни
    relearning_steps: ['10m']       // забытая карточка: через 10 минут, потом — снова на дни
  }));
}

// Card из ts-fsrs → запись для базы (даты → числа) и обратно.
export function toStored(card) {
  return {
    due: +card.due,
    stability: card.stability,
    difficulty: card.difficulty,
    elapsed_days: card.elapsed_days,
    scheduled_days: card.scheduled_days,
    learning_steps: card.learning_steps,
    reps: card.reps,
    lapses: card.lapses,
    state: card.state,
    last_review: card.last_review ? +card.last_review : null
  };
}
export function fromStored(f) {
  return { ...f, due: new Date(f.due), last_review: f.last_review != null ? new Date(f.last_review) : undefined };
}

// Журнал ответа: что вернул ts-fsrs в log — оценка, время ответа и состояние карточки ДО ответа.
// Пригодится, чтобы потом подогнать параметры FSRS под тебя (ROADMAP, задача 5).
function logToStored(log) {
  return {
    rating: log.rating,
    review: +log.review,
    state: log.state,
    due: +log.due,
    stability: log.stability,
    difficulty: log.difficulty,
    elapsed_days: log.elapsed_days,
    last_elapsed_days: log.last_elapsed_days,
    scheduled_days: log.scheduled_days,
    learning_steps: log.learning_steps
  };
}

const cardOf = (f, now) => f ? fromStored(f) : createEmptyCard(new Date(now));

// Оценки ответа. Две кнопки — «Не знал» (Again) и «Знал» (Good); в режиме четырёх кнопок ещё
// «Трудно» (Hard: вспомнил с трудом, вернётся чуть раньше) и «Легко» (Easy: знал сразу, вернётся намного позже).
export const ANSWERS = [Rating.Again, Rating.Hard, Rating.Good, Rating.Easy];
// Вспомнил ли: всё, кроме «Не знал». Так считаются «знал» в итогах занятия и в статистике.
export const remembered = rating => rating !== Rating.Again;

// Ответ на карточку. f — состояние до ответа (null, если карточку видят впервые), rating — оценка (Rating.Again …
// Rating.Easy), now — время ответа (мс). Возвращает { next: новое состояние, log: запись для журнала }.
// При одинаковых f и now результат всегда один и тот же, поэтому подписи под кнопками (preview)
// совпадают с тем, что получится после ответа.
export function review(scheduler, f, rating, now) {
  if (!ANSWERS.includes(rating)) throw new Error('Неизвестная оценка ответа: ' + rating);
  const { card, log } = scheduler.next(cardOf(f, now), new Date(now), rating);
  return { next: toStored(card), log: logToStored(log) };
}

// Через сколько миллисекунд карточка вернётся после каждой оценки: { [Rating.Again]: мс, …, [Rating.Easy]: мс }.
export function preview(scheduler, f, now) {
  const r = scheduler.repeat(cardOf(f, now), new Date(now));
  const out = {};
  for (const rating of ANSWERS) out[rating] = +r[rating].card.due - now;
  return out;
}

// «10 мин», «3 ч», «4 дн», «2 мес», «1 г» — подпись под кнопкой.
export function formatInterval(ms) {
  const min = Math.max(1, Math.round(ms / 60e3));
  if (min < 60) return min + ' мин';
  const h = Math.round(ms / 3600e3);
  if (h < 24) return h + ' ч';
  const d = Math.round(ms / 864e5);
  if (d < 31) return d + ' дн';
  if (d < 365) return Math.round(d / 30.4) + ' мес';
  return Math.round(d / 365) + ' г';
}

export const isNew = f => !f || f.state === State.New;
export const isLearning = f => !!f && (f.state === State.Learning || f.state === State.Relearning);
export const isLearned = f => !!f && f.state === State.Review && f.stability >= LEARNED_STABILITY;
// Нужна ли сегодня: срок наступил не позже сегодняшнего учебного дня (день начинается в 4:00).
// Например, карточка со сроком на 20:00 показывается уже с утра.
export const isDue = (f, today) => !isNew(f) && dayIndex(f.due) <= today;
