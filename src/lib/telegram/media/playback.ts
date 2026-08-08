import type { CheerioAPI } from 'cheerio'
import type { BotMediaRef, MessageAssetOptions, MessageSelection } from '../types'
import { getBotFileUrl } from '../bot'
import { getProxiedUrl } from '../url'

// 相册里的视频/音频跟图片一样，每条媒体是独立消息，媒体节点或外层链接
// 自带自己的消息 id（/42?single）；没有就退回消息卡片的 data-post。
const MEDIA_MESSAGE_ID_REGEX = /\/(\d+)(?:\?[^/]*)?$/

function getMediaMessageId($: CheerioAPI, node: MessageSelection, fallbackId: string): string {
  const candidates = [node, node.parent(), node.closest('a')]

  for (const candidate of candidates) {
    const href = candidate.attr('href')
    const mediaId = href?.match(MEDIA_MESSAGE_ID_REGEX)?.[1]
    if (mediaId) {
      return mediaId
    }
  }

  return fallbackId
}

function getBotMediaByKind(botMedia: Map<string, BotMediaRef> | undefined, mediaId: string, kind: BotMediaRef['kind']): BotMediaRef | undefined {
  const media = botMedia?.get(mediaId)
  return media?.kind === kind ? media : undefined
}

function resolveMediaSrc(
  webSrc: string | undefined,
  staticProxy: string,
  botMedia: Map<string, BotMediaRef> | undefined,
  mediaId: string,
  kind: BotMediaRef['kind'],
): string | undefined {
  const botMediaRef = getBotMediaByKind(botMedia, mediaId, kind)
  if (botMediaRef) {
    return getBotFileUrl(botMediaRef.fileId)
  }
  return webSrc ? getProxiedUrl(staticProxy, webSrc) : undefined
}

export function getVideo($: CheerioAPI, message: MessageSelection, options: MessageAssetOptions): string {
  const { staticProxy = '', index = 0, id = '', botMedia } = options
  const fragments: string[] = []

  for (const videoNode of message.find('.tgme_widget_message_video_wrap video, .tgme_widget_message_roundvideo_wrap video').toArray()) {
    const video = $(videoNode)
    const mediaId = getMediaMessageId($, video, id)
    const src = resolveMediaSrc(video.attr('src'), staticProxy, botMedia, mediaId, 'video')

    if (src) {
      video.attr('src', src)
    }

    video
      .attr('controls', '')
      .attr('preload', index > 15 ? 'metadata' : 'auto')
      .attr('playsinline', '')
      .attr('webkit-playsinline', '')
    fragments.push($.html(video))
  }

  return fragments.join('')
}

export function getAudio($: CheerioAPI, message: MessageSelection, options: MessageAssetOptions): string {
  const { staticProxy = '', id = '', botMedia } = options
  const audio = message.find('.tgme_widget_message_voice')
  const audioSrc = audio.attr('src')
  const mediaId = getMediaMessageId($, audio, id)
  const botAudio = getBotMediaByKind(botMedia, mediaId, 'voice') ?? getBotMediaByKind(botMedia, mediaId, 'audio')
  const src = botAudio ? getBotFileUrl(botAudio.fileId) : audioSrc ? getProxiedUrl(staticProxy, audioSrc) : undefined

  if (src) {
    audio.attr('src', src)
  }

  audio.attr('controls', '')
  return $.html(audio)
}
