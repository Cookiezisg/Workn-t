import { atom, read, update } from 'claude-code'
import type { EngineInterface } from 'claude-code'

import type { Band } from '../types'
import { COPY, guessLang } from './core/copy'
import type { Copy } from './core/copy'
import { decideGuest, decideHost } from './core/decide'
import { PAGE_VERSION, isPageStats, statsScript, syncScript } from './core/page'
import type { PageConfig } from './core/page'
import { alive, isActive, newMemory, newReport, reduce } from './core/report'
import type { ReportEvent, ReportMemory } from './core/report'
import { SITES, isSiteUrl } from './core/sites'
import { DEFAULT_SETTINGS } from './core/types'
import type { BandView, Day, EndWhy, Lang, PageStats, PageWant, Report, Settings, SiteId, Slack } from './core/types'
import { addToDay, dayOf, flushLog, loadSettings, newLog, note, paths, readDay, readJson, readReports, saveSettings, writeReport, isReport } from './io/files'
import type { Log, Paths, ReportCache, SettingsCache } from './io/files'
import { NEEDED_TOOLS, closePane, closeTab, exec, giveFocus, layout as readLayout, navigate, openTab, pane as readPane, selectTab, showPane, titles as readTitles } from './io/pane'

/**
 * What one session's copy of the mod does between events: keeps its own
 * report current, and on a timer either offers the invitation (a guest) or
 * runs the video page (the host).
 *
 * One rule holds the whole file together: every piece of state has exactly
 * one place that changes it. The report is changed only by `apply`; the
 * slack record only by `startSlack`, `hostTick` and `endSlack`; the line
 * above the prompt only by `setBand`; the page only by `syncPage`. And all
 * of it runs through one queue, one step at a time.
 */

type $ = EngineInterface
type Timer = { cancel: () => void }

const bandAtom = atom(
  { plugin: 'worknt', key: 'band' } as const,
  { view: { kind: 'none' }, lang: 'en', site: null } as Band,
  { shape: 'band-2' },
)
const slackAtom = atom({ plugin: 'worknt', key: 'slack' } as const, null as Slack | null, { shape: 'slack-2' })

/**
 * Development only. When true, the mod takes button presses from a file and
 * writes its self-report to another on every tick, so it can be driven and
 * watched without a person at the keyboard. Always false in a release.
 */
const DEV_REMOTE = false

/** R-3: how long the tab is kept, paused, after the break ends. */
const LINGER_MS = 10 * 60_000
/** S-4: how long a load may take before the person is asked. */
const SLOW_MS = 15_000
/** However patient the person is, a page that has shown nothing by now is not coming. */
const OPEN_LIMIT_MS = 60_000
/** How long the page may fail to answer before the break is given up. */
const SILENT_MS = 20_000

export type Ctx = {
  /** Resolves when `boot` is over, however it went. */
  booted: Promise<void>
  /** Why the mod is asleep in this session, in the person's language; null when it is awake (D-3). */
  dormant: string | null
  p: Paths | null
  report: Report
  memory: ReportMemory
  settings: SettingsCache | null
  reportCache: ReportCache
  titles: Record<string, string>
  titlesAt: number
  slack: Slack | null
  linger: { tabId: string; site: SiteId; until: number } | null
  lingerTimer: Timer | null
  chain: Promise<unknown>
  loop: Timer | null
  log: Log
  /** The first-use question now on the line, while the person is answering them. */
  setup: 'lang' | 'site' | 'sound' | null
  hasDeclined: boolean
  isAskingQuiet: boolean
  hasFailed: boolean
  lastBand: string
  publishedAt: number
  /** The `want` last sent to the page, as text. */
  sent: string
  /** Counts not yet written to the tally. */
  owed: Day
  owedAt: number
  errors: string[]
  lastPage: PageStats | null
  lastWhy: string
  devN: number
}

export const newCtx = (): Ctx => ({
  booted: Promise.resolve(),
  dormant: null,
  p: null,
  report: newReport('', '', 0),
  memory: newMemory(),
  settings: null,
  reportCache: new Map(),
  titles: {},
  titlesAt: 0,
  slack: null,
  linger: null,
  lingerTimer: null,
  chain: Promise.resolve(),
  loop: null,
  log: newLog(),
  setup: null,
  hasDeclined: false,
  isAskingQuiet: false,
  hasFailed: false,
  lastBand: '',
  publishedAt: 0,
  sent: '',
  owed: { agentMs: 0, watchMs: 0, videos: 0 },
  owedAt: 0,
  errors: [],
  lastPage: null,
  lastWhy: '',
  devN: -1,
})

// ---- small things --------------------------------------------------------------

export const settingsOf = (c: Ctx): Settings => c.settings?.value ?? DEFAULT_SETTINGS

export const langOf = (c: Ctx): Lang => settingsOf(c).lang ?? guessLang()

export const copyOf = (c: Ctx): Copy => COPY[langOf(c)]

export const isAwake = (c: Ctx): boolean => c.dormant === null && c.p !== null && c.report.id !== ''

/** The guard is on wherever the mod is awake and switched on (P-6). */
export const isGuarding = (c: Ctx): boolean => isAwake(c) && settingsOf(c).isEnabled

const fail = (c: Ctx, now: number, what: string, err: unknown): void => {
  const line = `${what}: ${String(err).slice(0, 200)}`
  c.errors.push(`${new Date(now).toISOString().slice(11, 19)} ${line}`)
  if (c.errors.length > 10) c.errors.shift()
  note(c.log, now, `ERROR ${line}`)
}

/** Everything that touches shared state runs here, one job after another. */
export const enqueue = <T,>(c: Ctx, job: () => Promise<T>): Promise<T | undefined> => {
  const run = c.chain.then(job).catch((err: unknown) => {
    fail(c, Date.now(), 'job', err)
    return undefined
  })
  c.chain = run
  return run
}

// ---- the line above the prompt ---------------------------------------------------

async function setBand($: $, c: Ctx, view: BandView): Promise<void> {
  const next: Band = { view, lang: langOf(c), site: settingsOf(c).site }
  const text = JSON.stringify(next)
  if (text === c.lastBand) return
  c.lastBand = text
  await update($, bandAtom, () => next)
}

// ---- this session's report -------------------------------------------------------

async function publish($: $, c: Ctx, now: number): Promise<void> {
  if (c.p === null) return
  c.report = { ...c.report, beat: now }
  c.publishedAt = now
  await writeReport($, c.p, c.report)
}

function saveSlack($: $, c: Ctx): Promise<unknown> {
  const held = c.slack
  return update($, slackAtom, () => held)
}

async function changeSettings($: $, c: Ctx, patch: Partial<Settings>): Promise<void> {
  if (c.p === null) return
  c.settings = await loadSettings($, c.p, c.settings)
  const value = { ...c.settings.value, ...patch }
  await saveSettings($, c.p, value)
  c.settings = await loadSettings($, c.p, null)
}

async function settleTally($: $, c: Ctx, now: number, isForced: boolean): Promise<void> {
  if (c.p === null) return
  if (c.owed.agentMs === 0 && c.owed.watchMs === 0 && c.owed.videos === 0) return
  if (!isForced && now - c.owedAt < 10_000) return
  const owed = c.owed
  c.owed = { agentMs: 0, watchMs: 0, videos: 0 }
  c.owedAt = now
  await addToDay($, c.p, c.report.id, now, owed)
}

// ---- the page -------------------------------------------------------------------

const pageConfig = (c: Ctx, site: SiteId, theme: unknown): PageConfig => {
  const copy = copyOf(c)
  const settings = settingsOf(c)
  return {
    v: PAGE_VERSION,
    site,
    css: SITES[site].css,
    isDark: theme === 'dark' ? true : theme === 'light' ? false : null,
    isMuted: settings.sound === 'off',
    idleMs: settings.idleMin * 60_000,
    copy: { stillThere: copy.stillThere, stay: copy.stay, back: copy.back, lost: copy.lost },
  }
}

async function readTheme($: $): Promise<unknown> {
  try {
    return await $.settings.read({ key: 'theme' } as never)
  } catch {
    return undefined
  }
}

/** Makes the page match `want`. Sends the whole page library, so it is done only when something changed. */
async function syncPage($: $, c: Ctx, slack: Slack, want: PageWant): Promise<PageStats | null> {
  const script = syncScript(pageConfig(c, slack.site, await readTheme($)), { want, ack: slack.ackedActs })
  const got = await exec($, slack.tabId, script)
  if (!isPageStats(got)) return null
  c.sent = JSON.stringify(want)
  return got
}

/** Asks the page how it is, cheaply. Null when it cannot answer; `missing` when it has no library yet. */
async function askPage($: $, slack: Slack): Promise<PageStats | 'missing' | null> {
  const got = await exec($, slack.tabId, statsScript(slack.ackedActs))
  if (got === null) return null
  if (got.missing === true) return 'missing'
  return isPageStats(got) ? got : null
}

// ---- starting and ending a break ---------------------------------------------------

const HOLD: PageWant = { mode: 'hold', hold: true, card: null, note: null, toast: null }
const REST: PageWant = { mode: 'rest', hold: false, card: null, note: null, toast: null }

const dropLinger = (c: Ctx): void => {
  c.lingerTimer?.cancel()
  c.lingerTimer = null
  c.linger = null
}

/** R-3: the kept tab's time is up. Closes it only if it is still ours to close. */
async function closeLinger($: $, c: Ctx): Promise<void> {
  const held = c.linger
  dropLinger(c)
  if (held === null || c.slack !== null) return
  const now = await readPane($)
  const tab = now?.tabs.find(candidate => candidate.tabId === held.tabId)
  if (tab !== undefined && isSiteUrl(tab.origin)) await closeTab($, held.tabId)
}

/** S-1 to S-3: this session takes the video page. */
async function startSlack($: $, c: Ctx): Promise<void> {
  const settings = settingsOf(c)
  const site = settings.site
  if (c.slack !== null || site === null || !isAwake(c)) return
  const now = await $.clock.now()
  const before = await readPane($)
  if (before === null) {
    c.hasFailed = true
    fail(c, now, 'start', 'the browser pane did not answer')
    return
  }
  // S-2: the pane as it stands at this click, to put back later.
  const scene = { isPaneOpen: before.isOpen && before.isShown, activeTab: before.tabs.find(tab => tab.isActive)?.tabId ?? null }

  let tabId: string | null = null
  const kept = c.linger
  if (kept !== null && kept.site === site && before.tabs.some(tab => tab.tabId === kept.tabId && isSiteUrl(tab.origin))) {
    tabId = kept.tabId
  }
  dropLinger(c)
  if (tabId === null) tabId = await openTab($, SITES[site].feedUrl, before.isOpen)
  if (tabId === null) {
    c.hasFailed = true
    fail(c, now, 'start', 'could not open a tab')
    return
  }

  c.hasFailed = false
  c.sent = ''
  c.lastPage = null
  c.slack = {
    startedAt: now,
    site,
    tabId,
    scene,
    stage: 'opening',
    sawLogin: false,
    silentSince: 0,
    openedAt: now,
    patienceMs: 0,
    seenAt: now,
    cardSince: 0,
    cardId: null,
    quietSince: 0,
    toasted: {},
    counted: { load: 0, videos: 0, watchMs: 0 },
    ackedActs: 0,
    watchMs: 0,
    videos: 0,
  }
  c.report = { ...c.report, claim: now, seen: false }
  note(c.log, now, `slack start site=${site} tab=${tabId} paneOpen=${scene.isPaneOpen}`)
  await publish($, c, now)
  await saveSlack($, c)
  await setBand($, c, { kind: 'opening', isSlow: false })
}

/** Section 8 and R-3: lets the video page go and puts things back. The only place a break ends. */
export async function endSlack($: $, c: Ctx, why: EndWhy): Promise<void> {
  const slack = c.slack
  if (slack === null) return
  const now = await $.clock.now()
  c.slack = null
  c.sent = ''
  c.lastWhy = why
  note(c.log, now, `slack end why=${why} watched=${slack.watchMs}ms videos=${slack.videos}`)

  const pane = await readPane($)
  const isTabAlive = pane?.tabs.some(tab => tab.tabId === slack.tabId) === true
  if (isTabAlive && why !== 'left') {
    // R-4: whatever happens next, the page is left an ordinary, paused page.
    await exec($, slack.tabId, syncScript(pageConfig(c, slack.site, undefined), { want: REST, ack: slack.ackedActs }))
    c.linger = { tabId: slack.tabId, site: slack.site, until: now + LINGER_MS }
    c.lingerTimer = $.clock.after(LINGER_MS, () => {
      void enqueue(c, () => closeLinger($, c))
    })
  }
  // S-2: only undo what we did. If our tab is no longer in front, the person has moved on already.
  if (isTabAlive && pane?.tabs.find(tab => tab.isActive)?.tabId === slack.tabId && why !== 'left') {
    const previous = slack.scene.activeTab
    if (previous !== null && previous !== slack.tabId && pane.tabs.some(tab => tab.tabId === previous)) {
      await selectTab($, previous)
    } else if (!slack.scene.isPaneOpen) {
      await closePane($)
    }
  }

  if (why === 'error') c.hasFailed = true
  c.report = { ...c.report, claim: null, seen: false }
  await publish($, c, now)
  await saveSlack($, c)
  await settleTally($, c, now, true)
}

// ---- the two kinds of tick -----------------------------------------------------

async function allReports($: $, c: Ctx, now: number): Promise<Report[]> {
  if (c.p === null) return [c.report]
  const others = (await readReports($, c.p, now, c.reportCache)).filter(report => report.id !== c.report.id)
  return alive([...others, c.report], now)
}

async function refreshTitles($: $, c: Ctx, now: number): Promise<void> {
  if (now - c.titlesAt < 30_000) return
  c.titlesAt = now
  c.titles = await readTitles($)
}

/** S-4, S-5, S-8: once the page has something to show, bring it out. */
async function reveal($: $, c: Ctx, slack: Slack, now: number): Promise<void> {
  await selectTab($, slack.tabId)
  await showPane($)
  const hasFocus = await giveFocus($, slack.tabId)
  slack.stage = 'live'
  slack.seenAt = now
  note(c.log, now, `revealed after ${now - slack.openedAt}ms focus=${hasFocus}`)
}

async function hostTick($: $, c: Ctx, slack: Slack, now: number, reports: Report[]): Promise<void> {
  const pane = await readPane($)
  if (pane === null) {
    // The pane did not answer. That says nothing about the tab, so decide nothing; give up only if it stays silent.
    slack.silentSince = slack.silentSince || now
    if (now - slack.silentSince > SILENT_MS) return endSlack($, c, 'error')
    return
  }
  const layout = await readLayout($)
  if (layout?.localId && layout.localId !== c.report.localId) c.report = { ...c.report, localId: layout.localId }
  const isTabAlive = pane.tabs.some(tab => tab.tabId === slack.tabId)

  let page: PageStats | null = null
  if (isTabAlive) {
    const asked = await askPage($, slack)
    page = asked === 'missing' ? await syncPage($, c, slack, slack.stage === 'opening' || c.sent === '' ? HOLD : (JSON.parse(c.sent) as PageWant)) : asked
  }
  c.lastPage = page
  slack.silentSince = page !== null ? 0 : slack.silentSince || now

  if (slack.stage === 'opening') {
    if (!isTabAlive) return endSlack($, c, 'closed')
    if (page !== null && page.mode !== 'hold') page = (await syncPage($, c, slack, HOLD)) ?? page
    if (page !== null && page.health !== 'loading') {
      await reveal($, c, slack, now)
    } else if (page === null && slack.silentSince > 0 && now - slack.silentSince > SILENT_MS) {
      return endSlack($, c, 'error')
    } else if (now - slack.openedAt > OPEN_LIMIT_MS + slack.patienceMs) {
      return endSlack($, c, 'error')
    } else {
      await setBand($, c, { kind: 'opening', isSlow: now - slack.openedAt > SLOW_MS + slack.patienceMs })
      await saveSlack($, c)
      return
    }
  }

  if (page === null && isTabAlive && slack.silentSince > 0 && now - slack.silentSince > SILENT_MS) {
    return endSlack($, c, 'error')
  }

  const isVisible = pane.isShown && layout?.isOnScreen !== false
  if (isVisible && (page === null || page.framesOk)) slack.seenAt = now

  if (page !== null) {
    // W-10: add only what is new since the last look; a reloaded page starts its counters over.
    if (page.load !== slack.counted.load) slack.counted = { load: page.load, videos: 0, watchMs: 0 }
    const more = { videos: Math.max(0, page.videos - slack.counted.videos), watchMs: Math.max(0, page.watchMs - slack.counted.watchMs) }
    slack.counted = { load: page.load, videos: page.videos, watchMs: page.watchMs }
    slack.videos += more.videos
    slack.watchMs += more.watchMs
    c.owed = { ...c.owed, videos: c.owed.videos + more.videos, watchMs: c.owed.watchMs + more.watchMs }

    // L-3: the sign-in is over. Go to the feed without being asked.
    if (page.health === 'login') slack.sawLogin = true
    else if (slack.sawLogin && page.health !== 'loading' && page.health !== 'verify') {
      slack.sawLogin = false
      if (page.health !== 'feed') {
        await navigate($, slack.tabId, SITES[slack.site].feedUrl)
        await saveSlack($, c)
        return
      }
    }
    if (page.health === 'feed' && !settingsOf(c).signedInOnce.includes(slack.site)) {
      await changeSettings($, c, { signedInOnce: [...settingsOf(c).signedInOnce, slack.site] })
    }
  }

  if (reports.length > 1) await refreshTitles($, c, now)

  const decision = decideHost({
    now,
    me: c.report.id,
    reports,
    titles: c.titles,
    settings: settingsOf(c),
    slack,
    page,
    isTabAlive,
    isVisible,
    copy: copyOf(c),
    siteLabel: SITES[slack.site].label[langOf(c)],
    hasSignedInBefore: settingsOf(c).signedInOnce.includes(slack.site),
  })

  if (decision.kind === 'end') return endSlack($, c, decision.why)
  if (decision.kind === 'wait' || page === null) {
    await saveSlack($, c)
    return
  }

  for (const act of page.acts) {
    if (act.n <= slack.ackedActs) continue
    slack.ackedActs = act.n
    if (act.id === 'home') await navigate($, slack.tabId, SITES[slack.site].feedUrl) // W-5
  }

  const want = decision.want
  const wantedCard = want.card?.id ?? null
  if (JSON.stringify(want) !== c.sent || page.mode !== want.mode || page.cardId !== wantedCard || page.lost) {
    await syncPage($, c, slack, want)
  }
  if (wantedCard !== slack.cardId) {
    slack.cardId = wantedCard
    slack.cardSince = wantedCard === null ? 0 : now
  }
  slack.quietSince = decision.isQuiet ? slack.quietSince || now : 0
  if (decision.toasted !== null) slack.toasted = { ...slack.toasted, [decision.toasted.id]: decision.toasted.seq }
  if (c.report.seen !== isVisible) {
    c.report = { ...c.report, seen: isVisible }
    await publish($, c, now)
  }
  await setBand($, c, decision.band)
  await saveSlack($, c)
}

async function guestTick($: $, c: Ctx, now: number, reports: Report[]): Promise<void> {
  const settings = settingsOf(c)
  if (!settings.isEnabled) return setBand($, c, { kind: 'none' })
  if (c.setup !== null) return setBand($, c, { kind: 'setup', step: c.setup })
  if (c.hasFailed) return setBand($, c, { kind: 'failed' })
  if (c.isAskingQuiet) return setBand($, c, { kind: 'quiet-ask' })

  let view = decideGuest({ now, me: c.report, reports, titles: c.titles, settings, today: dayOf(now), hasDeclined: c.hasDeclined })
  if (view.kind === 'elsewhere') {
    await refreshTitles($, c, now)
    view = decideGuest({ now, me: c.report, reports, titles: c.titles, settings, today: dayOf(now), hasDeclined: c.hasDeclined })
  }
  // Section 13: say hello once, after a first turn has ended and nothing else is on the line.
  if (view.kind === 'none' && !settings.hasSeenWelcome && c.report.seq > 0 && !isActive(c.report.status)) {
    view = { kind: 'welcome' }
  }
  await setBand($, c, view)
}

/** How soon the next tick is due; null when this session has nothing to watch for. */
const nextDelay = (c: Ctx): number | null => {
  if (!isAwake(c)) return null
  if (c.slack !== null) return c.slack.stage === 'opening' || c.slack.cardId !== null ? 1000 : 2000
  if (isActive(c.report.status)) return 2000
  return null
}

function schedule($: $, c: Ctx, ms: number): void {
  c.loop?.cancel()
  c.loop = $.clock.after(ms, () => {
    c.loop = null
    void enqueue(c, () => tick($, c))
  })
}

export async function tick($: $, c: Ctx): Promise<void> {
  if (!isAwake(c) || c.p === null) return
  const now = await $.clock.now()
  c.settings = await loadSettings($, c.p, c.settings)
  const reports = await allReports($, c, now)
  if (c.slack !== null) await hostTick($, c, c.slack, now, reports)
  if (c.slack === null) await guestTick($, c, now, reports)
  if ((isActive(c.report.status) || c.slack !== null) && now - c.publishedAt >= 5000) await publish($, c, now)
  await settleTally($, c, now, false)
  await flushLog($, c.p, c.report.id, c.log, now, DEV_REMOTE)
  if (DEV_REMOTE) await devRemote($, c)
  const delay = nextDelay(c)
  if (delay !== null) schedule($, c, delay)
}

/** Runs a tick as soon as the queue is free. */
export function kick($: $, c: Ctx): void {
  c.loop?.cancel()
  c.loop = null
  void enqueue(c, () => tick($, c))
}

// ---- events from the engine ------------------------------------------------------

/** D-3: finds out where this session is and whether the mod can work here at all. */
export async function boot($: $, c: Ctx): Promise<void> {
  const now = await $.clock.now()
  c.p = await paths($)
  let surfaces: readonly string[] = []
  let tools: string[] = []
  try {
    surfaces = await $.session.surfaces()
    tools = ((await $.tool.list()) as { name: string }[]).map(tool => tool.name)
  } catch (err) {
    fail(c, now, 'boot', err)
  }
  if (c.p !== null) c.settings = await loadSettings($, c.p, null)
  const copy = copyOf(c)
  const missing = NEEDED_TOOLS.filter(name => !tools.includes(name))
  if (c.p === null) c.dormant = 'HOME'
  else if (!surfaces.includes('desktop')) c.dormant = copy.notDesktop
  else if (missing.length > 0) c.dormant = copy.missingTools(missing.map(name => name.replace(/^mcp__/, '')).join(', '))
  else c.dormant = null

  let id = ''
  let cwd = ''
  try {
    id = await $.session.id()
    cwd = await $.session.root()
  } catch (err) {
    fail(c, now, 'boot', err)
  }
  const fresh = newReport(id, cwd, now)
  const previous = c.p !== null && id !== '' ? await readJson($, `${c.p.sessions}/${id}.json`) : null
  c.report = isReport(previous) ? { ...fresh, seq: previous.seq, lastMs: previous.lastMs, localId: previous.localId } : fresh
  note(c.log, now, `boot v${PAGE_VERSION} dormant=${String(c.dormant)} session=${id.slice(0, 8)}`)
  if (!isAwake(c)) return

  // R-8: a reloaded mod finds the break it was running and carries on.
  const held = await read($, slackAtom)
  if (held !== null) {
    c.slack = held
    c.report = { ...c.report, claim: held.startedAt, seen: false }
    note(c.log, now, 'resumed a break after reload')
  }
  const layout = await readLayout($)
  if (layout?.localId) c.report = { ...c.report, localId: layout.localId }
  await publish($, c, now)
  await tick($, c)
}

/** The one place the report changes. */
export async function apply($: $, c: Ctx, event: ReportEvent): Promise<void> {
  if (!isAwake(c)) return
  const before = c.report.status
  const next = reduce(c.report, c.memory, event)
  c.report = next.report
  c.memory = next.memory
  if (event.t === 'turn-start') {
    c.hasDeclined = false
  }
  if (event.t === 'turn-end' && settingsOf(c).isEnabled) {
    c.owed = { ...c.owed, agentMs: c.owed.agentMs + Math.max(0, event.durationMs) }
  }
  if (c.report.status !== before || event.t === 'turn-end') {
    note(c.log, 'now' in event ? event.now : 0, `status ${before} -> ${c.report.status}${c.report.wait ? ` (${c.report.wait})` : ''}`)
    await publish($, c, 'now' in event ? event.now : await $.clock.now())
  }
  await tick($, c)
}

export async function shutdown($: $, c: Ctx): Promise<void> {
  if (!isAwake(c)) return
  await endSlack($, c, 'session-end')
  await closeLinger($, c)
  const now = await $.clock.now()
  c.report = reduce(c.report, c.memory, { t: 'session-end', now }).report
  await publish($, c, now)
  if (c.p !== null) await flushLog($, c.p, c.report.id, c.log, now, true)
  c.loop?.cancel()
  c.loop = null
}

// ---- what the person presses ------------------------------------------------------

export type Press =
  | 'accept'
  | 'decline'
  | 'quiet-yes'
  | 'quiet-no'
  | 'welcome-ok'
  | 'lang-zh'
  | 'lang-en'
  | 'site-douyin'
  | 'site-tiktok'
  | 'sound-on'
  | 'sound-off'
  | 'wait-more'
  | 'give-up'
  | 'retry'

/** I-5, section 13: the invitation was accepted. Asks whatever is still unknown, then opens. */
async function accept($: $, c: Ctx): Promise<void> {
  const settings = settingsOf(c)
  if (settings.declines !== 0) await changeSettings($, c, { declines: 0 })
  if (settings.lang === null) c.setup = 'lang'
  else if (settings.site === null) c.setup = 'site'
  else if (settings.sound === null) c.setup = 'sound'
  else {
    c.setup = null
    await startSlack($, c)
  }
}

export async function press($: $, c: Ctx, what: Press): Promise<void> {
  if (!isAwake(c)) return
  const now = await $.clock.now()
  note(c.log, now, `press ${what}`)
  switch (what) {
    case 'accept':
    case 'retry':
      c.hasFailed = false
      await accept($, c)
      break
    case 'decline': {
      c.hasDeclined = true
      c.setup = null
      const declines = settingsOf(c).declines + 1
      await changeSettings($, c, { declines })
      if (declines >= 3) c.isAskingQuiet = true // I-6
      break
    }
    case 'quiet-yes':
      c.isAskingQuiet = false
      await changeSettings($, c, { quietDay: dayOf(now), declines: 0 })
      break
    case 'quiet-no':
      c.isAskingQuiet = false
      await changeSettings($, c, { declines: 0 })
      break
    case 'welcome-ok':
      await changeSettings($, c, { hasSeenWelcome: true })
      break
    case 'lang-zh':
    case 'lang-en':
      await changeSettings($, c, { lang: what === 'lang-zh' ? 'zh' : 'en' })
      await accept($, c)
      break
    case 'site-douyin':
    case 'site-tiktok':
      await changeSettings($, c, { site: what === 'site-douyin' ? 'douyin' : 'tiktok' })
      await accept($, c)
      break
    case 'sound-on':
    case 'sound-off':
      await changeSettings($, c, { sound: what === 'sound-on' ? 'on' : 'off' })
      await accept($, c)
      break
    case 'wait-more':
      if (c.slack !== null) c.slack.patienceMs += SLOW_MS
      break
    case 'give-up':
      c.hasFailed = false
      c.setup = null
      await endSlack($, c, 'cancel')
      break
  }
  await tick($, c)
}

async function devRemote($: $, c: Ctx): Promise<void> {
  if (c.p === null) return
  const asked = (await readJson($, `${c.p.root}/dev.json`)) as { n?: unknown; press?: unknown } | null
  if (asked !== null && typeof asked.n === 'number' && asked.n !== c.devN) {
    const isFirstLook = c.devN === -1
    c.devN = asked.n
    // A request left over from before this load is not for us.
    if (!isFirstLook && typeof asked.press === 'string') await press($, c, asked.press as Press)
  }
  try {
    await $.fs.write(`${c.p.root}/dev-doctor.txt`, `${await doctor($, c)}\nband: ${c.lastBand}\n`)
  } catch {}
}

// ---- the command ------------------------------------------------------------------

async function doctor($: $, c: Ctx): Promise<string> {
  const now = await $.clock.now()
  const lines: string[] = []
  let version = ''
  try {
    version = String(await $.session.version())
  } catch {
    version = '?'
  }
  lines.push(`Workn't page library v${PAGE_VERSION} · Claude Code ${version}`)
  lines.push(`awake: ${isAwake(c)}${c.dormant ? ` (${c.dormant})` : ''}`)
  lines.push(`session: ${c.report.id.slice(0, 8)} app=${c.report.localId ?? '?'} status=${c.report.status}${c.report.wait ? `/${c.report.wait}` : ''} seq=${c.report.seq}`)
  const settings = settingsOf(c)
  lines.push(`settings: on=${settings.isEnabled} site=${settings.site} sound=${settings.sound} lang=${settings.lang} delay=${settings.delaySec}s idle=${settings.idleMin}min quiet=${settings.quietDay ?? '-'}`)
  if (c.p !== null) {
    const reports = await allReports($, c, now)
    for (const report of reports) {
      lines.push(
        `  ${report.id === c.report.id ? '*' : ' '} ${report.id.slice(0, 8)} ${report.status}${report.wait ? `/${report.wait}` : ''} for ${Math.round((now - report.since) / 1000)}s beat ${Math.round((now - report.beat) / 1000)}s ago${report.claim !== null ? ` HOST seen=${report.seen}` : ''}`,
      )
    }
  }
  const slack = c.slack
  if (slack !== null) {
    lines.push(`break: ${slack.stage} site=${slack.site} tab=${slack.tabId} for ${Math.round((now - slack.startedAt) / 1000)}s card=${slack.cardId ?? '-'} watched=${Math.round(slack.watchMs / 1000)}s/${slack.videos}`)
    const page = c.lastPage
    lines.push(page ? `page: mode=${page.mode} health=${page.health} playing=${page.playing} frames=${page.framesOk} idle=${Math.round(page.inputAgo / 1000)}s lost=${page.lost}` : 'page: no answer')
  } else {
    lines.push(`break: none${c.lastWhy ? ` (last ended: ${c.lastWhy})` : ''}${c.linger ? ` · tab ${c.linger.tabId} kept for ${Math.max(0, Math.round((c.linger.until - now) / 1000))}s` : ''}`)
  }
  lines.push(c.errors.length === 0 ? 'errors: none' : `errors:\n${c.errors.map(line => `  ${line}`).join('\n')}`)
  if (c.p !== null) lines.push(`log: ${c.p.logs}/${c.report.id}.log`)
  return lines.join('\n')
}

export async function command($: $, c: Ctx, args: string): Promise<string> {
  await c.booted
  const copy = copyOf(c)
  const words = args.trim().toLowerCase().split(/\s+/).filter(word => word !== '')
  const [first, second] = words
  if (first === 'doctor') return doctor($, c)
  if (!isAwake(c)) return copy.dormant(c.dormant ?? '?')

  const done = async (text: string): Promise<string> => {
    await enqueue(c, () => tick($, c))
    return text
  }
  const settings = settingsOf(c)
  const label = (site: SiteId | null): string | null => (site === null ? null : SITES[site].label[langOf(c)])

  if (first === undefined || first === 'status') {
    const sound = settings.sound === null ? null : settings.sound === 'on' ? copy.soundOn : copy.soundOff
    return `${copy.status(settings.isEnabled, label(settings.site), sound, settings.delaySec, settings.idleMin)}\n${copy.usage}`
  }
  if (first === 'on' || first === 'off') {
    await enqueue(c, () => changeSettings($, c, { isEnabled: first === 'on' }))
    return done(first === 'on' ? copy.on : copy.off)
  }
  if (first === 'douyin' || first === 'tiktok') {
    await enqueue(c, async () => {
      await changeSettings($, c, { site: first })
      // The page that is up belongs to the other site: let it go rather than restyle it.
      if (c.slack !== null && c.slack.site !== first) await endSlack($, c, 'cancel')
      if (c.linger !== null && c.linger.site !== first) await closeLinger($, c)
    })
    return done(copy.siteSet(SITES[first].label[langOf(c)]))
  }
  if (first === 'sound' && (second === 'on' || second === 'off')) {
    await enqueue(c, async () => {
      await changeSettings($, c, { sound: second })
      c.sent = ''
    })
    return done(copy.soundSet(second === 'on'))
  }
  if (first === 'lang' && (second === 'zh' || second === 'en')) {
    await enqueue(c, async () => {
      await changeSettings($, c, { lang: second })
      c.sent = ''
    })
    return done(COPY[second].langSet)
  }
  if ((first === 'delay' || first === 'idle') && second !== undefined && /^\d+$/.test(second)) {
    const value = Number(second)
    await enqueue(c, () => changeSettings($, c, first === 'delay' ? { delaySec: Math.min(600, value) } : { idleMin: Math.min(120, Math.max(1, value)) }))
    return done(first === 'delay' ? copy.delaySet(Math.min(600, value)) : copy.idleSet(Math.min(120, Math.max(1, value))))
  }
  if (first === 'quiet') {
    const isOff = second === 'off'
    const now = await $.clock.now()
    await enqueue(c, () => changeSettings($, c, { quietDay: isOff ? null : dayOf(now), declines: 0 }))
    return done(isOff ? copy.quietOff : copy.quietOn)
  }
  if (first === 'here' && (second === 'on' || second === 'off')) {
    const cwd = c.report.cwd
    const rest = settings.excluded.filter(item => item !== cwd)
    await enqueue(c, () => changeSettings($, c, { excluded: second === 'off' ? [...rest, cwd] : rest }))
    return done(second === 'off' ? copy.excluded : copy.included)
  }
  if (first === 'bill') {
    if (c.p === null) return copy.billEmpty
    const now = await $.clock.now()
    await enqueue(c, () => settleTally($, c, now, true))
    const today = await readDay($, c.p, dayOf(now), settings.resetAt)
    const yesterday = await readDay($, c.p, dayOf(now - 24 * 60 * 60_000), settings.resetAt)
    const rows: string[] = []
    if (today.agentMs > 0 || today.videos > 0) rows.push(copy.bill(copy.today, today.agentMs, today.watchMs, today.videos))
    if (yesterday.agentMs > 0 || yesterday.videos > 0) rows.push(copy.bill(copy.yesterday, yesterday.agentMs, yesterday.watchMs, yesterday.videos))
    return rows.length === 0 ? copy.billEmpty : rows.join('\n')
  }
  if (first === 'reset') {
    const now = await $.clock.now()
    await enqueue(c, async () => {
      await endSlack($, c, 'cancel')
      await closeLinger($, c)
      c.owed = { agentMs: 0, watchMs: 0, videos: 0 }
      if (c.p !== null) await saveSettings($, c.p, { ...settingsOf(c), isEnabled: true, site: null, sound: null, lang: null, delaySec: 8, idleMin: 5, quietDay: null, declines: 0, excluded: [], hasSeenWelcome: false, signedInOnce: [], resetAt: now })
      if (c.p !== null) c.settings = await loadSettings($, c.p, null)
      c.setup = null
      c.hasFailed = false
      c.isAskingQuiet = false
    })
    return done(COPY[langOf(c)].resetDone)
  }
  return copy.usage
}
