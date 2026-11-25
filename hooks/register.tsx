import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { COPY } from './core/copy'
import { BROWSER_PREFIX, judge, needsTabs, scrubResult } from './core/guard'
import { SITES } from './core/sites'
import type { Band } from '../types'
import { apply, boot, command, copyOf, enqueue, guardView, newCtx, press, rememberTabs, shutdown } from './engine'
import type { Press } from './engine'
import { toPane } from './io/pane'

/** The line above the prompt. `engine.ts` writes it under the same reference; the engine wants each file to name what it reads. */
const bandAtom = atom(
  { plugin: 'worknt', key: 'band' } as const,
  { view: { kind: 'none' }, lang: 'en', site: null } as Band,
  { shape: 'band-2' },
)

/**
 * The hooks. Each one turns an engine event into a call on `engine.ts` and
 * does nothing else, so what the mod does is read there, not here.
 */
export const register: Register = on => {
  const c = newCtx()

  on('session.start', async ($, e, next) => {
    c.booted = enqueue(c, () => boot($, c)).then(() => undefined)
    await $.command.register({
      name: 'worknt',
      description: 'Workn’t: videos while Claude works · 设置、账单、自查',
      argumentHint: 'on | off | douyin | tiktok | sound | lang | delay | idle | quiet | here | bill | doctor | reset',
    })

    return next(e)
  })

  on('prompt.submit', ($, e, next) => {
    const origin = String((e as { origin?: { kind?: unknown } }).origin?.kind ?? '')
    void enqueue(c, () => apply($, c, { t: 'prompt', origin }))

    return next(e)
  })

  on('turn.start', ($, e, next) => {
    if (e.agentId === undefined) {
      void enqueue(c, async () => apply($, c, { t: 'turn-start', now: await $.clock.now() }))
    }

    return next(e)
  })

  on('turn.complete', ($, e, next) => {
    if (e.agentId === undefined) {
      const reason = String(e.reason)
      const isAborted = e.isAborted === true
      const durationMs = typeof e.durationMs === 'number' ? e.durationMs : 0
      void enqueue(c, async () => apply($, c, { t: 'turn-end', now: await $.clock.now(), reason, isAborted, durationMs }))
    }

    return next(e)
  })

  on('tool.call', async ($, e, next) => {
    const name = String(e.tool)
    const input = e as unknown as Record<string, unknown>
    const id = String(input.tool_use_id ?? '')
    // A mod's own calls carry this mark; only the model's are judged.
    const isModel = !id.startsWith('toolu_plugin_')

    // C-2: a question or a plan to confirm blocks the turn on the person until the tool returns.
    const isWait = isModel && (name === 'AskUserQuestion' || name === 'ExitPlanMode')
    if (isWait) {
      const kind = name === 'ExitPlanMode' ? 'plan' : 'question'
      void enqueue(c, async () => apply($, c, { t: 'wait-start', now: await $.clock.now(), kind, key: id }))
    }

    const isBrowser = isModel && name.startsWith(BROWSER_PREFIX)
    let isGuarded = false
    if (isBrowser) {
      await c.booted
      const { tool: _tool, tool_use_id: _id, agentId: _agent, requestMeta: _meta, ...args } = input
      const view = await guardView($, c, needsTabs(name, args))
      isGuarded = view.isOn
      if (view.isOn) {
        if (view.tabs === null) return { deny: copyOf(c).guardBusy } // P-4
        if (judge(name, args, view.tabs) === 'deny') return { deny: copyOf(c).offLimits } // P-1
      }
    }

    const ran = await next(e)

    for (const key of [id, `perm:${id}`, `perm:${name}`]) {
      if (c.memory.waits.some(wait => wait.key === key)) {
        void enqueue(c, async () => apply($, c, { t: 'wait-end', now: await $.clock.now(), key }))
      }
    }

    if (isGuarded) {
      // P-3: the answer lists every tab's title and address. Blank the video site's.
      const got = ran as unknown as { deny?: unknown; result?: unknown; text?: unknown; context?: readonly string[] }
      if (name === `${BROWSER_PREFIX}tabs_context` && typeof got.text === 'string') {
        // The model's own listing is as good as ours: keep it for the guard's next verdict.
        const listed = toPane(got.text)
        if (listed !== null) rememberTabs(c, Date.now(), listed.tabs)
      }
      if (got.deny === undefined && got.result !== undefined) {
        const cleaned = scrubResult(got.result)
        if (cleaned.changed) {
          return (got.context ? { result: cleaned.result, context: got.context } : { result: cleaned.result }) as never
        }
      }
    }

    return ran
  }).catch(($, e, next) =>
    // P-4: a guard that breaks refuses browser calls; it never lets one through, and never stops any other tool.
    String(e.tool).startsWith(BROWSER_PREFIX) ? { deny: COPY.en.guardFailed } : next(e),
  )

  on('classic.PermissionRequest', ($, e, next) => {
    const asked = e as { tool_use_id?: unknown; tool_name?: unknown }
    const key = `perm:${String(asked.tool_use_id ?? asked.tool_name ?? '')}`
    void enqueue(c, async () => apply($, c, { t: 'wait-start', now: await $.clock.now(), kind: 'approval', key }))

    return next(e)
  }).catch(($, e, next) => next(e))

  on('session.end', async ($, e, next) => {
    await enqueue(c, () => shutdown($, c))

    return next(e)
  })

  on('command.run', { command: 'worknt' }, async ($, e) => ({ text: await command($, c, e.args) }))

  on('ui.render', { component: 'AbovePrompt' }, async ($, e, next) => {
    const band = await read($, bandAtom)
    const view = band.view
    if (e.props.hasSurvey || view.kind === 'none') return next(e)

    const copy = COPY[band.lang]
    const site = band.site === null ? null : SITES[band.site].label[band.lang]
    const named = site ?? (band.lang === 'zh' ? '视频' : 'the video')

    let text = ''
    let buttons: [Press, string][] = []
    switch (view.kind) {
      case 'welcome':
        text = copy.welcome
        buttons = [['welcome-ok', copy.welcomeOk]]
        break
      case 'invite':
        text = copy.invite(site)
        buttons = [['accept', copy.yes], ['decline', copy.no]]
        break
      case 'quiet-ask':
        text = copy.quietAsk
        buttons = [['quiet-yes', copy.yes], ['quiet-no', copy.no]]
        break
      case 'setup':
        if (view.step === 'lang') {
          text = copy.setupLang
          buttons = [['lang-zh', '中文'], ['lang-en', 'English']]
        } else if (view.step === 'site') {
          text = copy.setupSite
          buttons = [['site-douyin', SITES.douyin.label[band.lang]], ['site-tiktok', SITES.tiktok.label[band.lang]]]
        } else {
          text = copy.setupSound
          buttons = [['sound-on', copy.soundOn], ['sound-off', copy.soundOff]]
        }
        break
      case 'opening':
        text = view.isSlow ? copy.openingSlow(named) : copy.opening(named)
        buttons = view.isSlow ? [['wait-more', copy.waitMore], ['give-up', copy.giveUp]] : []
        break
      case 'failed':
        text = copy.openFailed(named)
        buttons = [['retry', copy.retry], ['give-up', copy.giveUp]]
        break
      case 'slack':
        text = copy.slack(view.watchMs, view.videos)
        buttons = [['give-up', copy.back]]
        break
      case 'card':
        text = view.text
        buttons = [['give-up', copy.back]]
        break
      case 'elsewhere':
        text = copy.elsewhere(view.title)
        buttons = view.canMove ? [['accept', copy.moveHere]] : []
        break
    }

    const { Box, Button, Text } = $.ui.resolve(e)

    return (
      <Box>
        <Text dimColor>{text}</Text>
        {buttons.map(([what, label]) => (
          <Box key={`wrap-${what}`}>
            <Text dimColor>{'   '}</Text>
            <Button
              key={what}
              plain
              label={label}
              onPress={() => {
                void enqueue(c, () => press($, c, what))
              }}
            />
          </Box>
        ))}
      </Box>
    )
  })
}
