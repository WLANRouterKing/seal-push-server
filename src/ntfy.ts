interface PushNotification {
  title: string
  message: string
  priority?: 'min' | 'low' | 'default' | 'high' | 'urgent'
  click?: string
  icon?: string
  tags?: string[]
}

interface PushTarget {
  topic?: string      // Legacy: ntfy topic name
  endpoint?: string   // UnifiedPush: full endpoint URL
}

const NTFY_SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh'

export async function sendPushNotification(
  target: string | PushTarget,
  notification: PushNotification
): Promise<boolean> {
  try {
    // Determine the URL: either direct endpoint or topic-based
    let url: string
    if (typeof target === 'string') {
      // Legacy: topic string
      url = `${NTFY_SERVER}/${target}`
    } else if (target.endpoint) {
      // UnifiedPush: direct endpoint URL
      url = target.endpoint
    } else if (target.topic) {
      // Topic-based
      url = `${NTFY_SERVER}/${target.topic}`
    } else {
      console.error('[ntfy] No valid target provided')
      return false
    }

    const headers: Record<string, string> = {
      'Title': notification.title,
      'Priority': notification.priority || 'high',
    }

    if (notification.click) {
      headers['Click'] = notification.click
    }

    if (notification.icon) {
      headers['Icon'] = notification.icon
    }

    if (notification.tags?.length) {
      headers['Tags'] = notification.tags.join(',')
    }

    const response = await fetch(url, {
      method: 'POST',
      headers,
      body: notification.message
    })

    if (!response.ok) {
      console.error(`[ntfy] Failed to send: ${response.status} ${response.statusText}`)
      return false
    }

    const logTarget = typeof target === 'string' ? target : (target.endpoint ? 'endpoint' : target.topic)
    console.log(`[ntfy] Sent notification to: ${logTarget}`)
    return true
  } catch (error) {
    console.error('[ntfy] Error sending notification:', error)
    return false
  }
}

// Rate limiting helper (optional)
const rateLimits: Map<string, number[]> = new Map()
const RATE_LIMIT_WINDOW = 60000 // 1 minute
const RATE_LIMIT_MAX = 10 // max 10 notifications per minute per topic

export function checkRateLimit(topic: string): boolean {
  const now = Date.now()
  const timestamps = rateLimits.get(topic) || []

  // Remove old timestamps
  const recent = timestamps.filter(t => now - t < RATE_LIMIT_WINDOW)

  if (recent.length >= RATE_LIMIT_MAX) {
    console.warn(`[ntfy] Rate limit exceeded for topic: ${topic}`)
    return false
  }

  recent.push(now)
  rateLimits.set(topic, recent)
  return true
}

export async function sendPushWithRateLimit(
  topic: string,
  notification: PushNotification
): Promise<boolean> {
  if (!checkRateLimit(topic)) {
    return false
  }
  return sendPushNotification(topic, notification)
}
