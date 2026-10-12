import { useId, useLayoutEffect, useRef, useState, type RefObject } from 'react'
import { createPortal } from 'react-dom'
import type { Card as GameCard, GameView, PublicCardMove } from '../game/types'
import { Card } from './Card'
import './CardMotion.css'

type MovingAction = Extract<PublicCardMove, { type: 'replace' | 'swap' }>
type QueuedMove = { id: number; move: MovingAction; caption: string }
type Box = { x: number; y: number; width: number; height: number }
type Flight = { from: Box; to: Box; card: GameCard | null; bend: number }
type PositionLabel = { box: Box; text: string }
type Geometry = { id: number; flights: Flight[]; hidden: HTMLElement[]; targets: HTMLElement[]; labels: PositionLabel[] }

type CardMotionProps = {
  view: GameView
  tableRef: RefObject<HTMLDivElement | null>
  onAnimatingChange: (animating: boolean) => void
}

const FLIGHT_MS = 1500
const LANDING_MS = 500

function cardBox(element: HTMLElement): Box {
  const rect = (element.querySelector('.card') ?? element).getBoundingClientRect()
  return { x: rect.left, y: rect.top, width: rect.width, height: rect.height }
}

function slotElement(table: HTMLElement, playerId: string, slot: number) {
  const seat = [...table.querySelectorAll<HTMLElement>('[data-player-id]')].find((element) => element.dataset.playerId === playerId)
  return seat?.querySelector<HTMLElement>(`[data-card-slot="${slot}"]`) ?? null
}

function center(box: Box) {
  return { x: box.x + box.width / 2, y: box.y + box.height / 2 }
}

function curve(flight: Flight) {
  const from = center(flight.from)
  const to = center(flight.to)
  const length = Math.max(1, Math.hypot(to.x - from.x, to.y - from.y))
  const lift = Math.min(115, length * .32) * flight.bend
  return { from, to, control: { x: (from.x + to.x) / 2 - (to.y - from.y) / length * lift, y: (from.y + to.y) / 2 + (to.x - from.x) / length * lift } }
}

function flightKeyframes(flight: Flight): Keyframe[] {
  const { from, to, control } = curve(flight)
  return Array.from({ length: 25 }, (_, index) => {
    const t = index / 24
    const width = flight.from.width + (flight.to.width - flight.from.width) * t
    const height = flight.from.height + (flight.to.height - flight.from.height) * t
    const x = (1 - t) ** 2 * from.x + 2 * (1 - t) * t * control.x + t ** 2 * to.x
    const y = (1 - t) ** 2 * from.y + 2 * (1 - t) * t * control.y + t ** 2 * to.y
    return { offset: t, width: `${width}px`, height: `${height}px`, transform: `translate3d(${x - width / 2}px, ${y - height / 2}px, 0) rotate(${Math.sin(t * Math.PI) * flight.bend * 12}deg) scale(${1 + Math.sin(t * Math.PI) * .12})` }
  })
}

function moveCaption(move: MovingAction, view: GameView) {
  const player = view.players.find((candidate) => candidate.id === move.playerId)?.name ?? 'Player'
  if (move.type === 'swap') {
    const target = view.players.find((candidate) => candidate.id === move.targetPlayerId)?.name ?? 'Player'
    return `${player}’s card ${move.slot + 1} ↔ ${target}’s card ${move.targetSlot + 1}`
  }
  const discarded = move.discarded.kind === 'number' ? String(move.discarded.value) : { peek: 'Peek', swap: 'Swap', draw: 'Draw two' }[move.discarded.kind]
  return `${player} replaces card ${move.slot + 1} · ${discarded} goes to the discard pile`
}

function measureMove(active: QueuedMove, table: HTMLElement, view: GameView): Geometry | null {
  const { move } = active
  const own = slotElement(table, move.playerId, move.slot)
  if (!own) return null
  const ownBox = cardBox(own)
  const ownName = view.players.find((player) => player.id === move.playerId)?.name ?? 'Player'
  if (move.type === 'swap') {
    const other = slotElement(table, move.targetPlayerId, move.targetSlot)
    if (!other) return null
    const otherBox = cardBox(other)
    const otherName = view.players.find((player) => player.id === move.targetPlayerId)?.name ?? 'Player'
    return {
      id: active.id,
      flights: [{ from: ownBox, to: otherBox, card: null, bend: 1 }, { from: otherBox, to: ownBox, card: null, bend: 1 }],
      hidden: [own, other], targets: [own, other],
      labels: [{ box: ownBox, text: `${ownName} · ${move.slot + 1}` }, { box: otherBox, text: `${otherName} · ${move.targetSlot + 1}` }],
    }
  }
  const source = table.querySelector<HTMLElement>(`[data-pile="${move.source}"]`)
  const discard = table.querySelector<HTMLElement>('[data-pile="discard"]')
  if (!source || !discard) return null
  const discardBox = cardBox(discard)
  return {
    id: active.id,
    flights: [{ from: ownBox, to: discardBox, card: move.discarded, bend: 1 }, { from: cardBox(source), to: ownBox, card: move.incoming, bend: 1 }],
    hidden: [own, discard], targets: [own, discard],
    labels: [{ box: ownBox, text: `${ownName} · ${move.slot + 1}` }, { box: discardBox, text: 'Discard' }],
  }
}

/** Animates only public moves. In particular, a blind swap never receives card faces. */
export function CardMotion({ view, tableRef, onAnimatingChange }: CardMotionProps) {
  const cursor = useRef({ round: view.round, id: Math.max(0, ...view.log.map((entry) => entry.id)) })
  const [moves, setMoves] = useState<QueuedMove[]>([])
  const [geometry, setGeometry] = useState<Geometry | null>(null)
  const [landed, setLanded] = useState(false)
  const flyingCards = useRef<(HTMLDivElement | null)[]>([])
  const latestView = useRef(view)
  latestView.current = view
  const arrowId = `card-motion-arrow-${useId().replaceAll(':', '')}`
  const active = moves[0]
  const animating = moves.length > 0

  useLayoutEffect(() => {
    const latestId = Math.max(cursor.current.id, ...view.log.map((entry) => entry.id))
    if (cursor.current.round !== view.round) {
      cursor.current = { round: view.round, id: latestId }
      setMoves([])
      return
    }
    const fresh = view.log.filter((entry) => entry.id > cursor.current.id && entry.round === view.round && (entry.move?.type === 'replace' || entry.move?.type === 'swap'))
      .sort((a, b) => a.id - b.id)
      .slice(-8)
      .map((entry) => ({ id: entry.id, move: entry.move as MovingAction, caption: moveCaption(entry.move as MovingAction, view) }))
    cursor.current.id = latestId
    if (fresh.length) setMoves((queued) => queued.length ? [queued[0], ...[...queued.slice(1), ...fresh].slice(-7)] : fresh)
  }, [view.log, view.round, view])

  useLayoutEffect(() => { onAnimatingChange(animating) }, [animating, onAnimatingChange])
  useLayoutEffect(() => () => onAnimatingChange(false), [onAnimatingChange])

  useLayoutEffect(() => {
    setLanded(false)
    if (!active || !tableRef.current) { setGeometry(null); return }
    const measured = measureMove(active, tableRef.current, latestView.current)
    setGeometry(measured)
    if (!measured) setMoves((queued) => queued[0]?.id === active.id ? queued.slice(1) : queued)
  }, [active, tableRef])

  useLayoutEffect(() => {
    if (!active || !geometry || geometry.id !== active.id) return
    const reducedMotion = window.matchMedia('(prefers-reduced-motion: reduce)').matches
    const animations: Animation[] = []
    let landingTimer: ReturnType<typeof setTimeout> | undefined
    let finishTimer: ReturnType<typeof setTimeout> | undefined
    let finished = false

    const restoreCards = () => geometry.hidden.forEach((element) => element.classList.remove('card-motion-hidden'))
    const finish = () => {
      if (finished) return
      finished = true
      setMoves((queued) => queued[0]?.id === active.id ? queued.slice(1) : queued)
    }
    const land = () => {
      restoreCards()
      geometry.targets.forEach((element) => element.classList.add('card-move-target'))
      setLanded(true)
    }

    if (reducedMotion) {
      land()
      finishTimer = setTimeout(finish, 900)
    } else {
      geometry.hidden.forEach((element) => element.classList.add('card-motion-hidden'))
      geometry.flights.forEach((flight, index) => {
        const element = flyingCards.current[index]
        if (element) animations.push(element.animate(flightKeyframes(flight), { duration: FLIGHT_MS, easing: 'cubic-bezier(.32, 0, .32, 1)', fill: 'forwards' }))
      })
      landingTimer = setTimeout(land, FLIGHT_MS)
      finishTimer = setTimeout(finish, FLIGHT_MS + LANDING_MS)
    }

    const handleScroll = (event: Event) => {
      if (event.target === window || event.target === document || event.target === document.documentElement || event.target === document.body) finish()
    }
    const viewport = window.visualViewport
    const viewportHeight = viewport?.height
    const viewportScale = viewport?.scale
    const handleViewportResize = () => {
      // Showing a scrollbar can change only the visual width when the action panel
      // changes. That should not cut a just-started swap short.
      if (viewport && (Math.abs(viewport.height - (viewportHeight ?? viewport.height)) > 2 || viewport.scale !== viewportScale)) finish()
    }
    window.addEventListener('resize', finish)
    window.addEventListener('scroll', handleScroll, { capture: true, passive: true })
    viewport?.addEventListener('resize', handleViewportResize)
    return () => {
      clearTimeout(landingTimer)
      clearTimeout(finishTimer)
      animations.forEach((animation) => animation.cancel())
      restoreCards()
      geometry.targets.forEach((element) => element.classList.remove('card-move-target'))
      window.removeEventListener('resize', finish)
      window.removeEventListener('scroll', handleScroll, true)
      viewport?.removeEventListener('resize', handleViewportResize)
    }
  }, [active, geometry])

  if (!active || !geometry || geometry.id !== active.id) return null

  return createPortal(<div className={`card-motion-layer${landed ? ' card-motion-landed' : ''}`} data-motion-kind={active.move.type}>
    <svg className="card-motion-paths" aria-hidden="true">
      <defs><marker id={arrowId} viewBox="0 0 10 10" refX="8" refY="5" markerWidth="6" markerHeight="6" orient="auto-start-reverse"><path d="M 0 0 L 10 5 L 0 10 z" /></marker></defs>
      {geometry.flights.map((flight, index) => {
        const { from, to, control } = curve(flight)
        return <path key={index} d={`M ${from.x} ${from.y} Q ${control.x} ${control.y} ${to.x} ${to.y}`} markerEnd={`url(#${arrowId})`} />
      })}
    </svg>
    {geometry.flights.map((flight, index) => <div key={`${active.id}-${index}`} className="card-motion-card" ref={(element) => { flyingCards.current[index] = element }} style={{ width: flight.from.width, height: flight.from.height, transform: `translate3d(${flight.from.x}px, ${flight.from.y}px, 0)` }} aria-hidden="true"><Card card={flight.card ?? undefined} faceUp={flight.card !== null} /></div>)}
    {geometry.labels.map((label, index) => <span key={index} className="card-motion-position" style={{ left: Math.max(68, Math.min(document.documentElement.clientWidth - 68, label.box.x + label.box.width / 2)), top: label.box.y + label.box.height + 7 }} aria-hidden="true">{label.text}</span>)}
    <div className="card-motion-caption" role="status" aria-live="polite"><span aria-hidden="true">{active.move.type === 'swap' ? '⇄' : '↔'}</span><span>{active.caption}</span></div>
  </div>, document.body)
}
