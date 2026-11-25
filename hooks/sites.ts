export type SiteId = 'douyin' | 'tiktok'

export type Site = {
  id: SiteId
  /** What the settings and the status command call it. */
  label: string
  /** The origin `tabs_context` reports for a tab on this site. */
  origin: string
  /** A URL that lands on the vertical feed. */
  feedUrl: string
  /** True when a page URL is already the feed. */
  isFeed: (url: string) => boolean
  /** Hides the site's chrome so the feed fills the pane. Structure and ids only: class names are hashed and change. */
  css: string
  /** Exact texts of one-time tips to click away. */
  tips: readonly string[]
}

export const SITES: Record<SiteId, Site> = {
  douyin: {
    id: 'douyin',
    label: '抖音',
    origin: 'https://douyin.com',
    feedUrl: 'https://www.douyin.com/?recommend=1&from_nav=1',
    isFeed: url => /^https:\/\/www\.douyin\.com\/(\?.*)?$/.test(url) && url.includes('recommend=1'),
    css: [
      '#douyin-header{display:none!important}',
      '#douyin-right-container{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;margin:0!important;padding:0!important;z-index:5!important;background:#000!important}',
      ':has(> #douyin-right-container) > :not(#douyin-right-container){display:none!important}',
    ].join('\n'),
    tips: ['我知道了'],
  },
  tiktok: {
    id: 'tiktok',
    label: 'TikTok',
    origin: 'https://tiktok.com',
    feedUrl: 'https://www.tiktok.com/foryou',
    isFeed: url => /^https:\/\/www\.tiktok\.com\/(foryou|[a-z]{2}(-[A-Z]{2})?\/?)?(\?.*)?$/.test(url),
    css: [
      ':has(> main) > :not(main){display:none!important}',
      'main{margin:0!important;padding:0!important;width:100vw!important;max-width:100vw!important;left:0!important}',
      'main article, main article > *, main section{width:100vw!important;max-width:100vw!important;margin-left:0!important;margin-right:0!important}',
    ].join('\n'),
    tips: ['Got it'],
  },
}
