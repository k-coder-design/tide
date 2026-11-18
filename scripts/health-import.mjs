#!/usr/bin/env node
/**
 * One-time import from Apple Health (T12, T27), run on the Mac:
 *
 *   npm run health-import -- ~/Downloads/export.zip
 *
 * Reads export.xml from the Health export (the zip, an unzipped folder or the XML itself), keeps only menstrual flow,
 * intermenstrual bleeding (spotting) and contraceptive courses, and writes a small file encrypted with a password you
 * choose: `tide-health-YYYY-MM-DD.tidehealth`, next to the export. Send it to the iPhone (AirDrop → Save to Files) and
 * import it in Tide: Settings → Import from Apple Health…, with the same password.
 *
 * Nothing is sent anywhere; the script prints only counts. Never commit the export or the import file.
 * The file layout matches src/core/storage/backup.ts: "TIDH" · format 1 · PBKDF2 iterations (uint32) · salt (16)
 * — authenticated as additional data — · IV (12) · AES-GCM ciphertext of the JSON below.
 */
import { spawn } from 'node:child_process'
import { createReadStream, existsSync, statSync, writeFileSync } from 'node:fs'
import { dirname, join, resolve } from 'node:path'
import { createInterface } from 'node:readline'
import { fileURLToPath } from 'node:url'

export const ITERATIONS = 600_000
const MAGIC = [0x54, 0x49, 0x44, 0x48] // "TIDH"
const PASSWORD_MIN = 8

const FLOW = {
  HKCategoryValueVaginalBleedingLight: 'light',
  HKCategoryValueVaginalBleedingMedium: 'medium',
  HKCategoryValueVaginalBleedingHeavy: 'heavy',
  HKCategoryValueVaginalBleedingUnspecified: 'unspecified',
  // Older exports
  HKCategoryValueMenstrualFlowLight: 'light',
  HKCategoryValueMenstrualFlowMedium: 'medium',
  HKCategoryValueMenstrualFlowHeavy: 'heavy',
  HKCategoryValueMenstrualFlowUnspecified: 'unspecified'
}
/** When a day has several records the stronger flow wins (docs/DATA_MODEL.md). */
const STRENGTH = { spotting: 1, unspecified: 2, light: 3, medium: 4, heavy: 5 }

const attribute = (line, name) => line.match(new RegExp(`\\s${name}="([^"]*)"`))?.[1]
/** "2026-11-17 12:00:00 +0100" → "2026-11-17": Health writes local times, so the date part is the local day. */
const day = (value) => (value && /^\d{4}-\d{2}-\d{2}/.test(value) ? value.slice(0, 10) : null)

/**
 * The Tide import data from the lines of export.xml. Each <Record …> opening tag is on one line.
 * @param {Iterable<string> | AsyncIterable<string>} lines
 */
export async function collectHealth(lines) {
  const flow = new Map()
  const courses = new Map()
  for await (const line of lines) {
    if (!line.includes('<Record ')) continue
    const type = attribute(line, 'type')
    if (type === 'HKCategoryTypeIdentifierMenstrualFlow' || type === 'HKCategoryTypeIdentifierIntermenstrualBleeding') {
      const date = day(attribute(line, 'startDate'))
      const value = type === 'HKCategoryTypeIdentifierIntermenstrualBleeding' ? 'spotting' : FLOW[attribute(line, 'value')]
      if (!date || !value) continue // "None" and unknown values are skipped
      const current = flow.get(date)
      if (!current || STRENGTH[value] > STRENGTH[current]) flow.set(date, value)
    } else if (type === 'HKCategoryTypeIdentifierContraceptive') {
      const startedOn = day(attribute(line, 'startDate'))
      const end = day(attribute(line, 'endDate'))
      if (!startedOn) continue
      const method = (attribute(line, 'value') ?? '').replace('HKCategoryValueContraceptive', '') || 'Unspecified'
      // An end in the year 4001 means "still taking".
      const endedOn = !end || end >= '4000' ? null : end
      courses.set(`${startedOn}|${method}`, { method, startedOn, endedOn })
    }
  }
  return {
    kind: 'tide-health-import',
    version: 1,
    flow: [...flow].sort(([a], [b]) => a.localeCompare(b)).map(([date, value]) => ({ date, flow: value })),
    contraceptives: [...courses.values()].sort((a, b) => a.startedOn.localeCompare(b.startedOn))
  }
}

/** Encrypts the import data with the password, in Tide's file layout. */
export async function sealHealthImport(data, password, iterations = ITERATIONS) {
  const salt = crypto.getRandomValues(new Uint8Array(16))
  const base = await crypto.subtle.importKey('raw', new TextEncoder().encode(password), 'PBKDF2', false, ['deriveBits'])
  const raw = await crypto.subtle.deriveBits({ name: 'PBKDF2', hash: 'SHA-256', salt, iterations }, base, 256)
  const key = await crypto.subtle.importKey('raw', raw, { name: 'AES-GCM' }, false, ['encrypt'])
  const header = new Uint8Array(4 + 1 + 4 + 16)
  header.set(MAGIC, 0)
  header[4] = 1
  new DataView(header.buffer).setUint32(5, iterations)
  header.set(salt, 9)
  const iv = crypto.getRandomValues(new Uint8Array(12))
  const plain = new TextEncoder().encode(JSON.stringify(data))
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: 'AES-GCM', iv, additionalData: header }, key, plain))
  const out = new Uint8Array(header.byteLength + iv.byteLength + cipher.byteLength)
  out.set(header, 0)
  out.set(iv, header.byteLength)
  out.set(cipher, header.byteLength + iv.byteLength)
  return out
}

/** export.xml as lines, from export.zip (through macOS unzip), an unzipped folder or the XML file. */
function exportLines(input) {
  if (statSync(input).isDirectory()) {
    const xml = [join(input, 'export.xml'), join(input, 'apple_health_export', 'export.xml')].find(existsSync)
    if (!xml) throw new Error(`No export.xml in ${input}`)
    return createInterface({ input: createReadStream(xml), crlfDelay: Infinity })
  }
  if (input.endsWith('.xml')) return createInterface({ input: createReadStream(input), crlfDelay: Infinity })
  const unzip = spawn('unzip', ['-p', input, 'apple_health_export/export.xml'], { stdio: ['ignore', 'pipe', 'inherit'] })
  return createInterface({ input: unzip.stdout, crlfDelay: Infinity })
}

/** Asks for the password without showing it. */
function askHidden(question) {
  return new Promise((resolvePassword) => {
    const rl = createInterface({ input: process.stdin, output: process.stdout, terminal: true })
    rl._writeToOutput = (text) => {
      if (text.includes(question)) process.stdout.write(text)
    }
    rl.question(question, (answer) => {
      rl.close()
      process.stdout.write('\n')
      resolvePassword(answer)
    })
  })
}

async function main() {
  const input = process.argv[2] ? resolve(process.argv[2].replace(/^~(?=$|\/)/, process.env.HOME ?? '~')) : null
  if (!input || !existsSync(input)) {
    console.error('Usage: npm run health-import -- ~/Downloads/export.zip')
    process.exit(1)
  }
  console.log('Reading the Health export… (a minute for a large one)')
  const data = await collectHealth(exportLines(input))
  const bleeding = data.flow.filter((d) => d.flow !== 'spotting').length
  const spotting = data.flow.length - bleeding
  const count = (n, one, many) => `${n} ${n === 1 ? one : many}`
  console.log(
    `Found ${count(bleeding, 'bleeding day', 'bleeding days')}, ${count(spotting, 'spotting day', 'spotting days')}, ` +
      `${count(data.contraceptives.length, 'contraceptive course', 'contraceptive courses')}.`
  )
  if (data.flow.length === 0 && data.contraceptives.length === 0) {
    console.error('Nothing to import.')
    process.exit(1)
  }

  let password = process.env.TIDE_IMPORT_PASSWORD
  if (!password) {
    console.log(`Choose a password for the import file (${PASSWORD_MIN}+ characters). You will type it in Tide on the iPhone.`)
    password = await askHidden('Password: ')
    if ((await askHidden('Repeat: ')) !== password) {
      console.error('The passwords do not match.')
      process.exit(1)
    }
  }
  if (password.length < PASSWORD_MIN) {
    console.error(`The password needs at least ${PASSWORD_MIN} characters.`)
    process.exit(1)
  }
  const today = new Date().toLocaleDateString('sv') // YYYY-MM-DD, local
  const file = join(statSync(input).isDirectory() ? input : dirname(input), `tide-health-${today}.tidehealth`)
  writeFileSync(file, await sealHealthImport(data, password))
  console.log(`Saved ${file}`)
  console.log('Send it to the iPhone (AirDrop → Save to Files), then in Tide: Settings → Import from Apple Health…')
  console.log('Afterwards delete export.zip and the .tidehealth file from the Mac if you no longer need them.')
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch((error) => {
    console.error(error instanceof Error ? error.message : error)
    process.exit(1)
  })
}
