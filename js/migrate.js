// Перенос старых данных в формат базы.
// Сейчас здесь одно: при первом запуске взять исходные данные из артефакта «Запомни»
// (data/decks.json и data/progress-sm2.json) и положить в базу. Сами файлы не меняются.
// В задаче 3 сюда добавится переход с SM-2 на FSRS.

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
