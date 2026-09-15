export interface Env {
  DB: D1Database
  AUTH_KEY: string
  LOGIN_PASS: string
}

export interface Channel {
  id: number
  name: string
  prefix: string
  base_url: string
  api_key: string
  models: string
  free_models: string
  status: number
  priority: number
  created_at: number
  updated_at: number
}

export interface Ability {
  model: string
  channel_id: number
  enabled: number
  priority: number
}

export interface Token {
  id: number
  name: string
  key: string
  status: number
  models: string
  strategy: string
  pinned_model: string
  channels: string
  remark: string
  created_at: number
}

export interface RequestLog {
  id: number
  token_name: string
  path: string
  model_asked: string
  model_used: string
  channel_id: number
  channel_name: string
  status_code: number
  latency_ms: number
  error: string
  created_at: number
}

export interface RoutingRule {
  keywords: string[]
  category: string
}

export interface CategoryConfig {
  prefs: Record<string, string[]>
  hints: Record<string, string[]>
  exclude: Record<string, string[]>
  rules: RoutingRule[]
  paidPatterns: string[]
}

export interface CategoryOverviewItem {
  key: string
  label: string
  selected: string | null
  isFree: boolean
  poolSize: number
  topModels: Array<{ model: string; isFree: boolean }>
}
