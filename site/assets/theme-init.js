// Loaded as a blocking classic script in <head> so the saved theme applies
// before first paint (no flash). Kept external so CSP can stay script-src 'self'.
(function () {
  try {
    var t = JSON.parse(localStorage.getItem('hlt:theme'));
    if (t === 'light' || t === 'dark') document.documentElement.setAttribute('data-theme', t);
  } catch (e) { /* storage unavailable: follow the system theme */ }
})();
