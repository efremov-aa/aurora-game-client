/**
 * A-852: главный процесс оболочки Aurora Game.
 *
 * Отличия от Russcord и почему: Russcord показывает интерфейс, скачанный
 * с их сервера (APP_ORIGIN). У нас интерфейс свой и лежит рядом, а панель
 * Aurora отдельная. Поэтому поднимаем локальный сервер (localserver.js) —
 * он отдаёт наш интерфейс и ходит в панель вместо браузера (панель
 * проверяет Origin и иначе отвечает 403).
 */
'use strict';

const path = require('path');
const fs = require('fs');
const { app, BrowserWindow, Menu, Tray, nativeImage, ipcMain, session, desktopCapturer, shell, dialog, safeStorage } = require('electron');
const net = require('net');
const { domainToASCII } = require('url');
const localserver = require('./localserver');
const media = require('./media');
const communityTokenStore = require('./community-token-store').createCommunityTokenStore(app, safeStorage);
const { isAllowedAppUrl, allowedExternalUrl } = require('./window-security');
const { createGitHubUpdater } = require('./github-updater');

let mainWindow = null;
let gitHubUpdater = null;
let localServer = null;
let tray = null;
let isQuitting = false;
let localPort = 0;
const hasSingleInstanceLock = app.requestSingleInstanceLock();
function localPortFile() {
  return path.join(app.getPath('userData'), 'local-server-port.json');
}

function savedLocalPort() {
  try {
    const value = Number(JSON.parse(fs.readFileSync(localPortFile(), 'utf8')).port);
    return Number.isInteger(value) && value >= 1024 && value <= 65535 ? value : 0;
  } catch (e) { return 0; }
}

function rememberLocalPort(port) {
  try {
    const file = localPortFile();
    fs.mkdirSync(path.dirname(file), { recursive: true });
    const temporary = file + '.tmp';
    fs.writeFileSync(temporary, JSON.stringify({ port: Number(port) }), { encoding: 'utf8', mode: 0o600 });
    fs.renameSync(temporary, file);
  } catch (e) {
    console.error('Не удалось сохранить локальный порт клиента:', e && e.message || e);
  }
}

function startLocalServer(port) {
  const server = localserver.start(port, (realPort) => {
    localPort = realPort;
    rememberLocalPort(realPort);
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.loadURL('http://127.0.0.1:' + realPort + '/');
    }
  });
  server.on('error', (err) => {
    if (port && err && err.code === 'EADDRINUSE') {
      console.warn('Сохранённый порт клиента занят; выбираю другой порт.');
      try { server.close(); } catch (e) { /* listener не успел открыться */ }
      localServer = startLocalServer(0);
      return;
    }
    dialog.showErrorBox('Aurora Game', 'Не удалось открыть локальный интерфейс: ' + String(err && err.message || err));
    app.quit();
  });
  localServer = server;
  return server;
}

if (!hasSingleInstanceLock) app.quit();
else app.on('second-instance', showMainWindow);

function normalizeDirectEndpoint(rawHost, rawPort) {
  const host = String(rawHost || '').trim().replace(/^\[|\]$/g, '');
  const port = Number(rawPort);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    throw new Error('Порт должен быть числом от 1 до 65535');
  }
  if (!host || host.length > 253 || /[\s/@?#%]/.test(host)) {
    throw new Error('Некорректный IP-адрес или домен');
  }
  const family = net.isIP(host);
  if (family === 6) return { host, port, target: '[' + host + ']' };
  if (family === 4) return { host, port, target: host };
  const ascii = domainToASCII(host.toLowerCase());
  const labels = ascii.split('.');
  if (!ascii || ascii.length > 253 || labels.some((label) =>
    !label || label.length > 63 || !/^[a-z0-9](?:[a-z0-9-]*[a-z0-9])?$/.test(label))) {
    throw new Error('Некорректный IP-адрес или домен');
  }
  if (labels.every((label) => /^\d+$/.test(label)) &&
      (labels.length !== 4 || labels.some((part) =>
        Number(part) > 255 || String(Number(part)) !== part))) {
    throw new Error('Некорректный IPv4-адрес');
  }
  return { host: ascii, port, target: ascii };
}

function probeTcp(host, port, timeoutMs) {
  return new Promise((resolve) => {
    const started = Date.now();
    const socket = net.createConnection({ host, port });
    let settled = false;
    let hardTimeout;
    const finish = (result) => {
      if (settled) return;
      settled = true;
      clearTimeout(hardTimeout);
      socket.destroy();
      resolve(result);
    };
    hardTimeout = setTimeout(() => finish({
      reachable: false, error: 'истекло время ожидания',
    }), timeoutMs);
    socket.once('connect', () => finish({ reachable: true, latency_ms: Date.now() - started }));
    socket.once('timeout', () => finish({ reachable: false, error: 'истекло время ожидания' }));
    socket.once('error', (err) => finish({
      reachable: false, error: String(err && err.code || 'ошибка соединения'),
    }));
    socket.setTimeout(timeoutMs);
  });
}

function registerIpc() {
  ipcMain.handle('aurora:local-port', () => localPort);
  ipcMain.handle('aurora:get-launch-at-login', () => {
    if (process.platform !== 'win32') return { supported: false, enabled: false };
    const settings = app.getLoginItemSettings({
      path: process.execPath,
      args: ['--start-in-tray'],
    });
    return { supported: true, enabled: !!settings.openAtLogin };
  });
  ipcMain.handle('aurora:set-launch-at-login', (_e, enabled) => {
    if (process.platform !== 'win32') return { ok: false, supported: false, error: 'Автозапуск доступен только в Windows' };
    try {
      app.setLoginItemSettings({
        openAtLogin: enabled === true,
        path: process.execPath,
        args: ['--start-in-tray'],
      });
      const actual = app.getLoginItemSettings({ path: process.execPath, args: ['--start-in-tray'] });
      return { ok: !!actual.openAtLogin, supported: true, enabled: !!actual.openAtLogin };
    } catch (err) {
      return { ok: false, supported: true, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('aurora:save-config', (_e, patch) => {
    try {
      const c = localserver.saveConfig(patch || {});
      return { panel: c.panel, communityOrigin: c.communityOrigin, has_token: !!c.token, has_pin: !!c.pin };
    }
    catch (err) { return { error: err.message }; }
  });
  ipcMain.handle('aurora:get-config', () => {
    const c = localserver.loadConfig();
    return { panel: c.panel, communityOrigin: c.communityOrigin, has_token: !!c.token, has_pin: !!c.pin };
  });
  ipcMain.handle('aurora:discover-panel', async () => {
    try {
      const result = await localserver.discoverPanel();
      localserver.saveConfig({ panel: result.panel || '' });
      return result;
    } catch (err) {
      return { ok: false, panel: '', source: 'error', error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('aurora:get-community-token', (_e, origin) => communityTokenStore.read(origin));
  ipcMain.handle('aurora:set-community-token', (_e, value, origin) => communityTokenStore.write(value, origin));
  ipcMain.handle('aurora:clear-community-token', (_e, origin) => communityTokenStore.clear(origin));
  ipcMain.handle('aurora:join-steam-server', async (_e, input) => {
    try {
      const endpoint = normalizeDirectEndpoint(input && input.host, input && input.port);
      await shell.openExternal('steam://connect/' + endpoint.target + ':' + endpoint.port);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('aurora:check-direct-server', async (_e, input) => {
    try {
      const endpoint = normalizeDirectEndpoint(input && input.host, input && input.port);
      const result = await probeTcp(endpoint.host, endpoint.port, 4000);
      return Object.assign({ ok: true }, result);
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('aurora:export-direct-servers', async (_e, rows) => {
    try {
      if (!Array.isArray(rows) || rows.length > 50) {
        return { ok: false, error: 'Список должен содержать не более 50 серверов' };
      }
      const servers = rows.map((row) => {
        const endpoint = normalizeDirectEndpoint(row && row.host, row && row.port);
        const name = String(row && row.name || endpoint.host).trim().slice(0, 80) || endpoint.host;
        return { name, host: endpoint.host, port: endpoint.port };
      });
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Экспорт прямых игровых серверов',
        defaultPath: 'aurora-direct-servers.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
      const payload = JSON.stringify({ format: 'aurora-direct-servers', version: 1, servers }, null, 2);
      if (Buffer.byteLength(payload, 'utf8') > 131072) {
        return { ok: false, error: 'Файл экспорта превышает 128 КБ' };
      }
      await fs.promises.writeFile(result.filePath, payload, { encoding: 'utf8', mode: 0o600 });
      return { ok: true, count: servers.length };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('aurora:export-local-notes', async (_e, rows) => {
    try {
      if (!Array.isArray(rows) || rows.length > 200) {
        return { ok: false, error: 'В резервной копии может быть не более 200 заметок' };
      }
      const notes = rows.map((row) => {
        const text = String(row && row.text || '');
        const time = String(row && row.time || '');
        if (!text.trim() || Buffer.byteLength(text, 'utf8') > 2000 || time.length > 80) {
          throw new Error('Заметка имеет недопустимую длину или формат');
        }
        return { text, time };
      });
      const payload = JSON.stringify({ format: 'aurora-local-notes', version: 1, notes }, null, 2);
      if (Buffer.byteLength(payload, 'utf8') > 262144) {
        return { ok: false, error: 'Файл резервной копии превышает 256 КБ' };
      }
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Экспорт локальных заметок',
        defaultPath: 'aurora-local-notes.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
      await fs.promises.writeFile(result.filePath, payload, { encoding: 'utf8', mode: 0o600 });
      return { ok: true, count: notes.length };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('aurora:import-local-notes', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Импорт локальных заметок',
        properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePaths || !result.filePaths[0]) {
        return { ok: false, cancelled: true };
      }
      const filePath = result.filePaths[0];
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size > 262144) {
        return { ok: false, error: 'Файл должен быть обычным файлом размером не более 256 КБ' };
      }
      const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      if (!data || data.format !== 'aurora-local-notes' || data.version !== 1 ||
          !Array.isArray(data.notes) || data.notes.length > 200) {
        return { ok: false, error: 'Формат резервной копии не поддерживается' };
      }
      const notes = data.notes.map((row) => {
        const text = String(row && row.text || '');
        const time = String(row && row.time || '');
        if (!text.trim() || Buffer.byteLength(text, 'utf8') > 2000 || time.length > 80) {
          throw new Error('В файле есть заметка с недопустимой длиной или форматом');
        }
        return { text, time };
      });
      return { ok: true, notes };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  ipcMain.handle('aurora:export-community-identity', async (_e, input) => {
    try {
      const token = String(input && input.token || '');
      const name = String(input && input.name || '').trim();
      if (!/^[A-Za-z0-9_-]{40,128}$/.test(token) || !name || Array.from(name).length > 32 || /[\u0000-\u001f\u007f]/.test(name)) {
        return { ok: false, error: 'Профиль или ключ имеет неверный формат' };
      }
      const payload = JSON.stringify({ format: 'aurora-game-account', version: 1, token, name }, null, 2);
      const result = await dialog.showSaveDialog(mainWindow, {
        title: 'Экспорт ключа игрового профиля', defaultPath: 'aurora-game-account.json',
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePath) return { ok: false, cancelled: true };
      await fs.promises.writeFile(result.filePath, payload, { encoding: 'utf8', mode: 0o600 });
      return { ok: true };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  ipcMain.handle('aurora:import-community-identity', async () => {
    try {
      const result = await dialog.showOpenDialog(mainWindow, {
        title: 'Импорт ключа игрового профиля', properties: ['openFile'],
        filters: [{ name: 'JSON', extensions: ['json'] }],
      });
      if (result.canceled || !result.filePaths || !result.filePaths[0]) return { ok: false, cancelled: true };
      const filePath = result.filePaths[0];
      const stat = await fs.promises.stat(filePath);
      if (!stat.isFile() || stat.size > 16384) return { ok: false, error: 'Файл должен быть обычным и не больше 16 КБ' };
      const data = JSON.parse(await fs.promises.readFile(filePath, 'utf8'));
      const token = String(data && data.token || '');
      const name = String(data && data.name || '').trim();
      if (!data || data.format !== 'aurora-game-account' || data.version !== 1 ||
          !/^[A-Za-z0-9_-]{40,128}$/.test(token) || !name || Array.from(name).length > 32 || /[\u0000-\u001f\u007f]/.test(name)) {
        return { ok: false, error: 'Формат ключа игрового профиля не поддерживается' };
      }
      return { ok: true, token, name };
    } catch (err) { return { ok: false, error: String(err && err.message || err) }; }
  });
  ipcMain.handle('aurora:update-check', async () => {
    if (!gitHubUpdater) return { ok: false, error: 'Обновления не настроены' };
    return gitHubUpdater.check();
  });
  ipcMain.handle('aurora:update-download', async () => {
    if (!gitHubUpdater) return { ok: false, error: 'Обновления не настроены' };
    const userDataPath = app.getPath('userData');
    return gitHubUpdater.download(userDataPath).then((downloaded) => ({
      ok: true,
      version: downloaded.version,
      path: downloaded.path,
      size: downloaded.size,
    })).catch((err) => ({ ok: false, error: String(err && err.message || err) }));
  });
  ipcMain.handle('aurora:update-apply', async () => {
    if (!gitHubUpdater) return { ok: false, error: 'Обновления не настроены' };
    const userDataPath = app.getPath('userData');
    const appPath = path.dirname(process.execPath);
    try {
      const result = await gitHubUpdater.prepareUpdate(userDataPath, appPath);
      const { spawn } = require('child_process');
      spawn('cmd.exe', ['/c', result.batPath], {
        detached: true,
        stdio: 'ignore',
        windowsHide: true
      }).unref();
      app.quit();
      return { ok: true, version: result.version };
    } catch (err) {
      return { ok: false, error: String(err && err.message || err) };
    }
  });
  /* Универсальный вызов методов главного процесса из renderer. */
  ipcMain.on('aurora-invoke', (_e, channel, invokeId, ...args) => {
    const handler = ipcMain.handle(channel, async () => {
      try {
        const result = await handler.fn(...args);
        _e.sender.send('aurora-invoke-reply-' + invokeId, result || {});
      } catch (err) {
        _e.sender.send('aurora-invoke-reply-' + invokeId, { __error: String(err && err.message || err) });
      }
    });
    if (!handler.fn) {
      const target = {
        'aurora:update-check': () => gitHubUpdater ? gitHubUpdater.check() : { ok: false, error: 'не настроено' },
        'aurora:update-download': () => gitHubUpdater ? gitHubUpdater.download(app.getPath('userData')).then((d) => ({ ok: true, version: d.version, path: d.path, size: d.size })) : { ok: false, error: 'не настроено' },
      }[channel];
      if (!target) {
        _e.sender.send('aurora-invoke-reply-' + invokeId, { __error: 'метод не найден: ' + channel });
        return;
      }
      handler.fn = target;
    }
    handler.fn().catch((err) => {
      _e.sender.send('aurora-invoke-reply-' + invokeId, { __error: String(err && err.message || err) });
    });
  });
  ipcMain.on('aurora:window', (_e, action) => {
    const win = mainWindow;
    if (!win || win.isDestroyed()) return;
    if (action === 'minimize') win.minimize();
    else if (action === 'maximize') win.isMaximized() ? win.unmaximize() : win.maximize();
    else if (action === 'close') win.hide();
  });
}

function showMainWindow() {
  if (!mainWindow || mainWindow.isDestroyed()) return;
  if (mainWindow.isMinimized()) mainWindow.restore();
  mainWindow.show();
  mainWindow.focus();
}

function createTray() {
  if (tray) return;
  const iconPath = path.join(__dirname, '../assets/icons/tray.png');
  const icon = fs.existsSync(iconPath)
    ? nativeImage.createFromPath(iconPath)
    : nativeImage.createFromDataURL('data:image/png;base64,iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+j7ioAAAAASUVORK5CYII=');
  tray = new Tray(icon);
  tray.setToolTip('Aurora Game');
  tray.setContextMenu(Menu.buildFromTemplate([
    { label: 'Открыть Aurora Game', click: showMainWindow },
    { type: 'separator' },
    { label: 'Выйти', click: () => { isQuitting = true; app.quit(); } },
  ]));
  tray.on('click', showMainWindow);
  tray.on('double-click', showMainWindow);
}

/* Разрешения: камера и микрофон нужны для голоса и демонстрации экрана,
   всё остальное запрещено. Медиа разрешаем для нашего локального адреса. */
function registerPermissions(sess) {
  sess.setPermissionRequestHandler((wc, permission, callback) => {
    const url = wc.getURL ? wc.getURL() : '';
    const allowed = isAllowedAppUrl(url, localPort) && [
      'media', 'display-capture', 'clipboard-read', 'clipboard-sanitized-write',
      'pointerLock',
    ].includes(permission);
    callback(allowed);
  });
  sess.setPermissionCheckHandler((_wc, permission, requestingOrigin) => {
    return isAllowedAppUrl(requestingOrigin, localPort) && [
      'media', 'clipboard-read', 'clipboard-sanitized-write', 'display-capture',
    ].includes(permission);
  });

  /* A-931: захват экрана. Без setDisplayMediaRequestHandler
     navigator.mediaDevices.getDisplayMedia() в окне Electron отдаёт
     «NotSupportedError: Not supported» (замер) — то есть «Показать
     экран» не работал ни при каких разрешениях. electron/src/main/
     permissions.js этот обработчик ставил, но вызывается registerPermissions
     из main.js, а не registerAppPermissions, поэтому обработчик там
     просто не устанавливался. Ставим здесь: первый экран или окно. */
  sess.setDisplayMediaRequestHandler(async (request, callback) => {
    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 1, height: 1 },
      });
      if (!sources || !sources.length) { callback({}); return; }
      const picked =
        sources.find((s) => s.id === (request.frame && request.frame.id)) ||
        sources.find((s) => String(s.id).includes('screen')) ||
        sources[0];
      callback({ video: { id: picked.id, name: picked.name } });
    } catch (e) {
      callback({});
    }
  });
}

/* 1.4.52: системный прокси не должен перехватывать наш собственный сервер.
   Windows отдаёт Chromium прокси из Internet Settings. Если у пользователя
   включён прокси (нередко это VPN-клиент на своём же сервере), то WebSocket
   сигналинга LiveKit уходит в него, не доживает до 101 и падает по таймауту
   15 с («room connection has timed out (signal)»), хотя напрямую порт 7443
   открыт. Проверено на живом клиенте: mode 'system' собственные
   proxyBypassRules игнорирует, а 'fixed_servers' с тем же прокси и списком
   обхода отдаёт нашему хосту DIRECT. Поэтому системный прокси сохраняем для
   чужих адресов, а игровой сервер и SFU (тот же хост) пускаем напрямую. */
function mediaDirectHosts() {
  const hosts = new Set(['127.0.0.1', 'localhost', '::1']);
  const addOrigin = (value) => {
    try {
      const host = new URL(String(value || '')).hostname.replace(/^\[|\]$/g, '').trim();
      if (host) hosts.add(host);
    } catch (_) { /* пустой или битый адрес — просто пропускаем */ }
  };
  addOrigin(localserver.COMMUNITY_ORIGIN);
  try {
    addOrigin(localserver.loadConfig().communityOrigin);
  } catch (_) { /* конфиг ещё не создан — хватит адреса по умолчанию */ }
  return Array.from(hosts);
}

/* Системный прокси узнаём у самого Chromium: при mode 'system' resolveProxy
   отдаёт то, что реально применено (включая PAC). Берём первый PROXY. */
async function systemProxyAddress(sess) {
  try {
    const resolved = String(await sess.resolveProxy('https://example.com/') || '');
    const first = resolved.split(';').map((part) => part.trim())
      .find((part) => part.startsWith('PROXY '));
    return first ? first.slice(6).trim() : '';
  } catch (_) {
    return '';
  }
}

async function applyMediaProxyBypass(sess) {
  const bypass = mediaDirectHosts().join(',');
  const proxy = await systemProxyAddress(sess);
  try {
    if (proxy) {
      await sess.setProxy({
        mode: 'fixed_servers',
        proxyRules: 'http=' + proxy + ';https=' + proxy,
        proxyBypassRules: bypass,
      });
      console.log('Прокси: ' + proxy + ' для остальных, напрямую: ' + bypass);
    } else {
      await sess.setProxy({ mode: 'direct' });
      console.log('Прокси: системного нет, ходим напрямую');
    }
  } catch (err) {
    /* Не роняем запуск: без обхода звонок может не подняться, но чат работает. */
    console.warn('Прокси: не удалось настроить обход (' + bypass + '):', err && err.message || err);
  }
}

app.whenReady().then(async () => {
  app.setName('Aurora Game');
  /* Недочёт 1: меню File/Edit/View/Window — оно от Electron, выглядит как
     в браузере и просто занимает полосу сверху. Убираем совсем. */
  Menu.setApplicationMenu(null);

  createTray();

  const sess = session.defaultSession;
  await applyMediaProxyBypass(sess);
  registerPermissions(sess);
  registerIpc();

  /* Автообновление через GitHub Releases. Проверяет каждые 6 часов при
     старте и по запросу из настроек. Секреты не нужны — публичные релизы. */
  gitHubUpdater = createGitHubUpdater({ currentVersion: app.getVersion() });
  gitHubUpdater.check().then((result) => {
    if (result.ok && result.available) {
      console.log('Доступно обновление Aurora Game:', result.version);
    }
  });

  // Порт сохраняется между запусками: localStorage привязан к origin,
  // поэтому случайный порт на каждом старте терял бы имя и профиль.
  startLocalServer(savedLocalPort());

  mainWindow = new BrowserWindow({
    title: 'Aurora Game',
    width: 1280,
    height: 800,
    minWidth: 900,
    minHeight: 600,
    show: false,
    backgroundColor: '#0f1014',
    webPreferences: {
      contextIsolation: true,
      nodeIntegration: false,
      sandbox: false,
      preload: path.join(__dirname, '../preload/preload.js'),
    },
  });

  mainWindow.once('ready-to-show', () => {
    if (app.commandLine.hasSwitch('start-in-tray')) mainWindow.hide();
    else mainWindow.show();
  });
  mainWindow.on('close', (event) => {
    if (isQuitting) return;
    event.preventDefault();
    mainWindow.hide();
  });

  mainWindow.webContents.on('will-navigate', (event, url) => {
    if (!isAllowedAppUrl(url, localPort)) event.preventDefault();
  });
  mainWindow.webContents.setWindowOpenHandler(({ url }) => {
    const externalUrl = allowedExternalUrl(url);
    if (externalUrl) {
      shell.openExternal(externalUrl).catch((err) => {
        console.warn('Не удалось открыть внешнюю ссылку:', err && err.message || err);
      });
    }
    return { action: 'deny' };
  });

  if (localPort) {
    mainWindow.loadURL('http://127.0.0.1:' + localPort + '/');
  }
});

app.on('window-all-closed', () => {
  if (tray && !isQuitting) return;
  if (!isQuitting) { isQuitting = true; app.quit(); }
});

app.on('before-quit', () => {
  isQuitting = true;
  if (tray) { tray.destroy(); tray = null; }
  media.stopServer();
  if (localServer) { try { localServer.close(); } catch (e) { /* уже закрыт */ } }
  localServer = null;
});
