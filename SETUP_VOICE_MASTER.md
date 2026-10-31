# Настройка внешнего голоса/видео на макрое (10.1.0.238)

LiveKit и Caddy уже установлены на макрое через `deploy_livekit_master.sh`. 
Осталось только создать `game_media.json` с ключами LiveKit и перезапустить aurora.

## Шаг 1: Получить ключи LiveKit с макрое

На макрое (под пользователем `ai`):

```bash
cat /home/ai/.config/aurora-game-livekit/livekit.yaml
```

Вы получите что-то вроде:

```yaml
port: 7880
bind_addresses:
  - 10.1.0.238
keys:
  aurora_abc123def456: somerandomsecretkey789...
rtc:
  udp_port: 7882
  use_external_ip: true
```

Скопируйте `api_key` (после `keys:`) и `api_secret`.

## Шаг 2: Создать game_media.json на макрое

На макрое:

```bash
cat > /home/ai/aurora/data/game_media.json <<'EOF'
{
  "server_url": "wss://5.141.235.56.sslip.io:7443",
  "api_key": "aurora_ВАШ_КЛЮЧ_ИЗ_livekit.yaml",
  "api_secret": "ВАШ_СЕКРЕТ_ИЗ_livekit.yaml"
}
EOF

chmod 0600 /home/ai/aurora/data/game_media.json
chown ai:ai /home/ai/aurora/data/game_media.json
```

**Важно:** `api_secret` не копируйте в клиент, в архив или в Git. Он остаётся только на макрое.

## Шаг 3: Перезапустить aurora

На макрое:

```bash
systemctl --user restart aurora
systemctl --user status aurora
```

## Шаг 4: Проверить media endpoint

```bash
curl -s https://5.141.235.56.sslip.io:8445/game/health
# Должен вернуть 200

# С игровым Bearer-токеном:
curl -s -X POST https://5.141.235.56.sslip.io:8445/game/media-token \
  -H "Authorization: Bearer ВАШ_ИГРОВОЙ_ТОКЕН" \
  -H "Content-Type: application/json" \
  -d '{"channel":"general-voice"}'
# Должен вернуть 200 с media-токеном (не 503)
```

## Шаг 5: Проверить порты на шлюзе (10.1.0.1)

На шлюзе должны быть проброшены:
- **TCP 7443 → 10.1.0.238:7443** (WSS сигналинг через Caddy)
- **UDP 7882 → 10.1.0.238:7882** (WebRTC ICE медиа)

Проверка с внешней машины:
```bash
# TCP 7443 (должен ответить TLS handshake)
openssl s_client -connect 5.141.235.56:7443 </dev/null

# UDP 7882 (проверяется только через реальный ICE вызов из клиента)
```

## Шаг 6: Дать клиент приятелю

Распакуйте `AuroraGame-win32-x64-test-vXX.zip` и отправьте приятелю. Он запускает `AuroraGame.exe`, регистрирует профиль на публичном игровом API, заходит в голосовой канал сообщества и проверяет голос/видео.

## Ограничения

- Без TURN (UDP 3478/TCP 5349) звонок работает только если оба клиента имеют прямой ICE/UDP путь
- TCP 443 занят Telegram WS — не использовать для TURN/TLS
- Сертификат TLS действует до 16.01.2027, автообновление не подтверждено
- Внешний ICE/UDP нужно проверить из независимой сети (не из той же LAN)
