'use strict';

const fs = require('fs');
const path = require('path');
const crypto = require('crypto');
const https = require('https');
const { Transform, Readable } = require('stream');
const { pipeline } = require('stream/promises');
const { spawn } = require('child_process');

const GITHUB_OWNER = 'efremov-aa';
const GITHUB_REPOSITORY = 'aurora-game-client';
const RELEASE_ASSET = 'AuroraGame-win32-x64.zip';
const MAX_UPDATE_BYTES = 350 * 1024 * 1024;

function versionParts(value) {
  const match = /^v?(\d+)\.(\d+)\.(\d+)$/.exec(String(value || '').trim());
  return match ? match.slice(1).map(Number) : null;
}

function isNewerVersion(candidate, current) {
  const next = versionParts(candidate);
  const installed = versionParts(current);
  if (!next || !installed) return false;
  for (let index = 0; index < 3; index += 1) {
    if (next[index] !== installed[index]) return next[index] > installed[index];
  }
  return false;
}

function safeRelease(release, repoUrl) {
  if (!release || release.draft || release.prerelease) throw new Error('GitHub не вернул стабильный выпуск');
  const version = String(release.tag_name || '').replace(/^v/, '');
  if (!versionParts(version)) throw new Error('У выпуска неверная версия');
  const asset = Array.isArray(release.assets)
    ? release.assets.find((item) => item && item.name === RELEASE_ASSET && item.state === 'uploaded')
    : null;
  if (!asset) throw new Error('В выпуске нет Windows portable ZIP');
  const digest = /^sha256:([a-f0-9]{64})$/i.exec(String(asset.digest || ''));
  if (!digest) throw new Error('GitHub не предоставил SHA-256 для архива обновления');
  const url = new URL(String(asset.browser_download_url || ''));
  if (url.protocol !== 'https:' || url.hostname !== 'github.com' ||
      !url.pathname.startsWith('/' + GITHUB_OWNER + '/' + GITHUB_REPOSITORY + '/releases/download/')) {
    throw new Error('Ссылка на обновление ведёт за пределы Releases Aurora Game');
  }
  const size = Number(asset.size);
  if (!Number.isSafeInteger(size) || size < 1 || size > MAX_UPDATE_BYTES) {
    throw new Error('Размер архива обновления недопустим');
  }
  return {
    version,
    tag: String(release.tag_name),
    notes: String(release.body || '').slice(0, 12000),
    releaseUrl: String(release.html_url || repoUrl),
    downloadUrl: url.toString(),
    size,
    sha256: digest[1].toLowerCase(),
  };
}

function downloadHttps(url, outputPath, expectedSize, expectedSha256) {
  return new Promise((resolve, reject) => {
    let redirects = 0;
    let settled = false;
    const fail = (error) => {
      if (settled) return;
      settled = true;
      try { fs.unlinkSync(outputPath); } catch (e) { /* временного файла может не быть */ }
      reject(error);
    };
    const request = (target) => {
      const parsed = new URL(target);
      if (parsed.protocol !== 'https:' || !(parsed.hostname === 'github.com' || parsed.hostname.endsWith('.githubusercontent.com'))) {
        fail(new Error('GitHub перенаправил архив на недоверенный адрес'));
        return;
      }
      const req = https.get(parsed, { headers: { 'User-Agent': 'AuroraGame-Updater/1.0' } }, (res) => {
        if ([301, 302, 303, 307, 308].includes(res.statusCode)) {
          res.resume();
          if (!res.headers.location || ++redirects > 5) return fail(new Error('Слишком много перенаправлений GitHub'));
          let redirected;
          try { redirected = new URL(res.headers.location, parsed).toString(); }
          catch (error) { return fail(new Error('GitHub вернул неверное перенаправление')); }
          request(redirected);
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          return fail(new Error('Загрузка обновления завершилась HTTP ' + res.statusCode));
        }
        const reportedLength = Number(res.headers['content-length']);
        if (Number.isFinite(reportedLength) && reportedLength !== expectedSize) {
          res.resume();
          return fail(new Error('Размер архива не совпадает с метаданными GitHub'));
        }
        const hash = crypto.createHash('sha256');
        let bytes = 0;
        const meter = new Transform({
          transform(chunk, encoding, callback) {
            bytes += chunk.length;
            if (bytes > MAX_UPDATE_BYTES || bytes > expectedSize) {
              callback(new Error('Архив обновления превышает допустимый размер'));
              return;
            }
            hash.update(chunk);
            callback(null, chunk);
          },
        });
        pipeline(res, meter, fs.createWriteStream(outputPath, { flags: 'wx' }))
          .then(() => {
            if (bytes !== expectedSize) throw new Error('Загружен не весь архив обновления');
            const actual = hash.digest('hex');
            if (actual !== expectedSha256) throw new Error('SHA-256 архива не совпадает с GitHub');
            if (!settled) { settled = true; resolve({ path: outputPath, size: bytes, sha256: actual }); }
          })
          .catch(fail);
      });
      req.setTimeout(120000, () => req.destroy(new Error('Истекло время ожидания загрузки')));
      req.on('error', fail);
    };
    request(url);
  });
}

function createGitHubUpdater(options) {
  const config = options || {};
  const fetchImpl = config.fetch || global.fetch;
  const currentVersion = String(config.currentVersion || '0.0.0');
  const apiUrl = 'https://api.github.com/repos/' + GITHUB_OWNER + '/' + GITHUB_REPOSITORY + '/releases/latest';
  const repoUrl = 'https://github.com/' + GITHUB_OWNER + '/' + GITHUB_REPOSITORY + '/releases';
  let cached = null;

  async function check() {
    if (typeof fetchImpl !== 'function') return { ok: false, error: 'HTTP-клиент недоступен' };
    try {
      const response = await fetchImpl(apiUrl, {
        headers: { Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'AuroraGame-Updater/1.0' },
        signal: AbortSignal.timeout(15000),
      });
      if (response.status === 404) return { ok: true, available: false, configured: true, currentVersion, error: 'Релизы клиента на GitHub ещё не опубликованы' };
      if (!response.ok) throw new Error('GitHub API ответил HTTP ' + response.status);
      const release = safeRelease(await response.json(), repoUrl);
      cached = release;
      return {
        ok: true,
        configured: true,
        available: isNewerVersion(release.version, currentVersion),
        currentVersion,
        version: release.version,
        notes: release.notes,
        releaseUrl: release.releaseUrl,
        size: release.size,
        sha256: release.sha256,
      };
    } catch (error) {
      return { ok: false, error: String(error && error.message || error) };
    }
  }

  async function download(userDataPath) {
    const result = await check();
    if (!result.ok || !result.available || !cached) {
      throw new Error(result.error || (result.available ? 'Выпуск не получен' : 'Установлена последняя версия'));
    }
    const directory = path.join(userDataPath, 'updates');
    fs.mkdirSync(directory, { recursive: true });
    const outputPath = path.join(directory, 'AuroraGame-' + cached.version + '.zip');
    try { fs.unlinkSync(outputPath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
    return downloadHttps(cached.downloadUrl, outputPath, cached.size, cached.sha256).then((downloaded) => ({
      version: cached.version,
      path: downloaded.path,
      size: downloaded.size,
      sha256: downloaded.sha256,
    }));
  }

  return { check, download };
}

function findAppDir(dir) {
  const entries = fs.readdirSync(dir, { withFileTypes: true });
  for (const entry of entries) {
    if (entry.isDirectory()) {
      const testPath = path.join(dir, entry.name, 'AuroraGame.exe');
      if (fs.existsSync(testPath)) return path.join(dir, entry.name);
    }
  }
  return dir;
}

async function prepareUpdate(userDataPath, appPath) {
  const result = await check();
  if (!result.ok || !result.available || !cached) {
    throw new Error(result.error || (result.available ? 'Выпуск не получен' : 'Установлена последняя версия'));
  }

  const updateDir = path.join(userDataPath, 'updates');
  fs.mkdirSync(updateDir, { recursive: true });

  const zipPath = path.join(updateDir, 'AuroraGame-' + cached.version + '.zip');
  try { fs.unlinkSync(zipPath); } catch (e) { if (e.code !== 'ENOENT') throw e; }

  await downloadHttps(cached.downloadUrl, zipPath, cached.size, cached.sha256);

  const extractDir = path.join(updateDir, 'extract-' + cached.version);
  fs.mkdirSync(extractDir, { recursive: true });

  await new Promise((resolve, reject) => {
    const ps = spawn('powershell.exe', [
      '-NoProfile', '-ExecutionPolicy', 'Bypass',
      '-Command', 'Expand-Archive -Path "' + zipPath + '" -DestinationPath "' + extractDir + '" -Force'
    ]);
    ps.on('close', code => code === 0 ? resolve() : reject(new Error('Распаковка не удалась, код ' + code)));
    ps.on('error', reject);
  });

  const appDir = findAppDir(extractDir);

  const batPath = path.join(updateDir, 'update.bat');
  const appExe = path.join(appPath, 'AuroraGame.exe');
  const batContent = [
    '@echo off',
    'setlocal enabledelayedexpansion',
    '',
    'echo Ожидание закрытия Aurora Game...',
    'timeout /t 5 /nobreak >nul',
    '',
    'tasklist /FI "IMAGENAME eq AuroraGame.exe" 2>nul | findstr /i "AuroraGame.exe" >nul',
    'if %errorlevel% equ 0 (',
    '  taskkill /F /IM AuroraGame.exe >nul 2>&1',
    '  timeout /t 3 /nobreak >nul',
    ')',
    '',
    'robocopy "' + appDir + '" "' + appPath + '" /E /MT /NFL /NDL /NJH /NJS',
    '',
    'start "" "' + appExe + '"',
    '',
    'rmdir /s /q "' + extractDir + '" >nul 2>&1',
    'del "' + zipPath + '" >nul 2>&1',
    'del "%~f0" >nul 2>&1'
  ].join('\r\n');

  fs.writeFileSync(batPath, batContent, { encoding: 'utf8' });

  return { version: cached.version, batPath: batPath, notes: cached.notes };
}

module.exports = { createGitHubUpdater, isNewerVersion, safeRelease, downloadHttps, prepareUpdate };
