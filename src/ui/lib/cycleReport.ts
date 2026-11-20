import type { CycleMonth, CycleReport, Flow } from '../../shared/types'
import { cycleDates, cycleNote, flowLabel, SYMPTOM_OPTIONS } from './cycle'
import { A4, buildPdf, type PdfPage } from './pdf'

/** What goes into the report; chosen in the Report sheet (T35). */
export interface ReportParts {
  cycles: boolean
  calendar: boolean
  symptoms: boolean
  pills: boolean
  desire: boolean
}

/** Pixels per point: about 216 dpi, sharp on paper and on screen. */
const SCALE = 3
const MARGIN = 40
const FONT = "'Manrope Variable', -apple-system, system-ui, sans-serif"
/** Fixed light colours: a report is read on paper or white screens whatever the app's theme. */
const C = {
  ink: '#16242B',
  muted: '#56666D',
  faint: '#9AA5A9',
  line: '#E2DED7',
  soft: '#F4F2EE',
  berry: '#933A57',
  ring: '#16242B',
  teal: '#1B6570',
  /** The app's light-theme bleeding colours (T36). */
  flow: { none: '#F4F2EE', spotting: '#AA786F', light: '#F9BCB9', unspecified: '#E48E89', medium: '#CD605A', heavy: '#932B27' } as Record<Flow, string>,
  onFlowPale: '#2A1414'
}

/** Draws the report on canvases, one per A4 page, and wraps them in a PDF. Runs on the phone only. */
export async function cycleReportPdf(report: CycleReport, parts: ReportParts): Promise<Uint8Array> {
  await Promise.all([document.fonts.load(`500 12px ${FONT}`), document.fonts.load(`800 12px ${FONT}`)]).catch(() => undefined)
  const doc = new ReportCanvas()
  drawTitle(doc, report)
  if (parts.cycles) drawCycles(doc, report)
  if (parts.calendar && report.months.length) drawCalendar(doc, report.months)
  if (parts.symptoms) drawSymptoms(doc, report)
  if (parts.pills) drawPills(doc, report)
  if (parts.desire) drawDesire(doc, report)
  const pages = await doc.finish()
  return buildPdf(pages, 'Tide cycle report')
}

class ReportCanvas {
  readonly width = A4.width
  readonly height = A4.height
  private canvases: HTMLCanvasElement[] = []
  ctx!: CanvasRenderingContext2D
  y = MARGIN

  constructor() {
    this.addPage()
  }

  get bottom(): number {
    return this.height - MARGIN - 18
  }

  addPage(): void {
    const canvas = document.createElement('canvas')
    canvas.width = Math.round(this.width * SCALE)
    canvas.height = Math.round(this.height * SCALE)
    const ctx = canvas.getContext('2d')
    if (!ctx) throw new Error('This phone could not draw the report')
    ctx.scale(SCALE, SCALE)
    ctx.fillStyle = '#FFFFFF'
    ctx.fillRect(0, 0, this.width, this.height)
    ctx.textBaseline = 'alphabetic'
    this.canvases.push(canvas)
    this.ctx = ctx
    this.y = MARGIN
  }

  /** Starts a new page unless `height` more points fit on this one. */
  need(height: number): void {
    if (this.y + height > this.bottom) this.addPage()
  }

  text(value: string, x: number, y: number, o: { size?: number; weight?: number; color?: string; align?: CanvasTextAlign; maxWidth?: number } = {}): void {
    const ctx = this.ctx
    ctx.font = `${o.weight ?? 500} ${o.size ?? 10}px ${FONT}`
    ctx.fillStyle = o.color ?? C.ink
    ctx.textAlign = o.align ?? 'left'
    let shown = value
    if (o.maxWidth) while (shown.length > 1 && ctx.measureText(shown).width > o.maxWidth) shown = `${shown.slice(0, -2)}…`
    ctx.fillText(shown, x, y)
  }

  rect(x: number, y: number, w: number, h: number, fill: string, radius = 0): void {
    this.ctx.fillStyle = fill
    this.ctx.beginPath()
    this.ctx.roundRect(x, y, w, h, radius)
    this.ctx.fill()
  }

  stroke(x: number, y: number, w: number, h: number, color: string, width: number, radius = 0): void {
    this.ctx.strokeStyle = color
    this.ctx.lineWidth = width
    this.ctx.beginPath()
    this.ctx.roundRect(x, y, w, h, radius)
    this.ctx.stroke()
  }

  rule(y: number, color = C.line): void {
    this.rect(MARGIN, y, this.width - MARGIN * 2, 0.6, color)
  }

  heading(title: string, note?: string): void {
    this.need(60)
    // More air between sections than at the top of a page.
    this.y += this.y <= MARGIN ? 18 : 30
    this.text(title, MARGIN, this.y, { size: 14, weight: 800 })
    if (note) this.text(note, this.width - MARGIN, this.y, { size: 9, color: C.muted, align: 'right' })
    this.y += 10
  }

  async finish(): Promise<PdfPage[]> {
    const total = this.canvases.length
    const pages: PdfPage[] = []
    for (const [i, canvas] of this.canvases.entries()) {
      const ctx = canvas.getContext('2d')!
      this.ctx = ctx
      this.text('Tide · facts as recorded on this iPhone · no predictions or medical advice', MARGIN, this.height - MARGIN + 6, { size: 8, color: C.faint })
      this.text(`${i + 1} / ${total}`, this.width - MARGIN, this.height - MARGIN + 6, { size: 8, color: C.faint, align: 'right' })
      const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, 'image/jpeg', 0.9))
      if (!blob) throw new Error('This phone could not draw the report')
      pages.push({ jpeg: new Uint8Array(await blob.arrayBuffer()), pixelWidth: canvas.width, pixelHeight: canvas.height })
    }
    return pages
  }
}

function drawTitle(doc: ReportCanvas, r: CycleReport): void {
  doc.y += 14
  doc.text('Cycle report', MARGIN, doc.y, { size: 24, weight: 800 })
  doc.y += 18
  doc.text(`${dateLong(r.from)} – ${dateLong(r.to)} · made on ${dateLong(r.madeOn)} in Tide`, MARGIN, doc.y, { size: 10, color: C.muted })
  doc.y += 22
  const facts = [
    `${r.cycles.length} ${r.cycles.length === 1 ? 'cycle' : 'cycles'}`,
    r.averageBleeding !== null ? `Bleeding ${days(r.averageBleeding)} on average` : null,
    r.averageCycle !== null ? `Cycle ${days(r.averageCycle)} on average${r.cycleRange && r.cycleRange.min !== r.cycleRange.max ? ` (${r.cycleRange.min}–${r.cycleRange.max})` : ''}` : null
  ].filter(Boolean)
  doc.rect(MARGIN, doc.y - 14, doc.width - MARGIN * 2, 26, C.soft, 8)
  doc.text(facts.join('   ·   '), MARGIN + 12, doc.y + 3, { size: 11, weight: 700 })
  doc.y += 22
}

function drawCycles(doc: ReportCanvas, r: CycleReport): void {
  doc.heading('Menstrual cycles', 'A cycle runs from the first bleeding day to the day before the next one')
  const right = doc.width - MARGIN
  const head = () => {
    doc.y += 14
    doc.text('CYCLE', MARGIN + 20, doc.y, { size: 8, weight: 800, color: C.muted })
    doc.text('BLEEDING', right - 70, doc.y, { size: 8, weight: 800, color: C.muted, align: 'right' })
    doc.text('LENGTH', right, doc.y, { size: 8, weight: 800, color: C.muted, align: 'right' })
    doc.y += 6
  }
  head()
  if (r.cycles.length === 0) {
    doc.y += 16
    doc.text('No cycle started in this period.', MARGIN, doc.y, { size: 10, color: C.muted })
    doc.y += 8
    return
  }
  for (const c of r.cycles) {
    if (doc.y + 30 > doc.bottom) {
      doc.addPage()
      head()
    }
    doc.rule(doc.y)
    doc.rect(MARGIN, doc.y + 8, 12, 12, C.flow[c.strongest], 3)
    doc.text(cycleDates(c), MARGIN + 20, doc.y + 15, { size: 11, weight: 700 })
    doc.text(cycleNote(c), MARGIN + 20, doc.y + 26, { size: 8, color: C.muted, maxWidth: right - 120 - MARGIN })
    doc.text(`${c.bleedingDays}${c.bleedingOngoing ? '+' : ''} d`, right - 70, doc.y + 18, { size: 11, weight: 700, align: 'right' })
    doc.text(`${c.length}${c.end === null ? '+' : ''} d`, right, doc.y + 18, { size: 11, weight: 700, align: 'right' })
    doc.y += 32
  }
  doc.rule(doc.y)
  doc.y += 6
}

function drawCalendar(doc: ReportCanvas, months: CycleMonth[]): void {
  doc.heading('Bleeding calendar', 'Ring — first day of a cycle')
  const columns = 3
  const gap = 18
  const boxWidth = (doc.width - MARGIN * 2 - gap * (columns - 1)) / columns
  const cell = boxWidth / 7
  const boxHeight = 22 + cell * 6 + 14
  for (let row = 0; row < months.length; row += columns) {
    doc.need(boxHeight + 10)
    const top = doc.y + 8
    months.slice(row, row + columns).forEach((m, i) => {
      const x0 = MARGIN + i * (boxWidth + gap)
      doc.text(monthTitle(m.month), x0, top + 10, { size: 10, weight: 800 })
      doc.text(`${m.bleedingDays} bleeding${m.spottingDays ? ` · ${m.spottingDays} spotting` : ''}`, x0 + boxWidth, top + 10, { size: 7, color: C.muted, align: 'right' })
      const blanks = (new Date(`${m.month}-01T00:00:00Z`).getUTCDay() + 6) % 7
      m.days.forEach((d, k) => {
        const slot = blanks + k
        const cx = x0 + (slot % 7) * cell
        const cy = top + 18 + Math.floor(slot / 7) * cell
        if (d.flow && d.flow !== 'none') doc.rect(cx + 1, cy + 1, cell - 2, cell - 2, C.flow[d.flow], 3)
        if (d.startsCycle) doc.stroke(cx + 1.6, cy + 1.6, cell - 3.2, cell - 3.2, C.ring, 1.2, 3)
        const fg = d.flow === 'medium' || d.flow === 'heavy' || d.flow === 'spotting' ? '#FFFFFF' : d.flow === 'light' || d.flow === 'unspecified' ? C.onFlowPale : C.ink
        doc.text(String(k + 1), cx + cell / 2, cy + cell / 2 + 3, { size: 7.5, weight: d.startsCycle ? 800 : 600, color: fg, align: 'center' })
      })
    })
    doc.y = top + boxHeight
  }
  doc.need(20)
  doc.y += 6
  let x = MARGIN
  for (const flow of ['spotting', 'light', 'medium', 'heavy'] as const) {
    doc.rect(x, doc.y - 7, 9, 9, C.flow[flow], 2)
    doc.text(flowLabel(flow), x + 13, doc.y + 1, { size: 8, color: C.muted })
    x += 62
  }
  doc.y += 10
}

function drawSymptoms(doc: ReportCanvas, r: CycleReport): void {
  doc.heading('Symptoms', 'Days each one was recorded')
  if (r.symptoms.length === 0) {
    doc.y += 16
    doc.text('No symptoms recorded in this period.', MARGIN, doc.y, { size: 10, color: C.muted })
    doc.y += 6
    return
  }
  const max = Math.max(...r.symptoms.map((s) => s.days))
  const barLeft = MARGIN + 130
  const barWidth = doc.width - MARGIN - barLeft - 40
  for (const s of r.symptoms) {
    doc.need(20)
    doc.y += 18
    doc.text(SYMPTOM_OPTIONS.find((o) => o.value === s.tag)?.label ?? s.tag, MARGIN, doc.y, { size: 10, weight: 600 })
    doc.rect(barLeft, doc.y - 8, Math.max(3, (s.days / max) * barWidth), 9, C.flow.light, 3)
    doc.text(days(s.days), doc.width - MARGIN, doc.y, { size: 10, weight: 700, align: 'right' })
  }
  doc.y += 6
}

function drawPills(doc: ReportCanvas, r: CycleReport): void {
  doc.heading('Pills', 'Doses logged in Tide, against the allowed delay set for each course')
  if (r.pills.length === 0) {
    doc.y += 16
    doc.text('No tracked course in this period.', MARGIN, doc.y, { size: 10, color: C.muted })
    doc.y += 6
    return
  }
  for (const p of r.pills) {
    doc.need(22)
    doc.y += 18
    doc.text(p.name, MARGIN, doc.y, { size: 10, weight: 700, maxWidth: 230 })
    doc.text(`${p.onTime} on time · ${p.late} late · ${p.missed} missed`, doc.width - MARGIN, doc.y, { size: 10, align: 'right', color: p.late || p.missed ? C.ink : C.muted })
  }
  doc.y += 6
}

function drawDesire(doc: ReportCanvas, r: CycleReport): void {
  const { bleeding, spotting, other } = r.desireByFlow
  doc.heading('Desire next to the cycle', 'Average on a 1–5 scale')
  doc.need(30)
  doc.y += 20
  const parts: Array<[string, number | null]> = [
    ['Bleeding days', bleeding],
    ['Spotting days', spotting],
    ['Other days', other]
  ]
  parts.forEach(([label, value], i) => {
    const x = MARGIN + i * 160
    doc.text(value === null ? '—' : value.toFixed(1), x, doc.y, { size: 16, weight: 800, color: C.teal })
    doc.text(label, x + 34, doc.y - 1, { size: 9, color: C.muted })
  })
  doc.y += 8
}

const days = (n: number) => `${n} ${n === 1 ? 'day' : 'days'}`
const fmt = (date: string, o: Intl.DateTimeFormatOptions) => new Date(`${date}T00:00:00Z`).toLocaleDateString('en-GB', { ...o, timeZone: 'UTC' })
const dateLong = (date: string) => fmt(date, { day: 'numeric', month: 'short', year: 'numeric' })
const monthTitle = (month: string) => fmt(`${month}-01`, { month: 'long', year: 'numeric' })
