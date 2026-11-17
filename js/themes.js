// Темы оформления. Цвета каждой темы — в css/app.css, в блоке :root[data-theme="…"].
// Здесь только список: id (так тема записана в настройках и в атрибуте data-theme) и название для экрана.
//
// Как добавить тему: допиши её сюда и добавь в css/app.css блок с теми же переменными, что у других тем.
// Тест tests/themes.test.js проверит, что все переменные на месте и текст читается (контраст).

// Сначала светлые, потом тёмные.
export const THEMES = [
  { id: 'auto', name: 'Как в системе' },
  { id: 'light', name: 'Светлая' },
  { id: 'paper', name: 'Бумага' },
  { id: 'mint', name: 'Мята' },
  { id: 'sky', name: 'Небо' },
  { id: 'dark', name: 'Тёмная' },
  { id: 'concrete', name: 'Бетон' },
  { id: 'graphite', name: 'Графит' },
  { id: 'ash', name: 'Пепел' },
  { id: 'nebula', name: 'Туманность' },
  { id: 'tush', name: 'Смерть' }, // id остался от первого названия, «Тушь»: он уже записан в настройках
  { id: 'wormwood', name: 'Полынь' },
  { id: 'deep', name: 'Глубина' },
  { id: 'garnet', name: 'Гранат' }
];

export const DEFAULT_THEME = 'auto';
export const isTheme = id => THEMES.some(t => t.id === id);

// Ключ в localStorage: копия выбранной темы. Её читает маленький скрипт в index.html до первой отрисовки,
// чтобы при запуске не мелькала светлая тема, — база данных открывается позже. Главная запись — в настройках (база).
export const THEME_KEY = 'sayatsays-theme';
