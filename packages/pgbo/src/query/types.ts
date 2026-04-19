// Shared query types — Phase 2

/** Common interface for executing queries (used by both Database and TransactionClient) */
export interface Queryable {
  query<T extends Record<string, unknown> = Record<string, unknown>>(
    sql: string,
    params?: unknown[],
  ): Promise<T[]>
}
