import type { BotMessage, BotUpdate } from './bot'
import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  buildBotFileUrl,
  createBotFileResponse,
  extractBotMedia,
  filterChannelMessages,
  getBotFileUrl,
  isValidBotFileId,
  isValidBotFilePath,
} from './bot'
import { renderBotAlbum, renderBotPost } from './bot-render'

function createMessage(overrides: Partial<BotMessage> = {}): BotMessage {
  return {
    message_id: 42,
    date: 1_700_000_000,
    chat: {
      id: -100123456,
      type: 'channel',
      username: 'my_channel',
    },
    text: 'Hello',
    ...overrides,
  }
}

function createUpdate(message: BotMessage): BotUpdate {
  return {
    update_id: 1,
    channel_post: message,
  }
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('bot channel filtering', () => {
  it('matches public channels by username', () => {
    const updates = [
      createUpdate(createMessage()),
      createUpdate(createMessage({ message_id: 43, chat: { id: -999, type: 'channel', username: 'other' } })),
    ]

    const { messages, chat } = filterChannelMessages(updates, 'my_channel', '')

    expect(messages.map(message => message.message_id)).toEqual([42])
    expect(chat?.username).toBe('my_channel')
  })

  it('matches private channels by configured chat id', () => {
    const updates = [
      createUpdate(createMessage({ chat: { id: -100123456, type: 'channel' } })),
    ]

    const { messages } = filterChannelMessages(updates, 'private_channel', '-100123456')

    expect(messages).toHaveLength(1)
  })

  it('infers the single private channel when no chat id is configured', () => {
    const updates = [
      createUpdate(createMessage({ message_id: 1, chat: { id: -100123456, type: 'channel' } })),
      createUpdate(createMessage({ message_id: 2, chat: { id: -100123456, type: 'channel' } })),
    ]

    const { messages } = filterChannelMessages(updates, 'private_channel', '')

    expect(messages.map(message => message.message_id)).toEqual([1, 2])
  })

  it('keeps only posts from the matched channel when the bot manages multiple channels', () => {
    const updates = [
      createUpdate(createMessage({ message_id: 1, chat: { id: -100123456, type: 'channel' } })),
      createUpdate(createMessage({ message_id: 2, chat: { id: -100789, type: 'channel', username: 'other' } })),
    ]

    const { messages } = filterChannelMessages(updates, 'my_channel', '-100123456')

    expect(messages.map(message => message.message_id)).toEqual([1])
  })

  it('prefers the edited version of a channel post', () => {
    const updates: BotUpdate[] = [
      createUpdate(createMessage({ text: 'Before' })),
      {
        update_id: 2,
        edited_channel_post: createMessage({ text: 'After' }),
      },
    ]

    const { messages } = filterChannelMessages(updates, 'my_channel', '-100123456')

    expect(messages).toHaveLength(1)
    expect(messages[0]?.text).toBe('After')
  })

  it('collects an edited post even when the bot never saw the original', () => {
    const updates: BotUpdate[] = [{
      update_id: 1,
      edited_channel_post: createMessage({ message_id: 99, text: 'Edited old post' }),
    }]

    const { messages } = filterChannelMessages(updates, 'private_channel', '-100123456')

    expect(messages.map(message => message.message_id)).toEqual([99])
    expect(messages[0]?.text).toBe('Edited old post')
  })
})

describe('bot media extraction', () => {
  it('picks the largest photo size', () => {
    const message = createMessage({
      photo: [
        { file_id: 'small', file_unique_id: 's', width: 100, height: 100 },
        { file_id: 'large', file_unique_id: 'l', width: 800, height: 1200 },
      ],
    })

    expect(extractBotMedia(message)).toMatchObject({
      kind: 'photo',
      fileId: 'large',
      width: 800,
      height: 1200,
    })
  })

  it('extracts video, audio, and voice media', () => {
    expect(extractBotMedia(createMessage({ video: { file_id: 'v', width: 640, height: 360 } }))).toMatchObject({
      kind: 'video',
      fileId: 'v',
    })
    expect(extractBotMedia(createMessage({ audio: { file_id: 'a' } }))).toMatchObject({
      kind: 'audio',
      fileId: 'a',
    })
    expect(extractBotMedia(createMessage({ voice: { file_id: 'w' } }))).toMatchObject({
      kind: 'voice',
      fileId: 'w',
    })
  })

  it('treats image documents as photos', () => {
    const message = createMessage({
      document: {
        file_id: 'doc',
        file_name: 'photo.jpg',
        mime_type: 'image/jpeg',
      },
    })

    expect(extractBotMedia(message)).toMatchObject({
      kind: 'photo',
      fileId: 'doc',
    })
  })

  it('returns null without media', () => {
    expect(extractBotMedia(createMessage())).toBeNull()
  })
})

describe('bot post rendering', () => {
  it('links hashtags and collects tags', async () => {
    const message = createMessage({
      text: 'Read #news now',
      entities: [{ type: 'hashtag', offset: 5, length: 5 }],
    })

    const post = await renderBotPost(message)

    expect(post.id).toBe('42')
    expect(post.tags).toEqual(['news'])
    expect(post.content).toContain('href="/search/result?q=%23news"')
    expect(post.text).toBe('Read #news now')
  })

  it('strips detached leading hashtags from content but keeps them as tags', async () => {
    const message = createMessage({
      text: '#news\nHello',
      entities: [{ type: 'hashtag', offset: 0, length: 5 }],
    })

    const post = await renderBotPost(message)

    expect(post.tags).toEqual(['news'])
    expect(post.text).toBe('Hello')
    expect(post.content).not.toContain('#news')
  })

  it('strips detached trailing hashtags from content but keeps them as tags', async () => {
    const message = createMessage({
      text: 'Hello\n#news',
      entities: [{ type: 'hashtag', offset: 6, length: 5 }],
    })

    const post = await renderBotPost(message)

    expect(post.tags).toEqual(['news'])
    expect(post.text).toBe('Hello')
    expect(post.content).not.toContain('#news')
  })

  it('renders nested and same-range entities once', async () => {
    const message = createMessage({
      text: 'Link text',
      entities: [
        { type: 'bold', offset: 0, length: 9 },
        { type: 'text_link', offset: 0, length: 9, url: 'https://example.com' },
      ],
    })

    const post = await renderBotPost(message)

    expect(post.content).toContain('href="https://example.com/"')
    expect(post.content.match(/<b>Link text<\/b>/g)).toHaveLength(1)
  })

  it('escapes raw HTML in message text', async () => {
    const message = createMessage({ text: '<script>alert(1)</script>' })
    const post = await renderBotPost(message)

    expect(post.content).not.toContain('<script>')
    expect(post.content).toContain('&lt;script&gt;')
  })

  it('renders photos with full-resolution bot file urls', async () => {
    const message = createMessage({
      photo: [
        { file_id: 'small', file_unique_id: 's', width: 100, height: 100 },
        { file_id: 'full', file_unique_id: 'f', width: 1080, height: 1920 },
      ],
    })

    const post = await renderBotPost(message)

    expect(post.content).toContain('image-list-container')
    expect(post.content).toContain('/api/bot-file?file_id=full')
    expect(post.content).toContain('width="1080"')
    expect(post.content).toContain('height="1920"')
  })

  it('renders video and audio controls', async () => {
    const videoPost = await renderBotPost(createMessage({
      video: { file_id: 'vid', width: 640, height: 360 },
    }))
    expect(videoPost.content).toContain('<video')
    expect(videoPost.content).toContain('/api/bot-file?file_id=vid')

    const audioPost = await renderBotPost(createMessage({ audio: { file_id: 'aud' } }))
    expect(audioPost.content).toContain('<audio')
  })

  it('renders an album as one post with every photo', async () => {
    const album = [
      createMessage({
        message_id: 50,
        media_group_id: 'group-1',
        photo: [{ file_id: 'first', file_unique_id: 'f', width: 800, height: 600 }],
      }),
      createMessage({
        message_id: 51,
        media_group_id: 'group-1',
        photo: [{ file_id: 'second', file_unique_id: 's', width: 800, height: 600 }],
        caption: '#SNAP\nTwo photos',
        caption_entities: [{ type: 'hashtag', offset: 0, length: 5 }],
      }),
    ]

    const post = await renderBotAlbum(album)

    expect(post.id).toBe('50')
    expect(post.tags).toEqual(['SNAP'])
    expect(post.text).toBe('Two photos')
    expect(post.content).toContain('/api/bot-file?file_id=first')
    expect(post.content).toContain('/api/bot-file?file_id=second')
    expect(post.content).not.toContain('#SNAP')
  })

  it('renders an open graph link preview when the message has one', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response(
      '<html><head><meta property="og:title" content="Repo"><meta property="og:description" content="A repo"><meta property="og:image" content="https://example.com/og.png"></head></html>',
      { status: 200, headers: { 'content-type': 'text/html' } },
    )))

    const message = createMessage({
      text: 'https://example.com/repo',
      link_preview_options: { url: 'https://example.com/repo' },
    })

    const post = await renderBotPost(message)

    expect(post.content).toContain('tgme_widget_message_link_preview')
    expect(post.content).toContain('link_preview_title')
    expect(post.content).toContain('Repo')
    expect(post.content).toContain('https://example.com/og.png')
  })
})

describe('bot file proxy', () => {
  it('builds same-origin proxy urls', () => {
    expect(getBotFileUrl('abc-123')).toBe('/api/bot-file?file_id=abc-123')
    expect(buildBotFileUrl({ TELEGRAM_BOT_TOKEN: 't', TELEGRAM_BOT_API_BASE: 'https://api.example.test/' }, 'dir/file.jpg'))
      .toBe('https://api.example.test/file/bott/dir/file.jpg')
  })

  it('rejects unsafe file ids and paths', () => {
    expect(isValidBotFileId('abc-123:def')).toBe(true)
    expect(isValidBotFileId('<script>')).toBe(false)
    expect(isValidBotFilePath('documents/file_1.jpg')).toBe(true)
    expect(isValidBotFilePath('/etc/passwd')).toBe(false)
  })

  it('returns 404 for invalid file ids without contacting Telegram', async () => {
    const request = new Request('https://example.test/api/bot-file?file_id=bad%20id')
    const response = await createBotFileResponse(request, 'bad id', {})

    expect(response.status).toBe(404)
  })
})
