import { atom, read, update } from 'claude-code'
import type { EngineInterface, Register } from 'claude-code'

import type { Band, Feed, Phase } from '../types'
import { BOSS_LOG, COPY } from './copy'
import type { Copy, Lang } from './copy'
import { pageScript } from './page'
import type { BossArg, FreezeArg, PageCommand, PageStats, PlayArg } from './page'
import { SITES } from './sites'
import type { Site, SiteId } from './sites'

const BROWSER = 'mcp__Claude_Browser__'
const SHOW_PANE = 'mcp__ccd_view__show_pane'
const CLOSE_PANE = 'mcp__ccd_view__close_pane'
/** Browser tools that act on no tab, so they can never land on the feed. */
/** Development only: a file path the mod writes its transitions to. null in a release. */
const DEBUG_LOG: string | null = null

const TABLESS = new Set([
  'tabs_context',
  'tabs_create',
  'preview_list',
  'preview_start',
  'preview_stop',
  'preview_logs',
])

const EMPTY_BAND: Band = {
  phase: 'idle',
  reason: null,
  agentMs: 0,
  watchMs: 0,
  videos: 0,
  hiddenDay: null,
}

const bandAtom = atom({ plugin: 'worknt', key: 'band' } as const, EMPTY_BAND, {
  shape: 'band-1',
})
const feedAtom = atom(
  { plugin: 'worknt', key: 'feed' } as const,
  { tabId: null, site: null } as Feed,
  { shape: 'feed-1' },
)

type Ran = { deny?: string; isError?: boolean; text?: string }
type Tab = { tabId: string; origin: string; isActive: boolean }
type Tabs = { open: boolean; tabs: Tab[] }
type Day = { agentMs: number; watchMs: number; videos: number }
type Timer = { cancel: () => void }
type $ = EngineInterface

/** The first JSON object in a tool's text answer, which wraps it in notes. */
export function firstJson(text: string | undefined): Record<string, unknown> | null {
  if (!text) return null
  const start = text.indexOf('{')
  if (start < 0) return null
  let depth = 0
  let inString = false
  let isEscaped = false
  for (let i = start; i < text.length; i += 1) {
    const ch = text[i]
    if (inString) {
      if (isEscaped) isEscaped = false
      else if (ch === '\\') isEscaped = true
      else if (ch === '"') inString = false
    } else if (ch === '"') inString = true
    else if (ch === '{') depth += 1
    else if (ch === '}') {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1)) as Record<string, unknown>
        } catch {
          return null
        }
      }
    }
  }
  return null
}

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))

export function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

function systemLang(): Lang {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}

type Ctx = {
  lang: Lang
  copy: Copy
  delayMs: number
  defaultSite: SiteId
  phase: Phase
  reason: 'done' | 'approval' | null
  chain: Promise<unknown>
  armTimer: Timer | null
  pollTimer: Timer | null
  turnStartedAt: number
  frozenAt: number
  startTries: number
  isAwaitingApproval: boolean
  before: { open: boolean; active: string | null } | null
  base: { load: number; videos: number; watchMs: number }
  carried: { videos: number; watchMs: number }
  turn: { videos: number; watchMs: number }
  committed: { videos: number; watchMs: number }
  settings: { isEnabled: boolean; site: SiteId } | null
  ownCalls: Set<string>
  trace: string[]
}

/** Browser work runs one step at a time, in the order asked. */
const queue = <T,>(c: Ctx, job: () => Promise<T>): Promise<T | undefined> => {
  const run = c.chain.then(job).catch((err: unknown) => {
    c.trace.push(`ERROR ${String(err).slice(0, 300)}`)
    return undefined
  })
  c.chain = run
  return run
}

const tool = async ($: $, c: Ctx, input: Record<string, unknown>): Promise<Ran> => {
  const mark = JSON.stringify(input)
  c.ownCalls.add(mark)
  try {
    return (await $.tool.call(input as never)) as Ran
  } catch (err) {
    return { deny: String(err) }
  } finally {
    c.ownCalls.delete(mark)
  }
}

const browser = async ($: $, c: Ctx, name: string, input: Record<string, unknown> = {}): Promise<Ran> => {
  const ran = await tool($, c, { tool: BROWSER + name, ...input })
  if (name !== 'javascript_tool') {
    c.trace.push(`${name} ${JSON.stringify(input).slice(0, 120)} -> ${String(ran.deny ?? ran.text).replace(/\s+/g, ' ').slice(0, 200)}`)
  }
  return ran
}

const load = async ($: $, c: Ctx): Promise<{ isEnabled: boolean; site: SiteId }> => {
  if (c.settings) return c.settings
  const isEnabled = (await $.store.get('enabled')) !== false
  const stored = await $.store.get('source')
  c.settings = { isEnabled, site: stored === 'douyin' || stored === 'tiktok' ? stored : c.defaultSite }
  return c.settings
}

const site = async ($: $, c: Ctx): Promise<Site> => SITES[(await load($, c)).site]

const flush = async ($: $, c: Ctx, note: string): Promise<void> => {
  if (DEBUG_LOG === null) {
    c.trace.length = 0
    return
  }
  c.trace.push(note)
  try {
    await $.fs.write(DEBUG_LOG, `${c.trace.slice(-200).join('\n')}\n`)
  } catch {}
}

const setBand = async ($: $, c: Ctx, patch: Partial<Band> = {}): Promise<unknown> => {
  await flush($, c, `phase=${c.phase} reason=${String(c.reason)} videos=${c.turn.videos} watchMs=${c.turn.watchMs}`)
  return update($, bandAtom, band => ({
    ...band,
    phase: c.phase,
    reason: c.reason,
    watchMs: c.turn.watchMs,
    videos: c.turn.videos,
    ...patch,
  }))
}

const addDay = async ($: $, c: Ctx, delta: Partial<Day>): Promise<void> => {
  const now = await $.clock.now()
  for (const key of [`day:${dayOf(now)}`, 'total']) {
    const held = ((await $.store.get(key)) ?? {}) as Partial<Day>
    await $.store.set(key, {
      agentMs: (held.agentMs ?? 0) + (delta.agentMs ?? 0),
      watchMs: (held.watchMs ?? 0) + (delta.watchMs ?? 0),
      videos: (held.videos ?? 0) + (delta.videos ?? 0),
    })
  }
}

const tabs = async ($: $, c: Ctx): Promise<Tabs> => {
  const answer = firstJson((await browser($, c, 'tabs_context')).text)
  const list = Array.isArray(answer?.tabs) ? (answer.tabs as Tab[]) : []
  return { open: answer?.browserOpen === true, tabs: list }
}

const page = async (
  $: $,
  c: Ctx,
  command: PageCommand,
  arg: FreezeArg | PlayArg | BossArg | null,
): Promise<PageStats | null> => {
  const { tabId } = await read($, feedAtom)
  if (!tabId) return null
  const at = await site($, c)
  const ran = await browser($, c, 'javascript_tool', {
    action: 'javascript_exec',
    tabId,
    text: pageScript({ site: at.id, css: at.css, tips: at.tips }, command, arg),
  })
  if (ran.deny !== undefined || ran.isError === true) {
    c.trace.push(`page ${command} FAILED ${String(ran.deny ?? ran.text).slice(0, 300)}`)
    return null
  }
  const stats = firstJson(ran.text)
  c.trace.push(`page ${command} -> ${String(ran.text).replace(/\s+/g, ' ').slice(0, 260)}`)
  return stats && typeof stats.load === 'number' ? (stats as unknown as PageStats) : null
}

/** Folds the page's counters, which restart when it reloads, into this c.turn's. */
const absorb = async ($: $, c: Ctx, stats: PageStats | null): Promise<void> => {
  if (!stats) return
  if (stats.load !== c.base.load) {
    c.carried = { ...c.turn }
    c.base = { load: stats.load, videos: 0, watchMs: 0 }
  }
  c.turn = {
    videos: c.carried.videos + Math.max(0, stats.videos - c.base.videos),
    watchMs: c.carried.watchMs + Math.max(0, stats.watchMs - c.base.watchMs),
  }
  const delta = { videos: c.turn.videos - c.committed.videos, watchMs: c.turn.watchMs - c.committed.watchMs }
  if (delta.videos > 0 || delta.watchMs > 0) {
    c.committed = { ...c.turn }
    await addDay($, c, delta)
  }
}

const stopPoll = (c: Ctx): void => {
  c.pollTimer?.cancel()
  c.pollTimer = null
}

const disarm = (c: Ctx): void => {
  c.armTimer?.cancel()
  c.armTimer = null
}

/** Finds the feed's tab or makes one, and leaves it on the feed. */
const ensureFeed = async ($: $, c: Ctx): Promise<string | null> => {
  const at = await site($, c)
  const held = await read($, feedAtom)
  let now = await tabs($, c)
  if (c.phase !== 'frozen') {
    c.before = { open: now.open, active: now.tabs.find(tab => tab.isActive)?.tabId ?? null }
  }
  let tabId = held.tabId !== null && now.tabs.some(tab => tab.tabId === held.tabId) ? held.tabId : null
  let mustNavigate = false
  if (tabId === null) {
    if (!now.open) {
      const opened = firstJson((await browser($, c, 'navigate', { url: at.feedUrl })).text)
      tabId = typeof opened?.tabId === 'string' ? opened.tabId : null
      if (tabId === null) {
        now = await tabs($, c)
        tabId = now.tabs.find(tab => tab.isActive)?.tabId ?? now.tabs[0]?.tabId ?? null
      }
    } else {
      const made = firstJson((await browser($, c, 'tabs_create')).text)
      tabId = typeof made?.tabId === 'string' ? made.tabId : null
      mustNavigate = true
    }
  } else if (held.site !== at.id || now.tabs.find(tab => tab.tabId === tabId)?.origin !== at.origin) {
    mustNavigate = true
  }
  if (tabId === null) return null
  if (mustNavigate) {
    await browser($, c, 'navigate', { url: at.feedUrl, tabId })
  }
  await update($, feedAtom, () => ({ tabId, site: at.id }))
  return tabId
}

const schedulePoll = ($: $, c: Ctx): void => {
  stopPoll(c)
  const isFast = c.phase === 'frozen' && c.frozenAt > 0
  c.pollTimer = $.clock.after(isFast ? 1500 : 4000, () => {
    c.pollTimer = null
    void queue(c, async () => {
      if (c.phase !== 'showing' && c.phase !== 'frozen') return
      const stats = await page($, c, 'stats', null)
      await absorb($, c, stats)
      if (stats && c.phase === 'showing' && c.startTries > 0) {
        c.startTries -= 1
        if (!stats.playing && stats.frozen === null && !stats.more) {
          await page($, c, 'play', { intro: null })
        }
      }
      if (stats && c.phase === 'frozen' && stats.action === 'back') {
        await goBack($, c)
      }
      if (c.phase === 'frozen' && (await $.clock.now()) - c.frozenAt > 15 * 60 * 1000) {
        // Nobody is coming back to this card soon: stop asking the page.
        await setBand($, c)
        return
      }
      await setBand($, c)
      if (c.phase === 'showing' || c.phase === 'frozen') schedulePoll($, c)
    })
  })
}

/** Brings the feed up and starts it. */
const show = async ($: $, c: Ctx): Promise<void> => {
  const at = await site($, c)
  const tabId = await ensureFeed($, c)
  if (tabId === null) {
    c.phase = 'idle'
    await setBand($, c)
    return
  }
  await browser($, c, 'tabs_select', { tabId })
  const shown = await tool($, c, { tool: SHOW_PANE, pane: 'preview' })
  c.trace.push(`show_pane -> ${String(shown.deny ?? shown.text).replace(/\s+/g, ' ').slice(0, 200)}`)
  const introKey = `intro:${at.id}`
  const isFirst = (await $.store.get(introKey)) !== true
  let stats = await page($, c, 'play', { intro: isFirst ? c.copy.intro : null })
  if (stats && !at.isFeed(stats.url)) {
    await browser($, c, 'navigate', { url: at.feedUrl, tabId })
    stats = await page($, c, 'play', { intro: isFirst ? c.copy.intro : null })
  }
  if (isFirst && stats) await $.store.set(introKey, true)
  c.base = stats ? { load: stats.load, videos: stats.videos, watchMs: stats.watchMs } : { load: 0, videos: 0, watchMs: 0 }
  c.carried = { ...c.turn }
  c.phase = 'showing'
  c.reason = null
  c.frozenAt = 0
  c.startTries = 4
  await setBand($, c)
  schedulePoll($, c)
}

const trigger = async ($: $, c: Ctx): Promise<void> => {
  if (c.phase !== 'armed') return
  disarm(c)
  await show($, c)
}

const freeze = async ($: $, c: Ctx, why: 'done' | 'approval', agentMs: number): Promise<void> => {
  await absorb($, c, await page($, c, 'stats', null))
  const stats = await page($, c, 'freeze', {
    kind: why,
    title: why === 'done' ? c.copy.doneTitle : c.copy.approvalTitle,
    sub: why === 'done' ? c.copy.doneSub(agentMs, c.turn.videos) : c.copy.approvalSub,
    againSub: c.copy.againSub,
    back: c.copy.back,
    more: c.copy.more,
  })
  await absorb($, c, stats)
  c.phase = 'frozen'
  c.reason = why
  c.frozenAt = await $.clock.now()
  await setBand($, c, why === 'done' ? { agentMs } : {})
  schedulePoll($, c)
}

/** The card's first button: put the pane back the way it was. */
const goBack = async ($: $, c: Ctx): Promise<void> => {
  stopPoll(c)
  const { tabId } = await read($, feedAtom)
  const now = await tabs($, c)
  const other =
    c.before?.active && c.before.active !== tabId && now.tabs.some(tab => tab.tabId === c.before?.active)
      ? c.before.active
      : null
  if (other !== null) {
    await browser($, c, 'tabs_select', { tabId: other })
  } else if (c.before && !c.before.open) {
    const closed = await tool($, c, { tool: CLOSE_PANE, pane: 'preview' })
    c.trace.push(`close_pane -> ${String(closed.deny ?? closed.text).replace(/\s+/g, ' ').slice(0, 200)}`)
  }
  c.phase = 'idle'
  c.frozenAt = 0
}

/** Before a call of the model's that names no tab: make sure the fronted tab is not the feed. */
const yieldToModel = async ($: $, c: Ctx): Promise<void> => {
  const { tabId } = await read($, feedAtom)
  if (tabId === null) return
  const now = await tabs($, c)
  if (!now.tabs.some(tab => tab.tabId === tabId)) {
    await update($, feedAtom, held => ({ ...held, tabId: null }))
    return
  }
  disarm(c)
  if (now.tabs.find(tab => tab.isActive)?.tabId !== tabId) {
    if (c.phase === 'armed') c.phase = 'yielded'
    return
  }
  if (c.phase === 'showing' || c.phase === 'frozen') {
    await absorb($, c, await page($, c, 'park', null))
  }
  stopPoll(c)
  let work = now.tabs.find(tab => tab.tabId !== tabId)?.tabId ?? null
  if (work === null) {
    const made = firstJson((await browser($, c, 'tabs_create')).text)
    work = typeof made?.tabId === 'string' ? made.tabId : null
  }
  if (work !== null) await browser($, c, 'tabs_select', { tabId: work })
  c.phase = 'yielded'
  c.reason = null
  await setBand($, c)
}

const boss = ($: $, c: Ctx): Promise<unknown> =>
  queue(c, async () => {
    if (c.phase !== 'showing' && c.phase !== 'frozen') return
    stopPoll(c)
    await absorb($, c, await page($, c, 'boss', { lines: BOSS_LOG }))
    c.phase = 'idle'
    await setBand($, c)
  })

export const register: Register = (on, options) => {
  const lang: Lang = options.language === 'zh' || options.language === 'en' ? options.language : systemLang()
  // Session-local wiring. A hot reload starts it over; the tab and the band
  // outlive it in $.state, the settings and the tally in $.store.
  const c: Ctx = {
    lang,
    copy: COPY[lang],
    delayMs: Math.max(0, Number(options.delaySeconds ?? 8)) * 1000,
    defaultSite:
      options.source === 'douyin' || options.source === 'tiktok' ? options.source : lang === 'zh' ? 'douyin' : 'tiktok',
    phase: 'idle',
    reason: null,
    chain: Promise.resolve(),
    armTimer: null,
    pollTimer: null,
    turnStartedAt: 0,
    frozenAt: 0,
    startTries: 0,
    isAwaitingApproval: false,
    before: null,
    base: { load: 0, videos: 0, watchMs: 0 },
    carried: { videos: 0, watchMs: 0 },
    turn: { videos: 0, watchMs: 0 },
    committed: { videos: 0, watchMs: 0 },
    settings: null,
    ownCalls: new Set<string>(),
    trace: [],
  }

  on('session.start', async ($, e, next) => {
    await $.command.register({
      name: 'worknt',
      description: c.lang === 'zh' ? 'Claude 干活的时候刷视频：开关、片源、账单' : 'Videos while Claude works: switch, source, tally',
      argumentHint: 'on | off | douyin | tiktok | bill | boss | show',
    })

    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      void queue(c, async () => {
        const now = await $.clock.now()
        c.turnStartedAt = now
        disarm(c)
        c.turn = { videos: 0, watchMs: 0 }
        c.carried = { videos: 0, watchMs: 0 }
        c.committed = { videos: 0, watchMs: 0 }
        c.isAwaitingApproval = false

        const today = dayOf(now)
        if ((await $.store.get('billDay')) !== today) {
          await $.store.set('billDay', today)
          const past = (await $.store.get(`day:${dayOf(now - 24 * 60 * 60 * 1000)}`)) as Day | undefined
          if (past && (past.videos > 0 || past.agentMs > 60000)) {
            $.ui.toast(c.copy.bill(c.copy.yesterday, past.agentMs, past.videos))
          }
        }

        if (!(await load($, c)).isEnabled) {
          c.phase = 'idle'
          await setBand($, c, { agentMs: 0 })
          return
        }
        if (c.phase === 'frozen' || c.phase === 'showing') {
          // Still on the feed from the last c.turn: carry straight on.
          await show($, c)
          return
        }
        c.phase = 'armed'
        c.reason = null
        await setBand($, c, { agentMs: 0 })
        c.armTimer = $.clock.after(c.delayMs, () => {
          c.armTimer = null
          void queue(c, () => trigger($, c))
        })
      })
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const name = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const isBrowser = name.startsWith(BROWSER)

    if (c.ownCalls.size > 0 && (isBrowser || name === SHOW_PANE || name === CLOSE_PANE)) {
      const { tool_use_id: _id, agentId: _agent, requestMeta: _meta, ...rest } = input
      if (c.ownCalls.has(JSON.stringify(rest))) return next(e)
    }

    if (isBrowser) {
      const feed = (await read($, feedAtom)).tabId
      if (feed !== null) {
        const short = name.slice(BROWSER.length)
        const steps: { name: string; tabId: unknown }[] =
          short === 'browser_batch' && Array.isArray(input.actions)
            ? (input.actions as { name?: string; input?: { tabId?: unknown } }[]).map(step => ({
                name: String(step.name),
                tabId: step.input?.tabId,
              }))
            : [{ name: short, tabId: input.tabId }]
        const aimed = steps.filter(step => !TABLESS.has(step.name))
        if (aimed.some(step => step.tabId === feed)) {
          return { deny: c.copy.offLimits(feed) }
        }
        if (aimed.some(step => step.tabId === undefined)) {
          await queue(c, () => yieldToModel($, c))
        } else if (c.phase === 'showing' && aimed.some(step => step.name === 'tabs_select')) {
          // The model is fronting its own tab: the feed would play on unseen.
          await queue(c, async () => {
            await absorb($, c, await page($, c, 'park', null))
            stopPoll(c)
            c.phase = 'yielded'
            await setBand($, c)
          })
        }
      }
    } else if (c.phase === 'armed' && input.agentId === undefined) {
      void queue(c, () => trigger($, c))
    }

    const ran = await next(e)

    if (c.isAwaitingApproval) {
      c.isAwaitingApproval = false
      void queue(c, async () => {
        if (c.phase !== 'frozen' || c.reason !== 'approval') return
        await absorb($, c, await page($, c, 'play', { intro: null }))
        c.phase = 'showing'
        c.reason = null
        c.frozenAt = 0
        await setBand($, c)
        schedulePoll($, c)
      })
    }

    return ran
  }).catch(($, e, next) =>
    // The guard failing must never open the feed to the model, nor stop other tools.
    String(e.tool).startsWith(BROWSER) ? { deny: 'worknt: its tab guard failed, so the browser call was refused.' } : next(e),
  )

  on('classic.PermissionRequest', ($, e, next) => {
    if (c.phase === 'showing') {
      c.isAwaitingApproval = true
      void queue(c, () => freeze($, c, 'approval', 0))
    }

    return next(e)
  }).catch(($, e, next) => next(e))

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      void queue(c, async () => {
        disarm(c)
        const agentMs =
          typeof e.durationMs === 'number'
            ? e.durationMs
            : c.turnStartedAt > 0
              ? Math.max(0, (await $.clock.now()) - c.turnStartedAt)
              : 0
        if (agentMs > 0) await addDay($, c, { agentMs })
        if (c.phase === 'showing' || (c.phase === 'frozen' && c.reason === 'approval')) {
          await freeze($, c, 'done', agentMs)
          return
        }
        if (c.phase === 'armed' || c.phase === 'yielded') c.phase = 'idle'
        await setBand($, c, { agentMs })
      })
    }

    return next(e)
  })

  on('command.run', { command: 'worknt' }, async ($, e) => {
    const word = e.args.trim().toLowerCase()
    const held = await load($, c)

    if (word === 'on' || word === 'off') {
      held.isEnabled = word === 'on'
      await $.store.set('enabled', held.isEnabled)
      if (!held.isEnabled) {
        await queue(c, async () => {
          disarm(c)
          stopPoll(c)
          if (c.phase === 'showing' || c.phase === 'frozen') await absorb($, c, await page($, c, 'park', null))
          c.phase = 'idle'
          await setBand($, c)
        })
      }
      return { text: held.isEnabled ? c.copy.on : c.copy.off }
    }

    if (word === 'douyin' || word === 'tiktok') {
      held.site = word
      await $.store.set('source', word)
      return { text: c.copy.sourceSet(SITES[word].label) }
    }

    if (word === 'bill') {
      const now = await $.clock.now()
      const today = (await $.store.get(`day:${dayOf(now)}`)) as Day | undefined
      const total = (await $.store.get('total')) as Day | undefined
      if (!today && !total) return { text: c.copy.billEmpty }
      return {
        text: [
          c.copy.bill(c.copy.today, today?.agentMs ?? 0, today?.videos ?? 0),
          c.copy.bill(c.copy.total, total?.agentMs ?? 0, total?.videos ?? 0),
        ].join('\n'),
      }
    }

    if (word === 'boss') {
      await boss($, c)
      return { text: '' }
    }

    if (word === 'show') {
      await queue(c, async () => {
        disarm(c)
        await show($, c)
      })
      return { text: c.phase === 'showing' ? '' : c.copy.notDesktop }
    }

    if (word === '' || word === 'status') {
      return { text: `${c.copy.status(held.isEnabled, SITES[held.site].label, Math.round(c.delayMs / 1000))}\n${c.copy.usage}` }
    }

    return { text: c.copy.usage }
  })

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const band = await read($, bandAtom)
    if (e.props.hasSurvey) return next(e)

    let line: string | null = null
    if (band.phase === 'showing') line = c.copy.bandWorking(band.watchMs, band.videos)
    else if (band.phase === 'frozen' && band.reason === 'approval') line = c.copy.bandApproval
    else if (band.phase === 'yielded') line = c.copy.bandYielded
    else if (band.phase !== 'armed' && band.agentMs > 0 && (band.videos > 0 || band.watchMs > 0)) {
      line = c.copy.bandDone(band.agentMs, band.videos)
    }
    if (line === null) return next(e)
    if (band.hiddenDay !== null && band.hiddenDay === dayOf(await $.clock.now())) return next(e)

    const { Box, Button, Text } = $.ui.resolve(e)
    const canBoss = band.phase === 'showing' || band.phase === 'frozen'

    return (
      <Box>
        <Text dimColor>{line}   </Text>
        {canBoss && <Button key="boss" plain label={c.copy.boss} onPress={() => boss($, c)} />}
        {canBoss && <Text dimColor>   </Text>}
        <Button
          key="collapse"
          plain
          label={c.copy.collapse}
          onPress={async () => {
            const today = dayOf(await $.clock.now())
            await update($, bandAtom, held => ({ ...held, hiddenDay: today }))
          }}
        />
      </Box>
    )
  })
}
