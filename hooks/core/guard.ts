import { isSiteUrl, SITES } from './sites'

/**
 * Section 11: while Workn't is on, the model stays off the video sites.
 * Pure functions; the wiring supplies the pane's tabs and applies the verdict.
 */

export const BROWSER_PREFIX = 'mcp__Claude_Browser__'

export type TabInfo = { tabId: string; origin: string; isActive: boolean }

/** Browser tools that act on no tab. */
const TABLESS = new Set(['tabs_context', 'tabs_create', 'preview_list', 'preview_start', 'preview_stop', 'preview_logs'])

const SITE_HOSTS: readonly string[] = Object.values(SITES).flatMap(site => site.hosts)

/** True when any text inside the value names a video site's host. */
function mentionsSite(value: unknown): boolean {
  let text: string
  try {
    text = JSON.stringify(value) ?? ''
  } catch {
    return true
  }
  const lower = text.toLowerCase()
  return SITE_HOSTS.some(host => lower.includes(host))
}

type Step = { name: string; input: Record<string, unknown> }

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
    steps.push({ name: stepName, input: typeof stepInput === 'object' && stepInput !== null ? (stepInput as Record<string, unknown>) : {} })
  }
  return steps
}

/**
 * P-1, W-9. Refuses a browser call of the model's that names a video site
 * anywhere in its arguments, aims at a tab that is on one, or names no tab
 * while the tab in front is on one.
 */
export function judge(tool: string, input: Record<string, unknown>, tabs: readonly TabInfo[]): 'pass' | 'deny' {
  if (!tool.startsWith(BROWSER_PREFIX)) return 'pass'
  const steps = stepsOf(tool, input)
  if (steps === null) return 'deny'

  const front = tabs.find(tab => tab.isActive)
  for (const step of steps) {
    if (mentionsSite(step.input)) return 'deny'
    if (TABLESS.has(step.name)) continue
    const aimed = step.input.tabId
    const tab = aimed === undefined || aimed === null ? front : tabs.find(candidate => candidate.tabId === aimed)
    if (tab !== undefined && isSiteUrl(tab.origin)) return 'deny'
  }
  return 'pass'
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

/** Applies `scrub` to a tool result of text blocks, or to a bare string. Other shapes pass unchanged. */
export function scrubResult(result: unknown): { changed: boolean; result: unknown } {
  if (typeof result === 'string') {
    const next = scrub(result)
    return { changed: next !== result, result: next }
  }
  if (!Array.isArray(result)) return { changed: false, result }
  let changed = false
  const blocks = (result as unknown[]).map(block => {
    if (typeof block !== 'object' || block === null) return block
    const { type, text } = block as { type?: unknown; text?: unknown }
    if (type !== 'text' || typeof text !== 'string') return block
    const next = scrub(text)
    if (next === text) return block
    changed = true
    return { ...(block as object), text: next }
  })
  return { changed, result: blocks }
}
