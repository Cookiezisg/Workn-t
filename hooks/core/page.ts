import type { PageStats, PageWant, SiteId } from './types'

/**
 * The part of Workn't that lives inside the video page.
 *
 * `pageMain` is sent to the page as its own source text (`String(pageMain)`)
 * and called there, so it must stand entirely on its own: it may use nothing
 * from this file or any other, only its three arguments. The same function is
 * called directly by the tests with a made-up window, which is why it reaches
 * the page only through `env`.
 *
 * What it keeps to, because the sites enforce it:
 * - no innerHTML (Trusted Types), no eval, no new Function (CSP);
 * - everything it draws sits in one closed shadow root, out of the site's CSS;
 * - it reads nothing of the page but its address, a handful of marker
 *   elements, and the state of its video elements. Never cookies, never text.
 *
 * The mod states what it wants (`want`) and the page makes itself match, every
 * half second, without being asked again. Everything that must be instant
 * (pausing when the page stops being painted, the card's buttons, "one more")
 * is therefore decided here, not by a round trip to the mod.
 */

export const PAGE_VERSION = 24

export type PageConfig = {
  v: number
  site: SiteId
  css: string
  /** Null follows the page's own colour scheme. */
  isDark: boolean | null
  /** The sound setting is off. */
  isMuted: boolean
  /** W-3: how long without input before the page asks whether anyone is there. */
  idleMs: number
  /** Live streams in the feed are moved past (the mod presses the key; the page only says when). */
  skipLive: boolean
  copy: { stillThere: string; stay: string; back: string; lost: string; tapToPlay: string }
  /** T-1: the small menu on the video page. Null draws none. */
  menu: PageMenu | null
}

/** One row is one setting: its choices, and the one in force. A choice made is reported as the act `set` with `<id> <value>`. */
export type PageMenu = {
  rows: { id: string; label: string; value: string; options: { value: string; label: string }[] }[]
  back: string
}

export type PageCommand = {
  /** What the page should be. Null leaves it as it is (a plain question). */
  want: PageWant | null
  /** Acts up to this number have been handled and need not be reported again. */
  ack: number
}

/* eslint-disable */
export function pageMain(env: any, cfg: any, cmd: any): any {
  var win = env.window
  var doc = env.document
  var now = function (): number {
    return env.now ? env.now() : Date.now()
  }
  var W = win.__worknt

  if (!W || W.v !== cfg.v) {
    if (W && W.dispose) {
      try {
        W.dispose()
      } catch (e) {}
    }
    var born = now()
    W = win.__worknt = {
      v: cfg.v,
      cfg: cfg,
      load: born,
      want: { mode: 'rest', hold: false, card: null, note: null, toast: null },
      health: 'loading',
      href: '',
      routeSince: born,
      videos: 0,
      watchMs: 0,
      seen: {},
      dwellKey: null,
      dwellMs: 0,
      lastTick: born,
      lastSync: born,
      lastInput: born,
      frames: 0,
      framesAt: born,
      framesOk: true,
      more: null,
      moreCount: 0,
      idleAsk: false,
      userPaused: false,
      oursUntil: 0,
      pauseOnce: false,
      acts: [],
      actN: 0,
      lost: false,
      locked: false,
      cssOn: false,
      host: null,
      root: null,
      drawn: '',
      toastId: null,
      toastUntil: 0,
      silenced: [],
      volTouched: false,
      pressing: false,
      err: null,
      steps: 0,
      why: '',
      blocked: false,
      menuOpen: false,
      pick: {},
      lastMove: 0,
      gearSince: 0,
      view: { card: false, live: false, cue: false },
      liveSince: 0,
      skipAt: 0,
      skips: 0,
      armed: false,
      timer: null,
      raf: 0,
    }

    // ---- reading the page -------------------------------------------------

    W.all = function (selector: string): any[] {
      try {
        var list = doc.querySelectorAll(selector)
        var out = []
        for (var i = 0; i < list.length; i++) out.push(list[i])
        return out
      } catch (e) {
        return []
      }
    }

    W.one = function (selector: string): any {
      var list = W.all(selector)
      return list.length > 0 ? list[0] : null
    }

    /** The clip in view: the largest one on screen, else the site's own "active" one, else any that has data. */
    W.cur = function (): any {
      var list = W.all('video')
      var best = null
      var area = 0
      for (var i = 0; i < list.length; i++) {
        var r = list[i].getBoundingClientRect ? list[i].getBoundingClientRect() : null
        if (!r) continue
        var w = Math.max(0, Math.min(r.right, win.innerWidth) - Math.max(r.left, 0))
        var h = Math.max(0, Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0))
        if (w * h > area) {
          area = w * h
          best = list[i]
        }
      }
      if (best) return best
      if (W.cfg.site === 'douyin') {
        var active = W.one('[data-e2e="feed-active-video"] video')
        if (active) return active
      }
      for (var j = 0; j < list.length; j++) if (!list[j].paused) return list[j]
      for (var k = 0; k < list.length; k++) if (list[k].readyState > 0) return list[k]
      return list.length > 0 ? list[0] : null
    }

    /** Names a clip well enough to count it once. */
    W.key = function (v: any): string | null {
      if (!v) return null
      if (W.cfg.site === 'douyin') {
        var a = W.one('[data-e2e="feed-active-video"]')
        if (a && a.classList) {
          for (var i = 0; i < a.classList.length; i++) {
            if (String(a.classList[i]).indexOf('video_') === 0) return String(a.classList[i])
          }
        }
      }
      var src = v.currentSrc || ''
      if (src && src.indexOf('blob:') !== 0) return src.split('?')[0]
      return Math.round((v.duration || 0) * 10) + 'x' + (v.videoWidth || 0) + 'x' + (v.videoHeight || 0)
    }

    W.isLive = function (v: any): boolean {
      return !!v && !(v.duration > 0 && v.duration < 1e9)
    }

    /** Takes up most of the window right now. */
    W.fills = function (el: any): boolean {
      var r = el && el.getBoundingClientRect ? el.getBoundingClientRect() : null
      if (!r) return false
      var h = Math.max(0, Math.min(r.bottom, win.innerHeight) - Math.max(r.top, 0))
      return h >= win.innerHeight * 0.5
    }

    /**
     * Whether the slide in view is a live stream, and what says so: the site's own mark for one, or a video
     * with no length. A clip can lack a length for its first moments too, so that alone counts only once it
     * has played for a few seconds and still has none. Empty when it is an ordinary clip, or not yet known.
     */
    W.liveSlide = function (v: any): string {
      if (W.cfg.site === 'douyin') {
        var marks = W.all('[data-e2e="feed-live"]')
        for (var i = 0; i < marks.length; i++) if (W.fills(marks[i])) return 'mark'
      }
      return v && v.readyState > 0 && (v.duration === Infinity || v.duration > 1e9) && v.currentTime > 3 ? 'length' : ''
    }

    /** A setting as it will be: the choice just made on the menu, until the mod's own word arrives. */
    W.chosen = function (id: string, fallback: string): string {
      return typeof W.pick[id] === 'string' ? W.pick[id] : fallback
    }

    W.isMuted = function (): boolean {
      return W.chosen('sound', W.cfg.isMuted ? 'off' : 'on') === 'off'
    }

    W.skipsLive = function (): boolean {
      return W.chosen('live', W.cfg.skipLive ? 'skip' : 'show') === 'skip'
    }

    /** The sound setting changed: stop holding the old one, and let the clip in view be heard if that is now wanted. */
    W.applySound = function (): void {
      W.volTouched = false
      if (W.isMuted()) return
      var v = W.cur()
      if (v && v.muted && W.silenced.indexOf(v) === -1) {
        W.ours()
        v.muted = false
      }
    }

    /** True for an element that takes real room on the page; one the site keeps around hidden does not count. */
    W.shown = function (el: any): boolean {
      return !!el && el.offsetHeight > 60
    }

    /** Section 3: what this page is right now. */
    W.detect = function (): string {
      var loc = win.location
      var host = String(loc.hostname || '').toLowerCase()
      var site = W.cfg.site
      var base = site === 'douyin' ? 'douyin.com' : 'tiktok.com'
      if (host !== base && host.slice(-(base.length + 1)) !== '.' + base) return 'left'
      if (loc.href !== W.href) {
        W.href = loc.href
        W.routeSince = now()
      }
      if (doc.readyState === 'loading') return 'loading'

      var challenge =
        site === 'douyin'
          ? W.one('#captcha_container') || W.one('.captcha-verify-container') || W.one('iframe#nocaptcha-container')
          : W.one('#captcha-verify-container-main-page') || W.one('.captcha_verify_container') || W.one('#captcha_container')
      if (W.shown(challenge)) return 'verify'

      var isSignedOut = false
      if (site === 'tiktok') {
        isSignedOut = !!(W.one('#header-login-button') || W.one('#top-right-login-button') || W.one('[data-e2e="top-login-button"]'))
      } else {
        if (W.one('#login-panel-new') || W.one('[id^="login-full-panel"]')) isSignedOut = true
        var leaves = W.all('#douyin-header button, #douyin-header a, #douyin-header span, #douyin-header p, #douyin-header div')
        for (var i = 0; i < leaves.length && !isSignedOut; i++) {
          var leaf = leaves[i]
          if (leaf.children && leaf.children.length > 0) continue
          var text = String(leaf.textContent || '').replace(/\s+/g, '')
          if (text === '登录' || text.toLowerCase() === 'login') isSignedOut = true
        }
      }
      if (isSignedOut) return 'login'

      var path = String(loc.pathname || '/')
      var isFeedRoute =
        site === 'douyin'
          ? path === '/' && /[?&]recommend=1(&|$)/.test(String(loc.search || ''))
          : /^\/(foryou\/?|[a-z]{2}(-[A-Za-z]{2})?\/?)?$/.test(path)
      if (!isFeedRoute) return 'elsewhere'

      // The feed is told by its frame, not by what is in the slide: a live stream in the feed
      // has no clip of the usual kind, and is still the feed.
      var hasAnchor =
        site === 'douyin'
          ? !!(W.one('#douyin-right-container') && (W.one('#slidelist') || W.one('[data-e2e="slideList"]') || W.one('[data-e2e="feed-active-video"]')))
          : !!W.one('main')
      if (hasAnchor && (W.all('video').length > 0 || now() - W.routeSince > 3000)) return 'feed'
      return now() - W.routeSince < 8000 ? 'loading' : 'unknown'
    }

    // ---- acting on the page ----------------------------------------------

    W.act = function (id: string, arg?: string): void {
      W.actN += 1
      W.acts.push(arg === undefined ? { n: W.actN, id: id } : { n: W.actN, id: id, arg: arg })
    }

    W.ours = function (): void {
      W.oursUntil = now() + 400
    }

    W.pauseAll = function (): void {
      var list = W.all('video')
      for (var i = 0; i < list.length; i++) {
        if (!list[i].paused) {
          W.ours()
          try {
            list[i].pause()
          } catch (e) {}
        }
      }
    }

    /** C-13: silence before pausing, so nothing leaks from a clip (or a live stream) that will not stop at once. */
    W.silence = function (): void {
      var list = W.all('video')
      for (var i = 0; i < list.length; i++) {
        if (!list[i].muted) {
          W.ours()
          list[i].muted = true
          W.silenced.push(list[i])
        }
      }
    }

    W.unsilence = function (): void {
      for (var i = 0; i < W.silenced.length; i++) {
        W.ours()
        try {
          W.silenced[i].muted = false
        } catch (e) {}
      }
      W.silenced = []
    }

    W.play = function (v: any): void {
      if (!v || !v.paused) return
      W.ours()
      try {
        var p = v.play()
        if (p && p.catch) {
          p.catch(function (err: any) {
            // S-7: the browser will not start it without a click. Say so instead of trying in silence.
            if (err && err.name === 'NotAllowedError') W.blocked = true
          })
        }
      } catch (e) {}
    }

    W.setCss = function (on: boolean): void {
      var style = doc.getElementById ? doc.getElementById('worknt-css') : null
      if (on) {
        if (!style) {
          style = doc.createElement('style')
          style.id = 'worknt-css'
          ;(doc.head || doc.documentElement).appendChild(style)
        }
        if (style.textContent !== W.cfg.css) style.textContent = W.cfg.css
      } else if (style && style.parentNode) {
        style.parentNode.removeChild(style)
      }
      if (on !== W.cssOn) {
        W.cssOn = on
        try {
          win.dispatchEvent(new win.Event('resize'))
        } catch (e) {}
      }
    }

    // ---- drawing -----------------------------------------------------------

    W.clear = function (): void {
      if (W.host && W.host.parentNode) W.host.parentNode.removeChild(W.host)
      W.host = null
      W.root = null
    }

    W.el = function (tag: string, css: string, text: string | null): any {
      var e = doc.createElement(tag)
      e.style.cssText = css
      if (text !== null && text !== undefined) e.textContent = text
      return e
    }

    W.isDark = function (): boolean {
      if (W.cfg.isDark === true || W.cfg.isDark === false) return W.cfg.isDark
      return !!(win.matchMedia && win.matchMedia('(prefers-color-scheme: dark)').matches)
    }

    W.primary = function (): void {
      if (W.idleAsk) {
        W.idleAsk = false
        W.lastInput = now()
        W.act('stay')
      } else {
        W.act('back')
      }
    }

    W.secondary = function (): void {
      if (W.idleAsk) {
        W.act('back')
        return
      }
      var card = W.want.card
      if (!card || !card.secondary) return
      var v = W.cur()
      W.moreCount += 1
      W.more = { key: W.key(v), lastT: v ? v.currentTime || 0 : 0, at: now(), isLive: W.isLive(v) }
      W.userPaused = false
      W.act('more')
    }

    W.draw = function (): void {
      var t = now()
      var want = W.want
      var showCard = W.view.card
      var locked = showCard || W.idleAsk
      var toast = want.toast && W.toastId === want.toast.id && t < W.toastUntil ? want.toast : null
      var note = !locked ? want.note : null
      var menu = !locked && W.view.live ? W.cfg.menu : null
      if (!menu) W.menuOpen = false
      var cue = !locked && W.view.cue
      // T-1: the menu's button keeps out of the picture until the pointer moves, as a player's controls do.
      var gear = !!menu && (W.menuOpen || t - W.lastMove < 2500 || t - W.gearSince < 4000)
      var dark = W.isDark()
      var picks = ''
      if (menu && W.menuOpen) for (var m = 0; m < menu.rows.length; m++) picks += W.chosen(menu.rows[m].id, menu.rows[m].value) + ','
      var sig = [
        showCard && want.card ? 'c:' + want.card.id + ':' + W.moreCount : '',
        W.idleAsk ? 'idle' : '',
        note ? 'n:' + note.id : '',
        toast ? 't:' + toast.id : '',
        gear ? 'g' : '',
        menu && W.menuOpen ? 'm:' + picks : '',
        cue ? 'p' : '',
        dark ? 'd' : 'l',
      ].join('|')
      if (sig === W.drawn) return
      // Never rebuild under a finger: a button replaced between press and release gets no click.
      if (W.pressing && W.host) return
      W.drawn = sig
      W.clear()
      if (!locked && !note && !toast && !gear && !cue) return

      var fg = dark ? '#f1efe8' : '#2c2c2a'
      var dim = dark ? '#b4b2a9' : '#5f5e5a'
      var bg = dark ? '#2c2c2a' : '#ffffff'
      var line = dark ? 'rgba(255,255,255,.14)' : 'rgba(0,0,0,.12)'
      var font = 'font-family:-apple-system,BlinkMacSystemFont,"Segoe UI","PingFang SC","Microsoft YaHei",sans-serif;'

      var host = doc.createElement('div')
      host.id = 'worknt-host'
      host.style.cssText =
        'all:initial;position:fixed;inset:0;z-index:2147483647;display:flex;flex-direction:column;pointer-events:' +
        (locked ? 'auto;background:rgba(0,0,0,.6);justify-content:flex-end;' : 'none;background:transparent;justify-content:space-between;')
      var root = host.attachShadow ? host.attachShadow({ mode: 'closed' }) : host
      host.addEventListener('pointerdown', function () {
        W.pressing = true
      })
      doc.documentElement.appendChild(host)
      W.host = host
      W.root = root

      if (toast && !locked) {
        root.appendChild(
          W.el(
            'div',
            font + 'align-self:center;margin:12px 52px;padding:8px 12px;border-radius:8px;font-size:13px;line-height:1.4;background:rgba(0,0,0,.78);color:#fff;',
            toast.text,
          ),
        )
      } else if (!locked) {
        root.appendChild(W.el('div', '', null))
      }

      if (locked) {
        var card = W.idleAsk ? null : want.card
        var title = W.idleAsk ? W.cfg.copy.stillThere : card.title
        var lines = W.idleAsk ? [] : W.moreCount > 0 ? [card.againLine] : card.lines
        var box = W.el('div', font + 'margin:12px;padding:16px;border-radius:12px;box-sizing:border-box;background:' + bg + ';border:0.5px solid ' + line + ';', null)
        box.appendChild(W.el('div', 'font-size:15px;font-weight:500;line-height:1.4;color:' + fg + ';', title))
        for (var i = 0; i < lines.length; i++) {
          box.appendChild(W.el('div', 'font-size:13px;line-height:1.5;margin-top:2px;color:' + dim + ';', lines[i]))
        }
        var row = W.el('div', 'display:flex;gap:8px;margin-top:14px;', null)
        var btn = font + 'flex:1;height:36px;border-radius:8px;font-size:13px;cursor:pointer;padding:0 10px;'
        var firstLabel = W.idleAsk ? W.cfg.copy.stay : card.primary.label
        var first = W.el('button', btn + 'border:0;background:' + fg + ';color:' + bg + ';', firstLabel)
        first.addEventListener('click', function () {
          W.primary()
          W.step()
        })
        row.appendChild(first)
        var secondLabel = W.idleAsk
          ? W.cfg.copy.back
          : card.secondary
            ? card.moreLabels[Math.min(W.moreCount, card.moreLabels.length - 1)] || card.secondary.label
            : null
        if (secondLabel) {
          var second = W.el('button', btn + 'background:transparent;color:' + fg + ';border:0.5px solid ' + line + ';', secondLabel)
          second.addEventListener('click', function () {
            W.secondary()
            W.step()
          })
          row.appendChild(second)
        }
        box.appendChild(row)
        root.appendChild(box)
        return
      }

      if (note) {
        var pill = W.el(
          'div',
          font +
            'pointer-events:auto;align-self:flex-start;max-width:min(360px,calc(100vw - 24px));margin:12px;padding:8px 12px;border-radius:8px;font-size:12px;line-height:1.5;background:rgba(0,0,0,.82);color:#fff;box-sizing:border-box;',
          note.text,
        )
        if (note.action) {
          var link = W.el('button', font + 'margin-left:8px;padding:0;border:0;background:transparent;color:#fff;text-decoration:underline;font-size:12px;cursor:pointer;', note.action.label)
          var actionId = note.action.id
          link.addEventListener('click', function () {
            W.act(actionId)
          })
          pill.appendChild(link)
        }
        root.appendChild(pill)
      }

      if (cue) {
        // S-7
        var start = W.el(
          'button',
          font +
            'pointer-events:auto;position:absolute;left:50%;top:50%;transform:translate(-50%,-50%);height:44px;padding:0 20px;border:0;border-radius:22px;font-size:15px;cursor:pointer;background:rgba(0,0,0,.72);color:#fff;',
          W.cfg.copy.tapToPlay,
        )
        start.addEventListener('click', function () {
          W.blocked = false
          W.userPaused = false
          W.play(W.cur())
          W.step()
        })
        root.appendChild(start)
      }

      if (gear && menu) {
        if (W.menuOpen) {
          // Anything outside the menu closes it, and the click goes no further: it must not pause the clip.
          var shade = W.el('div', 'pointer-events:auto;position:absolute;inset:0;background:transparent;', null)
          shade.addEventListener('click', function (e: any) {
            if (e && e.stopPropagation) e.stopPropagation()
            W.menuOpen = false
            W.draw()
          })
          root.appendChild(shade)
        }
        var dots = W.el(
          'button',
          font +
            'pointer-events:auto;position:absolute;right:12px;top:12px;width:28px;height:28px;padding:0;border:0;border-radius:14px;font-size:16px;line-height:28px;text-align:center;cursor:pointer;background:rgba(0,0,0,.45);color:#fff;',
          '⋯',
        )
        dots.addEventListener('click', function () {
          W.menuOpen = !W.menuOpen
          W.lastMove = now()
          W.draw()
        })
        root.appendChild(dots)
        if (W.menuOpen) {
          var sheet = W.el(
            'div',
            font +
              'pointer-events:auto;position:absolute;right:12px;top:48px;width:208px;padding:12px;border-radius:12px;box-sizing:border-box;background:' + bg + ';border:0.5px solid ' + line + ';',
            null,
          )
          var pickCss = font + 'flex:1;height:30px;border-radius:8px;font-size:12px;cursor:pointer;padding:0 6px;'
          for (var r = 0; r < menu.rows.length; r++) {
            var one = menu.rows[r]
            sheet.appendChild(W.el('div', 'font-size:12px;line-height:1.4;margin:' + (r === 0 ? '0' : '10px') + ' 0 6px;color:' + dim + ';', one.label))
            var opts = W.el('div', 'display:flex;gap:6px;', null)
            var current = W.chosen(one.id, one.value)
            for (var o = 0; o < one.options.length; o++) {
              var opt = one.options[o]
              var isOn = opt.value === current
              var b = W.el(
                'button',
                pickCss + (isOn ? 'border:0;background:' + fg + ';color:' + bg + ';' : 'background:transparent;color:' + fg + ';border:0.5px solid ' + line + ';'),
                opt.label,
              )
              b.addEventListener('click', W.picker(one.id, opt.value, current))
              opts.appendChild(b)
            }
            sheet.appendChild(opts)
          }
          var leave = W.el(
            'button',
            font + 'width:100%;height:30px;margin-top:12px;border-radius:8px;font-size:12px;cursor:pointer;background:transparent;color:' + fg + ';border:0.5px solid ' + line + ';',
            menu.back,
          )
          leave.addEventListener('click', function () {
            W.menuOpen = false
            W.act('back')
            W.draw()
          })
          sheet.appendChild(leave)
          root.appendChild(sheet)
        }
      }
    }

    /** A choice on the menu: shown at once, done at once where the page can do it, and reported for the mod to keep. */
    W.picker = function (id: string, value: string, current: string): any {
      return function (): void {
        if (value === current) return
        W.pick[id] = value
        W.act('set', id + ' ' + value)
        if (id === 'sound') W.applySound()
        W.draw()
      }
    }

    // ---- the page's own half-second reconciliation ------------------------

    W.step = function (): void {
      var t = now()
      var dt = Math.max(0, Math.min(1500, t - W.lastTick))
      W.lastTick = t
      W.steps += 1

      if (win.requestAnimationFrame && t - W.framesAt >= 1000) {
        W.framesOk = W.frames / ((t - W.framesAt) / 1000) >= 8
        W.frames = 0
        W.framesAt = t
      }

      // R-9: locked or held, and the mod has gone silent: let go by ourselves.
      var mode = W.want.mode
      if (!W.lost && (W.locked || mode === 'hold') && t - W.lastSync > 30000) {
        W.lost = true
        W.more = null
        W.idleAsk = false
        W.want = { mode: 'rest', hold: false, card: null, note: { id: 'lost', text: W.cfg.copy.lost, action: null }, toast: null }
        W.pauseOnce = true
        mode = 'rest'
      }

      var health = W.detect()
      W.health = health
      var isFeed = health === 'feed'
      // Principle 3 and W-5: off the feed, the site is left exactly as it is.
      W.setCss(isFeed && (mode === 'hold' || mode === 'play' || mode === 'card' || mode === 'paused'))

      var v = W.cur()

      if (W.more && v) {
        var key = W.key(v)
        if (key !== W.more.key) {
          W.more.key = key
          W.more.lastT = v.currentTime || 0
          W.more.isLive = W.isLive(v)
        } else if (v.ended || (v.currentTime || 0) + 0.75 < W.more.lastT || t - W.more.at > (W.more.isLive ? 60000 : 300000)) {
          W.more = null
        } else {
          W.more.lastT = v.currentTime || 0
        }
      }
      if (mode !== 'card') W.more = null

      var isRunning = isFeed && (mode === 'play' || (mode === 'card' && !!W.more))
      if (isRunning && mode === 'play' && !W.idleAsk && v && !v.paused && t - W.lastInput > W.cfg.idleMs) {
        W.idleAsk = true // W-3
      }
      if (mode !== 'play') W.idleAsk = false

      var showCard = isFeed && mode === 'card' && !W.more && !!W.want.card
      var locked = showCard || W.idleAsk
      var shouldPlay = isRunning && !W.idleAsk && !W.want.hold && W.framesOk

      if (locked) {
        if (!W.locked && doc.fullscreenElement && doc.exitFullscreen) {
          try {
            doc.exitFullscreen() // C-11
          } catch (e) {}
        }
        W.silence()
        W.pauseAll()
      } else if (mode === 'hold') {
        W.silence()
        W.pauseAll()
      } else {
        if (W.silenced.length > 0) W.unsilence()
        if (W.pauseOnce) {
          W.pauseAll()
        } else if (shouldPlay) {
          if (W.isMuted() && !W.volTouched && v && !v.muted) {
            W.ours()
            v.muted = true
          }
          if (v && v.paused && !W.userPaused) W.play(v)
        } else if (isRunning) {
          W.pauseAll() // W-2: not on screen
        }
      }
      W.pauseOnce = false
      if (!shouldPlay || (v && !v.paused)) W.blocked = false

      // A live stream in the feed, when the person has asked not to see them: say so, once per look, and let the mod press the key.
      var liveBy = isFeed ? W.liveSlide(v) : ''
      var isLiveNow = liveBy !== ''
      if (isLiveNow && shouldPlay && mode === 'play' && W.skipsLive()) {
        if (!W.liveSince) W.liveSince = t
        else if (t - W.liveSince >= 1000 && t - W.skipAt >= 2500 && W.skips < 8) {
          W.skipAt = t
          W.skips += 1
          W.act('skip', liveBy)
        }
      } else {
        W.liveSince = 0
        if (isFeed && !isLiveNow && v && t - W.skipAt > 4000) W.skips = 0
      }

      if (locked !== W.locked) {
        W.locked = locked
        W.listen(locked)
      }

      // Why the clock is not running, when it is not: for the self-check.
      W.why = !isFeed ? 'not-feed' : mode !== 'play' && !W.more ? 'mode-' + mode : W.idleAsk ? 'idle-ask' : W.want.hold ? 'held' : !W.framesOk ? 'unpainted' : !v ? 'no-video' : v.paused ? (W.userPaused ? 'paused-by-person' : 'paused') : v.ended ? 'ended' : ''

      // W-10: only what was really on screen and really playing counts.
      if (isRunning && shouldPlay && v && !v.paused && !v.ended) {
        W.watchMs += dt
        var k = v.readyState >= 2 ? W.key(v) : null
        if (k !== W.dwellKey) {
          W.dwellKey = k
          W.dwellMs = 0
        } else if (k) {
          W.dwellMs += dt
        }
        if (k && W.dwellMs >= 1500 && !W.seen[k]) {
          W.seen[k] = 1
          W.videos += 1
        }
      }

      if (W.want.toast && W.want.toast.id !== W.toastId) {
        W.toastId = W.want.toast.id
        W.toastUntil = t + 5000
      }
      W.view = { card: showCard, live: isFeed && (mode === 'play' || mode === 'paused'), cue: shouldPlay && W.blocked && !!v && v.paused }
      W.draw()
    }

    /** The timer's step. A fault in it must not pass unseen: it is kept, and told to the mod with everything else (D-4). */
    W.beat = function (): void {
      try {
        W.step()
      } catch (e) {
        W.err = String((e && (e as any).message) || e).slice(0, 200)
      }
    }

    // ---- listeners ---------------------------------------------------------

    /** C-8: while a card is up, nothing but the card answers. C-12: Enter and Space press its buttons. */
    W.block = function (e: any): void {
      if (!W.locked) return
      if (W.host && e.composedPath && e.composedPath().indexOf(W.host) !== -1) return
      if (e.type === 'keydown' && !e.repeat) {
        if (e.key === 'Enter') {
          W.primary()
          W.step()
        } else if (e.key === ' ' || e.key === 'Spacebar') {
          W.secondary()
          W.step()
        }
      }
      if (e.stopImmediatePropagation) e.stopImmediatePropagation()
      if (e.cancelable && e.preventDefault) e.preventDefault()
    }

    var BLOCKED = ['keydown', 'keyup', 'keypress', 'wheel', 'touchmove', 'pointerdown', 'mousedown', 'click']
    // Non-passive listeners cost the page its smooth scrolling, so they exist only while a card is up.
    W.listen = function (on: boolean): void {
      for (var i = 0; i < BLOCKED.length; i++) {
        if (on) win.addEventListener(BLOCKED[i], W.block, { capture: true, passive: false })
        else win.removeEventListener(BLOCKED[i], W.block, { capture: true })
      }
    }

    W.touched = function (e: any): void {
      var t = now()
      W.lastInput = t
      if (e && (e.type === 'pointerup' || e.type === 'pointercancel')) W.pressing = false
      if (e && e.type === 'mousemove') {
        var wasOut = t - W.lastMove >= 2500
        W.lastMove = t
        if (wasOut && W.view.live) W.draw()
      }
    }

    W.media = function (e: any): void {
      var isOurs = now() <= W.oursUntil
      if (e.type === 'volumechange') {
        if (!isOurs) W.volTouched = true
        return
      }
      if (W.locked || W.want.mode === 'hold') {
        if (e.type === 'play') W.pauseAll()
        return
      }
      if (isOurs) return
      // W-4: a pause of the person's own is theirs to undo.
      if (e.type === 'pause' && (W.want.mode === 'play' || W.more)) W.userPaused = true
      if (e.type === 'play') {
        W.userPaused = false
        W.blocked = false
      }
    }

    var TOUCH = ['pointerdown', 'pointerup', 'pointercancel', 'keydown', 'wheel', 'touchstart', 'mousemove']
    var MEDIA = ['play', 'pause', 'volumechange']

    W.frame = function (): void {
      W.frames += 1
      if (W.armed) W.raf = win.requestAnimationFrame(W.frame)
    }

    W.arm = function (): void {
      if (W.armed) return
      W.armed = true
      for (var i = 0; i < TOUCH.length; i++) win.addEventListener(TOUCH[i], W.touched, { capture: true, passive: true })
      for (var j = 0; j < MEDIA.length; j++) doc.addEventListener(MEDIA[j], W.media, true)
      W.timer = win.setInterval(W.beat, 500)
      W.frames = 0
      W.framesAt = now()
      W.framesOk = true
      if (win.requestAnimationFrame) W.raf = win.requestAnimationFrame(W.frame)
    }

    /** R-3, R-4: leave nothing running on a page we are done with. */
    W.disarm = function (): void {
      if (!W.armed) return
      W.armed = false
      for (var i = 0; i < TOUCH.length; i++) win.removeEventListener(TOUCH[i], W.touched, { capture: true })
      for (var j = 0; j < MEDIA.length; j++) doc.removeEventListener(MEDIA[j], W.media, true)
      win.clearInterval(W.timer)
      if (win.cancelAnimationFrame) win.cancelAnimationFrame(W.raf)
      W.pressing = false
      if (W.locked) {
        W.locked = false
        W.listen(false)
      }
    }

    W.dispose = function (): void {
      W.disarm()
      W.unsilence()
      W.setCss(false)
      W.clear()
    }

    W.stats = function (): any {
      var v = W.cur()
      return {
        v: W.v,
        load: W.load,
        mode: W.want.mode,
        health: W.health,
        url: String(win.location.href),
        playing: !!(v && !v.paused && !v.ended),
        framesOk: W.framesOk,
        inputAgo: Math.max(0, now() - W.lastInput),
        videos: W.videos,
        watchMs: W.watchMs,
        live: W.health === 'feed' && W.liveSlide(v) !== '',
        cardId: W.want.card ? W.want.card.id : null,
        more: !!W.more,
        idleAsk: W.idleAsk,
        acts: W.acts.slice(),
        lost: W.lost,
        err: W.err || null,
        steps: W.steps,
        why: W.why,
      }
    }
  }

  var old = W.cfg
  var wasMuted = W.isMuted()
  W.cfg = cfg
  W.lastSync = now()
  if (old !== cfg) {
    // The mod's word on a setting has arrived: a choice made on the menu no longer stands in for it.
    if (JSON.stringify(old.menu) !== JSON.stringify(cfg.menu)) W.pick = {}
    if (W.isMuted() !== wasMuted) W.applySound()
  }

  if (cmd && typeof cmd.ack === 'number') {
    var kept = []
    for (var a = 0; a < W.acts.length; a++) if (W.acts[a].n > cmd.ack) kept.push(W.acts[a])
    W.acts = kept
  }

  if (cmd && cmd.want) {
    var prev = W.want
    var next = cmd.want
    W.lost = false
    if (prev.mode === 'rest' && next.mode !== 'rest') {
      // A new break on a page kept from the last one: nothing of that one is carried over, least of all its counts.
      W.load = now()
      W.videos = 0
      W.watchMs = 0
      W.seen = {}
      W.dwellKey = null
      W.dwellMs = 0
      W.acts = []
      W.pick = {}
      W.menuOpen = false
      W.blocked = false
      W.volTouched = false
      W.skips = 0
    }
    if (!prev.card || !next.card || prev.card.id !== next.card.id) {
      W.more = null
      W.moreCount = 0
    }
    if (next.mode === 'play' && prev.mode !== 'play') {
      W.userPaused = false
      W.idleAsk = false
      W.lastInput = now()
      W.gearSince = now()
    }
    if ((next.mode === 'paused' || next.mode === 'rest') && prev.mode !== next.mode) W.pauseOnce = true
    W.want = next
    if (next.mode === 'rest') {
      W.step()
      W.disarm()
      W.acts = []
    } else {
      W.arm()
      W.step()
    }
  } else if (W.armed) {
    W.step()
  }

  return W.stats()
}
/* eslint-enable */

const SOURCE = String(pageMain)

/** The script that makes the page match `want` and answers its state. */
export function syncScript(config: PageConfig, command: PageCommand): string {
  return `(${SOURCE})({ window: window, document: document }, ${JSON.stringify(config)}, ${JSON.stringify(command)})`
}

/**
 * The cheap question asked every tick: it sends no library, only reads what
 * the one already on the page knows. Answers `{ missing: true }` on a page
 * that has none (it reloaded, or was never set up).
 */
export function statsScript(ack: number): string {
  return `(function (v, ack) { var W = window.__worknt; if (!W || W.v !== v || !W.stats) return { missing: true }; W.lastSync = Date.now(); if (W.acts.length > 0) { W.acts = W.acts.filter(function (a) { return a.n > ack; }); } return W.stats(); })(${PAGE_VERSION}, ${Math.max(0, Math.floor(ack))})`
}

/** S-8: a transparent button of our own over the page, for the one real click that hands the keyboard to the page. */
export const FOCUS_LABEL = 'worknt-focus-target'

export function focusTargetScript(isOn: boolean): string {
  return isOn
    ? `(function () { var old = document.getElementById('worknt-focus'); if (old) old.remove(); var b = document.createElement('button'); b.id = 'worknt-focus'; b.textContent = ${JSON.stringify(FOCUS_LABEL)}; b.style.cssText = 'position:fixed;inset:0;z-index:2147483646;background:transparent;color:transparent;border:0;cursor:default;'; b.addEventListener('click', function (e) { e.stopPropagation(); e.preventDefault(); }, true); document.body.appendChild(b); return { ok: true }; })()`
    : `(function () { var b = document.getElementById('worknt-focus'); if (b) b.remove(); return { ok: true, hasFocus: document.hasFocus() }; })()`
}

export function isPageStats(value: unknown): value is PageStats {
  return typeof value === 'object' && value !== null && typeof (value as { load?: unknown }).load === 'number' && typeof (value as { health?: unknown }).health === 'string'
}
