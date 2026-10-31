'use strict';

const crypto = require('crypto');
const fs = require('fs');
const path = require('path');

function createCommunityTokenStore(app, safeStorage) {
  const file = () => path.join(app.getPath('userData'), 'community-token.enc');
  const defaultOrigin = 'https://5.141.235.56.sslip.io:8445';
  const tokenPattern = /^[A-Za-z0-9_-]{40,128}$/;

  function normalizeOrigin(value) {
    const parsed = new URL(String(value || defaultOrigin));
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.pathname !== '/' || parsed.search || parsed.hash) {
      throw new Error('неверный адрес игрового сервера');
    }
    return parsed.origin;
  }

  async function readTokens() {
    const target = file();
    if (!fs.existsSync(target)) return {};
    const info = fs.lstatSync(target);
    if (!info.isFile() || info.size > 16384) throw new Error('Файл ключей игрового профиля повреждён');
    const decrypted = await safeStorage.decryptStringAsync(fs.readFileSync(target));
    if (!decrypted || typeof decrypted.result !== 'string') throw new Error('Не удалось расшифровать ключи игрового профиля');
    const plaintext = decrypted.result;
    let record;
    try { record = JSON.parse(plaintext); }
    catch (_) {
      if (tokenPattern.test(plaintext)) {
        const legacy = { [defaultOrigin]: plaintext };
        if (decrypted.shouldReEncrypt) await writeTokens(legacy);
        return legacy;
      }
      throw new Error('Файл ключей игрового профиля повреждён');
    }
    const tokens = {};
    if (record && record.version === 1 && typeof record.token === 'string') {
      const origin = normalizeOrigin(record.origin);
      if (tokenPattern.test(record.token)) tokens[origin] = record.token;
      if (decrypted.shouldReEncrypt) await writeTokens(tokens);
      return tokens;
    }
    if (!record || record.version !== 2 || !record.tokens || typeof record.tokens !== 'object' || Array.isArray(record.tokens)) {
      throw new Error('Файл ключей игрового профиля повреждён');
    }
    Object.entries(record.tokens).slice(0, 20).forEach(([origin, token]) => {
      try {
        const normalized = normalizeOrigin(origin);
        if (normalized === origin && tokenPattern.test(String(token))) tokens[origin] = token;
      } catch (_) { /* повреждённая запись не переносится в активное хранилище */ }
    });
    if (decrypted.shouldReEncrypt) await writeTokens(tokens);
    return tokens;
  }

  async function writeTokens(tokens) {
    const target = file();
    fs.mkdirSync(path.dirname(target), { recursive: true });
    const temporary = target + '.' + process.pid + '.' + crypto.randomBytes(6).toString('hex') + '.tmp';
    try {
      const record = JSON.stringify({ version: 2, tokens });
      const encrypted = await safeStorage.encryptStringAsync(record);
      fs.writeFileSync(temporary, encrypted, { mode: 0o600, flag: 'wx' });
      fs.renameSync(temporary, target);
    } catch (err) {
      try { fs.unlinkSync(temporary); } catch (_) { /* временного файла могло не быть */ }
      throw err;
    }
  }

  async function read(origin) {
    try {
      if (!await safeStorage.isAsyncEncryptionAvailable()) {
        return { ok: false, error: 'Защищённое хранилище Windows недоступно' };
      }
      const key = normalizeOrigin(origin);
      return { ok: true, token: (await readTokens())[key] || '' };
    } catch (err) {
      return { ok: false, error: 'Не удалось прочитать защищённые ключи профиля: ' + String(err && err.message || err) };
    }
  }

  async function write(value, origin) {
    const token = String(value || '');
    if (!tokenPattern.test(token)) {
      return { ok: false, error: 'Ключ игрового профиля имеет неверный формат' };
    }
    try {
      if (!await safeStorage.isAsyncEncryptionAvailable()) {
        return { ok: false, error: 'Защищённое хранилище Windows недоступно' };
      }
      const key = normalizeOrigin(origin);
      const tokens = await readTokens();
      if (!Object.prototype.hasOwnProperty.call(tokens, key) && Object.keys(tokens).length >= 20) {
        return { ok: false, error: 'Сохранено слишком много игровых серверов; удалите ключи из профиля Windows' };
      }
      tokens[key] = token;
      await writeTokens(tokens);
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Не удалось сохранить защищённый ключ профиля: ' + String(err && err.message || err) };
    }
  }

  async function clear(origin) {
    try {
      const target = file();
      if (origin == null || String(origin) === '') {
        try { fs.unlinkSync(target); }
        catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
        return { ok: true };
      }
      const key = normalizeOrigin(origin);
      const tokens = await readTokens();
      delete tokens[key];
      if (Object.keys(tokens).length) await writeTokens(tokens);
      else {
        try { fs.unlinkSync(target); }
        catch (err) { if (!err || err.code !== 'ENOENT') throw err; }
      }
      return { ok: true };
    } catch (err) {
      return { ok: false, error: 'Не удалось удалить ключ профиля: ' + String(err && err.message || err) };
    }
  }

  return { read, write, clear };
}

module.exports = { createCommunityTokenStore };
