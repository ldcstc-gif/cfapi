import { Hono } from 'hono'
import { cors } from 'hono/cors'
import type { Env } from './types'
import { proxy } from './proxy'
import { admin, handleScheduled } from './admin'

const app = new Hono<{ Bindings: Env }>()

app.use('*', cors({
  origin: '*',
  allowMethods: ['GET', 'POST', 'PUT', 'DELETE', 'PATCH', 'OPTIONS'],
  allowHeaders: ['Authorization', 'Content-Type'],
}))

app.route('/admin', admin)
app.route('/', proxy)

app.get('/', (c) => c.json({ service: 'api-router', version: '1.1.0' }))

export default {
  fetch: app.fetch,
  async scheduled(event: ScheduledEvent, env: Env, ctx: ExecutionContext) {
    ctx.waitUntil(handleScheduled(env))
  },
}
