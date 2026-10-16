// Applies the saved theme before the page paints (loaded as a classic script in <head>).
// Themes: light, dark, or auto (light/dark from the device, the default).
(function () {
  var pick = 'auto';
  try { pick = localStorage.getItem('nuuvi:theme') || 'auto'; } catch (e) { /* storage unavailable */ }
  if (pick === 'mono-light' || pick === 'mono-dark') pick = pick.slice(5); // the old Neutral themes
  if (['light', 'dark', 'auto'].indexOf(pick) < 0) pick = 'auto';
  var light = window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches;
  var root = document.documentElement;
  root.dataset.theme = pick === 'auto' ? (light ? 'light' : 'dark') : pick;
  // Every theme's interface is neutral (greys, black, white); Light and Dark add the pink brand
  // touches (logo, greeting, rail selection) on top.
  root.dataset.accent = 'neutral';
  root.dataset.brand = 'pink';
  var size = null;
  try { size = localStorage.getItem('nuuvi:text'); } catch (e) { /* storage unavailable */ }
  if (size === 'large' || size === 'larger') document.documentElement.dataset.text = size;
  // Character names in episodes: their own color/gradient (default) or plain, matching the theme.
  var names = null;
  try { names = localStorage.getItem('nuuvi:names'); } catch (e) { /* storage unavailable */ }
  if (names === 'theme') root.dataset.names = 'theme';

  // Interface size, on every device. Phones default to Small (closer to Discord's scale), computers
  // to Standard. The whole page is zoomed (heights that use the screen size are divided back by
  // --ui-zoom in styles.css), so the page always fills the screen exactly — including the
  // home-screen app on iPhone.
  var SCALES = { xsmall: 0.78, compact: 0.86, standard: 1, large: 1.12, xlarge: 1.25 };
  var meta = document.querySelector('meta[name=viewport]');
  var touch = window.matchMedia && window.matchMedia('(pointer: coarse)').matches;
  var mobile = touch && Math.min(screen.width, screen.height) < 900;
  var ios = /iPad|iPhone|iPod/.test(navigator.userAgent) || (navigator.platform === 'MacIntel' && navigator.maxTouchPoints > 1);
  // iPhones zoom in whenever a text box is tapped (and stay zoomed, so the page jumps around).
  // maximum-scale stops that; iOS still lets people pinch to zoom.
  if (meta && ios) meta.setAttribute('content', 'width=device-width, initial-scale=1, maximum-scale=1, viewport-fit=cover');
  function apply(ui) {
    var saved = null;
    try { saved = localStorage.getItem('nuuvi:ui'); } catch (e) { /* storage unavailable */ }
    ui = ui || saved;
    if (!SCALES[ui]) ui = mobile ? 'compact' : 'standard';
    root.dataset.ui = ui;
    var scale = SCALES[ui];
    root.style.setProperty('--ui-zoom', String(scale));
    if (scale === 1) root.style.removeProperty('zoom'); else root.style.zoom = String(scale);
  }
  apply();

  // While typing on a phone, keep the app exactly the height of the space above the keyboard,
  // so the message box stays put instead of the whole page sliding up and down.
  if (touch && window.visualViewport) {
    var vv = window.visualViewport;
    var typing = function () {
      var el = document.activeElement;
      return !!el && (el.tagName === 'TEXTAREA' || el.isContentEditable || (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|color|range)$/.test(el.type)));
    };
    // The app's height changes only when the keyboard opens or closes (a resize). iOS scrolling to
    // keep your cursor in view is never fought (that made the screen jump); the app follows it instead.
    var lastH = 0;
    var zoom = function () { return Number(root.style.getPropertyValue('--ui-zoom')) || 1; };
    // iPhone also slides the visible area down while you type (to show the cursor). Instead of
    // fighting that, the app moves with it, so it always sits exactly above the keyboard.
    var raf = 0;
    var follow = function () {
      raf = 0;
      if (!lastH) { root.style.removeProperty('--vv-top'); return; }
      // The app is pinned (position: fixed) while the keyboard is up, so only how far the visible
      // area has slid inside the screen counts. Adding the page's scroll too pushed the app down
      // twice on newer iPhones, leaving an empty band above the chat.
      var top = Math.max(0, vv.offsetTop);
      root.style.setProperty('--vv-top', (top / zoom()) + 'px');
    };
    var schedule = function () { if (!raf) raf = requestAnimationFrame(follow); };
    vv.addEventListener('scroll', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    var fit = function (e) {
      var keyboardUp = typing() && vv.height < window.innerHeight - 80;
      if (keyboardUp) {
        var h = Math.round(vv.height);
        if (Math.abs(h - lastH) > 1) {
          lastH = h;
          root.style.setProperty('--app-h', (h / zoom()) + 'px');
          root.classList.add('kb-up');
        }
        schedule();
      } else if (lastH && (!e || e.type !== 'focusin')) {
        lastH = 0;
        root.style.removeProperty('--app-h');
        root.style.removeProperty('--vv-top');
        root.classList.remove('kb-up');
        if (window.scrollY) window.scrollTo(0, 0);
      }
    };
    vv.addEventListener('resize', fit);
    // While the keyboard slides up, keep fitting every frame (for about a second) so the app shrinks
    // along with it, instead of staying full height and then snapping into place.
    var settleUntil = 0;
    var settle = function () {
      fit({ type: 'focusin' });
      if (performance.now() < settleUntil) requestAnimationFrame(settle);
    };
    document.addEventListener('focusin', function () {
      if (!typing()) return;
      var running = performance.now() < settleUntil;
      settleUntil = performance.now() + 1000;
      if (!running) requestAnimationFrame(settle);
    });
    document.addEventListener('focusout', function () { setTimeout(fit, 120); });
  }
  window.nuuviScale = { apply: apply, touch: touch, mobile: mobile };
  if (window.matchMedia) {
    var o = window.matchMedia('(orientation: portrait)');
    if (o.addEventListener) o.addEventListener('change', function () { apply(); });
  }
})();
