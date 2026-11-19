/**
 * A minimal PDF writer (T35): each page is one JPEG drawn on the phone, placed full-page. Drawing the pages on a
 * canvas keeps the app's font and any script (medication names in Cyrillic, say) without embedding fonts. Nothing
 * leaves the device: the bytes go straight to the Share sheet.
 */

export interface PdfPage {
  /** Baseline JPEG bytes, as from canvas.toBlob(…, 'image/jpeg'). */
  jpeg: Uint8Array
  /** Pixel size of the image. */
  pixelWidth: number
  pixelHeight: number
}

/** A4 in points. */
export const A4 = { width: 595.28, height: 841.89 }

const encoder = new TextEncoder()

export function buildPdf(pages: PdfPage[], title: string): Uint8Array {
  if (pages.length === 0) throw new Error('A PDF needs at least one page')
  const chunks: Uint8Array[] = []
  const offsets: number[] = []
  let length = 0
  const push = (part: Uint8Array | string) => {
    const bytes = typeof part === 'string' ? encoder.encode(part) : part
    chunks.push(bytes)
    length += bytes.length
  }
  const object = (id: number, body: () => void) => {
    offsets[id] = length
    push(`${id} 0 obj\n`)
    body()
    push('\nendobj\n')
  }

  // 1 catalog, 2 page tree, 3 info, then three objects per page: page, image, content.
  const pageId = (i: number) => 4 + i * 3
  push('%PDF-1.4\n')
  object(1, () => push('<< /Type /Catalog /Pages 2 0 R >>'))
  object(2, () => push(`<< /Type /Pages /Count ${pages.length} /Kids [${pages.map((_, i) => `${pageId(i)} 0 R`).join(' ')}] >>`))
  object(3, () => push(`<< /Title (${pdfString(title)}) /Producer (Tide) >>`))

  const w = A4.width.toFixed(2)
  const h = A4.height.toFixed(2)
  pages.forEach((page, i) => {
    const id = pageId(i)
    object(id, () =>
      push(`<< /Type /Page /Parent 2 0 R /MediaBox [0 0 ${w} ${h}] /Resources << /XObject << /Im0 ${id + 1} 0 R >> >> /Contents ${id + 2} 0 R >>`)
    )
    object(id + 1, () => {
      push(
        `<< /Type /XObject /Subtype /Image /Width ${page.pixelWidth} /Height ${page.pixelHeight} /ColorSpace /DeviceRGB /BitsPerComponent 8 /Filter /DCTDecode /Length ${page.jpeg.length} >>\nstream\n`
      )
      push(page.jpeg)
      push('\nendstream')
    })
    const content = `q ${w} 0 0 ${h} 0 0 cm /Im0 Do Q`
    object(id + 2, () => push(`<< /Length ${content.length} >>\nstream\n${content}\nendstream`))
  })

  const count = 3 + pages.length * 3
  const xref = length
  push(`xref\n0 ${count + 1}\n0000000000 65535 f \n`)
  for (let id = 1; id <= count; id++) push(`${String(offsets[id]).padStart(10, '0')} 00000 n \n`)
  push(`trailer\n<< /Size ${count + 1} /Root 1 0 R /Info 3 0 R >>\nstartxref\n${xref}\n%%EOF\n`)

  const out = new Uint8Array(length)
  let at = 0
  for (const chunk of chunks) {
    out.set(chunk, at)
    at += chunk.length
  }
  return out
}

/** A literal string for the info dictionary: ASCII only, with the PDF escapes. */
function pdfString(value: string): string {
  return value.replace(/[^\x20-\x7e]/g, '-').replace(/([\\()])/g, '\\$1')
}
