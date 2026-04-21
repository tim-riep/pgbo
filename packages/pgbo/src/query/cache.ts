// Pluggable cache layer (issue #8)
//
// The CacheProvider interface is the extension point. pgbo ships one default
// implementation — an in-process LRU with per-entry TTL. Redis or other
// distributed backends live in app code: write ~30 LOC against this interface.

export interface CacheProvider {
  /** Returns the cached value, or undefined on miss / expired. */
  get<T>(key: string): Promise<T | undefined>
  /**
   * Stores `value` under `key` with the given tags.
   * `ttlSeconds` overrides the provider's default TTL. Pass 0 or undefined for the provider default.
   */
  set<T>(key: string, value: T, tags: readonly string[], ttlSeconds?: number): Promise<void>
  /** Evicts every entry whose tag set intersects `tags`. */
  invalidateByTags(tags: readonly string[]): Promise<void>
  /** Evicts a single entry. */
  invalidateByKey(key: string): Promise<void>
  /** Optional — wipe everything (mainly for tests). */
  clear?(): Promise<void>
}

export interface MemoryCacheOptions {
  /** Maximum number of entries. When exceeded, the oldest inserted entry is evicted. */
  maxEntries?: number
  /** Default TTL in seconds, applied when set() is called without an explicit ttl. 0 = no expiry. */
  defaultTtl?: number
}

interface Entry {
  value: unknown
  expiresAt: number | undefined
  tags: Set<string>
}

/**
 * In-process cache: Map-based with insertion-order LRU eviction and per-entry TTL.
 * Not shared across processes — use a Redis adapter for multi-node setups.
 */
export function memoryCache(options: MemoryCacheOptions = {}): CacheProvider {
  const maxEntries = options.maxEntries ?? 1000
  const defaultTtl = options.defaultTtl ?? 0
  const entries = new Map<string, Entry>()

  function isExpired(entry: Entry): boolean {
    return entry.expiresAt !== undefined && entry.expiresAt <= Date.now()
  }

  function evictOldestIfFull(): void {
    while (entries.size >= maxEntries) {
      const oldest = entries.keys().next().value
      if (oldest === undefined) break
      entries.delete(oldest)
    }
  }

  return {
    async get<T>(key: string): Promise<T | undefined> {
      const entry = entries.get(key)
      if (!entry) return undefined
      if (isExpired(entry)) {
        entries.delete(key)
        return undefined
      }
      // Refresh insertion order for LRU-ish behavior
      entries.delete(key)
      entries.set(key, entry)
      return entry.value as T
    },

    async set<T>(key: string, value: T, tags: readonly string[], ttlSeconds?: number): Promise<void> {
      if (entries.has(key)) entries.delete(key)
      else evictOldestIfFull()
      const ttl = ttlSeconds ?? defaultTtl
      entries.set(key, {
        value,
        expiresAt: ttl > 0 ? Date.now() + ttl * 1000 : undefined,
        tags: new Set(tags),
      })
    },

    async invalidateByTags(tags: readonly string[]): Promise<void> {
      if (tags.length === 0) return
      const tagSet = new Set(tags)
      for (const [key, entry] of entries) {
        for (const tag of entry.tags) {
          if (tagSet.has(tag)) {
            entries.delete(key)
            break
          }
        }
      }
    },

    async invalidateByKey(key: string): Promise<void> {
      entries.delete(key)
    },

    async clear(): Promise<void> {
      entries.clear()
    },
  }
}

/**
 * Stable cache-key derivation from a prepared query. Includes the full SQL text
 * + bound param values so different WHEREs / sorts / limits don't collide.
 */
export function deriveCacheKey(prefix: string, sqlText: string, values: readonly unknown[]): string {
  // JSON.stringify is fine here — keys are not security-sensitive
  return `${prefix}:${sqlText}|${JSON.stringify(values)}`
}
