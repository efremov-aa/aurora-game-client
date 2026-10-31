/* Scope message event cursors to the API origin and the authenticated profile. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.AuroraCommunityCursorKey = factory;
})(typeof window !== 'undefined' ? window : globalThis, function (namespace, origin, playerId, room) {
  return [namespace, origin, playerId, room].map(function (value) {
    return encodeURIComponent(String(value == null ? '' : value));
  }).join(':');
});
