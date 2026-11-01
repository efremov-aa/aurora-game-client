# Внешние голосовые каналы Aurora Game

Клиент запрашивает короткоживущий LiveKit JWT через `POST /game/media-token`. Нужен игровой Bearer-токен и ID голосового канала. Игровой API подписывает JWT после проверки профиля и типа канала; секрет LiveKit клиенту не отдаётся.

## Серверная настройка

Игровой endpoint настраивается файлом `game_media.json` с правами `0600`. В файле находятся WSS URL и приватная пара LiveKit API key/secret. Секрет нельзя добавлять в исходники, клиентский архив или Git. Если файл отсутствует или некорректен, авторизованный запрос к `/game/media-token` возвращает `503 voice service is not configured`.

```json
{
  "server_url": "wss://ВАШ_DOMEN:7443",
  "api_key": "LIVEKIT_API_KEY",
  "api_secret": "LIVEKIT_API_SECRET"
}
```

## Требования к медиасерверу

- Внешний `server_url` использует `wss://` на домене с доверенным TLS-сертификатом
- LiveKit API/WebSocket слушает за TLS-терминатором
- Для WebRTC нужен внешний UDP ICE с правильно объявленным публичным IP
- Нужен внешний NAT/firewall port-forward на медиасервер для выбранных UDP-портов
- Доступность HTTP/TCP API сама по себе не доказывает работу WebRTC

Официальные материалы: [порты и firewall LiveKit](https://docs.livekit.io/transport/self-hosting/ports-firewall/) и [production deployment/TLS](https://docs.livekit.io/transport/self-hosting/deployment/).

## Endpoint сигналинга

WSS endpoint настраивается администратором медиасервера и указывается в `game_media.json`. TCP 443 не использовать для медиа — он занят другими сервисами.

## Ограничения

- Без TURN звонок работает только если оба клиента имеют прямой ICE/UDP путь
- Сертификат TLS должен быть доверенным и действующим
