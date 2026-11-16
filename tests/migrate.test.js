// Переход с SM-2 на FSRS: без потерь, со снимком перед ним, один раз.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { IDBFactory } from 'fake-indexeddb';
import { freshDB, loadLegacy } from './helpers.js';
import { openDB } from '../js/db.js';
import { seedIfNeeded, migrateToFsrs, sm2ToFsrs } from '../js/migrate.js';
import { makeBackup, parseBackup, dataForRestore } from '../js/backup.js';
import { dayIndex, dayStart } from '../js/streak.js';
import { State, isLearning } from '../js/scheduler.js';

const NOW = dayStart(20773) + 8 * 3600e3; // 16 ноября 2026, 12:00

test('dayStart — обратная к dayIndex: 4:00 того же учебного дня', () => {
  for (const d of [20718, 20734, 20773, 21000]) {
    assert.equal(dayIndex(dayStart(d)), d);
    assert.equal(dayIndex(dayStart(d) - 1), d - 1, 'минутой раньше — ещё вчера');
    assert.equal(new Date(dayStart(d)).getHours(), 4);
  }
});

test('80 карточек переходят на FSRS без потерь', async () => {
  const db = await freshDB();
  await seedIfNeeded(db, loadLegacy, NOW - 1000);
  const { progress } = await loadLegacy();
  assert.equal(await migrateToFsrs(db, NOW), 80);

  const states = await db.getAll('cardState');
  assert.equal(states.length, 80);
  for (const r of states) {
    const sm2 = progress.progress[r.deck].cards[r.card];
    assert.deepEqual(r.sm2, sm2, 'старое состояние SM-2 сохранено как было: ' + r.card);
    const f = r.fsrs;
    if (sm2.s === 2) {
      assert.equal(f.state, State.Review, r.card);
      assert.equal(f.stability, sm2.iv);
      assert.equal(f.difficulty, Math.min(10, 5 + (sm2.l || 0)));
      assert.equal(f.lapses, sm2.l || 0);
      assert.equal(f.last_review, sm2.t);
      assert.equal(f.due, dayStart(sm2.d));
      assert.equal(dayIndex(f.due), sm2.d, 'срок — тот же учебный день, что был в SM-2');
    } else {
      assert.equal(sm2.s, 1);
      assert.equal(f.state, State.Learning, r.card);
      assert.ok(isLearning(f));
      assert.equal(f.due, NOW, 'изучаемая — сразу к повторению');
      assert.ok(f.stability > 0 && f.difficulty >= 1 && f.difficulty <= 10, 'память посчитана самим ts-fsrs');
    }
    if (sm2.k != null) assert.equal(r.k, sm2.k, 'номер примера для английских карточек перенесён');
  }
  const meta = await db.get('settings', 'meta');
  assert.equal(meta.fsrsAt, NOW);
  assert.ok(meta.seededAt, 'остальные отметки не потерялись');
  db.close();
});

test('перед переходом сохраняется снимок всей базы, и он восстанавливается как обычная копия', async () => {
  const db = await freshDB();
  await seedIfNeeded(db, loadLegacy, NOW - 1000);
  const before = await db.exportAll();
  await migrateToFsrs(db, NOW);
  const snap = await db.get('snapshots', 'before-fsrs');
  assert.equal(snap.createdAt, NOW);
  assert.deepEqual(snap.data, before);

  // снимок → файл копии → восстановление в другую базу: там снова SM-2, и переход повторяется
  const text = JSON.stringify(makeBackup(snap.data, snap.createdAt));
  const other = await freshDB();
  await other.replaceAll(dataForRestore(parseBackup(text)));
  assert.ok((await other.getAll('cardState')).every(r => r.sm2 && !r.fsrs));
  assert.equal(await migrateToFsrs(other, NOW + 1000), 80);
  db.close(); other.close();
});

test('переход выполняется один раз; новые записи без sm2 тоже не ломаются', async () => {
  const db = await freshDB();
  await seedIfNeeded(db, loadLegacy, NOW - 1000);
  await migrateToFsrs(db, NOW);
  const after = await db.exportAll();
  assert.equal(await migrateToFsrs(db, NOW + 5000), 0, 'второй раз переводить нечего');
  assert.deepEqual(await db.exportAll(), after, 'ничего не изменилось');
  assert.equal((await db.get('snapshots', 'before-fsrs')).createdAt, NOW, 'снимок не перезаписан');
  assert.equal(sm2ToFsrs(undefined, NOW).state, State.New);
  assert.equal(sm2ToFsrs({ s: 0 }, NOW).state, State.New);
  db.close();
});

test('база версии 1 обновляется до версии 2 без потерь', async () => {
  const factory = new IDBFactory();
  const v1 = await openDB(factory, 'sayatsays', 1);
  await seedIfNeeded(v1, loadLegacy, NOW - 1000);
  const before = await v1.exportAll();
  v1.close();
  const v2 = await openDB(factory, 'sayatsays');
  assert.equal(v2.idb.version, 2);
  assert.ok(v2.idb.objectStoreNames.contains('snapshots'));
  assert.deepEqual(await v2.exportAll(), before);
  assert.equal(await migrateToFsrs(v2, NOW), 80);
  v2.close();
});

test('резервная копия с FSRS восстанавливается без повторного перевода', async () => {
  const db = await freshDB();
  await seedIfNeeded(db, loadLegacy, NOW - 1000);
  await migrateToFsrs(db, NOW);
  const data = await db.exportAll();
  const other = await freshDB();
  await other.replaceAll(dataForRestore(parseBackup(JSON.stringify(makeBackup(data, NOW)))));
  assert.equal(await migrateToFsrs(other, NOW + 1000), 0);
  assert.deepEqual(await other.getAll('cardState'), data.cardState);
  db.close(); other.close();
});
