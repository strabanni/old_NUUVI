// Applies the saved theme before the page paints (loaded as a classic script in <head>).
(function () {
  var pick = 'auto';
  try { pick = localStorage.getItem('nuuvi:theme') || 'auto'; } catch (e) { /* storage unavailable */ }
  if (pick !== 'light' && pick !== 'dark') pick = 'auto';
  var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  document.documentElement.dataset.theme = pick === 'auto' ? (light ? 'light' : 'dark') : pick;
  var size = null;
  try { size = localStorage.getItem('nuuvi:text'); } catch (e) { /* storage unavailable */ }
  if (size === 'large' || size === 'larger') document.documentElement.dataset.text = size;
})();
