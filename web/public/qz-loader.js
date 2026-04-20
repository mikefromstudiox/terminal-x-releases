// qz-tray conditional loader — only on POS routes.
// Extracted from index.html for CSP strict-dynamic readiness.
(function () {
  if (location.pathname.startsWith('/pos')) {
    var s = document.createElement('script');
    s.src = 'https://cdn.jsdelivr.net/npm/qz-tray@2/qz-tray.js';
    s.async = true;
    document.head.appendChild(s);
  }
})();
