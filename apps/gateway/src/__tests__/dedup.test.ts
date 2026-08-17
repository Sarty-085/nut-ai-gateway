import { describe, expect, it, vi } from 'vitest'
import { RequestDeduplicator } from '../dedup.js'

describe('RequestDeduplicator', () => {
  it('shares in-flight promise when identical request arrives during execution', async () => {
    const dedup = new RequestDeduplicator(5000)
    let callCount = 0

    const heavyOperation = vi.fn().mockImplementation(async () => {
      callCount++
      await new Promise((res) => setTimeout(res, 50))
      return { result: 'meal-parsed', count: callCount }
    })

    const key = dedup.generateKey('food-analysis', { image: 'test-base64' })

    // Fire 3 simultaneous calls with same payload
    const [r1, r2, r3] = await Promise.all([
      dedup.executeOrShare(key, heavyOperation),
      dedup.executeOrShare(key, heavyOperation),
      dedup.executeOrShare(key, heavyOperation),
    ])

    expect(heavyOperation).toHaveBeenCalledTimes(1)
    expect(r1).toEqual({ result: 'meal-parsed', count: 1 })
    expect(r2).toEqual({ result: 'meal-parsed', count: 1 })
    expect(r3).toEqual({ result: 'meal-parsed', count: 1 })
  })

  it('returns cached result within deduplication window', async () => {
    const dedup = new RequestDeduplicator(5000)
    const op = vi.fn().mockResolvedValue('ok')
    const key = 'test-key'
    const now = Date.now()

    await dedup.executeOrShare(key, op, now)
    expect(op).toHaveBeenCalledTimes(1)

    // Call again 2 seconds later (within window)
    const second = await dedup.executeOrShare(key, op, now + 2000)
    expect(second).toBe('ok')
    expect(op).toHaveBeenCalledTimes(1)

    // Call again 6 seconds later (outside 5000ms window)
    await dedup.executeOrShare(key, op, now + 6000)
    expect(op).toHaveBeenCalledTimes(2)
  })
})
