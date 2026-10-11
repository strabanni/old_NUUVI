// Applies the saved theme before the page paints (loaded as a classic script in <head>).
(function () {
  var pick = 'auto';
  try { pick = localStorage.getItem('nuuvi:theme') || 'auto'; } catch (e) { /* storage unavailable */ }
  var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.dataset.theme = pick === 'auto' ? (light ? 'mist' : 'dusk') : pick;
})();
