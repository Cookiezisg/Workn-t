import type { EngineInterface } from 'claude-code'

import type { TabInfo } from '../core/guard'
import { FOCUS_LABEL, focusTargetScript } from '../core/page'

/**
 * Everything the mod does to the app goes through here, over the engine's
 * direct MCP road. That road is not a tool call: it raises no tool hooks,
 * the person's own included (R-11), and the guard never sees it.
 *
 * Nothing in this file throws. A call that fails answers `null` or `false`,
 * and the caller decides what that means.
 */

type $ = EngineInterface

const BROWSER = 'Claude_Browser'
const VIEW = 'ccd_view'
const WINDOW = 'ccd_window'
const SESSIONS = 'ccd_session_mgmt'

/** The first JSON object or array in a tool's text, which wraps it in notes. */
export function firstJson(text: string | undefined): unknown {
  if (!text) return null
  const start = text.search(/[{[]/)
  if (start < 0) return null
  const open = text[start]
  const close = open === '{' ? '}' : ']'
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
    else if (ch === open) depth += 1
    else if (ch === close) {
      depth -= 1
      if (depth === 0) {
        try {
          return JSON.parse(text.slice(start, i + 1))
        } catch {
          return null
        }
      }
    }
  }
  return null
}

export type Answer = { isOk: boolean; text: string }

export async function call($: $, server: string, tool: string, args: Record<string, unknown> = {}): Promise<Answer> {
  try {
    const got = (await $.mcp.call(server, tool, args)) as { content?: unknown; isError?: unknown }
    const blocks = Array.isArray(got?.content) ? (got.content as { type?: unknown; text?: unknown }[]) : []
    const text = blocks.map(block => (block?.type === 'text' && typeof block.text === 'string' ? block.text : '')).join('\n')
    return { isOk: got?.isError !== true, text }
  } catch (err) {
    return { isOk: false, text: String(err) }
  }
}

export type Pane = { isOpen: boolean; isShown: boolean; tabs: TabInfo[] }

/** Reads a tab listing, as `tabs_context` words it, whoever asked for it. */
export function toPane(text: string): Pane | null {
  const json = firstJson(text) as { browserOpen?: unknown; tabs?: unknown } | null
  if (json === null || typeof json !== 'object' || Array.isArray(json)) return null
  // A listing in a shape this does not know is no listing: better none than one that reads as "no tabs" (P-4).
  if (!Array.isArray(json.tabs) || typeof json.browserOpen !== 'boolean') return null
  const tabs: TabInfo[] = []
  for (const tab of json.tabs as { tabId?: unknown; origin?: unknown; isActive?: unknown }[]) {
    if (typeof tab?.tabId !== 'string') return null
    tabs.push({ tabId: tab.tabId, origin: typeof tab.origin === 'string' ? tab.origin : '', isActive: tab.isActive === true })
  }
  return { isOpen: json.browserOpen === true, isShown: /currently displayed/.test(text), tabs }
}

export async function pane($: $): Promise<Pane | null> {
  const got = await call($, BROWSER, 'tabs_context')
  return got.isOk ? toPane(got.text) : null
}

/**
 * The pane's tabs for the guard, which asks from inside a tool call. Tries
 * the direct road first and the tool road second, and says why when neither
 * answers, so a guard that has to refuse can explain itself (P-4, D-4).
 */
export async function paneForGuard($: $): Promise<{ pane: Pane | null; why: string }> {
  const direct = await call($, BROWSER, 'tabs_context')
  const first = direct.isOk ? toPane(direct.text) : null
  if (first !== null) return { pane: first, why: '' }
  let why = `direct: ${direct.text.slice(0, 160)}`
  try {
    const ran = (await $.tool.call({ tool: 'mcp__Claude_Browser__tabs_context' } as never)) as { text?: unknown; deny?: unknown }
    const second = typeof ran.text === 'string' ? toPane(ran.text) : null
    if (second !== null) return { pane: second, why }
    why += ` | tool: ${String(ran.deny ?? ran.text).slice(0, 160)}`
  } catch (err) {
    why += ` | tool: ${String(err).slice(0, 160)}`
  }
  return { pane: null, why }
}

export type Layout = { localId: string | null; isOnScreen: boolean }

export async function layout($: $): Promise<Layout | null> {
  const got = await call($, WINDOW, 'get_window_layout')
  if (!got.isOk) return null
  const json = firstJson(got.text) as { this_session?: { session_id?: unknown; on_screen?: unknown } } | null
  const mine = json?.this_session
  if (!mine) return null
  return { localId: typeof mine.session_id === 'string' ? mine.session_id : null, isOnScreen: mine.on_screen === true }
}

/** Other sessions' titles by app id. This session is not in the list. */
export async function titles($: $): Promise<Record<string, string>> {
  const got = await call($, SESSIONS, 'list_sessions', { limit: 50 })
  const out: Record<string, string> = {}
  const json = got.isOk ? firstJson(got.text) : null
  if (!Array.isArray(json)) return out
  for (const row of json as { sessionId?: unknown; title?: unknown }[]) {
    if (typeof row?.sessionId === 'string' && typeof row.title === 'string') out[row.sessionId] = row.title
  }
  return out
}

/**
 * Opens a tab of our own on `url` without bringing it to the front. Tries a
 * new tab first; where the pane is closed there is none to be had, and the
 * first navigation opens the pane, hidden, with that tab in it.
 */
export async function openTab($: $, url: string, hasTabs: boolean): Promise<string | null> {
  const made = await call($, BROWSER, 'tabs_create')
  const created = made.isOk ? (firstJson(made.text) as { tabId?: unknown } | null) : null
  if (typeof created?.tabId === 'string') {
    if ((await call($, BROWSER, 'navigate', { url, tabId: created.tabId })).isOk) return created.tabId
    await call($, BROWSER, 'tabs_close', { tabId: created.tabId })
    return null
  }
  // S-3: a navigation that names no tab lands on whichever tab is in front. With tabs open that is the person's
  // own tab, so it is only done where there is none to land on.
  if (hasTabs) return null
  const opened = await call($, BROWSER, 'navigate', { url })
  const json = opened.isOk ? (firstJson(opened.text) as { tabId?: unknown } | null) : null
  if (typeof json?.tabId === 'string') return json.tabId
  if (!opened.isOk) return null
  const now = await pane($)
  return now?.tabs.find(tab => tab.isActive)?.tabId ?? null
}

export async function navigate($: $, tabId: string, url: string): Promise<boolean> {
  return (await call($, BROWSER, 'navigate', { url, tabId })).isOk
}

export async function selectTab($: $, tabId: string): Promise<boolean> {
  return (await call($, BROWSER, 'tabs_select', { tabId })).isOk
}

export async function closeTab($: $, tabId: string): Promise<boolean> {
  return (await call($, BROWSER, 'tabs_close', { tabId })).isOk
}

export async function showPane($: $): Promise<boolean> {
  return (await call($, VIEW, 'show_pane', { pane: 'preview' })).isOk
}

export async function closePane($: $): Promise<boolean> {
  return (await call($, VIEW, 'close_pane', { pane: 'preview' })).isOk
}

/** Runs a script in the tab and answers the object it returned; null when it could not run or answered none. */
export async function exec($: $, tabId: string, script: string): Promise<Record<string, unknown> | null> {
  const got = await call($, BROWSER, 'javascript_tool', { action: 'javascript_exec', tabId, text: script })
  if (!got.isOk) return null
  const json = firstJson(got.text)
  return typeof json === 'object' && json !== null && !Array.isArray(json) ? (json as Record<string, unknown>) : null
}

/**
 * S-8. A page takes the keyboard only from a real click, and a click on the
 * video would pause it. So: lay a transparent button of our own over the
 * page, have the browser click that, and take it away again.
 */
export async function giveFocus($: $, tabId: string): Promise<boolean> {
  if ((await exec($, tabId, focusTargetScript(true))) === null) return false
  let hasFocus = false
  const found = await call($, BROWSER, 'find', { query: FOCUS_LABEL, tabId })
  const ref = found.isOk ? /\[(ref_\d+)\]/.exec(found.text)?.[1] : undefined
  if (ref !== undefined) {
    await call($, BROWSER, 'computer', { action: 'left_click', ref, tabId, action_summary: 'Gives the video page the keyboard' })
  }
  const after = await exec($, tabId, focusTargetScript(false))
  hasFocus = after?.hasFocus === true
  return hasFocus
}

/** Presses one key in the tab, as a keyboard would: the sites move their feed on nothing less. */
export async function pressKey($: $, tabId: string, key: string): Promise<boolean> {
  return (await call($, BROWSER, 'computer', { action: 'key', text: key, tabId, action_summary: 'Moves the feed to the next clip' })).isOk
}

/** Why the direct road's tab listing failed, in the tool's own words; empty when it answered. For the record only. */
export async function paneWhy($: $): Promise<string> {
  const got = await call($, BROWSER, 'tabs_context')
  return got.isOk && toPane(got.text) !== null ? '' : got.text.slice(0, 160)
}
