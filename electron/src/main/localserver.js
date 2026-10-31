#!/usr/bin/env node
/**
 * A-852: локальный сервер клиента для Electron-оболочки.
 *
 * Зачем он: панель Aurora проверяет Origin и принимает POST только от
 * своего адреса и порта (это в самой панели, _origin_ok). Интерфейс
 * живёт на своём порту, поэтому запросы к панели делает Node, а
 * браузер ходит только к нам. Иначе всё упало бы в 403 ещё до
 * авторизации.
 *
 * Системный прокси обходится (NO_PROXY-подобное поведение), потому что
 * иначе клиент ушёл бы в прокси и не долетел до Aurora.
 */
'use strict';

const http = require('http');
const https = require('https');
const fs = require('fs');
const path = require('path');
const os = require('os');
const media = require('./media');

/* Файл лежит в src/main/, поэтому renderer — соседняя папка: '..'.
   Раньше было '..' + 'src' + 'renderer', то есть искалось в src/src/renderer
   и окно показывало {"error":"not found"}. */
const RENDERER = path.join(__dirname, '..', 'renderer');
const CONFIG_FILE = path.join(
  process.env.APPDATA || os.homedir(), 'Aurora', 'client.json');
const MAX_BODY = 256 * 1024;
const COMMUNITY_ORIGIN = 'https://5.141.235.56.sslip.io:8445';
const PANEL_PORT = 8890;
const PANEL_DISCOVERY_TIMEOUT_MS = 700;
const PANEL_DISCOVERY_MAX_HOSTS = 1024;
function normalizeCommunityOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 512) throw new Error('адрес игрового сервера слишком длинный');
  let parsed;
  try { parsed = new URL(raw); } catch (_) { throw new Error('неверный адрес игрового сервера'); }
  if (parsed.protocol !== 'https:' || !parsed.hostname || parsed.username || parsed.password ||
      parsed.pathname !== '/' || parsed.search || parsed.hash) {
    throw new Error('игровой сервер должен быть HTTPS-адресом без пути и параметров');
  }
  return parsed.origin;
}

function normalizePanelOrigin(value) {
  const raw = String(value || '').trim();
  if (!raw) return '';
  if (raw.length > 512) throw new Error('адрес панели Aurora слишком длинный');
  let parsed;
  try { parsed = new URL(raw); } catch (_) { throw new Error('неверный адрес панели Aurora'); }
  if (!['http:', 'https:'].includes(parsed.protocol) || !parsed.hostname ||
      parsed.username || parsed.password || parsed.pathname !== '/' ||
      parsed.search || parsed.hash) {
    throw new Error('панель Aurora должна быть origin без пути и параметров');
  }
  /* 8899 — порт прокси Xray, а не HTTP API панели Aurora. */
  if (parsed.port === '8899') return '';
  const host = parsed.hostname.replace(/^\[|\]$/g, '');
  const localName = !host.includes('.') || host.endsWith('.local');
  if (parsed.protocol === 'http:' && !isLoopbackHost(host) &&
      !isPrivateIpv4(host) && !localName) {
    throw new Error('внешняя панель должна использовать HTTPS');
  }
  return parsed.origin;
}

function isLoopbackHost(host) {
  const value = String(host || '').toLowerCase().replace(/^\[|\]$/g, '');
  return value === 'localhost' || value === '::1' || value.startsWith('127.');
}

function ipv4ToNumber(value) {
  const parts = String(value || '').split('.');
  if (parts.length !== 4 || parts.some((part) => !/^\d{1,3}$/.test(part) || Number(part) > 255)) return null;
  return parts.reduce((acc, part) => ((acc * 256) + Number(part)) >>> 0, 0);
}

function numberToIpv4(value) {
  return [24, 16, 8, 0].map((shift) => (value >>> shift) & 255).join('.');
}

function isPrivateIpv4(value) {
  const n = ipv4ToNumber(value);
  if (n === null) return false;
  const first = n >>> 24;
  const second = (n >>> 16) & 255;
  return first === 10 || (first === 172 && second >= 16 && second <= 31) ||
    (first === 192 && second === 168) ||
    (first === 169 && second === 254) ||
    (first === 100 && second >= 64 && second <= 127);
}

function panelDiscoveryCandidates(savedPanel) {
  const rows = new Set();
  try {
    const saved = normalizePanelOrigin(savedPanel || '');
    if (saved) rows.add(saved);
  } catch (_) { /* неверный сохранённый адрес будет заменён авто-поиском */ }
  rows.add('http://127.0.0.1:' + PANEL_PORT);
  for (const group of Object.values(os.networkInterfaces() || {})) {
    for (const nic of group || []) {
      const family = nic && nic.family;
      if (!nic || (family !== 'IPv4' && family !== 4) || nic.internal ||
          !isPrivateIpv4(nic.address)) continue;
      const address = ipv4ToNumber(nic.address);
      const mask = ipv4ToNumber(nic.netmask);
      if (address === null || mask === null) continue;
      const prefix = mask.toString(2).replace(/0/g, '').length;
      if (prefix < 22 || prefix > 30) continue;
      const network = (address & mask) >>> 0;
      const broadcast = (network | (~mask >>> 0)) >>> 0;
      const hosts = broadcast - network - 1;
      if (hosts < 1 || hosts > PANEL_DISCOVERY_MAX_HOSTS) continue;
      for (let host = network + 1; host < broadcast; host++) {
        rows.add('http://' + numberToIpv4(host) + ':' + PANEL_PORT);
      }
    }
  }
  return Array.from(rows);
}

function probeAuroraPanel(endpoint) {
  return new Promise((resolve) => {
    let parsed;
    try { parsed = new URL('/', endpoint); }
    catch (_) { resolve(false); return; }
    const lib = parsed.protocol === 'https:' ? https : http;
    const req = lib.get(parsed, {
      headers: { Accept: 'text/html', 'X-Aurora-Request': '1' },
      timeout: PANEL_DISCOVERY_TIMEOUT_MS,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        const remaining = Math.max(0, 32 * 1024 - size);
        if (remaining) chunks.push(chunk.subarray(0, remaining));
        size += chunk.length;
        const html = Buffer.concat(chunks).toString('utf8');
        if (res.statusCode === 200 && /<title>[^<]*Aurora[^<]*<\/title>/i.test(html)) {
          resolve(true);
          req.destroy();
        } else if (size > 32 * 1024) {
          resolve(false);
          req.destroy();
        }
      });
      res.on('end', () => {
        const html = Buffer.concat(chunks).toString('utf8');
        resolve(res.statusCode === 200 && /text\/html/i.test(String(res.headers['content-type'] || '')) &&
          /<title>[^<]*Aurora[^<]*<\/title>/i.test(html));
      });
    });
    req.on('timeout', () => req.destroy());
    req.on('error', () => resolve(false));
  });
}

async function discoverPanel() {
  const savedPanel = loadConfig().panel;
  const candidates = panelDiscoveryCandidates(savedPanel);
  let cursor = 0;
  let found = '';
  const worker = async () => {
    while (!found && cursor < candidates.length) {
      const endpoint = candidates[cursor++];
      if (await probeAuroraPanel(endpoint)) found = endpoint;
    }
  };
  const count = Math.min(32, candidates.length);
  await Promise.all(Array.from({ length: count }, worker));
  return found
    ? { ok: true, panel: found, source: 'local-network', candidates: candidates.length }
    : { ok: false, panel: '', source: 'not-found', candidates: candidates.length };
}

function loadConfig() {
  const cfg = { panel: '', token: '', pin: '', communityOrigin: '' };
  let raw;
  try {
    raw = JSON.parse(fs.readFileSync(CONFIG_FILE, 'utf8'));
  } catch (e) { /* файла нет — работаем как есть */ }
  if (!raw || typeof raw !== 'object' || Array.isArray(raw)) return cfg;
  try { cfg.panel = normalizePanelOrigin(raw.panel || ''); } catch (_) { cfg.panel = ''; }
  cfg.token = String(raw.token || '');
  cfg.pin = String(raw.pin || '');
  try { cfg.communityOrigin = normalizeCommunityOrigin(raw.communityOrigin || ''); }
  catch (_) { cfg.communityOrigin = ''; }
  return cfg;
}

function saveConfig(patch) {
  const cfg = loadConfig();
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'panel')) {
    cfg.panel = normalizePanelOrigin(patch.panel);
  }
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'token')) cfg.token = String(patch.token || '');
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'pin')) cfg.pin = String(patch.pin || '');
  if (Object.prototype.hasOwnProperty.call(patch || {}, 'communityOrigin')) {
    cfg.communityOrigin = normalizeCommunityOrigin(patch.communityOrigin);
  }
  fs.mkdirSync(path.dirname(CONFIG_FILE), { recursive: true });
  const tmp = CONFIG_FILE + '.tmp';
  fs.writeFileSync(tmp, JSON.stringify(cfg, null, 2), 'utf8');
  fs.renameSync(tmp, CONFIG_FILE);
  return cfg;
}

function contentType(file) {
  const ext = path.extname(file).toLowerCase();
  return {
    '.html': 'text/html; charset=utf-8',
    '.js': 'application/javascript; charset=utf-8',
    '.css': 'text/css; charset=utf-8',
    '.json': 'application/json; charset=utf-8',
    '.svg': 'image/svg+xml',
    '.png': 'image/png',
    '.ico': 'image/x-icon',
  }[ext] || 'application/octet-stream';
}

function sendJson(res, code, obj) {
  const body = Buffer.from(JSON.stringify(obj), 'utf8');
  res.writeHead(code, {
    'Content-Type': 'application/json; charset=utf-8',
    'Content-Length': body.length,
    'Cache-Control': 'no-store',
    'X-Content-Type-Options': 'nosniff',
    'Cross-Origin-Resource-Policy': 'same-origin',
    'Referrer-Policy': 'no-referrer',
  });
  res.end(body);
}

function localRequestAllowed(req, res, server) {
  const address = server.address();
  const port = address && address.port;
  const origin = 'http://127.0.0.1:' + port;
  const host = String(req.headers.host || '').toLowerCase();
  const requestedOrigin = String(req.headers.origin || '');
  const fetchSite = String(req.headers['sec-fetch-site'] || '').toLowerCase();
  if (!port || host !== ('127.0.0.1:' + port) ||
      (requestedOrigin && requestedOrigin !== origin) ||
      (fetchSite && fetchSite !== 'same-origin' && fetchSite !== 'none')) {
    req.resume();
    sendJson(res, 403, { ok: false, error: 'forbidden origin' });
    return false;
  }
  return true;
}

/** Запрос к панели Aurora. Системный прокси НЕ используется. */
function toPanel(cfg, apiPath, method, bodyObj) {
  return new Promise((resolve) => {
    if (!cfg.panel) {
      return resolve({ ok: false, status: 0, data: { error: 'не задан адрес панели Aurora' } });
    }
    const base = new URL(cfg.panel);
    const useHttps = base.protocol === 'https:';
    const lib = useHttps ? https : http;
    const data = bodyObj ? Buffer.from(JSON.stringify(bodyObj), 'utf8') : null;
    const headers = {
      Accept: 'application/json',
      'X-Aurora-Request': '1',
    };
    const sendCredentials = useHttps || isLoopbackHost(base.hostname);
    if (sendCredentials && cfg.token) headers['X-Auth'] = cfg.token;
    if (sendCredentials && cfg.pin) headers['X-2FA'] = cfg.pin;
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = data.length;
    }
    const req = lib.request({
      protocol: base.protocol,
      hostname: base.hostname,
      port: base.port || (useHttps ? 443 : 80),
      path: apiPath,
      method: method || (data ? 'POST' : 'GET'),
      headers,
      // без системного прокси — см. комментарий в шапке
      agent: useHttps ? new https.Agent({ keepAlive: true }) : new http.Agent({ keepAlive: true }),
      timeout: 15000,
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (c) => {
        size += c.length;
        if (size <= MAX_BODY * 4) chunks.push(c);
      });
      res.on('end', () => {
        const text = Buffer.concat(chunks).toString('utf8');
        let parsed;
        try { parsed = JSON.parse(text); } catch (e) {
          parsed = { error: 'панель ответила не JSON' };
        }
        resolve({ ok: parsed && parsed.ok === true, status: res.statusCode, data: parsed });
      });
    });
    req.on('timeout', () => req.destroy(new Error('панель не ответила')));
    req.on('error', (e) => resolve({
      ok: false, status: 0, data: { error: 'панель недоступна: ' + e.message },
    }));
    if (data) req.write(data);
    req.end();
  });
}

/** Игровой контур имеет отдельный публичный API и никогда не получает X-Auth панели. */
function toCommunity(apiPath, method, bodyObj, token, origin) {
  return new Promise((resolve) => {
    if (!/^\/game\/(?:health|register|me|profile|channels(?:[/]members(?:[/](?:add|remove|role))?)?|reports(?:[/]resolve)?|dms|players|friends(?:[/](?:request|respond|delete))?|blocks(?:[/](?:add|remove))?|attachments|attachment|messages(?:[/](?:edit|delete))?|reactions|presence|threads|dm|media-token)$/.test(apiPath.split('?')[0])) {
      return resolve({ status: 404, data: { ok: false, error: 'unknown community route' } });
    }
    const data = bodyObj === null ? null : Buffer.from(JSON.stringify(bodyObj || {}), 'utf8');
    const headers = { Accept: 'application/json' };
    if (token) headers.Authorization = 'Bearer ' + String(token).slice(0, 128);
    if (data) {
      headers['Content-Type'] = 'application/json';
      headers['Content-Length'] = data.length;
    }
    const req = https.request((normalizeCommunityOrigin(origin) || COMMUNITY_ORIGIN) + apiPath, {
      method, headers, timeout: 15000,
      agent: new https.Agent({ keepAlive: true }),
    }, (res) => {
      const chunks = [];
      let size = 0;
      res.on('data', (chunk) => {
        size += chunk.length;
        if (size <= 2 * 1024 * 1024) chunks.push(chunk);
      });
      res.on('end', () => {
        let result;
        try { result = JSON.parse(Buffer.concat(chunks).toString('utf8')); }
        catch (e) { result = { ok: false, error: 'игровой сервер ответил не JSON' }; }
        resolve({ status: Number(res.statusCode) || 502, data: result });
      });
    });
    req.on('timeout', () => req.destroy(new Error('игровой сервер не ответил')));
    req.on('error', (err) => resolve({
      status: 502, data: { ok: false, error: 'игровой сервер недоступен: ' + String(err && err.message || err) },
    }));
    if (data) req.write(data);
    req.end();
  });
}

function start(port, onReady) {
  const server = http.createServer(async (req, res) => {
    if (!localRequestAllowed(req, res, server)) return;
    let url;
    try { url = new URL(req.url, 'http://127.0.0.1'); }
    catch (e) { return sendJson(res, 400, { error: 'bad url' }); }
    const pathname = url.pathname;

    /* ---- наши маршруты ---- */
    if (pathname === '/api/config' && req.method === 'GET') {
      const c = loadConfig();
      // токен и пин наружу не отдаём — только факт, что они есть
      return sendJson(res, 200, {
        panel: c.panel, communityOrigin: c.communityOrigin, has_token: !!c.token, has_pin: !!c.pin,
      });
    }
    if (pathname === '/api/config' && req.method === 'POST') {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size <= 64 * 1024) chunks.push(c);
      });
      req.on('end', () => {
        let patch = {};
        try { patch = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch (e) { patch = {}; }
        let communityOrigin;
        try { communityOrigin = normalizeCommunityOrigin(patch.communityOrigin || ''); }
        catch (err) { return sendJson(res, 400, { error: err.message }); }
        const c = saveConfig({
          panel: String(patch.panel || ''),
          communityOrigin,
          token: patch.token !== undefined ? String(patch.token) : loadConfig().token,
          pin: patch.pin !== undefined ? String(patch.pin) : loadConfig().pin,
        });
        return sendJson(res, 200, {
          ok: true, panel: c.panel, communityOrigin: c.communityOrigin, has_token: !!c.token, has_pin: !!c.pin,
        });
      });
      return undefined;
    }

    /* ---- медиа: LiveKit (SFU) ----
       Эти маршруты обязаны стоять ДО прокси к панели. Раньше они туда
       уходили и уходили в никуда: панель Aurora таких маршрутов не знает,
       поэтому голос/видео/экран в Electron не работали. Токен подписывает
       локальный сервер, секрет наружу не отдаётся. */
    if (pathname === '/api/media/server') {
      // Раньше сервер просто отвечал «работает/не работает», и клиент,
      // получив running:false, оставался без медиа. Теперь сами
      // поднимаем SFU, если он не слушает: клиент не должен думать
      // о процессах, это работа оболочки, а не человека.
      const st = await media.serverState();
      if (!st.running) {
        const started = await media.ensureServer();
        return sendJson(res, 200, Object.assign({}, st, {
          running: started.ok,
          auto_start: started.started,
          reason: started.reason || '',
        }));
      }
      return sendJson(res, 200, st);
    }
    if (pathname === '/api/media/token' && req.method === 'POST') {
      const chunks = [];
      let size = 0;
      req.on('data', (c) => {
        size += c.length;
        if (size <= 64 * 1024) chunks.push(c);
      });
      req.on('end', () => {
        let body = {};
        try { body = JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}'); }
        catch (e) { body = {}; }
        return sendJson(res, 200, media.mediaToken(body));
      });
      return undefined;
    }

    /* ---- публичный игровой контур ---- */
    if (pathname.startsWith('/api/community/')) {
      if (!['GET', 'POST'].includes(req.method)) {
        return sendJson(res, 405, { ok: false, error: 'method not allowed' });
      }
      let bodyObj = null;
      if (req.method === 'POST') {
        try {
          bodyObj = await new Promise((resolve, reject) => {
            const chunks = [];
            let size = 0;
            req.on('data', (chunk) => {
              size += chunk.length;
              const bodyLimit = pathname === '/api/community/game/attachments'
                ? 2 * 1024 * 1024 : 160 * 1024;
              if (size > bodyLimit) reject(new Error('body too large'));
              else chunks.push(chunk);
            });
            req.on('end', () => {
              try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8') || '{}')); }
              catch (e) { reject(new Error('invalid JSON')); }
            });
            req.on('error', reject);
          });
        } catch (err) {
          return sendJson(res, 400, { ok: false, error: err.message });
        }
      }
      const upstreamPath = pathname.slice('/api/community'.length) + url.search;
      const cfg = loadConfig();
      const origin = normalizeCommunityOrigin(cfg.communityOrigin) || COMMUNITY_ORIGIN;
      const requestedOrigin = String(req.headers['x-community-origin'] || '');
      if (requestedOrigin !== origin) return sendJson(res, 409, { ok: false, error: 'адрес игрового сервера изменился; переподключите профиль' });
      const result = await toCommunity(upstreamPath, req.method, bodyObj,
        String(req.headers['x-game-token'] || ''), origin);
      return sendJson(res, result.status, result.data);
    }

    /* ---- прокси к панели ---- */
    if (pathname.startsWith('/api/')) {
      let bodyObj = null;
      if (req.method === 'POST') {
        await new Promise((resolve) => {
          const chunks = [];
          let size = 0;
          req.on('data', (c) => {
            size += c.length;
            if (size <= MAX_BODY) chunks.push(c);
          });
          req.on('end', () => {
            const text = Buffer.concat(chunks).toString('utf8');
            try { bodyObj = text ? JSON.parse(text) : {}; } catch (e) { bodyObj = {}; }
            resolve();
          });
        });
      }
      const cfg = loadConfig();
      const suffix = url.search || '';
      const r = await toPanel(cfg, pathname + suffix, req.method, bodyObj);
      // клиенту всегда отвечаем 200, причина внутри JSON — так ошибка
      // видна в окне текстом, а не пустым экраном
      return sendJson(res, 200, r.data);
    }

    /* ---- статика ---- */
    const rel = pathname === '/' ? 'index.html' : pathname.replace(/^\/+/, '');
    const full = path.resolve(RENDERER, rel);
    if (!full.startsWith(path.resolve(RENDERER)) || !fs.existsSync(full)) {
      res.writeHead(404, { 'Content-Type': 'application/json; charset=utf-8' });
      return res.end('{"error":"not found"}');
    }
    const body = fs.readFileSync(full);
    const isHtml = path.extname(full).toLowerCase() === '.html';
    res.writeHead(200, {
      'Content-Type': contentType(full),
      'Content-Length': body.length,
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Cross-Origin-Resource-Policy': 'same-origin',
      'Referrer-Policy': 'no-referrer',
      ...(isHtml ? {
        'X-Frame-Options': 'DENY',
        'Content-Security-Policy': "frame-ancestors 'none'",
      } : {}),
    });
    return res.end(body);
  });

  server.listen(port || 0, '127.0.0.1', () => {
    const real = server.address().port;
    process.stdout.write('AURORA_LOCAL_PORT=' + real + '\n');
    // Порт сообщаем колбэком: раньше главный процесс пытался вытащить его
    // из аргумента события listening и падал («reading 'port' of undefined»).
    if (typeof onReady === 'function') onReady(real);
  });
  return server;
}

module.exports = { start, loadConfig, saveConfig, toPanel, toCommunity, discoverPanel, normalizeCommunityOrigin, normalizePanelOrigin, COMMUNITY_ORIGIN, RENDERER, CONFIG_FILE };

if (require.main === module) {
  const i = process.argv.indexOf('--port');
  start(i > 0 ? Number(process.argv[i + 1]) : 0);
}

