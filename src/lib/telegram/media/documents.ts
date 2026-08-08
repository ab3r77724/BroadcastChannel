import type { CheerioAPI } from 'cheerio'
import type { BotMediaRef, MessageAssetOptions, MessageSelection } from '../types'
import { getBotFileUrl } from '../bot'
import { proxyStyleUrls } from '../url'
import { renderInlineImage } from './images'

// 相册里每个文件/图片同样是一条独立消息，文件卡自带自己的消息 id。
const DOCUMENT_MESSAGE_ID_REGEX = /\/(\d+)(?:\?[^/]*)?$/

// 只把浏览器能直接解码的图片文件内联展示；HEIC/SVG 之类保持文件卡，
// 避免出现裂图或 SVG 脚本风险。
const INLINE_IMAGE_MIME_TYPES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'image/avif',
  'image/bmp',
])
const INLINE_IMAGE_EXTENSIONS = ['.jpg', '.jpeg', '.png', '.gif', '.webp', '.avif', '.bmp']

function isInlineImageDocument(media: BotMediaRef | undefined): media is BotMediaRef {
  if (!media) {
    return false
  }

  const mimeType = media.mimeType?.toLowerCase()
  if (mimeType && INLINE_IMAGE_MIME_TYPES.has(mimeType)) {
    return true
  }
  if (mimeType && !mimeType.startsWith('image/')) {
    return false
  }

  const fileName = media.fileName?.toLowerCase()
  return Boolean(fileName && INLINE_IMAGE_EXTENSIONS.some(extension => fileName.endsWith(extension)))
}

export function getDocuments($: CheerioAPI, message: MessageSelection, options: MessageAssetOptions): string {
  const { staticProxy = '', id = '', index = 0, title = '', botMedia } = options
  const imageFragments: string[] = []
  const cardFragments: string[] = []

  for (const [docIndex, docNode] of message.find('.tgme_widget_message_document_wrap').toArray().entries()) {
    const doc = $(docNode)
    const docHref = doc.attr('href')
    const docId = docHref?.match(DOCUMENT_MESSAGE_ID_REGEX)?.[1] ?? id
    const botDoc = botMedia?.get(docId)

    if (isInlineImageDocument(botDoc)) {
      imageFragments.push(renderInlineImage({
        src: getBotFileUrl(botDoc.fileId),
        popoverId: `modal-${docId}-${docIndex}`,
        index,
        title: botDoc.fileName || title,
        width: botDoc.width,
        height: botDoc.height,
      }))
    }
    else {
      proxyStyleUrls($, doc, staticProxy)
      cardFragments.push($.html(doc))
    }
  }

  if (!imageFragments.length && !cardFragments.length) {
    return ''
  }

  const imageList = imageFragments.length
    ? `<div class="image-list-container ${imageFragments.length % 2 === 0 ? 'image-list-even' : 'image-list-odd'}">${imageFragments.join('')}</div>`
    : ''

  return [imageList, cardFragments.join('')].filter(Boolean).join('')
}
