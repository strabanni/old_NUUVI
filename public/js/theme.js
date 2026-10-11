// Applies the saved theme before the page paints (loaded as a classic script in <head>).
// Themes: base (NUUVI pink, the default), light, dark, or auto (light/dark from the device).
(function () {
  var pick = 'base';
  try { pick = localStorage.getItem('nuuvi:theme') || 'base'; } catch (e) { /* storage unavailable */ }
  if (pick !== 'base' && pick !== 'light' && pick !== 'dark' && pick !== 'auto') pick = 'base';
  var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.dataset.theme = pick === 'auto' ? (light ? 'light' : 'dark') : pick;
  var size = null;
  try { size = localStorage.getItem('nuuvi:text'); } catch (e) { /* storage unavailable */ }
  if (size === 'large' || size === 'larger') document.documentElement.dataset.text = size;
})();
