// Офлайн-режим: service worker должен знать обо всех файлах приложения,
// иначе без интернета что-то не загрузится — и это легко не заметить.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync, readdirSync, existsSync } from 'node:fs';
import { VERSION } from '../js/version.js';

const root = new URL('../', import.meta.url);
const read = p => readFileSync(new URL(p, root), 'utf8');
const sw = read('sw.js');
const listed = [...sw.match(/const FILES = \[([\s\S]*?)\];/)[1].matchAll(/'([^']+)'/g)].map(m => m[1]);
const manifest = JSON.parse(read('manifest.webmanifest'));

// Размер PNG из заголовка файла: ширина и высота лежат в байтах 16–23.
function pngSize(p) {
  const b = readFileSync(new URL(p, root));
  return b.readUInt32BE(16) + 'x' + b.readUInt32BE(20);
}

test('все файлы из списка sw.js существуют', () => {
  for (const f of listed) if (f !== './') assert.ok(existsSync(new URL(f, root)), 'нет файла: ' + f);
  assert.equal(new Set(listed).size, listed.length, 'в списке есть повторы');
});

test('в списке sw.js есть все файлы приложения', () => {
  const need = ['./', './index.html', './manifest.webmanifest'];
  for (const dir of ['css', 'js', 'fonts', 'data']) {
    for (const name of readdirSync(new URL(dir + '/', root))) {
      if (dir === 'fonts' && !name.endsWith('.woff2')) continue; // лицензии офлайн не нужны
      need.push('./' + dir + '/' + name);
    }
  }
  for (const icon of manifest.icons) need.push('./' + icon.src);
  for (const m of read('index.html').matchAll(/href="(\.\/icons\/[^"]+)"/g)) need.push(m[1]);
  for (const f of need) assert.ok(listed.includes(f), 'добавь в FILES в sw.js: ' + f);
});

test('версия в sw.js совпадает с js/version.js', () => {
  assert.equal(Number(sw.match(/const VERSION = (\d+);/)[1]), VERSION,
    'подними VERSION одинаково в sw.js и js/version.js');
});

test('манифест: отдельное окно, относительные пути, иконки any и maskable нужного размера', () => {
  assert.equal(manifest.name, 'SayatSays');
  assert.equal(manifest.short_name, 'SayatSays');
  assert.equal(manifest.display, 'standalone');
  assert.equal(manifest.start_url, './');
  assert.equal(manifest.scope, './');
  for (const size of ['192x192', '512x512']) {
    for (const purpose of ['any', 'maskable']) {
      const icon = manifest.icons.find(i => i.sizes === size && i.purpose === purpose);
      assert.ok(icon, 'нет иконки ' + size + ' ' + purpose);
      assert.ok(!icon.src.startsWith('/'), 'путь должен быть относительным: ' + icon.src);
      assert.equal(pngSize(icon.src), size, icon.src);
    }
  }
  assert.equal(pngSize('icons/apple-touch-icon.png'), '180x180');
});

test('иконки без прозрачности (iOS заливает прозрачное чёрным)', () => {
  for (const f of ['apple-touch-icon.png', 'icon-192.png', 'icon-512.png', 'icon-1024.png', 'icon-maskable-192.png', 'icon-maskable-512.png']) {
    const b = readFileSync(new URL('icons/' + f, root));
    const colorType = b[25]; // 2 — RGB без альфа-канала, 6 — RGBA
    assert.equal(colorType, 2, f + ': ожидался PNG без альфа-канала');
    assert.ok(!b.includes('tRNS'), f + ': есть прозрачный цвет (tRNS)');
  }
});
