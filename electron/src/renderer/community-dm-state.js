/* Read markers are isolated by game server, profile and DM partner. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory();
  else root.AuroraCommunityDM = factory();
})(typeof window !== 'undefined' ? window : globalThis, function () {
  function readKey(namespace, origin, playerId, otherId) {
    return [namespace, origin, playerId, 'dm-' + otherId].map(function (value) {
      return encodeURIComponent(String(value == null ? '' : value));
    }).join(':');
  }

  function compareMessageIds(left, right) {
    var a = String(left == null ? '' : left).replace(/^0+/, '') || '0';
    var b = String(right == null ? '' : right).replace(/^0+/, '') || '0';
    if (!/^\d+$/.test(a) || !/^\d+$/.test(b)) return 0;
    if (a.length !== b.length) return a.length < b.length ? -1 : 1;
    return a === b ? 0 : (a < b ? -1 : 1);
  }

  function isUnread(item, lastReadId, activeDmId, currentPlayerId) {
    if (!item || String(item.id || '') === String(activeDmId || '')) return false;
    var incomingId = String(item.last_incoming_id == null ? '' : item.last_incoming_id);
    if (/^\d+$/.test(incomingId)) return compareMessageIds(incomingId, lastReadId) > 0;
    if (String(item.from || '') === String(currentPlayerId || '')) return false;
    return compareMessageIds(item.last_id, lastReadId) > 0;
  }

  return { readKey: readKey, compareMessageIds: compareMessageIds, isUnread: isUnread };
});
