# SayatSays

[Русский](README.md) · **English** · [Қазақша](README.kk.md)

Spaced-repetition flashcards for your phone: Kazakh, English, school subjects — anything you want to remember.

### ▶ [Open the app](https://dwlqx.github.io/SayatSays/) — https://dwlqx.github.io/SayatSays/

Free, no sign-up, no ads. Works offline. All your data stays on your device.

**The app interface is in Russian.** The button names below are given in Russian with a translation.

## Features

- Decides by itself when to review each card (the FSRS algorithm): hard cards come back sooner, easy ones later.
- Starter decks: Kazakh (vocabulary, exam task wording and grammar terms) and English for NUET
  (Nazarbayev University Entrance Test: logic and math). Delete the ones you don't need.
- Your own decks — by hand or with Claude: the app gives you an instruction to paste into the chat.
- Four card types: Russian → Kazakh, Kazakh → Russian, an English word in a sentence with a gap, question and answer.
- Daily streak with freezes, statistics and a two-week forecast, the number of due cards on the app icon.
- 13 colour themes, light and dark.
- Backup of all your data into one file.

## Install

**iPhone and iPad**
1. Open the link in **Safari**.
2. Tap Share (the square with an arrow; on newer iOS it may be in the «•••» menu) → Add to Home Screen → Add.
3. Open SayatSays from the Home Screen: full screen and offline.

Safari and the Home Screen app keep separate data, so study in the app.

**Android** — open the link in Chrome → «⋮» menu → Install app (or Add to Home screen).

**Computer** — just open the link. Chrome and Edge can install it as an app: the install icon in the address bar.

## How to use

1. «Повторить всё» (Review all) — a session with everything due today. Or open a deck and tap «Учить» (Study).
2. Recall the answer, flip the card and answer honestly: «Не знал» (didn't know) or «Знал» (knew).
   You can also swipe: left — didn't know, right — knew.
3. A little every day. New cards are added automatically: up to 15 a day from each deck by default.

Settings («Настройки», the gear) have themes, the daily goal, four answer buttons instead of two
(«Трудно» hard and «Легко» easy) and the icon badge. The bar-chart icon on the main screen opens statistics.

## Your own cards with Claude

1. On the main screen: «Добавить» (Add) → «Скопировать инструкцию для Claude» (copy the instruction for Claude).
2. Paste it into a chat with Claude ([claude.ai](https://claude.ai)) and say what you need,
   for example: “30 cards on the topic of the city”.
3. In Claude's reply, tap Copy on the code block.
4. In the app: «Вставить ответ Claude» (paste Claude's reply), check what will be added and tap «Добавить» (Add).

If something is wrong, the app shows the error — copy it and send it back to Claude.
You can also add cards by hand: open a deck → «Добавить».

## Where is my data?

Only on your device, inside the browser. Nobody else sees it and it is never sent anywhere. So:
- deleting the app from the Home Screen or clearing the site data deletes your cards and progress;
- make a backup from time to time: «Настройки» → «Данные» → «Сделать резервную копию», and keep the file
  in Files or a cloud drive;
- on a new phone: «Настройки» → «Данные» → «Восстановить из копии» (restore from backup).

## FAQ

**Are there reminders?** The number of cards due today on the app icon — yes: «Настройки» → «Число на иконке».
Scheduled notifications are sent by GitHub Actions, so they only work in your own copy of the project
(see the [developer guide](docs/DEVELOPMENT.md#напоминания), in Russian).

**How much does it cost?** Nothing.

## For developers

Plain HTML, CSS and JavaScript (ES modules), no build step. Data lives in IndexedDB, a service worker makes it work
offline, scheduling uses [ts-fsrs](https://github.com/open-spaced-repetition/ts-fsrs).

```bash
python -m http.server 8000   # then open http://localhost:8000
npm install && npm test      # logic tests in Node (node --test)
```

The full guide — code structure, releases, your own copy with reminders — is in
[docs/DEVELOPMENT.md](docs/DEVELOPMENT.md) (in Russian).
