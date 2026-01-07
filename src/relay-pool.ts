// Direct WebSocket implementation for Nostr relay subscriptions
// SimplePool from nostr-tools doesn't work reliably with Bun
import { nip19, verifyEvent, type Event } from 'nostr-tools'
import { database } from './database'
import { verifyPoW, getEventDifficulty, POW_THRESHOLD } from './pow'

type MessageHandler = (event: Event) => Promise<void>

interface UserSubscription {
  npub: string
  pubkey: string
  relays: string[]
  handler: MessageHandler
  sockets: WebSocket[]
  subId: string
}

export class RelayPool {
  private userSubscriptions: Map<string, UserSubscription> = new Map()
  private connectedRelays: Set<string> = new Set()
  private subCounter = 0

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

    const subId = `seal-${++this.subCounter}`
    const sockets: WebSocket[] = []

    // Subscribe to Gift-Wrap events (kind 1059) for this pubkey
    const filter = {
      kinds: [1059],
      '#p': [pubkey],
      since: Math.floor(Date.now() / 1000)
    }

    console.log(`[RelayPool] Filter for ${npub.slice(0, 12)}...:`, JSON.stringify(filter))
    console.log(`[RelayPool] Connecting to ${relays.length} relays with subId: ${subId}`)

    for (const relayUrl of relays) {
      try {
        const ws = new WebSocket(relayUrl)

        ws.onopen = () => {
          console.log(`[RelayPool] Connected to ${relayUrl}`)
          this.connectedRelays.add(relayUrl)

          // Send REQ
          const req = JSON.stringify(['REQ', subId, filter])
          console.log(`[RelayPool] Sending REQ to ${relayUrl}:`, req)
          ws.send(req)
        }

        ws.onmessage = async (msg) => {
          try {
            const data = JSON.parse(msg.data.toString())

            if (data[0] === 'EVENT' && data[1] === subId) {
              const event = data[2] as Event
              console.log(`[RelayPool] EVENT from ${relayUrl}:`, event.id, event.kind)

              // Verify event
              if (!verifyEvent(event)) {
                console.log(`[RelayPool] Invalid event signature: ${event.id}`)
                return
              }

              // Check if already processed
              if (database.isEventProcessed(event.id)) {
                console.log(`[RelayPool] Skipping duplicate: ${event.id.slice(0, 8)}...`)
                return
              }

              // Check PoW
              const difficulty = getEventDifficulty(event)
              if (difficulty < POW_THRESHOLD.MINIMUM) {
                console.log(`[RelayPool] PoW too low: ${difficulty}`)
                return
              }

              console.log(`[RelayPool] Gift-wrap received for ${npub.slice(0, 12)}... (PoW: ${difficulty})`)
              database.markEventProcessed(event.id, npub)

              try {
                await onMessage(event)
              } catch (error) {
                console.error('[RelayPool] Handler error:', error)
              }
            } else if (data[0] === 'EOSE' && data[1] === subId) {
              console.log(`[RelayPool] EOSE from ${relayUrl}`)
            } else if (data[0] === 'NOTICE') {
              console.log(`[RelayPool] NOTICE from ${relayUrl}: ${data[1]}`)
            } else if (data[0] === 'CLOSED') {
              console.log(`[RelayPool] CLOSED from ${relayUrl}: ${data[2] || 'no reason'}`)
            }
          } catch (e) {
            // Ignore parse errors
          }
        }

        ws.onerror = (error) => {
          console.error(`[RelayPool] Error on ${relayUrl}:`, error)
        }

        ws.onclose = (event) => {
          console.log(`[RelayPool] Disconnected from ${relayUrl}: code=${event.code} reason=${event.reason}`)
          this.connectedRelays.delete(relayUrl)

          // Reconnect after 5 seconds
          setTimeout(() => {
            const sub = this.userSubscriptions.get(npub)
            if (sub) {
              console.log(`[RelayPool] Reconnecting to ${relayUrl}...`)
              this.reconnectRelay(sub, relayUrl)
            }
          }, 5000)
        }

        sockets.push(ws)
      } catch (error) {
        console.error(`[RelayPool] Failed to connect to ${relayUrl}:`, error)
      }
    }

    // Store subscription
    this.userSubscriptions.set(npub, {
      npub,
      pubkey,
      relays,
      handler: onMessage,
      sockets,
      subId
    })

    console.log(`[RelayPool] Subscribed ${npub.slice(0, 12)}... to ${relays.length} relays`)
  }

  private reconnectRelay(sub: UserSubscription, relayUrl: string): void {
    const filter = {
      kinds: [1059],
      '#p': [sub.pubkey],
      since: Math.floor(Date.now() / 1000)
    }

    try {
      const ws = new WebSocket(relayUrl)

      ws.onopen = () => {
        console.log(`[RelayPool] Reconnected to ${relayUrl}`)
        this.connectedRelays.add(relayUrl)
        ws.send(JSON.stringify(['REQ', sub.subId, filter]))
      }

      ws.onmessage = async (msg) => {
        try {
          const data = JSON.parse(msg.data.toString())

          if (data[0] === 'EVENT' && data[1] === sub.subId) {
            const event = data[2] as Event
            console.log(`[RelayPool] EVENT from ${relayUrl}:`, event.id, event.kind)

            if (!verifyEvent(event)) return
            if (database.isEventProcessed(event.id)) return

            const difficulty = getEventDifficulty(event)
            if (difficulty < POW_THRESHOLD.MINIMUM) return

            console.log(`[RelayPool] Gift-wrap received for ${sub.npub.slice(0, 12)}...`)
            database.markEventProcessed(event.id, sub.npub)

            try {
              await sub.handler(event)
            } catch (error) {
              console.error('[RelayPool] Handler error:', error)
            }
          } else if (data[0] === 'EOSE') {
            console.log(`[RelayPool] EOSE from ${relayUrl}`)
          }
        } catch (e) {}
      }

      ws.onclose = () => {
        this.connectedRelays.delete(relayUrl)
        setTimeout(() => {
          if (this.userSubscriptions.has(sub.npub)) {
            this.reconnectRelay(sub, relayUrl)
          }
        }, 5000)
      }

      sub.sockets.push(ws)
    } catch (error) {
      console.error(`[RelayPool] Reconnect failed for ${relayUrl}:`, error)
    }
  }

  unsubscribeUser(npub: string): void {
    const subscription = this.userSubscriptions.get(npub)
    if (subscription) {
      // Close all sockets
      for (const ws of subscription.sockets) {
        try {
          ws.send(JSON.stringify(['CLOSE', subscription.subId]))
          ws.close()
        } catch (e) {}
      }
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
    for (const [npub] of this.userSubscriptions) {
      this.unsubscribeUser(npub)
    }
    this.connectedRelays.clear()
  }
}
