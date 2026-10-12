import type { ReactNode } from 'react'

export type IconName = 'arrow' | 'copy' | 'check' | 'close' | 'help' | 'sound' | 'muted' | 'shuffle' | 'eye' | 'swap' | 'draw' | 'flag' | 'chevron' | 'users' | 'sparkles' | 'trophy' | 'home' | 'play'

const paths: Record<IconName, ReactNode> = {
  arrow: <path d="M4 12h15M13 6l6 6-6 6" />,
  copy: <><rect x="8" y="8" width="12" height="13" rx="2" /><path d="M15 8V5a2 2 0 0 0-2-2H5a2 2 0 0 0-2 2v8a2 2 0 0 0 2 2h3" /></>,
  check: <path d="m5 12 4 4L19 6" />,
  close: <path d="m6 6 12 12M18 6 6 18" />,
  help: <><circle cx="12" cy="12" r="9" /><path d="M9.6 8.3a2.6 2.6 0 0 1 5 1c0 1.9-2.6 2.2-2.6 4M12 16.5v.1" /></>,
  sound: <path d="m11 4-5 4H3v8h3l5 4V4ZM15 8a6 6 0 0 1 0 8M18 5a10 10 0 0 1 0 14" />,
  muted: <path d="m11 4-5 4H3v8h3l5 4V4ZM16 9l5 6m0-6-5 6" />,
  shuffle: <path d="M3 6h3c5 0 7 12 12 12h3m-4-4 4 4-4 4M3 18h3c2 0 3.6-2 5-5M13 8c1.7-2 3-2 5-2h3m-4-4 4 4-4 4" />,
  eye: <><path d="M2 12s3.5-7 10-7 10 7 10 7-3.5 7-10 7S2 12 2 12Z" /><circle cx="12" cy="12" r="3" /></>,
  swap: <path d="M4 7h16m-4-4 4 4-4 4M20 17H4m4-4-4 4 4 4" />,
  draw: <><rect x="7" y="5" width="12" height="16" rx="2" /><path d="M14 5V3H5a2 2 0 0 0-2 2v12h4M10 13h6m-3-3v6" /></>,
  flag: <path d="M5 21V3m0 1c5-4 9 4 15 0v10c-6 4-10-4-15 0" />,
  chevron: <path d="m9 5 7 7-7 7" />,
  users: <><circle cx="9" cy="8" r="3" /><path d="M3 21v-3a6 6 0 0 1 12 0v3M16 5a3 3 0 0 1 0 6m2 4a5 5 0 0 1 3 5v1" /></>,
  sparkles: <path d="m12 2 2.5 7.5L22 12l-7.5 2.5L12 22l-2.5-7.5L2 12l7.5-2.5L12 2ZM20 2v4m-2-2h4M3 19v3m-1.5-1.5h3" />,
  trophy: <path d="M7 3h10v5c0 5-2 7-5 7s-5-2-5-7V3ZM7 5H3v3c0 3 2 4 5 4m9-7h4v3c0 3-2 4-5 4M12 15v6m-4 0h8" />,
  home: <path d="m3 10 9-8 9 8M5 9v12h5v-7h4v7h5V9" />,
  play: <path d="m8 4 12 8-12 8V4Z" />,
}

export function Icon({ name, size = 20, className = '' }: { name: IconName; size?: number; className?: string }) {
  return <svg width={size} height={size} viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" className={className} aria-hidden="true">{paths[name]}</svg>
}
