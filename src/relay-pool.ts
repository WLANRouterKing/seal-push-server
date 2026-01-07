// Bun has native WebSocket support, no polyfill needed
import { SimplePool, type Event, type Filter } from 'nostr-tools'
import { nip19 } from 'nostr-tools'
import { database } from './database'
import { verifyPoW, getEventDifficulty, POW_THRESHOLD } from './pow'

type MessageHandler = (event: Event) => Promise<void>

interface UserSubscription {
  npub: string
  pubkey: string
  relays: string[]
  handler: MessageHandler
  subId?: string
}

export class RelayPool {
  private pool: SimplePool
  private userSubscriptions: Map<string, UserSubscription> = new Map()
  private connectedRelays: Set<string> = new Set()

  constructor() {
    this.pool = new SimplePool()
  }

  async subscribeForUser(
    npub: string,
    relays: string[],
    onMessage: MessageHandler
  ): Promise<void> {
    // Decode npub to pubkey
    let pubkey: string
    try {
      const decoded = nip19.decode(npub)
      if (decoded.type !== 'npub') {
        throw new Error('Invalid npub')
      }
      pubkey = decoded.data
    } catch (error) {
      console.error(`[RelayPool] Failed to decode npub: ${npub}`)
      throw error
    }

    // Remove existing subscription if any
    this.unsubscribeUser(npub)

    // Store subscription info
    const subscription: UserSubscription = {
      npub,
      pubkey,
      relays,
      handler: onMessage
    }
    this.userSubscriptions.set(npub, subscription)

    // Subscribe to Gift-Wrap events (kind 1059) for this pubkey
    // Gift-wraps are addressed to the recipient's pubkey in the 'p' tag
    const filter = {
      kinds: [1059],
      '#p': [pubkey],
      since: Math.floor(Date.now() / 1000)
    } as Filter

    console.log(`[RelayPool] Filter for ${npub.slice(0, 12)}...:`, JSON.stringify(filter))

    const sub = this.pool.subscribeMany(
      relays,
      filter,
      {
        onevent: async (event: Event) => {
          // Check if already processed (deduplication)
          if (database.isEventProcessed(event.id)) {
            console.log(`[RelayPool] Skipping duplicate event ${event.id.slice(0, 8)}...`)
            return
          }

          // Check Proof of Work (NIP-13)
          const difficulty = getEventDifficulty(event)
          if (difficulty < POW_THRESHOLD.MINIMUM) {
            console.log(`[RelayPool] Rejecting event ${event.id.slice(0, 8)}... - PoW too low (${difficulty} < ${POW_THRESHOLD.MINIMUM})`)
            return
          }

          const isTrusted = difficulty >= POW_THRESHOLD.TRUSTED
          console.log(`[RelayPool] Gift-wrap received for ${npub.slice(0, 12)}... (PoW: ${difficulty}, trusted: ${isTrusted})`)

          // Mark as processed BEFORE handling to prevent race conditions
          database.markEventProcessed(event.id, npub)

          // TODO: Apply stricter rate limits for non-trusted events
          try {
            await onMessage(event)
          } catch (error) {
            console.error('[RelayPool] Handler error:', error)
          }
        },
        oneose: () => {
          console.log(`[RelayPool] Subscription EOSE for ${npub.slice(0, 12)}...`)
        },
        onclose: (reasons: string[]) => {
          console.log(`[RelayPool] Subscription closed for ${npub.slice(0, 12)}...: ${reasons.join(', ')}`)
        }
      }
    )

    // Track connected relays
    relays.forEach(relay => this.connectedRelays.add(relay))

    console.log(`[RelayPool] Subscribed ${npub.slice(0, 12)}... to ${relays.length} relays`)
  }

  unsubscribeUser(npub: string): void {
    const subscription = this.userSubscriptions.get(npub)
    if (subscription) {
      this.userSubscriptions.delete(npub)
      console.log(`[RelayPool] Unsubscribed ${npub.slice(0, 12)}...`)
    }
  }

  connectedCount(): number {
    return this.connectedRelays.size
  }

  getStats(): { users: number; relays: number } {
    return {
      users: this.userSubscriptions.size,
      relays: this.connectedRelays.size
    }
  }

  async close(): Promise<void> {
    this.pool.close(Array.from(this.connectedRelays))
    this.userSubscriptions.clear()
    this.connectedRelays.clear()
  }
}
