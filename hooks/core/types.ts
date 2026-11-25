/**
 * The vocabulary shared by every part of the mod. Rule numbers in comments
 * (I-1, W-2, ...) refer to docs/spec.md.
 *
 * The types the mod keeps in the engine's session state live in the state
 * contract, `types/index.d.ts`, which the engine requires to stand alone;
 * they are passed on from here so the rest of the code has one place to import from.
 */

import type { BandView, Lang, Linger, Panel, Scene, SiteId, Slack } from '../../types'

export type { BandView, Lang, Linger, Panel, Scene, SiteId, Slack }


/** What one session is doing, as that session itself reports it. */
export type Status =
  /** No turn has run since the mod loaded. */
  | 'idle'
  /** A main turn the person started is running. */
  | 'working'
  /** A main turn is running that nobody typed: a background task came back, a schedule fired. */
  | 'self'
  /** A turn is blocked on the person. */
  | 'waiting'
  | 'done'
  | 'failed'
  | 'interrupted'
  /** The session ended. */
  | 'gone'

export type WaitKind = 'approval' | 'question' | 'plan'

/** One session's file in the shared folder. Only that session writes it. */
export type Report = {
  v: 1
  /** The engine's session id; also the file's name. */
  id: string
  /** The app's id for the session (`local_...`), which other sessions' titles are listed under. */
  localId: string | null
  cwd: string
  status: Status
  wait: WaitKind | null
  /** When `status` began, ms. */
  since: number
  /** How long the main turn that last ended ran, ms. */
  lastMs: number
  /** Counts main turns that ended: tells one completion from the next. */
  seq: number
  /** Last time this session wrote the file while it had something going on, ms. */
  beat: number
  /** When this session took the video page, ms; null when it does not hold it. */
  claim: number | null
  /** While holding the video page: whether it is on screen right now. */
  seen: boolean
}

export type Settings = {
  v: 1
  isEnabled: boolean
  site: SiteId | null
  sound: 'on' | 'off' | null
  lang: Lang | null
  /** What happens to a live stream that comes up in the feed. */
  live: 'show' | 'skip'
  /** I-1: how long a turn runs before the invitation shows, seconds. */
  delaySec: number
  /** W-3: how long without any input counts as walked away, minutes. */
  idleMin: number
  /** I-2: the day (YYYY-MM-DD) invitations are silenced for. */
  quietDay: string | null
  /** I-6: invitations declined in a row. */
  declines: number
  /** T-3: project folders the invitation never shows in. */
  excluded: string[]
  hasSeenWelcome: boolean
  /** L-6: sites the person has been seen signed in to at least once. */
  signedInOnce: SiteId[]
  /** X-4: counts written before this moment are left out of the tally. */
  resetAt: number
}

export const DEFAULT_SETTINGS: Settings = {
  v: 1,
  isEnabled: true,
  site: null,
  sound: null,
  lang: null,
  live: 'show',
  delaySec: 8,
  idleMin: 5,
  quietDay: null,
  declines: 0,
  excluded: [],
  hasSeenWelcome: false,
  signedInOnce: [],
  resetAt: 0,
}

/** What the page's own script says the page is. */
export type Health =
  | 'loading'
  | 'feed'
  | 'login'
  | 'verify'
  /** Same site, another route: a profile, search, a single video. */
  | 'elsewhere'
  /** The feed's address, but nothing we recognise on it. */
  | 'unknown'
  /** Not the site at all any more: the person typed another address. */
  | 'left'

export type PageMode =
  /** Loaded out of sight: paused, silent, nothing drawn. */
  | 'hold'
  | 'play'
  | 'card'
  /** Paused by us with nothing drawn and nothing locked (C-5). */
  | 'paused'
  /** Not the feed: the site exactly as it is, plus at most a small note (principle 3). */
  | 'plain'
  /** We are done with the page: everything of ours removed, video paused (R-3, R-4). */
  | 'rest'

export type CardButton = { id: 'back' | 'more' | 'stay'; label: string }

export type Card = {
  /** Same id, same card: the page keeps its "one more" progress across repeats. */
  id: string
  title: string
  lines: string[]
  primary: CardButton
  secondary: CardButton | null
  /** C-9: the secondary button's label on its 2nd, 3rd... press. */
  moreLabels: string[]
  /** C-14: what the secondary button says once those are used up. Pressing it sends the card away for good. */
  freeLabel: string
  /** What `lines` is replaced by once "one more" has run out. */
  againLine: string
  /** The same from the second extra clip on, with `{n}` for how many there have been. */
  againMany: string
}

export type Note = { id: string; text: string; action: { id: 'home'; label: string } | null }
export type Toast = { id: string; text: string }

export type PageWant = {
  mode: PageMode
  /** True while the page is not on screen as far as the mod can tell (W-2). */
  hold: boolean
  card: Card | null
  note: Note | null
  toast: Toast | null
}

/**
 * Something the person did on the page that the mod must act on. `skip` is the
 * page asking for the key that moves the feed on; `set` carries a choice from
 * the page's menu as `<setting> <value>`; `free` carries the id of the card told to stay away (C-14).
 */
export type PageAct = { n: number; id: 'back' | 'more' | 'stay' | 'home' | 'skip' | 'set' | 'free'; arg?: string }

/** What the page answers every time it is asked. */
export type PageStats = {
  v: number
  /** Changes when the page reloads. */
  load: number
  mode: PageMode
  health: Health
  url: string
  playing: boolean
  /** False while the page is not being painted. */
  framesOk: boolean
  /** Ms since the person last touched the page. */
  inputAgo: number
  videos: number
  watchMs: number
  /** The slide in view is a live stream. */
  live: boolean
  cardId: string | null
  /** A "one more" clip is running. */
  more: boolean
  /** The page's own "still there?" card is up (W-3). */
  idleAsk: boolean
  acts: PageAct[]
  /** The page unlocked itself after losing contact (R-9). */
  lost: boolean
  /** The last fault in the page's own timer step, if there has been one. */
  err: string | null
  /** How many times the page's own step has run: a number that stands still means the page's timer has stopped. */
  steps: number
  /** Why watch time is not being counted right now; empty when it is. */
  why: string
}

/** Why the video page was let go (section 8). */
export type EndWhy =
  | 'back'
  | 'off'
  | 'closed'
  | 'left'
  | 'timeout'
  | 'away'
  | 'idle'
  | 'moved'
  | 'cancel'
  | 'error'
  /** The tab can no longer be driven; a new one is needed. */
  | 'unusable'
  | 'session-end'
  | 'reload'

export type Day = { agentMs: number; watchMs: number; videos: number }
