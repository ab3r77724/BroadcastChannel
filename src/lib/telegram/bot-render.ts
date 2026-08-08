import type { Post } from '../../types'
import type { BotMedia, BotMessage, BotMessageEntity } from './bot'
import * as cheerio from 'cheerio'
import { extractBotMedia, getBotFileUrl } from './bot'
import { modifyHTMLContent } from './content'
import { renderInlineImage } from './media/images'
import { getOpenGraphPreview } from './og'
import { stripDetachedTagClusters } from './parse'
import { escapeHtmlAttribute, normalizeUrlAttribute } from './url'

const TITLE_PREVIEW_REGEX = /^.*?(?=[。\n]|http\S)/g

export interface RenderBotPostOptions {
  index?: number
  telegramHost?: string
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll('\'', '&#39;')
}

export function getBotMessageTags(message: BotMessage): string[] {
  const text = message.text ?? message.caption ?? ''
  const entities = message.entities ?? message.caption_entities ?? []
  return collectBotTags(text, entities)
}

function collectBotTags(text: string, entities: BotMessageEntity[]): string[] {
  const tags = new Set<string>()

  for (const entity of entities) {
    if (entity.type !== 'hashtag' || entity.length <= 1) {
      continue
    }

    const tag = text.slice(entity.offset, entity.offset + entity.length).replace(/^#/, '')
    if (tag) {
      tags.add(tag)
    }
  }

  if (tags.size === 0) {
    for (const match of text.matchAll(/(?:^|\s)(#\w+)/g)) {
      const tag = match[1].replace(/^#/, '')
      if (tag) {
        tags.add(tag)
      }
    }
  }

  return [...tags]
}

function normalizeBotUrl(raw: string): string {
  const value = normalizeUrlAttribute(raw.trim())

  try {
    const url = new URL(value)
    return url.protocol === 'http:' || url.protocol === 'https:' ? url.toString() : ''
  }
  catch {
    return ''
  }
}

function wrapBotEntity(entity: BotMessageEntity, innerHtml: string, rawInner: string): string {
  switch (entity.type) {
    case 'bold':
      return `<b>${innerHtml}</b>`
    case 'italic':
      return `<i>${innerHtml}</i>`
    case 'underline':
      return `<u>${innerHtml}</u>`
    case 'strikethrough':
      return `<s>${innerHtml}</s>`
    case 'spoiler':
      return `<tg-spoiler>${innerHtml}</tg-spoiler>`
    case 'code':
      return `<code>${innerHtml}</code>`
    case 'pre':
      return `<pre class="code"><code class="language-text">${innerHtml}</code></pre>`
    case 'blockquote':
      return `<blockquote>${innerHtml}</blockquote>`
    case 'expandable_blockquote':
      return `<blockquote expandable>${innerHtml}</blockquote>`
    case 'text_link': {
      const href = normalizeBotUrl(entity.url ?? '')
      return href ? `<a href="${escapeHtmlAttribute(href)}">${innerHtml}</a>` : innerHtml
    }
    case 'url': {
      const href = normalizeBotUrl(rawInner)
      return href ? `<a href="${escapeHtmlAttribute(href)}">${innerHtml}</a>` : innerHtml
    }
    case 'email':
      return `<a href="mailto:${escapeHtmlAttribute(rawInner)}">${innerHtml}</a>`
    case 'phone_number':
      return `<a href="tel:${escapeHtmlAttribute(rawInner)}">${innerHtml}</a>`
    case 'mention': {
      const username = rawInner.replace(/^@/, '')
      if (/^\w{3,}$/.test(username)) {
        return `<a href="https://t.me/${escapeHtmlAttribute(username)}">${innerHtml}</a>`
      }
      return innerHtml
    }
    case 'hashtag':
      return `<a href="/search/result?q=${encodeURIComponent(rawInner)}">${innerHtml}</a>`
    case 'custom_emoji': {
      const emojiId = entity.custom_emoji_id
      return emojiId
        ? `<tg-emoji emoji-id="${escapeHtmlAttribute(emojiId)}">${innerHtml}</tg-emoji>`
        : innerHtml
    }
    default:
      return innerHtml
  }
}

function renderTextWithEntities(text: string, entities: BotMessageEntity[], start = 0, end = text.length): string {
  const contained = entities
    .filter(entity => entity.offset >= start && entity.offset + entity.length <= end && entity.length > 0)
    .sort((a, b) => a.offset - b.offset || b.length - a.length)

  if (contained.length === 0) {
    return escapeHtml(text.slice(start, end))
  }

  // 只处理没有被其他 entity 完整包住的顶层 entity，嵌套的交给递归。
  const topLevel = contained.filter((candidate) => {
    return !contained.some((other) => {
      return candidate !== other
        && other.offset <= candidate.offset
        && candidate.offset + candidate.length <= other.offset + other.length
        && (other.offset < candidate.offset || other.offset + other.length > candidate.offset + candidate.length)
    })
  })

  // 同一段文字上叠加多个 entity（例如 bold + text_link）时只渲染一次正文。
  const groups = new Map<string, BotMessageEntity[]>()
  for (const entity of topLevel) {
    const key = `${entity.offset}:${entity.length}`
    const group = groups.get(key) ?? []
    group.push(entity)
    groups.set(key, group)
  }

  let cursor = start
  let output = ''
  const sortedGroups = [...groups.entries()].sort((a, b) => {
    const [aOffset, aLength] = a[0].split(':').map(Number)
    const [bOffset, bLength] = b[0].split(':').map(Number)
    return aOffset - bOffset || bLength - aLength
  })

  for (const [, group] of sortedGroups) {
    const entity = group[0]
    if (entity.offset > cursor) {
      output += escapeHtml(text.slice(cursor, entity.offset))
    }

    const innerStart = entity.offset
    const innerEnd = entity.offset + entity.length
    const nested = contained.filter((candidate) => {
      return candidate.offset >= innerStart
        && candidate.offset + candidate.length <= innerEnd
        && (candidate.offset > innerStart || candidate.offset + candidate.length < innerEnd)
    })
    let inner = renderTextWithEntities(text, nested, innerStart, innerEnd)
    for (const wrapper of group) {
      inner = wrapBotEntity(wrapper, inner, text.slice(innerStart, innerEnd))
    }
    output += inner
    cursor = innerEnd
  }

  if (cursor < end) {
    output += escapeHtml(text.slice(cursor, end))
  }

  return output
}

interface RenderedBotContent {
  html: string
  text: string
}

async function renderBotContentHtml(
  text: string,
  entities: BotMessageEntity[],
  options: RenderBotPostOptions,
): Promise<RenderedBotContent> {
  const rendered = renderTextWithEntities(text, entities)
  if (!rendered) {
    return { html: '', text: '' }
  }

  const $ = cheerio.load(`<div>${rendered}</div>`, {}, false)
  const content = $('div')
  await modifyHTMLContent($, content, {
    index: options.index ?? 0,
    telegramHost: options.telegramHost,
    normalizeUrls: true,
  })
  // 正文里的 hashtag 和底部 post-tags 叠两层太憨批，与网页版解析保持一致：
  // 剥掉开头/结尾的独立 tag 簇，句子中间当正文的 hashtag 留着。
  stripDetachedTagClusters($, content)

  return {
    html: content.html() ?? '',
    text: content.text().trim(),
  }
}

function renderBotPhoto(media: BotMedia, id: string, index: number, title: string): string {
  return `<div class="image-list-container image-list-odd">${renderInlineImage({
    src: getBotFileUrl(media.fileId),
    popoverId: `modal-${id}-0`,
    index,
    title,
    width: media.width,
    height: media.height,
  })}</div>`
}

function renderBotVideo(media: BotMedia, index: number): string {
  const preload = index > 15 ? 'metadata' : 'auto'
  const width = media.width ?? 16
  const height = media.height ?? 9

  return `<video controls preload="${preload}" playsinline webkit-playsinline src="${getBotFileUrl(media.fileId)}" width="${width}" height="${height}"></video>`
}

function renderBotAudio(media: BotMedia, index: number): string {
  const preload = index > 15 ? 'metadata' : 'auto'
  return `<audio controls preload="${preload}" src="${getBotFileUrl(media.fileId)}"></audio>`
}

function renderBotDocument(media: BotMedia): string {
  const name = media.fileName || 'Document'
  return `<p class="bot-document"><a href="${getBotFileUrl(media.fileId)}" target="_blank" rel="noopener">${escapeHtml(name)}</a></p>`
}

function renderLinkPreview(preview: {
  url: string
  title: string
  description?: string
  image?: string
}): string {
  const safeUrl = escapeHtmlAttribute(preview.url)
  const safeTitle = escapeHtml(preview.title)
  const safeTitleAttr = escapeHtmlAttribute(preview.title)
  const description = preview.description ? escapeHtml(preview.description) : ''
  const safeDescriptionAttr = escapeHtmlAttribute(preview.description || preview.title)

  let domain = ''
  try {
    domain = new URL(preview.url).hostname
  }
  catch {
    domain = preview.url
  }

  const image = preview.image ? escapeHtmlAttribute(preview.image) : ''
  const imageMarkup = image
    ? `<img class="link_preview_image" src="${image}" alt="${safeTitleAttr}" width="1200" height="630" loading="lazy" />`
    : ''

  return `<a class="tgme_widget_message_link_preview" href="${safeUrl}" target="_blank" rel="noopener" title="${safeDescriptionAttr}">
  <span class="link_preview_site_name">${escapeHtml(domain)}</span>
  ${imageMarkup}
  <span class="link_preview_title">${safeTitle}</span>
  <span class="link_preview_description">${description}</span>
</a>`
}

export async function renderBotPost(message: BotMessage, options: RenderBotPostOptions = {}): Promise<Post> {
  const { index = 0, telegramHost } = options
  const rawText = message.text ?? message.caption ?? ''
  const entities = message.entities ?? message.caption_entities ?? []
  const id = String(message.message_id)
  const media = extractBotMedia(message)
  const rendered = await renderBotContentHtml(rawText, entities, { index, telegramHost })
  const linkPreview = message.link_preview_options?.url && !message.link_preview_options.is_disabled
    ? await getOpenGraphPreview(message.link_preview_options.url)
    : null
  const title = rendered.text.match(TITLE_PREVIEW_REGEX)?.[0] ?? rendered.text
  const contentHtml = [
    renderBotMediaContent(media, id, index, title),
    rendered.html,
    renderBotDocumentContent(media),
    linkPreview ? renderLinkPreview(linkPreview) : '',
  ]
    .filter(Boolean)
    .join('')

  return {
    id,
    title: title || (media ? 'Media' : ''),
    type: 'text',
    datetime: new Date(message.date * 1000).toISOString(),
    tags: collectBotTags(rawText, entities),
    text: rendered.text,
    content: contentHtml,
    reactions: [],
  }
}

export async function renderBotAlbum(messages: BotMessage[], options: RenderBotPostOptions = {}): Promise<Post> {
  const sorted = [...messages].sort((a, b) => a.message_id - b.message_id)
  const first = sorted[0]
  const captionMessage = sorted.find(message => (message.caption ?? '').trim()) ?? sorted[sorted.length - 1]
  const rawCaption = captionMessage.caption ?? ''
  const entities = captionMessage.caption_entities ?? []
  const id = String(first.message_id)
  const mediaList = sorted
    .map(extractBotMedia)
    .filter((media): media is BotMedia => Boolean(media))
  const rendered = await renderBotContentHtml(rawCaption, entities, options)
  const title = rendered.text.match(TITLE_PREVIEW_REGEX)?.[0] ?? rendered.text
  const mediaHtml = mediaList
    .map((media, index) => renderBotMediaContent(media, `${id}-${index}`, index, title))
    .join('')

  return {
    id,
    title: title || 'Media',
    type: 'text',
    datetime: new Date(first.date * 1000).toISOString(),
    tags: collectBotTags(rawCaption, entities),
    text: rendered.text,
    content: [mediaHtml, rendered.html].filter(Boolean).join(''),
    reactions: [],
  }
}

function renderBotMediaContent(media: BotMedia | null, id: string, index: number, title: string): string {
  if (!media) {
    return ''
  }

  switch (media.kind) {
    case 'photo':
      return renderBotPhoto(media, id, index, title)
    case 'video':
      return renderBotVideo(media, index)
    case 'audio':
    case 'voice':
      return renderBotAudio(media, index)
    case 'document':
      return ''
  }
}

function renderBotDocumentContent(media: BotMedia | null): string {
  return media?.kind === 'document' ? renderBotDocument(media) : ''
}
