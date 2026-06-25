export class ExpiringCache<T> {
  private readonly entries = new Map<string, { expiresAt: number; value: T }>()
  private readonly now: () => number

  constructor(now: () => number) {
    this.now = now
  }

  read(key: string): T | null {
    const entry = this.entries.get(key)

    if (!entry) {
      return null
    }

    if (entry.expiresAt <= this.now()) {
      this.entries.delete(key)
      return null
    }

    return entry.value
  }

  write(key: string, value: T, ttlMs: number) {
    this.entries.set(key, {
      expiresAt: this.now() + ttlMs,
      value,
    })
  }
}
