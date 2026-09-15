import type { Env, Channel, CategoryConfig, RoutingRule, CategoryOverviewItem } from './types'

export const CATEGORY_LABELS: Record<string, string> = {
  reasoning: '推理 / 数学',
  coding: '编程',
  creative: '创作 / 角色扮演',
  intimate: '亲密对话',
  long_context: '长文本',
  fast: '快速响应',
  general: '通用',
  image: '图像生成',
  video: '视频生成',
  embedding: '向量嵌入',
}

export const CATEGORY_ORDER = [
  'reasoning', 'coding', 'creative', 'intimate', 'long_context',
  'fast', 'general', 'image', 'video', 'embedding',
]

export const STRATEGY_LABELS: Record<string, string> = {
  smart: '智能自动',
  free: '免费',
  price: '价格优先',
  speed: '速度优先',
  success: '成功率优先',
}

const DEFAULT_CONFIG: CategoryConfig = {
  prefs: {
    reasoning: ['deepseek-reasoner', 'deepseek-ai/DeepSeek-R1-0528-Qwen3-8B', 'glm-5', 'glm-4.6', 'Qwen/Qwen3-32B'],
    coding: ['deepseek-chat', 'deepseek-v4-pro', 'Qwen/Qwen2.5-72B-Instruct', 'Qwen/Qwen3-32B'],
    creative: ['venice-uncensored-role-play', 'glm-5', 'glm-4.6', 'Qwen/Qwen2.5-72B-Instruct', 'deepseek-chat'],
    intimate: ['venice-uncensored-role-play', 'glm-4-flash-250414', 'glm-4-flash',
      'Qwen/Qwen2.5-14B-Instruct', 'Qwen/Qwen2.5-32B-Instruct', 'Qwen/Qwen3-8B', 'glm-4.5', 'glm-4.7'],
    long_context: ['glm-4.6', 'glm-5', 'deepseek-chat'],
    fast: ['glm-4-flash', 'glm-4.7-flash', 'glm-5-turbo', 'glm-4.5-air', 'deepseek-v4-flash', 'Qwen/Qwen3-8B'],
    general: ['glm-4-flash', 'deepseek-chat', 'glm-4.5', 'Qwen/Qwen2.5-14B-Instruct'],
    image: ['venice-uncensored-1-2'],
    video: [],
    embedding: ['Qwen/Qwen2.5-7B-Instruct'],
  },
  hints: {
    reasoning: ['reasoner', '-r1', 'think', '-pro'],
    coding: ['coder', 'code'],
    creative: ['uncensored', 'role-play', 'roleplay'],
    intimate: ['uncensored', 'role-play', 'roleplay', 'rp-'],
    long_context: ['long', '128k', '200k'],
    fast: ['flash', 'mini', 'lite', 'turbo', '-air'],
    general: [],
    image: ['image', 'flux', 'sd-', 'dall'],
    video: ['video', 'cogvideo', 'sora', 'wan2', '-t2v', '-i2v', 'flf2v', 'seedance', 'kling'],
    embedding: ['embed', 'bge-', 'gte-'],
  },
  exclude: {
    intimate: [
      'Qwen/Qwen2.5-72B-Instruct', 'glm-4.5-air', 'glm-4.5-flash', 'deepseek-v4-pro',
      'glm-4.6', 'glm-5', 'glm-5-turbo', 'glm-5.1', 'glm-5.2',
      'claude-opus-4-6', 'claude-sonnet-4-6',
    ],
  },
  rules: [
    {
      keywords: ['亲吻', '接吻', '拥抱', '抱住', '搂住', '搂着', '抚摸', '摸着', '牵手',
        '撒娇', '暧昧', '调情', '亲密', '贴着', '靠在', '依偎', '怀里', '耳边',
        '脱下', '衣服', '裙子', '睡衣', '床上', '被窝', '上床', '过夜', '同居',
        '老公', '老婆', '宝贝', '亲爱的', '男朋友', '女朋友', '喜欢你', '爱你',
        '想你了', '心动', '脸红', '害羞', '喘', '呻吟', '身体', '肌肤', '体温',
        'kiss', 'hug', 'cuddle', 'caress', 'intimate', 'seduce', 'flirt',
        'bedroom', 'naked', 'undress', 'moan', 'aroused'],
      category: 'intimate',
    },
    {
      keywords: ['math', 'prove', 'theorem', 'equation', 'calculus', 'logic', 'puzzle',
        'step by step', 'reasoning', 'analysis', 'solve',
        '数学', '证明', '逻辑', '计算', '推导', '算法', '解答', '公式'],
      category: 'reasoning',
    },
    {
      keywords: ['code', 'function', 'bug', 'debug', 'python', 'javascript', 'java',
        'typescript', 'react', 'vue', 'html', 'css', 'sql', 'git', 'docker',
        'api', 'endpoint', 'compile', 'syntax', 'refactor', 'program',
        '编程', '代码', '函数', '报错', '程序', '开发', '脚本', '前端', '后端', '数据库', '部署', '编译'],
      category: 'coding',
    },
    {
      keywords: ['story', 'poem', 'creative', 'write a', 'imagine', 'roleplay', 'character',
        'novel', 'fiction', 'screenplay', 'dialogue',
        '故事', '诗', '小说', '创作', '想象', '角色扮演', '剧本', '创意', '续写', '改写'],
      category: 'creative',
    },
    {
      keywords: ['summarize', 'analyze', 'document', 'report', 'paper', 'article',
        'translate', 'review', 'long text',
        '总结', '分析', '文档', '报告', '论文', '翻译', '审阅'],
      category: 'long_context',
    },
  ],
  paidPatterns: ['Pro/', 'venice-', 'claude-', 'gpt-'],
}

const QUALITY_FIRST_CATEGORIES = new Set(['intimate'])
const SPEED_HINTS = ['flash', 'mini', 'lite', 'turbo', '-air']

function isMedia(model: string): boolean {
  const m = model.toLowerCase()
  if (['reranker', 'rerank'].some(k => m.includes(k))) return true
  if (['embedding', '-embed', 'bge-', 'gte-'].some(k => m.includes(k))) return true
  if (['tts', 'asr', 'speech', 'voice', 'audio', 'whisper'].some(k => m.includes(k))) return true
  if (m.includes('ocr')) return true
  if (['video', 'wan2', 'cogvideo', 'sora', '-t2v', '-i2v', 'flf2v', 'seedance', 'kling'].some(k => m.includes(k))) return true
  if (['image', 'kolors', 'flux', 'dall', 'sd-', 'captioner'].some(k => m.includes(k))) return true
  return false
}

// ─── Config ───

export async function getConfig(db: D1Database): Promise<CategoryConfig> {
  try {
    const row = await db.prepare("SELECT value FROM config WHERE key = 'routing_config'").first<{ value: string }>()
    if (row) {
      const parsed = JSON.parse(row.value) as CategoryConfig
      if (!parsed.paidPatterns) parsed.paidPatterns = DEFAULT_CONFIG.paidPatterns
      return parsed
    }
  } catch { /* use defaults */ }
  return DEFAULT_CONFIG
}

export async function saveConfig(db: D1Database, config: CategoryConfig): Promise<void> {
  await db.prepare(
    "INSERT INTO config (key, value) VALUES ('routing_config', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value"
  ).bind(JSON.stringify(config)).run()
}

// ─── Model queries ───

export async function getEnabledModels(db: D1Database, channelPrefixes?: string[]): Promise<string[]> {
  if (channelPrefixes?.length) {
    const ph = channelPrefixes.map(() => '?').join(',')
    const rows = await db.prepare(
      `SELECT DISTINCT a.model FROM abilities a JOIN channels c ON a.channel_id = c.id WHERE c.status = 1 AND a.enabled = 1 AND c.prefix IN (${ph})`
    ).bind(...channelPrefixes).all<{ model: string }>()
    return rows.results.map(r => r.model)
  }
  const rows = await db.prepare(
    'SELECT DISTINCT a.model FROM abilities a JOIN channels c ON a.channel_id = c.id WHERE c.status = 1 AND a.enabled = 1'
  ).all<{ model: string }>()
  return rows.results.map(r => r.model)
}

export async function getFreeModels(db: D1Database, channelPrefixes?: string[]): Promise<Set<string>> {
  let sql = `SELECT DISTINCT a.model, COALESCE(c.free_models,'') as free_models FROM abilities a
     JOIN channels c ON a.channel_id = c.id
     WHERE c.status = 1 AND a.enabled = 1`
  const binds: string[] = []
  if (channelPrefixes?.length) {
    sql += ` AND c.prefix IN (${channelPrefixes.map(() => '?').join(',')})`
    binds.push(...channelPrefixes)
  }
  const rows = await db.prepare(sql).bind(...binds).all<{ model: string; free_models: string }>()
  const free = new Set<string>()
  for (const r of rows.results) {
    if (r.model.endsWith(':free')) { free.add(r.model); continue }
    if (r.free_models === '*') { free.add(r.model); continue }
    if (r.free_models) {
      const patterns = r.free_models.split(',').map(p => p.trim()).filter(Boolean)
      if (patterns.some(p => r.model.toLowerCase().includes(p.toLowerCase()))) {
        free.add(r.model)
      }
    }
  }
  return free
}

// ─── Classification ───

export function classify(messages: any[], config: CategoryConfig): string {
  let combined = ''
  for (const msg of messages) {
    const content = msg?.content
    if (typeof content === 'string') {
      combined += ' ' + content.toLowerCase()
    } else if (Array.isArray(content)) {
      for (const part of content) {
        if (part?.type === 'text') combined += ' ' + (part.text || '').toLowerCase()
      }
    }
  }
  if (combined.length > 2000) return 'long_context'
  for (const rule of config.rules) {
    if (rule.keywords.some(kw => combined.includes(kw))) return rule.category
  }
  return 'general'
}

// ─── Ranking ───

export function categoryPool(category: string, enabledModels: string[], config: CategoryConfig): string[] {
  const prefs = config.prefs[category] || []
  const hints = config.hints[category] || []
  const excluded = new Set(config.exclude[category] || [])
  const isMediaCategory = ['image', 'video', 'embedding'].includes(category)

  let pool: string[]
  if (isMediaCategory) {
    pool = enabledModels.filter(m =>
      prefs.includes(m) || hints.some(h => m.toLowerCase().includes(h))
    )
  } else {
    pool = enabledModels.filter(m => !isMedia(m))
  }
  if (excluded.size > 0) pool = pool.filter(m => !excluded.has(m))
  return pool
}

export function rankModels(
  category: string,
  pool: string[],
  config: CategoryConfig,
  strategy: string = 'smart',
  freeModels: Set<string> = new Set(),
): string[] {
  const prefs = config.prefs[category] || []
  const hints = config.hints[category] || []

  function fit(model: string): [number, number] {
    const idx = prefs.indexOf(model)
    if (idx >= 0) return [0, idx]
    if (hints.some(h => model.toLowerCase().includes(h))) return [1, 0]
    return [2, 0]
  }

  let sorted = [...pool]

  if (strategy === 'free') {
    sorted = sorted.filter(m => freeModels.has(m))
    sorted.sort((a, b) => {
      const [ar, ai] = fit(a), [br, bi] = fit(b)
      return ar !== br ? ar - br : ai - bi
    })
    return sorted
  }

  if (strategy === 'price') {
    sorted.sort((a, b) => {
      const af = freeModels.has(a) ? 0 : 1, bf = freeModels.has(b) ? 0 : 1
      if (af !== bf) return af - bf
      const [ar, ai] = fit(a), [br, bi] = fit(b)
      return ar !== br ? ar - br : ai - bi
    })
  } else if (strategy === 'speed') {
    sorted.sort((a, b) => {
      const af = SPEED_HINTS.some(h => a.toLowerCase().includes(h)) ? 0 : 1
      const bf = SPEED_HINTS.some(h => b.toLowerCase().includes(h)) ? 0 : 1
      if (af !== bf) return af - bf
      const [ar, ai] = fit(a), [br, bi] = fit(b)
      return ar !== br ? ar - br : ai - bi
    })
  } else if (QUALITY_FIRST_CATEGORIES.has(category)) {
    sorted.sort((a, b) => {
      const [ar, ai] = fit(a), [br, bi] = fit(b)
      if (ar !== br) return ar - br
      if (ai !== bi) return ai - bi
      const af = freeModels.has(a) ? 0 : 1, bf = freeModels.has(b) ? 0 : 1
      return af - bf
    })
  } else {
    sorted.sort((a, b) => {
      const [ar, ai] = fit(a), [br, bi] = fit(b)
      if (ar !== br) return ar - br
      if (ai !== bi) return ai - bi
      const af = freeModels.has(a) ? 0 : 1, bf = freeModels.has(b) ? 0 : 1
      return af - bf
    })
  }
  return sorted
}

export function resolveModel(
  category: string,
  enabledModels: string[],
  config: CategoryConfig,
  strategy: string = 'smart',
  freeModels: Set<string> = new Set(),
): string | null {
  const pool = categoryPool(category, enabledModels, config)
  if (!pool.length) return null
  const ranked = rankModels(category, pool, config, strategy, freeModels)
  return ranked[0] || null
}

export function pickModel(
  path: string,
  body: any,
  enabledModels: string[],
  config: CategoryConfig,
  strategy: string = 'smart',
  freeModels: Set<string> = new Set(),
): { model: string | null; category: string | null } {
  if (path.startsWith('/v1/chat/completions')) {
    const messages = body?.messages || []
    const category = classify(messages, config)
    for (const cat of [category, 'general', 'fast']) {
      const model = resolveModel(cat, enabledModels, config, strategy, freeModels)
      if (model) return { model, category: cat }
    }
    return { model: null, category }
  }
  if (path.startsWith('/v1/images/generations')) {
    return { model: resolveModel('image', enabledModels, config, strategy, freeModels), category: 'image' }
  }
  if (path.startsWith('/v1/embeddings')) {
    return { model: resolveModel('embedding', enabledModels, config, strategy, freeModels), category: 'embedding' }
  }
  return { model: null, category: null }
}

// ─── Category overview (for admin UI) ───

export function getCategoryOverview(
  enabledModels: string[],
  config: CategoryConfig,
  strategy: string,
  freeModels: Set<string>,
): CategoryOverviewItem[] {
  return CATEGORY_ORDER.map(key => {
    const pool = categoryPool(key, enabledModels, config)
    const ranked = pool.length ? rankModels(key, pool, config, strategy, freeModels) : []
    const selected = ranked[0] || null
    const topModels = ranked.slice(0, 10).map(m => ({
      model: m,
      isFree: freeModels.has(m),
    }))
    return {
      key,
      label: CATEGORY_LABELS[key] || key,
      selected,
      isFree: selected ? freeModels.has(selected) : true,
      poolSize: pool.length,
      topModels,
    }
  })
}

// ─── Channel selection ───

export async function selectChannel(db: D1Database, model: string, channelPrefixes?: string[]): Promise<Channel | null> {
  const now = Math.floor(Date.now() / 1000)
  let sql = `
    SELECT c.* FROM channels c
    JOIN abilities a ON a.channel_id = c.id
    LEFT JOIN cooldowns cd ON cd.channel_id = c.id AND cd.model = ?1 AND cd.until_ts > ?2
    WHERE a.model = ?1 AND c.status = 1 AND a.enabled = 1`
  const binds: any[] = [model, now]
  if (channelPrefixes?.length) {
    sql += ` AND c.prefix IN (${channelPrefixes.map(() => '?').join(',')})`
    binds.push(...channelPrefixes)
  }
  sql += ` ORDER BY (cd.until_ts IS NULL) DESC, a.priority DESC, c.priority DESC LIMIT 1`
  const row = await db.prepare(sql).bind(...binds).first<Channel>()
  return row || null
}

export async function setCooldown(db: D1Database, channelId: number, model: string, seconds: number): Promise<void> {
  const until = Math.floor(Date.now() / 1000) + seconds
  await db.prepare(
    'INSERT INTO cooldowns (channel_id, model, until_ts) VALUES (?, ?, ?) ON CONFLICT(channel_id, model) DO UPDATE SET until_ts = excluded.until_ts'
  ).bind(channelId, model, until).run()
}

export async function cleanCooldowns(db: D1Database): Promise<void> {
  await db.prepare('DELETE FROM cooldowns WHERE until_ts < ?').bind(Math.floor(Date.now() / 1000)).run()
}

export async function syncAbilities(db: D1Database, channelId: number, models: string): Promise<void> {
  const modelList = models.split(',').map(m => m.trim()).filter(Boolean)
  await db.prepare('DELETE FROM abilities WHERE channel_id = ?').bind(channelId).run()
  for (const model of modelList) {
    await db.prepare(
      'INSERT INTO abilities (model, channel_id, enabled, priority) VALUES (?, ?, 1, 0) ON CONFLICT DO NOTHING'
    ).bind(model, channelId).run()
  }
}

export { DEFAULT_CONFIG }
