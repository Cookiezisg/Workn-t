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

/** The tools the mod cannot work without, as the tool list names them (D-3). */
export const NEEDED_TOOLS: readonly string[] = [
  'mcp__Claude_Browser__tabs_context',
  'mcp__Claude_Browser__tabs_create',
  'mcp__Claude_Browser__tabs_select',
  'mcp__Claude_Browser__tabs_close',
  'mcp__Claude_Browser__navigate',
  'mcp__Claude_Browser__javascript_tool',
  'mcp__ccd_view__show_pane',
  'mcp__ccd_view__close_pane',
  'mcp__ccd_window__get_window_layout',
]

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

export async function pane($: $): Promise<Pane | null> {
  const got = await call($, BROWSER, 'tabs_context')
  if (!got.isOk) return null
  const json = firstJson(got.text) as { browserOpen?: unknown; tabs?: unknown } | null
  if (json === null || typeof json !== 'object') return null
  const tabs = Array.isArray(json.tabs)
    ? (json.tabs as { tabId?: unknown; origin?: unknown; isActive?: unknown }[])
        .filter(tab => typeof tab?.tabId === 'string')
        .map(tab => ({ tabId: String(tab.tabId), origin: typeof tab.origin === 'string' ? tab.origin : '', isActive: tab.isActive === true }))
    : []
  return { isOpen: json.browserOpen === true, isShown: /currently displayed/.test(got.text), tabs }
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
 * Opens a tab of our own on `url` without bringing it to the front. Where the
 * pane is closed, the first navigation opens it, hidden, with that tab in it.
 */
export async function openTab($: $, url: string, isPaneOpen: boolean): Promise<string | null> {
  if (!isPaneOpen) {
    const opened = await call($, BROWSER, 'navigate', { url })
    const json = opened.isOk ? (firstJson(opened.text) as { tabId?: unknown } | null) : null
    if (typeof json?.tabId === 'string') return json.tabId
    const now = await pane($)
    return now?.tabs.find(tab => tab.isActive)?.tabId ?? now?.tabs[0]?.tabId ?? null
  }
  const made = await call($, BROWSER, 'tabs_create')
  const json = made.isOk ? (firstJson(made.text) as { tabId?: unknown } | null) : null
  if (typeof json?.tabId !== 'string') return null
  const went = await call($, BROWSER, 'navigate', { url, tabId: json.tabId })
  if (!went.isOk) {
    await call($, BROWSER, 'tabs_close', { tabId: json.tabId })
    return null
  }
  return json.tabId
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
