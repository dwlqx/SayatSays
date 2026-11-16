// Перенос старых данных в формат базы.
//   1. Первый запуск: взять исходные данные из артефакта «Запомни» (data/decks.json и data/progress-sm2.json)
//      и положить в базу. Сами файлы не меняются.
//   2. Переход с SM-2 на FSRS: один раз, со снимком всей базы перед ним.

import { createEmptyCard, Rating, State } from '../vendor/ts-fsrs.mjs';
import { makeScheduler, toStored } from './scheduler.js';
import { dayStart } from './streak.js';

// Превращает содержимое двух файлов в записи для хранилищ базы (см. описание хранилищ в db.js).
export function legacyToRecords(decksFile, progressFile) {
  if (!decksFile || !Array.isArray(decksFile.decks)) throw new Error('decks.json: нет списка колод (decks).');
  if (!progressFile || progressFile.algorithm !== 'sm2-binary') throw new Error('progress-sm2.json: незнакомый формат.');

  const decks = decksFile.decks.map(d => ({ ...d, cards: (d.cards || []).map(c => ({ ...c })) }));

  const days = {};
  for (const [k, v] of Object.entries((progressFile.stats && progressFile.stats.days) || {})) {
    days[k] = { day: Number(k), n: v.n || 0, done: !!v.done };
  }

  const cardState = [];
  for (const [deck, p] of Object.entries(progressFile.progress || {})) {
    for (const [card, sm2] of Object.entries(p.cards || {})) cardState.push({ deck, card, sm2: { ...sm2 } });
    // nd = { day, n }: сколько новых карточек колоды взято в день day. Теперь это часть записи дня (поле nw).
    if (p.nd && p.nd.n) {
      const day = days[p.nd.day] || (days[p.nd.day] = { day: p.nd.day, n: 0, done: false });
      day.nw = { ...day.nw, [deck]: p.nd.n };
    }
  }

  return { decks, cardState, stats: Object.values(days) };
}

// Первый запуск: если база ещё ни разу не заполнялась, загружает исходные данные
// и кладёт их в базу одной транзакцией. Возвращает true, если загрузка была.
//   load() — функция, которая возвращает { decks, progress }: содержимое двух файлов
//            (в браузере их скачивает fetch, в тестах — читает Node).
// Отметка meta.seededAt нужна, чтобы колоды не вернулись, если когда-нибудь удалить их все.
export async function seedIfNeeded(db, load, now = Date.now()) {
  const meta = await db.get('settings', 'meta');
  if (meta && meta.seededAt) return false;
  const { decks, progress } = await load();
  const rec = legacyToRecords(decks, progress);
  await db.write(['decks', 'cardState', 'stats', 'settings'], s => {
    rec.decks.forEach(d => s.decks.put(d));
    rec.cardState.forEach(c => s.cardState.put(c));
    rec.stats.forEach(d => s.stats.put(d));
    s.settings.put({ ...meta, key: 'meta', seededAt: now });
  });
  return true;
}

/* ---------- переход SM-2 → FSRS ---------- */

// Одна карточка: состояние SM-2 → состояние FSRS (правила — ROADMAP, задача 3).
//   s=0 (новая)          → новая карточка FSRS.
//   s=2 (на повторении)  → Review: стабильность = интервал iv в днях, сложность = 5 + число провалов l (от 1 до 10),
//                          последний ответ = t, срок = начало дня d (4:00 по местному времени).
//                          «Лёгкость» e из SM-2 не используем: у нас почти у всех карточек это просто 2.5 по умолчанию.
//   s=1 (изучается)      → Learning со сроком «сейчас». Состояние не придумываем руками, а получаем из самого ts-fsrs:
//                          прогоняем последний ответ на новой карточке («Знал», если шаг st уже пройден, иначе «Не знал»).
export function sm2ToFsrs(sm2, now, scheduler = makeScheduler()) {
  if (!sm2 || !sm2.s) return toStored(createEmptyCard(new Date(now)));
  if (sm2.s === 2) {
    const iv = Math.max(1, sm2.iv || 1), lapses = sm2.l || 0;
    return {
      due: dayStart(sm2.d),
      stability: iv,
      difficulty: Math.min(10, Math.max(1, 5 + lapses)),
      elapsed_days: 0,
      scheduled_days: iv,
      learning_steps: 0,
      reps: (sm2.r || 0) + 1,
      lapses,
      state: State.Review,
      last_review: sm2.t || null
    };
  }
  const t = new Date(sm2.t || now);
  const { card } = scheduler.next(createEmptyCard(t), t, sm2.st ? Rating.Good : Rating.Again);
  return { ...toStored(card), due: now };
}

// Переводит на FSRS все карточки, у которых ещё нет поля fsrs. Старое состояние sm2 остаётся в записи как было.
// Перед первым переходом сохраняет снимок всей базы в хранилище snapshots (id 'before-fsrs').
// Снимок, новые состояния и отметка meta.fsrsAt пишутся одной транзакцией: либо всё, либо ничего.
// Возвращает, сколько карточек переведено (0 — переводить было нечего).
// Вызывается при каждом запуске (обычно ничего не делает) и после восстановления старой резервной копии.
export async function migrateToFsrs(db, now = Date.now()) {
  const states = await db.getAll('cardState');
  const todo = states.filter(r => !r.fsrs);
  if (!todo.length) return 0;
  const [meta, oldSnapshot] = await Promise.all([db.get('settings', 'meta'), db.get('snapshots', 'before-fsrs')]);
  const data = oldSnapshot ? null : await db.exportAll();
  const scheduler = makeScheduler();
  await db.write(['cardState', 'settings', 'snapshots'], s => {
    if (data) s.snapshots.put({ id: 'before-fsrs', createdAt: now, data });
    for (const r of todo) {
      const rec = { ...r, fsrs: sm2ToFsrs(r.sm2, now, scheduler) };
      if (r.sm2 && r.sm2.k != null && rec.k == null) rec.k = r.sm2.k; // номер примера для английских карточек
      s.cardState.put(rec);
    }
    s.settings.put({ ...meta, key: 'meta', fsrsAt: (meta && meta.fsrsAt) || now });
  });
  return todo.length;
}
