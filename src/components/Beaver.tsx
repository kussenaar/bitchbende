export function Beaver({ className = '', variant = 'logo' }: { className?: string; variant?: 'logo' | 'face' }) {
  return (
    <svg className={`beaver ${className}`} viewBox={variant === 'face' ? '24 14 112 104' : '0 0 160 160'} fill="none" aria-hidden="true">
      {variant === 'logo' && <>
        <path d="M112 96c17-16 35-2 29 14-3 8-14 16-26 16l-12-17Z" fill="#9d6745" stroke="#173f35" strokeWidth="3" />
        <path d="m116 101 18 12m-13-17 15 10m-23 2 13 13m-9-23-9 15m20-12-11 19m17-12-8 13" stroke="#774d32" strokeWidth="2" />
        <path d="M45 102c-7 17-1 38 16 40h40c18-2 25-23 14-40" fill="#ae7652" stroke="#173f35" strokeWidth="3" />
        <ellipse cx="80" cy="120" rx="23" ry="22" fill="#eac79d" />
        <path d="M53 136c-11-3-17 3-13 9 4 4 16 5 23 1m40-10c11-3 17 3 13 9-4 4-16 5-23 1" fill="#9d6745" stroke="#173f35" strokeWidth="3" strokeLinecap="round" />
      </>}
      <circle cx="45" cy="41" r="16" fill="#ad7452" stroke="#173f35" strokeWidth="3" />
      <circle cx="115" cy="41" r="16" fill="#ad7452" stroke="#173f35" strokeWidth="3" />
      <circle cx="45" cy="41" r="8" fill="#dca881" />
      <circle cx="115" cy="41" r="8" fill="#dca881" />
      <path d="M31 64c0-28 20-41 49-41s49 13 49 41v15c0 24-22 39-49 39S31 103 31 79V64Z" fill="#bd875f" stroke="#173f35" strokeWidth="3" />
      <path d="M72 26c-2-8 6-15 8-9 2 5 1 8 1 8 7-9 11-7 10-1" fill="#bd875f" stroke="#173f35" strokeWidth="3" strokeLinecap="round" />
      <ellipse cx="57" cy="68" rx="5" ry="6" fill="#173f35" />
      <ellipse cx="103" cy="68" rx="5" ry="6" fill="#173f35" />
      <circle cx="59" cy="66" r="1.5" fill="#fffaf0" />
      <circle cx="105" cy="66" r="1.5" fill="#fffaf0" />
      <ellipse cx="45" cy="82" rx="8" ry="5" fill="#ee997b" opacity=".6" />
      <ellipse cx="115" cy="82" rx="8" ry="5" fill="#ee997b" opacity=".6" />
      <path d="M80 79c-9-10-27-2-27 9 0 16 18 22 27 14 9 8 27 2 27-14 0-11-18-19-27-9Z" fill="#edcea4" />
      <path d="M70 77c0-7 20-7 20 0 0 5-8 8-10 8s-10-3-10-8Z" fill="#173f35" />
      <path d="M71 93h18v16c-2 3-6 2-9 2s-7 1-9-2V93Z" fill="#fffaf0" stroke="#173f35" strokeWidth="2" />
      <path d="M80 94v17m-18-18c8 7 28 7 36 0" stroke="#173f35" strokeWidth="2.5" strokeLinecap="round" />
      {variant === 'logo' && <path d="M42 109c-8-2-13 3-10 9 2 4 10 7 16 5m70-14c8-2 13 3 10 9-2 4-10 7-16 5" fill="#bd875f" stroke="#173f35" strokeWidth="3" strokeLinecap="round" />}
    </svg>
  )
}
