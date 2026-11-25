/**
 * The script that runs inside the feed page. The mod has no channel into the
 * page but "run this script and read what it returns", so every command sends
 * the whole library; it installs itself once per page load and answers with
 * the page's counters.
 *
 * Rules the library keeps, because the sites enforce them:
 * - no innerHTML (Trusted Types) and no eval / new Function (CSP);
 * - the card lives in a closed shadow root, so site CSS cannot reach it;
 * - nothing is read from the page except video elements and their state.
 */

export const PAGE_VERSION = 11

export type PageCommand = 'play' | 'freeze' | 'park' | 'hold' | 'boss' | 'stats'

export type PageConfig = {
  site: 'douyin' | 'tiktok'
  css: string
  tips: readonly string[]
}

export type FreezeArg = {
  kind: 'done' | 'approval'
  title: string
  sub: string
  againSub: string
  back: string
  more: readonly string[]
}

export type PlayArg = { intro: string | null }

export type BossArg = { lines: readonly string[] }

export type PageStats = {
  /** Clips seen since the page loaded. */
  videos: number
  /** Milliseconds a clip was playing since the page loaded. */
  watchMs: number
  /** 'back' once the person pressed the card's first button; cleared by play. */
  action: 'back' | null
  /** Why the page is frozen, or null. */
  frozen: 'done' | 'approval' | 'boss' | 'hold' | null
  /** True while a "one more" clip is running. */
  more: boolean
  playing: boolean
  /** True once the clip in view has data to show: the site's first load is over. */
  ready: boolean
  url: string
  /** Changes when the page reloads, so counters can be told apart. */
  load: number
}

const LIB = String.raw`
(function (cfg, cmd, arg) {
  var V = cfg.v;
  var W = window.__worknt;
  if (!W || W.v !== V) {
    if (W && W.dispose) { try { W.dispose(); } catch (e) {} }
    W = window.__worknt = {
      v: V, load: Date.now(), videos: 0, watchMs: 0, seen: {}, last: Date.now(),
      frozen: null, card: null, more: null, moreCount: 0, action: null, host: null, root: null,
      dwellKey: null, dwellMs: 0, locked: false
    };

    W.cur = function () {
      var best = null, area = 0;
      var list = document.querySelectorAll('video');
      for (var i = 0; i < list.length; i++) {
        var r = list[i].getBoundingClientRect();
        var w = Math.max(0, Math.min(r.right, innerWidth) - Math.max(r.left, 0));
        var h = Math.max(0, Math.min(r.bottom, innerHeight) - Math.max(r.top, 0));
        if (w * h > area) { area = w * h; best = list[i]; }
      }
      return best;
    };

    W.key = function (v) {
      if (!v) return null;
      if (cfg.site === 'douyin') {
        var a = document.querySelector('[data-e2e="feed-active-video"]');
        if (a) {
          for (var i = 0; i < a.classList.length; i++) {
            if (a.classList[i].indexOf('video_') === 0) return a.classList[i];
          }
        }
      }
      if (v.currentSrc && v.currentSrc.indexOf('blob:') !== 0) return v.currentSrc.split('?')[0];
      return Math.round((v.duration || 0) * 10) + 'x' + v.videoWidth + 'x' + v.videoHeight;
    };

    W.pauseAll = function () {
      var list = document.querySelectorAll('video');
      for (var i = 0; i < list.length; i++) { if (!list[i].paused) { try { list[i].pause(); } catch (e) {} } }
    };

    W.dark = function () {
      return !!(window.matchMedia && window.matchMedia('(prefers-color-scheme: dark)').matches);
    };

    W.clear = function () {
      if (W.host && W.host.parentNode) W.host.parentNode.removeChild(W.host);
      W.host = null; W.root = null;
    };

    W.mount = function (dim) {
      W.clear();
      var host = document.createElement('div');
      host.id = 'worknt-host';
      host.style.cssText = 'all:initial;position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;justify-content:flex-end;background:' + dim + ';';
      var root = host.attachShadow({ mode: 'closed' });
      document.documentElement.appendChild(host);
      W.host = host; W.root = root;
      return root;
    };

    W.el = function (tag, css, text) {
      var e = document.createElement(tag);
      e.style.cssText = css;
      if (text != null) e.textContent = text;
      return e;
    };

    W.drawCard = function () {
      var c = W.card;
      if (!c) return;
      var dark = W.dark();
      var fg = dark ? '#f1efe8' : '#2c2c2a', sub = dark ? '#b4b2a9' : '#5f5e5a';
      var bg = dark ? '#2c2c2a' : '#ffffff', line = dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)';
      var font = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;';
      var root = W.mount('rgba(0,0,0,.6)');
      var card = W.el('div', font + 'margin:12px;padding:16px;border-radius:12px;background:' + bg + ';border:0.5px solid ' + line + ';box-sizing:border-box;');
      card.appendChild(W.el('div', 'font-size:15px;font-weight:500;line-height:1.4;color:' + fg + ';', c.title));
      card.appendChild(W.el('div', 'font-size:13px;line-height:1.5;margin:2px 0 14px;color:' + sub + ';', W.moreCount > 0 ? c.againSub : c.sub));
      var row = W.el('div', 'display:flex;gap:8px;');
      var btn = font + 'flex:1;height:36px;border-radius:8px;font-size:13px;cursor:pointer;padding:0 10px;';
      var back = W.el('button', btn + 'border:0;background:' + fg + ';color:' + bg + ';', c.back);
      var label = c.more[Math.min(W.moreCount, c.more.length - 1)];
      var more = W.el('button', btn + 'background:transparent;color:' + fg + ';border:0.5px solid ' + line + ';', label);
      back.addEventListener('click', function () { W.action = 'back'; W.frozen = null; W.card = null; W.more = null; W.clear(); W.sync(); });
      more.addEventListener('click', function () {
        var v = W.cur();
        W.moreCount += 1; W.frozen = null; W.clear(); W.sync();
        W.more = { key: W.key(v), lastT: v ? v.currentTime : 0, at: Date.now() };
        if (v) { try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
      });
      row.appendChild(back); row.appendChild(more);
      card.appendChild(row);
      root.appendChild(card);
    };

    W.freeze = function (c) {
      if (c) { W.card = c; W.moreCount = 0; }
      if (!W.card) return;
      W.frozen = W.card.kind; W.more = null;
      W.pauseAll(); W.drawCard();
    };

    W.tick = function () {
      var now = Date.now(), dt = Math.min(1500, now - W.last);
      W.last = now;
      W.sync();
      if (W.frozen) { W.pauseAll(); return; }
      var v = W.cur();
      var playing = !!(v && !v.paused && !v.ended);
      if (playing) {
        W.watchMs += dt;
        var k = v.readyState >= 2 && v.duration > 0 ? W.key(v) : null;
        if (k !== W.dwellKey) { W.dwellKey = k; W.dwellMs = 0; }
        else if (k) { W.dwellMs += dt; }
        if (k && W.dwellMs >= 1500 && !W.seen[k]) { W.seen[k] = 1; W.videos += 1; }
      }
      if (W.more && v) {
        var key = W.key(v);
        if (key !== W.more.key) { W.more.key = key; W.more.lastT = v.currentTime; }
        else if (v.ended || v.currentTime + 0.75 < W.more.lastT || now - W.more.at > 300000) { W.freeze(null); }
        else { W.more.lastT = v.currentTime; }
      }
    };

    W.block = function (e) {
      if (!W.frozen) return;
      if (W.host && e.composedPath && e.composedPath().indexOf(W.host) !== -1) return;
      e.stopImmediatePropagation();
      if (e.cancelable) e.preventDefault();
    };

    // The blocking listeners are non-passive, which costs the page its smooth
    // scrolling, so they are attached only while a card or the boss page is up.
    var events = ['keydown', 'keyup', 'keypress', 'wheel', 'touchmove', 'pointerdown', 'mousedown', 'click'];
    W.sync = function () {
      var want = !!W.frozen;
      if (want === W.locked) return;
      W.locked = want;
      for (var i = 0; i < events.length; i++) {
        if (want) window.addEventListener(events[i], W.block, { capture: true, passive: false });
        else window.removeEventListener(events[i], W.block, { capture: true });
      }
    };
    W.timer = setInterval(W.tick, 500);
    W.dispose = function () {
      clearInterval(W.timer);
      W.frozen = null; W.sync();
      W.clear();
    };
  }

  var style = document.getElementById('worknt-css');
  if (!style) {
    style = document.createElement('style');
    style.id = 'worknt-css';
    (document.head || document.documentElement).appendChild(style);
    style.textContent = cfg.css;
    window.dispatchEvent(new Event('resize'));
  } else if (style.textContent !== cfg.css) {
    style.textContent = cfg.css;
    window.dispatchEvent(new Event('resize'));
  }

  if (cmd === 'play') {
    W.frozen = null; W.card = null; W.more = null; W.moreCount = 0; W.action = null;
    W.clear();
    var all = document.querySelectorAll('button, div, span');
    for (var t = 0; t < all.length; t++) {
      var n = all[t];
      if (n.children.length === 0 && cfg.tips.indexOf((n.textContent || '').trim()) !== -1) { try { n.click(); } catch (e) {} }
    }
    if (arg && arg.intro) {
      var root = W.mount('transparent');
      W.host.style.pointerEvents = 'none';
      W.host.style.justifyContent = 'flex-start';
      var note = W.el('div', 'pointer-events:auto;cursor:pointer;margin:12px;padding:10px 12px;border-radius:8px;font:13px/1.5 -apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC",sans-serif;background:rgba(0,0,0,.78);color:#fff;', arg.intro);
      note.addEventListener('click', function () { W.clear(); });
      root.appendChild(note);
    }
    var v = W.cur();
    if (v && v.paused) { try { var p = v.play(); if (p && p.catch) p.catch(function () {}); } catch (e) {} }
  } else if (cmd === 'freeze') {
    W.freeze(arg);
  } else if (cmd === 'hold') {
    W.frozen = 'hold'; W.card = null; W.more = null; W.clear(); W.pauseAll();
  } else if (cmd === 'park') {
    W.frozen = null; W.card = null; W.more = null; W.clear(); W.pauseAll();
  } else if (cmd === 'boss') {
    W.frozen = 'boss'; W.card = null; W.more = null; W.pauseAll();
    var r2 = W.mount('#16161a');
    W.host.style.justifyContent = 'flex-start';
    var pre = W.el('pre', 'margin:0;padding:14px;font:12px/1.6 ui-monospace,SFMono-Regular,Menlo,Consolas,monospace;color:#c9c7bd;white-space:pre-wrap;');
    pre.textContent = arg.lines.join('\n');
    r2.appendChild(pre);
  }

  W.sync();
  var cur = W.cur();
  return {
    videos: W.videos, watchMs: W.watchMs, action: W.action, frozen: W.frozen, more: !!W.more,
    playing: !!(cur && !cur.paused && !cur.ended), ready: !!(cur && cur.readyState >= 2),
    url: location.href, load: W.load
  };
})
`

const STATS = String.raw`
(function (v) {
  var W = window.__worknt;
  if (!W || W.v !== v) return { missing: true };
  var cur = W.cur();
  return {
    videos: W.videos, watchMs: W.watchMs, action: W.action, frozen: W.frozen, more: !!W.more,
    playing: !!(cur && !cur.paused && !cur.ended), ready: !!(cur && cur.readyState >= 2),
    url: location.href, load: W.load
  };
})
`

/**
 * Reads the counters without resending the library: what the mod asks every
 * few seconds. Answers `{ missing: true }` on a page that has not been set up.
 */
export function statsScript(): string {
  return `${STATS.trim()}(${PAGE_VERSION})`
}

/** The text to hand the browser pane's script tool: one expression that answers PageStats. */
export function pageScript(
  config: PageConfig,
  command: PageCommand,
  arg: FreezeArg | PlayArg | BossArg | null,
): string {
  const cfg = { ...config, v: PAGE_VERSION }
  return `${LIB.trim()}(${JSON.stringify(cfg)}, ${JSON.stringify(command)}, ${JSON.stringify(arg)})`
}
