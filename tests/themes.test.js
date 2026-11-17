// Темы: у каждой есть все цвета, текст читается, тема не мелькает при запуске.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { THEMES, THEME_KEY, DEFAULT_THEME } from '../js/themes.js';

const css = readFileSync(new URL('../css/app.css', import.meta.url), 'utf8');
const html = readFileSync(new URL('../index.html', import.meta.url), 'utf8');
const TOKENS = ['--bg', '--surface', '--surface2', '--ink', '--muted', '--line', '--kz', '--en', '--qa', '--good', '--bad',
  '--focus', '--on-good', '--accent', '--on-accent', '--shadow', '--r', '--hair'];

// Переменные темы из css/app.css: блок, в заголовке которого есть [data-swatch="id"].
function themeVars(id) {
  const m = css.match(new RegExp('^([^{}\\n]*\\[data-swatch="' + id + '"\\][^{}\\n]*)\\{([^}]*)\\}', 'm'));
  assert.ok(m, 'нет блока цветов для темы ' + id);
  const vars = {};
  for (const [, k, v] of m[2].matchAll(/(--[\w-]+)\s*:\s*([^;]+);/g)) vars[k] = v.trim();
  vars.scheme = (m[2].match(/color-scheme\s*:\s*(\w+)/) || [])[1];
  return { head: m[1], vars };
}

// Контраст двух цветов по формуле WCAG: от 1 (одинаковые) до 21 (чёрный на белом).
function contrast(a, b) {
  const lum = hex => {
    const [r, g, bl] = [1, 3, 5].map(i => parseInt(hex.slice(i, i + 2), 16) / 255)
      .map(c => c <= 0.04045 ? c / 12.92 : ((c + 0.055) / 1.055) ** 2.4);
    return 0.2126 * r + 0.7152 * g + 0.0722 * bl;
  };
  const [x, y] = [lum(a), lum(b)].sort((p, q) => q - p);
  return (x + 0.05) / (y + 0.05);
}

test('список тем: «Как в системе» первая, id не повторяются', () => {
  assert.equal(THEMES[0].id, DEFAULT_THEME);
  assert.equal(new Set(THEMES.map(t => t.id)).size, THEMES.length);
  assert.ok(THEMES.length >= 10);
});

test('у каждой темы есть все переменные и свой селектор', () => {
  for (const t of THEMES) {
    const { head, vars } = themeVars(t.id);
    for (const k of TOKENS) assert.ok(vars[k], t.id + ': нет ' + k);
    assert.ok(['light', 'dark'].includes(vars.scheme), t.id + ': нет color-scheme');
    if (t.id === 'light' || t.id === 'auto') assert.match(head, /^:root,/, 'светлая — цвета по умолчанию');
    else assert.ok(head.includes(':root[data-theme="' + t.id + '"]'), t.id + ': нет :root[data-theme="' + t.id + '"]');
  }
  // Тёмная «как в системе» включается только без выбранной темы, иначе перебила бы её.
  assert.match(css, /@media \(prefers-color-scheme: dark\)\{\s*:root:not\(\[data-theme\]\)\{/);
});

test('новые темы: текст и кнопки хорошо читаются', () => {
  // Светлая и тёмная — из артефакта, их цвета не меняли. Остальные проверяем по WCAG:
  // обычный текст — от 4.5, основной — от 7, заполненные дни и столбики графиков — от 3 к фону.
  const rules = [['--ink', '--bg', 7], ['--ink', '--surface', 7], ['--muted', '--bg', 4.5], ['--muted', '--surface', 4.5],
    ['--kz', '--bg', 4.5], ['--kz', '--surface', 4.5], ['--en', '--bg', 4.5], ['--en', '--surface', 4.5],
    ['--qa', '--bg', 4.5], ['--qa', '--surface', 4.5], ['--bad', '--surface', 4.5], ['--good', '--surface', 4.5],
    ['--on-good', '--good', 4.5], ['--on-accent', '--accent', 4.5], ['--accent', '--bg', 3]];
  for (const t of THEMES.filter(x => !['auto', 'light', 'dark'].includes(x.id))) {
    const { vars } = themeVars(t.id);
    for (const [a, b, min] of rules) {
      const c = contrast(vars[a], vars[b]);
      assert.ok(c >= min, t.id + ': ' + a + ' на ' + b + ' — контраст ' + c.toFixed(2) + ', нужно от ' + min);
    }
  }
});

test('index.html ставит тему до первой отрисовки, тем же ключом, что app.js', () => {
  const head = html.slice(0, html.indexOf('</head>'));
  const script = head.indexOf("localStorage.getItem('" + THEME_KEY + "')");
  assert.ok(script > 0, 'в <head> читается ' + THEME_KEY);
  assert.ok(script > head.indexOf('css/app.css'), 'после стилей');
  assert.ok(script < head.indexOf('js/app.js'), 'раньше app.js');
});
