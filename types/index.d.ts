/**
 * The state contract: what the mod keeps in the engine's session state, and
 * the types that takes. The engine requires this file to stand alone, so it
 * imports nothing; `hooks/core/types.ts` passes these types on.
 */

export type SiteId = 'douyin' | 'tiktok'
export type Lang = 'zh' | 'en'

/** The pane as it stood when the invitation was accepted (S-2). */
export type Scene = { isPaneOpen: boolean; activeTab: string | null }

/** The host session's own record of the video page. */
export type Slack = {
  startedAt: number
  site: SiteId
  tabId: string
  scene: Scene
  /** `opening` until the page has been revealed. */
  stage: 'opening' | 'live'
  /** L-3: the page asked for a sign-in at some point; once it stops asking, go to the feed. */
  sawLogin: boolean
  /** When the page first could not be asked; 0 while it answers. */
  silentSince: number
  openedAt: number
  /** Extra time the person granted a slow load, ms (S-4). */
  patienceMs: number
  /** Last moment the page was on screen. */
  seenAt: number
  /** When the card now up first appeared; 0 when none. */
  cardSince: number
  cardId: string | null
  /** When nobody has been working since; 0 while somebody is. */
  quietSince: number
  /** Completions already shown as a toast, by session id. */
  toasted: Record<string, number>
  /** Page counters at the last look, to add only what is new. */
  counted: { load: number; videos: number; watchMs: number }
  /** How many of the page's acts have been handled. */
  ackedActs: number
  /** This stretch's totals. */
  watchMs: number
  videos: number
}

/** What the line above the prompt shows. Each is true right now or it is not shown (W-12). */
export type BandView =
  | { kind: 'none' }
  | { kind: 'welcome' }
  | { kind: 'invite' }
  | { kind: 'quiet-ask' }
  | { kind: 'setup'; step: 'lang' | 'site' | 'sound' }
  | { kind: 'opening'; isSlow: boolean }
  | { kind: 'failed' }
  | { kind: 'slack'; watchMs: number; videos: number }
  | { kind: 'card'; text: string }
  | { kind: 'elsewhere'; title: string | null; canMove: boolean }

/** What the line above the prompt reads: the view, and what it needs to word it. */
export type Band = { view: BandView; lang: Lang; site: SiteId | null }

declare module 'claude-code' {
  interface PluginState {
    worknt: {
      band: Shaped<Band>
      /** The host session's record of the video page, kept so a reloaded mod carries on (R-8). */
      slack: Shaped<Slack | null>
    }
  }
}
