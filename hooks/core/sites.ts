import type { Lang, SiteId } from './types'

export type Site = {
  id: SiteId
  label: Record<Lang, string>
  /** Every host that belongs to the site: the guard keeps the model off all of them (P-1). */
  hosts: readonly string[]
  /** Lands on the vertical feed when signed in. */
  feedUrl: string
  /**
   * Hides the site's own navigation so the feed fills the pane. Applied only
   * while the page is the feed (W-5). Structure and ids only: class names on
   * these sites are hashed and change with every release.
   */
  css: string
}

export const SITES: Record<SiteId, Site> = {
  douyin: {
    id: 'douyin',
    label: { zh: '抖音', en: 'Douyin' },
    hosts: ['douyin.com', 'iesdouyin.com'],
    feedUrl: 'https://www.douyin.com/?recommend=1&from_nav=1',
    css: [
      '#douyin-header{display:none!important}',
      '#douyin-right-container{position:fixed!important;left:0!important;top:0!important;width:100vw!important;height:100vh!important;margin:0!important;padding:0!important;z-index:5!important;background:#000!important}',
      ':has(> #douyin-right-container) > :not(#douyin-right-container){display:none!important}',
    ].join('\n'),
  },
  tiktok: {
    id: 'tiktok',
    label: { zh: 'TikTok', en: 'TikTok' },
    hosts: ['tiktok.com'],
    feedUrl: 'https://www.tiktok.com/foryou',
    css: [
      ':has(> main) > :not(main){display:none!important}',
      'main{margin:0!important;padding:0!important;width:100vw!important;max-width:100vw!important;left:0!important}',
      'main article, main article > *, main section{width:100vw!important;max-width:100vw!important;margin-left:0!important;margin-right:0!important}',
    ].join('\n'),
  },
}

const ALL_HOSTS: readonly string[] = Object.values(SITES).flatMap(site => site.hosts)

/** The host of a URL or an origin, lower-cased; null when there is none to read. */
export function hostOfUrl(url: unknown): string | null {
  if (typeof url !== 'string') return null
  const match = /^[a-z][a-z0-9+.-]*:\/\/([^/?#:@]+)(?::\d+)?/i.exec(url.trim())
  // A host may be written with a closing dot; it is the same host.
  return match ? (match[1] ?? '').toLowerCase().replace(/\.+$/, '') : null
}

/** True for any address on a video site, subdomains included. */
export function isSiteUrl(url: unknown): boolean {
  const host = hostOfUrl(url)
  if (host === null) return false
  return ALL_HOSTS.some(known => host === known || host.endsWith(`.${known}`))
}
