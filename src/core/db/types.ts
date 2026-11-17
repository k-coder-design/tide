/**
 * The database interface the core uses (domain, migrations) — the same shape as in Recallo,
 * a subset of the better-sqlite3 API. SQLite WebAssembly implements it (`wasm.ts`);
 * the core depends only on this interface.
 */
export interface RunResult {
  changes: number
}

export interface Statement {
  /** The first result row or undefined; in pluck mode — the value of the first column. */
  get(...params: unknown[]): unknown
  all(...params: unknown[]): unknown[]
  run(...params: unknown[]): RunResult
  /** Return only the first column (as in better-sqlite3); pluck(false) turns the mode off. */
  pluck(toggle?: boolean): Statement
}

export interface Db {
  prepare(sql: string): Statement
  /** A function that runs fn in a transaction; a nested call is a savepoint (SAVEPOINT). */
  transaction<A extends unknown[], R>(fn: (...args: A) => R): (...args: A) => R
  pragma(source: string, options?: { simple?: boolean }): unknown
  exec(sql: string): unknown
}
