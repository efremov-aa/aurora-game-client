#!/usr/bin/env node
/**
 * A-874: медиа-слой для Electron — локальный SFU LiveKit.
 *
 * Зачем он: голос, видео и демонстрация экрана в Aurora идут через
 * LiveKit (он же SFU — сервер пересылает потоки, клиенты не соединяются
 * напрямую). LiveKit не пускает в комнату «просто так»: нужен JWT,
 * подписанный секретом сервера. Клиент этот секрет знать не должен и
 * не знает — он спрашивает токен у локального сервера, а тот подписывает.
 *
 * Формат подписи — стандартный LiveKit (HS256, ключ в профиле пользователя).
 * Это НЕ самодельная схема: если формат разойдётся с сервером, LiveKit
 * откажет на входе, и мы увидим это сразу, а не будем гадать.
 *
 * Секрет наружу не отдаётся: в /api/media/server уходит только url и
 * признак «работает/не работает».
 *
 * Пути ищутся от корня репозитория, поэтому работают и при запуске из
 * исходников, и в собранном виде, где media.js лежит в app.asar рядом
 * с win/.
 */
'use strict';

const fs = require('fs');
const net = require('net');
const os = require('os');
const path = require('path');
const crypto = require('crypto');
const { spawn } = require('child_process');

/* Корень: media.js лежит в <root>/electron/src/main/, значит корень — на
   четыре уровня выше. Для собранного app.asar путь к exe рядом. */
function repoRoot() {
  const here = __dirname;                                   // .../electron/src/main
  const guess = path.join(here, '..', '..', '..');
  if (fs.existsSync(path.join(guess, 'win', 'livekit', 'config.yaml'))) return guess;
  // собранный вид: win/ рядом с main.js (app.asar/win/...)
  const near = path.join(here, '..', '..');
  if (fs.existsSync(path.join(near, 'win', 'livekit', 'config.yaml'))) return near;
  return guess;
}

const LK_DIR = path.join(repoRoot(), 'win', 'livekit');
const CONFIG_FILE = path.join(LK_DIR, 'config.yaml');
const LK_BIN = path.join(LK_DIR, 'livekit-server.exe');
const LK_URL = 'ws://127.0.0.1:7880';
function mediaKeysFile() {
  return path.join(require('electron').app.getPath('userData'), 'media-keys.json');
}

/* Секрет локального SFU не хранится внутри portable-сборки: ключ генерируется
   отдельно для профиля Windows и имеет права только для текущего пользователя. */
function readKeys() {
  const file = mediaKeysFile();
  try {
    const value = JSON.parse(fs.readFileSync(file, 'utf8'));
    if (value && typeof value.api_key === 'string' && typeof value.api_secret === 'string' &&
        value.api_key.length >= 8 && value.api_secret.length >= 32) {
      if (process.platform !== 'win32') fs.chmodSync(file, 0o600);
      return { key: value.api_key, secret: value.api_secret, file };
    }
    return { key: '', secret: '', file };
  } catch (e) {
    if (!e || e.code !== 'ENOENT') return { key: '', secret: '', file };
  }
  const value = {
    api_key: 'aurora_' + crypto.randomBytes(12).toString('hex'),
    api_secret: crypto.randomBytes(48).toString('base64url'),
  };
  let fd;
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fd = fs.openSync(file, 'wx', 0o600);
    fs.writeFileSync(fd, JSON.stringify(value), 'utf8');
    fs.fsyncSync(fd);
    fs.closeSync(fd);
    fd = null;
    return { key: value.api_key, secret: value.api_secret, file };
  } catch (e) {
    if (fd !== undefined && fd !== null) { try { fs.closeSync(fd); } catch (closeError) { /* уже закрыт */ } }
    if (e && e.code === 'EEXIST') return readKeys();
    return { key: '', secret: '', file };
  }
}

function b64url(buf) {
  return Buffer.from(buf).toString('base64')
    .replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
}

/** Токен доступа в комнату. Короткоживущий — украденный быстро протухнет. */
function createToken(apiKey, secret, room, identity, ttlSec = 3600) {
  const now = Math.floor(Date.now() / 1000);
  const exp = now + ttlSec;
  const header = b64url(Buffer.from('{"alg":"HS256","typ":"JWT"}', 'utf8'));
  const payloadObj = {
    apiKey,
    iss: apiKey,
    sub: identity,
    /* nbf с запасом назад: при nbf = now секунды часов клиента и сервера
       иногда расходятся, и сервер отвечает 401 на верный токен. */
    nbf: now - 10,
    exp,
    video: {
      room,
      roomJoin: true,
      canPublish: true,
      canSubscribe: true,
      canPublishData: true,
    },
  };
  const payload = b64url(Buffer.from(JSON.stringify(payloadObj), 'utf8'));
  const signing = header + '.' + payload;
  const sig = b64url(crypto.createHmac('sha256', Buffer.from(secret, 'utf8'))
    .update(signing, 'utf8').digest());
  return signing + '.' + sig;
}

/** Порт слушает? Проверка обычным TCP-соединением. */
function portOpen(port = 7880, host = '127.0.0.1', timeout = 700) {
  return new Promise((resolve) => {
    const sock = new net.Socket();
    let done = false;
    const finish = (v) => {
      if (done) return;
      done = true;
      try { sock.destroy(); } catch (e) { /* уже закрыт */ }
      resolve(v);
    };
    sock.setTimeout(timeout);
    sock.once('connect', () => finish(true));
    sock.once('timeout', () => finish(false));
    sock.once('error', () => finish(false));
    sock.connect(port, host);
  });
}

let child = null;
let starting = null;

async function running() { return portOpen(); }

/**
 * Поднять SFU, если он ещё не слушает.
 * Ничего не выдумываем: если exe нет — честно говорим, что нечего запускать.
 */
async function ensureServer() {
  if (await portOpen()) return { ok: true, started: false, reason: 'уже работает' };
  if (!fs.existsSync(LK_BIN)) {
    return { ok: false, started: false, reason: 'нет ' + LK_BIN };
  }
  if (!fs.existsSync(CONFIG_FILE)) {
    return { ok: false, started: false, reason: 'нет ' + CONFIG_FILE };
  }
  if (starting) return starting;
  const keys = readKeys();
  if (!keys.key || !keys.secret) {
    return { ok: false, started: false, reason: 'не удалось создать приватные ключи в профиле пользователя' };
  }
  starting = (async () => {
    /* LiveKit принимает только ключ, переданный главным процессом; секрет
       не лежит в файлах, которые попадают в portable-архив. */
    child = spawn(LK_BIN, [
      '--keys', keys.key + ': ' + keys.secret,
      '--bind', '127.0.0.1',
      '--rtc.tcp_port', '0',
    ], {
      cwd: LK_DIR, windowsHide: true, stdio: 'ignore', detached: false,
    });
    child.on('error', (e) => { child = null; });
    child.on('exit', () => { child = null; });
    // Ждём, пока порт поднимется. Больше 15 секунд ждать бессмысленно.
    for (let i = 0; i < 30; i++) {
      await new Promise((r) => setTimeout(r, 500));
      if (await portOpen()) return { ok: true, started: true };
    }
    return { ok: false, started: false, reason: 'сервер не поднялся за 15 с' };
  })();
  const res = await starting;
  starting = null;
  return res;
}

function stopServer() {
  if (child) { try { child.kill(); } catch (e) { /* уже мёртв */ } child = null; }
}

/** Ответ для GET /api/media/server. Секрет отсюда наружу не уходит. */
async function serverState() {
  const up = await running();
  const keys = readKeys();
  return {
    ok: true,
    url: LK_URL,
    running: up,
    keys_present: !!(keys.key && keys.secret),
    reason: keys.key && keys.secret ? '' : 'нет приватных ключей LiveKit в профиле пользователя',
  };
}

/** Ответ для POST /api/media/token. */
function mediaToken(body) {
  const keys = readKeys();
  if (!keys.key || !keys.secret) {
    return { ok: false, error: 'не удалось прочитать приватные ключи LiveKit профиля пользователя' };
  }
  const room = String((body && body.room) || '').trim() || 'main';
  const identity = String((body && body.identity) || '').trim()
    || ('aurora-' + os.hostname());
  return {
    ok: true,
    url: LK_URL,
    token: createToken(keys.key, keys.secret, room, identity),
    room,
    identity,
  };
}

module.exports = {
  LK_URL, LK_DIR, LK_BIN, CONFIG_FILE,
  readKeys, createToken, portOpen, running,
  ensureServer, stopServer, serverState, mediaToken,
};
