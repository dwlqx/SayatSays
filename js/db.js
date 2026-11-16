// Хранилище на устройстве. IndexedDB — база данных, встроенная в браузер: данные лежат только
// на этом телефоне или компьютере, в базе этого сайта, и переживают перезагрузку.
// Здесь тонкая обёртка без библиотек. IndexedDB сообщает о результатах событиями (onsuccess, onerror),
// а мы превращаем их в Promise, чтобы писать await.
//
// Хранилища (object stores):
//   decks      колоды целиком, как в data/decks.json; ключ — id колоды
//   cardState  состояние карточки { deck, card, fsrs: {…}, sm2?: {…}, k?: номер примера }; ключ — пара [deck, card]
//              (в разных колодах id карточек могут совпасть, поэтому ключ из двух частей).
//              fsrs — расписание сейчас (см. scheduler.js); sm2 — старое состояние из артефакта, хранится как было.
//   reviewLog  журнал ответов { id, deck, card, rating, review, …состояние до ответа }; ключ id — время ответа в мс
//   settings   { key: 'prefs', newPerDay, goal, streak, retention } — настройки
//              { key: 'meta', seededAt, fsrsAt, lastBackupAt, … } — служебное: когда что произошло
//   stats      по дням { day, n, done, nw: { [id колоды]: сколько новых карточек взято } }; ключ — номер дня
//   snapshots  снимки всей базы перед большими изменениями (сейчас один — перед переходом на FSRS); ключ id.
//              В резервную копию не входят.
//
// Версии базы: 1 — первые пять хранилищ (задача 1); 2 — добавлено snapshots (задача 3).

export const DB_NAME = 'sayatsays';
export const DB_VERSION = 2;
// Хранилища, которые входят в резервную копию.
export const STORES = ['decks', 'cardState', 'reviewLog', 'settings', 'stats'];

const promisify = request => new Promise((resolve, reject) => {
  request.onsuccess = () => resolve(request.result);
  request.onerror = () => reject(request.error);
});

// Открыть базу. factory — сам IndexedDB (в тестах подставляется ненастоящий, из пакета fake-indexeddb).
// version можно указать в тестах, чтобы создать базу старой версии и проверить обновление.
export function openDB(factory = globalThis.indexedDB, name = DB_NAME, version = DB_VERSION) {
  return new Promise((resolve, reject) => {
    if (!factory) { reject(new Error('Этот браузер не умеет хранить данные (нет IndexedDB).')); return; }
    const request = factory.open(name, version);
    // Вызывается, когда базы ещё нет или у неё версия меньше нужной: здесь создаётся и обновляется структура.
    // Шаги идут по порядку: база версии 1 получит только шаг 2, новая база — оба. Данные при этом не трогаются.
    request.onupgradeneeded = event => {
      const db = request.result, from = event.oldVersion, to = event.newVersion;
      if (from < 1) {
        db.createObjectStore('decks', { keyPath: 'id' });
        const cardState = db.createObjectStore('cardState', { keyPath: ['deck', 'card'] });
        cardState.createIndex('deck', 'deck'); // чтобы быстро найти все состояния одной колоды
        db.createObjectStore('reviewLog', { keyPath: 'id', autoIncrement: true });
        db.createObjectStore('settings', { keyPath: 'key' });
        db.createObjectStore('stats', { keyPath: 'day' });
      }
      if (from < 2 && to >= 2) {
        db.createObjectStore('snapshots', { keyPath: 'id' });
      }
    };
    request.onsuccess = () => resolve(new DB(request.result));
    request.onerror = () => reject(request.error);
  });
}

export class DB {
  constructor(idb) {
    this.idb = idb;
    // Если в другой вкладке открылась новая версия приложения с новой версией базы — уступаем ей место.
    idb.onversionchange = () => idb.close();
  }

  close() { this.idb.close(); }

  get(store, key) { return promisify(this.idb.transaction(store).objectStore(store).get(key)); }

  getAll(store) { return promisify(this.idb.transaction(store).objectStore(store).getAll()); }

  // Записать несколько изменений одной транзакцией: сохранится либо всё, либо ничего.
  // fn получает хранилища и только ставит запросы (put, delete, clear). Внутри fn нельзя await:
  // IndexedDB завершает транзакцию, как только ей становится нечего делать.
  // Пример: await db.write(['cardState', 'stats'], s => { s.cardState.put(rec); s.stats.put(day); });
  write(stores, fn) {
    return new Promise((resolve, reject) => {
      const tx = this.idb.transaction(stores, 'readwrite');
      const s = {};
      for (const name of stores) s[name] = tx.objectStore(name);
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error);
      tx.onabort = () => reject(tx.error || new Error('Запись прервана.'));
      try { fn(s); } catch (e) { reject(e); tx.abort(); }
    });
  }

  // Удалить колоды вместе с состояниями их карточек.
  deleteDecks(ids) {
    return this.write(['decks', 'cardState'], s => {
      for (const id of ids) {
        s.decks.delete(id);
        // Сначала находим ключи состояний этой колоды по индексу, потом удаляем — в той же транзакции.
        const keys = s.cardState.index('deck').getAllKeys(id);
        keys.onsuccess = () => keys.result.forEach(k => s.cardState.delete(k));
      }
    });
  }

  // Всё содержимое базы одним снимком: { decks: [...], cardState: [...], ... } — для резервной копии.
  exportAll() {
    return new Promise((resolve, reject) => {
      const tx = this.idb.transaction(STORES);
      const out = {};
      for (const name of STORES) {
        const r = tx.objectStore(name).getAll();
        r.onsuccess = () => { out[name] = r.result; };
      }
      tx.oncomplete = () => resolve(out);
      tx.onerror = () => reject(tx.error);
    });
  }

  // Заменить всё содержимое базы (восстановление из копии).
  // Одна транзакция: если что-то пойдёт не так, старые данные останутся как были.
  replaceAll(data) {
    return this.write(STORES, s => {
      for (const name of STORES) {
        s[name].clear();
        for (const rec of data[name] || []) s[name].put(rec);
      }
    });
  }
}
