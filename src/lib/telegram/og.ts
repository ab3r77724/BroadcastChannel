import * as cheerio from 'cheerio'
import { defineCachedFunction } from 'ocache'

export interface OpenGraphPreview {
  url: string
  title: string
  description?: string
  image?: string
}

const FETCH_TIMEOUT_MS = 6_000
const MAX_RESPONSE_BYTES = 1024 * 1024
const HTML_CONTENT_TYPE = /^text\/html(?:;|$)/i
const SAFE_UA = 'Mozilla/5.0 (compatible; BroadcastChannel/0.2.0)'

function isHttpUrl(raw: string): boolean {
  try {
    const url = new URL(raw)
    return url.protocol === 'http:' || url.protocol === 'https:'
  }
  catch {
    return false
  }
}

function absoluteUrl(value: string, base: string): string {
  if (!value) {
    return ''
  }

  try {
    return new URL(value, base).toString()
  }
  catch {
    return ''
  }
}

interface FetchedPage {
  html: string
  url: string
}

async function fetchOpenGraphPage(rawUrl: string): Promise<FetchedPage | null> {
  if (!isHttpUrl(rawUrl)) {
    return null
  }

  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS)

  try {
    const response = await fetch(rawUrl, {
      redirect: 'follow',
      signal: controller.signal,
      headers: {
        'accept': 'text/html,application/xhtml+xml',
        'user-agent': SAFE_UA,
      },
    })
    const contentType = response.headers.get('content-type') ?? ''
    if (!response.ok || !HTML_CONTENT_TYPE.test(contentType)) {
      return null
    }

    const html = await response.text()
    if (html.length > MAX_RESPONSE_BYTES) {
      return null
    }

    return { html, url: response.url || rawUrl }
  }
  catch {
    return null
  }
  finally {
    clearTimeout(timeout)
  }
}

function readMeta($: cheerio.CheerioAPI, key: string): string {
  return $(`meta[property="${key}"], meta[name="${key}"]`).first().attr('content')?.trim() ?? ''
}

async function loadOpenGraphPreview(rawUrl: string): Promise<OpenGraphPreview | null> {
  const page = await fetchOpenGraphPage(rawUrl)
  if (!page) {
    return null
  }

  const $ = cheerio.load(page.html, {}, false)
  const title = readMeta($, 'og:title') || readMeta($, 'twitter:title') || $('title').first().text().trim()
  const description = readMeta($, 'og:description') || readMeta($, 'twitter:description') || readMeta($, 'description')
  const image = absoluteUrl(readMeta($, 'og:image') || readMeta($, 'twitter:image'), page.url)
  const canonical = absoluteUrl(readMeta($, 'og:url') || page.url, page.url)

  if (!title && !description && !image) {
    return null
  }

  return {
    url: canonical || rawUrl,
    title: title || rawUrl,
    description: description || undefined,
    image: image || undefined,
  }
}

export const getOpenGraphPreview = defineCachedFunction(loadOpenGraphPreview, {
  name: 'telegram-og-preview',
  maxAge: 60 * 60,
  swr: false,
  getKey: (rawUrl: string) => rawUrl,
})
