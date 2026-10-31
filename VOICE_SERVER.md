# Внешние голосовые каналы Aurora Game

Клиент запрашивает короткоживущий LiveKit JWT через `POST /game/media-token`. Нужен игровой Bearer-токен и ID голосового канала. Игровой API подписывает JWT после проверки профиля и типа канала; секрет LiveKit клиенту не отдаётся.

## Серверная настройка

На master игровой endpoint настраивается файлом `/home/ai/aurora/data/game_media.json` с владельцем `ai` и правами `0600`. В файле находятся WSS URL и приватная пара LiveKit API key/secret; секрет нельзя добавлять в исходники, клиентский архив или Git. Если файл отсутствует или некорректен, авторизованный запрос к `/game/media-token` возвращает `503 voice service is not configured`.

```json
{
  "server_url": "wss://5.141.235.56.sslip.io:7443",
  "api_key": "LIVEKIT_API_KEY",
  "api_secret": "LIVEKIT_API_SECRET"
}
```

Секреты нельзя добавлять в исходники, клиентский архив или Git. Шаблон — `game_media.json.example`.

## Требования к медиасерверу

- Внешний `server_url` использует `wss://` на домене с доверенным TLS-сертификатом; LiveKit API/WebSocket слушает TCP `7880` за TLS-терминатором.
- Для WebRTC нужен внешний UDP ICE и правильно объявленный публичный IP: UDP-mux на одном UDP-порту `7882`. Опциональный TCP fallback — `7881`.
- TURN/UDP можно включить на UDP `3478`. TURN/TLS лучше проходит через корпоративные сети, но обычно занимает TCP `443` и требует отдельного домена/сертификата. На master TCP 443 занят Telegram WS; его не перенастраивать.
- Нужен внешний NAT/firewall port-forward на master для выбранных UDP-портов. Доступность HTTP/TCP API сама по себе не доказывает работу WebRTC.
- Проверка готовности: WebSocket handshake и звонок между двумя внешними сетями с двусторонней передачей аудио и видео.

Официальные материалы: [порты и firewall LiveKit](https://docs.livekit.io/transport/self-hosting/ports-firewall/) и [production deployment/TLS](https://docs.livekit.io/transport/self-hosting/deployment/).

## Endpoint master

Endpoint сигналинга — `wss://5.141.235.56.sslip.io:7443`; TLS-терминатор на TCP 7443 проксирует WebSocket/API на LiveKit. Сертификат действует до `2027-01-16 15:11:02 UTC`, автоматическое продление не подтверждено. TCP 7443 с клиентского ПК проходит до Caddy/LiveKit (WSS-запрос с неверным токеном получил HTTP 401). Не перенастраивать TCP 443, 8445 и текущие службы.

Минимальный ICE/NAT маршрут для первой внешней проверки — UDP `7882` (LiveKit ICE UDP-mux), с port-forward внешнего UDP 7882 на master UDP 7882; включить `rtc.udp_port: 7882` и `rtc.use_external_ip: true`. Дополнительный прямой TCP fallback — TCP 7881, он требует собственного port-forward. Для тестеров за UDP-блокирующими NAT рекомендуется TURN: UDP 3478 и TLS 5349 с действующим сертификатом и динамической аутентификацией; TCP 443 для TURN/TLS не использовать, он занят Telegram WS. Без TURN звонок будет зависеть от возможности прямого ICE/UDP.

Первоначальный план использует TCP `7443` для WSS и UDP `7882` для ICE; обе внешние маршрутизации проверяются отдельно. TURN в текущую конфигурацию не включён.

## Текущее состояние master

LiveKit `v1.13.11` и Caddy `v2.11.7` установлены на макрое как user services:
- `aurora-livekit-sfu.service` — LiveKit SFU, слушает TCP 7880 (сигналинг), UDP 7882 (ICE mux), TCP 7881 (fallback)
- `aurora-livekit-wss.service` — Caddy TLS/WSS прокси на TCP 7443 → LiveKit 7880

Оба сервиса active/enabled. Порт TCP 443 занят Telegram WS, не перенастраивался.

**`game_media.json` ещё не создан на макрое.** Без этого файла игровой API возвращает `503 voice service is not configured` на `/game/media-token`, и голосовой канал сообщества не работает.

### Что нужно сделать на макрое

См. `SETUP_VOICE_MASTER.md` — пошаговая инструкция:

1. Скопировать `api_key` и `api_secret` из `/home/ai/.config/aurora-game-livekit/livekit.yaml`
2. Создать `/home/ai/aurora/data/game_media.json` с правами 0600
3. Перезапустить `systemctl --user restart aurora`
4. Проверить `/game/media-token` с игровым Bearer-токеном

### Проверка портов на шлюзе (10.1.0.1)

Нужны port-forward:
- **TCP 7443 → 10.1.0.238:7443** (WSS сигналинг)
- **UDP 7882 → 10.1.0.238:7882** (WebRTC ICE медиа)

### Проверка с внешней машины

```bash
# TCP 7443 (должен пройти TLS handshake)
openssl s_client -connect 5.141.235.56:7443 </dev/null

# Авторизованный media-token через игровой API
curl -s -X POST https://5.141.235.56.sslip.io:8445/game/media-token \
  -H "Authorization: Bearer ВАШ_ТОКЕН" \
  -H "Content-Type: application/json" \
  -d '{"channel":"general-voice"}'
```

### Ограничения

- Без TURN звонок работает только если оба клиента имеют прямой ICE/UDP путь
- TCP 443 занят Telegram WS — не использовать для TURN/TLS
- Сертификат TLS действует до 16.01.2027, автообновление не подтверждено
- Внешний ICE/UDP нужно проверить из независимой сети (не из той же LAN)

LiveKit API key и secret находятся только в `/home/ai/.config/aurora-game-livekit/livekit.yaml` (mode `0600`), не в игровом API, исходниках или архиве.

Подготовка LiveKit+Caddy воспроизводится скриптом `deploy_livekit_master.sh`. Portable sidecar `127.0.0.1:7880` в клиентской сборке — отдельный локальный сервер, не заменяет master.
