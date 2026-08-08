import type { AnyNode, Cheerio, CheerioAPI } from 'cheerio'

export type MessageSelection = Cheerio<AnyNode>

export interface StaticProxyOptions {
  staticProxy?: string
}

export interface IndexedStaticProxyOptions extends StaticProxyOptions {
  index?: number
}

export interface ReplyOptions {
  channel: string
}

export interface MessageAssetOptions extends IndexedStaticProxyOptions {
  id?: string
  title?: string
  botMedia?: Map<string, BotMediaRef>
}

export interface ExtractPostOptions {
  channel: string
  telegramHost: string
  staticProxy: string
  index?: number
  reactionsEnabled?: boolean
  botMedia?: Map<string, BotMediaRef>
}

export interface BotMediaRef {
  fileId: string
  width?: number
  height?: number
  kind?: 'photo' | 'video' | 'audio' | 'voice' | 'document'
  mimeType?: string
  fileName?: string
}

export interface LoadedChannelDocument {
  $: CheerioAPI
  channel: string
  telegramHost: string
  staticProxy: string
  reactionsEnabled?: boolean
  access: ChannelAccess
}

export type ChannelAccess = 'public' | 'private' | 'unavailable'
