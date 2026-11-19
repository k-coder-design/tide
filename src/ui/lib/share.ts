/**
 * Hands a file made on the phone to the Share sheet (Save to Files, AirDrop, Mail…), or downloads it where there is
 * no Share sheet. Call it straight from a tap: iOS opens the sheet only right after one. Returns false when the
 * sheet was closed without choosing anything.
 */
export async function shareFile(file: File): Promise<boolean> {
  if (navigator.canShare?.({ files: [file] })) {
    try {
      await navigator.share({ files: [file] })
    } catch (reason) {
      if (reason instanceof DOMException && reason.name === 'AbortError') return false
      throw reason
    }
    return true
  }
  download(file)
  return true
}

/** Where the Share sheet is missing (desktop browsers): a plain download. */
export function download(file: File): void {
  const url = URL.createObjectURL(file)
  const link = document.createElement('a')
  link.href = url
  link.download = file.name
  link.click()
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}
