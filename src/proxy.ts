import { Hono } from 'hono'
import type { Env, Channel } from './types'
import {
  getConfig, getEnabledModels, getFreeModels, pickModel, selectChannel,
  setCooldown, cleanCooldowns,
} from './routing'

const proxy = new Hono<{ Bindings: Env }>()

interface TokenInfo {
  name: string
  models: string
  strategy: string
  pinned_model: string
  channels: string
}

async function authenticateToken(db: D1Database, authHeader: string): Promise<TokenInfo | null> {
  if (!authHeader.startsWith('Bearer ')) return null
  const raw = authHeader.slice(7).trim()
  if (!raw) return null
  const sql = "SELECT name, models, COALESCE(strategy,'smart') as strategy, COALESCE(pinned_model,'') as pinned_model, COALESCE(channels,'') as channels FROM tokens WHERE key = ? AND status = 1"
  const row = await db.prepare(sql).bind(raw).first<TokenInfo>()
  if (row) return row
  const stripped = raw.startsWith('sk-') ? raw.slice(3) : null
  if (stripped) {
    return await db.prepare(sql).bind(stripped).first<TokenInfo>()
  }
  return null
}

function pickKey(apiKey: string): string {
  const keys = apiKey.split('\n').map(k => k.trim()).filter(Boolean)
  if (keys.length <= 1) return apiKey.trim()
  return keys[Math.floor(Math.random() * keys.length)]
}

const STRIP_HEADERS = new Set([
  'content-encoding', 'content-length', 'transfer-encoding', 'connection',
])

async function forwardToChannel(
  request: Request,
  channel: Channel,
  path: string,
  body: ArrayBuffer | null,
  model: string | null,
): Promise<Response> {
  const baseUrl = channel.base_url.replace(/\/+$/, '')
  const versionRe = /\/v\d+$/
  const forwardPath = versionRe.test(baseUrl) ? path.replace(/^\/v1/, '') : path
  const url = baseUrl + forwardPath
  const key = pickKey(channel.api_key)

  const headers = new Headers()
  for (const [k, v] of request.headers.entries()) {
    const lower = k.toLowerCase()
    if (lower !== 'host' && lower !== 'authorization') headers.set(k, v)
  }
  headers.set('Authorization', `Bearer ${key}`)

  let forwardBody: ArrayBuffer | string | null = body
  if (body && model) {
    try {
      const data = JSON.parse(new TextDecoder().decode(body))
      data.model = model
      forwardBody = JSON.stringify(data)
      headers.set('Content-Type', 'application/json')
    } catch { /* keep original body */ }
  }

  const resp = await fetch(url, { method: request.method, headers, body: forwardBody })
  const respHeaders = new Headers()
  for (const [k, v] of resp.headers.entries()) {
    if (!STRIP_HEADERS.has(k.toLowerCase())) respHeaders.set(k, v)
  }
  return new Response(resp.body, { status: resp.status, headers: respHeaders })
}

async function logRequest(
  db: D1Database, tokenName: string, path: string, modelAsked: string,
  modelUsed: string, channelId: number | null, channelName: string,
  statusCode: number, latencyMs: number, error: string,
): Promise<void> {
  try {
    await db.prepare(
      `INSERT INTO request_log (token_name, path, model_asked, model_used, channel_id, channel_name, status_code, latency_ms, error)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`
    ).bind(tokenName, path, modelAsked, modelUsed, channelId, channelName, statusCode, latencyMs, error).run()
  } catch { /* logging should never break the request */ }
}

// ─── /v1/models ───

proxy.get('/v1/models', async (c) => {
  const db = c.env.DB
  const token = await authenticateToken(db, c.req.header('Authorization') || '')
  if (!token) return c.json({ error: { message: '未提供令牌或令牌无效', type: 'auth_error' } }, 401)
  const models = await getEnabledModels(db)
  const data: { id: string; object: string; created: number; owned_by: string }[] =
    models.map(m => ({ id: m, object: 'model', created: 0, owned_by: 'api-router' }))
  const prefixed = await db.prepare(
    `SELECT DISTINCT c.prefix || ':' || a.model as pm
     FROM abilities a JOIN channels c ON a.channel_id = c.id
     WHERE c.prefix != '' AND c.prefix IS NOT NULL AND a.enabled = 1`
  ).all<{ pm: string }>()
  for (const p of prefixed.results) {
    data.push({ id: p.pm, object: 'model', created: 0, owned_by: 'api-router' })
  }
  return c.json({ object: 'list', data })
})

// ─── /v1/* proxy ───

proxy.all('/v1/*', async (c) => {
  const started = Date.now()
  const db = c.env.DB
  let path = new URL(c.req.url).pathname

  if ((path === '/v1' || path === '/v1/') && c.req.method === 'POST') path = '/v1/chat/completions'

  const token = await authenticateToken(db, c.req.header('Authorization') || '')
  if (!token) return c.json({ error: { message: '未提供令牌或令牌无效', type: 'auth_error' } }, 401)

  const chFilter = token.channels ? token.channels.split(',').map(c => c.trim()).filter(Boolean) : undefined

  const body = await c.req.arrayBuffer()
  let bodyData: any = null
  try {
    if (body.byteLength > 0) bodyData = JSON.parse(new TextDecoder().decode(body))
  } catch { /* not JSON */ }

  const clientModel = (bodyData?.model || '').toString().trim()
  const isAuto = !clientModel || clientModel.toLowerCase() === 'auto'

  let targetModel = clientModel
  let category: string | null = null

  if (isAuto) {
    if (token.pinned_model) {
      targetModel = token.pinned_model
    } else {
      const config = await getConfig(db)
      const enabledModels = await getEnabledModels(db, chFilter)
      const freeModels = await getFreeModels(db, chFilter)
      const strategy = token.strategy || 'smart'
      const pick = pickModel(path, bodyData, enabledModels, config, strategy, freeModels)
      targetModel = pick.model || ''
      category = pick.category
    }
    if (!targetModel) return c.json({ error: { message: '没有可用的模型', type: 'routing_error' } }, 503)
  }

  // Resolve channel prefix: "prefix:actual_model" → force specific channel
  let forcedChannel: Channel | null = null
  if (targetModel.includes(':')) {
    const idx = targetModel.indexOf(':')
    const prefix = targetModel.slice(0, idx)
    const actualModel = targetModel.slice(idx + 1)
    if (prefix && actualModel) {
      const ch = await db.prepare(
        "SELECT * FROM channels WHERE prefix = ? LIMIT 1"
      ).bind(prefix).first<Channel>()
      if (ch) {
        forcedChannel = ch
        targetModel = actualModel
      }
    }
  }

  if (token.models) {
    const allowed = token.models.split(',').map(m => m.trim()).filter(Boolean)
    if (allowed.length > 0 && !allowed.includes(targetModel)) {
      return c.json({ error: { message: `令牌不允许访问模型 ${targetModel}`, type: 'auth_error' } }, 403)
    }
  }

  const channel = forcedChannel || await selectChannel(db, targetModel, chFilter)
  if (!channel) {
    return c.json({ error: { message: `没有渠道提供模型 ${targetModel}`, type: 'routing_error' } }, 503)
  }

  const injectModel = (isAuto || forcedChannel) ? targetModel : null
  const resp = await forwardToChannel(c.req.raw, channel, path, body, injectModel)

  if (resp.status === 429) {
    c.executionCtx.waitUntil(setCooldown(db, channel.id, targetModel, 60))
    const retryChannel = forcedChannel ? null : await selectChannel(db, targetModel, chFilter)
    if (retryChannel && retryChannel.id !== channel.id) {
      const retryResp = await forwardToChannel(c.req.raw, retryChannel, path, body, injectModel)
      const latency = Date.now() - started
      c.executionCtx.waitUntil(
        logRequest(db, token.name, path, clientModel, targetModel, retryChannel.id, retryChannel.name, retryResp.status, latency, retryResp.status >= 400 ? `retry after 429 from ${channel.name}` : '')
      )
      return retryResp
    }
  }

  const latency = Date.now() - started
  let errorText = ''
  if (resp.status >= 400 && resp.status !== 429) {
    try { errorText = (await resp.clone().text()).slice(0, 500) } catch { /* ignore */ }
  }
  c.executionCtx.waitUntil(logRequest(db, token.name, path, clientModel, targetModel, channel.id, channel.name, resp.status, latency, errorText))
  c.executionCtx.waitUntil(cleanCooldowns(db))
  return resp
})

export { proxy }
