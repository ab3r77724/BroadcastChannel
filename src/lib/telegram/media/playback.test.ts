import type { BotMediaRef } from '../types'
import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import { getAudio, getVideo } from './playback'

function botMedia(entries: Array<[string, Partial<BotMediaRef>]>): Map<string, BotMediaRef> {
  return new Map(entries.map(([id, media]) => [id, { fileId: `file-${id}`, ...media }]))
}

describe('getVideo', () => {
  it('replaces a video src with the bot original', () => {
    const $ = load('<div class="tgme_widget_message"><div class="tgme_widget_message_video_wrap"><video src="https://cdn.example/v.mp4"></video></div></div>')
    const html = getVideo($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '40',
      botMedia: botMedia([['40', { kind: 'video' }]]),
    })

    expect(html).toContain('<video src="/api/bot-file?file_id=file-40"')
    expect(html).toContain('controls=""')
    expect(html).not.toContain('cdn.example')
  })

  it('proxies the web src when the bot has no video', () => {
    const $ = load('<div class="tgme_widget_message"><div class="tgme_widget_message_video_wrap"><video src="https://cdn.example/v.mp4"></video></div></div>')
    const html = getVideo($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '40',
    })

    expect(html).toContain('<video src="/static/https://cdn.example/v.mp4"')
  })

  it('replaces a round video with the bot video_note original', () => {
    const $ = load('<div class="tgme_widget_message"><div class="tgme_widget_message_roundvideo_wrap"><video src="https://cdn.example/r.mp4"></video></div></div>')
    const html = getVideo($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '41',
      botMedia: botMedia([['41', { kind: 'video' }]]),
    })

    expect(html).toContain('<video src="/api/bot-file?file_id=file-41"')
  })

  it('resolves grouped videos by their own message ids', () => {
    const $ = load('<div class="tgme_widget_message"><a class="tgme_widget_message_video_wrap" href="https://t.me/channel/40?single"><video src="https://cdn.example/a.mp4"></video></a><a class="tgme_widget_message_video_wrap" href="https://t.me/channel/41?single"><video src="https://cdn.example/b.mp4"></video></a></div>')
    const html = getVideo($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '40',
      botMedia: botMedia([['40', { kind: 'video' }], ['41', { kind: 'video' }]]),
    })

    expect(html).toContain('/api/bot-file?file_id=file-40')
    expect(html).toContain('/api/bot-file?file_id=file-41')
    expect(html).not.toContain('cdn.example')
  })
})

describe('getAudio', () => {
  it('replaces a voice message src with the bot original', () => {
    const $ = load('<div class="tgme_widget_message"><audio class="tgme_widget_message_voice" src="https://cdn.example/v.ogg"></audio></div>')
    const html = getAudio($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '42',
      botMedia: botMedia([['42', { kind: 'voice' }]]),
    })

    expect(html).toContain('<audio class="tgme_widget_message_voice" src="/api/bot-file?file_id=file-42"')
  })

  it('replaces a music file src with the bot audio original', () => {
    const $ = load('<div class="tgme_widget_message"><audio class="tgme_widget_message_voice" src="https://cdn.example/m.mp3"></audio></div>')
    const html = getAudio($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '43',
      botMedia: botMedia([['43', { kind: 'audio' }]]),
    })

    expect(html).toContain('<audio class="tgme_widget_message_voice" src="/api/bot-file?file_id=file-43"')
  })

  it('proxies the web src when the bot has no audio', () => {
    const $ = load('<div class="tgme_widget_message"><audio class="tgme_widget_message_voice" src="https://cdn.example/m.mp3"></audio></div>')
    const html = getAudio($, $('.tgme_widget_message'), {
      staticProxy: '/static/',
      id: '43',
    })

    expect(html).toContain('src="/static/https://cdn.example/m.mp3"')
  })
})
