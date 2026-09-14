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
    "SELECT id, name, COALESCE(prefix,'') as prefix, base_url, api_key, models, status, priority, created_at, updated_at FROM channels ORDER BY id"
  ).all<Channel>()
  return c.json({ success: true, data: rows.results })
})

admin.post('/api/channels', async (c) => {
  const body = await c.req.json<{ name: string; base_url: string; api_key: string; models: string; prefix?: string; priority?: number }>()
  const prefix = body.prefix || await generateUniquePrefix(c.env.DB, body.name)
  const result = await c.env.DB.prepare(
    'INSERT INTO channels (name, prefix, base_url, api_key, models, priority) VALUES (?, ?, ?, ?, ?, ?)'
  ).bind(body.name, prefix, body.base_url, body.api_key, body.models || '', body.priority || 0).run()
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

// ─── Tokens ───

admin.get('/api/tokens', async (c) => {
  const rows = await c.env.DB.prepare(
    "SELECT id, name, key, status, models, COALESCE(strategy,'smart') as strategy, COALESCE(pinned_model,'') as pinned_model, created_at FROM tokens ORDER BY id"
  ).all()
  return c.json({ success: true, data: rows.results })
})

admin.post('/api/tokens', async (c) => {
  const body = await c.req.json<{ name: string; models?: string; strategy?: string; pinned_model?: string }>()
  const key = crypto.randomUUID().replace(/-/g, '') + crypto.randomUUID().replace(/-/g, '').slice(0, 16)
  await c.env.DB.prepare(
    'INSERT INTO tokens (name, key, models, strategy, pinned_model) VALUES (?, ?, ?, ?, ?)'
  ).bind(body.name || '', key, body.models || '', body.strategy || 'smart', body.pinned_model || '').run()
  return c.json({ success: true, key })
})

admin.put('/api/tokens/:id', async (c) => {
  const id = Number(c.req.param('id'))
  const body = await c.req.json<{ name?: string; status?: number; models?: string; strategy?: string; pinned_model?: string }>()
  const sets: string[] = []
  const vals: any[] = []
  if (body.name !== undefined) { sets.push('name = ?'); vals.push(body.name) }
  if (body.status !== undefined) { sets.push('status = ?'); vals.push(body.status) }
  if (body.models !== undefined) { sets.push('models = ?'); vals.push(body.models) }
  if (body.strategy !== undefined) { sets.push('strategy = ?'); vals.push(body.strategy) }
  if (body.pinned_model !== undefined) { sets.push('pinned_model = ?'); vals.push(body.pinned_model) }
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
  const freeModels = getFreeModels(enabledModels, config)
  const overview = getCategoryOverview(enabledModels, config, strategy, freeModels)
  return c.json({
    success: true,
    strategy,
    strategies: STRATEGY_LABELS,
    categories: CATEGORY_LABELS,
    data: overview,
    total_models: enabledModels.length,
  })
})

admin.post('/api/routing/test', async (c) => {
  const body = await c.req.json<{ messages: any[] }>()
  const config = await getConfig(c.env.DB)
  const enabledModels = await getEnabledModels(c.env.DB)
  const { classify, resolveModel, categoryPool, rankModels, getFreeModels: gfm } = await import('./routing')
  const freeModels = gfm(enabledModels, config)
  const category = classify(body.messages || [], config)
  const pool = categoryPool(category, enabledModels, config)
  const ranked = rankModels(category, pool, config, 'smart', freeModels)
  const selected = ranked[0] || null
  return c.json({ success: true, category, pool_size: pool.length, ranked: ranked.slice(0, 10), selected })
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

// ─── DB Init ───

admin.post('/api/init', async (c) => {
  const sql = `
    CREATE TABLE IF NOT EXISTS channels (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT NOT NULL, base_url TEXT NOT NULL, api_key TEXT NOT NULL, models TEXT DEFAULT '', prefix TEXT DEFAULT '', status INTEGER DEFAULT 1, priority INTEGER DEFAULT 0, created_at INTEGER DEFAULT (unixepoch()), updated_at INTEGER DEFAULT (unixepoch()));
    CREATE TABLE IF NOT EXISTS abilities (model TEXT NOT NULL, channel_id INTEGER NOT NULL, enabled INTEGER DEFAULT 1, priority INTEGER DEFAULT 0, PRIMARY KEY (model, channel_id));
    CREATE TABLE IF NOT EXISTS tokens (id INTEGER PRIMARY KEY AUTOINCREMENT, name TEXT DEFAULT '', key TEXT UNIQUE NOT NULL, status INTEGER DEFAULT 1, models TEXT DEFAULT '', strategy TEXT DEFAULT 'smart', pinned_model TEXT DEFAULT '', created_at INTEGER DEFAULT (unixepoch()));
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
  ]
  for (const m of migrations) {
    try { await c.env.DB.prepare(m).run() } catch { /* already exists */ }
  }
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
  try {
    await db.prepare(
      "INSERT INTO config (key, value) VALUES ('last_sync', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
    ).bind(JSON.stringify({ time: new Date().toISOString(), synced, failed })).run()
  } catch { /* best effort */ }
  return { synced, failed }
}

export { admin }
