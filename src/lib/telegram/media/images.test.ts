import type { BotMediaRef } from '../types'
import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import { getImages } from './images'

function photo(href: string, url: string): string {
  return `<a class="tgme_widget_message_photo_wrap" href="${href}" style="background-image:url('${url}')"></a>`
}

function botMedia(entries: Array<[string, string]>): Map<string, BotMediaRef> {
  return new Map(entries.map(([id, fileId]) => [id, { fileId }]))
}

describe('getImages with bot media', () => {
  it('replaces a single photo with its own bot file', () => {
    const $ = load(`<div class="tgme_widget_message">${photo('https://t.me/channel/10?single', 'https://cdn.example/a.jpg')}</div>`)
    const html = getImages($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '10',
      botMedia: botMedia([['10', 'file-a']]),
    })

    expect(html).toContain('/api/bot-file?file_id=file-a')
    expect(html).not.toContain('/static/')
  })

  it('resolves every album photo by its own message id', () => {
    const $ = load(`<div class="tgme_widget_message">${photo('https://t.me/channel/20?single', 'https://cdn.example/a.jpg')}${photo('https://t.me/channel/21?single', 'https://cdn.example/b.jpg')}</div>`)
    const html = getImages($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '20',
      botMedia: botMedia([['20', 'file-a'], ['21', 'file-b']]),
    })

    expect(html).toContain('/api/bot-file?file_id=file-a')
    expect(html).toContain('/api/bot-file?file_id=file-b')
    expect(html).not.toContain('/static/')
  })

  it('falls back to the static proxy when bot has no media for a photo', () => {
    const $ = load(`<div class="tgme_widget_message">${photo('https://t.me/channel/20?single', 'https://cdn.example/a.jpg')}${photo('https://t.me/channel/21?single', 'https://cdn.example/b.jpg')}</div>`)
    const html = getImages($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '20',
      botMedia: botMedia([['20', 'file-a']]),
    })

    expect(html).toContain('/api/bot-file?file_id=file-a')
    expect(html).toContain('/static/https://cdn.example/b.jpg')
  })

  it('falls back to the message id when a photo link has no id', () => {
    const $ = load(`<div class="tgme_widget_message">${photo('https://t.me/channel/30', 'https://cdn.example/a.jpg')}</div>`)
    const html = getImages($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '30',
      botMedia: botMedia([['30', 'file-a']]),
    })

    expect(html).toContain('/api/bot-file?file_id=file-a')
  })
})
