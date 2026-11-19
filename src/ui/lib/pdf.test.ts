import { describe, expect, it } from 'vitest'
import { buildPdf } from './pdf'

const text = (bytes: Uint8Array) => new TextDecoder('latin1').decode(bytes)

describe('pdf writer (T35)', () => {
  it('places one image per page and keeps the cross-reference offsets exact', () => {
    const jpeg = new Uint8Array([0xff, 0xd8, 0xff, 0xe0, 1, 2, 3, 0xff, 0xd9])
    const pdf = text(buildPdf([{ jpeg, pixelWidth: 10, pixelHeight: 14 }, { jpeg, pixelWidth: 10, pixelHeight: 14 }], 'Tide (cycle) — report'))
    expect(pdf.startsWith('%PDF-1.4\n')).toBe(true)
    expect(pdf).toContain('/Type /Pages /Count 2 /Kids [4 0 R 7 0 R]')
    expect(pdf).toContain('/Title (Tide \\(cycle\\) - report)')
    expect(pdf.trimEnd().endsWith('%%EOF')).toBe(true)
    // Every xref entry points at its "N 0 obj" line.
    const xrefAt = Number(/startxref\n(\d+)/.exec(pdf)![1])
    expect(pdf.slice(xrefAt, xrefAt + 4)).toBe('xref')
    const entries = pdf.slice(xrefAt).split('\n').slice(3, 3 + 9)
    entries.forEach((entry, i) => expect(pdf.slice(Number(entry.slice(0, 10))).startsWith(`${i + 1} 0 obj`)).toBe(true))
  })

  it('refuses an empty document', () => {
    expect(() => buildPdf([], 'x')).toThrow()
  })
})
