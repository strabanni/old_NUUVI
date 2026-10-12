// Applies the saved theme before the page paints (loaded as a classic script in <head>).
// Themes: base (NUUVI pink, the default), light, dark, neutral light/dark (no pink at all),
// or auto (light/dark from the device).
(function () {
  var pick = 'base';
  try { pick = localStorage.getItem('nuuvi:theme') || 'base'; } catch (e) { /* storage unavailable */ }
  if (['base', 'light', 'dark', 'mono-light', 'mono-dark', 'auto'].indexOf(pick) < 0) pick = 'base';
  var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  var root = document.documentElement;
  root.dataset.theme = pick === 'auto' ? (light ? 'light' : 'dark') : pick.replace('mono-', '');
  if (pick.indexOf('mono-') === 0) root.dataset.accent = 'neutral'; else delete root.dataset.accent;
  var size = null;
  try { size = localStorage.getItem('nuuvi:text'); } catch (e) { /* storage unavailable */ }
  if (size === 'large' || size === 'larger') document.documentElement.dataset.text = size;

  // Interface size on phones and tablets. Compact (the default) draws everything ~14% smaller,
  // closer to Discord's scale; Standard is the browser's normal size; Large is bigger.
  // Done with the viewport (an explicit layout width plus a matching scale) so every part of
  // the page shrinks evenly, the same way in Safari and Chrome.
  var SCALES = { compact: 0.86, standard: 1, large: 1.12 };
  var ui = null;
  try { ui = localStorage.getItem('nuuvi:ui'); } catch (e) { /* storage unavailable */ }
  if (!SCALES[ui]) ui = 'compact';
  document.documentElement.dataset.ui = ui;
  var meta = document.querySelector('meta[name=viewport]');
  var base = meta ? meta.getAttribute('content') : '';
  function fit() {
    if (!meta) return;
    var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
    var shortSide = Math.min(screen.width, screen.height);
    var scale = SCALES[ui];
    if (!touch || shortSide >= 900 || scale === 1) { meta.setAttribute('content', base); return; }
    var portrait = window.matchMedia('(orientation: portrait)').matches;
    var side = portrait ? shortSide : Math.max(screen.width, screen.height);
    meta.setAttribute('content', 'width=' + Math.round(side / scale) + ', initial-scale=' + scale +
      ', viewport-fit=cover, interactive-widget=resizes-content');
  }
  fit();
  if (window.matchMedia) {
    var o = window.matchMedia('(orientation: portrait)');
    if (o.addEventListener) o.addEventListener('change', fit);
  }
})();
