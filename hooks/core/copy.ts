import type { Lang } from './types'

/**
 * Every word the mod shows. Written by hand in both languages; nothing here
 * is generated at run time.
 */

export const clock = (ms: number): string => {
  const total = Math.max(0, Math.round(ms / 1000))
  const minutes = Math.floor(total / 60)
  const seconds = total % 60
  return `${minutes}:${seconds < 10 ? '0' : ''}${seconds}`
}

const minutes = (ms: number): number => Math.max(0, Math.round(ms / 60000))

export type Copy = {
  // The line above the prompt
  welcome: string
  welcomeOk: string
  invite: (site: string | null) => string
  yes: string
  no: string
  quietAsk: string
  setupLang: string
  setupSite: string
  setupSound: string
  soundOn: string
  soundOff: string
  opening: (site: string) => string
  openingSlow: (site: string) => string
  waitMore: string
  giveUp: string
  openFailed: (site: string) => string
  retry: string
  slack: (watchMs: number, videos: number) => string
  elsewhere: (title: string | null) => string
  moveHere: string
  dormant: (reason: string) => string
  // Cards
  doneOne: string
  doneOneLine: (ms: number) => string
  doneMany: string
  doneRow: (title: string, ms: number) => string
  failedRow: (title: string) => string
  failedOne: string
  waiting: (kind: 'approval' | 'question' | 'plan', title: string | null) => string
  thisSession: string
  watched: (watchMs: number, videos: number) => string
  back: string
  attend: string
  more: readonly string[]
  again: string
  stillThere: string
  stay: string
  // Notes and toasts on the page
  loginNote: string
  loginAgainNote: string
  verifyNote: string
  elsewhereNote: string
  home: string
  unknownNote: (site: string) => string
  doneToast: (title: string) => string
  failedToast: (title: string) => string
  focusHint: string
  lost: string
  // Guard
  offLimits: string
  guardFailed: string
  // Command
  on: string
  off: string
  siteSet: (site: string) => string
  soundSet: (isOn: boolean) => string
  langSet: string
  delaySet: (seconds: number) => string
  idleSet: (min: number) => string
  quietOn: string
  quietOff: string
  excluded: string
  included: string
  resetDone: string
  status: (isEnabled: boolean, site: string | null, sound: string | null, delay: number, idle: number) => string
  usage: string
  bill: (label: string, agentMs: number, watchMs: number, videos: number) => string
  today: string
  yesterday: string
  billEmpty: string
  // Reasons the mod stays asleep
  notDesktop: string
  missingTools: (names: string) => string
}

export const COPY: Record<Lang, Copy> = {
  zh: {
    welcome: 'Workn’t 装好了。Claude 干活超过几秒时，这里会问你要不要刷会儿视频。',
    welcomeOk: '知道了',
    invite: site => (site ? `刷会儿${site}？` : '刷会儿视频？'),
    yes: '好',
    no: '不用',
    quietAsk: '今天都别问了？',
    setupLang: '语言 / Language',
    setupSite: '看哪个？',
    setupSound: '声音',
    soundOn: '有声',
    soundOff: '静音',
    opening: site => `正在打开${site}`,
    openingSlow: site => `${site}打开得有点慢`,
    waitMore: '再等等',
    giveUp: '算了',
    openFailed: site => `打不开${site}`,
    retry: '重试',
    slack: (watchMs, videos) => `摸鱼中 ${clock(watchMs)} · ${videos} 条`,
    elsewhere: title => (title ? `视频开在「${title}」里` : '视频开在另一个会话里'),
    moveHere: '搬过来',
    dormant: reason => `Workn’t 没在运行：${reason}`,
    doneOne: 'Claude 跑完了',
    doneOneLine: ms => `用时 ${clock(ms)}`,
    doneMany: '都跑完了',
    doneRow: (title, ms) => `「${title}」 ${clock(ms)}`,
    failedRow: title => `「${title}」 出错停下了`,
    failedOne: 'Claude 出错停下了',
    waiting: (kind, title) => {
      const who = title ? `「${title}」` : 'Claude '
      if (kind === 'question') return `${who}问了你一个问题`
      if (kind === 'plan') return `${who}在等你确认计划`
      return `${who}在等你点头`
    },
    thisSession: '这个会话',
    watched: (watchMs, videos) => `你刷了 ${videos} 条，${clock(watchMs)}`,
    back: '回去看看',
    attend: '去处理',
    more: ['再看一条', '真的最后一条', '行吧'],
    again: '这条看完了。',
    stillThere: '还在吗？',
    stay: '在',
    loginNote: '登录后自动开始。可能需要短信或扫码验证。想让登录保留下来：面板右上角 ⋯ → Keep cookies → Shared。',
    loginAgainNote: '又要登录了？把面板右上角 ⋯ 菜单里的 Keep cookies 改成 Shared，登录就能保留。',
    verifyNote: '先完成验证，完成后自动开始。',
    elsewhereNote: '你离开了推荐流。',
    home: '回到推荐',
    unknownNote: site => `${site}改版了，先这样看。`,
    doneToast: title => `「${title}」跑完了`,
    failedToast: title => `「${title}」出错停下了`,
    focusHint: '点一下视频区域，就能用方向键。',
    lost: 'Workn’t 断开了。',
    offLimits:
      '这个网站是用户自己刷视频用的，开着 Workn’t 时模型不能打开、读取或操作它。如果用户确实要你处理这个网站上的内容，请告诉用户先运行 /worknt off。',
    guardFailed: 'Workn’t 的守卫出错了，为保险起见拒绝了这次浏览器操作。运行 /worknt doctor 可以查看原因。',
    on: '已开启。',
    off: '已关闭。关闭期间模型可以访问视频网站。',
    siteSet: site => `改成${site}了。`,
    soundSet: isOn => (isOn ? '有声。' : '静音。'),
    langSet: '已改成中文。',
    delaySet: seconds => `Claude 干活 ${seconds} 秒后再问。`,
    idleSet: min => `${min} 分钟没动算走开。`,
    quietOn: '今天不再问了，明天恢复。',
    quietOff: '恢复询问。',
    excluded: '在这个项目里不再出现。',
    included: '在这个项目里恢复出现。',
    resetDone: '已清空设置和记录。',
    status: (isEnabled, site, sound, delay, idle) =>
      `${isEnabled ? '开着' : '关着'} · ${site ?? '还没选片源'} · ${sound ?? '还没选声音'} · ${delay} 秒后询问 · ${idle} 分钟没动算走开`,
    usage:
      '/worknt on | off · douyin | tiktok · sound on | off · lang zh | en · delay <秒> · idle <分钟> · quiet | quiet off · here off | here on · bill · doctor · reset',
    bill: (label, agentMs, watchMs, videos) => `${label}：Claude 干了 ${minutes(agentMs)} 分钟，你刷了 ${videos} 条，${minutes(watchMs)} 分钟。`,
    today: '今天',
    yesterday: '昨天',
    billEmpty: '还没有记录。',
    notDesktop: '只在 Claude 桌面版的 Code 里可用',
    missingTools: names => `这个版本的 Claude 里找不到需要的功能（${names}），Workn’t 需要更新`,
  },
  en: {
    welcome: 'Workn’t is installed. When Claude has been working for a few seconds, this line will offer you a video break.',
    welcomeOk: 'Got it',
    invite: site => (site ? `Watch some ${site}?` : 'Watch something?'),
    yes: 'Yes',
    no: 'No',
    quietAsk: 'Stop asking for today?',
    setupLang: '语言 / Language',
    setupSite: 'Which one?',
    setupSound: 'Sound',
    soundOn: 'On',
    soundOff: 'Muted',
    opening: site => `Opening ${site}`,
    openingSlow: site => `${site} is slow to open`,
    waitMore: 'Keep waiting',
    giveUp: 'Never mind',
    openFailed: site => `Could not open ${site}`,
    retry: 'Retry',
    slack: (watchMs, videos) => `On a break ${clock(watchMs)} · ${videos} ${videos === 1 ? 'clip' : 'clips'}`,
    elsewhere: title => (title ? `The video is in “${title}”` : 'The video is in another session'),
    moveHere: 'Bring it here',
    dormant: reason => `Workn’t is not running: ${reason}`,
    doneOne: 'Claude is done',
    doneOneLine: ms => `Took ${clock(ms)}`,
    doneMany: 'All done',
    doneRow: (title, ms) => `“${title}” ${clock(ms)}`,
    failedRow: title => `“${title}” stopped on an error`,
    failedOne: 'Claude stopped on an error',
    waiting: (kind, title) => {
      const who = title ? `“${title}”` : 'Claude'
      if (kind === 'question') return `${who} asked you a question`
      if (kind === 'plan') return `${who} is waiting for you to confirm its plan`
      return `${who} needs your OK`
    },
    thisSession: 'This session',
    watched: (watchMs, videos) => `You watched ${videos} ${videos === 1 ? 'clip' : 'clips'}, ${clock(watchMs)}`,
    back: 'Back to work',
    attend: 'Go answer',
    more: ['One more', 'Last one, really', 'Fine'],
    again: 'That one is over.',
    stillThere: 'Still there?',
    stay: 'Yes',
    loginNote: 'It starts by itself once you are signed in. You may be asked to verify. To stay signed in: the pane’s ⋯ menu → Keep cookies → Shared.',
    loginAgainNote: 'Signing in again? Set Keep cookies to Shared in the pane’s ⋯ menu and it will stick.',
    verifyNote: 'Finish the verification. It starts by itself afterwards.',
    elsewhereNote: 'You left the feed.',
    home: 'Back to the feed',
    unknownNote: site => `${site} changed its layout. Showing it as it is.`,
    doneToast: title => `“${title}” is done`,
    failedToast: title => `“${title}” stopped on an error`,
    focusHint: 'Click the video once to use the arrow keys.',
    lost: 'Workn’t lost contact.',
    offLimits:
      'This site is where the user watches videos. While Workn’t is on, the model may not open, read or control it. If the user really wants you to work on this site, tell them to run /worknt off first.',
    guardFailed: 'Workn’t’s guard failed, so this browser call was refused to be safe. /worknt doctor shows why.',
    on: 'On.',
    off: 'Off. While it is off, the model can reach the video sites.',
    siteSet: site => `Switched to ${site}.`,
    soundSet: isOn => (isOn ? 'Sound on.' : 'Muted.'),
    langSet: 'Switched to English.',
    delaySet: seconds => `It asks after Claude has worked for ${seconds}s.`,
    idleSet: min => `${min} min without input counts as gone.`,
    quietOn: 'No more asking today. Back tomorrow.',
    quietOff: 'Asking again.',
    excluded: 'It will not show up in this project.',
    included: 'It shows up in this project again.',
    resetDone: 'Settings and records cleared.',
    status: (isEnabled, site, sound, delay, idle) =>
      `${isEnabled ? 'On' : 'Off'} · ${site ?? 'no source chosen yet'} · ${sound ?? 'sound not chosen yet'} · asks after ${delay}s · gone after ${idle} min idle`,
    usage:
      '/worknt on | off · douyin | tiktok · sound on | off · lang zh | en · delay <seconds> · idle <minutes> · quiet | quiet off · here off | here on · bill · doctor · reset',
    bill: (label, agentMs, watchMs, videos) =>
      `${label}: Claude worked ${minutes(agentMs)} min. You watched ${videos} ${videos === 1 ? 'clip' : 'clips'}, ${minutes(watchMs)} min.`,
    today: 'Today',
    yesterday: 'Yesterday',
    billEmpty: 'Nothing on record yet.',
    notDesktop: 'it only runs in the Claude desktop app’s Code tab',
    missingTools: names => `this version of Claude lacks what it needs (${names}); Workn’t needs an update`,
  },
}

/** The language to speak before the person has chosen one. */
export function guessLang(): Lang {
  try {
    return new Intl.DateTimeFormat().resolvedOptions().locale.toLowerCase().startsWith('zh') ? 'zh' : 'en'
  } catch {
    return 'en'
  }
}
