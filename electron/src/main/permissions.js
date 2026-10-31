const { desktopCapturer } = require('electron');

function isRusscordUrl(url) {
  if (!url || url === 'about:blank') return false;
  try {
    const u = new URL(url);
    return u.hostname === 'app.russcord.ru';
  } catch {
    return false;
  }
}

function isRusscordSecurityOrigin(origin) {
  if (!origin) return false;
  try {
    const u = new URL(origin);
    return u.hostname === 'app.russcord.ru';
  } catch {
    return origin.includes('app.russcord.ru');
  }
}

/**
 * A-931: собственный источник приложения. Electron грузит страницу с
 * локального сервера (http://127.0.0.1:<случайный порт>), поэтому
 * разрешения на микрофон и демонстрацию экрана надо выдавать ему.
 *
 * Замер ДО правки: getDisplayMedia() возвращал
 * «NotSupportedError: Not supported», потому что обработчики смотрели
 * только на app.russcord.ru — чужой сайт, которого в этом приложении
 * нет. Микрофон при этом частично проходил, список устройств UI
 * показывал как «система видит: 0», хотя enumerateDevices() отдавал
 * реальный «Razer Kraken V3 X».
 */
function isAppOrigin(url) {
  if (!url || url === 'about:blank') return false;
  try {
    const u = new URL(url);
    return (
      u.hostname === '127.0.0.1' ||
      u.hostname === 'localhost' ||
      u.hostname === '[::1]' ||
      u.hostname === '::1'
    );
  } catch {
    return false;
  }
}

/**
 * Разрешения для демо видео/экрана и медиа на app.russcord.ru
 * @param {import('electron').Session} ses
 */
function registerAppPermissions(ses) {
  const originAllowed = isRusscordUrl;

  ses.setPermissionRequestHandler((webContents, permission, callback, details) => {
    const reqUrl =
      details && 'requestingUrl' in details && details.requestingUrl
        ? details.requestingUrl
        : webContents.getURL();

    const allowed = new Set([
      'media',
      'display-capture',
      'fullscreen',
      'notifications',
      'clipboard-read',
      'clipboard-sanitized-write',
    ]);

    // A-931: наш собственный локальный источник — разрешаем медиа
    if (isAppOrigin(reqUrl) && allowed.has(permission)) {
      callback(true);
      return;
    }

    if (originAllowed(reqUrl) && allowed.has(permission)) {
      callback(true);
      return;
    }

    callback(false);
  });

  ses.setPermissionCheckHandler((webContents, permission, requestingOrigin) => {
    const allowed = new Set(['media', 'fullscreen', 'notifications']);

    const originOk =
      isRusscordSecurityOrigin(requestingOrigin) ||
      isAppOrigin(requestingOrigin) ||
      (webContents && (isRusscordUrl(webContents.getURL()) ||
        isAppOrigin(webContents.getURL())));

    if (originOk && allowed.has(permission)) {
      return true;
    }
    return false;
  });

  ses.setDisplayMediaRequestHandler(async (request, callback) => {
    // A-931: раньше обработчик отдавал пустой объект для всего, кроме
    // app.russcord.ru — из-за этого «Показать экран» не работал вовсе.
    const ownOrigin =
      isAppOrigin(request.securityOrigin) ||
      isAppOrigin(request.securityOrigin && request.securityOrigin.valueOf
        ? request.securityOrigin.valueOf()
        : request.securityOrigin);

    if (!ownOrigin && !isRusscordSecurityOrigin(request.securityOrigin)) {
      callback({});
      return;
    }

    try {
      const sources = await desktopCapturer.getSources({
        types: ['screen', 'window'],
        thumbnailSize: { width: 1, height: 1 },
      });

      const primaryScreen =
        sources.find((s) => String(s.id).includes('screen')) ?? sources[0];

      if (!primaryScreen) {
        callback({});
        return;
      }

      callback({
        video: { id: primaryScreen.id, name: primaryScreen.name },
      });
    } catch {
      callback({});
    }
  });
}

module.exports = {
  registerAppPermissions,
  isRusscordUrl,
  isAppOrigin,
};
