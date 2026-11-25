import type { Copy } from './copy'
import { hostOf, isActive } from './report'
import type { BandView, Card, EndWhy, Note, PageStats, PageWant, Report, Settings, Slack, Toast } from './types'

/**
 * The two decisions the mod makes, as pure functions of what is known right
 * now. Nothing here remembers anything or touches the outside: the same
 * world always gives the same answer, which is what makes the rules testable
 * one by one and lets a reloaded mod pick up exactly where it was (R-8).
 */

/** C-10: a card nobody answers is taken as "back". */
export const CARD_TIMEOUT_MS = 10 * 60_000
/** Section 8: the page has not been on screen for this long. */
export const AWAY_MS = 10 * 60_000
/** Section 8: nobody has been working for this long. */
export const QUIET_MS = 10 * 60_000

const baseName = (path: string): string => path.replace(/\/+$/, '').split('/').pop() || path

/** What to call a session on a card: its title, else its project folder. */
export function titleOf(report: Report, titles: Readonly<Record<string, string>>): string {
  const title = report.localId === null ? undefined : titles[report.localId]
  return title && title.trim() !== '' ? title.trim() : baseName(report.cwd)
}

export type HostWorld = {
  now: number
  me: string
  /** Every living session's report, this one's included. */
  reports: readonly Report[]
  /** Session titles by app id, as far as they are known. */
  titles: Readonly<Record<string, string>>
  settings: Settings
  slack: Slack
  /** Null when the page could not be asked this time. */
  page: PageStats | null
  isTabAlive: boolean
  /** The session is on screen and the browser pane is showing. */
  isVisible: boolean
  copy: Copy
  siteLabel: string
  hasSignedInBefore: boolean
}

export type HostDecision =
  | { kind: 'end'; why: EndWhy }
  /** The page could not be asked: change nothing this time. */
  | { kind: 'wait' }
  | {
      kind: 'page'
      want: PageWant
      band: BandView
      /** Nobody is working and nobody is waiting. */
      isQuiet: boolean
      /** The completion the toast in `want` announces, to remember as shown. */
      toasted: { id: string; seq: number } | null
    }

export function decideHost(w: HostWorld): HostDecision {
  const { slack, page, now, copy } = w

  // Section 8, in order of certainty.
  if (!w.settings.isEnabled) return { kind: 'end', why: 'off' }
  const host = hostOf(w.reports)
  if (host !== null && host.id !== w.me) return { kind: 'end', why: 'moved' }
  if (!w.isTabAlive) return { kind: 'end', why: 'closed' }
  if (page === null) return { kind: 'wait' }
  if (page.health === 'left') return { kind: 'end', why: 'left' }
  if (page.acts.some(act => act.n > slack.ackedActs && act.id === 'back')) return { kind: 'end', why: 'back' }
  if (slack.cardSince > 0 && now - slack.cardSince >= CARD_TIMEOUT_MS) return { kind: 'end', why: 'timeout' }
  if (now - slack.seenAt >= AWAY_MS) return { kind: 'end', why: 'away' }
  if (slack.cardSince === 0 && slack.quietSince > 0 && now - slack.quietSince >= QUIET_MS) return { kind: 'end', why: 'idle' }

  const waiting = w.reports.filter(report => report.status === 'waiting').sort((a, b) => a.since - b.since)
  const working = w.reports.filter(report => report.status === 'working' || report.status === 'self')
  const finished = w.reports
    .filter(report => (report.status === 'done' || report.status === 'failed') && report.since >= slack.startedAt)
    .sort((a, b) => a.since - b.since)
  const isQuiet = waiting.length === 0 && working.length === 0
  const watched = copy.watched(slack.watchMs, slack.videos)

  // Section 7: what, if anything, calls the person back.
  let card: Card | null = null
  const first = waiting[0]
  if (first !== undefined) {
    // C-2
    card = {
      id: `w:${first.id}:${first.since}`,
      title: copy.waiting(first.wait ?? 'approval', first.id === w.me ? null : titleOf(first, w.titles)),
      lines: [watched],
      primary: { id: 'back', label: copy.attend },
      secondary: { id: 'more', label: copy.more[0] ?? '' },
      moreLabels: [...copy.more],
      againLine: copy.again,
    }
  } else if (working.length === 0 && finished.length > 0) {
    // C-1, C-4
    const only = finished.length === 1 ? finished[0] : undefined
    const isMine = only !== undefined && only.id === w.me
    const lines =
      isMine && only !== undefined
        ? only.status === 'done'
          ? [copy.doneOneLine(only.lastMs), watched]
          : [watched]
        : [
            ...finished.map(report => {
              const name = report.id === w.me ? copy.thisSession : titleOf(report, w.titles)
              return report.status === 'done' ? copy.doneRow(name, report.lastMs) : copy.failedRow(name)
            }),
            watched,
          ]
    card = {
      id: `d:${finished.map(report => `${report.id}:${report.seq}`).join(',')}`,
      title: isMine ? (only?.status === 'failed' ? copy.failedOne : copy.doneOne) : copy.doneMany,
      lines,
      primary: { id: 'back', label: copy.back },
      secondary: { id: 'more', label: copy.more[0] ?? '' },
      moreLabels: [...copy.more],
      againLine: copy.again,
    }
  }

  const hold = !w.isVisible

  // Principle 3: anything that is not the feed stays exactly as the site made it.
  if (page.health !== 'feed') {
    let note: Note | null = null
    if (page.health === 'login') {
      note = w.hasSignedInBefore
        ? { id: 'login-again', text: copy.loginAgainNote, action: null }
        : { id: 'login', text: copy.loginNote, action: null }
    } else if (page.health === 'verify') {
      note = { id: 'verify', text: copy.verifyNote, action: null }
    } else if (page.health === 'elsewhere') {
      note = { id: 'elsewhere', text: copy.elsewhereNote, action: { id: 'home', label: copy.home } }
    } else if (page.health === 'unknown') {
      note = { id: 'unknown', text: copy.unknownNote(w.siteLabel), action: null }
    }
    const mode = page.health === 'loading' ? 'hold' : 'plain'
    return {
      kind: 'page',
      want: { mode, hold, card: null, note: mode === 'plain' ? note : null, toast: null },
      // L-4: no card over a sign-in, but the line still says what is true.
      band: card !== null ? { kind: 'card', text: card.title } : { kind: 'none' },
      isQuiet,
      toasted: null,
    }
  }

  if (card !== null) {
    return {
      kind: 'page',
      want: { mode: 'card', hold, card, note: null, toast: null },
      band: { kind: 'card', text: card.title },
      isQuiet,
      toasted: null,
    }
  }

  // C-3: somebody finished while others still work.
  let toast: Toast | null = null
  let toasted: { id: string; seq: number } | null = null
  if (working.length > 0) {
    const fresh = finished.find(report => report.seq > (slack.toasted[report.id] ?? 0))
    if (fresh !== undefined) {
      const name = fresh.id === w.me ? copy.thisSession : titleOf(fresh, w.titles)
      toast = {
        id: `t:${fresh.id}:${fresh.seq}`,
        text: fresh.status === 'done' ? copy.doneToast(name) : copy.failedToast(name),
      }
      toasted = { id: fresh.id, seq: fresh.seq }
    }
  }

  return {
    kind: 'page',
    // C-5: nobody working and nothing to announce means the person stopped it themselves.
    want: { mode: working.length > 0 ? 'play' : 'paused', hold, card: null, note: null, toast },
    band: { kind: 'slack', watchMs: slack.watchMs, videos: slack.videos },
    isQuiet,
    toasted,
  }
}

export type GuestWorld = {
  now: number
  me: Report
  reports: readonly Report[]
  titles: Readonly<Record<string, string>>
  settings: Settings
  /** Today as YYYY-MM-DD. */
  today: string
  /** The person said no to the invitation in the turn now running (I-6). */
  hasDeclined: boolean
}

/** What a session that does not hold the video page shows above its prompt (section 4, W-8). */
export function decideGuest(w: GuestWorld): BandView {
  if (!w.settings.isEnabled) return { kind: 'none' }

  const host = hostOf(w.reports)
  if (host !== null && host.id !== w.me.id) {
    // I-2: no second invitation while the video is already up somewhere.
    return isActive(w.me.status)
      ? { kind: 'elsewhere', title: host.localId === null ? null : (w.titles[host.localId] ?? null), canMove: !host.seen }
      : { kind: 'none' }
  }

  if (w.me.status !== 'working') return { kind: 'none' }
  if (w.now - w.me.since < w.settings.delaySec * 1000) return { kind: 'none' }
  if (w.hasDeclined) return { kind: 'none' }
  if (w.settings.quietDay === w.today) return { kind: 'none' }
  if (w.settings.excluded.includes(w.me.cwd)) return { kind: 'none' }

  return { kind: 'invite' }
}
