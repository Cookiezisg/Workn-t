export type Phase = 'idle' | 'armed' | 'showing' | 'frozen' | 'yielded'

/** What the line above the prompt reads. */
export type Band = {
  phase: Phase
  /** Why the feed froze, while `phase` is `frozen`. */
  reason: 'done' | 'approval' | null
  /** How long the turn ran, in ms, once it has ended. */
  agentMs: number
  /** Watched this turn, in ms. */
  watchMs: number
  /** Clips seen this turn. */
  videos: number
  /** The day (YYYY-MM-DD) the person collapsed the line for, or null. */
  hiddenDay: string | null
}

/** The browser tab the feed lives in, kept across hot reloads. */
export type Feed = {
  tabId: string | null
  site: 'douyin' | 'tiktok' | null
}

declare module 'claude-code' {
  interface PluginState {
    worknt: { band: Shaped<Band>; feed: Shaped<Feed> }
  }
}
