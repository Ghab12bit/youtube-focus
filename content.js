(() => {
  'use strict';

  // ---------- Config ----------
  const DEFAULTS = {
    enabled: true,   // master switch
    grey: true,      // 1. grey thumbnails
    blur: true,      // 2. blur until hover (search + subscriptions)
    mute: true,      // 3. mute red signals (logo, progress bar, badges)
    pause: true,     // 4. "why are you here" screen
    countdown: 5,    //    seconds
    timer: true,     // 5. session timer badge
    limit: true,     // 6. soft limit
    limitMin: 30     //    minutes
  };
  const SESSION_GAP_MS = 30 * 60 * 1000; // 30 min away = new session
  const TICK_MS = 5000;
  const MAX_DELTA_MS = 15000;            // caps double-counting across tabs
  const PAUSE_PAGES = ['home', 'search', 'subs', 'feed'];
  const SNOOZE_MS = 10 * 60 * 1000;

  const root = document.documentElement;
  let settings = { ...DEFAULTS };
  let session = null;
  let lastHref = location.href;
  let tickTimer = null;
  let pauseEl = null;
  let limitEl = null;
  let countdownTimer = null;

  const alive = () => { try { return !!chrome.runtime?.id; } catch { return false; } };

  // ---------- Page detection ----------
  function pageType() {
    const p = location.pathname;
    if (p === '/') return 'home';
    if (p.startsWith('/results')) return 'search';
    if (p.startsWith('/feed/subscriptions')) return 'subs';
    if (p.startsWith('/feed')) return 'feed';
    if (p.startsWith('/watch')) return 'watch';
    if (p.startsWith('/shorts')) return 'shorts';
    return 'other';
  }

  // ---------- 3b. Grey favicon (the red icon in Chrome's tab strip) ----------
  // CSS can't reach the tab strip, so we swap the page's <link rel="icon">.
  const GREY_ICON = 'data:image/svg+xml,' + encodeURIComponent(
    '<svg xmlns="http://www.w3.org/2000/svg" viewBox="0 0 32 32">' +
    '<rect x="1" y="6" width="30" height="20" rx="6" fill="#6B6B6B"/>' +
    '<path d="M13 11v10l9-5z" fill="#FFFFFF"/></svg>'
  );
  let applyingIcon = false;

  function applyFavicon() {
    if (!document.head) return;
    applyingIcon = true;
    const want = settings.enabled && settings.mute;
    const links = document.head.querySelectorAll('link[rel~="icon"]');
    links.forEach((l) => {
      if (want) {
        if (l.getAttribute('href') !== GREY_ICON) {
          l.dataset.ytfOrig = l.getAttribute('href') || '';
          l.setAttribute('href', GREY_ICON);
          l.removeAttribute('type');
        }
      } else if (l.dataset.ytfOrig !== undefined) {
        l.setAttribute('href', l.dataset.ytfOrig);
        delete l.dataset.ytfOrig;
      }
    });
    if (want && !links.length) {
      const l = document.createElement('link');
      l.rel = 'icon';
      l.href = GREY_ICON;
      l.dataset.ytfOrig = '';
      document.head.appendChild(l);
    }
    applyingIcon = false;
  }

  // YouTube rewrites its favicon on navigation and notifications: re-apply each time
  function watchFavicon() {
    const start = () => {
      applyFavicon();
      new MutationObserver(() => { if (!applyingIcon) applyFavicon(); })
        .observe(document.head, { childList: true, subtree: true, attributes: true, attributeFilter: ['href', 'rel'] });
    };
    if (document.head) start();
    else document.addEventListener('DOMContentLoaded', start, { once: true });
  }

  function applyAttrs() {
    const on = settings.enabled;
    root.dataset.ytfOn = on ? 'on' : 'off';
    root.dataset.ytfGrey = on && settings.grey ? 'on' : 'off';
    root.dataset.ytfBlur = on && settings.blur ? 'on' : 'off';
    root.dataset.ytfMute = on && settings.mute ? 'on' : 'off';
    root.dataset.ytfPage = pageType();
    root.dataset.ytfLock = pauseEl || limitEl ? 'on' : 'off';
    root.dataset.ytfLimit = limitEl ? 'on' : 'off';
  }

  // ---------- Storage ----------
  const getSettings = () => chrome.storage.sync.get(DEFAULTS);
  const getSession = async () => (await chrome.storage.local.get('session')).session || null;
  const saveSession = (s) => chrome.storage.local.set({ session: s });
  const newSession = () => ({
    start: Date.now(), lastActive: Date.now(), activeMs: 0, intent: '', extraMs: 0
  });
  const expired = (s) => !s || Date.now() - s.lastActive > SESSION_GAP_MS;
  const limitMs = () => settings.limitMin * 60000 + (session?.extraMs || 0);

  // ---------- UI host (shadow DOM keeps YouTube's CSS out) ----------
  const host = document.createElement('ytf-host');
  host.style.cssText =
    'all: initial; position: fixed; inset: 0; z-index: 2147483647; pointer-events: none;';
  const shadow = host.attachShadow({ mode: 'closed' });
  shadow.innerHTML = `<style>${UI_CSS()}</style><div id="badge" hidden></div>`;
  const badge = shadow.getElementById('badge');

  // Stop YouTube's keyboard shortcuts (k, j, l, /) while typing in our overlay.
  // Registered at document_start, so it runs before YouTube's own listeners.
  ['keydown', 'keyup', 'keypress'].forEach((t) =>
    window.addEventListener(t, (e) => {
      if ((pauseEl || limitEl) && e.composedPath().includes(host)) e.stopImmediatePropagation();
    }, true)
  );

  // Block playback while an overlay is open
  document.addEventListener('play', (e) => {
    if ((pauseEl || limitEl) && e.target instanceof HTMLMediaElement) e.target.pause();
  }, true);
  const pauseVideos = () => document.querySelectorAll('video').forEach((v) => v.pause());

  const closeTab = () => { try { chrome.runtime.sendMessage({ type: 'closeTab' }); } catch {} };

  // ---------- 4. "Why are you here?" ----------
  function showPause() {
    if (pauseEl) return;
    pauseEl = document.createElement('div');
    pauseEl.className = 'screen';
    pauseEl.innerHTML = `
      <form class="card" autocomplete="off">
        <div class="eyebrow">YouTube Focus</div>
        <h1>What are you here for?</h1>
        <input class="field" maxlength="80" placeholder="e.g. Manifest V3 tutorial" />
        <div class="row">
          <span class="meta count"></span>
          <div class="actions">
            <button type="button" class="btn ghost leave">Leave</button>
            <button type="submit" class="btn primary go" disabled>Continue</button>
          </div>
        </div>
        <p class="hint">Links you open directly skip this screen.</p>
      </form>`;
    shadow.appendChild(pauseEl);

    const form = pauseEl.querySelector('form');
    const input = pauseEl.querySelector('.field');
    const go = pauseEl.querySelector('.go');
    const count = pauseEl.querySelector('.count');
    let left = Math.max(0, Number(settings.countdown) || 0);

    const update = () => {
      count.textContent = left > 0 ? `Continue unlocks in ${left}s` : 'Press Enter to continue';
      go.disabled = left > 0 || !input.value.trim();
    };
    update();
    countdownTimer = setInterval(() => {
      left = Math.max(0, left - 1);
      if (left === 0) { clearInterval(countdownTimer); countdownTimer = null; }
      update();
    }, 1000);

    input.addEventListener('input', update);
    form.addEventListener('submit', async (e) => {
      e.preventDefault();
      const v = input.value.trim();
      if (!v || left > 0) return;
      let s = await getSession();
      if (expired(s)) s = newSession();
      s.intent = v;
      s.lastActive = Date.now();
      session = s;
      await saveSession(s);
      hidePause();
      refresh();
    });
    pauseEl.querySelector('.leave').addEventListener('click', closeTab);

    const focus = () => pauseEl && input.focus();
    setTimeout(focus, 50);
    window.addEventListener('load', focus, { once: true });
    pauseVideos();
    applyAttrs();
  }

  function hidePause() {
    if (!pauseEl) return;
    pauseEl.remove();
    pauseEl = null;
    if (countdownTimer) { clearInterval(countdownTimer); countdownTimer = null; }
    applyAttrs();
  }

  function maybeShowPause() {
    const eligible = settings.enabled && settings.pause && session &&
      !session.intent && PAUSE_PAGES.includes(pageType());
    if (eligible) showPause();
    else hidePause();
  }

  // ---------- 6. Soft limit ----------
  function showLimit() {
    if (limitEl) return;
    limitEl = document.createElement('div');
    limitEl.className = 'screen dim';
    const mins = Math.round(session.activeMs / 60000);
    limitEl.innerHTML = `
      <div class="card">
        <div class="eyebrow">YouTube Focus</div>
        <h1>${mins} minutes on YouTube</h1>
        <p class="body"></p>
        <div class="row end">
          <div class="actions">
            <button type="button" class="btn ghost more">10 more minutes</button>
            <button type="button" class="btn primary close">Close tab</button>
          </div>
        </div>
      </div>`;
    // textContent: the intent is user input, never inject it as HTML
    const body = limitEl.querySelector('.body');
    if (session.intent) {
      body.append('You came here for: ');
      const b = document.createElement('strong');
      b.textContent = session.intent;
      body.append(b, '. Did you get it?');
    } else {
      body.textContent = 'You didn’t set a goal this session.';
    }
    shadow.appendChild(limitEl);

    limitEl.querySelector('.close').addEventListener('click', closeTab);
    limitEl.querySelector('.more').addEventListener('click', async () => {
      const s = (await getSession()) || session;
      s.extraMs = s.activeMs - settings.limitMin * 60000 + SNOOZE_MS;
      session = s;
      await saveSession(s);
      hideLimit();
      refresh();
    });
    setTimeout(() => limitEl && limitEl.querySelector('.close').focus(), 50);
    pauseVideos();
    applyAttrs();
  }

  function hideLimit() {
    if (!limitEl) return;
    limitEl.remove();
    limitEl = null;
    applyAttrs();
  }

  function checkLimit() {
    const over = settings.enabled && settings.limit && session && !pauseEl &&
      session.activeMs >= limitMs();
    if (over) showLimit();
    else hideLimit();
  }

  // ---------- 5. Session timer badge ----------
  function renderBadge() {
    const show = settings.enabled && settings.timer && session && !pauseEl && !limitEl;
    badge.hidden = !show;
    if (!show) return;
    const mins = Math.floor(session.activeMs / 60000);
    badge.textContent = session.intent ? `${mins} min · ${session.intent}` : `${mins} min`;
    badge.title = 'Active time on YouTube this session';
    badge.classList.toggle('warn',
      !!settings.limit && session.activeMs >= limitMs() - 5 * 60000);
  }

  // ---------- Loop ----------
  function refresh() {
    applyAttrs();
    applyFavicon();
    maybeShowPause();
    checkLimit();
    renderBadge();
  }

  async function tick() {
    if (!alive()) { clearInterval(tickTimer); return; } // extension reloaded
    if (document.visibilityState !== 'visible') return;
    let s = await getSession();
    const now = Date.now();
    if (expired(s)) {
      s = newSession();
    } else {
      s.activeMs += Math.min(Math.max(0, now - s.lastActive), MAX_DELTA_MS);
      s.lastActive = now;
    }
    session = s;
    await saveSession(s);
    refresh();
  }

  function onNav() {
    if (location.href === lastHref) return;
    lastHref = location.href;
    refresh();
  }

  async function init() {
    settings = await getSettings();
    applyAttrs();
    root.appendChild(host);
    watchFavicon();

    let s = await getSession();
    if (expired(s)) { s = newSession(); await saveSession(s); }
    session = s;
    refresh();

    tickTimer = setInterval(tick, TICK_MS);
    document.addEventListener('visibilitychange', () => {
      if (document.visibilityState === 'visible') tick();
    });
    // YouTube is a single-page app: catch its internal navigation
    document.addEventListener('yt-navigate-finish', onNav);
    window.addEventListener('popstate', onNav);
    setInterval(onNav, 1000);

    chrome.storage.onChanged.addListener((changes, area) => {
      if (area === 'sync') {
        for (const k in changes) settings[k] = changes[k].newValue ?? DEFAULTS[k];
        hideLimit(); // re-evaluated with new settings below
        refresh();
      }
      if (area === 'local' && 'session' in changes) {
        session = changes.session.newValue || null;
        if (!session) tick(); // "End session" from popup: start fresh now
        else refresh();
      }
    });
  }

  init();

  // ---------- Overlay styles ----------
  function UI_CSS() {
    return `
      :host { all: initial; }
      * { box-sizing: border-box; }
      .screen {
        position: fixed; inset: 0; pointer-events: auto;
        display: flex; align-items: center; justify-content: center;
        background: #121212;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
        color: #EDEDED; -webkit-font-smoothing: antialiased;
        animation: in .2s ease;
      }
      .screen.dim { background: rgba(10, 10, 10, 0.72); backdrop-filter: blur(2px); }
      @keyframes in { from { opacity: 0 } to { opacity: 1 } }
      .card { width: min(520px, calc(100vw - 48px)); }
      .dim .card {
        background: #161616; border: 1px solid #2A2A2A; border-radius: 16px; padding: 32px;
      }
      .eyebrow {
        font-size: 11px; font-weight: 600; letter-spacing: .12em; text-transform: uppercase;
        color: #8A8A8A; margin-bottom: 14px;
      }
      h1 { font-size: 28px; line-height: 1.2; font-weight: 600; margin: 0 0 22px; letter-spacing: -0.01em; }
      .body { font-size: 15px; line-height: 1.55; color: #BDBDBD; margin: -8px 0 26px; }
      .body strong { color: #EDEDED; font-weight: 600; }
      .field {
        width: 100%; font: inherit; font-size: 18px; color: #EDEDED;
        background: #1C1C1C; border: 1px solid #2A2A2A; border-radius: 10px;
        padding: 14px 16px; outline: none; transition: border-color .15s;
      }
      .field::placeholder { color: #5C5C5C; }
      .field:focus { border-color: #8FB3A0; }
      .row { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; }
      .row.end { justify-content: flex-end; }
      .meta { font-size: 13px; color: #8A8A8A; font-variant-numeric: tabular-nums; }
      .actions { display: flex; gap: 8px; }
      .btn {
        font: inherit; font-size: 14px; font-weight: 600; border-radius: 8px;
        padding: 10px 16px; cursor: pointer; border: 1px solid transparent;
        transition: opacity .15s, background .15s;
      }
      .btn:focus-visible { outline: 2px solid #8FB3A0; outline-offset: 2px; }
      .primary { background: #8FB3A0; color: #0E1A14; }
      .primary:hover:not(:disabled) { background: #A3C4B2; }
      .primary:disabled { opacity: .3; cursor: not-allowed; }
      .ghost { background: transparent; color: #BDBDBD; border-color: #2A2A2A; }
      .ghost:hover { background: #1C1C1C; }
      .hint { font-size: 12px; color: #5C5C5C; margin: 28px 0 0; }
      #badge {
        position: fixed; right: 16px; bottom: 16px; pointer-events: auto;
        max-width: 300px; overflow: hidden; text-overflow: ellipsis; white-space: nowrap;
        font-family: -apple-system, BlinkMacSystemFont, "SF Pro Text", "Segoe UI", Roboto, sans-serif;
        font-size: 12px; font-weight: 500; font-variant-numeric: tabular-nums;
        color: #EDEDED; background: rgba(18, 18, 18, 0.88);
        border: 1px solid #2A2A2A; border-radius: 999px; padding: 6px 12px;
        opacity: .75; transition: opacity .15s, color .3s;
      }
      #badge:hover { opacity: 1; }
      #badge.warn { color: #C9A86A; border-color: #4A3F2A; }
      [hidden] { display: none !important; }
    `;
  }
})();
