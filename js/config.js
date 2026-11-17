// Настройки напоминаний (push). Здесь только ПУБЛИЧНЫЕ данные: репозиторий открытый, файл видят все.
//
// VAPID — пара ключей, по которой сервер push (у iPhone это Apple) узнаёт, что уведомление прислал именно ты.
//   Публичный ключ — здесь: с ним телефон подписывается на push, по нему же GitHub Actions подписывает отправку.
//   Приватный ключ — только в GitHub Secrets (VAPID_PRIVATE_KEY), в коде и коммитах его быть не должно.
// Создать пару заново: node tools/make-vapid.mjs (он сам запишет публичный ключ сюда, а приватный — в Secrets).
export const VAPID_PUBLIC_KEY = 'BLcjrDiwIzwxbSM3ZJzPZ2t7rR8AM5fdrObELQW7Qb3DcoaTJlMPhzQqW9pmrlBNebxPhYSyqQxDV8NyBeHJeDI';

// Кто отправляет push — адрес сайта. Apple требует его в каждой отправке.
export const VAPID_SUBJECT = 'https://dwlqx.github.io/SayatSays/';
