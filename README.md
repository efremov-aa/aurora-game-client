# Aurora Game — свой Discord для игр без обходов

**[English version below](#english-version)**

Aurora Game — это игровой мессенджер в стиле Discord. Голос, чат, серверы, друзья, вложения — всё работает без необходимости в VPN и обходах блокировок.

## Возможности

### 💬 Общение
- **Текстовые каналы** на игровых серверах и в личных сообщениях (DM)
- **Реакции** на сообщения (👍 ❤️ 😂 🔥 🎉 🐱 👀 😢)
- **Редактирование и удаление** своих сообщений
- **Треды** — ответы на конкретные сообщения с сохранением истории
- **Личные сообщения** между любыми зарегистрированными игроками
- **Вложения** — картинки, документы, текстовые файлы до 1 МБ

### 🎮 Серверы
- Создавайте свои игровые серверы с именем, описанием и эмодзи
- Присоединяйтесь к публичным серверам по приглашению
- Категории и каналы (текстовые и голосовые)
- Роли и права доступа (владелец, модератор, участник)
- Приглашения со сроком действия и лимитом использований
- Блокировка и разбан участников

### 👥 Друзья
- Поиск игроков по нику
- Заявки в друзья, принятие и отклонение
- Список друзей с онлайн-статусом
- Блокировка нежелательных пользователей

### 🔊 Голос и видео
- Голосовые каналы через LiveKit SFU
- Камера и демонстрация экрана
- Индикатор говорящего в реальном времени
- Переключение микрофона/камеры/экрана

### 📺 Совместный просмотр
- Очередь прямых ссылок на видео (MP4, WebM)
- Синхронизация проигрывания через LiveKit data-канал

### 🎨 Оформление
- Тёмная и светлая темы
- Сезонные оформления (Хэллоуин, Новый год, весна, лето) — авто или вручную
- Настраиваемый аватар, цвет и описание профиля
- Сезонные баннеры профиля

### 🔒 Безопасность
- Анонимная регистрация — только ник, без пароля и почты
- Токен профиля хранится в зашифрованном хранилище Windows
- Все запросы к игровому API через HTTPS с Bearer-токеном
- iframe-защита, проверка Host/Origin/Sec-Fetch-Site

### 🔄 Автообновление
- Проверка новых версий через GitHub Releases
- Проверка SHA-256 загруженного архива
- Скачивание обновления и перезапуск приложения

### 🖥️ Системная интеграция (Windows)
- Системный трей — крестик скрывает окно, не закрывает приложение
- Автозапуск вместе с Windows (свёрнутым в трей)
- Портативная сборка — не требует установки

## Установка

### Быстрый старт (без установки)
1. Скачайте последний `AuroraGame-win32-x64.zip` из [Releases](https://github.com/efremov-aa/aurora-game-client/releases)
2. Распакуйте в любую папку
3. Запустите `AuroraGame.exe`
4. Зарегистрируйте профиль на публичном игровом сервере

### Установщик (в разработке)
Используйте `installer/install.iss` для сборки через Inno Setup 7.

## Начало работы

1. Запустите `AuroraGame.exe`
2. В окне регистрации придумайте ник (1–32 символа)
3. Сохраните экспортированный ключ профиля — без него нельзя восстановить аккаунт
4. Зайдите в «Игровое сообщество» → канал «общий»
5. Добавьте друзей по нику, создайте свой сервер или зайдите в голосовой канал

## Голос и видео для внешних пользователей

Для голосовых звонков между разными сетями на медиасервере должен быть настроен LiveKit SFU с публичным WSS и UDP ICE. См. [`VOICE_SERVER.md`](VOICE_SERVER.md).

Клиентские ПК не требуют открытия портов — достаточно исходящего интернета. Клиент подключается к публичному медиасерверу автоматически, дополнительная настройка не требуется.

## Технологии

- **Electron 45.2.1** — оболочка приложения
- **LiveKit 1.13.11** — голос, видео, демонстрация экрана
- **Node.js** — локальный сервер интерфейса
- **Inno Setup 7** — установщик Windows

## Тестирование

Все клиентские проверки:
```bash
cd electron
npm test
```

Проходит 8 наборов тестов: курсоры сообщений, LiveKit lifecycle, безопасность окон, inline-хендлеры, локальный API, community session, DM state, community proxy, token store.

## Лицензия

Лицензия не указана — проект находится в активной разработке.

---

# Aurora Game — your own Discord for games without workarounds

## English

Aurora Game is a Discord-style gaming messenger. Voice, chat, servers, friends, attachments — everything works without needing VPN or blocks bypass.

## Features

### 💬 Communication
- Text channels on game servers and in direct messages (DM)
- Reactions on messages (👍 ❤️ 😂 🔥 🎉 🐱 👀 😢)
- Edit and delete your own messages
- Threads — replies to specific messages with history preservation
- Direct messages between any registered players
- Attachments — images, documents, text files up to 1 MB

### 🎮 Servers
- Create your own game servers with name, description, and emoji
- Join public servers via invite
- Categories and channels (text and voice)
- Roles and permissions (owner, moderator, member)
- Invites with expiration and use limits
- Ban and unban members

### 👥 Friends
- Player search by nickname
- Friend requests, accept and decline
- Friends list with online status
- Block unwanted users

### 🔊 Voice and Video
- Voice channels via LiveKit SFU
- Camera and screen sharing
- Speaking indicator in real time
- Microphone/camera/screen toggling

### 📺 Watch Together
- Queue of direct video links (MP4, WebM)
- Synchronized playback via LiveKit data channel

### 🎨 Styling
- Dark and light themes
- Seasonal themes (Halloween, New Year, Spring, Summer) — automatic or manual
- Customizable avatar, color, and profile bio
- Seasonal profile banners

### 🔒 Security
- Anonymous registration — nickname only, no password or email
- Profile token stored in encrypted Windows storage
- All game API requests over HTTPS with Bearer token
- iframe protection, Host/Origin/Sec-Fetch-Site validation

### 🔄 Auto-Update
- Check for new versions via GitHub Releases
- SHA-256 verification of downloaded archive
- Download update and restart application

### 🖥️ System Integration (Windows)
- System tray — close button hides window, doesn't quit app
- Auto-launch with Windows (minimized to tray)
- Portable build — no installation required

## Quick Start

1. Download latest `AuroraGame-win32-x64.zip` from [Releases](https://github.com/efremov-aa/aurora-game-client/releases)
2. Extract to any folder
3. Run `AuroraGame.exe`
4. Register a profile on the public game server

## Installer (in development)

Use `installer/install.iss` to build via Inno Setup 7.

## Getting Started

1. Run `AuroraGame.exe`
2. Create a nickname (1–32 characters)
3. Save exported profile key — without it account cannot be recovered
4. Join «Игровое сообщество» → channel «общий»
5. Add friends by nickname, create your server or join a voice channel

## Voice and Video for External Users

For voice calls between different networks, the media server must have LiveKit SFU configured with public WSS and UDP ICE. See [`VOICE_SERVER.md`](VOICE_SERVER.md).

Client PCs don't require port forwarding — just outgoing internet access. The client connects to the public media server automatically, no additional setup needed.

## Technologies

- **Electron 45.2.1** — application shell
- **LiveKit 1.13.11** — voice, video, screen sharing
- **Node.js** — local interface server
- **Inno Setup 7** — Windows installer

## Testing

Client checks:
```bash
cd electron
npm test
```

8 test suites pass: message cursors, LiveKit lifecycle, window security, inline handlers, local API, community session, DM state, community proxy, token store.

## License

No license specified — project is in active development.
