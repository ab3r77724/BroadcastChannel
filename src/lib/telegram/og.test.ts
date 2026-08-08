import { afterEach, describe, expect, it, vi } from 'vitest'
import { getOpenGraphPreview } from './og'

function htmlResponse(body: string, url = 'https://example.com/article', contentType = 'text/html; charset=utf-8'): Response {
  const response = new Response(body, {
    status: 200,
    headers: { 'content-type': contentType },
  })
  Object.defineProperty(response, 'url', { value: url, configurable: true })
  return response
}

afterEach(() => {
  vi.unstubAllGlobals()
})

describe('open graph preview', () => {
  it('extracts og metadata and resolves relative image urls', async () => {
    const fetchMock = vi.fn(async () => htmlResponse(`
      <html><head>
        <title>Fallback title</title>
        <meta property="og:title" content="Example Article">
        <meta property="og:description" content="A short description">
        <meta property="og:image" content="/cover.jpg">
        <meta property="og:url" content="https://example.com/article">
      </head></html>
    `))
    vi.stubGlobal('fetch', fetchMock)

    const preview = await getOpenGraphPreview('https://example.com/article')

    expect(preview).toEqual({
      url: 'https://example.com/article',
      title: 'Example Article',
      description: 'A short description',
      image: 'https://example.com/cover.jpg',
    })
  })

  it('falls back to the page title and rejects non-http urls without fetching', async () => {
    const fetchMock = vi.fn()
    vi.stubGlobal('fetch', fetchMock)

    const preview = await getOpenGraphPreview('file:///etc/passwd')

    expect(preview).toBeNull()
    expect(fetchMock).not.toHaveBeenCalled()
  })

  it('rejects non-html responses and http errors', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => new Response('PNG', {
      status: 200,
      headers: { 'content-type': 'image/png' },
    })))

    expect(await getOpenGraphPreview('https://example.com/a')).toBeNull()

    vi.stubGlobal('fetch', vi.fn(async () => new Response('nope', { status: 404 })))
    expect(await getOpenGraphPreview('https://example.com/b')).toBeNull()
  })

  it('rejects oversized html bodies', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => htmlResponse(`<html><head><title>${'x'.repeat(1024 * 1024 + 1)}</title></head></html>`)))

    expect(await getOpenGraphPreview('https://example.com/big')).toBeNull()
  })
})
