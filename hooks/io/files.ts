import type { EngineInterface } from 'claude-code'

import { DEFAULT_SETTINGS } from '../core/types'
import type { Day, Report, Settings, SiteId } from '../core/types'

/**
 * The shared folder every session reads, and the one rule that keeps it
 * safe: a file has exactly one writer. Each session writes only the files
 * named after itself; the settings file is written only when the person
 * changes a setting, which one person does in one place at a time.
 *
 * The engine's file interface cannot delete, so nothing here relies on
 * deleting: stale files are told by their dates and ignored.
 *
 * Nothing in this file throws.
 */

type $ = EngineInterface

export type Paths = { root: string; settings: string; sessions: string; tally: string; logs: string }

export async function paths($: $): Promise<Paths | null> {
  let home: unknown
  try {
    home = (await $.env.get('HOME')) ?? (await $.env.get('USERPROFILE'))
  } catch {
    home = undefined
  }
  if (typeof home !== 'string' || home === '') return null
  const root = `${home.replace(/[\\/]+$/, '')}/.claude/plugins/data/worknt`
  return { root, settings: `${root}/settings.json`, sessions: `${root}/sessions`, tally: `${root}/tally`, logs: `${root}/logs` }
}

async function readText($: $, path: string): Promise<string | null> {
  try {
    const got = (await $.fs.read(path)) as unknown
    return typeof got === 'string' ? got : null
  } catch {
    return null
  }
}

export async function readJson($: $, path: string): Promise<unknown> {
  const text = await readText($, path)
  if (text === null) return null
  try {
    return JSON.parse(text)
  } catch {
    return null
  }
}

export async function writeJson($: $, path: string, value: unknown): Promise<boolean> {
  try {
    await $.fs.write(path, `${JSON.stringify(value)}\n`)
    return true
  } catch {
    return false
  }
}

type Entry = { name: string; mtimeMs: number }

async function list($: $, path: string): Promise<Entry[]> {
  try {
    const got = (await $.fs.list(path)) as { name?: unknown; kind?: unknown; mtimeMs?: unknown }[]
    return got
      .filter(entry => entry?.kind === 'file' && typeof entry.name === 'string')
      .map(entry => ({ name: String(entry.name), mtimeMs: typeof entry.mtimeMs === 'number' ? entry.mtimeMs : 0 }))
  } catch {
    return []
  }
}

// ---- settings ---------------------------------------------------------------

const isSite = (value: unknown): value is SiteId => value === 'douyin' || value === 'tiktok'

const bounded = (value: unknown, min: number, max: number, fallback: number): number =>
  typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.round(value))) : fallback

/** Reads whatever is in the file as settings, filling in and correcting anything that is missing or wrong. */
export function toSettings(raw: unknown): Settings {
  const r = typeof raw === 'object' && raw !== null ? (raw as Record<string, unknown>) : {}
  return {
    v: 1,
    isEnabled: r.isEnabled !== false,
    site: isSite(r.site) ? r.site : null,
    sound: r.sound === 'on' || r.sound === 'off' ? r.sound : null,
    lang: r.lang === 'zh' || r.lang === 'en' ? r.lang : null,
    live: r.live === 'skip' ? 'skip' : 'show',
    delaySec: bounded(r.delaySec, 0, 600, DEFAULT_SETTINGS.delaySec),
    idleMin: bounded(r.idleMin, 1, 120, DEFAULT_SETTINGS.idleMin),
    quietDay: typeof r.quietDay === 'string' ? r.quietDay : null,
    declines: bounded(r.declines, 0, 99, 0),
    excluded: Array.isArray(r.excluded) ? r.excluded.filter((item): item is string => typeof item === 'string') : [],
    hasSeenWelcome: r.hasSeenWelcome === true,
    signedInOnce: Array.isArray(r.signedInOnce) ? r.signedInOnce.filter(isSite) : [],
    resetAt: typeof r.resetAt === 'number' && Number.isFinite(r.resetAt) ? r.resetAt : 0,
  }
}

export type SettingsCache = { mtimeMs: number; value: Settings }

/** The settings as they stand on disk now. Re-reads only when the file has changed, so every session follows a change at once (T-1). */
export async function loadSettings($: $, p: Paths, cache: SettingsCache | null): Promise<SettingsCache> {
  let mtimeMs = -1
  try {
    mtimeMs = ((await $.fs.stat(p.settings)) as { mtimeMs?: number }).mtimeMs ?? 0
  } catch {
    mtimeMs = -1
  }
  if (cache !== null && cache.mtimeMs === mtimeMs) return cache
  if (mtimeMs < 0) return { mtimeMs, value: { ...DEFAULT_SETTINGS } }
  return { mtimeMs, value: toSettings(await readJson($, p.settings)) }
}

export function saveSettings($: $, p: Paths, value: Settings): Promise<boolean> {
  return writeJson($, p.settings, value)
}

// ---- session reports --------------------------------------------------------

export const isReport = (raw: unknown): raw is Report => {
  const r = raw as Partial<Report> | null
  return (
    typeof r === 'object' &&
    r !== null &&
    r.v === 1 &&
    typeof r.id === 'string' &&
    typeof r.cwd === 'string' &&
    typeof r.status === 'string' &&
    typeof r.since === 'number' &&
    typeof r.seq === 'number' &&
    typeof r.beat === 'number' &&
    typeof r.lastMs === 'number' &&
    (r.claim === null || typeof r.claim === 'number')
  )
}

export function writeReport($: $, p: Paths, report: Report): Promise<boolean> {
  return writeJson($, `${p.sessions}/${report.id}.json`, report)
}

export type ReportCache = Map<string, { mtimeMs: number; report: Report | null }>

/** How long a report is worth reading after it was last written. Older ones are sessions long gone. */
const REPORT_MAX_AGE_MS = 24 * 60 * 60_000

/** Every session's report, each file read again only when it has changed. */
export async function readReports($: $, p: Paths, now: number, cache: ReportCache): Promise<Report[]> {
  const out: Report[] = []
  const names = new Set<string>()
  for (const entry of await list($, p.sessions)) {
    if (!entry.name.endsWith('.json') || now - entry.mtimeMs > REPORT_MAX_AGE_MS) continue
    names.add(entry.name)
    const held = cache.get(entry.name)
    if (held !== undefined && held.mtimeMs === entry.mtimeMs) {
      if (held.report !== null) out.push(held.report)
      continue
    }
    const raw = await readJson($, `${p.sessions}/${entry.name}`)
    const report = isReport(raw) ? raw : null
    cache.set(entry.name, { mtimeMs: entry.mtimeMs, report })
    if (report !== null) out.push(report)
  }
  for (const name of [...cache.keys()]) if (!names.has(name)) cache.delete(name)
  return out
}

// ---- the tally ---------------------------------------------------------------

const pad = (n: number): string => (n < 10 ? `0${n}` : String(n))

export function dayOf(ms: number): string {
  const d = new Date(ms)
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`
}

const toDay = (raw: unknown): Day => {
  const r = typeof raw === 'object' && raw !== null ? (raw as Partial<Day>) : {}
  const num = (value: unknown): number => (typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0)
  return { agentMs: num(r.agentMs), watchMs: num(r.watchMs), videos: num(r.videos) }
}

/** Adds to this session's own count for the day. */
export async function addToDay($: $, p: Paths, sessionId: string, now: number, delta: Partial<Day>): Promise<void> {
  const path = `${p.tally}/${dayOf(now)}/${sessionId}.json`
  const held = toDay(await readJson($, path))
  await writeJson($, path, {
    agentMs: held.agentMs + (delta.agentMs ?? 0),
    watchMs: held.watchMs + (delta.watchMs ?? 0),
    videos: held.videos + (delta.videos ?? 0),
  })
}

/** The day's total over every session. Counts written before `since` are left out (a reset). */
export async function readDay($: $, p: Paths, day: string, since: number): Promise<Day> {
  const total: Day = { agentMs: 0, watchMs: 0, videos: 0 }
  for (const entry of await list($, `${p.tally}/${day}`)) {
    if (!entry.name.endsWith('.json') || entry.mtimeMs < since) continue
    const one = toDay(await readJson($, `${p.tally}/${day}/${entry.name}`))
    total.agentMs += one.agentMs
    total.watchMs += one.watchMs
    total.videos += one.videos
  }
  return total
}

// ---- the log -----------------------------------------------------------------

export type Log = { lines: string[]; isDirty: boolean; writtenAt: number }

export const newLog = (): Log => ({ lines: [], isDirty: false, writtenAt: 0 })

/** D-2: state changes and errors only; never what was watched. Kept to the last 400 lines per session. */
export function note(log: Log, now: number, line: string): void {
  log.lines.push(`${new Date(now).toISOString()} ${line}`)
  if (log.lines.length > 400) log.lines.splice(0, log.lines.length - 400)
  log.isDirty = true
}

/** `since` leaves out what was noted before a reset (X-4); the lines begin with their time, so text order is time order. */
export async function flushLog($: $, p: Paths, sessionId: string, log: Log, now: number, isForced: boolean, since = 0): Promise<void> {
  if (!log.isDirty || (!isForced && now - log.writtenAt < 3000)) return
  if (since > 0) {
    const from = new Date(since).toISOString()
    log.lines = log.lines.filter(line => line.slice(0, from.length) >= from)
  }
  log.isDirty = false
  log.writtenAt = now
  try {
    await $.fs.write(`${p.logs}/${sessionId}.log`, log.lines.length === 0 ? '' : `${log.lines.join('\n')}\n`)
  } catch {
    log.isDirty = true
  }
}

/**
 * X-4: empties every session's log. The one place a session writes files that
 * are not its own: a reset is the person's doing, in one place, once.
 */
export async function clearLogs($: $, p: Paths): Promise<void> {
  for (const entry of await list($, p.logs)) {
    if (!entry.name.endsWith('.log')) continue
    try {
      await $.fs.write(`${p.logs}/${entry.name}`, '')
    } catch {}
  }
}
