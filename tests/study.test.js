// Занятие: очередь, ответ, отмена, возврат изучаемых карточек.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { legacyState } from './helpers.js';
import { startSession, nextItem, answerCard, undoAnswer, leftInSession, LEARN_AHEAD } from '../js/study.js';
import { makeScheduler, State, Rating } from '../js/scheduler.js';
import { dayIndex, dayStart } from '../js/streak.js';

const NOW = dayStart(20773) + 8 * 3600e3;
const TODAY = dayIndex(NOW);
const MIN = 60e3;

// Занятие по одной колоде, где все карточки новые («Глаголы», 18 карточек, лимит 15).
async function verbsSession() {
  const S = await legacyState(NOW);
  const ses = startSession(S, ['kz-lex-verbs'], TODAY, () => 0.5);
  return { S, ses, scheduler: makeScheduler() };
}
function answer(S, ses, scheduler, good, now) {
  ses.current = nextItem(ses, now);
  return answerCard(S, ses, scheduler, good, now, TODAY);
}

test('«Знал» на новой карточке: Learning, запись в журнале, счётчики дня', async () => {
  const { S, ses, scheduler } = await verbsSession();
  assert.equal(leftInSession(ses), 15);
  const first = nextItem(ses, NOW).item;
  const { rec, day, log } = answer(S, ses, scheduler, true, NOW);

  assert.equal(rec.fsrs.state, State.Learning);
  assert.equal(S.prog['kz-lex-verbs'][first.card], rec);
  assert.deepEqual([log.deck, log.card, log.rating, log.review, log.state], ['kz-lex-verbs', first.card, Rating.Good, NOW, State.New]);
  assert.equal(day.n, 1);
  assert.equal(day.nw['kz-lex-verbs'], 1, 'новая карточка из колоды учтена в лимите');
  assert.equal(ses.done, 1);
  assert.equal(ses.good, 1);
  // карточка вернётся в это же занятие через 10 минут
  assert.deepEqual(ses.later.map(x => x.card), [first.card]);
  assert.equal(leftInSession(ses), 15);
});

test('отмена возвращает состояние карточки, день и очередь', async () => {
  const { S, ses, scheduler } = await verbsSession();
  answer(S, ses, scheduler, true, NOW);                       // первая карточка
  const progBefore = structuredClone(S.prog), daysBefore = structuredClone(S.days);
  const queueBefore = ses.queue.slice(), laterBefore = ses.later.slice();

  const second = nextItem(ses, NOW + MIN).item;
  const { log } = answer(S, ses, scheduler, false, NOW + MIN); // вторая — «Не знал»
  assert.notDeepEqual(S.prog, progBefore);

  const u = undoAnswer(S, ses);
  assert.equal(u.logId, log.id, 'знаем, какую запись журнала удалить');
  assert.equal(u.prevRec, null, 'до ответа у карточки не было состояния — запись удалится');
  assert.deepEqual(S.prog, progBefore);
  assert.deepEqual(S.days, daysBefore);
  assert.deepEqual(ses.queue, queueBefore);
  assert.deepEqual(ses.later, laterBefore);
  assert.equal(ses.done, 1);
  assert.deepEqual(nextItem(ses, NOW + MIN).item, second, 'на экран возвращается та же карточка');
  assert.equal(undoAnswer(S, ses), null, 'второй раз отменять нечего');
});

test('отмена ответа на карточку с прогрессом возвращает прежнее состояние FSRS', async () => {
  const S = await legacyState(NOW);
  const ses = startSession(S, ['kz-exam-gram'], TODAY, () => 0.5);
  const pick = nextItem(ses, NOW);
  const before = structuredClone(S.prog[pick.item.deck][pick.item.card]);
  ses.current = pick;
  answerCard(S, ses, makeScheduler(), true, NOW, TODAY);
  assert.notDeepEqual(S.prog[pick.item.deck][pick.item.card].fsrs, before.fsrs);
  const u = undoAnswer(S, ses);
  assert.deepEqual(u.prevRec, before);
  assert.deepEqual(S.prog[pick.item.deck][pick.item.card], before);
});

test('изучаемые возвращаются по сроку; если больше нечего показать — не раньше чем за 20 минут', async () => {
  const { S, ses, scheduler } = await verbsSession();
  ses.queue = ses.queue.slice(0, 2);                          // две новые карточки
  const a = nextItem(ses, NOW).item;
  answer(S, ses, scheduler, false, NOW);                       // a: «Не знал» → через минуту
  const b = nextItem(ses, NOW).item;
  assert.notDeepEqual(b, a, 'пока срок a не наступил — следующая по очереди');
  answer(S, ses, scheduler, true, NOW + 10e3);                 // b: «Знал» → через 10 минут
  assert.equal(ses.queue.length, 0);
  assert.deepEqual(nextItem(ses, NOW + 20e3).item.card, a.card, 'очередь пуста — a показываем раньше срока');
  assert.equal(nextItem(ses, NOW + 2 * MIN).item.card, a.card);

  const far = { deck: 'kz-lex-verbs', card: 'x', due: NOW + LEARN_AHEAD + MIN };
  assert.equal(nextItem({ queue: [], later: [far] }, NOW), null, 'дальше 20 минут — занятие закончено');
});

test('день засчитывается, когда набрана цель или занятие закончено', async () => {
  const { S, ses, scheduler } = await verbsSession();
  S.settings.goal = 3;
  let day;
  for (let i = 0; i < 3; i++) day = answer(S, ses, scheduler, true, NOW + i * 1000).day;
  assert.equal(day.n, 3);
  assert.equal(day.done, true);
});
