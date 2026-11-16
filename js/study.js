// Занятие: какая карточка следующая, ответ и отмена ответа. Модуль без DOM — его проверяют тесты.
//
// Сессия ses:
//   queue    карточки занятия по порядку: { deck, card }
//   later    изучаемые карточки, которые вернутся в это же занятие, когда подойдёт срок: { deck, card, due },
//            отсортированы по сроку («Не знал» — через минуту, «Знал» на шаге изучения — через 10 минут)
//   current  карточка на экране: { item, from: 'queue' | 'later' }
//   done, good — сколько ответов и сколько из них «Знал»;  undo — как вернуть последний ответ

import { review, isNew, isLearning } from './scheduler.js';
import { typeOf, buildQueue } from './decks.js';

// Если показывать больше нечего, изучаемую карточку можно показать раньше срока, но не больше чем на 20 минут.
// Так занятие заканчивается за один раз, как было в SM-2.
export const LEARN_AHEAD = 20 * 60e3;

export function startSession(S, ids, today, random = Math.random) {
  return { queue: buildQueue(S, ids, today, random), later: [], current: null, done: 0, good: 0, undo: null };
}

export const leftInSession = ses => ses.queue.length + ses.later.length;

// Следующая карточка: изучаемая, чей срок уже наступил; иначе следующая по очереди;
// иначе изучаемая, до срока которой меньше LEARN_AHEAD. null — занятие закончено.
export function nextItem(ses, now) {
  const soon = ses.later[0];
  if (soon && soon.due <= now) return { item: soon, from: 'later' };
  if (ses.queue.length) return { item: ses.queue[0], from: 'queue' };
  if (soon && soon.due - now <= LEARN_AHEAD) return { item: soon, from: 'later' };
  return null;
}

// Убрать карточку из занятия (например, её удалили, пока шло занятие).
export function dropItem(ses, pick) {
  if (pick.from === 'queue') ses.queue.shift();
  else ses.later = ses.later.filter(x => x !== pick.item);
}

// id записи журнала — время ответа в мс. Если два ответа пришлись на одну миллисекунду, второй получит +1.
let lastLogId = 0;
function nextLogId(now) { lastLogId = Math.max(now, lastLogId + 1); return lastLogId; }

// Ответ на текущую карточку (ses.current). Меняет S.prog, S.days и ses.
// Возвращает, что записать в базу одной транзакцией: { rec: cardState, day: stats, log: reviewLog }.
export function answerCard(S, ses, scheduler, good, now, today) {
  const { item, from } = ses.current;
  const prog = S.prog[item.deck] || (S.prog[item.deck] = {});
  const prevRec = prog[item.card] || null, prevDay = S.days[today] || null;
  const f = prevRec && prevRec.fsrs;
  // Запоминаем всё, что меняем, — для кнопки «Отменить».
  const undo = { item, prevRec, prevDay, today, queue: ses.queue.slice(), later: ses.later.slice(), done: ses.done, good: ses.good };

  const { next, log } = review(scheduler, f, good, now);
  const rec = { ...(prevRec || { deck: item.deck, card: item.card }), fsrs: next };
  if (typeOf(S.decks[item.deck]) === 'en') rec.k = (rec.k || 0) + 1; // в следующий раз — другое предложение
  prog[item.card] = rec;

  dropItem(ses, ses.current);
  if (isLearning(next) && next.due - now <= LEARN_AHEAD) {
    ses.later.push({ deck: item.deck, card: item.card, due: next.due });
    ses.later.sort((a, b) => a.due - b.due);
  }
  ses.done++; if (good) ses.good++;

  // Статистика дня: ещё один ответ; если карточка была новой — ещё одна новая из этой колоды.
  const day = { day: today, n: 0, done: false, ...prevDay };
  day.n++;
  if (isNew(f)) day.nw = { ...day.nw, [item.deck]: ((day.nw && day.nw[item.deck]) || 0) + 1 };
  if (day.n >= S.settings.goal || !leftInSession(ses)) day.done = true;
  S.days[today] = day;

  const logRec = { id: nextLogId(now), deck: item.deck, card: item.card, ...log };
  undo.logId = logRec.id;
  ses.undo = undo;
  ses.current = null;
  return { rec, day, log: logRec };
}

// Отмена последнего ответа: S и ses становятся как до него.
// Возвращает, что сделать в базе: { deck, card, prevRec, prevDay, today, logId } (null — отменять нечего).
export function undoAnswer(S, ses) {
  const u = ses.undo; if (!u) return null;
  const { deck, card } = u.item;
  const prog = S.prog[deck] || (S.prog[deck] = {});
  if (u.prevRec) prog[card] = u.prevRec; else delete prog[card];
  if (u.prevDay) S.days[u.today] = u.prevDay; else delete S.days[u.today];
  ses.queue = u.queue; ses.later = u.later; ses.done = u.done; ses.good = u.good;
  ses.undo = null; ses.current = null;
  return { deck, card, prevRec: u.prevRec, prevDay: u.prevDay, today: u.today, logId: u.logId };
}
