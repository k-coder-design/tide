/** Line icons drawn for Tide (24×24, stroke), as on the design canvas. */
const PATHS = {
  sex: 'M4 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0M10 12a5 5 0 1 0 10 0a5 5 0 1 0 -10 0',
  masturbation: 'M5 12a7 7 0 1 0 14 0a7 7 0 1 0 -14 0M10 12a2 2 0 1 0 4 0a2 2 0 1 0 -4 0',
  dream: 'M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z',
  fantasy: 'M12 3l1.8 5.2L19 10l-5.2 1.8L12 17l-1.8-5.2L5 10l5.2-1.8zM18 16l.8 2.2L21 19l-2.2.8L18 22l-.8-2.2L15 19l2.2-.8z',
  desire: 'M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.6A4 4 0 0 1 19 10c0 5.6-7 10-7 10z',
  today: 'M8 12a4 4 0 1 0 8 0a4 4 0 1 0 -8 0M12 3v2M12 19v2M3 12h2M19 12h2M5.6 5.6l1.4 1.4M17 17l1.4 1.4M5.6 18.4L7 17M17 7l1.4-1.4',
  journal: 'M5 4h14v16H5zM9 9h6M9 13h6M9 17h3',
  insights: 'M4 20h16M7 16v-5M12 16V6M17 16v-8',
  settings: 'M4 7h10M18 7h2M4 17h4M12 17h8M16 5v4M10 15v4',
  back: 'M15 6l-6 6 6 6',
  forward: 'M9 6l6 6-6 6',
  plus: 'M12 5v14M5 12h14',
  close: 'M6 6l12 12M18 6L6 18'
} as const

export type IconName = keyof typeof PATHS

export function Icon({ name, size = 20, color = 'currentColor', strokeWidth = 1.8 }: { name: IconName; size?: number; color?: string; strokeWidth?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke={color} strokeWidth={strokeWidth} strokeLinecap="round" strokeLinejoin="round" aria-hidden="true">
      <path d={PATHS[name]} />
    </svg>
  )
}
