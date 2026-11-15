// Резервная копия: один JSON-файл со всем содержимым базы — колоды, состояния карточек,
// журнал ответов, настройки и статистика.
//
// Формат файла:
//   { "app": "SayatSays", "format": 1, "exportedAt": "2026-10-11T15:00:00.000Z",
//     "data": { "decks": [...], "cardState": [...], "reviewLog": [...], "settings": [...], "stats": [...] } }
// data — это записи хранилищ как есть (см. db.js), поэтому восстановление ничего не теряет.

import { STORES } from './db.js';

export const BACKUP_FORMAT = 1;

export function makeBackup(data, now = Date.now()) {
  return { app: 'SayatSays', format: BACKUP_FORMAT, exportedAt: new Date(now).toISOString(), data };
}

// sayatsays-backup-2026-10-11.json (дата по местному времени)
export function backupFileName(now = Date.now()) {
  const d = new Date(now), p = n => String(n).padStart(2, '0');
  return 'sayatsays-backup-' + d.getFullYear() + '-' + p(d.getMonth() + 1) + '-' + p(d.getDate()) + '.json';
}

// Проверяет текст файла и возвращает копию. Если файл не тот или испорчен — ошибка с понятным текстом.
export function parseBackup(text) {
  let b;
  try { b = JSON.parse(text); } catch (e) { throw new Error('Файл не читается: это не JSON.'); }
  if (b && Array.isArray(b.decks)) throw new Error('Это файл с колодами, а не резервная копия. Его добавляют кнопкой «Импортировать колоды».');
  if (!b || b.app !== 'SayatSays' || !b.data) throw new Error('Это не резервная копия SayatSays.');
  if (b.format > BACKUP_FORMAT) throw new Error('Копия сделана более новой версией приложения. Сначала обнови приложение.');
  if (b.format !== BACKUP_FORMAT) throw new Error('Незнакомый формат копии.');
  for (const name of STORES) {
    if (!Array.isArray(b.data[name])) throw new Error('Копия повреждена: нет раздела «' + name + '».');
  }
  const bad = name => { throw new Error('Копия повреждена: ошибка в разделе «' + name + '».'); };
  if (!b.data.decks.every(d => d && typeof d.id === 'string' && Array.isArray(d.cards))) bad('decks');
  if (!b.data.cardState.every(c => c && typeof c.deck === 'string' && typeof c.card === 'string')) bad('cardState');
  if (!b.data.settings.every(s => s && typeof s.key === 'string')) bad('settings');
  if (!b.data.stats.every(d => d && typeof d.day === 'number')) bad('stats');
  if (!b.data.reviewLog.every(r => r && typeof r.id === 'number')) bad('reviewLog');
  return b;
}

// Что положить в базу при восстановлении: данные копии как есть, только в служебной записи meta
// «последняя копия» — это та копия, из которой восстановились.
export function dataForRestore(b) {
  const meta = b.data.settings.find(s => s.key === 'meta') || { key: 'meta' };
  const settings = b.data.settings.filter(s => s.key !== 'meta');
  settings.push({ ...meta, seededAt: meta.seededAt || Date.now(), lastBackupAt: Date.parse(b.exportedAt) || Date.now() });
  return { ...b.data, settings };
}
