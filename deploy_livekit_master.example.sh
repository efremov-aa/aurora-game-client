#!/usr/bin/env bash
#
# EXAMPLE ONLY - sanitized copy of the private deployment script.
# Replace every YOUR_* / /path/to/* placeholder before use.
# Never commit real hostnames, internal IPs or secrets.
#
set -euo pipefail

# Разворачивает отдельные LiveKit и Caddy user services, не меняя Aurora API.
# Публичный media-token включается отдельным шагом только после проверки NAT.

readonly HOME_DIR=/home/USER
readonly CONFIG_DIR="$HOME_DIR/.config/aurora-game-livekit"
readonly UNIT_DIR="$HOME_DIR/.config/systemd/user"
readonly BIN_DIR="$HOME_DIR/.local/bin"
readonly DATA_DIR="$HOME_DIR/.local/share/aurora-game-livekit"
readonly LIVEKIT_VERSION=1.13.11
readonly CADDY_VERSION=2.11.7
readonly LIVEKIT_SHA256=1e9ee90ca301e1842b2887fc77cb122759756a9c8aeb4334ee91de3325ec43fb
readonly CADDY_SHA512=a7a433a1b133efc3c8d10eb0b99d52a24b5ef5c322dc77f5282182b1c0402139ab83f3a99f0c52409df77d20123fb0b523edad8a66d8f5e49136197bf61ef0e7
readonly CERT=/path/to/tls/sub.crt
readonly KEY=/path/to/tls/sub.key
readonly HOST=YOUR_MEDIA_HOST.example.com
readonly NODE_IP=YOUR_NODE_IP

fail() { printf 'ОШИБКА: %s\n' "$1" >&2; exit 1; }

[[ "$(id -un)" == USER ]] || fail 'скрипт должен выполняться от пользователя ai'
[[ -r "$CERT" && -r "$KEY" ]] || fail 'сертификат или ключ TLS недоступен'
[[ ! -e "$CONFIG_DIR" ]] || fail "каталог уже существует: $CONFIG_DIR"
[[ ! -e "$DATA_DIR" ]] || fail "каталог уже существует: $DATA_DIR"
[[ ! -e "$UNIT_DIR/aurora-livekit-sfu.service" ]] || fail 'aurora-livekit-sfu.service уже существует'
[[ ! -e "$UNIT_DIR/aurora-livekit-wss.service" ]] || fail 'aurora-livekit-wss.service уже существует'
[[ ! -e "$BIN_DIR/caddy" ]] || fail "файл уже существует: $BIN_DIR/caddy"
[[ ! -e "$HOME_DIR/aurora/data/game_media.json" ]] || fail 'game_media.json уже существует; автоматическая замена запрещена'

openssl x509 -in "$CERT" -checkhost "$HOST" -noout >/dev/null || fail 'TLS-сертификат не подходит для LiveKit hostname'
openssl x509 -in "$CERT" -checkend 2592000 -noout >/dev/null || fail 'TLS-сертификат истекает менее чем через 30 дней'
cert_pub=$(openssl x509 -in "$CERT" -pubkey -noout | openssl pkey -pubin -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)
key_pub=$(openssl pkey -in "$KEY" -pubout -outform DER 2>/dev/null | sha256sum | cut -d' ' -f1)
[[ -n "$cert_pub" && "$cert_pub" == "$key_pub" ]] || fail 'TLS certificate/key pair не совпадает'

for port in 7443 7880 7882; do
    if ss -H -ltn "sport = :$port" | grep -q . || ss -H -lun "sport = :$port" | grep -q .; then
        fail "порт $port уже занят"
    fi
done

tmp=$(mktemp -d)
trap 'rm -rf "$tmp"' EXIT
livekit_archive="$tmp/livekit.tar.gz"
caddy_archive="$tmp/caddy.tar.gz"

curl -fsSL --retry 3 "https://github.com/livekit/livekit/releases/download/v$LIVEKIT_VERSION/livekit_${LIVEKIT_VERSION}_linux_amd64.tar.gz" -o "$livekit_archive"
printf '%s  %s\n' "$LIVEKIT_SHA256" "$livekit_archive" | sha256sum -c - >/dev/null || fail 'SHA-256 LiveKit release не совпал'
curl -fsSL --retry 3 "https://github.com/caddyserver/caddy/releases/download/v$CADDY_VERSION/caddy_${CADDY_VERSION}_linux_amd64.tar.gz" -o "$caddy_archive"
printf '%s  %s\n' "$CADDY_SHA512" "$caddy_archive" | sha512sum -c - >/dev/null || fail 'SHA-512 Caddy release не совпал'

mkdir -p "$CONFIG_DIR" "$UNIT_DIR" "$BIN_DIR" "$DATA_DIR" "$tmp/livekit" "$tmp/caddy"
tar -xzf "$livekit_archive" -C "$tmp/livekit" livekit-server
tar -xzf "$caddy_archive" -C "$tmp/caddy" caddy
install -m 0755 "$tmp/livekit/livekit-server" "$DATA_DIR/livekit-server"
install -m 0755 "$tmp/caddy/caddy" "$BIN_DIR/caddy"

api_key="aurora_$(openssl rand -hex 16)"
api_secret="$(openssl rand -hex 32)"
cat > "$CONFIG_DIR/livekit.yaml" <<EOF
port: 7880
bind_addresses:
  - $NODE_IP
keys:
  $api_key: $api_secret
rtc:
  udp_port: 7882
  use_external_ip: true
logging:
  level: info
  pion_level: error
room:
  max_participants: 50
EOF
chmod 0600 "$CONFIG_DIR/livekit.yaml"

cat > "$CONFIG_DIR/Caddyfile" <<EOF
{
    admin off
    auto_https off
}

https://$HOST:7443 {
    bind $NODE_IP
    tls $CERT $KEY
    reverse_proxy $NODE_IP:7880
}
EOF
chmod 0600 "$CONFIG_DIR/Caddyfile"

cat > "$UNIT_DIR/aurora-livekit-sfu.service" <<EOF
[Unit]
Description=Aurora Game LiveKit SFU
After=network-online.target
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$DATA_DIR
ExecStart=$DATA_DIR/livekit-server --config $CONFIG_DIR/livekit.yaml
Restart=on-failure
RestartSec=3
LimitNOFILE=65535
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF

cat > "$UNIT_DIR/aurora-livekit-wss.service" <<EOF
[Unit]
Description=Aurora Game LiveKit TLS/WebSocket reverse proxy
After=network-online.target aurora-livekit-sfu.service
Wants=network-online.target

[Service]
Type=simple
WorkingDirectory=$CONFIG_DIR
ExecStart=$BIN_DIR/caddy run --config $CONFIG_DIR/Caddyfile --adapter caddyfile
Restart=on-failure
RestartSec=3
NoNewPrivileges=true
PrivateTmp=true

[Install]
WantedBy=default.target
EOF
chmod 0600 "$UNIT_DIR/aurora-livekit-sfu.service" "$UNIT_DIR/aurora-livekit-wss.service"

"$BIN_DIR/caddy" validate --config "$CONFIG_DIR/Caddyfile" --adapter caddyfile >/dev/null
systemd-analyze verify "$UNIT_DIR/aurora-livekit-sfu.service" "$UNIT_DIR/aurora-livekit-wss.service"
systemctl --user daemon-reload
systemctl --user enable --now aurora-livekit-sfu.service
for _ in $(seq 1 30); do
    if ss -H -ltn "sport = :7880" | grep -q . && ss -H -lun "sport = :7882" | grep -q .; then break; fi
    sleep 1
done
ss -H -ltn "sport = :7880" | grep -q . || fail 'LiveKit TCP signaling :7880 не поднялся'
ss -H -lun "sport = :7882" | grep -q . || fail 'LiveKit UDP ICE :7882 не поднялся'
systemctl --user enable --now aurora-livekit-wss.service
for _ in $(seq 1 15); do
    if ss -H -ltn "sport = :7443" | grep -q .; then break; fi
    sleep 1
done
ss -H -ltn "sport = :7443" | grep -q . || fail 'Caddy WSS TCP :7443 не поднялся'

printf 'Установлено: LiveKit %s, Caddy %s.\n' "$LIVEKIT_VERSION" "$CADDY_VERSION"
printf 'Порты listener: TCP 7880, TCP 7443, UDP 7882.\n'
printf 'game_media.json намеренно не создан: внешний WSS/UDP NAT ещё нужно проверить.\n'
printf 'Срок TLS-сертификата: %s\n' "$(openssl x509 -in "$CERT" -noout -enddate | cut -d= -f2)"
