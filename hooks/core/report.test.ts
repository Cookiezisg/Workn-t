import { expect, test } from 'claude-code/testing'

import { alive, hostOf, newMemory, newReport, reduce } from './report'
import type { ReportEvent } from './report'
import type { Report } from './types'

const run = (events: ReportEvent[]): Report => {
  let state = { report: newReport('s1', '/proj', 0), memory: newMemory() }
  for (const event of events) state = reduce(state.report, state.memory, event)
  return state.report
}

test('I-1: a turn the person typed is "working"', () => {
  const report = run([{ t: 'prompt', origin: 'composer' }, { t: 'turn-start', now: 100 }])
  expect(report.status).toBe('working')
  expect(report.since).toBe(100)
})

test('I-2: a turn nobody typed is "self", whatever woke it', () => {
  for (const origin of ['task-notification', 'scheduled-trigger', 'peer', 'sdk', '']) {
    expect(run([{ t: 'prompt', origin }, { t: 'turn-start', now: 1 }]).status).toBe('self')
  }
  expect(run([{ t: 'turn-start', now: 1 }]).status).toBe('self')
})

test('I-2: the person asking once does not make the next, unasked turn theirs', () => {
  const report = run([
    { t: 'prompt', origin: 'composer' },
    { t: 'turn-start', now: 1 },
    { t: 'turn-end', now: 2, reason: 'answer', isAborted: false, durationMs: 1 },
    { t: 'prompt', origin: 'task-notification' },
    { t: 'turn-start', now: 3 },
  ])
  expect(report.status).toBe('self')
})

test('C-2: a question blocks the turn, and its answer puts it back to work', () => {
  const asked = run([{ t: 'prompt', origin: 'composer' }, { t: 'turn-start', now: 1 }, { t: 'wait-start', now: 5, kind: 'question', key: 'q1' }])
  expect(asked.status).toBe('waiting')
  expect(asked.wait).toBe('question')
  const answered = run([
    { t: 'prompt', origin: 'composer' },
    { t: 'turn-start', now: 1 },
    { t: 'wait-start', now: 5, kind: 'question', key: 'q1' },
    { t: 'wait-end', now: 9, key: 'q1' },
  ])
  expect(answered.status).toBe('working')
  expect(answered.wait).toBeNull()
})

test('C-2: two things waiting at once: the session waits until both are answered', () => {
  const events: ReportEvent[] = [
    { t: 'prompt', origin: 'composer' },
    { t: 'turn-start', now: 1 },
    { t: 'wait-start', now: 2, kind: 'approval', key: 'a' },
    { t: 'wait-start', now: 3, kind: 'approval', key: 'b' },
    { t: 'wait-end', now: 4, key: 'a' },
  ]
  expect(run(events).status).toBe('waiting')
  expect(run([...events, { t: 'wait-end', now: 5, key: 'b' }]).status).toBe('working')
})

test('C-2: an end for something that was never waited on changes nothing', () => {
  const report = run([{ t: 'prompt', origin: 'composer' }, { t: 'turn-start', now: 1 }, { t: 'wait-end', now: 2, key: 'nope' }])
  expect(report.status).toBe('working')
  expect(report.since).toBe(1)
})

test('C-1, C-4, C-5: how a turn ended is told apart', () => {
  const end = (reason: string, isAborted: boolean): string =>
    run([{ t: 'prompt', origin: 'composer' }, { t: 'turn-start', now: 1 }, { t: 'turn-end', now: 9, reason, isAborted, durationMs: 8 }]).status
  expect(end('answer', false)).toBe('done')
  expect(end('error', false)).toBe('failed')
  expect(end('refusal', false)).toBe('failed')
  expect(end('aborted', false)).toBe('interrupted')
  expect(end('answer', true)).toBe('interrupted')
})

test('a turn ending clears whatever was waiting and counts the completion', () => {
  const report = run([
    { t: 'prompt', origin: 'composer' },
    { t: 'turn-start', now: 1 },
    { t: 'wait-start', now: 2, kind: 'approval', key: 'a' },
    { t: 'turn-end', now: 9, reason: 'answer', isAborted: false, durationMs: 8000 },
  ])
  expect(report.status).toBe('done')
  expect(report.wait).toBeNull()
  expect(report.seq).toBe(1)
  expect(report.lastMs).toBe(8000)
})

test('R-6: a session that ends gives up the video page', () => {
  const start = { report: { ...newReport('s1', '/p', 0), claim: 5, seen: true }, memory: newMemory() }
  const ended = reduce(start.report, start.memory, { t: 'session-end', now: 9 }).report
  expect(ended.status).toBe('gone')
  expect(ended.claim).toBeNull()
})

test('R-7: an active session that stopped writing is taken for dead; a finished one is not', () => {
  const working: Report = { ...newReport('a', '/p', 0), status: 'working', beat: 1000 }
  const done: Report = { ...newReport('b', '/p', 0), status: 'done', beat: 1000 }
  const host: Report = { ...newReport('c', '/p', 0), status: 'done', claim: 500, beat: 1000 }
  expect(alive([working, done, host], 1000 + 19_000).map(report => report.id)).toEqual(['a', 'b', 'c'])
  expect(alive([working, done, host], 1000 + 21_000).map(report => report.id)).toEqual(['b'])
})

test('R-2, R-5: the latest claim holds the video page', () => {
  const a: Report = { ...newReport('a', '/p', 0), claim: 100 }
  const b: Report = { ...newReport('b', '/p', 0), claim: 200 }
  const none: Report = newReport('c', '/p', 0)
  expect(hostOf([a, b, none])?.id).toBe('b')
  expect(hostOf([none])).toBeNull()
})
