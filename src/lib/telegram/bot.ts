import type { Env } from '../env'
import type { BotMediaRef } from './types'
import { defineCachedFunction } from 'ocache'
import {
  getTelegramBotApiBase,
  getTelegramBotChatId,
  getTelegramBotToken,
} from '../env'

export interface BotPhotoSize {
  file_id: string
  file_unique_id: string
  width: number
  height: number
  file_size?: number
}

export interface BotMessageEntity {
  type: string
  offset: number
  length: number
  url?: string
  language?: string
  custom_emoji_id?: string
}

export interface BotChat {
  id: number
  type: string
  username?: string
  title?: string
  description?: string
  photo?: {
    small_file_id: string
    big_file_id: string
  }
}

export interface BotMessage {
  message_id: number
  date: number
  chat: BotChat
  media_group_id?: string
  link_preview_options?: {
    url?: string
    is_disabled?: boolean
  }
  text?: string
  caption?: string
  entities?: BotMessageEntity[]
  caption_entities?: BotMessageEntity[]
  photo?: BotPhotoSize[]
  document?: {
    file_id: string
    file_name?: string
    mime_type?: string
    thumb?: BotPhotoSize
  }
  video?: {
    file_id: string
    width: number
    height: number
    mime_type?: string
    thumb?: BotPhotoSize
  }
  audio?: {
    file_id: string
    file_name?: string
    mime_type?: string
  }
  voice?: {
    file_id: string
    mime_type?: string
  }
  animation?: {
    file_id: string
    width: number
    height: number
    mime_type?: string
    thumb?: BotPhotoSize
  }
  video_note?: {
    file_id: string
    length: number
    thumb?: BotPhotoSize
  }
  sticker?: {
    file_id: string
    width: number
    height: number
  }
  views?: number
}

export interface BotUpdate {
  update_id: number
  channel_post?: BotMessage
  edited_channel_post?: BotMessage
}

export interface BotMedia {
  kind: 'photo' | 'video' | 'audio' | 'voice' | 'document'
  fileId: string
  width?: number
  height?: number
  mimeType?: string
  fileName?: string
}

export interface BotChannelMessages {
  messages: BotMessage[]
  chat?: BotChat
}

interface BotApiError {
  ok?: boolean
  description?: string
  error_code?: number
}

const FILE_ID_REGEX = /^[\w\-:]+$/
const BOT_FILE_PATH_REGEX = /^[\w./\-]+$/
const BOT_API_TIMEOUT_MS = 10_000

function getRequiredBotToken(env: Env): string {
  const token = getTelegramBotToken(env)
  if (!token) {
    throw new Error('Missing required env: TELEGRAM_BOT_TOKEN')
  }
  return token
}

export function isBotEnabled(env: Env): boolean {
  return getTelegramBotToken(env).length > 0
}

export function normalizeBotApiBase(raw: string): string {
  try {
    return new URL(raw).toString().replace(/\/+$/, '')
  }
  catch {
    return 'https://api.telegram.org'
  }
}

export function buildBotApiUrl(env: Env, method: string): string {
  const base = normalizeBotApiBase(getTelegramBotApiBase(env))
  const token = getRequiredBotToken(env)
  return `${base}/bot${token}/${method}`
}

export function buildBotFileUrl(env: Env, filePath: string): string {
  const base = normalizeBotApiBase(getTelegramBotApiBase(env))
  const token = getRequiredBotToken(env)
  return `${base}/file/bot${token}/${String(filePath || '').replace(/^\/+/, '')}`
}

export function getBotFileUrl(fileId: string): string {
  return `/api/bot-file?file_id=${encodeURIComponent(fileId)}`
}

export function isValidBotFileId(fileId: string): boolean {
  return FILE_ID_REGEX.test(fileId)
}

export function isValidBotFilePath(filePath: string): boolean {
  return BOT_FILE_PATH_REGEX.test(filePath) && !filePath.startsWith('/')
}

async function fetchBotApi<T>(env: Env, method: string, init: RequestInit = {}): Promise<T> {
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), BOT_API_TIMEOUT_MS)

  try {
    const response = await fetch(buildBotApiUrl(env, method), {
      ...init,
      signal: controller.signal,
      headers: {
        'user-agent': 'BroadcastChannel/0.2.0',
        'content-type': 'application/json',
        ...init.headers,
      },
    })
    const json = await response.json().catch(() => ({})) as T & BotApiError

    if (!response.ok || json.ok === false) {
      const detail = json.description || `Telegram Bot API request failed (${response.status})`
      throw new Error(`Bot API ${method}: ${detail}`)
    }

    return json
  }
  finally {
    clearTimeout(timeout)
  }
}

interface BotApiResult<T> {
  ok: boolean
  result: T
}

async function fetchBotUpdates(env: Env): Promise<BotUpdate[]> {
  const result = await fetchBotApi<BotApiResult<BotUpdate[]>>(env, 'getUpdates', {
    method: 'POST',
    body: JSON.stringify({
      allowed_updates: ['channel_post', 'edited_channel_post'],
      timeout: 0,
    }),
  })

  return Array.isArray(result.result) ? result.result : []
}

const loadBotUpdates = defineCachedFunction(fetchBotUpdates, {
  name: 'telegram-bot-updates',
  maxAge: 60,
  swr: false,
  getKey: env => JSON.stringify({
    token: getTelegramBotToken(env),
    apiBase: getTelegramBotApiBase(env),
  }),
})

export function filterChannelMessages(
  updates: BotUpdate[],
  channel: string,
  chatId: string,
): BotChannelMessages {
  const messages = new Map<number, BotMessage>()
  const matchedChats = new Map<number, BotChat>()

  for (const update of updates) {
    for (const message of [update.channel_post, update.edited_channel_post]) {
      if (!message || message.chat?.type !== 'channel') {
        continue
      }

      const usernameMatch = message.chat.username?.toLowerCase() === channel.toLowerCase()
      const idMatch = chatId.length > 0 && String(message.chat.id) === String(chatId)

      if (usernameMatch || idMatch) {
        // Keep the latest version: an edited post replaces the original.
        messages.set(message.message_id, message)
        matchedChats.set(message.chat.id, message.chat)
      }
    }
  }

  // Private channels have no username. When the operator owns only one channel
  // per bot, the first channel post is unambiguous without TELEGRAM_BOT_CHAT_ID.
  if (messages.size === 0 && chatId.length === 0) {
    const channelChats = new Map<number, BotChat>()
    for (const update of updates) {
      for (const message of [update.channel_post, update.edited_channel_post]) {
        if (message?.chat?.type === 'channel' && !channelChats.has(message.chat.id)) {
          channelChats.set(message.chat.id, message.chat)
        }
      }
    }

    if (channelChats.size === 1) {
      const [chat] = [...channelChats.values()]
      const inferred = new Map<number, BotMessage>()
      for (const update of updates) {
        for (const message of [update.channel_post, update.edited_channel_post]) {
          if (message?.chat.id === chat.id) {
            inferred.set(message.message_id, message)
          }
        }
      }
      for (const message of inferred.values()) {
        messages.set(message.message_id, message)
      }
      matchedChats.set(chat.id, chat)
    }
  }

  const chats = [...matchedChats.values()]
  return {
    messages: [...messages.values()],
    chat: chats[0],
  }
}

/**
 * Telegram 相册里每张图是一条独立消息，共享同一个 media_group_id。
 * 分组后同一相册渲染成一条帖子，否则每张图会变成单独一条。
 */
export function groupMessagesByMediaGroup(messages: BotMessage[]): BotMessage[][] {
  const groups = new Map<string, BotMessage[]>()
  const singles: BotMessage[][] = []

  for (const message of messages) {
    if (message.media_group_id) {
      const group = groups.get(message.media_group_id) ?? []
      group.push(message)
      groups.set(message.media_group_id, group)
    }
    else {
      singles.push([message])
    }
  }

  return [...singles, ...groups.values()]
}

export function extractBotMedia(message: BotMessage): BotMedia | null {
  if (Array.isArray(message.photo) && message.photo.length > 0) {
    const largest = message.photo[message.photo.length - 1]
    return {
      kind: 'photo',
      fileId: largest.file_id,
      width: largest.width,
      height: largest.height,
    }
  }

  if (message.video) {
    return {
      kind: 'video',
      fileId: message.video.file_id,
      width: message.video.width,
      height: message.video.height,
      mimeType: message.video.mime_type,
    }
  }

  if (message.animation) {
    return {
      kind: 'video',
      fileId: message.animation.file_id,
      width: message.animation.width,
      height: message.animation.height,
      mimeType: message.animation.mime_type,
    }
  }

  if (message.video_note) {
    return {
      kind: 'video',
      fileId: message.video_note.file_id,
      width: message.video_note.length,
      height: message.video_note.length,
      mimeType: 'video/mp4',
    }
  }

  if (message.document) {
    const isImage = message.document.mime_type?.startsWith('image/') ?? false
    return {
      kind: isImage ? 'photo' : 'document',
      fileId: message.document.file_id,
      width: message.document.thumb?.width,
      height: message.document.thumb?.height,
      mimeType: message.document.mime_type,
      fileName: message.document.file_name,
    }
  }

  if (message.audio) {
    return {
      kind: 'audio',
      fileId: message.audio.file_id,
      mimeType: message.audio.mime_type,
      fileName: message.audio.file_name,
    }
  }

  if (message.voice) {
    return {
      kind: 'voice',
      fileId: message.voice.file_id,
      mimeType: message.voice.mime_type,
    }
  }

  return null
}

export async function getBotMediaByMessageId(env: Env, channel: string): Promise<Map<string, BotMediaRef>> {
  const mediaByMessageId = new Map<string, BotMediaRef>()
  const updates = await loadBotUpdates(env)
  const { messages } = filterChannelMessages(updates, channel, getTelegramBotChatId(env))

  for (const message of messages) {
    const media = extractBotMedia(message)
    if (media) {
      mediaByMessageId.set(String(message.message_id), {
        fileId: media.fileId,
        width: media.width,
        height: media.height,
        kind: media.kind,
        mimeType: media.mimeType,
        fileName: media.fileName,
      })
    }
  }

  return mediaByMessageId
}

export async function getBotChannelMessages(env: Env, channel: string): Promise<BotChannelMessages> {
  const updates = await loadBotUpdates(env)
  return filterChannelMessages(updates, channel, getTelegramBotChatId(env))
}

async function fetchBotChat(env: Env, chatIdentifier: string): Promise<BotChat | null> {
  const result = await fetchBotApi<BotApiResult<BotChat>>(env, 'getChat', {
    method: 'POST',
    body: JSON.stringify({ chat_id: chatIdentifier }),
  })

  return result.result ?? null
}

const loadBotChat = defineCachedFunction(fetchBotChat, {
  name: 'telegram-bot-chat',
  maxAge: 60 * 10,
  swr: false,
  getKey: (env, chatIdentifier) => JSON.stringify({
    token: getTelegramBotToken(env),
    apiBase: getTelegramBotApiBase(env),
    chatIdentifier,
  }),
})

export async function getBotChatInfo(env: Env, channel: string, chat?: BotChat): Promise<BotChat | null> {
  const configuredChatId = getTelegramBotChatId(env)
  const identifier = configuredChatId || chat?.id ? String(configuredChatId || chat?.id) : `@${channel}`

  try {
    return await loadBotChat(env, identifier)
  }
  catch {
    return chat ?? null
  }
}

export interface BotFileInfo {
  file_id: string
  file_unique_id: string
  file_size?: number
  file_path?: string
}

async function fetchBotFileInfo(env: Env, fileId: string): Promise<BotFileInfo | null> {
  const result = await fetchBotApi<BotApiResult<BotFileInfo>>(env, 'getFile', {
    method: 'POST',
    body: JSON.stringify({ file_id: fileId }),
  })

  return result.result ?? null
}

const loadBotFileInfo = defineCachedFunction(fetchBotFileInfo, {
  name: 'telegram-bot-file-info',
  maxAge: 60 * 60,
  swr: false,
  getKey: (env, fileId) => JSON.stringify({
    token: getTelegramBotToken(env),
    apiBase: getTelegramBotApiBase(env),
    fileId,
  }),
})

export async function getBotFileInfo(env: Env, fileId: string): Promise<BotFileInfo | null> {
  if (!isValidBotFileId(fileId)) {
    return null
  }
  return loadBotFileInfo(env, fileId)
}

export async function createBotFileResponse(
  request: Request,
  fileId: string,
  env: Env,
): Promise<Response> {
  if (!isBotEnabled(env) || !isValidBotFileId(fileId)) {
    return new Response('Not Found', { status: 404 })
  }

  const file = await getBotFileInfo(env, fileId)
  if (!file?.file_path || !isValidBotFilePath(file.file_path)) {
    return new Response('Not Found', { status: 404 })
  }

  const headers = new Headers()
  for (const key of ['range', 'if-modified-since', 'if-none-match']) {
    const value = request.headers.get(key)
    if (value) {
      headers.set(key, value)
    }
  }
  headers.set('user-agent', 'BroadcastChannel/0.2.0')

  let response: Response
  try {
    response = await fetch(buildBotFileUrl(env, file.file_path), { headers })
  }
  catch {
    return new Response('Upstream fetch failed', { status: 502 })
  }

  if (!response.ok && response.status !== 206) {
    return new Response('Upstream fetch failed', { status: 502 })
  }

  const responseHeaders = new Headers(response.headers)
  responseHeaders.set('cache-control', 'public, max-age=3600, s-maxage=3600')
  return new Response(response.body, {
    status: response.status,
    statusText: response.statusText,
    headers: responseHeaders,
  })
}
