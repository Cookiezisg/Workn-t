import { expect, test } from 'claude-code/testing'

import { PAGE_VERSION, pageMain, statsScript, syncScript } from './page'
import type { PageConfig, PageMenu } from './page'
import { SITES } from './sites'
import type { Card, PageStats, PageWant, SiteId } from './types'

/**
 * `pageMain` runs here against a made-up page: just enough of a window and a
 * document for it to read its markers, drive its videos and draw. Time moves
 * only when a test moves it.
 */

/* eslint-disable @typescript-eslint/no-explicit-any */

type Video = {
  paused: boolean
  ended: boolean
  muted: boolean
  currentTime: number
  duration: number
  readyState: number
  videoWidth: number
  videoHeight: number
  currentSrc: string
  play: () => void
  pause: () => void
  getBoundingClientRect: () => { left: number; top: number; right: number; bottom: number }
}

const makeVideo = (src: string, duration = 15): Video => {
  const v: Video = {
    paused: true, ended: false, muted: false, currentTime: 0, duration, readyState: 4, videoWidth: 720, videoHeight: 1280, currentSrc: src,
    play: () => { v.paused = false },
    pause: () => { v.paused = true },
    getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 800 }),
  }
  return v
}

function makePage(site: SiteId) {
  let t = 1_000_000
  let intervalsCleared = 0
  let fullscreenExits = 0
  const winListeners: Record<string, any[]> = {}
  const docListeners: Record<string, any[]> = {}
  const selectors: Record<string, any[]> = {}
  const videos: Video[] = []

  const makeEl = (tag: string): any => {
    const el: any = {
      tagName: tag.toUpperCase(), id: '', style: { cssText: '' }, children: [] as any[], listeners: {} as Record<string, any[]>, textContent: '', parentNode: null, shadow: null,
      appendChild(child: any) { child.parentNode = el; el.children.push(child); return child },
      removeChild(child: any) { el.children = el.children.filter((one: any) => one !== child); child.parentNode = null },
      addEventListener(type: string, fn: any) { (el.listeners[type] ??= []).push(fn) },
      attachShadow() { el.shadow = makeEl('#shadow'); return el.shadow },
      click() { for (const fn of el.listeners.click ?? []) fn({}) },
    }
    return el
  }
  const head = makeEl('head')
  const documentElement = makeEl('html')
  const location = { hostname: '', pathname: '/', search: '', href: '' }
  const go = (url: string): void => {
    const m = /^https:\/\/([^/]+)([^?]*)(\?.*)?$/.exec(url)
    location.hostname = m?.[1] ?? ''
    location.pathname = m?.[2] || '/'
    location.search = m?.[3] ?? ''
    location.href = url
  }
  const doc: any = {
    readyState: 'complete', head, documentElement, fullscreenElement: null,
    exitFullscreen() { doc.fullscreenElement = null; fullscreenExits += 1 },
    querySelectorAll: (selector: string) => (selector === 'video' ? videos : (selectors[selector] ?? [])),
    getElementById: (id: string) => [...head.children, ...documentElement.children].find((el: any) => el.id === id) ?? null,
    createElement: makeEl,
    addEventListener(type: string, fn: any) { (docListeners[type] ??= []).push(fn) },
    removeEventListener(type: string, fn: any) { docListeners[type] = (docListeners[type] ?? []).filter(one => one !== fn) },
  }
  const win: any = {
    location, innerWidth: 400, innerHeight: 800,
    addEventListener(type: string, fn: any) { (winListeners[type] ??= []).push(fn) },
    removeEventListener(type: string, fn: any) { winListeners[type] = (winListeners[type] ?? []).filter(one => one !== fn) },
    setInterval: () => 7,
    clearInterval: () => { intervalsCleared += 1 },
    dispatchEvent: () => true,
    Event: class {},
    matchMedia: () => ({ matches: false }),
  }
  const env = { window: win, document: doc, now: () => t }

  const cfg: PageConfig = {
    v: PAGE_VERSION, site, css: SITES[site].css, isDark: null, isMuted: false, idleMs: 5 * 60_000,
    skipLive: false,
    copy: { stillThere: '还在吗？', stay: '在', back: '回去看看', lost: 'Workn’t 断开了。', tapToPlay: '点一下开始' },
    // Most tests are about what the page does unasked, so they run without the menu; the menu's own tests put it in.
    menu: null,
  }

  const feedUrl = site === 'douyin' ? 'https://www.douyin.com/?recommend=1' : 'https://www.tiktok.com/foryou'
  const makeFeed = (): void => {
    go(feedUrl)
    if (site === 'douyin') {
      selectors['#douyin-right-container'] = [{}]
      selectors['[data-e2e="feed-active-video"]'] = [{ classList: ['slide', 'video_1'] }]
    } else {
      selectors.main = [{}]
    }
  }

  const texts = (el: any): string[] => (el ? [...(el.textContent ? [el.textContent] : []), ...el.children.flatMap(texts)] : [])
  const find = (el: any, label: string): any => {
    if (!el) return null
    if (el.tagName === 'BUTTON' && el.textContent === label) return el
    for (const child of el.children) {
      const hit = find(child, label)
      if (hit) return hit
    }
    return null
  }
  const host = (): any => documentElement.children.find((el: any) => el.id === 'worknt-host') ?? null

  return {
    win, doc, videos, selectors, location, cfg, go, makeFeed,
    sync: (want: PageWant, ack = 0, patch: Partial<PageConfig> = {}): PageStats => pageMain(env, { ...cfg, ...patch }, { want, ack }),
    ask: (): PageStats => pageMain(env, cfg, { want: null, ack: 0 }),
    /** Lets `ms` pass, the page's own half-second step running as it would. */
    run(ms: number): void {
      for (let left = ms; left > 0; left -= 500) {
        t += Math.min(500, left)
        win.__worknt.step()
      }
    },
    /** Lets `ms` pass with the mod asking every two seconds, as it does while a break is on. */
    live(ms: number): void {
      for (let left = ms; left > 0; left -= 2000) {
        this.run(Math.min(2000, left))
        pageMain(env, cfg, { want: null, ack: 0 })
      }
    },
    /** Lets time pass with nothing running: the mod has gone quiet and so has the page's timer. */
    skip(ms: number): void { t += ms },
    step: (): void => win.__worknt.step(),
    drawn: (): string[] => texts(host()?.shadow),
    hasHost: (): boolean => host() !== null,
    press: (label: string): void => find(host()?.shadow, label)?.click(),
    hasCss: (): boolean => head.children.some((el: any) => el.id === 'worknt-css' && el.textContent === SITES[site].css),
    key(type: string, key: string): { wasStopped: boolean } {
      let wasStopped = false
      const event = { type, key, repeat: false, cancelable: true, composedPath: () => [], stopImmediatePropagation: () => { wasStopped = true }, preventDefault: () => {} }
      for (const fn of [...(winListeners[type] ?? [])]) fn(event)
      return { wasStopped }
    },
    media(type: string, target?: unknown): void { for (const fn of [...(docListeners[type] ?? [])]) fn(target === undefined ? { type } : { type, target }) },
    touch(): void { for (const fn of [...(winListeners.pointerdown ?? [])]) fn({ type: 'pointerdown', composedPath: () => [] }) },
    up(): void { for (const fn of [...(winListeners.pointerup ?? [])]) fn({ type: 'pointerup', composedPath: () => [] }) },
    hostEl: (): any => host(),
    hostDown(): void { for (const fn of host()?.listeners.pointerdown ?? []) fn({ type: 'pointerdown' }) },
    move(): void { for (const fn of [...(winListeners.mousemove ?? [])]) fn({ type: 'mousemove', composedPath: () => [] }) },
    counts: () => ({ intervalsCleared, fullscreenExits, winListeners: Object.values(winListeners).flat().length, docListeners: Object.values(docListeners).flat().length }),
    state: (): any => win.__worknt,
  }
}

const menuOf = (sound: 'on' | 'off', live: 'show' | 'skip'): PageMenu => ({
  rows: [
    { id: 'sound', label: '声音', value: sound, options: [{ value: 'on', label: '有声' }, { value: 'off', label: '静音' }] },
    { id: 'live', label: '直播', value: live, options: [{ value: 'show', label: '照常' }, { value: 'skip', label: '划走' }] },
  ],
  back: '回去看看',
})

const want = (mode: PageWant['mode'], patch: Partial<PageWant> = {}): PageWant => ({ mode, hold: false, card: null, note: null, toast: null, ...patch })

const CARD: Card = {
  id: 'd:a:1', title: 'Claude 跑完了', lines: ['用时 2:14', '你刷了 5 条，2:05'],
  primary: { id: 'back', label: '回去看看' }, secondary: { id: 'more', label: '再看一条' },
  moreLabels: ['再看一条', '真的最后一条'], freeLabel: '你别管我了', againLine: '这条看完了。', againMany: '这条也看完了。已经多看 {n} 条了。',
}

const feed = (site: SiteId = 'douyin') => {
  const page = makePage(site)
  page.makeFeed()
  const video = makeVideo('https://v.example/clip-1.mp4')
  page.videos.push(video)
  return { page, video }
}

// ---- shipping --------------------------------------------------------------------

test('the page library travels as plain JavaScript: no types left in it, nothing borrowed from outside', () => {
  const script = syncScript(makePage('douyin').cfg, { want: want('play'), ack: 0 })
  expect(script.startsWith('(function pageMain(')).toBe(true)
  expect(script).not.toContain(': any')
  expect(script).toContain('W.detect')
  expect(script).not.toContain('SITES')
  expect(statsScript(3)).toContain(`(${PAGE_VERSION}, 3)`)
})

// ---- section 3: what the page is ---------------------------------------------------

test('section 3: the feed, signed in, is "feed"', () => {
  const { page } = feed()
  expect(page.sync(want('play')).health).toBe('feed')
})

test('section 3, L-1: a sign-in button in the header means "login", on either site', () => {
  const douyin = feed('douyin').page
  douyin.selectors['#douyin-header button, #douyin-header a, #douyin-header span, #douyin-header p, #douyin-header div'] = [
    { children: [{}], textContent: '登录' },
    { children: [], textContent: ' 登录 ' },
  ]
  expect(douyin.sync(want('play')).health).toBe('login')

  const tiktok = feed('tiktok').page
  tiktok.selectors['#header-login-button'] = [{}]
  expect(tiktok.sync(want('play')).health).toBe('login')
})

test('section 3: a challenge counts only when it takes room on the page; the hidden one the site always keeps does not', () => {
  const { page } = feed()
  page.selectors['iframe#nocaptcha-container'] = [{ offsetHeight: 0 }]
  expect(page.sync(want('play')).health).toBe('feed')
  page.selectors['#captcha_container'] = [{ offsetHeight: 320 }]
  page.step()
  expect(page.ask().health).toBe('verify')
})

test('section 3, W-6: another route on the site is "elsewhere"; another site altogether is "left"', () => {
  const { page } = feed()
  page.sync(want('play'))
  page.go('https://www.douyin.com/user/abc')
  page.step()
  expect(page.ask().health).toBe('elsewhere')
  page.go('https://example.com/')
  page.step()
  expect(page.ask().health).toBe('left')
})

test('section 3, S-5: the feed address with nothing recognisable is "loading" at first, then "unknown"', () => {
  const page = makePage('douyin')
  page.go('https://www.douyin.com/?recommend=1')
  expect(page.sync(want('hold')).health).toBe('loading')
  page.run(9000)
  expect(page.ask().health).toBe('unknown')
})

test('section 3: a live stream in the feed is still the feed: the layout does not flip when one scrolls by', () => {
  const { page } = feed()
  page.sync(want('play'))
  expect(page.hasCss()).toBe(true)
  // The next slide is a live stream: no clip of the usual kind, and none of the markers a clip carries.
  page.videos.length = 0
  page.selectors['[data-e2e="feed-active-video"]'] = []
  page.selectors['#slidelist'] = [{}]
  page.run(20_000)
  expect(page.ask().health).toBe('feed')
  expect(page.hasCss()).toBe(true)
  expect(page.hasHost()).toBe(false)
})

// ---- principle 3 and W-5 -------------------------------------------------------------

test('S-5: on the feed the site navigation is hidden and the clip plays', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  expect(page.hasCss()).toBe(true)
  expect(video.paused).toBe(false)
})

test('W-5: the moment the person leaves the feed, the navigation is given back, with no round trip to the mod', () => {
  const { page } = feed()
  page.sync(want('play'))
  page.go('https://www.douyin.com/user/abc')
  page.run(500)
  expect(page.hasCss()).toBe(false)
})

test('principle 3: a page that is not the feed is never restyled, paused or covered, whatever was asked for', () => {
  const { page, video } = feed()
  page.selectors['#login-panel-new'] = [{}]
  video.paused = false
  page.sync(want('card', { card: CARD }))
  page.run(2000)
  expect(page.hasCss()).toBe(false)
  expect(video.paused).toBe(false)
  expect(page.hasHost()).toBe(false)
  expect(page.key('keydown', 'ArrowDown').wasStopped).toBe(false)
})

// ---- section 7: the card ---------------------------------------------------------------

test('C-8: a card pauses and silences the clip, shows its text, and nothing else on the page answers', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.sync(want('card', { card: CARD }))
  expect(video.paused).toBe(true)
  expect(video.muted).toBe(true)
  expect(page.drawn()).toEqual(['Claude 跑完了', '用时 2:14', '你刷了 5 条，2:05', '回去看看', '再看一条'])
  expect(page.key('keydown', 'ArrowDown').wasStopped).toBe(true)
  expect(page.key('wheel', '').wasStopped).toBe(true)
})

test('C-8: the site trying to start the clip again under a card is stopped at once', () => {
  const { page, video } = feed()
  page.sync(want('card', { card: CARD }))
  video.paused = false
  page.media('play')
  expect(video.paused).toBe(true)
})

test('C-9: the first button reports "back"', () => {
  const { page } = feed()
  page.sync(want('card', { card: CARD }))
  page.press('回去看看')
  expect(page.ask().acts).toEqual([{ n: 1, id: 'back' }])
})

test('C-9: "one more" plays one clip to its end, then the card is back with the next label', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.sync(want('card', { card: CARD }))
  video.currentTime = 6
  page.press('再看一条')
  expect(video.paused).toBe(false)
  expect(video.muted).toBe(false)
  expect(page.hasHost()).toBe(false)
  expect(page.key('keydown', 'ArrowDown').wasStopped).toBe(false)

  video.currentTime = 14
  page.run(500)
  expect(page.hasHost()).toBe(false)
  video.currentTime = 0.2 // it looped: the clip is over
  page.run(500)
  expect(video.paused).toBe(true)
  expect(page.drawn()).toEqual(['Claude 跑完了', '这条看完了。', '回去看看', '真的最后一条'])

  page.press('真的最后一条')
  video.currentTime = 9
  page.run(500)
  video.currentTime = 0.1
  page.run(500)
  // From the second extra clip on, the card keeps count; and the button has stopped asking for one more.
  expect(page.drawn()).toEqual(['Claude 跑完了', '这条也看完了。已经多看 2 条了。', '回去看看', '你别管我了'])
})

test('C-14: asked for one more twice, the third press sends the card away: clips play on, one after another, nothing locked', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.sync(want('card', { card: CARD }))
  for (const label of ['再看一条', '真的最后一条']) {
    page.press(label)
    video.currentTime = 9
    page.run(500)
    video.currentTime = 0.1
    page.run(500)
  }
  expect(page.drawn().at(-1)).toBe('你别管我了')
  expect(video.paused).toBe(true)

  page.press('你别管我了')
  expect(page.ask().acts.at(-1)).toEqual({ n: 3, id: 'free', arg: CARD.id })
  expect(video.paused).toBe(false)
  expect(page.hasHost()).toBe(false)
  expect(page.key('keydown', 'ArrowDown').wasStopped).toBe(false)

  // The clip ends, the next one comes, minutes pass: the mod still says "card", and the card still stays away.
  video.currentTime = 14
  page.run(500)
  video.currentTime = 0.2
  page.live(5 * 60_000 - 20_000)
  page.sync(want('card', { card: CARD }), 3)
  expect(page.hasHost()).toBe(false)
  expect(video.paused).toBe(false)
  // And the time goes on being counted.
  expect(page.ask().watchMs).toBeGreaterThan(4 * 60_000)

  // A different card is a new matter, and starts from "one more" again.
  page.sync(want('card', { card: { ...CARD, id: 'd:a:2' } }), 3)
  expect(video.paused).toBe(true)
  expect(page.drawn().at(-1)).toBe('再看一条')
})

test('C-9: swiping to the next clip during "one more" lets that clip play to its end', () => {
  const { page, video } = feed('tiktok')
  page.sync(want('card', { card: CARD }))
  video.currentTime = 10
  page.press('再看一条')
  video.currentSrc = 'https://v.example/clip-2.mp4'
  video.currentTime = 1
  page.run(500)
  expect(page.hasHost()).toBe(false)
  video.currentTime = 12
  page.run(2000)
  video.currentTime = 0.3
  page.run(500)
  expect(page.hasHost()).toBe(true)
})

test('C-9: the slide\'s name and its video changing a moment apart is one swipe, not a clip that looped', () => {
  const { page, video } = feed('douyin')
  page.sync(want('card', { card: CARD }))
  video.currentTime = 10
  page.press('再看一条')
  // The marker for the slide in view moves first; the old video is still the one on screen at ten seconds.
  page.selectors['[data-e2e="feed-active-video"]'] = [{ classList: ['slide', 'video_2'] }]
  page.run(500)
  // Then the new clip is the one on screen, a fraction of a second in.
  video.currentTime = 0.3
  page.run(500)
  expect(page.hasHost()).toBe(false)
  video.currentTime = 8
  page.run(2000)
  video.currentTime = 0.2
  page.run(500)
  expect(page.hasHost()).toBe(true)
})

test('C-9: "one more" is one more: when the site moves on by itself, clip after clip, the card is back at the second move', () => {
  const { page, video } = feed('tiktok')
  page.sync(want('card', { card: CARD }))
  page.press('再看一条')
  video.currentSrc = 'https://v.example/clip-2.mp4'
  page.run(3000)
  expect(page.hasHost()).toBe(false)
  video.currentSrc = 'https://v.example/clip-3.mp4'
  page.run(500)
  expect(page.hasHost()).toBe(true)
  expect(video.paused).toBe(true)
})

test('C-9: swiping to a clip whose length is not known yet does not cut "one more" short as if it were a live stream', () => {
  const { page, video } = feed('tiktok')
  page.sync(want('card', { card: CARD }))
  page.press('再看一条')
  page.live(70_000)
  video.currentSrc = 'https://v.example/clip-2.mp4'
  video.duration = NaN
  page.live(4000)
  video.duration = 180
  page.live(4000)
  expect(page.hasHost()).toBe(false)
})

test('C-9: the same card sent again does not cut "one more" short; a different card does', () => {
  const { page, video } = feed()
  page.sync(want('card', { card: CARD }))
  page.press('再看一条')
  page.sync(want('card', { card: CARD }))
  expect(video.paused).toBe(false)
  page.sync(want('card', { card: { ...CARD, id: 'w:b:9', title: '「重构支付」在等你点头' } }))
  expect(video.paused).toBe(true)
  expect(page.drawn()[0]).toBe('「重构支付」在等你点头')
  expect(page.drawn().at(-1)).toBe('再看一条')
})

test('C-11: a card takes the clip out of fullscreen first, so the card can be seen', () => {
  const { page } = feed()
  page.sync(want('play'))
  page.doc.fullscreenElement = {}
  page.sync(want('card', { card: CARD }))
  expect(page.counts().fullscreenExits).toBe(1)
})

test('C-12: Enter presses the first button, Space the second', () => {
  const first = feed().page
  first.sync(want('card', { card: CARD }))
  // A key already on its way as the card comes up is not an answer to it.
  first.key('keydown', 'Enter')
  expect(first.ask().acts).toEqual([])
  first.skip(700)
  first.key('keydown', 'Enter')
  expect(first.ask().acts.map(act => act.id)).toEqual(['back'])

  const { page, video } = feed()
  page.sync(want('card', { card: CARD }))
  page.skip(700)
  page.key('keydown', ' ')
  expect(page.ask().acts.map(act => act.id)).toEqual(['more'])
  expect(video.paused).toBe(false)
})

test('C-13: "one more" on a live stream, which never ends, is over after a minute', () => {
  const { page, video } = feed()
  video.duration = Infinity
  page.sync(want('card', { card: CARD }))
  page.press('再看一条')
  video.currentTime = 30
  page.run(59_000)
  expect(page.hasHost()).toBe(false)
  page.run(2000)
  expect(page.hasHost()).toBe(true)
  expect(video.paused).toBe(true)
})

test('C-3: a toast shows over the playing clip for five seconds and locks nothing', () => {
  const { page, video } = feed()
  page.sync(want('play', { toast: { id: 't:b:2', text: '「写测试」跑完了' } }))
  expect(page.drawn()).toEqual(['「写测试」跑完了'])
  expect(video.paused).toBe(false)
  expect(page.key('keydown', 'ArrowDown').wasStopped).toBe(false)
  page.run(5500)
  expect(page.hasHost()).toBe(false)
})

// ---- section 6 --------------------------------------------------------------------------

test('W-2: told the page is out of sight, the clip pauses; back in sight, it carries on', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.sync(want('play', { hold: true }))
  expect(video.paused).toBe(true)
  page.sync(want('play'))
  expect(video.paused).toBe(false)
})

test('W-2: the page stops by itself when it is no longer being painted, and resumes when it is', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.state().framesOk = false
  page.run(500)
  expect(video.paused).toBe(true)
  page.state().framesOk = true
  page.run(500)
  expect(video.paused).toBe(false)
})

test('W-4: a pause the person made is theirs; the page does not undo it', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.run(1000)
  video.pause()
  page.media('pause')
  page.run(3000)
  expect(video.paused).toBe(true)
  video.play()
  page.media('play')
  video.pause() // by the page going out of sight this time, not by the person
  page.state().framesOk = false
  page.run(500)
  page.state().framesOk = true
  page.run(500)
  expect(video.paused).toBe(false)
})

test('W-3: nobody touching the page for the set time gets "still there?"; "yes" plays on, the other button goes back', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.live(5 * 60_000 - 2000)
  expect(page.hasHost()).toBe(false)
  page.live(4000)
  expect(video.paused).toBe(true)
  expect(page.drawn()).toEqual(['还在吗？', '在', '回去看看'])
  expect(page.ask().idleAsk).toBe(true)
  page.press('在')
  expect(video.paused).toBe(false)
  expect(page.ask().acts.map(act => act.id)).toEqual(['stay'])

  page.live(5 * 60_000 + 2000)
  page.press('回去看看')
  expect(page.ask().acts.map(act => act.id)).toEqual(['stay', 'back'])
})

test('W-3: any touch counts as being there', () => {
  const { page } = feed()
  page.sync(want('play'))
  page.live(4 * 60_000)
  page.touch()
  page.live(4 * 60_000)
  expect(page.ask().idleAsk).toBe(false)
})

test('W-10: time counts only while the clip really plays in sight; a clip counts once, after a second and a half', () => {
  const { page, video } = feed('tiktok')
  page.sync(want('play'))
  page.run(1000)
  expect(page.ask().videos).toBe(0)
  page.run(1000)
  expect(page.ask().videos).toBe(1)
  page.run(8000)
  expect(page.ask().videos).toBe(1)
  expect(page.ask().watchMs).toBe(10_000)

  page.sync(want('play', { hold: true }))
  page.run(20_000)
  expect(page.ask().watchMs).toBe(10_000)

  page.sync(want('play'))
  video.currentSrc = 'https://v.example/clip-2.mp4'
  page.run(2000)
  expect(page.ask().videos).toBe(2)
  video.currentSrc = 'https://v.example/clip-1.mp4' // scrolled back to one already seen
  page.run(3000)
  expect(page.ask().videos).toBe(2)
})

test('S-6: with sound off a clip starts muted, until the person changes the volume themselves', () => {
  const { page, video } = feed()
  page.sync(want('play'), 0, { isMuted: true })
  expect(video.muted).toBe(true)
  page.run(2000)
  page.touch()
  video.muted = false
  page.media('volumechange', video)
  page.run(1000)
  expect(video.muted).toBe(false)
})

test('S-6: the site setting a new slide\'s volume is not the person changing it: with sound off the next clip is muted too, at once', () => {
  const { page, video } = feed()
  page.cfg.isMuted = true
  page.sync(want('play'))
  page.run(2000)
  // A swipe: another clip is now the one on screen, and the site's player gives it its saved volume and starts it.
  const next = makeVideo('https://v.example/clip-2.mp4')
  video.getBoundingClientRect = () => ({ left: 0, top: -800, right: 400, bottom: 0 })
  page.videos.push(next)
  page.touch()
  page.media('volumechange', next)
  next.play()
  page.media('play', next)
  expect(next.muted).toBe(true)
  page.run(2000)
  expect(next.muted).toBe(true)
})

test('C-5: "paused" pauses once and then leaves the clip to the person', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.sync(want('paused'))
  expect(video.paused).toBe(true)
  expect(page.hasHost()).toBe(false)
  video.play()
  page.run(2000)
  expect(video.paused).toBe(false)
})

test('S-4: "hold" keeps a page loaded out of sight silent and still, and draws nothing', () => {
  const { page, video } = feed()
  video.paused = false
  page.sync(want('hold', { hold: true }))
  expect(video.paused).toBe(true)
  expect(video.muted).toBe(true)
  expect(page.hasHost()).toBe(false)
  page.sync(want('play'))
  expect(video.paused).toBe(false)
  expect(video.muted).toBe(false)
})

test('W-5: a note is small, locks nothing, and its button reports what was pressed', () => {
  const { page } = feed()
  page.go('https://www.douyin.com/user/abc')
  page.sync(want('plain', { note: { id: 'elsewhere', text: '你离开了推荐流。', action: { id: 'home', label: '回到推荐' } } }))
  expect(page.drawn()).toEqual(['你离开了推荐流。', '回到推荐'])
  expect(page.key('keydown', 'ArrowDown').wasStopped).toBe(false)
  page.press('回到推荐')
  expect(page.ask().acts).toEqual([{ n: 1, id: 'home' }])
})

// ---- section 10 -----------------------------------------------------------------------

test('R-9: a card up with the mod silent for thirty seconds: the page unlocks itself and says so', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.sync(want('card', { card: CARD }))
  page.skip(31_000)
  page.step()
  expect(page.drawn()).toEqual(['Workn’t 断开了。'])
  expect(page.key('keydown', 'ArrowDown').wasStopped).toBe(false)
  expect(video.muted).toBe(false)
  expect(page.hasCss()).toBe(false)
  expect(page.ask().lost).toBe(true)
})

test('R-9: a page being asked regularly is in contact, however long the card stays up', () => {
  const { page } = feed()
  page.sync(want('card', { card: CARD }))
  for (let i = 0; i < 60; i += 1) {
    page.run(1000)
    page.ask()
  }
  expect(page.ask().lost).toBe(false)
  expect(page.drawn()[0]).toBe('Claude 跑完了')
})

test('R-3, R-4: "rest" leaves an ordinary paused page: no styling, nothing drawn, nothing listening, no timer', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.sync(want('card', { card: CARD }))
  const stats = page.sync(want('rest'))
  expect(stats.mode).toBe('rest')
  expect(video.paused).toBe(true)
  expect(video.muted).toBe(false)
  expect(page.hasCss()).toBe(false)
  expect(page.hasHost()).toBe(false)
  expect(page.counts().winListeners).toBe(0)
  expect(page.counts().docListeners).toBe(0)
  expect(page.counts().intervalsCleared).toBe(1)
  video.play()
  page.skip(60_000)
  expect(video.paused).toBe(false)
})

test('acts are reported until acknowledged, then dropped', () => {
  const { page } = feed()
  page.sync(want('card', { card: CARD }))
  page.press('再看一条')
  expect(page.ask().acts).toEqual([{ n: 1, id: 'more' }])
  expect(page.sync(want('card', { card: CARD }), 1).acts).toEqual([])
})

test('a newer page library replaces an older one cleanly', () => {
  const { page, video } = feed()
  page.sync(want('card', { card: CARD }))
  const before = page.counts().winListeners
  expect(before).toBeGreaterThan(0)
  page.sync(want('play'), 0, { v: PAGE_VERSION + 1 })
  expect(page.state().v).toBe(PAGE_VERSION + 1)
  expect(page.hasHost()).toBe(false)
  expect(video.paused).toBe(false)
  expect(page.key('keydown', 'ArrowDown').wasStopped).toBe(false)
})

// ---- a page kept from one break to the next (R-3) -------------------------------------

test('R-3, W-10: a new break on a kept page starts its counts over and carries no button press across', () => {
  const { page } = feed()
  page.sync(want('play'))
  page.run(3000)
  const first = page.sync(want('card', { card: CARD }))
  expect(first.videos).toBe(1)
  page.press('回去看看')
  expect(page.ask().acts).toEqual([{ n: 1, id: 'back' }])
  page.sync(want('rest'))

  page.skip(60_000)
  const again = page.sync(want('hold', { hold: true }))
  expect(again.videos).toBe(0)
  expect(again.watchMs).toBe(0)
  expect(again.acts).toEqual([])
  expect(again.load).not.toBe(first.load)
  // The same clip, watched again in the new break, counts in the new break.
  page.sync(want('play'))
  page.run(3000)
  expect(page.ask().videos).toBe(1)
})

// ---- T-1: the menu on the video page ---------------------------------------------------

test('T-1: the menu button shows as a clip starts, steps aside, and comes back when the pointer moves', () => {
  const { page } = feed()
  page.cfg.menu = menuOf('on', 'show')
  page.sync(want('play'))
  expect(page.drawn()).toEqual(['⋯'])
  page.run(5000)
  expect(page.hasHost()).toBe(false)
  page.move()
  expect(page.drawn()).toEqual(['⋯'])
  page.run(3000)
  expect(page.hasHost()).toBe(false)
})

test('T-1: a choice on the menu takes effect at once, is reported for the mod to keep, and locks nothing', () => {
  const { page, video } = feed()
  page.cfg.menu = menuOf('on', 'show')
  page.sync(want('play'))
  page.press('⋯')
  expect(page.drawn()).toEqual(['⋯', '声音', '有声', '静音', '直播', '照常', '划走', '回去看看'])
  expect(video.paused).toBe(false)
  expect(page.key('keydown', 'ArrowDown').wasStopped).toBe(false)

  page.press('静音')
  page.run(500)
  expect(video.muted).toBe(true)
  expect(page.ask().acts).toEqual([{ n: 1, id: 'set', arg: 'sound off' }])
  // Pressing what is already chosen is not a change.
  page.press('静音')
  expect(page.ask().acts).toHaveLength(1)

  page.press('有声')
  expect(video.muted).toBe(false)
  expect(page.ask().acts.map(act => act.arg)).toEqual(['sound off', 'sound on'])
  // The menu stays up through all of it, well past the time its button alone would have stepped aside.
  page.run(6000)
  expect(page.drawn()).toContain('回去看看')
})

test('T-1: the menu\'s last button goes back to work; a card takes the menu down', () => {
  const { page } = feed()
  page.cfg.menu = menuOf('on', 'show')
  page.sync(want('play'))
  page.press('⋯')
  page.press('回去看看')
  expect(page.ask().acts).toEqual([{ n: 1, id: 'back' }])

  page.press('⋯')
  page.sync(want('card', { card: CARD }))
  expect(page.drawn()).not.toContain('声音')
  expect(page.drawn()).toContain('Claude 跑完了')
})

test('T-1, S-6: the sound setting changed elsewhere reaches a clip already playing', () => {
  const { page, video } = feed()
  const set = (sound: 'on' | 'off'): void => {
    page.cfg.isMuted = sound === 'off'
    page.cfg.menu = menuOf(sound, 'show')
    page.sync(want('play'))
  }
  set('off')
  expect(video.muted).toBe(true)
  set('on')
  expect(video.muted).toBe(false)
  page.run(1000)
  expect(video.muted).toBe(false)
  set('off')
  page.run(500)
  expect(video.muted).toBe(true)
})

test('T-1: nothing of ours is rebuilt between a press and its release, so the click lands; a press never released does not freeze it', () => {
  const { page } = feed()
  page.cfg.menu = menuOf('on', 'show')
  page.sync(want('play'))
  page.run(4500)
  page.move()
  page.run(2000)
  const before = page.hostEl()
  page.hostDown()
  // The button's time is up while the finger is down: it stays until the finger is lifted.
  page.run(1000)
  expect(page.hostEl()).toBe(before)
  page.up()
  page.run(500)
  expect(page.hasHost()).toBe(false)

  // A press whose release never arrives (a right click does that) is forgotten after a moment.
  page.move()
  page.hostDown()
  page.run(5000)
  expect(page.hasHost()).toBe(false)
})

// ---- S-7 -----------------------------------------------------------------------------------

test('S-7: a clip the browser will not start without a click gets a button that says so, and one click starts it', async () => {
  const { page, video } = feed()
  let isAllowed = false
  video.play = () => {
    if (isAllowed) {
      video.paused = false
      return undefined
    }
    return Promise.reject({ name: 'NotAllowedError' }) as never
  }
  page.sync(want('play'))
  await Promise.resolve()
  page.run(500)
  expect(page.drawn()).toEqual(['点一下开始'])
  expect(video.paused).toBe(true)

  isAllowed = true
  page.press('点一下开始')
  expect(video.paused).toBe(false)
  page.run(500)
  expect(page.hasHost()).toBe(false)
})

// ---- live streams in the feed ---------------------------------------------------------------

test('live streams: asked to skip them, the page says so once it is sure, and never more than a few times in a row', () => {
  const { page, video } = feed()
  video.duration = Infinity
  video.currentTime = 30
  page.cfg.skipLive = true
  page.sync(want('play'))
  expect(page.ask().live).toBe(true)
  page.run(500)
  expect(page.ask().acts).toEqual([])
  page.run(1000)
  expect(page.ask().acts).toEqual([{ n: 1, id: 'skip', arg: 'length' }])
  // The key did nothing: ask again, but not in a hurry, and give up after eight.
  page.run(1500)
  expect(page.ask().acts).toHaveLength(1)
  page.run(1000)
  expect(page.ask().acts).toHaveLength(2)
  page.run(60_000)
  expect(page.ask().acts).toHaveLength(8)
})

test('live streams: a clip that comes after a skipped one starts the count again; a clip still loading is not taken for live', () => {
  const { page, video } = feed()
  video.duration = Infinity
  page.cfg.skipLive = true
  page.sync(want('play'))
  // No length yet, but it has only just begun: an ordinary clip looks the same in its first moments.
  page.run(4000)
  expect(page.ask().live).toBe(false)
  expect(page.ask().acts).toEqual([])
  video.currentTime = 30
  page.run(2000)
  expect(page.ask().acts).toHaveLength(1)

  video.duration = 15
  page.run(6000)
  expect(page.ask().live).toBe(false)
  expect(page.ask().acts).toHaveLength(1)

  video.duration = NaN
  video.readyState = 0
  page.run(6000)
  expect(page.ask().acts).toHaveLength(1)

  video.duration = Infinity
  video.readyState = 4
  page.run(2000)
  expect(page.ask().acts).toHaveLength(2)
  expect(page.ask().acts[1]?.arg).toBe('length')
})

test('live streams: left alone unless asked, and Douyin\'s own marker for a live slide is enough', () => {
  const { page, video } = feed()
  video.duration = Infinity
  page.sync(want('play'))
  page.run(10_000)
  expect(page.ask().acts).toEqual([])

  const marked = feed().page
  marked.selectors['[data-e2e="feed-live"]'] = [{ getBoundingClientRect: () => ({ left: 0, top: 0, right: 400, bottom: 800 }) }]
  marked.cfg.skipLive = true
  marked.sync(want('play'))
  marked.run(2000)
  expect(marked.ask().acts).toEqual([{ n: 1, id: 'skip', arg: 'mark' }])
  // One scrolled out of view is not the slide in view.
  const off = feed().page
  off.selectors['[data-e2e="feed-live"]'] = [{ getBoundingClientRect: () => ({ left: 0, top: 800, right: 400, bottom: 1600 }) }]
  off.cfg.skipLive = true
  off.sync(want('play'))
  off.run(5000)
  expect(off.ask().acts).toEqual([])
})

// ---- random walks over the page script ---------------------------------------------------
//
// The same idea as the walks over the whole mod: steps chosen by a seeded die, and after each
// one the things that must hold on the page whatever came before.

const dieOf = (seed: number) => {
  let s = seed >>> 0
  return (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

function pageWalk(seed: number, steps: number): void {
  const die = dieOf(seed)
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(die() * list.length)] as T
  const { page, video } = feed(pick(['douyin', 'tiktok'] as const))
  page.cfg.menu = menuOf('on', 'show')
  const second = makeVideo('https://v.example/clip-2.mp4')
  second.getBoundingClientRect = () => ({ left: 0, top: 800, right: 400, bottom: 1600 }) // the next slide, below the fold
  page.videos.push(second)
  const trail: string[] = []
  // Declared through casts: these are assigned inside the moves below, which the compiler does not follow.
  let mode = 'rest' as PageWant['mode']
  let hold = false as boolean
  let cardN = 1
  let card = null as Card | null
  let freedId = null as string | null
  let last = null as PageStats | null
  let personPaused = false as boolean

  const send = (next: PageWant['mode']): void => {
    mode = next
    hold = next === 'hold' ? true : die() < 0.2
    if (next === 'card') {
      if (card === null || die() < 0.3) card = { ...CARD, id: `d:a:${++cardN}` }
    } else card = null
    if (next === 'play') personPaused = false
    page.sync(want(next, { hold, card, toast: next === 'play' && die() < 0.3 ? { id: `t:${cardN}`, text: 'toast' } : null, note: next === 'plain' ? { id: 'elsewhere', text: 'note', action: { id: 'home', label: '回到推荐' } } : null }), last?.acts.at(-1)?.n ?? 0)
  }

  /** Time passing as it does on a real page: the timer steps only while the page is armed, and the mod asks every two seconds. */
  const pass = (ms: number): void => {
    for (let left = ms, n = 1; left > 0; left -= 500, n += 1) {
      page.skip(500)
      if (page.state().armed) page.step()
      if (n % 4 === 0) page.ask()
    }
  }

  send('rest')
  const moves: Record<string, () => void> = {
    play: () => send('play'),
    card: () => send('card'),
    hold: () => send('hold'),
    paused: () => send('paused'),
    plain: () => send('plain'),
    rest: () => send('rest'),
    time: () => pass(pick([500, 2000, 6000, 61_000, 6 * 60_000])),
    // The site starts a clip by itself, as it does when a slide changes or an ad loads.
    sitePlays: () => {
      const one = pick([video, second])
      one.play()
      page.media('play', one)
      // On the clip in view, a play the page did not ask for cannot be told from the person's own: the pause is over.
      if (one === video) personPaused = false
    },
    clipEnds: () => { video.currentTime = 0.1 },
    clipMoves: () => { video.currentTime += 5 },
    personPauses: () => {
      if (!video.paused) {
        page.skip(1000) // well clear of anything the page did itself
        video.pause()
        page.media('pause')
        personPaused = true
      }
    },
    personPlays: () => {
      if (video.paused && mode !== 'hold') {
        page.skip(1000)
        video.play()
        page.media('play')
        personPaused = false
      }
    },
    pressSomething: () => {
      const labels = page.drawn().filter(text => ['回去看看', '再看一条', '真的最后一条', '你别管我了', '在', '⋯', '静音', '有声', '划走', '照常', '回到推荐', '点一下开始'].includes(text))
      if (labels.length === 0) return
      const label = pick(labels)
      if (label === '你别管我了') freedId = card?.id ?? null
      page.press(label)
    },
    enter: () => { page.key('keydown', 'Enter') },
    pointer: () => page.move(),
    elsewhere: () => page.go(pick(['https://www.douyin.com/user/abc', 'https://www.douyin.com/?recommend=1', 'https://www.tiktok.com/foryou', 'https://www.tiktok.com/@a/video/1'])),
    liveSlide: () => { video.duration = pick([Infinity, 15, NaN, 15]) },
  }
  const names = Object.keys(moves)

  for (let i = 0; i < steps; i += 1) {
    const name = pick(names)
    trail.push(name)
    const say = (what: string): string => `seed ${seed}, step ${i} (${trail.slice(-14).join(' > ')}): ${what}`
    // Whether nothing about playing changed in this step, so that what held before it still holds after.
    const before = { isStill: !['play', 'card', 'hold', 'paused', 'plain', 'rest', 'personPlays', 'personPauses', 'sitePlays', 'pressSomething', 'enter', 'elsewhere'].includes(name) }
    moves[name]?.()
    pass(500)
    const stats = page.ask()
    const W = page.state()
    const drawn = page.drawn()
    const isCardUp = drawn.includes(CARD.title)
    const isAsking = drawn.includes('还在吗？')
    const isLocked = isCardUp || isAsking

    if (stats.err !== null) throw new Error(say(`the page's own step threw: ${stats.err}`))
    if (stats.mode !== mode && !stats.lost) throw new Error(say(`told "${mode}", the page says "${stats.mode}"`))
    // S-4: held means still and silent.
    if (mode === 'hold' && (!video.paused || !second.paused)) throw new Error(say('held, and a clip is playing'))
    // C-8: a card up means nothing plays and nothing but the card answers; no card means nothing is blocked.
    if (isLocked && (!video.paused || !second.paused)) throw new Error(say('a card is up and a clip is playing'))
    if (page.key('keydown', 'ArrowDown').wasStopped !== isLocked) throw new Error(say(`locked=${isLocked} but the keyboard says otherwise`))
    // The card shows only in card mode on the feed, and never once it has been sent away (C-14).
    if (isCardUp && (mode !== 'card' || stats.health !== 'feed')) throw new Error(say(`a card is drawn in mode "${mode}" on "${stats.health}"`))
    if (isCardUp && card !== null && card.id === freedId) throw new Error(say('the card came back after being told to leave'))
    // W-3: "still there?" belongs to a clip that is playing, and to nothing else.
    if (isAsking && mode !== 'play') throw new Error(say(`"still there?" is up in mode "${mode}"`))
    // R-3, R-4: at rest nothing of ours is left: nothing drawn (bar the lost note), no styling, no timer, no listeners.
    if (mode === 'rest' && !stats.lost) {
      if (page.hasHost()) throw new Error(say(`at rest, but something is drawn: ${drawn.join(',')}`))
      if (page.hasCss() || W.armed || W.locked) throw new Error(say('at rest, but the page is still styled, armed or locked'))
    }
    // Principle 3: off the feed, the site's own layout is untouched.
    if (stats.health !== 'feed' && page.hasCss()) throw new Error(say(`on "${stats.health}", and the navigation is still hidden`))
    // W-4: a clip the person paused stays paused while the mode holds.
    if (personPaused && mode === 'play' && stats.health === 'feed' && !isLocked && !video.paused && name !== 'personPlays' && name !== 'play') {
      throw new Error(say('the person paused it and the page started it again'))
    }
    // W-10: the counters only go up within one load, and no clip is counted that was not watched for its second and a half.
    if (last !== null && last.load === stats.load && (stats.watchMs < last.watchMs || stats.videos < last.videos)) throw new Error(say('a counter went down'))
    if (stats.videos * 1500 > stats.watchMs + 1) throw new Error(say(`${stats.videos} clips counted in ${stats.watchMs} ms`))
    // W-2, W-4: nor does time count while the page is out of sight or the person has paused the clip.
    if (last !== null && last.load === stats.load && stats.watchMs > last.watchMs && before.isStill && (hold || personPaused) && mode === 'play') {
      throw new Error(say(`time was counted with hold=${hold}, paused by the person=${personPaused}`))
    }
    // Nothing counts while nothing may play.
    if (last !== null && last.load === stats.load && stats.watchMs > last.watchMs && (mode === 'hold' || mode === 'rest' || mode === 'paused' || mode === 'plain') && name !== mode) {
      throw new Error(say(`time was counted in mode "${mode}"`))
    }
    last = stats
  }
}

for (const seed of [31, 32, 33, 34, 35, 36, 9008, 9012]) {
  test(`random walk ${seed} over the page: held is still, a card locks and only a card, rest leaves nothing, counts only go up`, () => {
    pageWalk(seed, 220)
  })
}

test('W-4: the site starting another slide does not undo the person\'s pause of the one in view', () => {
  const { page, video } = feed()
  const next = makeVideo('https://v.example/clip-2.mp4')
  next.getBoundingClientRect = () => ({ left: 0, top: 800, right: 400, bottom: 1600 })
  page.videos.push(next)
  page.sync(want('play'))
  page.skip(1000)
  video.pause()
  page.media('pause', video)
  page.run(1000)
  expect(video.paused).toBe(true)

  next.play()
  page.media('play', next)
  page.run(2000)
  expect(video.paused).toBe(true)

  // Their own play of the clip in view is what ends it.
  video.play()
  page.media('play', video)
  video.pause()
  page.run(1000)
  expect(video.paused).toBe(false)
})

test('W-3: "still there?" does not outlive the playing it asked about', () => {
  const { page } = feed()
  page.sync(want('play'))
  page.live(5 * 60_000 + 2000)
  expect(page.drawn()).toContain('还在吗？')
  page.sync(want('paused'))
  expect(page.drawn()).not.toContain('还在吗？')
  expect(page.key('keydown', 'ArrowDown').wasStopped).toBe(false)
})

test('W-4: a pause belongs to the clip it was made on; after a swipe the next clip is not held by it', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.skip(1000)
  video.pause()
  page.media('pause', video)
  page.run(1000)
  expect(video.paused).toBe(true)

  const next = makeVideo('https://v.example/clip-2.mp4')
  next.paused = false
  video.getBoundingClientRect = () => ({ left: 0, top: -800, right: 400, bottom: 0 })
  page.videos.push(next)
  page.run(500)
  // Out of sight and back: the clip now in view resumes, because nobody paused that one.
  page.sync(want('play', { hold: true }))
  expect(next.paused).toBe(true)
  page.sync(want('play'))
  page.run(500)
  expect(next.paused).toBe(false)
})

test('W-3: coming back after a long time out of sight does not get "still there?" at once', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.sync(want('play', { hold: true }))
  page.live(6 * 60_000)
  page.sync(want('play'))
  page.live(4000)
  expect(page.drawn()).not.toContain('还在吗？')
  expect(video.paused).toBe(false)
})

test('C-5, W-2: a clip the person starts again after an interruption still stops when the page goes out of sight', () => {
  const { page, video } = feed()
  page.sync(want('play'))
  page.sync(want('paused'))
  page.skip(1000)
  video.play()
  page.media('play', video)
  page.run(1000)
  expect(video.paused).toBe(false)
  page.sync(want('paused', { hold: true }))
  page.run(500)
  expect(video.paused).toBe(true)
})

test('no clip in view (a slide of pictures): a neighbour below the fold is neither played nor counted', () => {
  const { page, video } = feed('tiktok')
  video.getBoundingClientRect = () => ({ left: 0, top: 800, right: 400, bottom: 1600 })
  page.sync(want('play'))
  page.run(5000)
  expect(video.paused).toBe(true)
  expect(page.ask().watchMs).toBe(0)
})

test('R-9: a page that let go by itself and is then found again carries on the same break, counts and all', () => {
  const { page } = feed()
  page.sync(want('play'))
  page.run(3000)
  const before = page.sync(want('card', { card: CARD }))
  page.run(31_000)
  expect(page.ask().lost).toBe(true)
  const after = page.sync(want('card', { card: CARD }))
  expect(after.load).toBe(before.load)
  expect(after.videos).toBe(before.videos)
})

test('a page that loads anew numbers its presses above the ones the mod has already handled', () => {
  const { page } = feed()
  page.sync(want('card', { card: CARD }), 7)
  page.skip(700)
  page.press('回去看看')
  expect(page.ask().acts).toEqual([{ n: 8, id: 'back' }])
})

test('the site sweeping our element off the page does not leave a lock with no card', () => {
  const { page } = feed()
  page.sync(want('card', { card: CARD }))
  page.doc.documentElement.removeChild(page.hostEl())
  expect(page.hasHost()).toBe(false)
  page.run(500)
  expect(page.drawn()).toContain(CARD.title)
})
