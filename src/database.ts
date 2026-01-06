import { Database } from 'bun:sqlite'

const DB_PATH = process.env.DB_PATH || './data/seal-push.db'

// Ensure data directory exists
import { mkdirSync } from 'fs'
import { dirname } from 'path'
try {
  mkdirSync(dirname(DB_PATH), { recursive: true })
} catch {}

const db = new Database(DB_PATH)

// Initialize tables
db.run(`
  CREATE TABLE IF NOT EXISTS processed_events (
    event_id TEXT PRIMARY KEY,
    npub TEXT NOT NULL,
    processed_at INTEGER NOT NULL
  )
`)

db.run(`
  CREATE TABLE IF NOT EXISTS subscriptions (
    npub TEXT PRIMARY KEY,
    relays TEXT NOT NULL,
    ntfy_topic TEXT NOT NULL,
    created_at INTEGER NOT NULL
  )
`)

// Create indexes
db.run(`CREATE INDEX IF NOT EXISTS idx_processed_npub ON processed_events(npub)`)
db.run(`CREATE INDEX IF NOT EXISTS idx_processed_at ON processed_events(processed_at)`)

export const database = {
  // Check if event was already processed
  isEventProcessed(eventId: string): boolean {
    const row = db.query('SELECT 1 FROM processed_events WHERE event_id = ?').get(eventId)
    return !!row
  },

  // Mark event as processed
  markEventProcessed(eventId: string, npub: string): void {
    db.run(
      'INSERT OR IGNORE INTO processed_events (event_id, npub, processed_at) VALUES (?, ?, ?)',
      [eventId, npub, Date.now()]
    )
  },

  // Clean up old processed events (older than 7 days)
  cleanupOldEvents(): number {
    const cutoff = Date.now() - (7 * 24 * 60 * 60 * 1000)
    const result = db.run('DELETE FROM processed_events WHERE processed_at < ?', [cutoff])
    return result.changes
  },

  // Save subscription
  saveSubscription(npub: string, relays: string[], ntfyTopic: string): void {
    db.run(
      `INSERT OR REPLACE INTO subscriptions (npub, relays, ntfy_topic, created_at)
       VALUES (?, ?, ?, ?)`,
      [npub, JSON.stringify(relays), ntfyTopic, Date.now()]
    )
  },

  // Remove subscription
  removeSubscription(npub: string): boolean {
    const result = db.run('DELETE FROM subscriptions WHERE npub = ?', [npub])
    // Also clean up processed events for this npub
    db.run('DELETE FROM processed_events WHERE npub = ?', [npub])
    return result.changes > 0
  },

  // Get all subscriptions
  getAllSubscriptions(): Array<{ npub: string; relays: string[]; ntfyTopic: string }> {
    const rows = db.query('SELECT npub, relays, ntfy_topic FROM subscriptions').all() as Array<{
      npub: string
      relays: string
      ntfy_topic: string
    }>
    return rows.map(row => ({
      npub: row.npub,
      relays: JSON.parse(row.relays),
      ntfyTopic: row.ntfy_topic
    }))
  },

  // Get subscription by npub
  getSubscription(npub: string): { relays: string[]; ntfyTopic: string } | null {
    const row = db.query('SELECT relays, ntfy_topic FROM subscriptions WHERE npub = ?').get(npub) as {
      relays: string
      ntfy_topic: string
    } | null
    if (!row) return null
    return {
      relays: JSON.parse(row.relays),
      ntfyTopic: row.ntfy_topic
    }
  },

  // Stats
  getStats(): { subscriptions: number; processedEvents: number } {
    const subs = db.query('SELECT COUNT(*) as count FROM subscriptions').get() as { count: number }
    const events = db.query('SELECT COUNT(*) as count FROM processed_events').get() as { count: number }
    return {
      subscriptions: subs.count,
      processedEvents: events.count
    }
  },

  // Close database
  close(): void {
    db.close()
  }
}

// Cleanup old events every hour
setInterval(() => {
  const deleted = database.cleanupOldEvents()
  if (deleted > 0) {
    console.log(`[Database] Cleaned up ${deleted} old processed events`)
  }
}, 60 * 60 * 1000)

console.log(`[Database] Initialized at ${DB_PATH}`)
