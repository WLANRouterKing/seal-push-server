interface PushNotification {
  title: string
  message: string
  priority?: 'min' | 'low' | 'default' | 'high' | 'urgent'
  click?: string
  icon?: string
  tags?: string[]
}

const NTFY_SERVER = process.env.NTFY_SERVER || 'https://ntfy.sh'

export async function sendPushNotification(
  topic: string,
  notification: PushNotification
): Promise<boolean> {
  try {
    const url = `${NTFY_SERVER}/${topic}`

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

    console.log(`[ntfy] Sent notification to topic: ${topic}`)
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
