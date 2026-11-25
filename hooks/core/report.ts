import type { Report, Status, WaitKind } from './types'

/**
 * Turns the engine's events for one session into that session's status.
 * Pure: the same events always give the same report.
 */

export type ReportEvent =
  /** A prompt entered the session. `origin` is the engine's own stamp. */
  | { t: 'prompt'; origin: string }
  | { t: 'turn-start'; now: number }
  | { t: 'turn-end'; now: number; reason: string; isAborted: boolean; durationMs: number }
  /** Something began that only the person can finish. `key` pairs it with its end. */
  | { t: 'wait-start'; now: number; kind: WaitKind; key: string }
  | { t: 'wait-end'; now: number; key: string }
  | { t: 'session-end'; now: number }

/** What a session remembers between events and does not publish. */
export type ReportMemory = {
  /** The person submitted a prompt that no turn has started on yet. */
  isPersonPending: boolean
  /** The status to return to when the last wait ends. */
  running: 'working' | 'self'
  waits: { key: string; kind: WaitKind }[]
}

export const newMemory = (): ReportMemory => ({ isPersonPending: false, running: 'working', waits: [] })

export const newReport = (id: string, cwd: string, now: number): Report => ({
  v: 1,
  id,
  localId: null,
  cwd,
  status: 'idle',
  wait: null,
  since: now,
  lastMs: 0,
  seq: 0,
  beat: now,
  claim: null,
  seen: false,
})

/** Origins that mean a person asked for this turn (I-1, I-2). */
const PERSON_ORIGINS = new Set(['composer', 'bridge'])

export function reduce(report: Report, memory: ReportMemory, event: ReportEvent): { report: Report; memory: ReportMemory } {
  switch (event.t) {
    case 'prompt':
      return PERSON_ORIGINS.has(event.origin)
        ? { report, memory: { ...memory, isPersonPending: true } }
        : { report, memory }

    case 'turn-start': {
      const running = memory.isPersonPending ? 'working' : 'self'
      return {
        report: { ...report, status: running, wait: null, since: event.now, beat: event.now },
        memory: { isPersonPending: false, running, waits: [] },
      }
    }

    case 'wait-start': {
      if (report.status !== 'working' && report.status !== 'self' && report.status !== 'waiting') {
        return { report, memory }
      }
      const waits = [...memory.waits.filter(wait => wait.key !== event.key), { key: event.key, kind: event.kind }]
      return {
        report: { ...report, status: 'waiting', wait: event.kind, since: report.status === 'waiting' ? report.since : event.now, beat: event.now },
        memory: { ...memory, waits },
      }
    }

    case 'wait-end': {
      if (report.status !== 'waiting') return { report, memory }
      const waits = memory.waits.filter(wait => wait.key !== event.key)
      if (waits.length === memory.waits.length) return { report, memory }
      const last = waits[waits.length - 1]
      return {
        report: last
          ? { ...report, wait: last.kind, beat: event.now }
          : { ...report, status: memory.running, wait: null, since: event.now, beat: event.now },
        memory: { ...memory, waits },
      }
    }

    case 'turn-end': {
      if (report.status !== 'working' && report.status !== 'self' && report.status !== 'waiting') {
        return { report, memory }
      }
      const status: Status =
        event.isAborted || event.reason === 'aborted' ? 'interrupted' : event.reason === 'answer' ? 'done' : 'failed'
      return {
        report: { ...report, status, wait: null, since: event.now, lastMs: Math.max(0, event.durationMs), seq: report.seq + 1, beat: event.now },
        memory: { ...memory, waits: [] },
      }
    }

    case 'session-end':
      return {
        report: { ...report, status: 'gone', wait: null, since: event.now, beat: event.now, claim: null, seen: false },
        memory: { ...memory, waits: [] },
      }
  }
}

/** A session with something going on must keep its file fresh; one that has gone quiet need not. */
export const isActive = (status: Status): boolean => status === 'working' || status === 'self' || status === 'waiting'

/** How stale an active session's heartbeat may be before the session is taken for dead (R-7). */
export const BEAT_LIMIT_MS = 20_000

/** Drops what can no longer be true: active sessions that stopped writing, and sessions that ended. */
export function alive(reports: readonly Report[], now: number): Report[] {
  return reports.filter(report => {
    if (report.status === 'gone') return false
    if (isActive(report.status) || report.claim !== null) return now - report.beat <= BEAT_LIMIT_MS
    return true
  })
}

/** The session holding the video page: the latest claim among the living (R-2, R-5). */
export function hostOf(reports: readonly Report[]): Report | null {
  let host: Report | null = null
  for (const report of reports) {
    if (report.claim === null) continue
    if (host === null || report.claim > (host.claim ?? 0) || (report.claim === host.claim && report.id > host.id)) {
      host = report
    }
  }
  return host
}
