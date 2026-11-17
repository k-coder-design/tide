/**
 * iOS Home Screen app: mark the page (class "standalone" on <html>) so styles.css can apply
 * Home Screen viewport fixes, as in Recallo: Mobile.
 */
export function markStandalone(): void {
  const standalone =
    (navigator as Navigator & { standalone?: boolean }).standalone === true ||
    window.matchMedia('(display-mode: standalone)').matches
  if (standalone) document.documentElement.classList.add('standalone')
}
