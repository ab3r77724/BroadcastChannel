import { describe, expect, it } from 'vitest'
import { detectChannelAccess, getTelegramRequestHeaders } from './request'

describe('telegram request headers', () => {
  it('uses deterministic headers without forwarding visitor or platform metadata', () => {
    const headers = getTelegramRequestHeaders()

    expect(headers).toMatchObject({
      'accept': 'text/html,application/xhtml+xml',
      'user-agent': 'BroadcastChannel/0.2.0',
    })

    expect(headers).not.toHaveProperty('cookie')
    expect(headers).not.toHaveProperty('authorization')
    expect(headers).not.toHaveProperty('x-forwarded-for')
    expect(headers).not.toHaveProperty('cf-connecting-ip')
    expect(headers).not.toHaveProperty('vercel-forwarded-for')
    expect(headers).not.toHaveProperty('referer')
  })
})

describe('telegram channel access detection', () => {
  it('detects a public channel from widget messages', () => {
    const html = '<div class="tgme_widget_message" data-post="channel/1">hello</div>'
    expect(detectChannelAccess(html)).toBe('public')
  })

  it('detects a public channel from metadata without messages', () => {
    const html = '<div class="tgme_channel_info"><div class="tgme_channel_info_header_title">Channel</div></div>'
    expect(detectChannelAccess(html)).toBe('public')
  })

  it('detects a private channel', () => {
    const html = '<div class="tgme_page"><div class="tgme_page_title">Channel</div><p>This channel is private. Join to view.</p></div>'
    expect(detectChannelAccess(html)).toBe('private')
  })

  it('detects a private channel from its contact landing page', () => {
    const html = '<div class="tgme_page"><div class="tgme_page_description">If you have <strong>Telegram</strong>, you can contact <a>@channel</a> right away.</div></div>'
    expect(detectChannelAccess(html)).toBe('private')
  })

  it('does not treat a bare tgme_page without channel metadata as public', () => {
    const html = '<div class="tgme_page"><div class="tgme_page_icon"><i class="tgme_icon_user"></i></div></div>'
    expect(detectChannelAccess(html)).toBe('private')
  })

  it('detects an unavailable channel', () => {
    const html = '<div class="tgme_page"><p>Sorry, this page isn\'t available.</p></div>'
    expect(detectChannelAccess(html)).toBe('unavailable')
  })
})
