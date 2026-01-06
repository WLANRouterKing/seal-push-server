// NIP-13: Proof of Work verification
import type { Event } from 'nostr-tools'

/**
 * Count leading zero bits in an event ID (hex string)
 */
export function countLeadingZeroBits(hex: string): number {
  let count = 0
  for (const char of hex) {
    const nibble = parseInt(char, 16)
    if (nibble === 0) {
      count += 4
    } else {
      count += Math.clz32(nibble) - 28
      break
    }
  }
  return count
}

/**
 * Check if an event meets the minimum PoW difficulty
 */
export function verifyPoW(event: Event, minDifficulty: number): boolean {
  const difficulty = countLeadingZeroBits(event.id)
  return difficulty >= minDifficulty
}

/**
 * Get the PoW difficulty of an event
 */
export function getEventDifficulty(event: Event): number {
  return countLeadingZeroBits(event.id)
}

/**
 * Get the target difficulty from an event's nonce tag
 */
export function getTargetDifficulty(event: Event): number | null {
  const nonceTag = event.tags.find(t => t[0] === 'nonce')
  if (!nonceTag || nonceTag.length < 3) return null
  return parseInt(nonceTag[2], 10)
}

// Difficulty thresholds
export const POW_THRESHOLD = {
  TRUSTED: 16,      // Events with this PoW get no rate limiting
  MINIMUM: 8,       // Events below this are always rejected
} as const
