import { Hono } from 'hono'
import type { Env, Channel } from './types'
import {
  syncAbilities, getConfig, saveConfig, DEFAULT_CONFIG,
  getEnabledModels, getFreeModels, getCategoryOverview,
  STRATEGY_LABELS, CATEGORY_LABELS,
} from './routing'
import { adminPage, loginPage } from './ui'

const admin = new Hono<{ Bindings: Env }>()

async function generateSession(): Promise<string> {
  const buf = new Uint8Array(32)
  crypto.getRandomValues(buf)
  return Array.from(buf).map(b => b.toString(16).padStart(2, '0')).join('')
}

async function storeSession(db: D1Database, token: string): Promise<void> {
  const expires = Math.floor(Date.now() / 1000) + 86400 * 7
  await db.prepare(
    "INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind('session:' + token, String(expires)).run()
}

async function validateSession(db: D1Database, token: string): Promise<boolean> {
  if (!token) return false
  const row = await db.prepare(
    "SELECT value FROM config WHERE key = ?1"
  ).bind('session:' + token).first<{ value: string }>()
  if (!row) return false
  const expires = Number(row.value)
  return expires > Math.floor(Date.now() / 1000)
}

function getSessionFromCookie(c: any): string {
  const cookie = c.req.header('Cookie') || ''
  const match = cookie.match(/session=([a-f0-9]{64})/)
  return match ? match[1] : ''
}

function checkAuth(c: any): boolean | Promise<boolean> {
  const auth = c.req.header('Authorization') || ''
  if (auth === `Bearer ${c.env.AUTH_KEY}`) return true
  if (auth.startsWith('Basic ')) {
    try {
      const decoded = atob(auth.slice(6))
      const [, pass] = decoded.split(':')
      if (pass === c.env.AUTH_KEY) return true
    } catch { /* invalid base64 */ }
  }
  const sessionToken = c.req.header('X-Session') || getSessionFromCookie(c)
  if (sessionToken) return validateSession(c.env.DB, sessionToken)
  return false
}

// ─── Login ───

admin.post('/api/login', async (c) => {
  const body = await c.req.json<{ password: string }>()
  if (body.password !== c.env.LOGIN_PASS) {
    return c.json({ success: false, error: '密码错误' }, 401)
  }
  const session = await generateSession()
  await storeSession(c.env.DB, session)
  return c.json({ success: true }, 200, {
    'Set-Cookie': `session=${session}; Path=/admin; HttpOnly; SameSite=Strict; Secure; Max-Age=${86400 * 7}`,
  })
})

admin.post('/api/logout', async (c) => {
  const session = getSessionFromCookie(c)
  if (session) {
    await c.env.DB.prepare("DELETE FROM config WHERE key = ?1").bind('session:' + session).run()
  }
  return c.json({ success: true }, 200, {
    'Set-Cookie': 'session=; Path=/admin; HttpOnly; SameSite=Strict; Secure; Max-Age=0',
  })
})

// ─── Auth middleware for API ───

admin.use('/api/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (path.endsWith('/api/login') || path.endsWith('/api/init')) {
    await next()
    return
  }
  const authed = await checkAuth(c)
  if (!authed) {
    return c.json({ error: 'Unauthorized' }, 401)
  }
  await next()
})

// ─── Admin page ───

async function serveAdmin(c: any) {
  const session = getSessionFromCookie(c)
  const valid = session ? await validateSession(c.env.DB, session) : false
  if (!valid) return c.html(loginPage())
  return c.html(adminPage())
}

admin.get('/', serveAdmin)
admin.get('/*', async (c, next) => {
  const path = new URL(c.req.url).pathname
  if (path === '/admin/' || path === '/admin') return serveAdmin(c)
  await next()
})

// ─── Prefix generation ───

async function generateUniquePrefix(db: D1Database, name: string, excludeId?: number): Promise<string> {
  const existing = await db.prepare('SELECT prefix FROM channels WHERE prefix != ""').all<{ prefix: string }>()
  const taken = new Set(existing.results.map(r => r.prefix))

  const ascii = name.replace(/[^a-zA-Z0-9]/g, '').toLowerCase()
  const candidates: string[] = []
  if (ascii.length >= 2) {
    candidates.push(ascii.slice(0, 2))
    candidates.push(ascii.slice(0, 3))
    candidates.push(ascii.slice(0, 4))
  }
  // try camelCase initials
  const words = name.match(/[A-Z][a-z]*|[a-z]+|[0-9]+/g)
  if (words && words.length >= 2) {
    candidates.unshift(words.map(w => w[0]).join('').toLowerCase().slice(0, 4))
  }
  for (const c of candidates) {
    if (!taken.has(c)) return c
  }
  // fallback: ascii + incrementing suffix
  const base = ascii.slice(0, 3) || 'ch'
  for (let i = 1; i < 100; i++) {
    const try_ = base + i
    if (!taken.has(try_)) return try_
  }
  return 'c' + Date.now().toString(36).slice(-4)
}

// ─── Channels ───

admin.get('/api/channels', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, name, COALESCE(prefix,'') as prefix, base_url, api_key, models, COALESCE(free_models,'') as free_models, COALESCE(balance_url,'') as balance_url, COALESCE(balance_field,'') as balance_field, COALESCE(balance_unit,'') as balance_unit, status, priority, created_at, updated_at FROM channels ORDER BY id"
  ).all<Channel>()
  return c.json({ success: true, data: rows.results })
})

admin.post('/api/channels', async (c) => {
  const body = await c.req.json<{ name: string; base_url: string; api_key: string; models: string; prefix?: string; free_models?: string; priority?: number }>()
  const prefix = body.prefix || await generateUniquePrefix(c.env.DB, body.name)
  const result = await c.env.DB.prepare(
    'INSERT INTO channels (name, prefix, base_url, api_key, models, free_models, priority) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(body.name, prefix, body.base_url, body.api_key, body.models || '', body.free_models || '', body.priority || 0).run()
  const channelId = result.meta.last_row_id
  if (body.models) await syncAbilities(c.env.DB, channelId, body.models)
  return c.json({ success: true, id: channelId, prefix })
})

admin.put('/api/channels/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<Partial<Channel>>()
  const sets: string[] = []
  const vals: any[] = []
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name) }
  if (body.prefix !== undefined) { sets.push('prefix = ?'); vals.push(body.prefix) }
  if (body.base_url !== undefined) { sets.push('base_url = ?'); vals.push(body.base_url) }
  if (body.api_key !== undefined) { sets.push('api_key = ?'); vals.push(body.api_key) }
  if (body.models !== undefined) { sets.push('models = ?'); vals.push(body.models) }
  if ((body as any).free_models !== undefined) { sets.push('free_models = ?'); vals.push((body as any).free_models) }
  if (body.balance_url !== undefined) { sets.push('balance_url = ?'); vals.push(body.balance_url) }
  if (body.balance_field !== undefined) { sets.push('balance_field = ?'); vals.push(body.balance_field) }
  if (body.balance_unit !== undefined) { sets.push('balance_unit = ?'); vals.push(body.balance_unit) }
  if (body.status !== undefined) { sets.push('status = ?'); vals.push(body.status) }
  if (body.priority !== undefined) { sets.push('priority = ?'); vals.push(body.priority) }
  sets.push('updated_at = unixepoch()')
  vals.push(id)
  await c.env.DB.prepare(`UPDATE channels SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
  if (body.models !== undefined) await syncAbilities(c.env.DB, id, body.models)
  return c.json({ success: true })
})

admin.delete('/api/channels/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM channels WHERE id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM abilities WHERE channel_id = ?').bind(id).run()
  await c.env.DB.prepare('DELETE FROM cooldowns WHERE channel_id = ?').bind(id).run()
  return c.json({ success: true })
})

admin.post('/api/channels/:id/test', async (c) => {
  const id = Number(c.req.param('id'))
  const ch = await c.env.DB.prepare('SELECT * FROM channels WHERE id = ?').bind(id).first<Channel>()
  if (!ch) return c.json({ success: false, error: '渠道不存在' }, 404)
  const key = ch.api_key.split('\n')[0].trim()
  try {
    const base = ch.base_url.replace(/\/+$/, '')
    const modelsPath = /\/v\d+$/.test(base) ? '/models' : '/v1/models'
    const resp = await fetch(base + modelsPath, {
      headers: { 'Authorization': `Bearer ${key}` },
    })
    const body = await resp.text()
    return c.json({ success: resp.ok, status: resp.status, body: body.slice(0, 2000) })
  } catch (e: any) {
    return c.json({ success: false, error: e.message })
  }
})

admin.post('/api/channels/:id/sync-models', async (c) => {
  const id = Number(c.req.param('id'))
  const ch = await c.env.DB.prepare('SELECT * FROM channels WHERE id = ?').bind(id).first<Channel>()
  if (!ch) return c.json({ success: false, error: '渠道不存在' }, 404)
  const key = ch.api_key.split('\n')[0].trim()
  try {
    const base = ch.base_url.replace(/\/+$/, '')
    const modelsPath = /\/v\d+$/.test(base) ? '/models' : '/v1/models'
    const resp = await fetch(base + modelsPath, {
      headers: { 'Authorization': `Bearer ${key}` },
    })
    if (!resp.ok) return c.json({ success: false, error: `上游返回 ${resp.status}` })
    const data = await resp.json<{ data?: Array<{ id: string }> }>()
    const models = (data.data || []).map(m => m.id).join(',')
    await c.env.DB.prepare('UPDATE channels SET models = ?, updated_at = unixepoch() WHERE id = ?').bind(models, id).run()
    await syncAbilities(c.env.DB, id, models)
    return c.json({ success: true, models_count: (data.data || []).length, models })
  } catch (e: any) {
    return c.json({ success: false, error: e.message })
  }
})

// ─── Balance ───

interface BalancePreset { url: string; field: string; unit: string; minus?: string }

const BALANCE_PRESETS: Record<string, BalancePreset> = {
  'deepseek': { url: '/user/balance', field: 'balance_infos.0.total_balance', unit: '元' },
  // 剩余余额 = 总额度 - 已用
  'openrouter': { url: '/api/v1/credits', field: 'data.total_credits', minus: 'data.total_usage', unit: '$' },
}

function detectPreset(baseUrl: string): BalancePreset | null {
  const lower = baseUrl.toLowerCase()
  for (const [key, preset] of Object.entries(BALANCE_PRESETS)) {
    if (lower.includes(key)) return preset
  }
  return null
}

function resolveField(obj: any, path: string): any {
  const parts = path.split('.')
  let cur = obj
  for (const p of parts) {
    if (cur == null) return null
    cur = /^\d+$/.test(p) ? cur[Number(p)] : cur[p]
  }
  return cur
}

// Resolve effective balance query config: manual overrides win, else preset.
function balanceConfig(ch: Channel): { url: string; field: string; unit: string; minus: string } | null {
  const preset = detectPreset(ch.base_url)
  const url = ch.balance_url || preset?.url || ''
  if (!url) return null
  const usePreset = !ch.balance_url
  return {
    url,
    field: ch.balance_field || preset?.field || '',
    unit: ch.balance_unit || preset?.unit || '',
    minus: usePreset ? (preset?.minus || '') : '',
  }
}

interface BalanceResult { balance: string; unit: string }
interface BalanceDiag { url: string; status?: number; body?: string; resolved?: any; error: string }

async function fetchChannelBalance(ch: Channel): Promise<{ ok: BalanceResult } | { diag: BalanceDiag }> {
  const cfg = balanceConfig(ch)
  if (!cfg) return { diag: { url: '', error: '该渠道无余额接口配置，也不在预设列表中' } }

  const key = ch.api_key.split('\n')[0].trim()
  let fetchUrl: string
  try { fetchUrl = new URL(ch.base_url.replace(/\/+$/, '')).origin + cfg.url } catch { return { diag: { url: cfg.url, error: 'base_url 解析失败' } } }

  let raw: string, status: number
  try {
    const resp = await fetch(fetchUrl, { headers: { 'Authorization': `Bearer ${key}` } })
    status = resp.status
    raw = await resp.text()
  } catch (e: any) {
    return { diag: { url: fetchUrl, error: '请求失败: ' + e.message } }
  }

  let parsed: any
  try { parsed = JSON.parse(raw) } catch { return { diag: { url: fetchUrl, status, body: raw.slice(0, 500), error: '响应非JSON（可能是 key 失效或接口错误）' } } }

  let val = cfg.field ? resolveField(parsed, cfg.field) : null
  if (val == null) return { diag: { url: fetchUrl, status, resolved: null, body: raw.slice(0, 500), error: '字段解析失败（key 可能失效或字段路径不对）' } }
  if (cfg.minus) {
    const used = resolveField(parsed, cfg.minus)
    val = Number(val) - Number(used || 0)
  }
  return { ok: { balance: String(val), unit: cfg.unit } }
}

// Simple wrapper for scheduled/batch use.
async function checkChannelBalance(ch: Channel): Promise<BalanceResult | null> {
  const r = await fetchChannelBalance(ch)
  return 'ok' in r ? r.ok : null
}

admin.post('/api/channels/:id/check-balance', async (c) => {
  const id = Number(c.req.param('id'))
  const ch = await c.env.DB.prepare('SELECT * FROM channels WHERE id = ?').bind(id).first<Channel>()
  if (!ch) return c.json({ success: false, error: '渠道不存在' }, 404)

  const r = await fetchChannelBalance(ch)
  if ('diag' in r) return c.json({ success: false, ...r.diag })

  await c.env.DB.prepare(
    "INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind('balance:' + id, JSON.stringify({ ...r.ok, checked_at: new Date().toISOString() })).run()

  return c.json({ success: true, ...r.ok })
})

admin.post('/api/check-all-balances', async (c) => {
  const channels = await c.env.DB.prepare('SELECT * FROM channels WHERE status = 1').all<Channel>()
  const results: { id: number; name: string; balance: string | null; unit: string; error?: string }[] = []
  for (const ch of channels.results) {
    const r = await checkChannelBalance(ch)
    if (r) {
      await c.env.DB.prepare(
        "INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
      ).bind('balance:' + ch.id, JSON.stringify({ ...r, checked_at: new Date().toISOString() })).run()
      results.push({ id: ch.id, name: ch.name, balance: r.balance, unit: r.unit })
    } else {
      results.push({ id: ch.id, name: ch.name, balance: null, unit: '', error: '不支持或查询失败' })
    }
  }
  return c.json({ success: true, results })
})

admin.get('/api/balances', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT key, value FROM config WHERE key LIKE 'balance:%'"
  ).all<{ key: string; value: string }>()
  const map: Record<number, any> = {}
  for (const r of rows.results) {
    const id = Number(r.key.replace('balance:', ''))
    try { map[id] = JSON.parse(r.value) } catch {}
  }
  return c.json({ success: true, data: map })
})

// ─── Tokens ───

admin.get('/api/tokens', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, name, key, status, models, COALESCE(strategy,'smart') as strategy, COALESCE(pinned_model,'') as pinned_model, COALESCE(channels,'') as channels, COALESCE(remark,'') as remark, created_at FROM tokens ORDER BY id"
  ).all()
  return c.json({ success: true, data: rows.results })
})

admin.post('/api/tokens', async (c) => {
  const body = await c.req.json<{ name: string; models?: string; strategy?: string; pinned_model?: string; channels?: string; remark?: string }>()
  const key = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  await c.env.DB.prepare(
    'INSERT INTO tokens (name, key, models, strategy, pinned_model, channels, remark) VALUES (?, ?, ?, ?, ?, ?, ?)'
  ).bind(body.name || '', key, body.models || '', body.strategy || 'smart', body.pinned_model || '', body.channels || '', body.remark || '').run()
  return c.json({ success: true, key })
})

admin.put('/api/tokens/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ name?: string; status?: number; models?: string; strategy?: string; pinned_model?: string; channels?: string }>()
  const sets: string[] = []
  const vals: any[] = []
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name) }
  if (body.status !== undefined) { sets.push('status = ?'); vals.push(body.status) }
  if (body.models !== undefined) { sets.push('models = ?'); vals.push(body.models) }
  if (body.strategy !== undefined) { sets.push('strategy = ?'); vals.push(body.strategy) }
  if (body.pinned_model !== undefined) { sets.push('pinned_model = ?'); vals.push(body.pinned_model) }
  if (body.channels !== undefined) { sets.push('channels = ?'); vals.push(body.channels) }
  if ((body as any).remark !== undefined) { sets.push('remark = ?'); vals.push((body as any).remark) }
  if (!sets.length) return c.json({ success: true })
  vals.push(id)
  await c.env.DB.prepare(`UPDATE tokens SET ${sets.join(', ')} WHERE id = ?`).bind(...vals).run()
  return c.json({ success: true })
})

admin.delete('/api/tokens/:id', async (c) => {
  const id = Number(c.req.param('id'))
  await c.env.DB.prepare('DELETE FROM tokens WHERE id = ?').bind(id).run()
  return c.json({ success: true })
})

// ─── Routing ───

admin.get('/api/routing/config', async (c) => {
  const config = await getConfig(c.env.DB)
  return c.json({ success: true, data: config })
})

admin.post('/api/routing/config', async (c) => {
  const body = await c.req.json()
  await saveConfig(c.env.DB, body)
  return c.json({ success: true })
})

admin.post('/api/routing/reset', async (c) => {
  await saveConfig(c.env.DB, DEFAULT_CONFIG)
  return c.json({ success: true })
})

admin.get('/api/routing/models', async (c) => {
  const models = await getEnabledModels(c.env.DB)
  const abilities = await c.env.DB.prepare(
    `SELECT a.model, a.channel_id, c.name as channel_name, COALESCE(c.prefix,'') as channel_prefix, c.status as channel_status, a.priority
     FROM abilities a JOIN channels c ON a.channel_id = c.id
     WHERE a.enabled = 1 ORDER BY a.model, c.status DESC, a.priority DESC`
  ).all<{ model: string; channel_id: number; channel_name: string; channel_prefix: string; channel_status: number; priority: number }>()
  return c.json({ success: true, models, abilities: abilities.results })
})

admin.get('/api/routing/overview', async (c) => {
  const strategy = c.req.query('strategy') || 'smart'
  const config = await getConfig(c.env.DB)
  const enabledModels = await getEnabledModels(c.env.DB)
  const freeModels = await getFreeModels(c.env.DB)
  const overview = getCategoryOverview(enabledModels, config, strategy, freeModels)
  const chRows = await c.env.DB.prepare(
    `SELECT a.model, COALESCE(c.prefix,'') as prefix, c.name as ch_name
     FROM abilities a JOIN channels c ON a.channel_id = c.id
     WHERE a.enabled = 1 AND c.status = 1
     ORDER BY a.priority DESC, c.priority DESC`
  ).all<{ model: string; prefix: string; ch_name: string }>()
  const channelMap: Record<string, string> = {}
  for (const r of chRows.results) {
    if (!channelMap[r.model]) channelMap[r.model] = r.prefix || r.ch_name
  }
  return c.json({
    success: true,
    strategy,
    strategies: STRATEGY_LABELS,
    categories: CATEGORY_LABELS,
    data: overview,
    channelMap,
    total_models: enabledModels.length,
  })
})

admin.post('/api/routing/test', async (c) => {
  const body = await c.req.json<{ messages: any[]; strategy?: string; channels?: string; model?: string }>()
  const config = await getConfig(c.env.DB)
  const chFilter = body.channels ? body.channels.split(',').map(s => s.trim()).filter(Boolean) : undefined
  const enabledModels = await getEnabledModels(c.env.DB, chFilter)
  const freeModels = await getFreeModels(c.env.DB, chFilter)
  const strategy = body.strategy || 'smart'
  const { classify, categoryPool, rankModels, selectChannel } = await import('./routing')

  let category = ''
  let ranked: string[] = []
  let selected: string | null = null

  if (body.model) {
    selected = body.model
    category = '-'
  } else {
    category = classify(body.messages || [], config)
    const pool = categoryPool(category, enabledModels, config)
    ranked = rankModels(category, pool, config, strategy, freeModels)
    selected = ranked[0] || null
  }

  let channelInfo: { id: number; name: string; prefix: string } | null = null
  if (selected) {
    const ch = await selectChannel(c.env.DB, selected, chFilter)
    if (ch) channelInfo = { id: ch.id, name: ch.name, prefix: ch.prefix }
  }

  const rankedDetail = ranked.slice(0, 20).map(m => ({
    model: m,
    isFree: freeModels.has(m),
  }))

  return c.json({
    success: true, category, strategy, channels: chFilter || [],
    pool_size: ranked.length, ranked: rankedDetail, selected,
    selectedIsFree: selected ? freeModels.has(selected) : false,
    channel: channelInfo,
  })
})

// ─── Sync all channels ───

admin.post('/api/sync-all', async (c) => {
  const result = await handleScheduled(c.env)
  return c.json({ success: true, ...result })
})

// ─── Logs ───

admin.get('/api/logs', async (c) => {
  const limit = Number(c.req.query('limit') || '50')
  const rows = await c.env.DB.prepare(
    'SELECT * FROM request_log ORDER BY id DESC LIMIT ?'
  ).bind(limit).all()
  return c.json({ success: true, data: rows.results })
})

admin.delete('/api/logs', async (c) => {
  await c.env.DB.prepare('DELETE FROM request_log').run()
  return c.json({ success: true })
})

// ─── Stats ───

admin.get('/api/stats', async (c) => {
  const channels = await c.env.DB.prepare('SELECT COUNT(*) as n FROM channels WHERE status = 1').first<{ n: number }>()
  const models = await c.env.DB.prepare('SELECT COUNT(DISTINCT model) as n FROM abilities a JOIN channels c ON a.channel_id = c.id WHERE c.status = 1').first<{ n: number }>()
  const tokens = await c.env.DB.prepare('SELECT COUNT(*) as n FROM tokens WHERE status = 1').first<{ n: number }>()
  const reqs = await c.env.DB.prepare('SELECT COUNT(*) as n FROM request_log').first<{ n: number }>()
  const cooldowns = await c.env.DB.prepare('SELECT COUNT(*) as n FROM cooldowns WHERE until_ts > unixepoch()').first<{ n: number }>()
  return c.json({
    success: true,
    data: {
      channels: channels?.n || 0,
      models: models?.n || 0,
      tokens: tokens?.n || 0,
      requests: reqs?.n || 0,
      cooldowns: cooldowns?.n || 0,
    },
  })
})

// ─── Dashboard ───

admin.get('/api/dashboard', async (c) => {
  const db = c.env.DB
  const now = Math.floor(Date.now() / 1000)
  const today0 = now - (now % 86400)
  const h24 = now - 86400

  const [channels, models, tokens, totalReqs, todayReqs, cooldowns, errorsToday, avgLatency] = await Promise.all([
    db.prepare('SELECT COUNT(*) as n FROM channels WHERE status = 1').first<{ n: number }>(),
    db.prepare('SELECT COUNT(DISTINCT model) as n FROM abilities a JOIN channels c ON a.channel_id = c.id WHERE c.status = 1 AND a.enabled = 1').first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) as n FROM tokens WHERE status = 1').first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) as n FROM request_log').first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) as n FROM request_log WHERE created_at >= ?').bind(today0).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) as n FROM cooldowns WHERE until_ts > ?').bind(now).first<{ n: number }>(),
    db.prepare('SELECT COUNT(*) as n FROM request_log WHERE created_at >= ? AND status_code >= 400').bind(today0).first<{ n: number }>(),
    db.prepare('SELECT AVG(latency_ms) as v FROM request_log WHERE created_at >= ?').bind(h24).first<{ v: number }>(),
  ])

  const topModels = await db.prepare(
    `SELECT model_used as model, COUNT(*) as cnt, AVG(latency_ms) as avg_ms,
       SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) as ok
     FROM request_log WHERE created_at >= ? AND model_used != ''
     GROUP BY model_used ORDER BY cnt DESC LIMIT 10`
  ).bind(h24).all<{ model: string; cnt: number; avg_ms: number; ok: number }>()

  const topTokens = await db.prepare(
    `SELECT token_name, COUNT(*) as cnt,
       SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) as ok
     FROM request_log WHERE created_at >= ? AND token_name != ''
     GROUP BY token_name ORDER BY cnt DESC LIMIT 10`
  ).bind(h24).all<{ token_name: string; cnt: number; ok: number }>()

  const channelStats = await db.prepare(
    `SELECT channel_name, COUNT(*) as cnt,
       SUM(CASE WHEN status_code < 400 THEN 1 ELSE 0 END) as ok,
       AVG(latency_ms) as avg_ms
     FROM request_log WHERE created_at >= ? AND channel_name != ''
     GROUP BY channel_name ORDER BY cnt DESC`
  ).bind(h24).all<{ channel_name: string; cnt: number; ok: number; avg_ms: number }>()

  const recentLogs = await db.prepare(
    'SELECT * FROM request_log ORDER BY id DESC LIMIT 15'
  ).all()

  const hourly = await db.prepare(
    `SELECT (created_at - ?) / 3600 as h, COUNT(*) as cnt,
       SUM(CASE WHEN status_code >= 400 THEN 1 ELSE 0 END) as errs
     FROM request_log WHERE created_at >= ?
     GROUP BY h ORDER BY h`
  ).bind(h24, h24).all<{ h: number; cnt: number; errs: number }>()

  const lastSync = await db.prepare("SELECT value FROM config WHERE key = 'last_sync'").first<{ value: string }>()

  const balRows = await db.prepare("SELECT key, value FROM config WHERE key LIKE 'balance:%'").all<{ key: string; value: string }>()
  const balances: Record<number, any> = {}
  for (const br of balRows.results) {
    const cid = Number(br.key.replace('balance:', ''))
    try { balances[cid] = JSON.parse(br.value) } catch {}
  }
  const chList = await db.prepare("SELECT id, name, COALESCE(prefix,'') as prefix FROM channels WHERE status = 1 ORDER BY priority DESC").all<{ id: number; name: string; prefix: string }>()

  return c.json({
    success: true,
    stats: {
      channels: channels?.n || 0,
      models: models?.n || 0,
      tokens: tokens?.n || 0,
      totalReqs: totalReqs?.n || 0,
      todayReqs: todayReqs?.n || 0,
      cooldowns: cooldowns?.n || 0,
      errorsToday: errorsToday?.n || 0,
      avgLatency: Math.round(avgLatency?.v || 0),
    },
    topModels: topModels.results,
    topTokens: topTokens.results,
    channelStats: channelStats.results,
    recentLogs: recentLogs.results,
    hourly: hourly.results,
    lastSync: lastSync ? JSON.parse(lastSync.value) : null,
    balances,
    channelList: chList.results,
  })
})

// ─── DB Init ───

admin.post('/api/init', async (c) => {
  const sql = `
    CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL, models TEXT DEFAULT '', prefix TEXT DEFAULT '', free_models TEXT DEFAULT '', balance_url TEXT DEFAULT '', balance_field TEXT DEFAULT '', balance_unit TEXT DEFAULT '', status INTEGER DEFAULT 1, priority INTEGER DEFAULT 0, created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS abilities (model TEXT NOT NULL, channel_id INTEGER NOT NULL, enabled INTEGER DEFAULT 1, priority INTEGER DEFAULT 0, PRIMARY KEY (model, channel_id));
    CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT DEFAULT '', key TEXT UNIQUE NOT NULL, status INTEGER DEFAULT 1, models TEXT DEFAULT '', strategy TEXT DEFAULT 'smart', pinned_model TEXT DEFAULT '', channels TEXT DEFAULT '', remark TEXT DEFAULT '', created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS cooldowns (channel_id INTEGER NOT NULL, model TEXT NOT NULL, until_ts INTEGER NOT NULL, PRIMARY KEY (channel_id, model));
    CREATE TABLE IF NOT EXISTS request_log (id INTEGER PRIMARY KEY AUTOINCREMENT, token_name TEXT, path TEXT, model_asked TEXT, model_used TEXT, channel_id INTEGER, channel_name TEXT, status_code INTEGER, latency_ms INTEGER, error TEXT, created_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS config (key TEXT PRIMARY KEY, value TEXT NOT NULL);
  `
  const stmts = sql.split(';').map(s => s.trim()).filter(Boolean)
  for (const stmt of stmts) {
    await c.env.DB.prepare(stmt).run()
  }
  const migrations: string[] = [
    "ALTER TABLE tokens ADD COLUMN strategy TEXT DEFAULT 'smart'",
    "ALTER TABLE tokens ADD COLUMN pinned_model TEXT DEFAULT ''",
    "ALTER TABLE channels ADD COLUMN prefix TEXT DEFAULT ''",
    "ALTER TABLE channels ADD COLUMN free_models TEXT DEFAULT ''",
    "ALTER TABLE tokens ADD COLUMN channels TEXT DEFAULT ''",
    "ALTER TABLE tokens ADD COLUMN remark TEXT DEFAULT ''",
    "ALTER TABLE channels ADD COLUMN balance_url TEXT DEFAULT ''",
    "ALTER TABLE channels ADD COLUMN balance_field TEXT DEFAULT ''",
    "ALTER TABLE channels ADD COLUMN balance_unit TEXT DEFAULT ''",
  ]
  for (const m of migrations) {
    try { await c.env.DB.prepare(m).run() } catch { /* already exists */ }
  }
  // migrate old is_free flag to free_models
  try {
    await c.env.DB.prepare("UPDATE channels SET free_models = '*' WHERE is_free = 1 AND (free_models IS NULL OR free_models = '')").run()
  } catch { /* is_free column may not exist on fresh db */ }
  // auto-generate prefixes for channels that don't have one
  const channels = await c.env.DB.prepare("SELECT id, name, COALESCE(prefix,'') as prefix FROM channels").all<{ id: number; name: string; prefix: string }>()
  for (const ch of channels.results) {
    if (!ch.prefix) {
      const prefix = await generateUniquePrefix(c.env.DB, ch.name, ch.id)
      await c.env.DB.prepare('UPDATE channels SET prefix = ? WHERE id = ?').bind(prefix, ch.id).run()
    }
  }
  return c.json({ success: true, message: '数据库初始化完成' })
})

// ─── Scheduled: daily model sync ───

export async function handleScheduled(env: Env): Promise<{ synced: number; failed: number }> {
  const db = env.DB
  const channels = await db.prepare('SELECT * FROM channels WHERE status = 1').all<Channel>()
  let synced = 0, failed = 0
  for (const ch of channels.results) {
    const key = ch.api_key.split('\n')[0].trim()
    try {
      const base = ch.base_url.replace(/\/+$/, '')
      const modelsPath = /\/v\d+$/.test(base) ? '/models' : '/v1/models'
      const resp = await fetch(base + modelsPath, {
        headers: { 'Authorization': `Bearer ${key}` },
      })
      if (!resp.ok) { failed++; continue }
      const data = await resp.json<{ data?: Array<{ id: string }> }>()
      const models = (data.data || []).map(m => m.id).join(',')
      await db.prepare('UPDATE channels SET models = ?, updated_at = unixepoch() WHERE id = ?').bind(models, ch.id).run()
      await syncAbilities(db, ch.id, models)
      synced++
    } catch {
      failed++
    }
  }
  await db.prepare('DELETE FROM cooldowns WHERE until_ts < unixepoch()').run()
  // check balances
  let balanceChecked = 0
  for (const ch of channels.results) {
    try {
      const r = await checkChannelBalance(ch)
      if (r) {
        await db.prepare(
          "INSERT INTO config (key, value) VALUES (?1, ?2) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
        ).bind('balance:' + ch.id, JSON.stringify({ ...r, checked_at: new Date().toISOString() })).run()
        balanceChecked++
      }
    } catch { /* best effort */ }
  }
  try {
    await db.prepare(
      "INSERT INTO config (key, value) VALUES ('last_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(JSON.stringify({ time: new Date().toISOString(), synced, failed, balanceChecked })).run()
  } catch { /* best effort */ }
  return { synced, failed }
}

export { admin }
