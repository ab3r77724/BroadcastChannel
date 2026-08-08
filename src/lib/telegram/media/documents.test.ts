import type { BotMediaRef } from '../types'
import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import { getDocuments } from './documents'

function documentCard(id: string, name = 'photo.png'): string {
  return `<a class="tgme_widget_message_document_wrap" href="https://t.me/channel/${id}"><div class="tgme_widget_message_document_icon"></div><div class="tgme_widget_message_document"><div class="tgme_widget_message_document_title">${name}</div><div class="tgme_widget_message_document_extra">5.4 MB</div></div></a>`
}

function botMedia(entries: Array<[string, Partial<BotMediaRef>]>): Map<string, BotMediaRef> {
  return new Map(entries.map(([id, media]) => [id, { fileId: `file-${id}`, ...media }]))
}

describe('getDocuments', () => {
  it('renders an image document inline with the bot original', () => {
    const $ = load(`<div class="tgme_widget_message">${documentCard('36')}</div>`)
    const html = getDocuments($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '36',
      botMedia: botMedia([['36', { kind: 'document', mimeType: 'image/png', fileName: 'wallhaven-gwd8r7.png' }]]),
    })

    expect(html).toContain('image-list-container')
    expect(html).toContain('/api/bot-file?file_id=file-36')
    expect(html).not.toContain('tgme_widget_message_document_wrap')
  })

  it('keeps a non-image document as a file card', () => {
    const $ = load(`<div class="tgme_widget_message">${documentCard('36', 'archive.zip')}</div>`)
    const html = getDocuments($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '36',
      botMedia: botMedia([['36', { kind: 'document', mimeType: 'application/zip', fileName: 'archive.zip' }]]),
    })

    expect(html).toContain('tgme_widget_message_document_wrap')
    expect(html).not.toContain('image-list-container')
  })

  it('keeps the file card when the bot has no media for the document', () => {
    const $ = load(`<div class="tgme_widget_message">${documentCard('36')}</div>`)
    const html = getDocuments($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '36',
    })

    expect(html).toContain('tgme_widget_message_document_wrap')
  })

  it('does not inline HEIC documents', () => {
    const $ = load(`<div class="tgme_widget_message">${documentCard('36', 'photo.heic')}</div>`)
    const html = getDocuments($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '36',
      botMedia: botMedia([['36', { kind: 'document', mimeType: 'image/heic', fileName: 'photo.heic' }]]),
    })

    expect(html).toContain('tgme_widget_message_document_wrap')
    expect(html).not.toContain('image-list-container')
  })
})
