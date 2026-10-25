// Applies the saved theme before the page paints (loaded as a classic script in <head>).
// Themes: light, dark, or auto (light/dark from the device, the default).
(function () {
  var pick = 'auto';
  try {
    pick = localStorage.getItem('nuuvi:theme') || 'auto';
  } catch (e) {
    /* storage unavailable */
  }
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
  try {
    size = localStorage.getItem('nuuvi:text');
  } catch (e) {
    /* storage unavailable */
  }
  if (size === 'large' || size === 'larger') document.documentElement.dataset.text = size;
  // Character names in episodes: their own color/gradient (default) or plain, matching the theme.
  var names = null;
  try {
    names = localStorage.getItem('nuuvi:names');
  } catch (e) {
    /* storage unavailable */
  }
  if (names === 'theme') root.dataset.names = 'theme';

  // Interface size, on every device. Everyone starts at Standard (phones too: the layout is built for
  // their screens, so it isn't shrunk down); anyone can pick another size in their profile. The whole
  // page is zoomed (heights that use the screen size are divided back by --ui-zoom in styles.css), so
  // the page always fills the screen exactly, including the home-screen app on iPhone.
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
    try {
      saved = localStorage.getItem('nuuvi:ui');
    } catch (e) {
      /* storage unavailable */
    }
    ui = ui || saved;
    if (!SCALES[ui]) ui = 'standard';
    root.dataset.ui = ui;
    var scale = SCALES[ui];
    root.style.setProperty('--ui-zoom', String(scale));
    if (scale === 1) root.style.removeProperty('zoom');
    else root.style.zoom = String(scale);
  }
  apply();

  // While typing on a phone, keep the app exactly the height of the space above the keyboard,
  // so the message box stays put instead of the whole page sliding up and down.
  if (touch && window.visualViewport) {
    var vv = window.visualViewport;
    var typing = function () {
      var el = document.activeElement;
      return (
        !!el &&
        (el.tagName === 'TEXTAREA' ||
          el.isContentEditable ||
          (el.tagName === 'INPUT' && !/^(checkbox|radio|button|submit|file|color|range)$/.test(el.type)))
      );
    };
    // The app's height changes only when the keyboard opens or closes (a resize). iOS scrolling to
    // keep your cursor in view is never fought (that made the screen jump); the app follows it instead.
    var lastH = 0;
    var zoom = function () {
      return Number(root.style.getPropertyValue('--ui-zoom')) || 1;
    };
    // iPhone also slides the visible area down while you type (to show the cursor). Instead of
    // fighting that, the app moves with it, so it always sits exactly above the keyboard.
    var raf = 0;
    var follow = function () {
      raf = 0;
      if (!lastH) {
        root.style.removeProperty('--vv-top');
        return;
      }
      // The app is pinned (position: fixed) while the keyboard is up. iPhones don't agree on where a
      // pinned box sits while the visible area slides (some count the page's scroll, some don't),
      // and guessing wrong pushed the app up under the status bar with an empty band above the
      // keyboard (or down, with a band above the chat). So instead of guessing, measure where the
      // app really is and move it so its top lines up with the top of the visible area.
      var cur = parseFloat(root.style.getPropertyValue('--vv-top')) || 0;
      var off = document.body.getBoundingClientRect().top - vv.offsetTop; // on-screen px
      if (Math.abs(off) > 0.5) root.style.setProperty('--vv-top', cur - off / zoom() + 'px');
    };
    var schedule = function () {
      if (!raf) raf = requestAnimationFrame(follow);
    };
    // With the keyboard down the page itself never scrolls (each page scrolls inside the app), so if
    // the phone has scrolled it anyway, put it back.
    var unshift = function () {
      if (!lastH && window.scrollY && !document.body.classList.contains('guest')) window.scrollTo(0, 0);
    };
    vv.addEventListener('scroll', schedule);
    window.addEventListener('scroll', schedule, { passive: true });
    window.addEventListener('scroll', unshift, { passive: true });
    var fit = function (e) {
      var keyboardUp = typing() && vv.height < window.innerHeight - 80;
      if (keyboardUp) {
        var h = Math.round(vv.height);
        if (Math.abs(h - lastH) > 1) {
          lastH = h;
          root.style.setProperty('--app-h', h / zoom() + 'px');
          root.classList.add('kb-up');
        }
        schedule();
      } else if (lastH && (!e || e.type !== 'focusin')) {
        lastH = 0;
        root.style.removeProperty('--app-h');
        root.style.removeProperty('--vv-top');
        root.classList.remove('kb-up');
        if (window.scrollY) window.scrollTo(0, 0);
        // iPhone sometimes puts its scroll back a moment after the keyboard has gone, which left the
        // whole app shifted up under the clock. Check again once it has settled.
        setTimeout(unshift, 200);
        setTimeout(unshift, 600);
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
    document.addEventListener('focusout', function () {
      setTimeout(fit, 120);
    });
  }
  // The space for the status bar (clock, battery) and the home bar. Some iPhones now and then report
  // none (after the keyboard closes, or on coming back to the app), and the app ran up under the
  // clock. So remember the real size, held upright, and never use less than that (see --sat in styles.css).
  if (touch) {
    var upright = window.matchMedia && window.matchMedia('(orientation: portrait)');
    var measureSafe = function () {
      if (!document.body) return;
      var probe = document.createElement('div');
      probe.style.setProperty('position', 'fixed');
      probe.style.setProperty('visibility', 'hidden');
      probe.style.setProperty('pointer-events', 'none');
      probe.style.setProperty('padding-top', 'env(safe-area-inset-top, 0px)');
      probe.style.setProperty('padding-bottom', 'env(safe-area-inset-bottom, 0px)');
      document.body.appendChild(probe);
      var cs = getComputedStyle(probe);
      var t = parseFloat(cs.paddingTop) || 0;
      var b = parseFloat(cs.paddingBottom) || 0;
      probe.remove();
      if (!upright || !upright.matches) {
        root.style.removeProperty('--sat-min');
        root.style.removeProperty('--sab-min');
        root.style.removeProperty('--full-h');
        return;
      }
      // The home-screen app should get the whole screen. Some iPhones hand it a shorter one (an empty
      // band at the bottom, the size of the status bar) and report no status bar at all, so the app
      // ran up under the clock. Fill the real screen, and leave the status bar its room.
      var standalone = navigator.standalone || (window.matchMedia && window.matchMedia('(display-mode: standalone)').matches);
      // In the home-screen app on iPhone the clock and battery always sit over the top of the app, and
      // each iPhone's status bar is a known height. Never leave less room than that, whatever the phone
      // reports (some report none, or too little, and the top of the app went under the clock).
      if (standalone && /iPhone/.test(navigator.userAgent)) {
        var h = Math.max(screen.width, screen.height);
        var bar = { 667: 20, 736: 20, 812: 47, 844: 47, 926: 47, 852: 59, 932: 59, 874: 62, 956: 62 }[h] || (h > 812 ? 59 : 20);
        if (t < bar) t = bar;
        if (h >= 812 && b < 34) b = 34;
      }
      if (standalone && !root.classList.contains('kb-up')) {
        var short = Math.round(screen.height - window.innerHeight);
        if (short > 8 && short < 120) {
          root.style.setProperty('--full-h', screen.height + 'px');
          if (t < 1) t = Math.min(short, 62);
        } else if (short <= 1) root.style.removeProperty('--full-h');
      }
      var seen = { t: 0, b: 0 };
      try {
        seen = JSON.parse(localStorage.getItem('nuuvi:safe') || '{}');
      } catch (e) {
        /* storage unavailable */
      }
      var best = { t: Math.max(seen.t || 0, t), b: Math.max(seen.b || 0, b) };
      if (best.t !== seen.t || best.b !== seen.b) {
        try {
          localStorage.setItem('nuuvi:safe', JSON.stringify(best));
        } catch (e) {
          /* storage unavailable */
        }
      }
      root.style.setProperty('--sat-min', best.t + 'px');
      root.style.setProperty('--sab-min', best.b + 'px');
    };
    document.addEventListener('DOMContentLoaded', measureSafe);
    window.addEventListener('resize', measureSafe);
    document.addEventListener('visibilitychange', function () {
      if (!document.hidden) setTimeout(measureSafe, 300);
    });
    if (upright && upright.addEventListener) upright.addEventListener('change', measureSafe);
  }
  window.nuuviScale = { apply: apply, touch: touch, mobile: mobile };
  if (window.matchMedia) {
    var o = window.matchMedia('(orientation: portrait)');
    if (o.addEventListener)
      o.addEventListener('change', function () {
        apply();
      });
  }
})();
