/** Types for scripts/health-import.mjs, so the core tests can run the real script code. */
export interface HealthImportData {
  kind: 'tide-health-import'
  version: 1
  flow: Array<{ date: string; flow: 'spotting' | 'light' | 'medium' | 'heavy' | 'unspecified' }>
  contraceptives: Array<{ method: string; startedOn: string; endedOn: string | null }>
}
export const ITERATIONS: number
export function collectHealth(lines: Iterable<string> | AsyncIterable<string>): Promise<HealthImportData>
export function sealHealthImport(data: unknown, password: string, iterations?: number): Promise<Uint8Array<ArrayBuffer>>
