import type { On } from 'claude-code'
import { expect, mock, test } from 'claude-code/testing'

const B = 'mcp__Claude_Browser__'
const FEED = 'tab-feed'
const WORK = 'tab-work'

type Call = Record<string, unknown> & { tool: string }

/**
 * Stands for the browser pane: answers the tools the mod drives it with, and
 * keeps every call so a test can read what the mod did.
 */
function pane(on: On) {
  const calls: Call[] = []
  let active = WORK
  let hasFeed = false
  const stats = { videos: 0, watchMs: 0, action: null, frozen: null, more: false, playing: true, url: 'https://www.tiktok.com/foryou', load: 1 }

  on('tool.call', (_, e) => {
    const call = e as unknown as Call
    calls.push(call)
    const name = call.tool.startsWith(B) ? call.tool.slice(B.length) : call.tool
    let text = 'ok'
    if (name === 'tabs_context') {
      const tabs = [{ tabId: WORK, origin: 'http://localhost:3000', isActive: active === WORK }]
      if (hasFeed) tabs.push({ tabId: FEED, origin: 'https://tiktok.com', isActive: active === FEED })
      text = `${JSON.stringify({ browserOpen: true, tabs })}\nThe Browser pane is currently hidden.`
    } else if (name === 'tabs_create') {
      hasFeed = true
      text = `${JSON.stringify({ tabId: FEED })}\nOpened tab ${FEED} in the background.`
    } else if (name === 'tabs_select') {
      active = String(call.tabId)
    } else if (name === 'javascript_tool') {
      // The page counts on while it plays: by the next question it has seen 3 clips.
      if (String(call.text).includes('"stats"')) Object.assign(stats, { videos: 3, watchMs: 42000 })
      text = `${JSON.stringify(stats, null, 2)}\n\n(captured at origin https://tiktok.com)`
    }

    return { result: { text }, text }
  })

  return { calls, front: () => active }
}

const named = (calls: Call[], name: string): Call[] => calls.filter(call => call.tool === B + name)

test('a turn brings the feed up after the delay and freezes it when the turn ends', { options: { source: 'tiktok', language: 'en', delaySeconds: 8 } }, async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 0, 5, 3) })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'worknt' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId, text: e.text }))
  on('turn.complete', () => ({ text: '' }))
  const browser = pane(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'refactor the parser', turnId: 't1' })
  await clock.advance(7000)
  expect(named(browser.calls, 'navigate')).toHaveLength(0)

  await clock.advance(1500)
  expect(named(browser.calls, 'navigate')[0]?.url).toBe('https://www.tiktok.com/foryou')
  expect(browser.front()).toBe(FEED)
  expect(String(named(browser.calls, 'javascript_tool').at(-1)?.text)).toContain('"play"')

  await clock.advance(60000)
  await $.turn.complete({ reason: 'answer', turnId: 't1', answer: 'done', durationMs: 134000, isAborted: false } as never)
  await clock.settle()
  const frozen = named(browser.calls, 'javascript_tool').find(call => String(call.text).includes('"freeze"'))
  expect(String(frozen?.text)).toContain('Claude is done')
  expect(String(frozen?.text)).toContain('Took 2:14. You watched 3 clips.')
})

test('the model cannot reach the feed tab, alone or inside a batch', { options: { source: 'tiktok', language: 'en', delaySeconds: 0 } }, async ($, on) => {
  const clock = mock.clock(on, { now: Date.UTC(2026, 0, 5, 3) })
  mock.store(on)
  on('command.register', () => ({ value: { command: 'worknt' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))
  on('turn.start', (_, e) => ({ turnId: e.turnId, text: e.text }))
  const browser = pane(on)

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  await $.turn.start({ text: 'go', turnId: 't1' })
  await clock.advance(500)
  expect(browser.front()).toBe(FEED)

  const direct = await $.tool.call({ tool: `${B}javascript_tool`, action: 'javascript_exec', tabId: FEED, text: 'document.cookie' } as never)
  expect((direct as { deny?: string }).deny).toContain('personal video feed')

  const batch = await $.tool.call({
    tool: `${B}browser_batch`,
    actions: [{ name: 'get_page_text', input: { tabId: FEED } }],
  } as never)
  expect((batch as { deny?: string }).deny).toContain('personal video feed')

  // A call that names no tab would land on whatever is in front: the mod
  // fronts another tab first, then lets the call through untouched.
  const loose = await $.tool.call({ tool: `${B}get_page_text` } as never)
  expect((loose as { deny?: string }).deny).toBeUndefined()
  expect(browser.front()).toBe(WORK)
  expect(named(browser.calls, 'get_page_text').at(-1)?.tabId).toBeUndefined()
})

test('the status command answers in the configured language', { options: { source: 'douyin', language: 'zh', delaySeconds: 5 } }, async ($, on) => {
  mock.clock(on)
  mock.store(on)
  on('command.register', () => ({ value: { command: 'worknt' } }))
  on('session.start', (_, e) => ({ cwd: e.cwd }))

  await $.session.start({ cwd: '/', surface: 'desktop', isInteractive: true })
  const { text } = await $.command.run({ command: 'worknt', args: '' } as never)

  expect(text).toContain('开着 · 片源 抖音 · 延迟 5 秒')
})
