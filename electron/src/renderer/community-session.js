/* Scope browser fallback tokens and async responses to one game API origin. */
(function (root, factory) {
  if (typeof module === 'object' && module.exports) module.exports = factory;
  else root.AuroraCommunitySession = factory;
})(typeof window !== 'undefined' ? window : globalThis, function (tokenNamespace, origin) {
  return {
    tokenKey: String(tokenNamespace) + ':' + encodeURIComponent(String(origin == null ? '' : origin)),
    isCurrent: function (session, generation, currentOrigin) {
      return !!session && session.generation === generation && session.origin === currentOrigin;
    },
    assertCurrent: function (session, generation, currentOrigin) {
      if (!this.isCurrent(session, generation, currentOrigin)) {
        var error = new Error('игровой профиль или сервер изменился; повторите действие');
        error.name = 'AbortError';
        throw error;
      }
      return true;
    },
  };
});
