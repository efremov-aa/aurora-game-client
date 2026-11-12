# 🐾 Aurora Game — свой Discord для игр, без обходов

**[English version below](#english-version)**

Мяу! Это Aurora Game — игровой мессенджер в стиле Discord, которого котик Аврора
вылизывает каждый день. Голос, видео, чат, серверы, друзья и вложения живут в одном
окне и работают без VPN и без «танцев с бубном» вокруг блокировок.

Текущая версия: **1.4.50** — котик починил микрофон: кнопка включает дорожку,
а не глушит её, и перечёркнутая иконка больше не залипает. Голос в общем канале
ожил — SFU и раздача токенов теперь говорят на одном ключе.

---

## Что умеет котик

### 💬 Общение
- **Текстовые каналы** на игровых серверах и в личных сообщениях (DM)
- **Реакции** на сообщения (👍 ❤️ 😂 🔥 🎉 🐱 👀 😢)
- **Редактирование и удаление** своих сообщений
- **Треды** — ответы на конкретное сообщение с сохранением истории
- **Вложения** — картинки, документы, текстовые файлы до 1 МБ

### 🎮 Серверы
- Свои серверы с именем, описанием и эмодзи
- Вход по приглашению — со сроком действия и лимитом использований
- Категории, текстовые и голосовые каналы
- Роли и права: владелец, модератор, участник
- Блокировка и разбан участников

### 👥 Друзья
- Поиск игроков по нику
- Заявки в друзья: отправить, принять, отклонить
- Список друзей с онлайн-статусом
- Блокировка нежелательных профилей

### 🔊 Голос и видео
- **Голосовой экран в стиле Discord**: шапка канала с таймером и пингом, сцена плиток
  с круглыми аватарами и зелёным кольцом говорящего, нижний док с кнопками
- Голосовые каналы через LiveKit SFU — котик слышит всех
- Камера и демонстрация экрана — плитка видео разворачивается на всю сцену
- Индикатор говорящего в реальном времени
- Пинга-пилюля с качеством связи: зелёная — хорошо, жёлтая — терпимо, красная — плохо
- Кнопки «Пригласить» и «Устройства» прямо в шапке канала
- Один компонент на три сценария: голосовой канал сервера, канал сообщества и страница «Голос и видео»

### 📺 Совместный просмотр
- Очередь прямых ссылок на видео (MP4, WebM)
- Синхронизация проигрывания через data-канал LiveKit

### 🎨 Оформление
- Тёмная и светлая темы
- Сезонные оформления: Хэллоуин, Новый год, весна, лето — авто или вручную
- Свой аватар, цвет и описание профиля
- Сезонные баннеры профиля

### 🔒 Безопасность
- Анонимная регистрация — только ник, без пароля и почты
- Токен профиля лежит в зашифрованном хранилище Windows
- Запросы к игровому API идут по HTTPS с Bearer-токеном
- Защита от iframe, проверка Host, Origin и Sec-Fetch-Site

### 🖥️ Интеграция с Windows
- Системный трей: крестик прячет окно, а не выключает котика
- Автозапуск вместе с Windows (свёрнутым в трей)
- Портативная сборка — можно носить на флешке

---

## Установка

### Вариант 1 — установщик (рекомендует котик)

1. Скачайте `AuroraGame-Setup-1.4.50.exe` из [Releases](https://github.com/efremov-aa/aurora-game-client/releases)
2. Запустите — установщик спросит права администратора
3. Выберите папку (по умолчанию `Program Files\Aurora Game`)
4. Поставьте галочку «Создать ярлык на рабочем столе», если хочется
5. Запустите `Aurora Game` из меню «Пуск»

Установщик собран на Inno Setup 7, интерфейс на русском и английском,
размер около 123 МБ.

### Вариант 2 — портативная сборка

1. Скачайте `AuroraGame-win32-x64.zip` из [Releases](https://github.com/efremov-aa/aurora-game-client/releases)
2. Распакуйте в любую папку
3. Запустите `AuroraGame.exe`

Архив около 178 МБ, внутри Electron и медиасервер LiveKit — котик тащит всё с собой.

---

## Как котик обновляется сам

Раньше обновление было наполовину ручным: скачай, распакуй, не забудь закрыть окно.
В 1.4.48 котик довёл дело до конца.

1. При старте приложение спрашивает GitHub Releases: «есть что-нибудь новее?»
2. Если есть — показывает версию и заметки к релизу во вкладке **Настройки → 📦 Обновления**
3. Нажимаете «Обновить» — клиент скачивает `AuroraGame-win32-x64.zip`
4. Сверяет SHA-256 скачанного архива с тем, что отдал GitHub — битый файл не примут
5. Распаковывает архив во временную папку рядом с профилем
6. Запускает служебный скрипт: тот ждёт закрытия игры, копирует файлы поверх и **перезапускает Aurora Game**
7. Убирает за собой архив и временные файлы

Если GitHub недоступен, котик не падает и не ломает игру — просто сообщает,
что проверить обновление не вышло, и работает дальше.

---

## Первый запуск

1. Запустите `AuroraGame.exe`
2. Придумайте ник (1–32 символа)
3. Сохраните экспортированный ключ профиля — без него аккаунт не восстановить
4. Зайдите в «Игровое сообщество» → канал «общий»
5. Добавьте друзей по нику, создайте свой сервер или зайдите в голосовой канал

---

## Голос и видео для внешних пользователей

Чтобы голос работал между разными сетями, на медиасервере должен быть поднят
LiveKit SFU с публичным WSS и UDP ICE. Подробности — в [`VOICE_SERVER.md`](VOICE_SERVER.md).

Клиентам ничего пробрасывать не нужно: достаточно исходящего интернета.
Клиент сам находит публичный медиасервер и подключается, настраивать вручную нечего.
Секрет LiveKit в клиентскую сборку не попадает — токен подписывает сервер.

---

## Технологии

- **Electron 45.2.1** — оболочка приложения
- **LiveKit 1.13.11** — голос, видео, демонстрация экрана
- **Node.js + SQLite** — серверная часть
- **Inno Setup 7** — установщик Windows
- **GitHub Releases** — автообновление

---

## Проверки

Клиентские проверки:

```bash
cd electron
npm test
```

Проходит 8 наборов тестов: курсоры сообщений, LiveKit lifecycle, безопасность окон,
inline-хендлеры, локальный API, community session, DM state, community proxy,
token store.

Целостность портативного архива проверяется отдельно:

```bash
python tools/verify_portable.py electron/dist/AuroraGame-win32-x64.zip
```

Котик сверяет CRC всех файлов, обязательный состав и совпадение с исходниками.

---

## Лицензия

Лицензия не указана — проект в активной разработке. Котик ещё думает.

---

# Aurora Game — your own Discord for games

## English

Meow! Aurora Game is a Discord-style gaming messenger: voice, video, chat, servers,
friends and attachments in one window — no VPN, no workarounds.

Current version: **1.4.50** — the cat fixed the microphone: the button publishes
the track instead of muting it, and the crossed-out icon no longer sticks. Voice
in the shared channel works again — the SFU and the token issuer share one key.

## Features

- **Chat** — text channels, DMs, reactions, edits, threads, attachments up to 1 MB
- **Servers** — categories, text and voice channels, roles, invites, bans
- **Friends** — search, requests, online status, blocking
- **Voice & Video** — Discord-style voice screen (header with timer and ping,
  participant tiles with speaking ring, bottom control dock), LiveKit SFU,
  camera, screen share, invite to call, input/output device picker
- **Watch Together** — up to 50 direct video links, playback synced via LiveKit data channel
- **Looks** — dark and light themes, seasonal themes, custom avatar, color and bio
- **Security** — nickname-only signup, profile token in encrypted Windows storage,
  HTTPS + Bearer, iframe protection and Host/Origin/Sec-Fetch-Site checks
- **Windows** — tray icon, autostart minimized, portable build

## Install

**Installer:** download `AuroraGame-Setup-1.4.50.exe` from
[Releases](https://github.com/efremov-aa/aurora-game-client/releases), run it,
pick a folder, launch from the Start menu.

**Portable:** download `AuroraGame-win32-x64.zip`, extract anywhere,
run `AuroraGame.exe`.

## Auto-update

On start the client asks GitHub Releases for a newer version. If there is one,
it downloads `AuroraGame-win32-x64.zip`, verifies the SHA-256 digest, extracts it,
and a small helper script waits for the app to close, copies the new files over
and relaunches Aurora Game. If GitHub is unreachable the game keeps working and
just reports that the check failed.

## Tech

- Electron 45.2.1
- LiveKit 1.13.11 (voice, video, screen share)
- Node.js + SQLite backend
- Inno Setup 7 installer
- GitHub Releases for updates

## Tests

```bash
cd electron
npm test
python tools/verify_portable.py electron/dist/AuroraGame-win32-x64.zip
```

## License

No license specified — the project is in active development.
