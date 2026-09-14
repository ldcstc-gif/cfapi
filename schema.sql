-- Drop old one-balance tables
DROP TABLE IF EXISTS _cf_KV;
DROP TABLE IF EXISTS keys;

-- Channels: each row = one LLM provider endpoint
CREATE TABLE IF NOT EXISTS channels (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  base_url TEXT NOT NULL,
  api_key TEXT NOT NULL,
  models TEXT DEFAULT '',
  status INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  created_at INTEGER DEFAULT (unixepoch()),
  updated_at INTEGER DEFAULT (unixepoch())
);

-- Abilities: model → channel mapping, auto-generated from channels.models
CREATE TABLE IF NOT EXISTS abilities (
  model TEXT NOT NULL,
  channel_id INTEGER NOT NULL,
  enabled INTEGER DEFAULT 1,
  priority INTEGER DEFAULT 0,
  PRIMARY KEY (model, channel_id)
);
CREATE INDEX IF NOT EXISTS idx_abilities_model ON abilities(model);

-- Tokens: API keys for end users
CREATE TABLE IF NOT EXISTS tokens (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT DEFAULT '',
  key TEXT UNIQUE NOT NULL,
  status INTEGER DEFAULT 1,
  models TEXT DEFAULT '',
  created_at INTEGER DEFAULT (unixepoch())
);

-- Cooldowns: per-channel per-model 429 tracking
CREATE TABLE IF NOT EXISTS cooldowns (
  channel_id INTEGER NOT NULL,
  model TEXT NOT NULL,
  until_ts INTEGER NOT NULL,
  PRIMARY KEY (channel_id, model)
);

-- Request log
CREATE TABLE IF NOT EXISTS request_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  token_name TEXT,
  path TEXT,
  model_asked TEXT,
  model_used TEXT,
  channel_id INTEGER,
  channel_name TEXT,
  status_code INTEGER,
  latency_ms INTEGER,
  error TEXT,
  created_at INTEGER DEFAULT (unixepoch())
);

-- Config: key-value store for routing config etc
CREATE TABLE IF NOT EXISTS config (
  key TEXT PRIMARY KEY,
  value TEXT NOT NULL
);
