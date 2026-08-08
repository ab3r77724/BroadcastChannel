import type { GetChannelInfoParams } from '../../types'
import type { ChannelAccess, LoadedChannelDocument } from './types'
import * as cheerio from 'cheerio'
import { defineCachedFunction } from 'ocache'
import { $fetch } from 'ofetch'
import { getBooleanEnv, getEnv, getStaticProxy, getTelegramHost } from '../env'

interface TelegramHtmlParams {
  host: string
  channel: string
  id?: string
  before?: string
  after?: string
  q?: string
  headers: Record<string, string>
}

function getRequiredEnv(name: string): string {
  const value = getEnv(import.meta.env, name)
  if (!value) {
    throw new Error(`Missing required env: ${name}`)
  }
  return value
}

export function getTelegramRequestHeaders(): Record<string, string> {
  return {
    'accept': 'text/html,application/xhtml+xml',
    'user-agent': 'BroadcastChannel/0.2.0',
  }
}

async function fetchTelegramHtml({ host, channel, id, before, after, q, headers }: TelegramHtmlParams): Promise<string> {
  const requestUrl = id
    ? `https://${host}/${channel}/${id}?embed=1&mode=tme`
    : `https://${host}/s/${channel}`

  return await $fetch<string, 'text'>(requestUrl, {
    headers,
    query: {
      before: before || undefined,
      after: after || undefined,
      q: q || undefined,
    },
    responseType: 'text',
    timeout: 15000,
    retry: 3,
    retryDelay: 100,
  })
}

const loadTelegramHtml = defineCachedFunction(fetchTelegramHtml, {
  name: 'telegram-html',
  maxAge: 60 * 5,
  // A detached refresh has no Cloudflare waitUntil context and can leave a stuck pending promise.
  swr: false,
  getKey: ({ host, channel, id, before, after, q }) => JSON.stringify({
    host,
    channel,
    id: id || '',
    before: before || '',
    after: after || '',
    q: q || '',
  }),
})

const PRIVATE_CHANNEL_MARKERS = [
  'this channel is private',
  'private channel',
  'this channel can\'t be displayed',
  'can only be viewed by',
  'join to view',
  'access is restricted',
]

const CONTACT_PAGE_MARKERS = [
  'you can contact',
  'right away',
]

const UNAVAILABLE_CHANNEL_MARKERS = [
  'isn\'t available',
  'not found',
  'doesn\'t exist',
  'no longer accessible',
  'was deleted',
  'page not found',
  'is not available',
]

/**
 * t.me/s/ pages encode accessibility through DOM shape rather than HTTP
 * status. A public channel contains widget messages (or at least channel
 * metadata), while private channels render a locked landing page and missing
 * channels render an error page.
 */
export function detectChannelAccess(html: string): ChannelAccess {
  const $ = cheerio.load(html, {}, false)

  if ($('.tgme_widget_message').length > 0) {
    return 'public'
  }

  // Fragment loading (cheerio.load(html, {}, false)) has no <body>, so read
  // from the root to cover both full documents and test fixtures.
  const text = $.root().text().toLowerCase()
  if (PRIVATE_CHANNEL_MARKERS.some(marker => text.includes(marker))) {
    return 'private'
  }

  if (UNAVAILABLE_CHANNEL_MARKERS.some(marker => text.includes(marker))) {
    return 'unavailable'
  }

  // Private channels redirect /s/ to a "Contact @channel" landing page, which
  // carries .tgme_page but no channel metadata. Treat it as private so the
  // bot path can prove access instead of rendering an empty public feed.
  if (CONTACT_PAGE_MARKERS.some(marker => text.includes(marker))) {
    return 'private'
  }

  if ($('.tgme_channel_info').length > 0) {
    return 'public'
  }

  // A bare .tgme_page landing page without channel metadata is a private or
  // user landing page, not a public channel. Routing it through the bot path
  // is safe: without a bot it fails with a clear ChannelAccessError.
  if ($('.tgme_page').length > 0) {
    return 'private'
  }

  return 'unavailable'
}

export class ChannelAccessError extends Error {
  readonly code: Exclude<ChannelAccess, 'public'> | 'missing-bot'

  constructor(code: Exclude<ChannelAccess, 'public'>, options: { hasBot?: boolean } = {}) {
    const message = code === 'private'
      ? (options.hasBot
          ? 'This channel is private and no Telegram posts were received by the bot yet.'
          : 'This channel is private. Configure TELEGRAM_BOT_TOKEN and add the bot to the channel as an admin.')
      : 'This channel is unavailable or the Telegram channel name could not be found.'

    super(message)
    this.name = 'ChannelAccessError'
    this.code = options.hasBot && code === 'private' ? 'missing-bot' : code
  }
}

export async function loadChannelDocument(
  params: GetChannelInfoParams & { id?: string } = {},
): Promise<LoadedChannelDocument> {
  const { before, after, q, id } = params
  const host = getTelegramHost(import.meta.env)
  const channel = getRequiredEnv('CHANNEL')
  const staticProxy = getStaticProxy(import.meta.env)
  const reactionsEnabled = getBooleanEnv(import.meta.env, 'REACTIONS')
  const html = await loadTelegramHtml({
    host,
    channel,
    id,
    before,
    after,
    q,
    headers: getTelegramRequestHeaders(),
  })

  return {
    $: cheerio.load(html, {}, false),
    channel,
    telegramHost: host,
    staticProxy,
    reactionsEnabled,
    access: detectChannelAccess(html),
  }
}
