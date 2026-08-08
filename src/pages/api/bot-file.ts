import type { APIRoute } from 'astro'
import { createBotFileResponse } from '../../lib/telegram/bot'

export const GET: APIRoute = async ({ request, url }) => {
  const fileId = url.searchParams.get('file_id') ?? ''
  return createBotFileResponse(request, fileId, import.meta.env)
}
