import { useEffect, useRef, useState } from 'react'
import { createPortal } from 'react-dom'
import { REACTION_COOLDOWN_MS, REACTION_IMAGES, type ReactionId, type TableReaction } from '../game/reactions'
import type { DispatchResult } from '../game/session'
import { Dialog } from './Dialog'
import './ReactionTray.css'

const NO_REACTIONS: TableReaction[] = []
const imageUrl = (file: string) => `${import.meta.env.BASE_URL}reacts/${encodeURIComponent(file)}`
type VisibleReaction = TableReaction & { expiresAt: number }

export function ReactionTray({ playerId, players, reactions = NO_REACTIONS, onSend }: {
  playerId: string
  players: { id: string; name: string }[]
  reactions?: TableReaction[]
  onSend?: (imageId: ReactionId) => Promise<DispatchResult>
}) {
  const [open, setOpen] = useState(false)
  const [sending, setSending] = useState(false)
  const [coolingDown, setCoolingDown] = useState(false)
  const [error, setError] = useState('')
  const [visible, setVisible] = useState<VisibleReaction[]>([])
  const seen = useRef(new Set(reactions.map((reaction) => reaction.id)))
  useEffect(() => {
    const fresh = reactions.filter((reaction) => !seen.current.has(reaction.id))
    fresh.forEach((reaction) => seen.current.add(reaction.id))
    // Only recent server events are returned; keep this cursor bounded too.
    if (seen.current.size > 100) seen.current = new Set(reactions.map((reaction) => reaction.id))
    if (fresh.length) setVisible((current) => [...current, ...fresh.map((reaction) => ({ ...reaction, expiresAt: Date.now() + 4500 }))].slice(-2))
  }, [reactions])
  useEffect(() => {
    if (!visible.length) return
    const timer = setTimeout(() => setVisible((current) => current.filter((reaction) => reaction.expiresAt > Date.now())), Math.max(0, Math.min(...visible.map((reaction) => reaction.expiresAt)) - Date.now()))
    return () => clearTimeout(timer)
  }, [visible])
  useEffect(() => {
    if (!coolingDown) return
    const timer = setTimeout(() => setCoolingDown(false), REACTION_COOLDOWN_MS)
    return () => clearTimeout(timer)
  }, [coolingDown])

  async function send(imageId: ReactionId) {
    if (sending || coolingDown) return
    setSending(true); setError('')
    try {
      const result = onSend ? await onSend(imageId) : { ok: true as const }
      if (!result.ok) { setError(result.error); return }
      if (!onSend) setVisible((current) => [...current, { id: crypto.randomUUID(), playerId, imageId, createdAt: Date.now(), expiresAt: Date.now() + 4500 }].slice(-2))
      setOpen(false); setCoolingDown(true)
    } catch { setError('Your reaction could not be sent. Try again.') }
    finally { setSending(false) }
  }

  return <>
    <button className="button button-secondary reaction-toggle" type="button" onClick={() => { setOpen(true); setError('') }} aria-haspopup="dialog"><span aria-hidden="true">💬</span> Reactions</button>
    <Dialog open={open} onClose={() => setOpen(false)} title="Send a reaction">
      <div className="reaction-picker">{REACTION_IMAGES.map((image) => <button type="button" key={image.id} disabled={sending || coolingDown} aria-label={`Send ${image.label}`} onClick={() => { void send(image.id) }}><img src={imageUrl(image.file)} alt={image.label} draggable={false} /></button>)}</div>
      {sending && <p role="status">Sending…</p>}
      {coolingDown && <p role="status">Give it a moment, then send another.</p>}
      {error && <p className="reaction-error" role="alert">{error}</p>}
    </Dialog>
    {visible.length > 0 && createPortal(<div className="reaction-bursts" aria-live="polite" aria-atomic="false">{visible.map((reaction) => {
      const image = REACTION_IMAGES.find((candidate) => candidate.id === reaction.imageId)
      if (!image) return null
      const name = players.find((player) => player.id === reaction.playerId)?.name ?? 'Player'
      return <div className="reaction-bubble" key={reaction.id} data-reaction-id={reaction.id}><img src={imageUrl(image.file)} alt={`${name} sent ${image.label.toLowerCase()}`} draggable={false} /><span>{name}</span></div>
    })}</div>, document.body)}
  </>
}
