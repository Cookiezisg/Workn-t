import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

import type { PageWant, Report } from './core/types'

/**
 * The whole mod, run against a made-up app: files in memory, a browser pane
 * that keeps tabs and answers the page scripts, a window that says whether
 * the session is on screen. What these tests check is the wiring: that the
 * engine's events reach the rules, and the rules' answers reach the pane.
 */

const B = 'mcp__Claude_Browser__'
const HOME = '/home/u'
const ROOT = `${HOME}/.claude/plugins/data/worknt`
const NOW = Date.UTC(2026, 0, 5, 3, 0, 0)

type Tab = { tabId: string; origin: string; isActive: boolean }
type Call = { server: string; tool: string; args: Record<string, unknown> }

type Options = {
  settings?: Record<string, unknown>
  /** Whether the app's two servers answer. */
  hasBrowser?: boolean
  hasWindow?: boolean
  /** The engine refuses the mod's tab listing, as it does after the model's was refused. */
  isListingRefused?: boolean
  isPaneOpen?: boolean
}

function makeApp(on: On, options: Options = {}) {
  const clock = mock.clock(on, { now: NOW })
  const files = new Map<string, { text: string; mtimeMs: number }>()
  const calls: Call[] = []
  const tabs: Tab[] = options.isPaneOpen === false ? [] : [{ tabId: 'work', origin: 'http://localhost:3000', isActive: true }]
  const app = {
    isPaneOpen: options.isPaneOpen !== false,
    isPaneShown: options.isPaneOpen !== false,
    isOnScreen: true,
    isListingRefused: options.isListingRefused === true,
    /** What the video page would say it is. */
    health: 'feed' as string,
    /** What the mod last asked the page to be. */
    want: null as PageWant | null,
    hasLibrary: false,
    acts: [] as { n: number; id: string; arg?: string }[],
    /** Stands in for a tool of the model's that takes its time, such as a question to the person. */
    slowTool: null as ((name: string) => Promise<void>) | null,
    isModelListing: false,
    videos: 0,
    watchMs: 0,
    /** Changes when the page starts over: a reload, or a new break on a kept page. */
    load: 1,
    paneOpens: 0,
    /** A browser tool that refuses every call for now; null when all answer. */
    failing: null as string | null,
    nextTab: 1,
  }
  if (options.settings) files.set(`${ROOT}/settings.json`, { text: JSON.stringify(options.settings), mtimeMs: NOW - 1000 })

  const text = (value: string) => ({ value: { content: [{ type: 'text', text: value }], isError: false } })
  const refused = (value: string) => ({ value: { content: [{ type: 'text', text: value }], isError: true } })
  const listing = (): string =>
    `${JSON.stringify({ browserOpen: app.isPaneOpen, tabs }, null, 2)}\nThe Browser pane is currently ${app.isPaneShown ? 'displayed' : 'hidden'}.`
  const originOf = (url: string): string => {
    const m = /^(https?:\/\/)(?:www\.)?([^/]+)/.exec(url)
    return m ? `${m[1]}${m[2]}` : url
  }
  const stats = () => ({
    v: 26, load: app.load, mode: app.want?.mode ?? 'rest', health: app.health, url: 'https://www.tiktok.com/foryou', playing: app.want?.mode === 'play',
    framesOk: true, inputAgo: 0, videos: app.videos, watchMs: app.watchMs, live: false, cardId: app.want?.card?.id ?? null, more: false, idleAsk: false, acts: app.acts, lost: false, err: null, steps: 0, why: '',
  })

  on('env.get', () => ({ value: HOME }))
  on('session.id', () => ({ value: 'sess-a' }))
  on('session.root', () => ({ value: '/proj/shop' }))
  on('session.version', () => ({ value: '2.1.330' }) as never)
  on('settings.read', () => ({ value: { theme: 'auto' } }))
  on('command.register', () => ({ value: { command: 'worknt' } }))
  on('ui.open', () => {
    app.paneOpens += 1
    return { value: { isPlaced: true } }
  })
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('session.end', () => ({ sessionId: 'sess-a' }))
  on('prompt.submit', (_, e) => ({ text: e.text }))
  on('turn.start', (_, e) => ({ turnId: e.turnId, text: e.text }))
  on('turn.complete', () => ({ text: '' }))

  on('fs.read', (_, e) => {
    const file = files.get(e.path)
    if (!file) throw new Error(`ENOENT ${e.path}`)
    return { value: file.text }
  })
  on('fs.write', (_, e) => {
    files.set(e.path, { text: e.text, mtimeMs: clock.now() })
    return { value: undefined }
  })
  on('fs.stat', (_, e) => {
    const file = files.get(e.path)
    if (!file) throw new Error(`ENOENT ${e.path}`)
    return { value: { kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false } }
  })
  on('fs.list', (_, e) => {
    const prefix = `${e.path ?? ''}/`
    const entries = [...files.entries()]
      .filter(([path]) => path.startsWith(prefix) && !path.slice(prefix.length).includes('/'))
      .map(([path, file]) => ({ name: path.slice(prefix.length), kind: 'file', size: file.text.length, mtimeMs: file.mtimeMs, isLink: false }))
    return { value: entries } as never
  })

  on('mcp.call', (_, e) => {
    const call = e as unknown as Call
    calls.push(call)
    const { server, tool, args } = call
    if (server === 'ccd_window') {
      if (options.hasWindow === false) throw new Error('no such server')
      return text(JSON.stringify({ this_session: { session_id: 'local_a', on_screen: app.isOnScreen } }))
    }
    if (server === 'ccd_session_mgmt') return text(JSON.stringify([{ sessionId: 'local_b', title: '修登录 bug' }]))
    if (server === 'ccd_view') {
      app.isPaneShown = tool === 'show_pane'
      if (tool === 'show_pane') app.isPaneOpen = true
      return text('ok')
    }
    if (options.hasBrowser === false) throw new Error('no such server')
    const tabId = typeof args.tabId === 'string' ? args.tabId : undefined
    if (app.failing === tool) return refused(`${tool} is not answering`)
    switch (tool) {
      case 'tabs_context':
        return app.isListingRefused ? refused('this repeats a mcp__Claude_Browser__tabs_context call that is not allowed') : text(listing())
      case 'tabs_create': {
        if (!app.isPaneOpen) return text('No tab was created. The Browser pane isn\'t open yet.')
        const made = `tab-${app.nextTab++}`
        tabs.push({ tabId: made, origin: '', isActive: false })
        return text(JSON.stringify({ tabId: made }))
      }
      case 'navigate': {
        let tab = tabs.find(one => one.tabId === tabId)
        if (!tab && tabId === undefined) {
          app.isPaneOpen = true
          tab = { tabId: 'seed', origin: '', isActive: true }
          tabs.push(tab)
        }
        if (!tab) return refused('no such tab')
        tab.origin = originOf(String(args.url))
        // A page that loads is a new page: no library, and its counters, when it has them again, start over.
        app.hasLibrary = false
        app.load += 1
        app.videos = 0
        app.watchMs = 0
        app.acts = []
        return text(JSON.stringify({ tabId: tab.tabId, navOk: true }))
      }
      case 'tabs_select':
        for (const tab of tabs) tab.isActive = tab.tabId === tabId
        return text(`Fronted tab ${tabId}.`)
      case 'tabs_close': {
        const index = tabs.findIndex(tab => tab.tabId === tabId)
        if (index >= 0) tabs.splice(index, 1)
        return text('Closed.')
      }
      case 'find':
        return text('Found 1 match(es):\n- button "worknt-focus-target" [ref_9]')
      case 'computer':
        return text('clicked')
      case 'javascript_tool': {
        if (!tabs.some(tab => tab.tabId === tabId)) return refused('Preview tab is no longer open.')
        const script = String(args.text)
        if (script.includes('worknt-focus')) return text(JSON.stringify({ ok: true, hasFocus: true }))
        if (script.startsWith('(function (v, ack)')) return text(JSON.stringify(app.hasLibrary ? stats() : { missing: true }))
        // The sync script ends with its two arguments as JSON: the configuration, then the command.
        const at = script.lastIndexOf(', {"want":')
        const command = JSON.parse(script.slice(at + 2, -1)) as { want: PageWant | null; ack: number }
        if (command.want) {
          // As the real page does: a new break on a page at rest carries nothing over.
          if (app.hasLibrary && app.want?.mode === 'rest' && command.want.mode !== 'rest') {
            app.load += 1
            app.videos = 0
            app.watchMs = 0
            app.acts = []
          }
          app.want = command.want
        }
        app.acts = app.acts.filter(act => act.n > command.ack)
        app.hasLibrary = true
        return text(`${JSON.stringify(stats(), null, 2)}\n\n(captured at origin https://tiktok.com)`)
      }
    }
    return text('ok')
  })

  // The model's own tool calls bottom out here.
  on('tool.call', async (_, e) => {
    const name = String(e.tool)
    // While the engine refuses the mod its listing, only a listing the model itself asks for goes through.
    if (name === `${B}tabs_context` && app.isListingRefused && !app.isModelListing) {
      return { deny: 'this repeats a mcp__Claude_Browser__tabs_context call that is not allowed' }
    }
    if (app.slowTool !== null) await app.slowTool(name)
    const value = name === `${B}tabs_context` ? listing() : `ran ${name}`
    return { result: [{ type: 'text', text: value }], text: value }
  })

  const BAND = {
    plugin: 'worknt', surface: 'desktop', component: 'AbovePrompt',
    props: { hasSurvey: false, isCollapsed: false, isWorking: true, maxRows: 4, bodyColumns: 80, scroll: { offset: 0, bodyRows: 4 }, view: {} },
  } as const

  let paneUi: any = null
  const PANE = {
    plugin: 'worknt', surface: 'desktop', component: 'Pane', requestId: 'worknt',
    props: { title: 'Workn’t', isFocused: false, bodyColumns: 40, placement: 'dock', scroll: { offset: 0, bodyRows: 40 }, view: {} },
  } as const

  return {
    app, clock, files, calls, tabs,
    /** The settings pane as drawn now: which choice is lit in a row, and a press on any of its buttons. */
    async pane($: any): Promise<{ lit: (row: string, choices: string[]) => Promise<string[]>; press: (key: string) => Promise<void>; has: (text: RegExp) => Promise<boolean> }> {
      paneUi ??= await $.ui.mount(PANE)
      const ui = paneUi
      return {
        lit: async (row, choices) => {
          const out: string[] = []
          for (const choice of choices) {
            const button = await ui.find({ key: `${row}-${choice}` })
            if (button?.props?.variant === 'primary') out.push(choice)
          }
          return out
        },
        press: async key => {
          await ui.press({ key })
          await clock.settle()
        },
        has: async text => (await ui.find({ type: 'Text', text })) !== undefined,
      }
    },
    browserCalls: (tool: string): Call[] => calls.filter(call => call.server === 'Claude_Browser' && call.tool === tool),
    report: (id = 'sess-a'): Report => JSON.parse(files.get(`${ROOT}/sessions/${id}.json`)?.text ?? 'null') as Report,
    settings: (): Record<string, unknown> => JSON.parse(files.get(`${ROOT}/settings.json`)?.text ?? '{}') as Record<string, unknown>,
    log: (): string => files.get(`${ROOT}/logs/sess-a.log`)?.text ?? [...files.entries()].filter(([path]) => path.includes('/logs/')).map(([, file]) => file.text).join(''),
    writeReport(report: Report): void {
      files.set(`${ROOT}/sessions/${report.id}.json`, { text: JSON.stringify(report), mtimeMs: clock.now() })
    },
    /** What the line above the prompt reads right now, and its buttons. */
    async band($: any): Promise<{ text: string; buttons: string[]; press: (key: string) => Promise<void> }> {
      const ui = await $.ui.mount(BAND)
      const found = await ui.find({ type: 'Text' })
      const buttons: string[] = []
      for (const key of ['accept', 'decline', 'welcome-ok', 'lang-zh', 'lang-en', 'site-douyin', 'site-tiktok', 'sound-on', 'sound-off', 'wait-more', 'give-up', 'retry', 'quiet-yes', 'quiet-no']) {
        if ((await ui.find({ key })) !== undefined) buttons.push(key)
      }
      return {
        text: found?.text ?? '',
        buttons,
        press: async (key: string) => {
          await ui.press({ key })
          await clock.settle()
        },
      }
    },
  }
}

const READY = { v: 1, isEnabled: true, site: 'tiktok', sound: 'on', lang: 'zh', delaySec: 8, idleMin: 5, quietDay: null, declines: 0, excluded: [], hasSeenWelcome: true, signedInOnce: ['tiktok'], resetAt: 0 }

const start = async ($: any, world: ReturnType<typeof makeApp>): Promise<void> => {
  await $.session.start({ cwd: '/proj/shop', surface: 'desktop', isInteractive: true })
  await world.clock.settle()
}

const typedTurn = async ($: any, world: ReturnType<typeof makeApp>, turnId = 't1'): Promise<void> => {
  await $.prompt.submit({ text: 'refactor the parser', origin: { kind: 'composer' } })
  await $.turn.start({ text: 'refactor the parser', turnId })
  await world.clock.settle()
}

const endTurn = async ($: any, world: ReturnType<typeof makeApp>, turnId = 't1', reason = 'answer'): Promise<void> => {
  await $.turn.complete({ reason, turnId, answer: 'done', durationMs: 134_000, isAborted: false })
  await world.clock.settle()
}

test('D-3: in the desktop app the mod wakes, writes its report, and leaves a record', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  expect(world.report().status).toBe('idle')
  expect(world.report().localId).toBe('local_a')
  expect(world.log()).toContain('dormant=null')
})

test('D-3: where neither the pane nor the window answers, it stays asleep and touches nothing but its log', async ($, on) => {
  const world = makeApp(on, { settings: READY, hasBrowser: false, hasWindow: false })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(20_000)
  expect(world.files.has(`${ROOT}/sessions/sess-a.json`)).toBe(false)
  expect(world.log()).toContain('dormant=只在 Claude 桌面版的 Code 里可用')
  expect((await world.band($)).text).toBe('')
})

test('I-1, I-2: the invitation comes after the delay for a typed turn, and never for one nobody typed', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await $.prompt.submit({ text: '', origin: { kind: 'task-notification' } } as never)
  await $.turn.start({ text: '', turnId: 't0' })
  await world.clock.advance(20_000)
  expect(world.report().status).toBe('self')
  expect((await world.band($)).text).toBe('')
  await endTurn($, world, 't0')

  await typedTurn($, world)
  await world.clock.advance(6000)
  expect((await world.band($)).text).toBe('')
  await world.clock.advance(4000)
  const band = await world.band($)
  expect(band.text).toBe('刷会儿TikTok？')
  expect(band.buttons).toEqual(['accept', 'decline'])
  expect(world.browserCalls('navigate')).toHaveLength(0) // principle 2: nothing loads before the click
})

test('I-4, I-6: an invitation not taken goes away with the turn; three refusals in a row get asked about', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  for (const turn of ['t1', 't2', 't3']) {
    await typedTurn($, world, turn)
    await world.clock.advance(10_000)
    const band = await world.band($)
    expect(band.text).toBe('刷会儿TikTok？')
    await band.press('decline')
    if (turn !== 't3') expect((await world.band($)).text).toBe('')
    if (turn !== 't3') await endTurn($, world, turn)
  }
  const ask = await world.band($)
  expect(ask.text).toBe('今天都别问了？')
  await ask.press('quiet-yes')
  expect(world.settings().quietDay).toBe('2026-01-05')
  await endTurn($, world, 't3')
  await typedTurn($, world, 't4')
  await world.clock.advance(10_000)
  expect((await world.band($)).text).toBe('')
})

test('section 13: the first time, the line asks language, source and sound, saves each, then opens', async ($, on) => {
  const world = makeApp(on)
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  let band = await world.band($)
  await band.press('accept')
  band = await world.band($)
  expect(band.buttons).toEqual(['lang-zh', 'lang-en'])
  await band.press('lang-zh')
  band = await world.band($)
  expect(band.text).toBe('看哪个？')
  await band.press('site-douyin')
  band = await world.band($)
  expect(band.text).toBe('声音')
  expect(world.browserCalls('navigate')).toHaveLength(0)
  await band.press('sound-off')
  expect(world.settings()).toMatchObject({ lang: 'zh', site: 'douyin', sound: 'off' })
  expect(world.browserCalls('navigate')[0]?.args.url).toBe('https://www.douyin.com/?recommend=1&from_nav=1')
})

test('S-1 to S-8, C-1, C-9, R-3: a whole break, from the click to putting the pane back', async ($, on) => {
  const world = makeApp(on, { settings: READY, isPaneOpen: false })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  world.app.health = 'loading'
  await (await world.band($)).press('accept')

  // S-3, S-4: a tab of its own, loaded out of sight, held; the line says it is opening.
  expect(world.report().claim).not.toBeNull()
  expect(world.app.want?.mode).toBe('hold')
  expect(world.app.isPaneShown).toBe(false)
  expect((await world.band($)).text).toBe('正在打开TikTok')

  // S-5, S-8: once there is something to show, it is brought out and given the keyboard.
  world.app.health = 'feed'
  await world.clock.advance(1500)
  expect(world.app.isPaneShown).toBe(true)
  expect(world.tabs.find(tab => tab.isActive)?.origin).toBe('https://tiktok.com')
  expect(world.calls.some(call => call.tool === 'computer' && call.args.ref === 'ref_9')).toBe(true)
  expect(world.app.want?.mode).toBe('play')
  expect(world.report().seen).toBe(true)

  // W-10, W-11: what the page counts shows on the line.
  world.app.videos = 3
  world.app.watchMs = 42_000
  await world.clock.advance(2500)
  expect((await world.band($)).text).toBe('摸鱼中 0:42 · 3 条')

  // C-1: the turn ends, the card goes up, and the line says the same thing.
  await endTurn($, world)
  await world.clock.advance(1500)
  expect(world.app.want?.mode).toBe('card')
  expect(world.app.want?.card?.title).toBe('Claude 跑完了')
  expect(world.app.want?.card?.lines).toEqual(['用时 2:14', '你刷了 3 条，0:42'])
  expect((await world.band($)).text).toBe('Claude 跑完了')

  // C-9, R-3, S-2, W-12: "back" rests the page, closes the pane that was closed before, clears the line.
  world.app.acts = [{ n: 1, id: 'back' }]
  await world.clock.advance(1500)
  expect(world.app.want?.mode).toBe('rest')
  expect(world.app.isPaneShown).toBe(false)
  expect(world.report().claim).toBeNull()
  expect((await world.band($)).text).toBe('')
  expect(world.tabs).toHaveLength(1) // the tab is kept, paused, for a while

  // R-3: ten minutes on, the kept tab is closed.
  await world.clock.advance(10 * 60_000 + 2000)
  expect(world.tabs).toHaveLength(0)
})

test('S-2: the tab that was in front before is in front again afterwards', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  await (await world.band($)).press('accept')
  await world.clock.advance(1500)
  expect(world.tabs.find(tab => tab.isActive)?.tabId).not.toBe('work')
  await (await world.band($)).press('give-up')
  expect(world.tabs.find(tab => tab.isActive)?.tabId).toBe('work')
  expect(world.app.isPaneShown).toBe(true)
})

test('S-4: a page that never loads: the line offers to wait or give up, and giving up leaves nothing behind', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  world.app.health = 'loading'
  await (await world.band($)).press('accept')
  await world.clock.advance(17_000)
  const slow = await world.band($)
  expect(slow.text).toBe('TikTok打开得有点慢')
  expect(slow.buttons).toEqual(['wait-more', 'give-up'])
  await slow.press('give-up')
  expect(world.report().claim).toBeNull()
  expect(world.app.want?.mode).toBe('rest')
  expect((await world.band($)).text).not.toContain('打开')
})

test('L-2, L-3: signed out, the site is left as it is; once signed in, the feed opens by itself', async ($, on) => {
  const world = makeApp(on, { settings: { ...READY, signedInOnce: [] } })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  world.app.health = 'login'
  await (await world.band($)).press('accept')
  await world.clock.advance(2500)
  expect(world.app.want?.mode).toBe('plain')
  expect(world.app.want?.note?.id).toBe('login')
  expect(world.app.isPaneShown).toBe(true)

  const before = world.browserCalls('navigate').length
  world.app.health = 'elsewhere' // signed in, but the site left us on another page
  await world.clock.advance(2500)
  expect(world.browserCalls('navigate').length).toBe(before + 1)
  world.app.health = 'feed'
  await world.clock.advance(2500)
  expect(world.app.want?.mode).toBe('play')
  expect(world.settings().signedInOnce).toEqual(['tiktok'])
})

test('W-7: the person closing the video tab ends the break, and it is not reopened', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  await (await world.band($)).press('accept')
  await world.clock.advance(1500)
  const feed = world.tabs.find(tab => tab.origin === 'https://tiktok.com')
  world.tabs.splice(world.tabs.indexOf(feed as Tab), 1)
  await world.clock.advance(2500)
  expect(world.report().claim).toBeNull()
  const opened = world.browserCalls('tabs_create').length
  await world.clock.advance(30_000)
  expect(world.browserCalls('tabs_create').length).toBe(opened)
})

test('W-2: with the session off screen the page is told to hold, and the report says the video is out of sight', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  await (await world.band($)).press('accept')
  await world.clock.advance(2500)
  expect(world.app.want?.hold).toBe(false)
  world.app.isOnScreen = false
  await world.clock.advance(2500)
  expect(world.app.want?.hold).toBe(true)
  expect(world.report().seen).toBe(false)
})

test('R-5: another session taking the video page ends this one\'s break at once', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  await (await world.band($)).press('accept')
  await world.clock.advance(1500)
  const now = world.clock.now()
  world.writeReport({ v: 1, id: 'sess-b', localId: 'local_b', cwd: '/proj/other', status: 'working', wait: null, since: now, lastMs: 0, seq: 0, beat: now, claim: now, seen: true })
  await world.clock.advance(2500)
  expect(world.report().claim).toBeNull()
  expect(world.app.want?.mode).toBe('rest')
  expect((await world.band($)).text).toBe('视频开在「修登录 bug」里')
})

test('C-2, C-3: other sessions\' news reaches the page: a finish is a toast, a wait is a card naming the session', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  await (await world.band($)).press('accept')
  await world.clock.advance(1500)
  const other = (patch: Partial<Report>): void => {
    const now = world.clock.now()
    world.writeReport({ v: 1, id: 'sess-b', localId: 'local_b', cwd: '/proj/other', status: 'working', wait: null, since: now, lastMs: 0, seq: 0, beat: now, claim: null, seen: false, ...patch })
  }
  other({ status: 'done', lastMs: 5000, seq: 1 })
  await world.clock.advance(2500)
  expect(world.app.want?.mode).toBe('play')
  expect(world.app.want?.toast?.text).toBe('「修登录 bug」跑完了')

  other({ status: 'waiting', wait: 'approval', seq: 1 })
  await world.clock.advance(2500)
  expect(world.app.want?.mode).toBe('card')
  expect(world.app.want?.card?.title).toBe('「修登录 bug」在等你点头')
})

test('C-2: a question from Claude freezes the video until it is answered', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  let answer: (() => void) | null = null
  world.app.slowTool = name => (name === 'AskUserQuestion' ? new Promise<void>(resolve => { answer = resolve }) : Promise.resolve())
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  await (await world.band($)).press('accept')
  await world.clock.advance(1500)

  const asking = $.tool.call({ tool: 'AskUserQuestion', questions: [] })
  await world.clock.advance(1500)
  expect(world.report().status).toBe('waiting')
  expect(world.app.want?.card?.title).toBe('Claude 问了你一个问题')
  ;(answer as unknown as () => void)()
  await asking
  await world.clock.advance(1500)
  expect(world.report().status).toBe('working')
  expect(world.app.want?.mode).toBe('play')
})

test('P-1, P-3: with a break up, the model is kept off the video tab and its tab listing is blanked', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  await (await world.band($)).press('accept')
  await world.clock.advance(1500)
  const feed = world.tabs.find(tab => tab.origin === 'https://tiktok.com')?.tabId

  const read = (await $.tool.call({ tool: `${B}get_page_text`, tabId: feed })) as { deny?: string }
  expect(read.deny).toContain('/worknt off')
  const loose = (await $.tool.call({ tool: `${B}get_page_text` })) as { deny?: string }
  expect(loose.deny).toContain('/worknt off') // W-9: the tab in front is the video
  const own = (await $.tool.call({ tool: `${B}get_page_text`, tabId: 'work' })) as { deny?: string }
  expect(own.deny).toBeUndefined()

  const listed = (await $.tool.call({ tool: `${B}tabs_context` })) as { result?: { text: string }[] }
  expect(listed.result?.[0]?.text).not.toContain('tiktok')
  expect(listed.result?.[0]?.text).toContain('localhost:3000')
})

test('P-6: switched off, the guard is off, at once and without a restart', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  world.tabs.push({ tabId: 'mine', origin: 'https://douyin.com', isActive: false })
  expect(((await $.tool.call({ tool: `${B}get_page_text`, tabId: 'mine' })) as { deny?: string }).deny).toBeDefined()
  await world.clock.advance(5)
  world.files.set(`${ROOT}/settings.json`, { text: JSON.stringify({ ...READY, isEnabled: false }), mtimeMs: world.clock.now() })
  expect(((await $.tool.call({ tool: `${B}get_page_text`, tabId: 'mine' })) as { deny?: string }).deny).toBeUndefined()
})

test('P-4: when the engine refuses the mod its tab listing, the mod still wakes, and the guard refuses what it cannot judge', async ($, on) => {
  const world = makeApp(on, { settings: READY, isListingRefused: true })
  await start($, world)
  expect(world.log()).toContain('dormant=null')
  const judged = (await $.tool.call({ tool: `${B}get_page_text`, tabId: 'work' })) as { deny?: string }
  expect(judged.deny).toContain('单独再发一次')
  // Listing the tabs itself needs no judging, and what it shows becomes what the guard knows.
  world.app.isModelListing = true
  const listed = (await $.tool.call({ tool: `${B}tabs_context` })) as { deny?: string }
  world.app.isModelListing = false
  expect(listed.deny).toBeUndefined()
  const again = (await $.tool.call({ tool: `${B}get_page_text`, tabId: 'work' })) as { deny?: string }
  expect(again.deny).toBeUndefined()
})

test('a break survives the engine refusing the tab listing, as long as the page still answers', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  await (await world.band($)).press('accept')
  await world.clock.advance(1500)
  world.app.isListingRefused = true
  await world.clock.advance(60_000)
  expect(world.report().claim).not.toBeNull()
  expect(world.app.want?.mode).toBe('play')
})

test('R-6: the session ending rests the page, closes the kept tab, and reports itself gone', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  await (await world.band($)).press('accept')
  await world.clock.advance(1500)
  await $.session.end({ reason: 'exit' } as never)
  await world.clock.settle()
  expect(world.app.want?.mode).toBe('rest')
  expect(world.tabs.some(tab => tab.origin === 'https://tiktok.com')).toBe(false)
  expect(world.report().status).toBe('gone')
})

test('T-1: the command changes a setting for every session at once, and says what it did', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  expect((await $.command.run({ command: 'worknt', args: 'delay 20' } as never)).text).toBe('Claude 干活 20 秒后再问。')
  expect(world.settings().delaySec).toBe(20)
  expect((await $.command.run({ command: 'worknt', args: 'here off' } as never)).text).toBe('在这个项目里不再出现。')
  expect(world.settings().excluded).toEqual(['/proj/shop'])
  expect((await $.command.run({ command: 'worknt', args: '' } as never)).text).toContain('开着 · TikTok · 有声 · 直播照常 · 20 秒后询问')
  expect((await $.command.run({ command: 'worknt', args: 'doctor' } as never)).text).toContain('awake: true')
})

/** A break that is up and playing, the turn still running. */
const watching = async ($: any, world: ReturnType<typeof makeApp>): Promise<void> => {
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  await (await world.band($)).press('accept')
  await world.clock.advance(1500)
  expect(world.app.want?.mode).toBe('play')
}

test('W-10, R-3: a second break on the kept tab counts only its own clips, in the tally as on the line', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await watching($, world)
  world.app.videos = 6
  world.app.watchMs = 77_000
  await world.clock.advance(2500)
  await (await world.band($)).press('give-up')
  expect(world.app.want?.mode).toBe('rest')
  expect(world.tabs).toHaveLength(2)

  // Straight back in, on the tab that was kept: its page still holds the first break's numbers until it is told to start over.
  await (await world.band($)).press('accept')
  await world.clock.advance(2500)
  expect(world.app.want?.mode).toBe('play')
  expect(world.browserCalls('navigate')).toHaveLength(1)
  world.app.videos = 3
  world.app.watchMs = 22_000
  await world.clock.advance(2500)
  expect((await world.band($)).text).toBe('摸鱼中 0:22 · 3 条')
  await (await world.band($)).press('give-up')
  expect((await $.command.run({ command: 'worknt', args: 'bill' } as never)).text).toContain('你刷了 9 条，2 分钟')
})

test('I-2, R-3: leaving a break mid-turn is not followed by an invitation; the line offers the kept page instead', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await watching($, world)
  await (await world.band($)).press('give-up')
  await world.clock.advance(4000)
  const band = await world.band($)
  expect(band.text).toBe('TikTok还开着')
  expect(band.buttons).toEqual(['accept'])
  expect(world.settings().declines).toBe(0)

  await band.press('accept')
  await world.clock.advance(1500)
  expect(world.app.want?.mode).toBe('play')

  // With the kept tab gone there is nothing to offer, and still no invitation until the next turn.
  world.tabs.splice(world.tabs.findIndex(tab => tab.origin === 'https://tiktok.com'), 1)
  await world.clock.advance(4000)
  expect((await world.band($)).text).toBe('')
  await endTurn($, world)
  await typedTurn($, world, 't2')
  await world.clock.advance(10_000)
  expect((await world.band($)).text).toBe('刷会儿TikTok？')
})

test('T-1: a choice on the page\'s menu becomes the setting, and the page is told so', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await watching($, world)
  world.app.acts = [{ n: 1, id: 'set', arg: 'sound off' }, { n: 2, id: 'set', arg: 'live skip' }, { n: 3, id: 'set', arg: 'site douyin' }]
  await world.clock.advance(2500)
  expect(world.settings()).toMatchObject({ sound: 'off', live: 'skip', site: 'tiktok' })
  const sent = world.browserCalls('javascript_tool').map(call => String(call.args.text)).filter(text => text.includes('"skipLive":true'))
  expect(sent.length).toBeGreaterThan(0)
  expect(sent[sent.length - 1]).toContain('"isMuted":true')
})

test('live streams: when the page asks, the mod presses the down key in the video tab, once per asking', async ($, on) => {
  const world = makeApp(on, { settings: { ...READY, live: 'skip' } })
  await watching($, world)
  const keys = () => world.calls.filter(call => call.tool === 'computer' && call.args.action === 'key')
  expect(keys()).toHaveLength(0)
  world.app.acts = [{ n: 1, id: 'skip' }]
  await world.clock.advance(2500)
  expect(keys()).toHaveLength(1)
  expect(keys()[0]?.args).toMatchObject({ text: 'ArrowDown', tabId: world.tabs.find(tab => tab.origin === 'https://tiktok.com')?.tabId })
  await world.clock.advance(6000)
  expect(keys()).toHaveLength(1)
})

test('T-1: the pane shows every setting as it stands, and a press changes it for good', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await $.command.run({ command: 'worknt', args: '' } as never)
  expect(world.app.paneOpens).toBe(1)

  let pane = await world.pane($)
  expect(await pane.lit('switch', ['on', 'off'])).toEqual(['on'])
  expect(await pane.lit('site', ['douyin', 'tiktok'])).toEqual(['tiktok'])
  expect(await pane.lit('sound', ['on', 'off'])).toEqual(['on'])
  expect(await pane.lit('live', ['show', 'skip'])).toEqual(['show'])
  expect(await pane.lit('delay', ['3', '8', '15', '30'])).toEqual(['8'])
  expect(await pane.lit('here', ['on', 'off'])).toEqual(['on'])

  await pane.press('sound-off')
  await pane.press('live-skip')
  await pane.press('delay-15')
  await pane.press('here-off')
  expect(world.settings()).toMatchObject({ sound: 'off', live: 'skip', delaySec: 15, excluded: ['/proj/shop'] })
  pane = await world.pane($)
  expect(await pane.lit('sound', ['on', 'off'])).toEqual(['off'])
  expect(await pane.lit('live', ['show', 'skip'])).toEqual(['skip'])
  expect(await pane.lit('delay', ['3', '8', '15', '30'])).toEqual(['15'])
  expect(await pane.lit('here', ['on', 'off'])).toEqual(['off'])

  // A value no button offers, set by command, lights none and shows in the row's label.
  await $.command.run({ command: 'worknt', args: 'delay 20' } as never)
  pane = await world.pane($)
  expect(await pane.lit('delay', ['3', '8', '15', '30'])).toEqual([])
  expect(await pane.has(/20 秒/)).toBe(true)

  await pane.press('doctor-run')
  pane = await world.pane($)
  expect(await pane.has(/awake: true/)).toBe(true)
})

test('T-1: a setting changed in another session shows in this one\'s open pane', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await $.command.run({ command: 'worknt', args: '' } as never)
  await typedTurn($, world)
  world.clock.advance(1000)
  world.files.set(`${ROOT}/settings.json`, { text: JSON.stringify({ ...READY, sound: 'off' }), mtimeMs: world.clock.now() + 1 })
  await world.clock.advance(4000)
  expect(await (await world.pane($)).lit('sound', ['on', 'off'])).toEqual(['off'])
})

test('X-4: a reset ends the break, forgets every setting, and empties the logs', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await watching($, world)
  world.files.set(`${ROOT}/logs/sess-b.log`, { text: '2026-01-05T02:00:00.000Z something another session noted\n', mtimeMs: NOW })
  expect(world.log()).toContain('slack start')

  await $.command.run({ command: 'worknt', args: 'reset' } as never)
  expect(world.app.want?.mode).toBe('rest')
  expect(world.settings()).toMatchObject({ site: null, sound: null, lang: null, hasSeenWelcome: false })
  expect(world.files.get(`${ROOT}/logs/sess-b.log`)?.text).toBe('')
  expect(world.log()).not.toContain('slack start')
})

test('/worknt go: the break starts now, with nobody working, and plays until the person is done with it', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  expect((await $.command.run({ command: 'worknt', args: 'go' } as never)).text).toBe('正在打开TikTok')
  await world.clock.advance(2500)
  expect(world.app.want?.mode).toBe('play')
  expect((await $.command.run({ command: 'worknt', args: 'go' } as never)).text).toBe('已经开着了。')

  // Twenty quiet minutes on, it is still up: nobody was working to begin with.
  world.app.acts = []
  await world.clock.advance(20 * 60_000)
  expect(world.report().claim).not.toBeNull()
  expect(world.log()).toContain('by command')

  // A turn that comes and goes meanwhile calls the person back as any break does.
  await typedTurn($, world)
  await endTurn($, world)
  await world.clock.advance(1500)
  expect(world.app.want?.card?.title).toBe('Claude 跑完了')
})

test('/worknt go: asks what is not yet chosen first, and says so when switched off', async ($, on) => {
  const world = makeApp(on)
  await start($, world)
  expect((await $.command.run({ command: 'worknt', args: 'go' } as never)).text).toContain('Pick a language')
  let band = await world.band($)
  expect(band.buttons).toEqual(['lang-zh', 'lang-en'])
  await band.press('lang-zh')
  await (await world.band($)).press('site-tiktok')
  await (await world.band($)).press('sound-on')
  await world.clock.advance(2500)
  expect(world.app.want?.mode).toBe('play')

  await $.command.run({ command: 'worknt', args: 'off' } as never)
  expect((await $.command.run({ command: 'worknt', args: 'go' } as never)).text).toBe('Workn’t 关着。先运行 /worknt on。')
})

test('R-4: a kept tab the person wandered off the feed in is taken back to the feed when a break is asked for again', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await watching($, world)
  await (await world.band($)).press('give-up')
  expect(world.browserCalls('navigate')).toHaveLength(1)

  // Left alone with the kept page, the person clicked into a live room. Then: the way back in.
  world.app.health = 'elsewhere'
  await (await world.band($)).press('accept')
  await world.clock.advance(1500)
  expect(world.browserCalls('navigate')).toHaveLength(2)
  expect(world.browserCalls('navigate')[1]?.args.url).toBe('https://www.tiktok.com/foryou')
  expect(world.app.want?.mode).not.toBe('play')
  world.app.health = 'feed'
  await world.clock.advance(2500)
  expect(world.app.want?.mode).toBe('play')
})

test('C-14: "leave me alone" keeps the card away for the rest of this round, says so once, and the next finished turn calls again', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await watching($, world)
  await endTurn($, world)
  await world.clock.advance(1500)
  const card = world.app.want?.card?.id ?? ''
  expect(world.app.want?.mode).toBe('card')

  world.app.acts = [{ n: 1, id: 'free', arg: card }]
  await world.clock.advance(2500)
  expect(world.app.want).toMatchObject({ mode: 'play', card: null, toast: { text: '行，这轮不管你了。' } })
  expect((await world.band($)).text).toContain('摸鱼中')

  // Nobody is working, twenty minutes go by, and the break is still theirs.
  await world.clock.advance(20 * 60_000)
  expect(world.report().claim).not.toBeNull()
  expect(world.app.want).toMatchObject({ mode: 'play', card: null, toast: null })

  // A new turn, finished: that is a new round.
  await typedTurn($, world, 't2')
  await endTurn($, world, 't2')
  await world.clock.advance(1500)
  expect(world.app.want?.mode).toBe('card')
  expect(world.app.want?.card?.id).not.toBe(card)
})

// ---- random walks ---------------------------------------------------------------------
//
// The tests above are scripts somebody thought of. These are not: each walk takes a few dozen
// steps chosen by a seeded die (turns starting and ending, buttons, commands, the tab closed,
// the pane hidden, another session taking the video, the page changing under us) and after
// every step checks the things that must hold whatever happened.

const rng = (seed: number) => {
  let s = seed >>> 0
  return (): number => {
    s = (s + 0x6d2b79f5) >>> 0
    let t = s
    t = Math.imul(t ^ (t >>> 15), t | 1)
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61)
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296
  }
}

const SITE_ORIGINS = ['https://tiktok.com', 'https://douyin.com']

async function walk($: any, on: On, seed: number, steps: number, withFaults: boolean): Promise<void> {
  const world = makeApp(on, { settings: READY })
  const { app, clock, tabs } = world
  const die = rng(seed)
  const pick = <T,>(list: readonly T[]): T => list[Math.floor(die() * list.length)] as T
  const trail: string[] = []
  let turn: string | null = null
  let turns = 0
  let actN = 0
  let produced = 0
  let other: Report | null = null
  let openingFor = 0
  let keptFor = 0

  await start($, world)

  const siteTabs = () => tabs.filter(tab => SITE_ORIGINS.includes(tab.origin))
  const act = (id: string, arg?: string): void => {
    actN += 1
    app.acts = [...app.acts, arg === undefined ? { n: actN, id } : { n: actN, id, arg }]
  }
  const command = async (args: string): Promise<void> => {
    await $.command.run({ command: 'worknt', args } as never)
    await clock.settle()
  }

  const moves: Record<string, () => Promise<void>> = {
    async typed() {
      if (turn !== null) return
      turn = `t${++turns}`
      await typedTurn($, world, turn)
    },
    async woke() {
      if (turn !== null) return
      turn = `t${++turns}`
      await $.prompt.submit({ text: '', origin: { kind: 'task-notification' } } as never)
      await $.turn.start({ text: '', turnId: turn })
      await clock.settle()
    },
    async ends() {
      if (turn === null) return
      const how = pick(['answer', 'answer', 'answer', 'error', 'aborted'])
      await $.turn.complete({ reason: how, turnId: turn, answer: 'done', durationMs: 5000, isAborted: how === 'aborted' })
      await clock.settle()
      turn = null
    },
    async waits() { await clock.advance(pick([1000, 9000, 30_000, 90_000])) },
    async waitsLong() { await clock.advance(11 * 60_000) },
    async button() {
      const band = await world.band($)
      if (band.buttons.length > 0) await band.press(pick(band.buttons))
    },
    async go() { await command('go') },
    async setting() { await command(pick(['sound on', 'sound off', 'live skip', 'live show', 'quiet', 'quiet off', 'here off', 'here on', 'delay 3', 'idle 2', 'bill', 'doctor', '', 'lang zh'])) },
    async onOff() { await command(pick(['off', 'on', 'on'])) },
    async otherSite() { await command(pick(['douyin', 'tiktok'])) },
    async watches() {
      // The page counts only while it is really playing.
      if (app.want?.mode === 'play' && !app.want.hold && app.hasLibrary && app.health === 'feed' && world.report().claim !== null) {
        const more = 1 + Math.floor(die() * 3)
        app.videos += more
        app.watchMs += more * 8000
        produced += more
      }
    },
    async pagePress() {
      if (!app.hasLibrary || app.want === null) return
      if (app.want.mode === 'card') act(pick(['back', 'more', 'more', 'free']), app.want.card?.id)
      else if (app.want.mode === 'play') act(pick(['set', 'set', 'back', 'skip']), pick(['sound on', 'sound off', 'live skip', 'bogus thing']))
      else if (app.want.mode === 'plain') act('home')
    },
    async closesTab() {
      const tab = siteTabs()[0]
      if (tab === undefined) return
      tabs.splice(tabs.indexOf(tab), 1)
      app.hasLibrary = false
      app.want = null
      app.acts = []
      app.videos = 0
      app.watchMs = 0
    },
    async hidesPane() { app.isPaneShown = !app.isPaneShown },
    async leavesScreen() { app.isOnScreen = !app.isOnScreen },
    async pageChanges() { app.health = pick(['feed', 'feed', 'feed', 'login', 'verify', 'elsewhere', 'unknown', 'loading']) },
    async otherSession() {
      const status = pick(['working', 'done', 'waiting', 'failed', 'working'] as const)
      const takes = die() < 0.25
      other = {
        v: 1, id: 'sess-b', localId: 'local_b', cwd: '/proj/other', status, wait: status === 'waiting' ? 'approval' : null,
        since: clock.now(), lastMs: 60_000, seq: (other?.seq ?? 0) + (status === 'done' || status === 'failed' ? 1 : 0),
        beat: clock.now(), claim: takes ? clock.now() : null, seen: false,
      }
      world.writeReport(other)
    },
    async otherGoes() {
      if (other === null) return
      other = { ...other, status: 'gone', claim: null, beat: clock.now() }
      world.writeReport(other)
      other = null
    },
    async refusesListing() { if (withFaults) app.isListingRefused = !app.isListingRefused },
    async breaks() { if (withFaults) app.failing = pick(['tabs_select', 'tabs_close', 'javascript_tool', 'navigate', 'tabs_create', 'computer', 'find', null, null]) },
  }
  const names = Object.keys(moves)

  for (let i = 0; i < steps; i += 1) {
    // The last stretch runs without faults, so that whatever they left behind has to have healed by the end.
    if (withFaults && i === steps - 12) {
      app.failing = null
      app.isListingRefused = false
    }
    const name = withFaults && i >= steps - 12 ? pick(names.filter(one => one !== 'breaks' && one !== 'refusesListing')) : pick(names)
    trail.push(name)
    const say = (what: string): string => `seed ${seed}, step ${i} (${trail.slice(-12).join(' > ')}): ${what}`
    await moves[name]?.()
    // Let the mod notice: three seconds, with any other session still alive keeping its file fresh.
    for (let k = 0; k < 3; k += 1) {
      // (Read through a cast: the compiler cannot see that the moves above assign it.)
      const alive = other as Report | null
      if (alive !== null) {
        other = { ...alive, beat: clock.now() }
        world.writeReport(other)
      }
      await clock.advance(1000)
    }

    const report = world.report()
    const band = await world.band($)
    const isMine = report.claim !== null
    const them = other as Report | null
    const isOtherHost = them !== null && them.claim !== null && (report.claim === null || them.claim > report.claim)

    // Nothing in the mod's own queue may throw, whatever happens outside it.
    if (world.log().includes('ERROR job')) throw new Error(say(`a job threw: ${world.log().split('\n').filter(line => line.includes('ERROR')).join(' | ')}`))

    // R-2: one video page, never two.
    if (!withFaults && siteTabs().length > 1) throw new Error(say(`two video tabs: ${JSON.stringify(tabs)}`))
    // R-5: a later claim elsewhere takes it.
    if (isOtherHost && isMine) throw new Error(say('still holding the video after another session took it'))

    // W-12: with no break, the line says nothing about one, and the page is left clean (R-3, R-4).
    if (!isMine) {
      if (/摸鱼中|正在打开|打开得有点慢/.test(band.text)) throw new Error(say(`no break, but the line says "${band.text}"`))
      if (!withFaults && app.hasLibrary && app.want !== null && app.want.mode !== 'rest' && siteTabs().length > 0 && app.health !== 'left') {
        throw new Error(say(`no break, but the page was left in "${app.want.mode}"`))
      }
    }
    // A break shows on the line, unless the page is somewhere the line has nothing to say about (L-4).
    if (isMine && !withFaults && app.want?.mode === 'card' && band.text !== app.want.card?.title) {
      throw new Error(say(`the card says "${app.want.card?.title}", the line says "${band.text}"`))
    }
    // W-2: out of sight is held.
    if (isMine && !withFaults && app.hasLibrary && app.want !== null && app.want.mode !== 'rest' && app.want.mode !== 'hold') {
      const isVisible = app.isPaneShown && app.isOnScreen
      if (band.text !== '' && !/正在打开|打开得有点慢/.test(band.text) && app.want.hold !== !isVisible) throw new Error(say(`visible=${isVisible} but hold=${app.want.hold}`))
    }
    // S-4: nothing stays "opening" for ever.
    openingFor = /正在打开|打开得有点慢/.test(band.text) ? openingFor + 1 : 0
    if (openingFor > 60) throw new Error(say('still opening after sixty steps'))
    // R-3: a kept tab does not outlive its ten minutes by much.
    keptFor = !isMine && siteTabs().length > 0 ? keptFor + (name === 'waitsLong' ? 11 * 60_000 : 3000) : 0
    if (!withFaults && keptFor > 23 * 60_000) throw new Error(say('a video tab is still open long after its break ended'))

    // P-1, P-4: switched on and awake, the model is kept off the video sites; switched off, it is not.
    if (i % 4 === 0) {
      const ran = (await $.tool.call({ tool: `${B}navigate`, url: 'https://www.douyin.com/user/x' } as never)) as { deny?: unknown }
      const isOn = world.settings().isEnabled !== false
      if (isOn && ran.deny === undefined) throw new Error(say('the model was let through to a video site'))
      if (!isOn && ran.deny !== undefined) throw new Error(say('switched off, and the model was still refused'))
      await clock.settle()
    }
  }

  // W-10: every clip the page counted is in the tally once, no more and no less.
  if (!withFaults) {
    await command('off')
    await clock.advance(3000)
    let tallied = 0
    for (const [path, file] of world.files) if (path.includes('/tally/')) tallied += (JSON.parse(file.text) as { videos: number }).videos
    if (tallied !== produced) throw new Error(`seed ${seed}: the page counted ${produced} clips, the tally holds ${tallied} (${trail.join(' > ')})`)
  }
}

for (const seed of [11, 12, 13, 14, 15, 16, 17, 18, 1005, 1039]) {
  test(`random walk ${seed}: whatever the order of events, the things that must always hold do`, async ($, on) => {
    await walk($, on, seed, 60, false)
  })
}

for (const seed of [21, 22, 23, 24]) {
  test(`random walk ${seed}, with outside calls failing: nothing throws, the guard holds, and the line stays truthful`, async ($, on) => {
    await walk($, on, seed, 60, true)
  })
}

test('R-5: another session taking the video ends this one\'s break even while its page is still loading, and the page is never brought out', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await start($, world)
  await typedTurn($, world)
  await world.clock.advance(10_000)
  world.app.health = 'loading'
  await (await world.band($)).press('accept')
  expect(world.report().claim).not.toBeNull()

  world.writeReport({ v: 1, id: 'sess-b', localId: 'local_b', cwd: '/proj/other', status: 'working', wait: null, since: world.clock.now(), lastMs: 0, seq: 0, beat: world.clock.now(), claim: world.clock.now() + 1, seen: true })
  await world.clock.advance(1500)
  expect(world.report().claim).toBeNull()
  expect(world.app.isPaneShown).toBe(true) // as it was: the pane was open on the person's own tab
  expect(world.tabs.find(tab => tab.isActive)?.tabId).toBe('work')
  await world.clock.advance(4000)
  expect(world.log()).toContain('why=moved')
})

test('W-10: a kept page that could not be put to rest still holds the last break\'s numbers; a new break does not count them again', async ($, on) => {
  const world = makeApp(on, { settings: READY })
  await watching($, world)
  world.app.videos = 4
  world.app.watchMs = 30_000
  await world.clock.advance(2500)
  // The page stops answering just as the break is ended, so it is never told to rest.
  world.app.failing = 'javascript_tool'
  await (await world.band($)).press('give-up')
  world.app.failing = null
  expect(world.app.want?.mode).toBe('play')

  await (await world.band($)).press('accept')
  await world.clock.advance(2500)
  world.app.videos = 5
  world.app.watchMs = 38_000
  await world.clock.advance(2500)
  expect((await world.band($)).text).toBe('摸鱼中 0:08 · 1 条')
  await (await world.band($)).press('give-up')
  expect((await $.command.run({ command: 'worknt', args: 'bill' } as never)).text).toContain('你刷了 5 条')
})
