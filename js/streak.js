// Дни, недели и серия занятий. Модуль без DOM — его проверяют тесты в Node.

export const DAY = 864e5; // миллисекунд в сутках

// Номер «учебного дня»: сколько дней прошло с 1 января 1970.
// День начинается в 4:00 по местному времени, а не в полночь: если занимаешься в час ночи,
// это засчитывается во вчерашний день.
export function dayIndex(ts = Date.now()) {
  const d = new Date(ts - 4 * 3600e3);
  return Math.round(Date.UTC(d.getFullYear(), d.getMonth(), d.getDate()) / DAY);
}

// Номер недели. Недели начинаются с понедельника: день 0 (1 января 1970) был четвергом, отсюда «+ 3».
export const weekOf = i => Math.floor((i + 3) / 7);

// Серия дней подряд. days — статистика по дням: { [номер дня]: { n: ответов, done: день засчитан } }.
// Идём от сегодня (или вчера, если сегодня ещё не засчитано) назад.
// Пропущенный день не обрывает серию, пока на его неделе есть заморозки — их две в неделю.
// Заморозка тратится, только если до пропуска серия продолжалась (поэтому сначала она «предварительная»).
export function streakInfo(days, today = dayIndex()) {
  days = days || {};
  const isDone = i => !!(days[i] && days[i].done);
  const keys = Object.keys(days).map(Number).filter(n => !isNaN(n));
  const minDay = keys.length ? Math.min(...keys) : today;
  const used = {}, frozen = new Set();
  let tentative = [], streak = 0;
  let i = isDone(today) ? today : today - 1;
  while (i >= minDay) {
    if (isDone(i)) { streak++; tentative.forEach(t => frozen.add(t)); tentative = []; }
    else {
      const w = weekOf(i);
      if ((used[w] || 0) < 2) { used[w] = (used[w] || 0) + 1; tentative.push(i); }
      else break;
    }
    i--;
  }
  const wk = weekOf(today);
  const usedThisWeek = Array.from(frozen).filter(d => weekOf(d) === wk).length;
  return {
    streak,
    frozen,
    freezesLeft: Math.max(0, 2 - usedThisWeek),
    todayDone: isDone(today),
    todayN: (days[today] && days[today].n) || 0
  };
}
