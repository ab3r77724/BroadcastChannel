import type { AnyNode, CheerioAPI } from 'cheerio'
import type { Post, Reaction } from '../../types'
import type { ExtractPostOptions, MessageSelection } from './types'
import { modifyHTMLContent } from './content'
import { getCustomEmojiImage, normalizeEmoji } from './emoji'
import { getAudio, getForwardedFrom, getImages, getImageStickers, getLinkPreview, getReply, getTgsStickers, getVideo, getVideoStickers } from './media'
import { renderRawContent } from './renderers/raw'
import { normalizeUrlAttributes } from './url'

const TITLE_PREVIEW_REGEX = /^.*?(?=[。\n]|http\S)/g

function isNonEmptyString(value: string | null | undefined): value is string {
  return Boolean(value)
}

function isWhitespaceTextNode(node: AnyNode): boolean {
  return node.type === 'text' && !/\S/.test(('data' in node && typeof node.data === 'string' ? node.data : '') || '')
}

function isBreakElement(node: AnyNode): boolean {
  return node.type === 'tag' && 'name' in node && node.name === 'br'
}

function isCollectedTagLink($: CheerioAPI, node: AnyNode): boolean {
  if (node.type !== 'tag' || !('name' in node) || node.name !== 'a') {
    return false
  }

  const href = $(node).attr('href') ?? ''
  return href.startsWith('?q=') || href.startsWith('/search/result?q=')
}

function selectMessageText($: CheerioAPI, message: MessageSelection, hasReplyText: boolean): MessageSelection {
  const selector = hasReplyText
    ? '.tgme_widget_message_text.js-message_text'
    : '.tgme_widget_message_text'

  // Telegram 媒体 caption 会套两层同名 text 节点，find 全捞会重复正文/tag
  const candidates = message.find(selector).toArray()
  const candidateSet = new Set(candidates)
  const roots = candidates.filter((node) => {
    return $(node).parents().toArray().every(parent => !candidateSet.has(parent))
  })

  return $(roots)
}

/**
 * 把嵌套的 .tgme_widget_message_text 拆平，不然 strip 只看顶层 children 会直接卡死。
 */
function unwrapNestedMessageText($: CheerioAPI, content: MessageSelection): void {
  while (true) {
    const nested = content.find('.tgme_widget_message_text').toArray()
    if (!nested.length) {
      break
    }

    for (const node of nested) {
      const wrapper = $(node)
      wrapper.replaceWith(wrapper.contents())
    }
  }
}

function rewriteTagLinksAndCollectTags($: CheerioAPI, content: MessageSelection): string[] {
  const tags: string[] = []

  for (const tagNode of content.find('a[href^="?q="]').toArray()) {
    const tagLink = $(tagNode)
    const tagText = tagLink.text()

    tagLink.attr('href', `/search/result?q=${encodeURIComponent(tagText)}`)

    const normalizedTag = tagText.replace('#', '')
    if (normalizedTag) {
      tags.push(normalizedTag)
    }
  }

  // 嵌套 caption / 重复节点时别把同一个 tag 塞两遍
  return [...new Set(tags)]
}

/**
 * 正文里的 hashtag 和底部 post-tags 叠两层太憨批。
 * 只剥掉开头/结尾的独立 tag 簇，句子中间当正文的 hashtag 留着。
 */
function stripDetachedTagClusters($: CheerioAPI, content: MessageSelection): void {
  while (true) {
    const nodes = content.contents().toArray()
    if (!nodes.length) {
      break
    }

    const first = nodes[0]
    if (isWhitespaceTextNode(first) || isBreakElement(first) || isCollectedTagLink($, first)) {
      $(first).remove()
      continue
    }

    break
  }

  const nodes = content.contents().toArray()
  if (!nodes.length) {
    return
  }

  let index = nodes.length - 1
  let clusterStart = -1
  let sawTag = false

  while (index >= 0) {
    const node = nodes[index]
    if (isCollectedTagLink($, node) || isWhitespaceTextNode(node) || isBreakElement(node)) {
      if (isCollectedTagLink($, node)) {
        sawTag = true
      }
      clusterStart = index
      index -= 1
      continue
    }
    break
  }

  if (!sawTag || clusterStart < 0) {
    return
  }

  const before = clusterStart > 0 ? nodes[clusterStart - 1] : null
  const cluster = nodes.slice(clusterStart)
  const clusterHasBreak = cluster.some(node => isBreakElement(node))
  const separated = !before
    || isBreakElement(before)
    || clusterHasBreak
    || (
      before.type === 'text'
      && /\n\s*$/.test(('data' in before && typeof before.data === 'string' ? before.data : '') || '')
    )

  // 末尾 hashtag 还粘在句子里就别乱删，那是正文不是分类标签
  if (!separated && before) {
    return
  }

  for (const node of cluster) {
    $(node).remove()
  }

  while (true) {
    const remaining = content.contents().toArray()
    if (!remaining.length) {
      break
    }

    const last = remaining[remaining.length - 1]
    if (isWhitespaceTextNode(last) || isBreakElement(last)) {
      $(last).remove()
      continue
    }

    break
  }
}

function renderPostContent(
  $: CheerioAPI,
  message: MessageSelection,
  content: MessageSelection,
  options: {
    channel: string
    staticProxy: string
    index: number
    id: string
    title: string
  },
): string {
  const { channel, staticProxy, index, id, title } = options

  return [
    getForwardedFrom($, message),
    getReply($, message, { channel }),
    getImages($, message, { staticProxy, id, index, title }),
    getVideo($, message, { staticProxy, index }),
    getAudio($, message, { staticProxy }),
    content.html(),
    getImageStickers($, message, { staticProxy, index }),
    getTgsStickers($, message, { staticProxy, index }),
    getVideoStickers($, message, { staticProxy, index }),
    ...renderRawContent($, message, { staticProxy }),
    getLinkPreview($, message, { staticProxy, index }),
  ]
    .filter(isNonEmptyString)
    .join('')
}

function getReactions($: CheerioAPI, message: MessageSelection, telegramHost: string, staticProxy: string): Reaction[] {
  const reactions: Reaction[] = []

  for (const reactionNode of message.find('.tgme_widget_message_reactions .tgme_reaction').toArray()) {
    const reaction = $(reactionNode)
    const isPaid = reaction.hasClass('tgme_reaction_paid')
    let emoji = ''
    let emojiId: string | undefined
    let emojiImage: string | undefined

    const standardEmoji = reaction.find('.emoji b')
    if (standardEmoji.length) {
      emoji = normalizeEmoji(standardEmoji.text().trim())
    }

    const tgEmoji = reaction.find('tg-emoji')
    if (tgEmoji.length && !emoji) {
      emojiId = tgEmoji.attr('emoji-id')
      const customEmojiImage = getCustomEmojiImage(emojiId, { telegramHost, staticProxy })
      if (customEmojiImage) {
        emojiImage = customEmojiImage
      }
    }

    if (isPaid && !emoji && !emojiImage) {
      emoji = '\u2B50'
    }

    const clone = reaction.clone()
    clone.find('.emoji, tg-emoji, i').remove()
    const count = clone.text().trim()

    if (count) {
      reactions.push({
        emoji,
        emojiId,
        emojiImage,
        count,
        isPaid,
      })
    }
  }

  return reactions
}

export async function extractPost($: CheerioAPI, item: AnyNode | null, options: ExtractPostOptions): Promise<Post> {
  const { channel, telegramHost, staticProxy, index = 0, reactionsEnabled } = options
  const message = item ? $(item).find('.tgme_widget_message') : $('.tgme_widget_message')
  normalizeUrlAttributes($, message)
  const hasReplyText = message.find('.js-message_reply_text').length > 0
  const messageText = selectMessageText($, message, hasReplyText)
  unwrapNestedMessageText($, messageText)
  const content = await modifyHTMLContent(
    $,
    messageText,
    { index, telegramHost, staticProxy, normalizeUrls: false },
  )
  const id = message.attr('data-post')?.replace(new RegExp(`${channel}/`, 'i'), '') ?? ''
  const tags = rewriteTagLinksAndCollectTags($, content)
  stripDetachedTagClusters($, content)
  const contentText = content.text()
  const title = contentText.match(TITLE_PREVIEW_REGEX)?.[0] ?? contentText
  const contentHtml = renderPostContent($, message, content, { channel, staticProxy, index, id, title })

  return {
    id,
    title,
    type: message.attr('class')?.includes('service_message') ? 'service' : 'text',
    datetime: message.find('.tgme_widget_message_date time').attr('datetime') ?? '',
    tags,
    text: contentText,
    content: contentHtml,
    reactions: reactionsEnabled ? getReactions($, message, telegramHost, staticProxy) : [],
  }
}
