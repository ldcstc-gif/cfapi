# CF API Router

部署在 Cloudflare Workers 上的 AI API 智能路由网关。聚合多个 LLM 供应商渠道，提供统一的 OpenAI 兼容接口，支持基于消息内容的智能分类路由、多策略模型选择、渠道前缀指定、免费模型精准识别和 429 自动重试。

## 功能特性

- **多渠道聚合** — 统一接入 SiliconFlow、DeepSeek、智谱GLM、OpenRouter 等 LLM 供应商
- **智能路由** — 根据消息内容自动分类（推理/编程/创作/亲密对话/长文本/快速响应/通用/图像/视频/嵌入），选择最优模型
- **多策略选择** — 智能自动 / 免费优先 / 价格优先 / 速度优先 / 成功率优先，五种路由策略
- **渠道前缀路由** — 用 `前缀:模型名` 格式强制指定渠道（如 `sf:deepseek-ai/DeepSeek-V4-Flash`）
- **渠道自动路由** — 用 `前缀:auto` 在指定渠道内自动选模型（如 `or:auto` 只在 OpenRouter 内路由）
- **免费模型精准识别** — 每个渠道可配置免费模型匹配规则（全免费 / 关键词匹配 / OpenRouter `:free` 后缀自动识别）
- **令牌渠道限制** — 每个令牌可限定只走指定渠道，配合免费策略实现"只用某渠道免费模型"
- **令牌管理** — 每个令牌可独立设置路由策略、固定模型、渠道限制、可用模型白名单、备注
- **429 自动重试** — 遇到限流自动切换备用渠道
- **渠道冷却** — 记录限流状态，避免短时间重复请求失败渠道
- **管理面板** — 内置 Web UI，支持渠道/令牌/路由管理、日志查看、路由测试
- **路由测试** — 可视化测试路由结果，支持策略选择、渠道过滤、指定模型，展示命中渠道和免费标识
- **模型同步** — 一键从上游 API 拉取最新模型列表
- **Session 登录** — HttpOnly Cookie 会话认证，安全可靠

## 技术架构

```
客户端  ──▶  Cloudflare Workers (Hono)  ──▶  上游 LLM API
                    │
                Cloudflare D1
              (SQLite 数据库)
```

- **运行时**: Cloudflare Workers
- **框架**: [Hono](https://hono.dev/) v4
- **数据库**: Cloudflare D1 (Serverless SQLite)
- **语言**: TypeScript

## 项目结构

```
src/
├── index.ts      # 入口：Hono 应用 + fetch/scheduled 导出
├── proxy.ts      # API 代理：认证、路由、转发、429重试
├── routing.ts    # 路由引擎：分类、策略排序、渠道选择
├── admin.ts      # 管理API：渠道/令牌CRUD、路由配置、统计、同步
├── ui.ts         # 管理界面：登录页 + 管理面板 HTML/JS
└── types.ts      # TypeScript 类型定义
```

## 快速部署

### 前置条件

- [Node.js](https://nodejs.org/) >= 18
- [Cloudflare 账号](https://dash.cloudflare.com/)
- Wrangler CLI（已包含在 devDependencies 中）

### 1. 克隆并安装

```bash
git clone https://github.com/ldcstc-gif/cfapi.git
cd cfapi
npm install
```

### 2. 创建 D1 数据库

```bash
npx wrangler d1 create one-balance
```

记录输出中的 `database_id`。

### 3. 配置 wrangler.toml

```bash
cp wrangler.toml.example wrangler.toml
```

编辑 `wrangler.toml`，填入：
- `database_id` — 上一步创建的 D1 数据库 ID
- `AUTH_KEY` — 管理 API 认证密钥（建议 64 位随机十六进制字符串）
- `LOGIN_PASS` — 管理面板登录密码

```toml
[[d1_databases]]
binding = "DB"
database_name = "one-balance"
database_id = "你的数据库ID"

[vars]
AUTH_KEY = "你的管理API密钥"
LOGIN_PASS = "你的登录密码"
```

### 4. 部署

```bash
npm run deploy
```

### 5. 初始化数据库

部署成功后，调用初始化接口创建表结构：

```bash
curl -X POST https://你的域名/admin/api/init \
  -H "Authorization: Bearer 你的AUTH_KEY"
```

### 6. 登录管理面板

浏览器打开 `https://你的域名/admin`，输入 `LOGIN_PASS` 登录。

## 使用指南

### 管理面板

管理面板包含 5 个标签页：

| 标签 | 功能 |
|------|------|
| **渠道** | 添加/编辑/测试/同步 LLM 供应商渠道，配置免费模型规则 |
| **模型** | 查看智能路由分类概览、策略切换（含免费策略）、全部模型列表（含渠道前缀别名） |
| **令牌** | 创建/编辑 API 令牌，设置路由策略、渠道限制和备注 |
| **路由测试** | 选择策略、渠道、指定模型，测试路由分类和渠道选择结果 |
| **日志** | 查看请求日志（模型、渠道、状态码、延迟） |

### 添加渠道

1. 进入「渠道」标签页，点击「+ 添加渠道」
2. 填写名称、Base URL、API Key
3. 配置免费模型规则（见下方说明）
4. 保存后点击「同步模型」自动拉取可用模型列表
5. 系统自动为渠道生成唯一前缀（可编辑）

### 免费模型规则

每个渠道的「免费模型规则」字段决定哪些模型被视为免费：

| 值 | 含义 | 示例 |
|----|------|------|
| `*` | 该渠道所有模型免费 | 完全免费的渠道 |
| 留空 | 该渠道无免费模型 | 纯付费渠道 |
| 逗号分隔关键词 | 模型名包含任一关键词即免费 | `Qwen/,deepseek-ai/,THUDM/` |

此外，OpenRouter 的 `:free` 后缀模型（如 `google/gemma-3n-e4b-it:free`）无论渠道设置如何，始终被识别为免费。

**示例 — SiliconFlow 渠道**：SiliconFlow 混合了免费开源模型和付费模型，设置为：
```
Qwen/,deepseek-ai/,THUDM/,meta-llama/,internlm/,01-ai/
```
这样只有包含上述关键词的开源模型被标记为免费，其余付费模型正确标记为付费。

### API 调用

本网关完全兼容 OpenAI API 格式。

**Base URL**: `https://你的域名/v1`

**认证方式**: `Authorization: Bearer <令牌Key>`

#### 全局自动路由（推荐）

```bash
curl https://你的域名/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 你的令牌Key" \
  -d '{
    "model": "auto",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

model 设为 `auto` 或留空，系统根据消息内容自动分类，从所有渠道中选择最优模型。

#### 渠道内自动路由

```bash
curl https://你的域名/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 你的令牌Key" \
  -d '{
    "model": "sf:auto",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

使用 `前缀:auto` 格式，在指定渠道内做智能路由。例如 `sf:auto` 只从 SiliconFlow 的模型中选择，`or:auto` 只从 OpenRouter 选择。

#### 指定模型

```bash
curl https://你的域名/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 你的令牌Key" \
  -d '{
    "model": "deepseek-chat",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

系统自动从可用渠道中选择最优的来转发请求。

#### 指定渠道 + 指定模型

```bash
curl https://你的域名/v1/chat/completions \
  -H "Content-Type: application/json" \
  -H "Authorization: Bearer 你的令牌Key" \
  -d '{
    "model": "sf:deepseek-ai/DeepSeek-V4-Flash",
    "messages": [{"role": "user", "content": "你好"}]
  }'
```

使用 `渠道前缀:模型名` 格式强制走指定渠道。前缀在管理面板「渠道」页可查看和编辑。

#### 获取模型列表

```bash
curl https://你的域名/v1/models \
  -H "Authorization: Bearer 你的令牌Key"
```

返回所有可用模型，包含：
- `auto` — 全局自动路由
- `前缀:auto` — 每个渠道的自动路由（如 `sf:auto`、`or:auto`、`ds:auto`）
- 所有实际模型名
- `前缀:模型名` — 所有模型的渠道前缀别名

### 路由策略

每个令牌可独立设置路由策略：

| 策略 | 说明 |
|------|------|
| **智能自动** (smart) | 根据分类偏好选择最优模型，同等条件下优先免费 |
| **免费** (free) | 只从免费模型中选择，按分类偏好排序 |
| **价格优先** (price) | 免费模型排最前，再按偏好排序 |
| **速度优先** (speed) | Flash/Turbo/Mini 等快速模型排最前 |
| **成功率优先** (success) | 按偏好排序，历史成功率高的优先 |

### 令牌配置

每个令牌支持以下配置：

| 字段 | 说明 |
|------|------|
| **名称** | 令牌标识名 |
| **路由策略** | 选择上述五种策略之一 |
| **固定模型** | 指定后忽略智能路由，始终使用该模型 |
| **限制渠道** | 逗号分隔的渠道前缀，限制令牌只走指定渠道（如 `or,sf`） |
| **限制模型** | 逗号分隔的模型白名单 |
| **备注** | 用途说明、分配对象等 |

**典型场景：只用 OpenRouter 免费模型的陪聊令牌**

- 策略：`免费`
- 限制渠道：`or`
- 备注：`陪聊专用，仅走 OpenRouter 免费模型`

**典型场景：只用 SiliconFlow 开源免费模型**

- 策略：`免费`
- 限制渠道：`sf`

### 内容分类

系统根据消息内容关键词自动分类：

| 分类 | 触发关键词示例 |
|------|--------------|
| 推理/数学 | 证明、计算、公式、logic、theorem |
| 编程 | 代码、函数、python、debug、API |
| 创作/角色扮演 | 故事、小说、创作、roleplay |
| 亲密对话 | 特定亲密关键词 |
| 长文本 | 总结、分析、翻译、论文（或消息>2000字） |
| 快速响应 | 由策略和模型特征决定 |
| 通用 | 不匹配任何特定分类的消息 |
| 图像生成 | /v1/images/generations 路径 |
| 视频生成 | 含 video/cogvideo 等关键词 |
| 向量嵌入 | /v1/embeddings 路径 |

### 第三方应用接入

接入任何支持 OpenAI API 的应用时：

| 配置项 | 值 |
|--------|-----|
| Base URL / API 地址 | `https://你的域名/v1` |
| API Key | 管理面板创建的令牌 Key |
| 模型名 | `auto`（全局自动路由）或 `sf:auto`（渠道自动路由）或具体模型名 |

> **注意**：部分应用的 Base URL 不需要 `/v1` 后缀（应用会自动拼接）。如果请求报 404，检查日志中的实际路径是否重复了 `/v1`。

### 模型同步

- **手动同步**：管理面板「模型」页点击「刷新全部渠道模型」
- **单渠道同步**：「渠道」页对应渠道点击「同步模型」
- **定时同步**：如果 Cloudflare 付费计划有可用 Cron 配额，在 `wrangler.toml` 中取消 `[triggers]` 注释

## 数据库表结构

| 表名 | 说明 |
|------|------|
| `channels` | 渠道配置（名称、前缀、Base URL、API Key、免费模型规则、模型列表、优先级） |
| `abilities` | 模型-渠道映射（多对多关系） |
| `tokens` | API 令牌（密钥、路由策略、固定模型、渠道限制、模型白名单、备注） |
| `cooldowns` | 429 冷却记录（渠道-模型粒度） |
| `request_log` | 请求日志（路由结果、延迟、错误） |
| `config` | 键值配置（路由规则、会话等） |

## 路由配置

路由配置存储在 D1 `config` 表中，可通过管理 API 修改：

```bash
# 获取当前配置
curl https://你的域名/admin/api/routing/config \
  -H "Authorization: Bearer AUTH_KEY"

# 更新配置
curl -X POST https://你的域名/admin/api/routing/config \
  -H "Authorization: Bearer AUTH_KEY" \
  -H "Content-Type: application/json" \
  -d '{ "prefs": {...}, "hints": {...}, "exclude": {...}, "rules": [...], "paidPatterns": [...] }'

# 重置为默认配置
curl -X POST https://你的域名/admin/api/routing/reset \
  -H "Authorization: Bearer AUTH_KEY"
```

配置结构：

```json
{
  "prefs": {
    "reasoning": ["deepseek-reasoner", "glm-5", ...],
    "coding": ["deepseek-chat", ...],
    "...": ["..."]
  },
  "hints": {
    "reasoning": ["reasoner", "-r1", "think"],
    "coding": ["coder", "code"],
    "...": ["..."]
  },
  "exclude": {
    "intimate": ["大模型列表，这些模型不用于亲密对话"]
  },
  "rules": [
    { "keywords": ["关键词1", "关键词2"], "category": "分类名" }
  ],
  "paidPatterns": ["Pro/", "claude-", "gpt-"]
}
```

- **prefs**: 每个分类的偏好模型列表（排在前面的优先级更高）
- **hints**: 模型名关键词提示（用于将模型归入对应分类池）
- **exclude**: 排除列表（指定模型不用于某分类）
- **rules**: 内容分类规则（关键词 → 分类映射）
- **paidPatterns**: 付费模型名称特征（匹配的模型标记为付费）

## 管理 API

所有管理 API 需要认证（`Authorization: Bearer AUTH_KEY` 或登录 Session）。

| 方法 | 路径 | 说明 |
|------|------|------|
| POST | `/admin/api/login` | 登录 |
| POST | `/admin/api/logout` | 登出 |
| GET | `/admin/api/channels` | 渠道列表 |
| POST | `/admin/api/channels` | 创建渠道（自动生成前缀） |
| PUT | `/admin/api/channels/:id` | 更新渠道 |
| DELETE | `/admin/api/channels/:id` | 删除渠道 |
| POST | `/admin/api/channels/:id/test` | 测试渠道连接 |
| POST | `/admin/api/channels/:id/sync-models` | 同步渠道模型 |
| GET | `/admin/api/tokens` | 令牌列表 |
| POST | `/admin/api/tokens` | 创建令牌 |
| PUT | `/admin/api/tokens/:id` | 更新令牌 |
| DELETE | `/admin/api/tokens/:id` | 删除令牌 |
| GET | `/admin/api/routing/overview?strategy=X` | 路由概览（分类+策略） |
| GET | `/admin/api/routing/models` | 全部模型（含渠道前缀） |
| GET | `/admin/api/routing/config` | 路由配置 |
| POST | `/admin/api/routing/config` | 更新路由配置 |
| POST | `/admin/api/routing/reset` | 重置路由配置 |
| POST | `/admin/api/routing/test` | 测试路由（支持策略、渠道过滤、指定模型） |
| POST | `/admin/api/sync-all` | 同步全部渠道模型 |
| GET | `/admin/api/logs` | 请求日志 |
| DELETE | `/admin/api/logs` | 清空日志 |
| GET | `/admin/api/stats` | 统计概览 |
| POST | `/admin/api/init` | 初始化/迁移数据库 |

## 本地开发

```bash
npm install
cp wrangler.toml.example wrangler.toml
# 编辑 wrangler.toml 填入配置
npm run dev
```

本地开发服务器默认监听 `http://localhost:8787`。

## License

MIT
