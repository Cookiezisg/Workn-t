import { expect, test } from 'claude-code/testing'

import { judge, scrub, scrubResult } from './guard'
import type { TabInfo } from './guard'
import { isSiteUrl } from './sites'

const B = 'mcp__Claude_Browser__'
const FEED: TabInfo = { tabId: 'feed', origin: 'https://douyin.com', isActive: true }
const WORK: TabInfo = { tabId: 'work', origin: 'http://localhost:3000', isActive: false }

test('P-1: the model cannot navigate to a video site, in any spelling', () => {
  for (const url of ['https://www.douyin.com/', 'https://v.douyin.com/abc', 'HTTPS://WWW.TIKTOK.COM/foryou', 'https://m.tiktok.com/@x']) {
    expect(judge(`${B}navigate`, { url, tabId: 'work' }, [WORK])).toBe('deny')
  }
  expect(judge(`${B}navigate`, { url: 'https://example.com/', tabId: 'work' }, [WORK])).toBe('pass')
})

test('P-1: the model cannot read or act on a tab that is on a video site, whoever opened it', () => {
  for (const tool of ['javascript_tool', 'get_page_text', 'read_page', 'computer', 'tabs_select', 'tabs_close', 'find', 'read_network_requests']) {
    expect(judge(B + tool, { tabId: 'feed' }, [FEED, WORK])).toBe('deny')
    expect(judge(B + tool, { tabId: 'work' }, [FEED, WORK])).toBe('pass')
  }
})

test('W-9: a call that names no tab is refused while the tab in front is on a video site', () => {
  expect(judge(`${B}get_page_text`, {}, [FEED, WORK])).toBe('deny')
  expect(judge(`${B}get_page_text`, {}, [{ ...FEED, isActive: false }, { ...WORK, isActive: true }])).toBe('pass')
})

test('P-2: a batch is refused if any one step would be', () => {
  const batch = (actions: unknown): 'pass' | 'deny' => judge(`${B}browser_batch`, { actions }, [{ ...FEED, isActive: false }, { ...WORK, isActive: true }])
  expect(batch([{ name: 'get_page_text', input: { tabId: 'work' } }])).toBe('pass')
  expect(batch([{ name: 'get_page_text', input: { tabId: 'work' } }, { name: 'get_page_text', input: { tabId: 'feed' } }])).toBe('deny')
  expect(batch([{ name: 'navigate', input: { tabId: 'work', url: 'https://www.tiktok.com' } }])).toBe('deny')
  expect(batch('not a list')).toBe('deny')
  expect(batch([{ input: {} }])).toBe('deny')
})

test('P-1: a script that names a video site is refused even on another tab', () => {
  expect(judge(`${B}javascript_tool`, { tabId: 'work', text: 'location.href = "https://www.douyin.com/"' }, [WORK])).toBe('deny')
  expect(judge(`${B}javascript_tool`, { tabId: 'work', text: 'document.title' }, [WORK])).toBe('pass')
})

test('tools that act on no tab pass, and tools of other servers are not the guard\'s business', () => {
  expect(judge(`${B}tabs_context`, {}, [FEED])).toBe('pass')
  expect(judge(`${B}tabs_create`, {}, [FEED])).toBe('pass')
  expect(judge('Bash', { command: 'curl https://www.douyin.com' }, [FEED])).toBe('pass')
})

test('P-3: the tab list in a tool answer loses the video site\'s title and address, and nothing else', () => {
  const text = [
    'navigated to http://localhost:3000',
    '',
    'Tab Context:',
    '- Executed on tabId: work',
    '- Available tabs:',
    '  • tabId work: "My app" ("http://localhost:3000/")',
    '  • tabId feed: "某条视频的标题 - 抖音" ("https://www.douyin.com/?recommend=1")',
  ].join('\n')
  const cleaned = scrub(text)
  expect(cleaned).toContain('• tabId work: "My app" ("http://localhost:3000/")')
  expect(cleaned).toContain('• tabId feed: "Workn’t (private)"')
  expect(cleaned).not.toContain('某条视频')
  expect(cleaned).not.toContain('douyin')
})

test('P-3: the tab listing as JSON loses the origin too', () => {
  const text = '{\n  "browserOpen": true,\n  "tabs": [\n    {\n      "tabId": "feed",\n      "origin": "https://tiktok.com",\n      "isActive": true\n    }\n  ]\n}'
  const cleaned = scrub(text)
  expect(cleaned).not.toContain('tiktok')
  expect(JSON.parse(cleaned).tabs[0].tabId).toBe('feed')
})

test('P-3: text blocks are cleaned, other blocks pass untouched, and an untouched answer is reported unchanged', () => {
  const image = { type: 'image', data: 'xxxx' }
  const dirty = scrubResult([{ type: 'text', text: '• tabId feed: "t" ("https://www.douyin.com/")' }, image])
  expect(dirty.changed).toBe(true)
  expect((dirty.result as unknown[])[1]).toBe(image)
  expect(scrubResult([{ type: 'text', text: 'nothing here' }]).changed).toBe(false)
})

test('a video site is recognised by its host, not by the word appearing somewhere', () => {
  expect(isSiteUrl('https://www.douyin.com/x')).toBe(true)
  expect(isSiteUrl('https://douyin.com')).toBe(true)
  expect(isSiteUrl('https://notdouyin.com/')).toBe(false)
  expect(isSiteUrl('https://example.com/?next=douyin.com')).toBe(false)
  expect(isSiteUrl('not a url')).toBe(false)
})
