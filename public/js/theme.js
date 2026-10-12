// Applies the saved theme before the page paints (loaded as a classic script in <head>).
// Themes: light, dark, neutral light/dark (no pink at all), or auto (light/dark from the device, the default).
(function () {
  var pick = 'auto';
  try { pick = localStorage.getItem('nuuvi:theme') || 'auto'; } catch (e) { /* storage unavailable */ }
  if (['light', 'dark', 'mono-light', 'mono-dark', 'auto'].indexOf(pick) < 0) pick = 'auto';
  var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  var root = document.documentElement;
  root.dataset.theme = pick === 'auto' ? (light ? 'light' : 'dark') : pick.replace('mono-', '');
  // Every theme's interface is neutral (greys, black, white); Light and Dark add the pink brand
  // touches (logo, greeting, rail selection) on top. The Neutral themes leave them out.
  root.dataset.accent = 'neutral';
  if (pick.indexOf('mono-') === 0) delete root.dataset.brand; else root.dataset.brand = 'pink';
  var size = null;
  try { size = localStorage.getItem('nuuvi:text'); } catch (e) { /* storage unavailable */ }
  if (size === 'large' || size === 'larger') document.documentElement.dataset.text = size;

  // Interface size, on every device. Phones default to Compact (closer to Discord's scale),
  // computers to Standard. Phones and tablets scale through the viewport (so everything shrinks
  // evenly in Safari and Chrome); computers use CSS zoom on the page.
  var SCALES = { xsmall: 0.78, compact: 0.86, standard: 1, large: 1.12, xlarge: 1.25 };
  var meta = document.querySelector('meta[name=viewport]');
  var base = meta ? meta.getAttribute('content') : '';
  var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var mobile = touch && Math.min(screen.width, screen.height) < 900;
  function apply(ui) {
    var saved = null;
    try { saved = localStorage.getItem('nuuvi:ui'); } catch (e) { /* storage unavailable */ }
    ui = ui || saved;
    if (!SCALES[ui]) ui = mobile ? 'compact' : 'standard';
    root.dataset.ui = ui;
    var scale = SCALES[ui];
    if (touch) {
      root.style.removeProperty('zoom');
      if (!meta) return;
      if (scale === 1) { meta.setAttribute('content', base); return; }
      var portrait = window.matchMedia('(orientation: portrait)').matches;
      var side = portrait ? Math.min(screen.width, screen.height) : Math.max(screen.width, screen.height);
      meta.setAttribute('content', 'width=' + Math.round(side / scale) + ', initial-scale=' + scale +
        ', viewport-fit=cover, interactive-widget=resizes-content');
    } else {
      root.style.setProperty('--ui-zoom', String(scale));
      if (scale === 1) root.style.removeProperty('zoom'); else root.style.zoom = String(scale);
    }
  }
  apply();
  window.nuuviScale = { apply: apply, touch: touch, mobile: mobile };
  if (window.matchMedia) {
    var o = window.matchMedia('(orientation: portrait)');
    if (o.addEventListener) o.addEventListener('change', function () { apply(); });
  }
})();
