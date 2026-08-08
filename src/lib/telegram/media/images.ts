import type { AnyNode, CheerioAPI } from 'cheerio'
import type { MessageAssetOptions, MessageSelection } from '../types'
import { getBotFileUrl } from '../bot'
import { escapeHtmlAttribute, getProxiedUrl } from '../url'
import { getImageLoading, inferImageDimensions, STYLE_URL_REGEX } from './utils'

// Telegram renders albums as one message whose `data-post` is the first photo's
// id, while each photo link points to its own message (`/20?single`, `/21?single`).
// Bot API media is keyed by that per-photo message id, so resolve it from the
// photo node's href instead of reusing the message wrap id for every photo.
const PHOTO_MESSAGE_ID_REGEX = /\/(\d+)(?:\?[^/]*)?$/

function getPhotoMessageId($: CheerioAPI, photoNode: AnyNode, fallbackId: string): string {
  return $(photoNode).attr('href')?.match(PHOTO_MESSAGE_ID_REGEX)?.[1] ?? fallbackId
}

export interface InlineImageOptions {
  src: string
  popoverId: string
  index: number
  title?: string
  width?: number
  height?: number
}

export function renderInlineImage(options: InlineImageOptions): string {
  const { src, popoverId, index, title = '', width = 1000, height = 1000 } = options
  const loading = getImageLoading(index)
  const safeTitle = escapeHtmlAttribute(title || 'Image from post')
  const safePreviewLabel = escapeHtmlAttribute(title ? `Open image preview: ${title}` : 'Open image preview')
  const safeCloseLabel = 'Close image preview'

  return `
      <button
        type="button"
        class="image-preview-button image-preview-wrap"
        popovertarget="${popoverId}"
        popovertargetaction="show"
        aria-label="${safePreviewLabel}"
      >
        <img src="${src}" alt="${safeTitle}" width="${width}" height="${height}" loading="${loading}" />
      </button>
      <div class="modal" id="${popoverId}" popover="auto" aria-label="Image preview">
        <button
          type="button"
          class="modal__backdrop"
          popovertarget="${popoverId}"
          popovertargetaction="hide"
          aria-label="${safeCloseLabel}"
        ></button>
        <button
          type="button"
          class="modal__close"
          popovertarget="${popoverId}"
          popovertargetaction="hide"
          aria-label="${safeCloseLabel}"
        >&times;</button>
        <div class="modal__surface">
          <img class="modal-img" src="${src}" alt="${safeTitle}" width="${width}" height="${height}" loading="lazy" />
        </div>
      </div>
    `
}

export function getImages($: CheerioAPI, message: MessageSelection, options: MessageAssetOptions): string {
  const { staticProxy = '', id = '', index = 0, title = '', botMedia } = options
  const fragments: string[] = []

  for (const [photoIndex, photoNode] of message.find('.tgme_widget_message_photo_wrap').toArray().entries()) {
    const imageUrl = $(photoNode).attr('style')?.match(STYLE_URL_REGEX)?.[1]

    if (!imageUrl) {
      continue
    }

    const photoId = getPhotoMessageId($, photoNode, id)
    const botImage = botMedia?.get(photoId)
    const popoverId = `modal-${photoId}-${photoIndex}`
    const { width, height } = botImage?.width && botImage?.height
      ? { width: botImage.width, height: botImage.height }
      : inferImageDimensions($, photoNode)
    const imageSrc = botImage ? getBotFileUrl(botImage.fileId) : getProxiedUrl(staticProxy, imageUrl)
    fragments.push(renderInlineImage({ src: imageSrc, popoverId, index, title, width, height }))
  }

  if (!fragments.length) {
    return ''
  }

  const layoutClass = fragments.length % 2 === 0 ? 'image-list-even' : 'image-list-odd'
  return `<div class="image-list-container ${layoutClass}">${fragments.join('')}</div>`
}
