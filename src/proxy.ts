import { Hono } from 'hono'
import type { Env, Channel } from './types'
import {
  getConfig, getEnabledModels, getFreeModels, pickModelCandidates, selectAllChannels,
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
  const entry = (id: string) => ({ id, object: 'model' as const, created: 0, owned_by: 'api-router' })
  const data = models.map(m => entry(m))
  data.unshift(entry('auto'))
  const prefixed = await db.prepare(
    `SELECT DISTINCT c.prefix || ':' || a.model as pm, c.prefix
     FROM abilities a JOIN channels c ON a.channel_id = c.id
     WHERE c.prefix != '' AND c.prefix IS NOT NULL AND a.enabled = 1 AND c.status = 1`
  ).all<{ pm: string; prefix: string }>()
  const prefixes = new Set<string>()
  for (const p of prefixed.results) {
    data.push(entry(p.pm))
    prefixes.add(p.prefix)
  }
  for (const px of prefixes) {
    data.push(entry(px + ':auto'))
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
  let isAuto = !clientModel || clientModel.toLowerCase() === 'auto'

  let baseModel = clientModel
  let forcedChannel: Channel | null = null

  // Handle "prefix:model" — parse before auto-routing so "prefix:auto" works
  if (!isAuto && baseModel.includes(':')) {
    const idx = baseModel.indexOf(':')
    const prefix = baseModel.slice(0, idx)
    const actualModel = baseModel.slice(idx + 1)
    if (prefix && actualModel) {
      const ch = await db.prepare(
        "SELECT * FROM channels WHERE prefix = ? LIMIT 1"
      ).bind(prefix).first<Channel>()
      if (ch) {
        forcedChannel = ch
        baseModel = actualModel
        if (actualModel.toLowerCase() === 'auto') isAuto = true
      }
    }
  }

  // Build ordered candidate model list
  let candidateModels: string[] = []
  const effectiveFilter = forcedChannel ? [forcedChannel.prefix] : chFilter
  if (isAuto) {
    if (token.pinned_model && !forcedChannel) {
      candidateModels = [token.pinned_model]
    } else {
      const config = await getConfig(db)
      const enabledModels = await getEnabledModels(db, effectiveFilter)
      const freeModels = await getFreeModels(db, effectiveFilter)
      const strategy = token.strategy || 'smart'
      candidateModels = pickModelCandidates(path, bodyData, enabledModels, config, strategy, freeModels).models
    }
  } else {
    candidateModels = [baseModel]
  }

  // Token model whitelist
  if (token.models) {
    const allowed = token.models.split(',').map(m => m.trim()).filter(Boolean)
    if (allowed.length > 0) {
      candidateModels = candidateModels.filter(m => allowed.includes(m))
      if (candidateModels.length === 0) {
        return c.json({ error: { message: '令牌不允许访问请求的模型', type: 'auth_error' } }, 403)
      }
    }
  }
  if (candidateModels.length === 0) {
    return c.json({ error: { message: '没有可用的模型', type: 'routing_error' } }, 503)
  }

  // Build failover chain: up to 2 channels per model, capped total
  const MAX_ATTEMPTS = 4
  const attempts: { model: string; channel: Channel }[] = []
  for (const m of candidateModels) {
    const channels = forcedChannel ? [forcedChannel] : await selectAllChannels(db, m, chFilter)
    let perModel = 0
    for (const ch of channels) {
      attempts.push({ model: m, channel: ch })
      if (++perModel >= 2 || attempts.length >= MAX_ATTEMPTS) break
    }
    if (attempts.length >= MAX_ATTEMPTS) break
  }
  if (attempts.length === 0) {
    return c.json({ error: { message: `没有渠道提供请求的模型`, type: 'routing_error' } }, 503)
  }

  // Try each candidate until success or non-retryable error or exhausted
  const RETRYABLE = new Set([402, 403, 408, 409, 429, 500, 502, 503, 504])
  for (let i = 0; i < attempts.length; i++) {
    const { model, channel } = attempts[i]
    const injectModel = model !== clientModel ? model : null
    const resp = await forwardToChannel(c.req.raw, channel, path, body, injectModel)
    const isLast = i === attempts.length - 1
    const retryable = RETRYABLE.has(resp.status)

    if (resp.status < 400 || !retryable || isLast) {
      const latency = Date.now() - started
      let errorText = ''
      if (resp.status >= 400) {
        try { errorText = (await resp.clone().text()).slice(0, 500) } catch { /* ignore */ }
      }
      const note = i > 0 ? `failover#${i + 1} ` : ''
      c.executionCtx.waitUntil(logRequest(db, token.name, path, clientModel, model, channel.id, channel.name, resp.status, latency, (note + errorText).trim()))
      c.executionCtx.waitUntil(cleanCooldowns(db))
      return resp
    }

    // Retryable failure → cooldown this channel/model, log, move to next
    const cd = resp.status === 429 ? 60 : (resp.status === 403 || resp.status === 402) ? 300 : 30
    c.executionCtx.waitUntil(setCooldown(db, channel.id, model, cd))
    let errText = ''
    try { errText = (await resp.clone().text()).slice(0, 200) } catch { /* ignore */ }
    c.executionCtx.waitUntil(logRequest(db, token.name, path, clientModel, model, channel.id, channel.name, resp.status, Date.now() - started, `try#${i + 1}切换: ${errText}`))
  }

  return c.json({ error: { message: '所有候选渠道均失败', type: 'routing_error' } }, 503)
})

export { proxy }
