import { Hono } from 'hono'
import { cors } from 'hono/cors'
import { logger } from 'hono/logger'
import { RelayPool } from './relay-pool'
import { database } from './database'
import { sendPushNotification } from './ntfy'

const app = new Hono()

// Middleware
app.use('*', cors())
app.use('*', logger())

// Initialize services
const relayPool = new RelayPool()

// Restore subscriptions from database on startup
async function restoreSubscriptions() {
  const subs = database.getAllSubscriptions()
  console.log(`[Startup] Restoring ${subs.length} subscriptions...`)

  for (const sub of subs) {
    try {
      await relayPool.subscribeForUser(sub.npub, sub.relays, async () => {
        await sendPushNotification(sub.ntfyTopic, {
          title: 'Seal',
          message: 'New encrypted message',
          priority: 'high'
        })
      })
    } catch (error) {
      console.error(`[Startup] Failed to restore ${sub.npub.slice(0, 12)}...`, error)
    }
  }
}

restoreSubscriptions()

// Health check
app.get('/', (c) => {
  const stats = database.getStats()
  return c.json({
    service: 'seal-push-server',
    version: '0.1.0',
    status: 'ok',
    subscriptions: stats.subscriptions,
    connectedRelays: relayPool.connectedCount()
  })
})

app.get('/health', (c) => {
  return c.json({ status: 'ok' })
})

// Subscribe to push notifications
app.post('/subscribe', async (c) => {
  try {
    const body = await c.req.json()
    const { npub, relays, ntfy_topic } = body

    if (!npub || !ntfy_topic) {
      return c.json({ error: 'npub and ntfy_topic are required' }, 400)
    }

    // Validate npub format
    if (!npub.startsWith('npub1') || npub.length !== 63) {
      return c.json({ error: 'Invalid npub format' }, 400)
    }

    // Use provided relays or defaults
    const relayUrls = relays?.length > 0
      ? relays
      : (process.env.DEFAULT_RELAYS?.split(',') || ['wss://relay.damus.io'])

    // Save subscription to database
    database.saveSubscription(npub, relayUrls, ntfy_topic)

    // Start listening on relays
    await relayPool.subscribeForUser(npub, relayUrls, async (event) => {
      console.log(`[Push] New message for ${npub.slice(0, 12)}...`)
      await sendPushNotification(ntfy_topic, {
        title: 'Seal',
        message: 'New encrypted message',
        priority: 'high',
        click: 'https://seal.dev' // Could be deep link
      })
    })

    console.log(`[Subscribe] ${npub.slice(0, 12)}... subscribed to ${relayUrls.length} relays`)

    return c.json({
      success: true,
      subscription: {
        npub: npub.slice(0, 12) + '...',
        relays: relayUrls.length,
        ntfyTopic: ntfy_topic
      }
    })
  } catch (error) {
    console.error('[Subscribe] Error:', error)
    return c.json({ error: 'Failed to subscribe' }, 500)
  }
})

// Unsubscribe from push notifications
app.post('/unsubscribe', async (c) => {
  try {
    const body = await c.req.json()
    const { npub } = body

    if (!npub) {
      return c.json({ error: 'npub is required' }, 400)
    }

    database.removeSubscription(npub)
    relayPool.unsubscribeUser(npub)

    console.log(`[Unsubscribe] ${npub.slice(0, 12)}... unsubscribed`)

    return c.json({ success: true })
  } catch (error) {
    console.error('[Unsubscribe] Error:', error)
    return c.json({ error: 'Failed to unsubscribe' }, 500)
  }
})

// Stats endpoint (optional auth)
app.get('/stats', (c) => {
  const apiKey = c.req.header('X-API-Key')
  const expectedKey = process.env.API_KEY

  if (expectedKey && apiKey !== expectedKey) {
    return c.json({ error: 'Unauthorized' }, 401)
  }

  const stats = database.getStats()
  return c.json({
    subscriptions: stats.subscriptions,
    processedEvents: stats.processedEvents,
    connectedRelays: relayPool.connectedCount(),
    uptime: process.uptime()
  })
})

// Start server
const port = parseInt(process.env.PORT || '3000')
const host = process.env.HOST || '0.0.0.0'

console.log(`
  ___  ___  __ _| |  _ __  _   _ ___| |__
 / __|/ _ \\/ _\` | | | '_ \\| | | / __| '_ \\
 \\__ \\  __/ (_| | | | |_) | |_| \\__ \\ | | |
 |___/\\___|\\__,_|_| | .__/ \\__,_|___/_| |_|
                    |_|
  Seal Push Server v0.1.0
  Listening on http://${host}:${port}
`)

export default {
  port,
  hostname: host,
  fetch: app.fetch
}