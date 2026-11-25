import { expect, test } from 'claude-code/testing'

import { fold, judge, landedOnSite, needsTabs, scrub, scrubResult } from './guard'
import type { TabInfo } from './guard'
import { isSiteUrl } from './sites'

const B = 'mcp__Claude_Browser__'
const FEED: TabInfo = { tabId: 'feed', origin: 'https://douyin.com', isActive: true }
const WORK: TabInfo = { tabId: 'work', origin: 'http://localhost:3000', isActive: false }

test('P-1: the model cannot navigate to a video site, in any spelling', () => {
  for (const url of ['https://www.douyin.com/', 'https://v.douyin.com/abc', 'HTTPS://WWW.TIKTOK.COM/foryou', 'https://m.tiktok.com/@x']) {
    expect(judge(`${B}navigate`, { url, tabId: 'work' }, [WORK])).toBe('site')
  }
  expect(judge(`${B}navigate`, { url: 'https://example.com/', tabId: 'work' }, [WORK])).toBe('pass')
})

test('P-1: the model cannot read or act on a tab that is on a video site, whoever opened it', () => {
  for (const tool of ['javascript_tool', 'get_page_text', 'read_page', 'computer', 'tabs_select', 'tabs_close', 'find', 'read_network_requests']) {
    expect(judge(B + tool, { tabId: 'feed' }, [FEED, WORK])).toBe('site')
    expect(judge(B + tool, { tabId: 'work' }, [FEED, WORK])).toBe('pass')
  }
})

test('W-9: a call that names no tab is refused while the tab in front is on a video site', () => {
  expect(judge(`${B}get_page_text`, {}, [FEED, WORK])).toBe('front')
  expect(judge(`${B}get_page_text`, {}, [{ ...FEED, isActive: false }, { ...WORK, isActive: true }])).toBe('pass')
})

test('P-2: a batch is refused if any one step would be', () => {
  const batch = (actions: unknown): string => judge(`${B}browser_batch`, { actions }, [{ ...FEED, isActive: false }, { ...WORK, isActive: true }])
  expect(batch([{ name: 'get_page_text', input: { tabId: 'work' } }])).toBe('pass')
  expect(batch([{ name: 'get_page_text', input: { tabId: 'work' } }, { name: 'get_page_text', input: { tabId: 'feed' } }])).toBe('site')
  expect(batch([{ name: 'navigate', input: { tabId: 'work', url: 'https://www.tiktok.com' } }])).toBe('site')
  expect(batch('not a list')).toBe('site')
  expect(batch([{ input: {} }])).toBe('site')
})

test('P-1: a script that names a video site is refused even on another tab', () => {
  expect(judge(`${B}javascript_tool`, { tabId: 'work', text: 'location.href = "https://www.douyin.com/"' }, [WORK])).toBe('site')
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

test('the guard need not list the tabs for a call that acts on none', () => {
  expect(needsTabs(`${B}tabs_context`, {})).toBe(false)
  expect(needsTabs(`${B}tabs_create`, {})).toBe(false)
  expect(needsTabs(`${B}get_page_text`, {})).toBe(true)
  expect(needsTabs(`${B}browser_batch`, { actions: [{ name: 'tabs_context', input: {} }] })).toBe(false)
  expect(needsTabs(`${B}browser_batch`, { actions: [{ name: 'tabs_context', input: {} }, { name: 'navigate', input: { url: 'https://example.com' } }] })).toBe(true)
  expect(needsTabs(`${B}browser_batch`, { actions: 'broken' })).toBe(true)
})

test('P-1: a video site spelt the ways a browser still reads it is still seen', () => {
  for (const url of [
    'https://www.douyin%2Ecom/',
    'https://www.d%6Fuyin.com/',
    'https://www.douyin\u3002com/',
    'https://www.\uff44ouyin.com/',
    'https://www.dou\u00adyin.com/',
    'https://www.dou\tyin.com/',
    'HTTPS://WWW.TIKTOK.COM./foryou',
  ]) {
    expect(judge(`${B}navigate`, { url, tabId: 'work' }, [WORK])).toBe('site')
  }
  expect(fold('www.Example%2Ecom')).toBe('www.example.com')
})

test('P-2, P-4: a batch step whose arguments are not arguments is refused, not read as empty', () => {
  const batch = (actions: unknown): string => judge(`${B}browser_batch`, { actions }, [{ ...FEED, isActive: false }, { ...WORK, isActive: true }])
  expect(batch([{ name: 'get_page_text', input: '{"tabId":"feed"}' }])).toBe('site')
  expect(batch([{ name: 'get_page_text', input: ['feed'] }])).toBe('site')
  expect(batch([{ name: 'get_page_text' }])).toBe('pass')
})

test('P-1: a tab id that is no tab\'s is no aim: the call is judged by the tab in front', () => {
  expect(judge(`${B}get_page_text`, { tabId: '' }, [FEED, WORK])).toBe('front')
  expect(judge(`${B}get_page_text`, { tabId: 'nope' }, [FEED, WORK])).toBe('front')
  expect(judge(`${B}get_page_text`, { tabId: 7 }, [FEED, WORK])).toBe('front')
})

test('P-1, the second look: what a call leaves behind decides whether its answer is given', () => {
  const work = { ...WORK, isActive: true }
  const feedBehind = { ...FEED, isActive: false }
  const read = { tabId: 'work' }
  // An address that redirected, a script that moved the page: the tab it acted on is on a video site now.
  expect(landedOnSite(`${B}navigate`, { url: 'http://localhost:3000/r', tabId: 'work' }, [work], [{ ...work, origin: 'https://www.douyin.com' }])).toBe(true)
  expect(landedOnSite(`${B}javascript_tool`, { tabId: 'work', text: 'go()' }, [work], [{ ...work, origin: 'https://www.tiktok.com' }])).toBe(true)
  // A batch that navigates and then reads is one call, judged by where it ended.
  const batch = { actions: [{ name: 'navigate', input: { tabId: 'work', url: 'http://localhost:3000/r' } }, { name: 'get_page_text', input: read }] }
  expect(landedOnSite(`${B}browser_batch`, batch, [work], [{ ...work, origin: 'https://www.douyin.com' }])).toBe(true)
  expect(landedOnSite(`${B}browser_batch`, batch, [work], [work])).toBe(false)
  // A preview that opened a tab on a video site.
  expect(landedOnSite(`${B}preview_start`, { name: 'x' }, [work], [work, { tabId: 'new', origin: 'https://www.douyin.com', isActive: false }])).toBe(true)
  // The person brought the video to the front while an untargeted call waited for permission.
  expect(landedOnSite(`${B}computer`, { action: 'screenshot' }, [work, feedBehind], [{ ...work, isActive: false }, { ...FEED, isActive: true }])).toBe(true)
  // The model's tab closed under an untargeted step, leaving the video in front.
  expect(landedOnSite(`${B}browser_batch`, { actions: [{ name: 'tabs_close', input: read }, { name: 'get_page_text', input: {} }] }, [work, feedBehind], [{ ...FEED, isActive: true }])).toBe(true)

  // The ordinary case: the model at work in its own tab while the video plays in front (W-9).
  const feedFront = { ...FEED, isActive: true }
  const workBehind = { ...WORK, isActive: false }
  expect(landedOnSite(`${B}get_page_text`, read, [feedFront, workBehind], [feedFront, workBehind])).toBe(false)
  expect(landedOnSite(`${B}tabs_create`, {}, [feedFront], [feedFront, { tabId: 'new', origin: '', isActive: false }])).toBe(false)
  expect(landedOnSite(`${B}tabs_context`, {}, [feedFront], [feedFront])).toBe(false)
})

test('P-3: text is blanked wherever it sits in an answer, not only in a list of text blocks', () => {
  const line = '• tabId feed: "某个视频的标题" ("https://www.douyin.com/video/1")'
  expect(JSON.stringify(scrubResult({ note: line, nested: [{ deep: line }] }).result)).not.toContain('douyin')
  expect(JSON.stringify(scrubResult([{ type: 'resource', resource: { text: line } }]).result)).not.toContain('某个视频')
  const untouched = { a: 1, b: ['x'] }
  expect(scrubResult(untouched)).toEqual({ changed: false, result: untouched })
})
