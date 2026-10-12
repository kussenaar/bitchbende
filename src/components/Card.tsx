export type CardData = { id: string; kind: 'number'; value: number } | { id: string; kind: 'peek' | 'swap' | 'draw' }

type CardProps = {
  card?: CardData
  faceUp?: boolean
  small?: boolean
  selected?: boolean
  disabled?: boolean
  label?: string
  onClick?: () => void
  className?: string
}

const powerNames = { peek: 'Peek', swap: 'Swap', draw: 'Draw two' }
const powerArtwork = { peek: 'Look at a hidden card.png', swap: 'Swap card.png', draw: 'Draw 2 cards.png' }

export function Card({ card, faceUp = false, small = false, selected = false, disabled = false, label, onClick, className = '' }: CardProps) {
  const visible = faceUp && card
  const accessibleLabel = label ?? (visible ? (card.kind === 'number' ? `Card ${card.value}` : `${powerNames[card.kind]} action card`) : 'Face-down card')
  const classes = ['card', visible ? 'card-face' : 'card-back', small ? 'card-small' : '', selected ? 'card-selected' : '', visible && card.kind !== 'number' ? `card-${card.kind} card-illustrated` : '', className].filter(Boolean).join(' ')
  const content = visible ? (card.kind === 'number' ? <>
    <span className="card-corner" aria-hidden="true">{card.value}</span>
    <span className="card-value" aria-hidden="true">{card.value}</span>
    <span className="card-number-line" aria-hidden="true" />
    <span className="card-corner card-corner-bottom" aria-hidden="true">{card.value}</span>
  </> : <img className="card-art" src={`${import.meta.env.BASE_URL}${encodeURIComponent(powerArtwork[card.kind])}`} alt="" aria-hidden="true" draggable={false} />) : <img className="card-art card-back-art" src={`${import.meta.env.BASE_URL}${encodeURIComponent('Back of the card.png')}`} alt="" aria-hidden="true" draggable={false} />

  if (onClick) return <button type="button" className={classes} disabled={disabled} aria-label={accessibleLabel} aria-pressed={selected || undefined} onClick={onClick}>{content}</button>
  return <div className={classes} role="img" aria-label={accessibleLabel}>{content}</div>
}
