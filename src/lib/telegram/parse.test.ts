import { load } from 'cheerio'
import { describe, expect, it } from 'vitest'
import { extractPost } from './parse'

function loadPost(html: string) {
  const $ = load(`
  <div class="tgme_widget_message_wrap">
    <div class="tgme_widget_message" data-post="ExampleChannel/42">
      ${html}
      <a class="tgme_widget_message_date"><time datetime="2026-07-14T08:30:00+00:00"></time></a>
    </div>
  </div>
`)
  return $
}

describe('extractPost', () => {
  it('extracts stable Telegram post fields and rewrites mid-sentence tag links', async () => {
    const $ = loadPost('<div class="tgme_widget_message_text js-message_text">Release notes。Details for <a href="?q=%23release">#release</a> and <a href="?q=%23astro">#astro</a></div>')
    const item = $('.tgme_widget_message_wrap').get(0) ?? null

    const post = await extractPost($, item, {
      channel: 'ExampleChannel',
      telegramHost: 'telegram.me',
      staticProxy: '/static/',
      reactionsEnabled: false,
    })

    expect(post.id).toBe('42')
    expect(post.title).toBe('Release notes')
    expect(post.datetime).toBe('2026-07-14T08:30:00+00:00')
    expect(post.tags).toEqual(['release', 'astro'])
    expect(post.text).toBe('Release notes。Details for #release and #astro')
    expect(post.content).toBe('Release notes。Details for <a href="/search/result?q=%23release" title="#release">#release</a> and <a href="/search/result?q=%23astro" title="#astro">#astro</a>')
    expect(post.reactions).toEqual([])
  })

  it('strips leading classification tags from body while keeping post.tags', async () => {
    const $ = loadPost('<div class="tgme_widget_message_text js-message_text"><a href="?q=%23DAILY">#DAILY</a> <br />CF wallet note</div>')
    const item = $('.tgme_widget_message_wrap').get(0) ?? null

    const post = await extractPost($, item, {
      channel: 'ExampleChannel',
      telegramHost: 'telegram.me',
      staticProxy: '/static/',
      reactionsEnabled: false,
    })

    expect(post.tags).toEqual(['DAILY'])
    expect(post.title).toBe('CF wallet note')
    expect(post.text).toBe('CF wallet note')
    expect(post.content).toBe('CF wallet note')
  })

  it('strips trailing detached tag clusters after a line break', async () => {
    const $ = loadPost('<div class="tgme_widget_message_text js-message_text">Ship notes<br/><a href="?q=%23release">#release</a> <a href="?q=%23astro">#astro</a></div>')
    const item = $('.tgme_widget_message_wrap').get(0) ?? null

    const post = await extractPost($, item, {
      channel: 'ExampleChannel',
      telegramHost: 'telegram.me',
      staticProxy: '/static/',
      reactionsEnabled: false,
    })

    expect(post.tags).toEqual(['release', 'astro'])
    expect(post.text).toBe('Ship notes')
    expect(post.content).toBe('Ship notes')
  })

  it('keeps same-line trailing hashtags that are part of prose', async () => {
    const $ = loadPost('<div class="tgme_widget_message_text js-message_text">Built with <a href="?q=%23astro">#astro</a></div>')
    const item = $('.tgme_widget_message_wrap').get(0) ?? null

    const post = await extractPost($, item, {
      channel: 'ExampleChannel',
      telegramHost: 'telegram.me',
      staticProxy: '/static/',
      reactionsEnabled: false,
    })

    expect(post.tags).toEqual(['astro'])
    expect(post.content).toBe('Built with <a href="/search/result?q=%23astro" title="#astro">#astro</a>')
  })

  it('strips nested pure-tag media captions without duplicating tags or title', async () => {
    const $ = loadPost(`
      <div class="tgme_widget_message_text js-message_text">
        <div class="tgme_widget_message_text js-message_text">
          <a href="?q=%23SNAP">#SNAP</a>
        </div>
      </div>
    `)
    const item = $('.tgme_widget_message_wrap').get(0) ?? null

    const post = await extractPost($, item, {
      channel: 'ExampleChannel',
      telegramHost: 'telegram.me',
      staticProxy: '/static/',
      reactionsEnabled: false,
    })

    expect(post.tags).toEqual(['SNAP'])
    expect(post.title).toBe('')
    expect(post.text).toBe('')
    expect(post.content).not.toContain('#SNAP')
    expect(post.content).not.toContain('/search/result?q=%23SNAP')
  })

  it('strips flat pure-tag captions while keeping post.tags', async () => {
    const $ = loadPost('<div class="tgme_widget_message_text js-message_text"><a href="?q=%23MEME">#MEME</a></div>')
    const item = $('.tgme_widget_message_wrap').get(0) ?? null

    const post = await extractPost($, item, {
      channel: 'ExampleChannel',
      telegramHost: 'telegram.me',
      staticProxy: '/static/',
      reactionsEnabled: false,
    })

    expect(post.tags).toEqual(['MEME'])
    expect(post.title).toBe('')
    expect(post.text).toBe('')
    expect(post.content).not.toContain('#MEME')
    expect(post.content).not.toContain('/search/result?q=%23MEME')
  })
})
