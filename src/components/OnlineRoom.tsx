import { useCallback, useEffect, useRef, useState } from 'react'
import type { FormEvent, ReactNode } from 'react'
import {
  clearRoomCredentials, getInviteCode, getInviteLink, loadRoomCredentials,
  normalizeRoomCode, onlineConfigurationError, OnlineGameSession, requestRoom,
  RoomApiError, saveRoomCredentials,
} from '../game/online'
import type { RoomCredentials, RoomRequest, RoomView } from '../game/room-types'
import type { DispatchResult, GameSession } from '../game/session'
import type { GameAction } from '../game/types'
import { Icon } from './Icon'

interface OnlineRoomProps {
  onBack: () => void
  onRules: () => void
  renderGame: (session: GameSession, room: RoomView, onLeave: () => void) => ReactNode
}

type Connection = 'connecting' | 'online' | 'offline'
const COLORS = ['coral', 'gold', 'lavender', 'sage']

function savedSeatForPage(): RoomCredentials | null {
  const seat = loadRoomCredentials()
  const invitation = getInviteCode()
  return seat && (!invitation || invitation === seat.code) ? seat : null
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : 'The room request failed. Please try again.'
}

export function OnlineRoom({ onBack, onRules, renderGame }: OnlineRoomProps) {
  const [credentials, setCredentials] = useState<RoomCredentials | null>(savedSeatForPage)
  const [room, setRoom] = useState<RoomView | null>(null)
  const [session, setSession] = useState<OnlineGameSession | null>(null)
  const [name, setName] = useState('')
  const [code, setCode] = useState(getInviteCode)
  const [rounds, setRounds] = useState(6)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [connection, setConnection] = useState<Connection>('connecting')
  const [connectionError, setConnectionError] = useState('')
  const [retry, setRetry] = useState(0)
  const [copied, setCopied] = useState(false)
  const [sharing, setSharing] = useState(false)
  const [copyFallback, setCopyFallback] = useState(false)
  const [forgetting, setForgetting] = useState(false)
  const credentialsRef = useRef(credentials)
  const roomRef = useRef<RoomView | null>(null)
  const sessionRef = useRef<OnlineGameSession | null>(null)
  const mounted = useRef(true)
  const mutationPending = useRef(false)
  const mutationController = useRef<AbortController | null>(null)
  const inviteInput = useRef<HTMLInputElement>(null)
  const actionHandler = useRef<(action: GameAction) => Promise<DispatchResult>>(async () => ({ ok: false, error: 'The room is still connecting.' }))
  const configurationError = onlineConfigurationError()

  useEffect(() => {
    mounted.current = true
    return () => { mounted.current = false; mutationController.current?.abort() }
  }, [])
  useEffect(() => {
    if (!copied) return
    const timeout = setTimeout(() => setCopied(false), 2500)
    return () => clearTimeout(timeout)
  }, [copied])
  useEffect(() => {
    if (copyFallback) { inviteInput.current?.focus(); inviteInput.current?.select() }
  }, [copyFallback])

  const adoptRoom = useCallback((next: RoomView) => {
    const seat = credentialsRef.current
    if (!seat || seat.code !== next.code) return
    const current = roomRef.current
    // A poll sent before a move may arrive after that move's response.
    if (current?.code === next.code && next.revision <= current.revision) return
    roomRef.current = next
    if (next.game) {
      if (!sessionRef.current || sessionRef.current.viewerId !== seat.playerId) {
        sessionRef.current = new OnlineGameSession(seat.playerId, next.game, (action) => actionHandler.current(action))
        setSession(sessionRef.current)
      } else sessionRef.current.update(next.game)
    } else if (sessionRef.current) {
      sessionRef.current = null
      setSession(null)
    }
    setRoom(next)
  }, [])

  const forgetRoom = useCallback(() => {
    clearRoomCredentials()
    credentialsRef.current = null
    roomRef.current = null
    sessionRef.current = null
    setCredentials(null)
    setRoom(null)
    setSession(null)
    setConnectionError('')
    setError('')
    setForgetting(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    window.history.replaceState(window.history.state, '', url)
  }, [])

  useEffect(() => {
    if (!credentials) return
    let stopped = false
    let inFlight = false
    let failures = 0
    let timeout: ReturnType<typeof setTimeout> | undefined
    const controller = new AbortController()
    setConnection('connecting')

    async function poll() {
      if (stopped || inFlight) return
      clearTimeout(timeout)
      inFlight = true
      try {
        const response = await requestRoom({ operation: 'view', ...credentials! }, controller.signal)
        if (stopped) return
        adoptRoom(response.room)
        failures = 0
        setConnection('online')
        setConnectionError('')
      } catch (pollError) {
        if (stopped || controller.signal.aborted) return
        if (pollError instanceof RoomApiError && (pollError.status === 403 || pollError.status === 404)) {
          // A missing or expired seat cannot be restored by retrying its token.
          forgetRoom()
          setCode(credentials!.code)
          setError(errorMessage(pollError))
          return
        }
        failures += 1
        setConnection('offline')
        setConnectionError(errorMessage(pollError))
      } finally {
        inFlight = false
        if (!stopped && credentialsRef.current) {
          const delay = document.hidden ? 10000 : failures ? Math.min(1500 * 2 ** failures, 15000) : 1000
          timeout = setTimeout(() => { void poll() }, delay)
        }
      }
    }
    function resume() { if (!document.hidden) { clearTimeout(timeout); void poll() } }
    void poll()
    document.addEventListener('visibilitychange', resume)
    window.addEventListener('online', resume)
    return () => {
      stopped = true
      controller.abort()
      clearTimeout(timeout)
      document.removeEventListener('visibilitychange', resume)
      window.removeEventListener('online', resume)
    }
  }, [credentials, retry, adoptRoom, forgetRoom])

  async function enterRoom(operation: 'create' | 'join', event: FormEvent) {
    event.preventDefault()
    if (mutationPending.current) return
    mutationPending.current = true
    setBusy(true); setError('')
    const controller = new AbortController()
    mutationController.current = controller
    try {
      const response = await requestRoom(operation === 'create'
        ? { operation, name: name.trim() || 'Player', rounds }
        : { operation, name: name.trim() || 'Player', code: normalizeRoomCode(code) }, controller.signal)
      if (!mounted.current) return
      if (!response.playerId || !response.token) throw new Error('The server did not return your room seat. Please try again.')
      const seat = { code: response.room.code, playerId: response.playerId, token: response.token }
      credentialsRef.current = seat
      roomRef.current = null
      sessionRef.current = null
      saveRoomCredentials(seat)
      const url = new URL(window.location.href)
      url.searchParams.set('room', seat.code)
      url.hash = ''
      window.history.replaceState(window.history.state, '', url)
      setCredentials(seat)
      adoptRoom(response.room)
      setConnection('online')
      setConnectionError('')
    } catch (enterError) {
      if (mounted.current && !controller.signal.aborted) setError(errorMessage(enterError))
    } finally {
      mutationPending.current = false
      if (mounted.current) setBusy(false)
    }
  }

  async function mutate(operation: 'start' | 'leave' | 'action', action?: GameAction): Promise<DispatchResult> {
    const seat = credentialsRef.current
    const current = roomRef.current
    if (!seat || !current) return { ok: false, error: 'The room is still connecting.' }
    if (connection !== 'online') return { ok: false, error: 'Reconnecting to the room. Wait until the connection is restored.' }
    if (mutationPending.current) return { ok: false, error: 'Your previous move is still being confirmed.' }
    mutationPending.current = true
    setBusy(true); setError('')
    const controller = new AbortController()
    mutationController.current = controller
    const request: RoomRequest = operation === 'action' && action
      ? { operation: 'action', ...seat, revision: current.revision, action }
      : { operation: operation === 'leave' ? 'leave' : 'start', ...seat }
    try {
      const response = await requestRoom(request, controller.signal)
      if (!mounted.current) return { ok: false, error: 'You have disconnected from the room.' }
      if (operation === 'leave') { forgetRoom(); onBack() }
      else adoptRoom(response.room)
      return { ok: true }
    } catch (mutationError) {
      const message = errorMessage(mutationError)
      if (mounted.current && !controller.signal.aborted) {
        if (mutationError instanceof RoomApiError && mutationError.room) adoptRoom(mutationError.room)
        setError(message)
        if (mutationError instanceof RoomApiError && (mutationError.status === 0 || mutationError.status >= 500)) {
          setConnection('offline'); setConnectionError(message)
        }
      }
      return { ok: false, error: message }
    } finally {
      mutationPending.current = false
      if (mounted.current) setBusy(false)
    }
  }
  actionHandler.current = (action) => mutate('action', action)

  async function copyInvite() {
    if (!room) return
    try { await navigator.clipboard.writeText(getInviteLink(room.code)); setCopied(true); setCopyFallback(false) }
    catch { setCopyFallback(true); inviteInput.current?.focus(); inviteInput.current?.select(); setError('Select and copy the invite link below.') }
  }

  async function shareInvite() {
    if (!room || sharing) return
    if (!navigator.share) { await copyInvite(); return }
    setSharing(true)
    try {
      await navigator.share({
        title: 'Bitchbende',
        text: `Join my Bitchbende room (${room.code}).`,
        url: getInviteLink(room.code),
      })
    } catch (shareError) {
      // Dismissing the device's share menu should leave the room untouched.
      if (!(shareError instanceof Error && shareError.name === 'AbortError')) await copyInvite()
    } finally { setSharing(false) }
  }

  const status = <div className={`room-status${connection === 'offline' ? ' connection-offline' : ''}`} role="status"><span className="status-dot" /><span>{connection === 'online' ? 'Connected' : connection === 'connecting' ? 'Connecting…' : 'Connection lost · retrying automatically'}</span>{connection !== 'online' && <button className="text-button" type="button" onClick={() => setRetry((value) => value + 1)}>Retry now</button>}</div>
  const forgetControl = <>{forgetting ? <div className="notice"><p>Forgetting this room removes your saved seat. You cannot recover a hand already in play without it.</p><div className="room-actions"><button className="button button-secondary" type="button" onClick={() => setForgetting(false)}>Keep room</button><button className="button button-secondary" type="button" onClick={forgetRoom}>Forget room</button></div></div> : <button className="text-button" type="button" onClick={() => setForgetting(true)}>Forget saved room</button>}</>
  function backFromGame() { if (room?.status === 'finished') forgetRoom(); onBack() }

  if (room?.game && session) return <>
    <div className="online-statusbar"><span>Room <strong>{room.code}</strong> · {room.players.length} players</span>{status}<button className="text-button" type="button" onClick={() => { void copyInvite() }}><Icon name={copied ? 'check' : 'copy'} size={15} /> {copied ? 'Copied' : 'Copy invite'}</button><button className="text-button" type="button" disabled={sharing} onClick={() => { void shareInvite() }}><Icon name="share" size={15} /> {sharing ? 'Sharing…' : 'Share link'}</button><button className="text-button" type="button" onClick={backFromGame}>Back to menu</button>{room.status === 'finished' ? <button className="text-button" type="button" onClick={forgetRoom}>Leave finished room</button> : forgetControl}</div>
    {copyFallback && <div className="online-connection-notice"><input ref={inviteInput} className="field-input" aria-label="Invite link" readOnly value={getInviteLink(room.code)} onFocus={(event) => event.target.select()} /></div>}
    {connectionError && <div className="online-connection-notice notice error-notice" role="alert">{connectionError} Your seat and latest confirmed game are kept while reconnecting.</div>}
    {error && <div className="online-connection-notice notice error-notice" role="alert">{error}</div>}
    <fieldset className="online-game-controls" disabled={connection !== 'online'}><legend className="sr-only">Online game</legend>{renderGame(session, room, backFromGame)}</fieldset>
  </>

  return <main className="app-shell online-layout">
    <div className="page-intro online-heading"><div><h1 className="page-title">Play online with friends</h1><p className="page-subtitle">2–4 players. No computer opponents.</p></div><button className="button button-secondary" type="button" onClick={onBack}><Icon name="home" size={16} /> Back</button></div>
    {credentials ? <section className="panel lobby-form room-lobby">
      {status}
      <h2>{room ? 'Your room' : 'Rejoining your room'}</h2>
      <p className="form-subtitle">{room ? 'Share the code or link with your friends.' : 'Restoring the seat saved on this browser.'}</p>
      <div className="room-code" aria-label={`Room code ${credentials.code}`}>{credentials.code}</div>
      {room && <>
        <div className="room-invite"><input ref={inviteInput} className="field-input" aria-label="Invite link" readOnly value={getInviteLink(room.code)} onFocus={(event) => event.target.select()} /><button className="button button-secondary" type="button" onClick={() => { void copyInvite() }}><Icon name={copied ? 'check' : 'copy'} size={16} /> {copied ? 'Copied' : 'Copy link'}</button><button className="button button-secondary" type="button" disabled={sharing} onClick={() => { void shareInvite() }}><Icon name="share" size={16} /> {sharing ? 'Sharing…' : 'Share link'}</button></div>
        <div className="seat-list"><div className="seat-list-heading"><span>PLAYERS</span><span>{room.players.length} / 4 seats · {room.rounds} rounds</span></div>{room.players.map((player, index) => <div className="bot-seat" key={player.id}><span className={`avatar avatar-${COLORS[index]}`}>{player.name[0]?.toUpperCase() || '?'}</span><span>{player.name}</span><span className="seat-type">{player.id === room.hostId ? 'Host' : player.id === credentials.playerId ? 'You' : 'Player'}</span><span className="seat-ready"><Icon name="check" size={15} /></span></div>)}{Array.from({ length: 4 - room.players.length }, (_, index) => <div className="bot-seat room-seat-empty" key={`empty-${index}`}><span className="avatar"><Icon name="users" size={16} /></span><span>Open seat</span><span className="seat-type">Invite a friend</span></div>)}</div>
        {room.hostId === credentials.playerId ? <><button className="button button-primary start-button" type="button" disabled={busy || connection !== 'online' || room.players.length < 2} onClick={() => { void mutate('start') }}>{busy ? 'Starting…' : 'Start game'}<Icon name="play" size={17} /></button><p className="local-note">{room.players.length < 2 ? 'At least one friend must join before you can start.' : `Start with ${room.players.length} players when everyone has joined. Players cannot join after the game starts.`}</p></> : <p className="notice">Waiting for {room.players.find((player) => player.id === room.hostId)?.name || 'the host'} to start the game. Keep this page open.</p>}
        <div className="room-actions"><button className="text-button" type="button" disabled={busy || connection !== 'online'} onClick={() => { void mutate('leave') }}>Leave room</button><button className="text-button" type="button" onClick={onRules}>How to play <Icon name="help" size={15} /></button></div>
      </>}
      {connectionError && <div className="notice error-notice" role="alert">{connectionError}</div>}
      {error && <div className="notice error-notice" role="alert">{error}</div>}
      {connection !== 'online' && forgetControl}
      <p className="local-note">Your seat is saved on this browser so you can refresh and rejoin.</p>
    </section> : <>
      {configurationError && <div className="notice error-notice" role="alert">{configurationError}</div>}
      <div className="online-forms">
        <section className="panel lobby-form"><h2>Create a room</h2><p className="form-subtitle">You choose when to start after your friends join.</p><form onSubmit={(event) => { void enterRoom('create', event) }}>
          <label className="field"><span>Your name</span><input className="field-input" autoComplete="nickname" maxLength={20} placeholder="Player name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} required /></label>
          <label className="field"><span>Number of rounds</span><select className="field-input" value={rounds} onChange={(event) => setRounds(Number(event.target.value))} disabled={busy}><option value={3}>3 rounds</option><option value={6}>6 rounds</option><option value={10}>10 rounds</option></select></label>
          <button className="button button-primary start-button" type="submit" disabled={busy || !!configurationError}>Create room <Icon name="arrow" size={17} /></button>
        </form></section>
        <section className="panel lobby-form"><h2>Join a room</h2><p className="form-subtitle">Enter the code your friend shared with you.</p><form onSubmit={(event) => { void enterRoom('join', event) }}>
          <label className="field"><span>Your name</span><input className="field-input" autoComplete="nickname" maxLength={20} placeholder="Player name" value={name} onChange={(event) => setName(event.target.value)} disabled={busy} required /></label>
          <label className="field"><span>Room code</span><input className="field-input room-code-input" autoComplete="off" autoCapitalize="characters" spellCheck={false} maxLength={8} minLength={4} placeholder="ABC123" value={code} onChange={(event) => setCode(normalizeRoomCode(event.target.value))} disabled={busy} required /></label>
          <button className="button button-primary start-button" type="submit" disabled={busy || !!configurationError}>Join room <Icon name="users" size={17} /></button>
        </form></section>
      </div>
      {error && <div className="notice error-notice" role="alert">{error}</div>}
      <button className="text-button lobby-rules-link" type="button" onClick={onRules}>How to play <Icon name="chevron" size={14} /></button>
    </>}
  </main>
}
