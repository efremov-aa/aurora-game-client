'use strict';

function isAllowedAppUrl(raw, port) {
  const expectedPort = Number(port);
  if (!Number.isInteger(expectedPort) || expectedPort < 1 || expectedPort > 65535) return false;
  try {
    const url = new URL(String(raw || ''));
    return url.protocol === 'http:' && url.hostname === '127.0.0.1' &&
      Number(url.port) === expectedPort && !url.username && !url.password;
  } catch (err) { return false; }
}

function allowedExternalUrl(raw) {
  try {
    const url = new URL(String(raw || ''));
    if (!['http:', 'https:'].includes(url.protocol) || !url.hostname ||
        url.username || url.password) return null;
    return url.href;
  } catch (err) { return null; }
}

module.exports = { isAllowedAppUrl, allowedExternalUrl };
