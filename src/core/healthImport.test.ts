import { describe, expect, it } from 'vitest'
import { collectHealth, sealHealthImport } from '../../scripts/health-import.mjs'
import { Session } from './session'
import { loadSqlite, memoryKeys, memorySlots } from './testing'

const PASSWORD = 'import password'

/** Synthetic export.xml lines in Health's format — no real data. */
const record = (type: string, value: string, start: string, end = start) =>
  ` <Record type="HKCategoryTypeIdentifier${type}" sourceName="Health" sourceVersion="26.1" creationDate="${start} 12:00:00 +0100" startDate="${start} 12:00:00 +0100" endDate="${end} 12:00:00 +0100" value="${value}">`

const EXPORT = [
  '<?xml version="1.0" encoding="UTF-8"?>',
  '<HealthData locale="en_GB">',
  record('MenstrualFlow', 'HKCategoryValueVaginalBleedingLight', '2026-10-01'),
  '  <MetadataEntry key="HKMenstrualCycleStart" value="1"/>',
  ' </Record>',
  record('MenstrualFlow', 'HKCategoryValueVaginalBleedingHeavy', '2026-10-01'),
  record('MenstrualFlow', 'HKCategoryValueMenstrualFlowMedium', '2026-10-02'),
  record('MenstrualFlow', 'HKCategoryValueVaginalBleedingUnspecified', '2026-10-03'),
  record('MenstrualFlow', 'HKCategoryValueVaginalBleedingNone', '2026-10-04'),
  record('IntermenstrualBleeding', 'HKCategoryValueNotApplicable', '2026-10-15'),
  record('MenstrualFlow', 'HKCategoryValueVaginalBleedingLight', '2026-10-20'),
  record('SexualActivity', 'HKCategoryValueNotApplicable', '2026-10-21'),
  record('Contraceptive', 'HKCategoryValueContraceptiveOral', '2024-03-01', '2025-01-31'),
  record('Contraceptive', 'HKCategoryValueContraceptiveOral', '2025-02-01', '4001-01-01'),
  '</HealthData>'
]

async function start() {
  const session = await Session.start(await loadSqlite(), memorySlots(), memoryKeys(), { pinIterations: 1000, backupIterations: 1000 })
  return session
}

const flowOf = (session: Session, date: string) =>
  // Read through the core's database the way the check-in will in phase 6.
  (session as unknown as { journal: { memory: { db: { prepare(sql: string): { get(...a: unknown[]): unknown } } } } }).journal.memory.db
    .prepare('SELECT flow, flow_source AS source FROM daily_checkins WHERE date = ?')
    .get(date)

describe('Apple Health import (T12, T27)', () => {
  it('the script keeps only flow, spotting and contraceptive courses; the stronger flow wins; "None" is skipped', async () => {
    const data = await collectHealth(EXPORT)
    expect(data.flow).toEqual([
      { date: '2026-10-01', flow: 'heavy' },
      { date: '2026-10-02', flow: 'medium' },
      { date: '2026-10-03', flow: 'unspecified' },
      { date: '2026-10-15', flow: 'spotting' },
      { date: '2026-10-20', flow: 'light' }
    ])
    expect(data.contraceptives).toEqual([
      { method: 'Oral', startedOn: '2024-03-01', endedOn: '2025-01-31' },
      { method: 'Oral', startedOn: '2025-02-01', endedOn: null }
    ])
  })

  it('the file from the Mac imports into Tide; days already in Tide are kept; importing again changes nothing', async () => {
    const file = await sealHealthImport(await collectHealth(EXPORT), PASSWORD, 1000)
    expect(new TextDecoder().decode(file)).not.toContain('2026-10-01')
    const session = await start()
    session.handlers()['checkins.setDesire']('2026-10-20', 3)
    await expect(session.importHealth(file, 'wrong password')).rejects.toThrow('Wrong password')

    expect(await session.importHealth(file, PASSWORD)).toEqual({ bleedingDays: 4, spottingDays: 1, keptDays: 0, courses: 2, keptCourses: 0 })
    expect(flowOf(session, '2026-10-01')).toEqual({ flow: 'heavy', source: 'health' })
    // A day with only desire gets the flow; the desire stays.
    expect(session.handlers()['journal.day']('2026-10-20').desire).toBe(3)
    expect(flowOf(session, '2026-10-20')).toEqual({ flow: 'light', source: 'health' })

    expect(await session.importHealth(file, PASSWORD)).toEqual({ bleedingDays: 0, spottingDays: 0, keptDays: 5, courses: 0, keptCourses: 2 })
  })

  it('a backup file is not taken for an import file, nor the other way round', async () => {
    const session = await start()
    await session.setBackupPassword(PASSWORD)
    const backup = await session.createBackup()
    await expect(session.importHealth(backup, PASSWORD)).rejects.toThrow('not a Tide import file')
    const file = await sealHealthImport(await collectHealth(EXPORT), PASSWORD, 1000)
    await expect(session.restoreBackup(file, PASSWORD, 'replace')).rejects.toThrow('not a Tide backup')
  })
})
