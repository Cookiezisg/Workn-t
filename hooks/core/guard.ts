import { isSiteUrl, SITES } from './sites'

/**
 * Section 11: while Workn't is on, the model stays off the video sites.
 * Pure functions; the wiring supplies the pane's tabs and applies the verdict.
 */

export const BROWSER_PREFIX = 'mcp__Claude_Browser__'

export type TabInfo = { tabId: string; origin: string; isActive: boolean }

/** Browser tools that act on no tab. */
const TABLESS = new Set(['tabs_context', 'tabs_create', 'preview_list', 'preview_start', 'preview_stop', 'preview_logs'])
/** Of those, the ones that cannot put a tab anywhere either: nothing about them needs looking at afterwards. */
const INERT = new Set(['tabs_context', 'preview_list', 'preview_stop', 'preview_logs'])

const SITE_HOSTS: readonly string[] = Object.values(SITES).flatMap(site => site.hosts)

/** True when any text inside the value names a video site's host. */
function mentionsSite(value: unknown): boolean {
  let text: string
  try {
    text = JSON.stringify(value) ?? ''
  } catch {
    return true
  }
  const plain = fold(text)
  return SITE_HOSTS.some(host => plain.includes(host))
}

/**
 * A browser reads an address more generously than it is written: percent-escapes, full-width letters, an
 * ideographic full stop for a dot, characters that print as nothing. This writes text the way the browser
 * will read it, so that a host spelt any of those ways is still seen.
 */
export function fold(text: string): string {
  return text
    .replace(/\\[tnrfv]/g, '')
    .replace(/%([0-9a-f]{2})/gi, (_, hex: string) => String.fromCharCode(parseInt(hex, 16)))
    .normalize('NFKC')
    .replace(/[\u00ad\u200b-\u200f\u2060\ufeff\s]/g, '')
    .replace(/[\u3002\uff61\uff0e]/g, '.')
    .toLowerCase()
}

type Step = { name: string; input: Record<string, unknown> }

/** False for a call whose verdict cannot depend on which tabs are open: it acts on no tab at all. */
export function needsTabs(tool: string, input: Record<string, unknown>): boolean {
  const steps = stepsOf(tool, input)
  return steps === null || steps.some(step => !TABLESS.has(step.name))
}

function stepsOf(tool: string, input: Record<string, unknown>): Step[] | null {
  const name = tool.slice(BROWSER_PREFIX.length)
  if (name !== 'browser_batch') return [{ name, input }]
  // P-2: a batch is judged step by step. One that cannot be read is refused.
  if (!Array.isArray(input.actions)) return null
  const steps: Step[] = []
  for (const action of input.actions as unknown[]) {
    if (typeof action !== 'object' || action === null) return null
    const { name: stepName, input: stepInput } = action as { name?: unknown; input?: unknown }
    if (typeof stepName !== 'string') return null
    // A step's arguments that cannot be read as arguments cannot be judged either (P-4).
    if (stepInput !== undefined && (typeof stepInput !== 'object' || stepInput === null || Array.isArray(stepInput))) return null
    steps.push({ name: stepName, input: (stepInput ?? {}) as Record<string, unknown> })
  }
  return steps
}

/**
 * P-1, W-9. Refuses a browser call of the model's that names a video site
 * anywhere in its arguments, aims at a tab that is on one, or names no tab
 * while the tab in front is on one.
 */
export type Verdict =
  | 'pass'
  /** It names a video site or aims at a tab that is on one. */
  | 'site'
  /** It names no tab, and the tab in front is the person's video: the model should use a tab of its own (W-9). */
  | 'front'

/** The tab a step would act on: the one it names, else the one in front. A name that is no tab's is no aim at all. */
const targetOf = (step: Step, tabs: readonly TabInfo[]): { tab: TabInfo | undefined; isAimed: boolean } => {
  const aimed = step.input.tabId
  const named = typeof aimed === 'string' && aimed !== '' ? tabs.find(candidate => candidate.tabId === aimed) : undefined
  return named !== undefined ? { tab: named, isAimed: true } : { tab: tabs.find(tab => tab.isActive), isAimed: false }
}

export function judge(tool: string, input: Record<string, unknown>, tabs: readonly TabInfo[]): Verdict {
  if (!tool.startsWith(BROWSER_PREFIX)) return 'pass'
  const steps = stepsOf(tool, input)
  if (steps === null) return 'site'

  for (const step of steps) {
    if (mentionsSite(step.input)) return 'site'
    if (TABLESS.has(step.name)) continue
    const { tab, isAimed } = targetOf(step, tabs)
    if (tab !== undefined && isSiteUrl(tab.origin)) return isAimed ? 'site' : 'front'
  }
  return 'pass'
}

/**
 * P-1, the second look. `judge` sees a call before it runs, and a call can end somewhere it did not say it was
 * going: an address that redirects, a script that moves the page, a batch that navigates and then reads, a tab
 * the person brought to the front while the call waited for permission. So what it comes back with is given
 * to the model only if, as the tabs stand afterwards, it touched no video site:
 * - no tab is on a video site now that was not on one before, and
 * - no tab the call acted on (the one each step names, else the one in front) is on one.
 */
export function landedOnSite(tool: string, input: Record<string, unknown>, before: readonly TabInfo[], after: readonly TabInfo[]): boolean {
  if (!tool.startsWith(BROWSER_PREFIX)) return false
  const steps = stepsOf(tool, input)
  if (steps === null) return true
  if (steps.every(step => INERT.has(step.name))) return false
  const wasOnSite = new Set(before.filter(tab => isSiteUrl(tab.origin)).map(tab => tab.tabId))
  if (after.some(tab => isSiteUrl(tab.origin) && !wasOnSite.has(tab.tabId))) return true
  for (const step of steps) {
    if (TABLESS.has(step.name)) continue
    const { tab } = targetOf(step, after)
    if (tab !== undefined && isSiteUrl(tab.origin)) return true
  }
  return false
}

const PRIVATE = 'Workn’t (private)'

/**
 * P-3. Every browser tool's answer lists the pane's tabs with their titles
 * and addresses. This blanks the ones on a video site, line by line.
 */
export function scrub(text: string): string {
  if (!mentionsSite(text)) return text
  return text
    .split('\n')
    .map(line => {
      if (!mentionsSite(line)) return line
      const listed = /^(\s*[•*-]\s*tabId\s+[^:]+:)/.exec(line)
      if (listed) return `${listed[1]} "${PRIVATE}"`
      const keyed = /^(\s*"(?:origin|url|title)"\s*:\s*)"[^"]*"(,?)\s*$/.exec(line)
      if (keyed) return `${keyed[1]}"${PRIVATE}"${keyed[2]}`
      return line.replace(/"[^"]*"/g, `"${PRIVATE}"`).replace(/[a-z][a-z0-9+.-]*:\/\/[^\s"')]+/gi, PRIVATE)
    })
    .join('\n')
}

/** Applies `scrub` to every piece of text in a tool's answer, whatever shape the answer has. */
export function scrubResult(result: unknown): { changed: boolean; result: unknown } {
  if (typeof result === 'string') {
    const next = scrub(result)
    return { changed: next !== result, result: next }
  }
  if (Array.isArray(result)) {
    let changed = false
    const items = (result as unknown[]).map(item => {
      const one = scrubResult(item)
      changed = changed || one.changed
      return one.result
    })
    return changed ? { changed, result: items } : { changed, result }
  }
  if (typeof result === 'object' && result !== null) {
    let changed = false
    const out: Record<string, unknown> = {}
    for (const [key, value] of Object.entries(result as Record<string, unknown>)) {
      // The bytes of a picture are not text to be read line by line.
      const one = key === 'data' && typeof value === 'string' && value.length > 2000 ? { changed: false, result: value } : scrubResult(value)
      changed = changed || one.changed
      out[key] = one.result
    }
    return changed ? { changed, result: out } : { changed, result }
  }
  return { changed: false, result }
}
