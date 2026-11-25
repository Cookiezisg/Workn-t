export type Lang = 'zh' | 'en'

const clock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000))
  const m = Math.floor(total / 60)
  const s = total % 60
  return `${m}:${s < 10 ? '0' : ''}${s}`
}

const minutes = (ms: number): number => Math.max(0, Math.round(ms / 60000))

export type Copy = {
  doneTitle: string
  doneSub: (agentMs: number, videos: number) => string
  approvalTitle: string
  approvalSub: string
  againSub: string
  back: string
  more: readonly string[]
  intro: string
  bandWorking: (watchMs: number, videos: number) => string
  bandDone: (agentMs: number, videos: number) => string
  bandApproval: string
  bandYielded: string
  boss: string
  collapse: string
  bill: (label: string, agentMs: number, videos: number) => string
  billEmpty: string
  yesterday: string
  today: string
  total: string
  on: string
  off: string
  sourceSet: (label: string) => string
  status: (enabled: boolean, label: string, delay: number) => string
  notDesktop: string
  usage: string
  offLimits: (tabId: string) => string
}

export const COPY: Record<Lang, Copy> = {
  zh: {
    doneTitle: 'Claude 跑完了',
    doneSub: (agentMs, videos) => `用时 ${clock(agentMs)}，你刷了 ${videos} 条。`,
    approvalTitle: 'Claude 在等你点头',
    approvalSub: '它停在一个需要你批准的操作上。',
    againSub: '这条看完了。',
    back: '回去看看',
    more: ['再看一条', '真的最后一条', '行吧'],
    intro: '第一次用：请在这里登录，可能要二次验证。登录一次就行。',
    bandWorking: (watchMs, videos) => `在干活 · 你已摸鱼 ${clock(watchMs)} · ${videos} 条`,
    bandDone: (agentMs, videos) => `跑完了 ${clock(agentMs)} · 你刷了 ${videos} 条`,
    bandApproval: 'Claude 在等你点头',
    bandYielded: 'Claude 在用浏览器',
    boss: '老板来了',
    collapse: '收起',
    bill: (label, agentMs, videos) => `${label} Claude 干了 ${minutes(agentMs)} 分钟，你刷了 ${videos} 条。`,
    billEmpty: '还没有记录。',
    yesterday: '昨天',
    today: '今天',
    total: '累计',
    on: '已开启。',
    off: '已关闭。',
    sourceSet: label => `片源换成了${label}。下次出场生效。`,
    status: (enabled, label, delay) => `${enabled ? '开着' : '关着'} · 片源 ${label} · 延迟 ${delay} 秒`,
    notDesktop: '这个会话里没有浏览器面板，刷不了。',
    usage: '用法：/worknt on | off | douyin | tiktok | bill | boss | show',
    offLimits: tabId =>
      `标签页 ${tabId} 是用户自己的视频流，模型不能读取或操作。请用 tabs_create 新开一个标签页，并在之后的调用里带上它的 tabId。`,
  },
  en: {
    doneTitle: 'Claude is done',
    doneSub: (agentMs, videos) => `Took ${clock(agentMs)}. You watched ${videos} ${videos === 1 ? 'clip' : 'clips'}.`,
    approvalTitle: 'Claude needs your OK',
    approvalSub: 'It stopped at a step that needs your approval.',
    againSub: 'That one is over.',
    back: 'Back to work',
    more: ['One more', 'Last one, really', 'Fine'],
    intro: 'First time here: sign in on this page. It may ask you to verify. Once is enough.',
    bandWorking: (watchMs, videos) => `Working · you have slacked ${clock(watchMs)} · ${videos} ${videos === 1 ? 'clip' : 'clips'}`,
    bandDone: (agentMs, videos) => `Done in ${clock(agentMs)} · you watched ${videos} ${videos === 1 ? 'clip' : 'clips'}`,
    bandApproval: 'Claude needs your OK',
    bandYielded: 'Claude is using the browser',
    boss: 'Boss',
    collapse: 'Hide',
    bill: (label, agentMs, videos) => `${label}: Claude worked ${minutes(agentMs)} min. You watched ${videos} ${videos === 1 ? 'clip' : 'clips'}.`,
    billEmpty: 'Nothing on record yet.',
    yesterday: 'Yesterday',
    today: 'Today',
    total: 'All time',
    on: 'On.',
    off: 'Off.',
    sourceSet: label => `Source set to ${label}. It applies the next time the feed comes up.`,
    status: (enabled, label, delay) => `${enabled ? 'On' : 'Off'} · source ${label} · delay ${delay}s`,
    notDesktop: 'This session has no browser pane, so there is nothing to show.',
    usage: 'Usage: /worknt on | off | douyin | tiktok | bill | boss | show',
    offLimits: tabId =>
      `Tab ${tabId} is the user's personal video feed. The model may not read or control it. Open another tab with tabs_create and pass its tabId in later calls.`,
  },
}

/** What the boss sees. Written by hand; nothing here is generated. */
export const BOSS_LOG: readonly string[] = [
  '$ make test',
  'collecting ... 214 items',
  'tests/test_parser.py ......................... [ 11%]',
  'tests/test_resolver.py ...................... [ 22%]',
  'tests/test_cache.py ............s............ [ 34%]',
  'tests/test_scheduler.py ..................... [ 45%]',
  'tests/test_storage.py ....................... [ 57%]',
  'tests/test_api.py ........................... [ 71%]',
  'tests/test_migrations.py ...........s........ [ 83%]',
  'tests/test_cli.py ........................... [ 96%]',
  'tests/test_e2e.py ........',
]
