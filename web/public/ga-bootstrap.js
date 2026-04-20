// Google Analytics bootstrap — delayed 3s after load to avoid main-thread blocking.
// Extracted from index.html so CSP can drop 'unsafe-inline' (strict-dynamic readiness).
(function () {
  window.dataLayer = window.dataLayer || [];
  function gtag() { window.dataLayer.push(arguments); }
  window.gtag = window.gtag || gtag;
  gtag('js', new Date());
  gtag('config', 'G-WV4EDKWVJP');
  window.addEventListener('load', function () {
    setTimeout(function () {
      var s = document.createElement('script');
      s.src = 'https://www.googletagmanager.com/gtag/js?id=G-WV4EDKWVJP';
      s.async = true;
      document.head.appendChild(s);
    }, 3000);
  });
})();
