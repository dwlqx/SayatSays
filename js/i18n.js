// Язык интерфейса: русский или английский. Модуль без DOM — его проверяют тесты (tests/i18n.test.js).
//
// Как это устроено:
//   — в коде тексты пишутся по-русски через t('…'): русский текст — он же ключ к переводу;
//   — английский перевод — в словаре EN ниже. Нет перевода — показывается русский текст
//     (тест проверит, что у каждого t('…') перевод есть);
//   — подстановки в фигурных скобках: t('Сегодня {n} из {goal} ответов.', { n: 3, goal: 10 });
//   — число со словом: count(5, 'карточка', 'карточки', 'карточек') → «5 карточек» / «5 cards».
//     Английские формы слов — в словаре WORDS.
// Какой язык выбран, решает app.js (настройка «Язык» или язык телефона) и сообщает сюда через setLang.

export const LANGS = ['auto', 'ru', 'en'];
export const isLang = l => LANGS.includes(l);
// Ключ в localStorage: копия языка, чтобы «Загружаю…» при запуске было на нужном языке.
export const LANG_KEY = 'sayatsays-lang';

let lang = 'ru';
export function setLang(l) { lang = l === 'en' ? 'en' : 'ru'; }
export const getLang = () => lang;
// Для дат: '17 ноября' или '17 November'.
export const locale = () => lang === 'en' ? 'en-GB' : 'ru-RU';

// Язык «как на телефоне»: русский, если телефон на русском или на языке, где русский обычно понятен
// (казахский, украинский, белорусский, киргизский), иначе английский.
export function systemLang(languages) {
  const first = String((languages && languages[0]) || '').toLowerCase();
  return /^(ru|kk|uk|be|ky)\b/.test(first) ? 'ru' : 'en';
}

export function t(ru, vars) {
  const s = lang === 'en' && EN[ru] != null ? EN[ru] : ru;
  return vars ? s.replace(/\{(\w+)\}/g, (m, k) => (k in vars ? String(vars[k]) : m)) : s;
}

// Слово для числа: word(5, 'день', 'дня', 'дней') → «дней» / «days».
export function word(n, one, few, many) {
  if (lang === 'en') {
    const en = WORDS[one];
    if (en) return Math.abs(n) === 1 ? en[0] : en[1];
  }
  const m = Math.abs(n) % 100, k = m % 10;
  if (m > 10 && m < 20) return many;
  if (k > 1 && k < 5) return few;
  if (k === 1) return one;
  return many;
}
export const count = (n, one, few, many) => n + ' ' + word(n, one, few, many);

// Английские формы для count и word: [одно, много]. Ключ — русская форма для одного.
export const WORDS = {
  'день': ['day', 'days'],
  'карточка': ['card', 'cards'],
  'ответ': ['answer', 'answers'],
  'колода': ['deck', 'decks']
};

// Английский перевод. Ключ — текст по-русски, ровно как в t('…').
export const EN = {
  // --- общее, главный экран, серия ---
  'Загружаю…': 'Loading…',
  'Не получилось открыть данные.': 'Couldn’t open your data.',
  'Не удалось сохранить на устройстве: {e}': 'Couldn’t save on this device: {e}',
  'Не удалось загрузить {url} (ошибка {code}).': 'Couldn’t load {url} (error {code}).',
  'Расписание теперь считает FSRS. Копия данных до перехода — в Настройки → Данные.': 'The schedule now uses FSRS. A copy of your data from before the switch is in Settings → Data.',
  'Сегодня ответов: {n}': 'Answers today: {n}',
  'занимался': 'studied',
  'заморозка': 'freeze',
  'сегодня': 'today',
  'впереди': 'ahead',
  'пропуск': 'missed',
  'Сегодня засчитано.': 'Today is done.',
  'Сегодня {n} из {goal} ответов.': 'Today {n} of {goal} answers.',
  '{days} подряд': '{days} in a row',
  'Заморозок на этой неделе осталось: {n}.': 'Freezes left this week: {n}.',
  'выучено {n} из {total}': 'learned {n} of {total}',
  'на сегодня {n}': 'due today {n}',
  'Статистика': 'Statistics',
  'Настройки': 'Settings',
  'Колод пока нет.': 'No decks yet.',
  'Попроси Claude сделать карточки и перенеси их сюда — или создай колоду сам.': 'Ask Claude to make cards and bring them here — or create a deck yourself.',
  'Добавить колоды': 'Add decks',
  'Повторить всё': 'Review all',
  'На сегодня всё повторено': 'All done for today',
  'Колоды': 'Decks',
  'Добавить': 'Add',

  // --- колода ---
  'Казахский: русский → казахский': 'Kazakh: Russian → Kazakh',
  'Казахский: казахский → русский': 'Kazakh: Kazakh → Russian',
  'Английский: предложение с пропуском': 'English: sentence with a gap',
  'Предмет: вопрос и ответ': 'Subject: question and answer',
  'Изменить название и место колоды': 'Rename or move the deck',
  'новые': 'new',
  'изучаются': 'learning',
  'выучено': 'learned',
  'всего': 'total',
  'Учить': 'Study',
  'На сегодня всё': 'Done for today',
  'Подколоды': 'Subdecks',
  'Нет подколод.': 'No subdecks.',
  'Карточки': 'Cards',
  'От Claude': 'From Claude',
  'Карточек пока нет. Добавь сам или попроси Claude: «От Claude» — там инструкция для чата.': 'No cards yet. Add them yourself or ask Claude: “From Claude” has an instruction for the chat.',
  'Нажми на карточку, чтобы исправить её.': 'Tap a card to edit it.',
  'Удалить карточку': 'Delete card',
  'Удалить колоду': 'Delete deck',

  // --- занятие ---
  'пропуск в предложении': 'gap',
  'По-русски?': 'In Russian?',
  'Показать ответ': 'Show answer',
  'Не знал': 'Didn’t know',
  'Трудно': 'Hard',
  'Знал': 'Knew',
  'Легко': 'Easy',
  'Закончить': 'Finish',
  'осталось': 'left',
  'Исправить карточку': 'Edit card',
  'Отменить последний ответ': 'Undo last answer',
  'Пробел — перевернуть, 1 — не знал, 2 — трудно, 3 — знал, 4 — легко': 'Space — flip, 1 — didn’t know, 2 — hard, 3 — knew, 4 — easy',
  'Пробел — перевернуть, 1 — не знал, 2 — знал': 'Space — flip, 1 — didn’t know, 2 — knew',
  'Карточек к повторению нет. Загляни завтра.': 'Nothing to review. Come back tomorrow.',
  'Готово': 'Done',
  'Ответов: {n}, из них вспомнил: {good}.': 'Answers: {n}, remembered: {good}.',
  'Ответов: {n}, из них «знал»: {good}.': 'Answers: {n}, “knew”: {good}.',
  'День засчитан. Серия: {days}.': 'Day done. Streak: {days}.',
  'До зачёта дня осталось ответов: {n}.': 'Answers left to complete the day: {n}.',
  'На главную': 'Home',
  'мин': 'min',
  'ч': 'h',
  'дн': 'd',
  'мес': 'mo',
  'г': 'y',

  // --- колоды и карточки: формы ---
  'Верхний уровень': 'Top level',
  'Новая колода': 'New deck',
  'Название': 'Name',
  'Например, СОЧ 2 четверть': 'For example, Biology: cells',
  'Тип карточек': 'Card type',
  'Где лежит': 'Inside',
  'Отмена': 'Cancel',
  'Создать': 'Create',
  'Впиши название колоды.': 'Enter a deck name.',
  'Колода': 'Deck',
  'Тип: {type}. Его не поменять: у разных типов разные поля карточек.': 'Type: {type}. It can’t be changed: different types have different card fields.',
  'Сохранить': 'Save',
  'Колоду нельзя положить внутрь неё самой.': 'A deck can’t be put inside itself.',
  'Колода сохранена.': 'Deck saved.',
  'По-русски': 'Russian',
  'Заметка, если нужна': 'Note, if needed',
  'Слово': 'Word',
  'Транскрипция': 'Transcription',
  'Перевод': 'Translation',
  'Пояснение на английском': 'Definition in English',
  'Предложения, по одному на строку': 'Sentences, one per line',
  'Слово в предложении возьми в фигурные скобки: на карточке на его месте будет пропуск.': 'Put the word in the sentence in curly braces: the card will show a gap in its place.',
  'Вопрос': 'Question',
  'Ответ': 'Answer',
  'Карточка в «{deck}»': 'Card in “{deck}”',
  'Прогресс по карточке сохранится.': 'The card’s progress will be kept.',
  'Карточка сохранена.': 'Card saved.',
  'Карточка добавлена.': 'Card added.',

  // --- добавить колоды: от Claude и из файла ---
  'внутри «{deck}»': 'inside “{deck}”',
  'Новая колода «{deck}»': 'New deck “{deck}”',
  'повторы пропущены: {n}': 'duplicates skipped: {n}',
  'уже были: {n}': 'already there: {n}',
  'ничего нового, все {cards} уже есть': 'nothing new, all {cards} are already there',
  'Добавится:': 'Will be added:',
  'Карточки от Claude': 'Cards from Claude',
  'Для колоды «{deck}». Инструкция подскажет Claude, какие карточки в ней уже есть.': 'For the deck “{deck}”. The instruction tells Claude which cards it already has.',
  'Скопируй инструкцию и вставь её в чат с Claude. Ниже допиши, что нужно, например: «30 карточек на тему "Қала"».': 'Copy the instruction and paste it into a chat with Claude. Below it, write what you need, for example: “30 cards about the city”.',
  'В ответе Claude нажми «Копировать» у блока с кодом.': 'In Claude’s reply, tap Copy on the code block.',
  'Вернись сюда, нажми «Вставить ответ Claude», проверь, что добавится, и нажми «Добавить».': 'Come back here, tap “Paste Claude’s reply”, check what will be added and tap “Add”.',
  'Скопировать инструкцию для Claude': 'Copy the instruction for Claude',
  'Вставить ответ Claude': 'Paste Claude’s reply',
  'Ответ Claude': 'Claude’s reply',
  'Или': 'Or',
  'Создать колоду самому': 'Create a deck yourself',
  'Добавить из файла': 'Add from a file',
  'Файл — в формате decks.json. Колоды с тем же id дополняются новыми карточками, прогресс не теряется.': 'The file is in decks.json format. Decks with the same id get the new cards; progress is kept.',
  'Перешли эту ошибку Claude — он исправит.': 'Send this error to Claude — it will fix it.',
  'Скопировать ошибку': 'Copy the error',
  'Текст для копирования': 'Text to copy',
  'Не получилось скопировать само — текст выделен ниже, скопируй его.': 'Couldn’t copy automatically — the text is selected below, copy it.',
  'Инструкция скопирована. Вставь её в чат с Claude и допиши, что нужно.': 'Instruction copied. Paste it into a chat with Claude and say what you need.',
  'Приложение не приняло карточки: {e} Исправь, пожалуйста, и пришли JSON целиком заново.': 'The app didn’t accept the cards: {e} Please fix it and send the whole JSON again.',
  'Ошибка скопирована — вставь её в чат с Claude.': 'Error copied — paste it into the chat with Claude.',
  'Не получилось вставить само: нажми в поле и выбери «Вставить».': 'Couldn’t paste automatically: tap the field and choose Paste.',
  'Ничего нового: все эти карточки уже есть.': 'Nothing new: all these cards are already there.',
  'Не удалось сохранить колоды: {e}': 'Couldn’t save the decks: {e}',
  'Добавлено: {decks}, {cards}.': 'Added: {decks}, {cards}.',

  // --- настройки ---
  'Копий ещё не было.': 'No backups yet.',
  'вчера': 'yesterday',
  '{days} назад': '{days} ago',
  'Последняя копия: {when}.': 'Last backup: {when}.',
  'Как на телефоне': 'Same as phone',
  'Новых карточек в день на колоду': 'New cards per day per deck',
  'Ответов, чтобы день засчитался': 'Answers to complete a day',
  'День засчитывается и тогда, когда ты повторил всё, что было на сегодня, даже если ответов меньше.': 'A day also counts when you’ve reviewed everything due today, even with fewer answers.',
  'Показывать серию дней': 'Show the day streak',
  'Пропуск дня не обнуляет серию, пока на неделе есть заморозки: их две.': 'A missed day doesn’t break the streak while you have freezes left this week: there are two.',
  'Целевая запоминаемость:': 'Target retention:',
  'Какую долю карточек ты вспоминаешь, когда они приходят на повторение. Выше — меньше забываешь, но больше повторений каждый день. 90 % — хороший выбор. Новое значение действует со следующих ответов.': 'The share of cards you remember when they come up for review. Higher means forgetting less but more reviews every day. 90 % is a good choice. A new value applies from your next answers.',
  '«Выучено» — карточки, которые ты, по расчёту FSRS, будешь помнить хотя бы 3 недели.': '“Learned” means cards that, by FSRS’s estimate, you’ll remember for at least 3 weeks.',
  'Кнопки ответа': 'Answer buttons',
  'Две: «Не знал» и «Знал»': 'Two: “Didn’t know” and “Knew”',
  'Четыре: ещё «Трудно» и «Легко»': 'Four: plus “Hard” and “Easy”',
  '«Трудно» — вспомнил, но с трудом: карточка вернётся чуть раньше, чем после «Знал». «Легко» — знал сразу: вернётся намного позже. Свайпы те же: влево — «Не знал», вправо — «Знал».': '“Hard” — you remembered with effort: the card comes back a bit sooner than after “Knew”. “Easy” — you knew it at once: it comes back much later. Swipes stay the same: left — “Didn’t know”, right — “Knew”.',
  'Тема': 'Theme',
  'Тема меняется сразу.': 'The theme changes right away.',
  'Данные': 'Data',
  'Колоды и прогресс хранятся только на этом устройстве. Время от времени делай резервную копию и сохраняй её в «Файлы» или в облако.': 'Decks and progress are stored only on this device. Make a backup from time to time and keep it in Files or a cloud drive.',
  'Сделать резервную копию': 'Make a backup',
  'Восстановить из копии': 'Restore from backup',
  'Скачать копию до перехода на FSRS': 'Download the copy from before FSRS',
  'Новые колоды — от Claude или из файла — добавляются кнопкой «Добавить» на главном экране.': 'New decks — from Claude or from a file — are added with “Add” on the main screen.',
  'Копия до перехода на FSRS — данные в том виде, какими они были до обновления. Её можно восстановить кнопкой «Восстановить из копии».': 'The copy from before FSRS is your data as it was before the update. You can restore it with “Restore from backup”.',
  'Как пользоваться': 'How to use',
  'Как установить на экран «Домой»': 'How to add to the Home Screen',
  'SayatSays, версия {v}': 'SayatSays, version {v}',

  // --- темы ---
  'Как в системе': 'System',
  'Светлая': 'Light',
  'Бумага': 'Paper',
  'Мята': 'Mint',
  'Небо': 'Sky',
  'Тёмная': 'Dark',
  'Бетон': 'Concrete',
  'Графит': 'Graphite',
  'Пепел': 'Ash',
  'Туманность': 'Nebula',
  'Смерть': 'Death',
  'Полынь': 'Wormwood',
  'Глубина': 'Deep',
  'Гранат': 'Garnet',

  // --- число на иконке и напоминания ---
  'Напоминания': 'Reminders',
  'Число на иконке': 'Icon badge',
  'Когда откроешь SayatSays с экрана «Домой», на иконке можно будет показывать, сколько карточек на сегодня.': 'When you open SayatSays from the Home Screen, the icon can show how many cards are due today.',
  'Это устройство не умеет показывать число на иконке. На iPhone нужна iOS 16.4 или новее.': 'This device can’t show a number on the icon. On iPhone you need iOS 16.4 or later.',
  'Включено: на иконке — сколько карточек на сегодня, как на кнопке «Повторить всё».': 'On: the icon shows how many cards are due today, like the “Review all” button.',
  'Уведомления для SayatSays запрещены, поэтому iPhone не показывает число на иконке. Включить: Настройки iPhone → Уведомления → SayatSays → разреши уведомления и «Наклейки».': 'Notifications for SayatSays are turned off, so iPhone doesn’t show the number on the icon. To turn on: iPhone Settings → Notifications → SayatSays → allow notifications and Badges.',
  'Сколько карточек на сегодня — прямо на иконке приложения. iPhone покажет число, только если разрешить уведомления; присылать уведомления приложение не будет.': 'How many cards are due today — right on the app icon. iPhone shows the number only if you allow notifications; the app won’t send any notifications.',
  'Показывать число на иконке': 'Show the number on the icon',
  'в инструкции для разработчиков': 'in the developer guide',
  'Напоминания по расписанию': 'Scheduled reminders',
  'Утром и вечером присылает GitHub из репозитория проекта. Поэтому они работают только у того, кто сделал свою копию проекта на GitHub и настроил ключи: как это сделать — {link}. Если копия твоя — включай:': 'They are sent every morning and evening by GitHub from the project’s repository. So they only work for someone who has made their own copy of the project on GitHub and set up the keys: how to do it is {link}. If this copy is yours, turn them on:',
  'Включить напоминания': 'Turn on reminders',
  'секреты репозитория на GitHub': 'the repository secrets on GitHub',
  'Напоминания включены на этом телефоне. Время задаётся на GitHub, в файле .github/workflows/reminder.yml.': 'Reminders are on for this phone. The time is set on GitHub, in .github/workflows/reminder.yml.',
  'Подписка для GitHub': 'Subscription for GitHub',
  'Нажми «Скопировать».': 'Tap “Copy”.',
  'Открой {link} и нажми «New repository secret».': 'Open {link} and tap “New repository secret”.',
  'Name: {name}, в Secret вставь скопированное, нажми «Add secret». Если такой секрет уже есть — нажми карандаш рядом с ним и вставь новое.': 'Name: {name}, paste what you copied into Secret and tap “Add secret”. If the secret already exists, tap the pencil next to it and paste the new one.',
  'Проверь: на GitHub открой Actions → «Напоминание» → «Run workflow».': 'Check: on GitHub open Actions → “Напоминание” → “Run workflow”.',
  'Скопировать': 'Copy',
  'Создать новую подписку': 'Create a new subscription',
  'Новая подписка нужна, если GitHub пишет «подписка устарела». После неё обнови секрет PUSH_SUBSCRIPTION.': 'You need a new subscription if GitHub says it has expired. After that, update the PUSH_SUBSCRIPTION secret.',
  'Проверить уведомление': 'Test notification',
  'Готово: на иконке будет число карточек на сегодня.': 'Done: the icon will show the number of cards due today.',
  'Без разрешения iPhone не покажет число на иконке.': 'Without permission, iPhone won’t show the number on the icon.',
  'Не получилось: {e}': 'That didn’t work: {e}',
  'Старая подписка перестанет работать, и секрет PUSH_SUBSCRIPTION на GitHub нужно будет обновить. Создать новую?': 'The old subscription will stop working and you’ll need to update the PUSH_SUBSCRIPTION secret on GitHub. Create a new one?',
  'Напоминания включены. Осталось добавить подписку на GitHub.': 'Reminders are on. Now add the subscription on GitHub.',
  'Не получилось включить напоминания.': 'Couldn’t turn on reminders.',
  'Скопировано. Теперь вставь на GitHub.': 'Copied. Now paste it on GitHub.',
  'Не получилось скопировать само — текст выделен, скопируй его.': 'Couldn’t copy automatically — the text is selected, copy it.',
  'Готово. Если уведомления не видно — смахни вниз от верхнего края экрана.': 'Done. If you don’t see the notification, swipe down from the top of the screen.',
  'Уведомления запрещены. Включи их: Настройки iPhone → Уведомления → SayatSays.': 'Notifications are turned off. Turn them on: iPhone Settings → Notifications → SayatSays.',
  'Без разрешения на уведомления напоминания не придут.': 'Without permission for notifications, reminders won’t arrive.',

  // --- резервная копия ---
  'Не удалось прочитать данные для копии.': 'Couldn’t read the data for the backup.',
  'Резервная копия готова.': 'Backup ready.',
  'Копии до перехода на FSRS нет.': 'There is no copy from before FSRS.',
  'Копия до перехода на FSRS готова.': 'The copy from before FSRS is ready.',
  'Восстановить копию от {when}?': 'Restore the backup from {when}?',
  'В ней колод: {decks}, карточек: {cards}.': 'It has {decks} decks and {cards} cards.',
  'Все текущие данные на этом устройстве — колоды, прогресс, серия и настройки — заменятся данными из копии.': 'All current data on this device — decks, progress, streak and settings — will be replaced with the backup.',
  'Не удалось восстановить: {e}': 'Couldn’t restore: {e}',
  'Данные восстановлены из копии.': 'Data restored from the backup.',
  'Файл не читается: это не JSON.': 'Can’t read the file: it isn’t JSON.',
  'Это файл с колодами, а не резервная копия. Его добавляют кнопкой «Добавить» на главном экране.': 'This is a file with decks, not a backup. Add it with “Add” on the main screen.',
  'Это не резервная копия SayatSays.': 'This isn’t a SayatSays backup.',
  'Копия сделана более новой версией приложения. Сначала обнови приложение.': 'This backup was made by a newer version of the app. Update the app first.',
  'Незнакомый формат копии.': 'Unknown backup format.',
  'Копия повреждена: нет раздела «{name}».': 'The backup is damaged: the “{name}” section is missing.',
  'Копия повреждена: ошибка в разделе «{name}».': 'The backup is damaged: error in the “{name}” section.',

  // --- удаление ---
  'Удалить «{deck}» вместе с подколодами?': 'Delete “{deck}” with its subdecks?',
  'Удалить «{deck}»?': 'Delete “{deck}”?',
  'Карточки и прогресс по ним пропадут.': 'Its cards and their progress will be lost.',
  'Удалить карточку «{card}»?': 'Delete the card “{card}”?',

  // --- статистика ---
  'Не удалось прочитать журнал ответов.': 'Couldn’t read the answer log.',
  'Числа таблицей': 'Numbers as a table',
  'Ответов за 30 дней': 'Answers in 30 days',
  'засчитано дней: {n}': 'days completed: {n}',
  '«Знал» за 7 дней': '“Knew” in 7 days',
  'за 30 дней: {p}': 'in 30 days: {p}',
  'Выучено': 'Learned',
  'из {cards}': 'of {cards}',
  'Изучаются': 'Learning',
  'новых: {n}': 'new: {n}',
  '{day}: ответов не было': '{day}: no answers',
  '{day}: {answers} (до перехода на FSRS оценки не записывались)': '{day}: {answers} (grades weren’t recorded before FSRS)',
  '{day}: {answers}, «знал» — {good} ({p})': '{day}: {answers}, “knew” — {good} ({p})',
  'Ответы по дням': 'Answers by day',
  'День': 'Day',
  'Ответов': 'Answers',
  '«Знал»': '“Knew”',
  '{day}: {cards} на повторение': '{day}: {cards} to review',
  'Сегодня: {cards} на повторение, вместе с просроченными': 'Today: {cards} to review, including overdue',
  'Прогноз на 2 недели': '2-week forecast',
  'Сколько карточек придёт на повторение, если повторять всё вовремя. Новые не считаются: их до {n} в день на колоду.': 'How many cards will come up for review if you review everything on time. New cards aren’t counted: up to {n} a day per deck.',
  'Карточек': 'Cards',
  'Сегодня': 'Today',
  'За всё время: {answers}, засчитано дней: {n}.': 'All time: {answers}, days completed: {n}.',
  'Доля «знал» считается с перехода на FSRS: раньше оценки не записывались.': 'The “knew” share is counted since the switch to FSRS: grades weren’t recorded before.',

  // --- установка и знакомство ---
  'Установи на экран «Домой»': 'Add it to your Home Screen',
  'Так SayatSays откроется как обычное приложение: на весь экран, со своей иконкой и без интернета.': 'Then SayatSays opens like a regular app: full screen, with its own icon and without internet.',
  'Нажми «Поделиться» — квадрат со стрелкой вверх. В новых iOS он может быть в меню «•••».': 'Tap Share — the square with an arrow pointing up. On newer iOS it may be in the “•••” menu.',
  'Выбери «На экран Домой» и нажми «Добавить».': 'Choose Add to Home Screen and tap Add.',
  'Дальше открывай SayatSays иконкой с экрана «Домой».': 'From then on, open SayatSays with its Home Screen icon.',
  'Важно: у Safari и у приложения на экране «Домой» разные данные, прогресс отсюда сам туда не перейдёт. Если ты уже занимался здесь, в Safari, сделай резервную копию (Настройки → Данные) и восстанови её в приложении.': 'Important: Safari and the Home Screen app keep separate data, so progress won’t move over by itself. If you’ve already studied here in Safari, make a backup (Settings → Data) and restore it in the app.',
  'Понятно': 'Got it',
  'Привет!': 'Hi!',
  'SayatSays — карточки для интервального повторения. Приложение само решает, какую карточку когда показать, чтобы ты повторял её как раз перед тем, как забудешь.': 'SayatSays is spaced-repetition flashcards. The app decides when to show each card, so you review it just before you would forget it.',
  'Для начала здесь есть колоды: казахский (слова и термины для экзамена) и английский для NUET. Не нужны — открой колоду и нажми «Удалить колоду» внизу.': 'There are starter decks to begin with: Kazakh (words and exam terms, with Russian translations) and English for the NUET exam. Don’t need them? Open a deck and tap “Delete deck” at the bottom.',
  '«Повторить всё» — занятие по всем колодам. Подумай, переверни карточку и честно ответь «Не знал» или «Знал». Можно смахнуть: влево — не знал, вправо — знал.': '“Review all” is a session across all decks. Think, flip the card and answer honestly: “Didn’t know” or “Knew”. You can also swipe: left — didn’t know, right — knew.',
  'Свои карточки — кнопка «Добавить» на главном экране. Проще всего попросить Claude: там есть инструкция для него.': 'Your own cards: “Add” on the main screen. The easiest way is to ask Claude — there’s an instruction for it.',
  'Всё хранится только на этом устройстве. Время от времени делай резервную копию: Настройки → Данные.': 'Everything is stored only on this device. Make a backup from time to time: Settings → Data.',
  'В настройках — язык, темы, четыре кнопки ответа вместо двух и число на иконке, значок со столбиками — статистика.': 'Settings have the language, themes, four answer buttons instead of two and the icon badge; the bar-chart icon opens statistics.',
  'Начать': 'Start',
  'Доступно обновление': 'Update available',
  'Обновить': 'Update',

  // --- проверка карточек и файлов колод (decks.js) ---
  'по-русски (ru)': 'Russian (ru)',
  'қазақша (kz)': 'Kazakh (kz)',
  'заметка (note)': 'note (note)',
  'слово (word)': 'word (word)',
  'транскрипция (ipa)': 'transcription (ipa)',
  'пояснение (def)': 'definition (def)',
  'вопрос (q)': 'question (q)',
  'ответ (a)': 'answer (a)',
  'не заполнено поле «{field}»': 'the field “{field}” is empty',
  'поле «{field}» должно быть текстом': 'the field “{field}” must be text',
  'sentences должно быть списком предложений': 'sentences must be a list of sentences',
  'нужно хотя бы одно предложение, пояснение (def) или перевод (ru)': 'at least one sentence, a definition (def) or a translation (ru) is needed',
  'в предложении «{s}» нет слова «{word}» — возьми его в {фигурные скобки}': 'the sentence “{s}” doesn’t contain the word “{word}” — put it in {curly braces}',
  'Не получается прочитать: это не JSON.': 'Can’t read it: this isn’t JSON.',
  'Это резервная копия, а не колоды. Её открывают кнопкой «Восстановить из копии».': 'This is a backup, not decks. Open it with “Restore from backup”.',
  'Колод не нашлось. Нужен файл в формате decks.json: { "decks": [ … ] }.': 'No decks found. A file in decks.json format is needed: { "decks": [ … ] }.',
  'В файле нет ни одной колоды.': 'The file has no decks.',
  'Колода «{deck}»': 'Deck “{deck}”',
  'Колода №{n}': 'Deck #{n}',
  'это не колода.': 'this isn’t a deck.',
  'нет id.': 'no id.',
  'нет названия (name).': 'no name (name).',
  'неизвестный тип «{type}». Бывают: {types}.': 'unknown type “{type}”. Possible types: {types}.',
  'cards должно быть списком.': 'cards must be a list.',
  'карточка №{n} — не объект.': 'card #{n} isn’t an object.',
  'карточка №{n}': 'card #{n}',
  'карточка №{n} («{label}»)': 'card #{n} (“{label}”)',
  'Колода «{deck}» (id {id}) уже есть, и у неё тип {type}, а в тексте — {other}. Карточки другого типа в неё не добавить: поменяй тип или придумай новой колоде другой id.': 'The deck “{deck}” (id {id}) already exists with type {type}, but the text has {other}. Cards of another type can’t be added to it: change the type or give the new deck another id.',
  'decks.json: нет списка колод (decks).': 'decks.json: no list of decks (decks).',
  'progress-sm2.json: незнакомый формат.': 'progress-sm2.json: unknown format.',
  'Этот браузер не умеет хранить данные (нет IndexedDB).': 'This browser can’t store data (no IndexedDB).',
  'Запись прервана.': 'Saving was interrupted.',
  'Неизвестная оценка ответа: {r}': 'Unknown answer grade: {r}',

  // --- кавычки вокруг названия ---
  '«{deck}»': '“{deck}”',

  // --- колоды от Claude (claude.js) ---
  'Поле пустое: вставь сюда ответ Claude.': 'The field is empty: paste Claude’s reply here.',
  'В тексте не нашлось колод: нужен JSON, который начинается с { и заканчивается }.': 'No decks found in the text: JSON is needed that starts with { and ends with }.',
  'Блок №{n}': 'Block #{n}',
  'карточек: {n}': 'cards: {n}',
  'русский → казахский': 'Russian → Kazakh',
  'казахский → русский': 'Kazakh → Russian',
  'английский, слово в предложении': 'English, a word in a sentence',
  'вопрос и ответ': 'question and answer',
  'Сделай карточки для моего приложения SayatSays (интервальное повторение).': 'Make flashcards for my app SayatSays (spaced repetition).',
  'Ответь одним блоком кода ```json. Внутри — только JSON, без комментариев.': 'Reply with a single ```json code block. Only JSON inside, no comments.',
  'Формат: {"decks": [колода, …]}': 'Format: {"decks": [deck, …]}',
  'Колода: {"id": "…", "name": "…", "type": "…", "parent": "…", "cards": [карточка, …]}': 'Deck: {"id": "…", "name": "…", "type": "…", "parent": "…", "cards": [card, …]}',
  '- id колоды — латиница, цифры и дефис, например "kz-qala". Новой колоде дай id, которого нет в списке ниже.': '- Deck id: Latin letters, digits and hyphens, for example "kz-qala". Give a new deck an id that isn’t in the list below.',
  '- Чтобы добавить карточки в мою колоду, возьми её id, name и type из списка и положи в cards только новые карточки.': '- To add cards to one of my decks, take its id, name and type from the list and put only the new cards in cards.',
  '- parent — id колоды, внутрь которой положить новую колоду; null — на верхний уровень.': '- parent: the id of the deck to put the new deck into; null for the top level.',
  '- id карточкам не нужны: приложение сделает их само.': '- Cards don’t need ids: the app creates them.',
  'Типы колод (type) и поля карточек:': 'Deck types (type) and card fields:',
  '- "kz" — русский → казахский: {"ru": "город", "kz": "қала"}. Можно добавить "note" — короткую подсказку.': '- "kz" — Russian → Kazakh: {"ru": "город", "kz": "қала"}. You may add "note", a short hint.',
  '- "kzru" — казахский → русский, поля те же: {"kz": "қала", "ru": "город"}.': '- "kzru" — Kazakh → Russian, same fields: {"kz": "қала", "ru": "город"}.',
  '- "en" — английское слово, на карточке предложение с пропуском:': '- "en" — an English word; the card shows a sentence with a gap:',
  '  В каждом предложении слово (в нужной форме) — в {фигурных скобках}. Предложений 2–3, def — по-английски.': '  In every sentence put the word (in the right form) in {curly braces}. 2–3 sentences; "def" in English, "ru" is the translation.',
  '- "qa" — вопрос и ответ по любому предмету: {"q": "…", "a": "…"}.': '- "qa" — question and answer on any subject: {"q": "…", "a": "…"}.',
  'Казахские буквы пиши правильно: ә, ғ, қ, ң, ө, ұ, ү, һ, і.': 'Spell Kazakh letters correctly: ә, ғ, қ, ң, ө, ұ, ү, һ, і.',
  'Пример ответа:': 'Example reply:',
  'Мои колоды сейчас (id — название — тип):': 'My decks now (id — name — type):',
  'Колод у меня пока нет.': 'I don’t have any decks yet.',
  'Сейчас нужны новые карточки в колоду «{deck}» (id "{id}", type "{type}" — {help}).': 'Now I need new cards for the deck “{deck}” (id "{id}", type "{type}" — {help}).',
  'В ней уже есть, не повторяй: {list}.': 'It already has these, don’t repeat them: {list}.',
  'Что сделать — напишу ниже.': 'What to make — I’ll write below.'
};
