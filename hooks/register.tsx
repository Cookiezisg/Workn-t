import { atom, read } from 'claude-code'
import type { Register } from 'claude-code'

import { COPY } from './core/copy'
import { BROWSER_PREFIX, judge, needsTabs, scrubResult } from './core/guard'
import { SITES } from './core/sites'
import type { Band } from '../types'
import { EMPTY_PANEL, PANE_ID, apply, boot, command, copyOf, enqueue, guardView, newCtx, press, rememberTabs, showDoctor, shutdown } from './engine'
import type { Press } from './engine'
import { toPane } from './io/pane'

/** The line above the prompt. `engine.ts` writes it under the same reference; the engine wants each file to name what it reads. */
const bandAtom = atom(
  { plugin: 'worknt', key: 'band' } as const,
  { view: { kind: 'none' }, lang: 'en', site: null } as Band,
  { shape: 'band-3' },
)
/** What the settings pane shows; written by `engine.ts` in the same way. */
const panelAtom = atom({ plugin: 'worknt', key: 'panel' } as const, EMPTY_PANEL, { shape: 'panel-1' })

/** The choices the pane offers for the two durations. Any other value, set by command, shows in the row's label with none of these lit. */
const DELAYS = [3, 8, 15, 30]
const IDLES = [2, 5, 10, 30]

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
      argumentHint: 'on | off | douyin | tiktok | sound | live | lang | delay | idle | quiet | here | bill | doctor | reset',
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
      case 'resume':
        text = copy.resume(named)
        buttons = [['accept', copy.resumeYes]]
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

  // T-1: every setting, changed with a click. Each button runs the same command the person could type.
  on('ui.render', { component: 'Pane', requestId: PANE_ID }, async ($, e) => {
    const panel = await read($, panelAtom)
    const copy = COPY[panel.lang]
    const { Box, Button, Text } = $.ui.resolve(e)
    const run = (args: string) => () => {
      void command($, c, args)
    }

    type Choice = { key: string; label: string; isOn: boolean; args: string }
    const row = (id: string, label: string, choices: Choice[]) => (
      <Box key={`row-${id}`} flexDirection="column" marginBottom={1}>
        <Text dimColor>{label}</Text>
        <Box flexDirection="row" gap={1}>
          {choices.map(choice => (
            <Button key={`${id}-${choice.key}`} label={choice.label} variant={choice.isOn ? 'primary' : 'secondary'} onPress={run(choice.args)} />
          ))}
        </Box>
      </Box>
    )

    if (panel.dormant !== null) {
      return (
        <Box flexDirection="column">
          <Text>{copy.dormant(panel.dormant)}</Text>
        </Box>
      )
    }

    const bills = [
      panel.today.agentMs > 0 || panel.today.videos > 0 ? copy.bill(copy.today, panel.today.agentMs, panel.today.watchMs, panel.today.videos) : null,
      panel.yesterday.agentMs > 0 || panel.yesterday.videos > 0 ? copy.bill(copy.yesterday, panel.yesterday.agentMs, panel.yesterday.watchMs, panel.yesterday.videos) : null,
    ].filter((line): line is string => line !== null)

    return (
      <Box flexDirection="column">
        {row('switch', copy.paneSwitch, [
          { key: 'on', label: copy.paneOn, isOn: panel.isEnabled, args: 'on' },
          { key: 'off', label: copy.paneOff, isOn: !panel.isEnabled, args: 'off' },
        ])}
        {row('site', panel.site === null ? `${copy.paneSite} · ${copy.paneNotChosen}` : copy.paneSite, [
          { key: 'douyin', label: SITES.douyin.label[panel.lang], isOn: panel.site === 'douyin', args: 'douyin' },
          { key: 'tiktok', label: SITES.tiktok.label[panel.lang], isOn: panel.site === 'tiktok', args: 'tiktok' },
        ])}
        {row('sound', panel.sound === null ? `${copy.setupSound} · ${copy.paneNotChosen}` : copy.setupSound, [
          { key: 'on', label: copy.soundOn, isOn: panel.sound === 'on', args: 'sound on' },
          { key: 'off', label: copy.soundOff, isOn: panel.sound === 'off', args: 'sound off' },
        ])}
        {row('live', copy.live, [
          { key: 'show', label: copy.liveShow, isOn: panel.live === 'show', args: 'live show' },
          { key: 'skip', label: copy.liveSkip, isOn: panel.live === 'skip', args: 'live skip' },
        ])}
        {row('lang', copy.paneLang, [
          { key: 'zh', label: '中文', isOn: panel.lang === 'zh', args: 'lang zh' },
          { key: 'en', label: 'English', isOn: panel.lang === 'en', args: 'lang en' },
        ])}
        {row(
          'delay',
          `${copy.paneDelay} · ${copy.seconds(panel.delaySec)}`,
          DELAYS.map(n => ({ key: String(n), label: copy.seconds(n), isOn: panel.delaySec === n, args: `delay ${n}` })),
        )}
        {row(
          'idle',
          `${copy.paneIdle} · ${copy.minutes(panel.idleMin)}`,
          IDLES.map(n => ({ key: String(n), label: copy.minutes(n), isOn: panel.idleMin === n, args: `idle ${n}` })),
        )}
        {row('quiet', copy.paneQuiet, [
          { key: 'on', label: copy.paneOn, isOn: panel.isQuietToday, args: 'quiet' },
          { key: 'off', label: copy.paneOff, isOn: !panel.isQuietToday, args: 'quiet off' },
        ])}
        {row('here', copy.paneHere, [
          { key: 'on', label: copy.paneHereOn, isOn: !panel.isExcludedHere, args: 'here on' },
          { key: 'off', label: copy.paneHereOff, isOn: panel.isExcludedHere, args: 'here off' },
        ])}
        <Text dimColor>{copy.paneHint}</Text>
        {bills.length > 0 && (
          <Box key="bills" flexDirection="column" marginTop={1}>
            {bills.map(line => (
              <Text>{line}</Text>
            ))}
          </Box>
        )}
        <Box key="doctor" flexDirection="column" marginTop={1}>
          <Box flexDirection="row">
            <Button
              key="doctor-run"
              label={copy.paneDoctor}
              variant="secondary"
              onPress={() => {
                void showDoctor($, c)
              }}
            />
          </Box>
          {panel.doctor !== null && <Text mono dimColor>{panel.doctor}</Text>}
        </Box>
      </Box>
    )
  })
}
