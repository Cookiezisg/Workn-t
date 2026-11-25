import { expect, test } from 'claude-code/testing'

import { COPY } from './copy'
import { AWAY_MS, CARD_TIMEOUT_MS, QUIET_MS, decideGuest, decideHost } from './decide'
import type { GuestWorld, HostWorld } from './decide'
import { newReport } from './report'
import { DEFAULT_SETTINGS } from './types'
import type { PageStats, Report, Slack } from './types'

const NOW = 1_000_000
const copy = COPY.zh

const rep = (id: string, patch: Partial<Report> = {}): Report => ({ ...newReport(id, `/proj/${id}`, 0), localId: `local_${id}`, beat: NOW, ...patch })

const page = (patch: Partial<PageStats> = {}): PageStats => ({
  v: 1, load: 1, mode: 'play', health: 'feed', url: 'https://www.douyin.com/?recommend=1', playing: true, framesOk: true,
  inputAgo: 0, videos: 0, watchMs: 0, cardId: null, more: false, idleAsk: false, acts: [], lost: false, ...patch,
})

const slack = (patch: Partial<Slack> = {}): Slack => ({
  startedAt: NOW - 60_000, site: 'douyin', tabId: 'feed', scene: { isPaneOpen: false, activeTab: null }, stage: 'live',
  sawLogin: false, silentSince: 0, openedAt: NOW - 60_000, patienceMs: 0, seenAt: NOW, cardSince: 0, cardId: null,
  quietSince: 0, toasted: {}, counted: { load: 1, videos: 0, watchMs: 0 }, ackedActs: 0, watchMs: 125_000, videos: 5, ...patch,
})

const host = (patch: Partial<HostWorld> = {}): HostWorld => ({
  now: NOW, me: 'a', reports: [rep('a', { status: 'working', claim: NOW - 60_000 })], titles: {}, settings: DEFAULT_SETTINGS,
  slack: slack(), page: page(), isTabAlive: true, isVisible: true, copy, siteLabel: '抖音', hasSignedInBefore: true, ...patch,
})

const wantOf = (w: HostWorld) => {
  const d = decideHost(w)
  if (d.kind !== 'page') throw new Error(`expected a page decision, got ${d.kind}`)
  return d
}

// ---- the host: section 7 ----------------------------------------------------------

test('W-1: while somebody works, the video plays and the line says so', () => {
  const d = wantOf(host())
  expect(d.want.mode).toBe('play')
  expect(d.want.card).toBeNull()
  expect(d.band).toEqual({ kind: 'slack', watchMs: 125_000, videos: 5 })
})

test('C-1: when the only session finishes, a card says so with how long it took', () => {
  const d = wantOf(host({ reports: [rep('a', { status: 'done', since: NOW - 1000, lastMs: 134_000, seq: 1, claim: NOW - 60_000 })] }))
  expect(d.want.mode).toBe('card')
  expect(d.want.card?.title).toBe('Claude 跑完了')
  expect(d.want.card?.lines[0]).toBe('用时 2:14')
  expect(d.want.card?.primary).toEqual({ id: 'back', label: '回去看看' })
  expect(d.want.card?.moreLabels).toEqual(['再看一条', '真的最后一条', '行吧'])
  expect(d.band).toEqual({ kind: 'card', text: 'Claude 跑完了' })
})

test('C-1: several sessions finished: one card lists each by its title', () => {
  const d = wantOf(
    host({
      reports: [
        rep('a', { status: 'done', since: NOW - 3000, lastMs: 60_000, seq: 1, claim: NOW - 60_000 }),
        rep('b', { status: 'done', since: NOW - 2000, lastMs: 95_000, seq: 4 }),
      ],
      titles: { local_b: '修登录 bug' },
    }),
  )
  expect(d.want.card?.title).toBe('都跑完了')
  expect(d.want.card?.lines).toContain('「这个会话」 1:00')
  expect(d.want.card?.lines).toContain('「修登录 bug」 1:35')
})

test('C-1: a session with no known title is called by its project folder', () => {
  const d = wantOf(host({ reports: [rep('a', { status: 'idle', claim: NOW - 60_000 }), rep('b', { status: 'done', since: NOW - 1, lastMs: 1000, seq: 1, cwd: '/Users/me/code/shop-api/' })] }))
  expect(d.want.card?.lines[0]).toBe('「shop-api」 0:01')
})

test('C-1: what finished before the break began is not announced', () => {
  const d = wantOf(host({ reports: [rep('a', { status: 'done', since: NOW - 120_000, seq: 3, claim: NOW - 60_000 })] }))
  expect(d.want.card).toBeNull()
  expect(d.want.mode).toBe('paused')
})

test('C-2: a session waiting on the person freezes the video at once, even while others work', () => {
  const d = wantOf(
    host({
      reports: [rep('a', { status: 'working', claim: NOW - 60_000 }), rep('b', { status: 'waiting', wait: 'approval', since: NOW - 500 })],
      titles: { local_b: '重构支付' },
    }),
  )
  expect(d.want.mode).toBe('card')
  expect(d.want.card?.title).toBe('「重构支付」在等你点头')
  expect(d.want.card?.primary.label).toBe('去处理')
})

test('C-2: each kind of wait is worded for what it is; the host session itself is just "Claude"', () => {
  const title = (wait: 'approval' | 'question' | 'plan'): string | undefined =>
    wantOf(host({ reports: [rep('a', { status: 'waiting', wait, since: NOW - 1, claim: NOW - 60_000 })] })).want.card?.title
  expect(title('approval')).toBe('Claude 在等你点头')
  expect(title('question')).toBe('Claude 问了你一个问题')
  expect(title('plan')).toBe('Claude 在等你确认计划')
})

test('C-2: the same wait keeps the same card, so "one more" is not reset by every tick', () => {
  const world = host({ reports: [rep('a', { status: 'waiting', wait: 'question', since: NOW - 5000, claim: NOW - 60_000 })] })
  expect(wantOf(world).want.card?.id).toBe(wantOf({ ...world, now: NOW + 3000 }).want.card?.id)
})

test('C-3: one session finishing while another still works is a toast, shown once, and the video plays on', () => {
  const reports = [rep('a', { status: 'working', claim: NOW - 60_000 }), rep('b', { status: 'done', since: NOW - 1000, lastMs: 5000, seq: 2 })]
  const first = wantOf(host({ reports, titles: { local_b: '写测试' } }))
  expect(first.want.mode).toBe('play')
  expect(first.want.toast?.text).toBe('「写测试」跑完了')
  expect(first.toasted).toEqual({ id: 'b', seq: 2 })
  const again = wantOf(host({ reports, titles: { local_b: '写测试' }, slack: slack({ toasted: { b: 2 } }) }))
  expect(again.want.toast).toBeNull()
})

test('C-4: a turn that failed is said to have failed', () => {
  const d = wantOf(host({ reports: [rep('a', { status: 'failed', since: NOW - 1, seq: 1, claim: NOW - 60_000 })] }))
  expect(d.want.card?.title).toBe('Claude 出错停下了')
})

test('C-5: stopped by the person: paused, no card, nothing locked', () => {
  const d = wantOf(host({ reports: [rep('a', { status: 'interrupted', since: NOW - 1, seq: 1, claim: NOW - 60_000 })] }))
  expect(d.want.mode).toBe('paused')
  expect(d.want.card).toBeNull()
  expect(d.isQuiet).toBe(true)
})

test('C-7: a turn that woke by itself keeps the video playing for someone already on a break', () => {
  expect(wantOf(host({ reports: [rep('a', { status: 'self', claim: NOW - 60_000 })] })).want.mode).toBe('play')
})

test('W-2: when the page is not on screen it is told to hold, whatever else is true', () => {
  expect(wantOf(host({ isVisible: false })).want.hold).toBe(true)
  expect(wantOf(host({ isVisible: true })).want.hold).toBe(false)
})

// ---- the host: principle 3 and section 9 ---------------------------------------------

test('L-2: a sign-in page is left as it is, with a note; first time it explains how to stay signed in', () => {
  const first = wantOf(host({ page: page({ health: 'login' }), hasSignedInBefore: false }))
  expect(first.want.mode).toBe('plain')
  expect(first.want.card).toBeNull()
  expect(first.want.note?.id).toBe('login')
  const again = wantOf(host({ page: page({ health: 'login' }), hasSignedInBefore: true }))
  expect(again.want.note?.id).toBe('login-again') // L-6
})

test('L-4: Claude finishing during a sign-in puts no card over it; the line still says it finished', () => {
  const d = wantOf(host({ page: page({ health: 'login' }), reports: [rep('a', { status: 'done', since: NOW - 1, lastMs: 1, seq: 1, claim: NOW - 60_000 })] }))
  expect(d.want.mode).toBe('plain')
  expect(d.want.card).toBeNull()
  expect(d.band).toEqual({ kind: 'card', text: 'Claude 跑完了' })
})

test('W-5: off the feed the site is shown as it is, with a way back', () => {
  const d = wantOf(host({ page: page({ health: 'elsewhere' }) }))
  expect(d.want.mode).toBe('plain')
  expect(d.want.note?.action).toEqual({ id: 'home', label: '回到推荐' })
})

test('S-5: a verification page and an unrecognised layout are both left alone, each with its own note', () => {
  expect(wantOf(host({ page: page({ health: 'verify' }) })).want.note?.id).toBe('verify')
  const unknown = wantOf(host({ page: page({ health: 'unknown' }) }))
  expect(unknown.want.mode).toBe('plain')
  expect(unknown.want.note?.text).toBe('抖音改版了，先这样看。')
})

test('S-4: a page still loading is held: silent, paused, nothing drawn', () => {
  const d = wantOf(host({ page: page({ health: 'loading' }) }))
  expect(d.want.mode).toBe('hold')
  expect(d.want.note).toBeNull()
})

// ---- the host: section 8 -----------------------------------------------------------

test('section 8: each way a break ends', () => {
  const why = (patch: Partial<HostWorld>): string => {
    const d = decideHost(host(patch))
    return d.kind === 'end' ? d.why : d.kind
  }
  expect(why({ settings: { ...DEFAULT_SETTINGS, isEnabled: false } })).toBe('off')
  expect(why({ isTabAlive: false })).toBe('closed') // W-7
  expect(why({ page: page({ health: 'left' }) })).toBe('left') // W-6
  expect(why({ page: page({ acts: [{ n: 1, id: 'back' }] }) })).toBe('back') // C-9
  expect(why({ page: page({ acts: [{ n: 1, id: 'back' }] }), slack: slack({ ackedActs: 1 }) })).toBe('page')
  expect(why({ slack: slack({ cardSince: NOW - CARD_TIMEOUT_MS, cardId: 'x' }) })).toBe('timeout') // C-10
  expect(why({ slack: slack({ seenAt: NOW - AWAY_MS }) })).toBe('away')
  expect(why({ slack: slack({ quietSince: NOW - QUIET_MS }) })).toBe('idle')
  expect(why({ reports: [rep('a', { status: 'working', claim: NOW - 60_000 }), rep('b', { claim: NOW - 10 })] })).toBe('moved') // R-5
  expect(why({ page: null })).toBe('wait')
})

test('C-9: "one more" is not "back": the break goes on', () => {
  expect(decideHost(host({ page: page({ acts: [{ n: 1, id: 'more' }] }) })).kind).toBe('page')
})

// ---- a guest: section 4 --------------------------------------------------------------

const guest = (patch: Partial<GuestWorld> = {}): GuestWorld => {
  const me = rep('a', { status: 'working', since: NOW - 9000 })
  return { now: NOW, me, reports: [me], titles: {}, settings: DEFAULT_SETTINGS, today: '2026-01-05', hasDeclined: false, ...patch }
}

test('I-1: the invitation shows once a typed turn has run for the set time, by the clock alone', () => {
  expect(decideGuest(guest()).kind).toBe('invite')
  expect(decideGuest(guest({ me: rep('a', { status: 'working', since: NOW - 7999 }) })).kind).toBe('none')
  expect(decideGuest(guest({ me: rep('a', { status: 'working', since: NOW - 1000 }), settings: { ...DEFAULT_SETTINGS, delaySec: 0 } })).kind).toBe('invite')
})

test('I-2: no invitation for a turn nobody typed, nor when idle, waiting or finished', () => {
  for (const status of ['self', 'idle', 'waiting', 'done', 'failed', 'interrupted'] as const) {
    expect(decideGuest(guest({ me: rep('a', { status, since: NOW - 60_000 }) })).kind).toBe('none')
  }
})

test('I-2: no invitation when declined this turn, silenced for today, in an excluded project, or switched off', () => {
  expect(decideGuest(guest({ hasDeclined: true })).kind).toBe('none')
  expect(decideGuest(guest({ settings: { ...DEFAULT_SETTINGS, quietDay: '2026-01-05' } })).kind).toBe('none')
  expect(decideGuest(guest({ settings: { ...DEFAULT_SETTINGS, quietDay: '2026-01-04' } })).kind).toBe('invite')
  expect(decideGuest(guest({ settings: { ...DEFAULT_SETTINGS, excluded: ['/proj/a'] } })).kind).toBe('none')
  expect(decideGuest(guest({ settings: { ...DEFAULT_SETTINGS, isEnabled: false } })).kind).toBe('none')
})

test('I-5, W-8: with the video up in another session there is no second invitation, only an offer to bring it over once it is out of sight', () => {
  const me = rep('a', { status: 'working', since: NOW - 60_000 })
  const hidden = decideGuest(guest({ me, reports: [me, rep('b', { claim: NOW - 5000, seen: false })], titles: { local_b: '另一个任务' } }))
  expect(hidden).toEqual({ kind: 'elsewhere', title: '另一个任务', canMove: true })
  const shown = decideGuest(guest({ me, reports: [me, rep('b', { claim: NOW - 5000, seen: true })] }))
  expect(shown).toEqual({ kind: 'elsewhere', title: null, canMove: false })
  const idle = rep('a', { status: 'done' })
  expect(decideGuest(guest({ me: idle, reports: [idle, rep('b', { claim: NOW - 5000 })] })).kind).toBe('none')
})
