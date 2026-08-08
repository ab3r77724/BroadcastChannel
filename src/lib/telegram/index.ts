import type { ChannelInfo, GetChannelInfoParams, Post } from '../../types'
import { getTelegramHost } from '../env'
import {
  getBotChannelMessages,
  getBotChatInfo,
  getBotFileUrl,
  getBotMediaByMessageId,
  groupMessagesByMediaGroup,
  isBotEnabled,
} from './bot'
import { escapeHtml, renderBotAlbum, renderBotPost } from './bot-render'
import { modifyHTMLContent } from './content'
import { extractPost } from './parse'
import { ChannelAccessError, loadChannelDocument } from './request'
import { normalizeUrlAttribute } from './url'

export function isRenderablePost(post: Post | null | undefined): post is Post {
  return Boolean(post?.id && post.type === 'text' && post.content)
}

export async function getChannelPost(id: string): Promise<Post | null> {
  const env = import.meta.env
  const { $, channel, telegramHost, staticProxy, reactionsEnabled, access } = await loadChannelDocument({ id })

  if (access === 'private') {
    if (!isBotEnabled(env)) {
      throw new ChannelAccessError('private')
    }

    const { messages } = await getBotChannelMessages(env, channel)
    const message = messages.find(item => String(item.message_id) === id)
    return message ? renderBotPost(message, { telegramHost }) : null
  }

  if (access === 'unavailable') {
    return null
  }

  const botMedia = isBotEnabled(env) ? await getBotMediaByMessageId(env, channel) : undefined
  const post = await extractPost($, null, { channel, telegramHost, staticProxy, reactionsEnabled, botMedia })

  return isRenderablePost(post) ? post : null
}

export async function getChannelInfo(params: GetChannelInfoParams = {}): Promise<ChannelInfo> {
  const { before = '', after = '', q = '' } = params
  const doc = await loadChannelDocument({ before, after, q })

  if (doc.access === 'private') {
    return getPrivateChannelInfo(doc.channel, params)
  }

  if (doc.access === 'unavailable') {
    throw new ChannelAccessError('unavailable')
  }

  return getPublicChannelInfo(doc)
}

async function getPublicChannelInfo(doc: Awaited<ReturnType<typeof loadChannelDocument>>): Promise<ChannelInfo> {
  const { $, channel, telegramHost, staticProxy, reactionsEnabled } = doc
  const env = import.meta.env
  const botMedia = isBotEnabled(env) ? await getBotMediaByMessageId(env, channel) : undefined
  const postNodes = $('.tgme_channel_history .tgme_widget_message_wrap').toArray()
  const avatar = $('.tgme_page_photo_image img').attr('src')
  const posts = (await Promise.all(
    postNodes.map((item, index) => extractPost($, item, {
      channel,
      telegramHost,
      staticProxy,
      index,
      reactionsEnabled,
      botMedia,
    })),
  ))
    .reverse()
    .filter(isRenderablePost)

  const channelInfo: ChannelInfo = {
    posts,
    title: $('.tgme_channel_info_header_title').text(),
    description: $('.tgme_channel_info_description').text(),
    descriptionHTML: (await modifyHTMLContent($, $('.tgme_channel_info_description'), { telegramHost, staticProxy })).html(),
    avatar: avatar ? normalizeUrlAttribute(avatar) : avatar,
    pagination: true,
  }

  return channelInfo
}

async function getPrivateChannelInfo(channel: string, params: GetChannelInfoParams): Promise<ChannelInfo> {
  const env = import.meta.env

  if (!isBotEnabled(env)) {
    throw new ChannelAccessError('private')
  }

  const { messages, chat } = await getBotChannelMessages(env, channel)
  if (messages.length === 0) {
    throw new ChannelAccessError('private', { hasBot: true })
  }

  const chatInfo = await getBotChatInfo(env, channel, chat)
  const telegramHost = getTelegramHost(env)
  const query = (params.q ?? '').trim().toLowerCase()
  const messageGroups = groupMessagesByMediaGroup(messages)
  let postIndex = 0
  const posts = (await Promise.all(
    messageGroups.map((group) => {
      const index = postIndex
      postIndex += 1
      return group.length === 1
        ? renderBotPost(group[0], { index, telegramHost })
        : renderBotAlbum(group, { index, telegramHost })
    }),
  ))
    .filter(isRenderablePost)
    .sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime())
    .filter((post) => {
      if (!query) {
        return true
      }

      return post.text.toLowerCase().includes(query)
        || post.tags.some(tag => tag.toLowerCase().includes(query))
        || `#${post.tags.join(' #')}`.toLowerCase().includes(query)
    })

  const title = chatInfo?.title?.trim() || channel
  const description = chatInfo?.description?.trim() ?? ''

  return {
    posts,
    title,
    description,
    descriptionHTML: description ? `<p>${escapeHtml(description)}</p>` : null,
    avatar: chatInfo?.photo?.small_file_id ? getBotFileUrl(chatInfo.photo.small_file_id) : undefined,
    pagination: false,
  }
}
