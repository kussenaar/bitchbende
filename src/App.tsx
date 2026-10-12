import { useEffect, useRef, useState, useSyncExternalStore } from 'react'
import { CallAlarm } from './components/CallAlarm'
import { CardMotion } from './components/CardMotion'
import { OnlineRoom } from './components/OnlineRoom'
import { StartLobby } from './components/StartLobby'
import { hasSavedRoom, getInviteCode } from './game/online'
import { setGameSound, stopCallSiren, unlockGameAudio } from './game/audio'
import { Beaver } from './components/Beaver'
import { Card } from './components/Card'
import { Dialog } from './components/Dialog'
import { Icon } from './components/Icon'
import { RulesDialog } from './components/RulesDialog'
import { clearLocalSession, createLocalSession, restoreLocalSession } from './game/session'
import type { GameSession } from './game/session'
import type { GameAction, GameView } from './game/types'
import './App.css'

const COLORS = ['coral', 'gold', 'lavender', 'sage']
const POWER_NAMES = { peek: 'Peek', swap: 'Swap', draw: 'Draw two' }

function describeTurn(view: GameView, ownId: string, selectedSlot: number | null): { title: string; text: string } {
  const me = view.players.find((player) => player.id === ownId)!
  const activeName = view.players.find((player) => player.id === view.currentPlayerId)?.name || 'The next player'
  if (view.phase === 'initial') return me.ready ? { title: 'Waiting for the other players', text: 'Your cards are hidden. The round starts when everyone is ready.' } : { title: 'View your starting cards', text: 'Remember your two outside cards, then hide them to start the round.' }
  if (view.phase === 'round-over' || view.phase === 'game-over') return { title: view.phase === 'game-over' ? 'Match complete' : 'Round complete', text: 'All four card values count. The lowest score wins.' }
  if (view.currentPlayerId !== ownId) return { title: `${activeName}’s turn`, text: view.knockedBy ? 'Each remaining player has one final turn.' : 'The face-up discard can be taken on the next turn if it is a number card.' }
  switch (view.phase) {
    case 'draw': return { title: 'Choose a card', text: 'Draw from the deck, or take the face-up discard to replace one of your cards.' }
    case 'choose': return { title: view.drawn?.kind === 'number' ? `Card value: ${view.drawn.value}` : `${view.drawn ? POWER_NAMES[view.drawn.kind as keyof typeof POWER_NAMES] : 'Power'} card`, text: view.drawnSource === 'discard' ? 'Choose one of your cards to replace. Your replaced card goes face up on the discard pile.' : view.drawsRemaining ? 'Use this card and stop, or discard it for your second draw.' : 'Click a card in your hand to replace it, or choose an action below. Replaced cards go face up on the discard pile.' }
    case 'peek-target': return { title: 'Choose a card to peek at', text: 'Select one of your four cards. Only you will see it.' }
    case 'peeking': return { title: 'View your card', text: 'Remember its value, then hide it to finish your move.' }
    case 'swap-target': return { title: selectedSlot === null ? 'Choose your card to swap' : 'Choose an opponent’s card', text: selectedSlot === null ? 'Select one of your cards, then one from another player. They exchange places without being revealed.' : `Your card ${selectedSlot + 1} is selected. Select an opponent’s card to exchange the two face down.` }
    case 'draw-again': return { title: 'Draw your second card', text: 'You can use the second card or discard it.' }
    case 'end-turn': return { title: 'Finish your turn', text: view.knockedBy ? 'End your final turn. All cards are revealed after the remaining turns.' : 'End your turn, or call Bitchbende if you think your score is the lowest.' }
    default: return { title: 'Waiting for the next turn', text: 'The next player will act shortly.' }
  }
}

function Scoreboard({ view, ownId }: { view: GameView; ownId: string }) {
  const best = Math.min(...view.players.map((player) => player.totalScore))
  return <section className="panel scoreboard"><div className="panel-header"><h2>Scores</h2><span className="panel-caption">TOTAL POINTS</span></div><div className="score-list">{view.players.map((player, index) => <div className={`score-row${player.totalScore === best && view.roundResult ? ' score-best' : ''}`} key={player.id}><span className={`avatar avatar-${COLORS[index]}`}>{player.name[0].toUpperCase()}</span><span className="score-player"><strong>{player.name}{player.id === ownId && <small>you</small>}</strong><span>{player.roundScores.length ? player.roundScores.join(' + ') : 'No rounds completed'}</span></span><span className="score-value">{player.totalScore}<small>pts</small></span></div>)}</div><p className="score-footer"><Icon name="trophy" size={14} /> Lowest total after {view.totalRounds} rounds wins.</p></section>
}

function RoundSummary({ view, ownId, onAction, onNewGame, canAdvanceRound }: { view: GameView; ownId: string; onAction: (action: GameAction) => void; onNewGame: () => void; canAdvanceRound: boolean }) {
  const matchOver = view.phase === 'game-over'
  const winnerIds = matchOver ? view.winners : view.roundResult?.winners || []
  const winnerNames = view.players.filter((player) => winnerIds.includes(player.id)).map((player) => player.id === ownId ? 'You' : player.name).join(' & ')
  const replacements = view.roundResult?.replacements || []
  return <section className="round-summary" aria-live="polite"><div className="summary-icon"><Icon name="trophy" size={28} /></div><span className="eyebrow">{matchOver ? 'MATCH COMPLETE' : `ROUND ${view.round} COMPLETE`}</span><h2>{winnerNames} {winnerIds.length > 1 || winnerIds[0] === ownId ? 'win' : 'wins'} {matchOver ? 'the match' : 'the round'}</h2><p>{matchOver ? 'The player with the lowest total score wins. You can start a new match below.' : 'Round scores are added to each player’s total.'}</p><div className="round-scores" style={{ gridTemplateColumns: `repeat(${view.players.length}, minmax(0, 1fr))` }}>{view.players.map((player) => <div className={winnerIds.includes(player.id) ? 'round-score is-winner' : 'round-score'} key={player.id}><span>{player.name}</span><strong>{view.roundResult?.scores[player.id]}<small> pts</small></strong></div>)}</div>{replacements.length > 0 && <details className="replacement-details"><summary>{replacements.length} power {replacements.length === 1 ? 'card was' : 'cards were'} replaced for scoring</summary><ul>{replacements.map((entry, index) => <li key={index}>{view.players.find((player) => player.id === entry.playerId)?.name} · card {entry.slot + 1}: {POWER_NAMES[entry.from.kind as keyof typeof POWER_NAMES]} → {entry.to.kind === 'number' ? entry.to.value : '—'}</li>)}</ul></details>}{!matchOver && !canAdvanceRound ? <p className="room-status">Waiting for the host to deal the next round.</p> : <button className="button button-primary" onClick={() => matchOver ? onNewGame() : onAction({ type: 'next-round' })}>{matchOver ? 'Back to games' : `Deal round ${view.round + 1}`}<Icon name="arrow" size={17} /></button>}</section>
}

function GameTable({ session, onNewGame, onRules, soundEnabled, roomCode, canAdvanceRound = true }: { session: GameSession; onNewGame: () => void; onRules: () => void; soundEnabled: boolean; roomCode?: string; canAdvanceRound?: boolean }) {
  const view = useSyncExternalStore(session.subscribe, session.getSnapshot)
  const [selection, setSelection] = useState<{ revision: number; slot: number } | null>(null)
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [animating, setAnimating] = useState(false)
  const tableRef = useRef<HTMLDivElement>(null)
  const activityRef = useRef<HTMLDivElement>(null)
  const ownId = session.viewerId
  const me = view.players.find((player) => player.id === ownId)!
  const myTurn = view.currentPlayerId === ownId
  const over = view.phase === 'round-over' || view.phase === 'game-over'
  const selectedSlot = selection?.revision === view.revision ? selection.slot : null
  const message = describeTurn(view, ownId, selectedSlot)
  const activeName = view.players.find((player) => player.id === view.currentPlayerId)?.name
  const caller = view.players.find((player) => player.id === view.knockedBy)?.name
  const lastAction = myTurn && view.phase === 'end-turn' ? [...view.log].reverse().find((entry) => entry.playerId === ownId && entry.round === view.round)?.text : undefined
  const online = session.mode === 'online'
  const botCount = view.players.length - 1
  const seats = view.players.length === 2 ? ['seat-bottom', 'seat-top'] : view.players.length === 3 ? ['seat-bottom', 'seat-left', 'seat-right'] : ['seat-bottom', 'seat-left', 'seat-top', 'seat-right']
  const ownIndex = view.players.findIndex((player) => player.id === ownId)
  useEffect(() => { session.start(); return () => session.stop() }, [session])
  useEffect(() => { if (!error) return; const timeout = setTimeout(() => setError(''), 5000); return () => clearTimeout(timeout) }, [error])
  useEffect(() => { activityRef.current?.scrollTo({ top: 0, behavior: 'smooth' }) }, [view.log.length])

  async function act(action: GameAction) {
    if (busy || animating) return
    setBusy(true); setError('')
    try { const result = await session.dispatch(action); if (!result.ok) setError(result.error) }
    catch { setError('That move didn’t go through. Please try again.') }
    finally { setBusy(false) }
  }
  function chooseCard(playerId: string, slot: number) {
    if (!myTurn || busy || animating || over) return
    if (playerId === ownId) {
      if (view.phase === 'choose') void act({ type: 'replace', slot })
      else if (view.phase === 'peek-target') void act({ type: 'peek', slot })
      else if (view.phase === 'swap-target') setSelection({ revision: view.revision, slot })
    } else if (view.phase === 'swap-target' && selectedSlot !== null) void act({ type: 'swap', ownSlot: selectedSlot, targetPlayerId: playerId, targetSlot: slot })
  }

  return <main className="app-shell">
    <CallAlarm callKey={view.knockedBy && !over ? `${view.round}:${view.knockedBy}` : null} caller={caller} soundEnabled={soundEnabled} onMute={stopCallSiren} />
    <div className="page-intro"><div><h1 className="page-title">{online ? `Room ${roomCode}` : 'Computer game'}</h1><p className="page-subtitle">{online ? `${view.players.length} players · friends only` : `You and ${botCount} computer ${botCount === 1 ? 'opponent' : 'opponents'}.`}</p></div><button className="button button-secondary new-table-button" onClick={onNewGame}><Icon name={online ? "home" : "shuffle"} size={16} /> {online ? 'Leave table' : 'New match'}</button></div>
    <div className="game-layout"><div className="game-main">
      <div className="table-toolbar"><div className="table-info"><span className="badge badge-live"><span className="status-dot" /> {online ? 'ONLINE TABLE' : 'COMPUTER TABLE'}</span><span className="table-player-count"><Icon name="users" size={15} /> {view.players.length} players</span></div><span className="round-chip">ROUND <strong>{view.round}</strong><span>/ {view.totalRounds}</span></span></div>
      {caller && !over && <div className="final-round-banner" role="status"><span className="banner-siren" aria-hidden="true">🚨</span><div><strong>BITCHBENDE!</strong><span>{caller} called it · {view.finalTurnsRemaining} final {view.finalTurnsRemaining === 1 ? 'turn' : 'turns'} left</span></div><span className="banner-beaver" aria-hidden="true"><Beaver variant="face" /></span></div>}
      <div className={`table-stage table-players-${view.players.length}${myTurn && view.phase === 'swap-target' ? ' table-selecting-swap' : ''}${over ? ' table-revealed' : ''}${caller && !over ? ' table-alarm-active' : ''}`}><div className="game-table" ref={tableRef}><div className="table-grain" />
        {view.players.map((player, playerIndex) => {
          const self = player.id === ownId
          const interactive = !busy && !animating && myTurn && !over && (self ? ['choose', 'peek-target', 'swap-target'].includes(view.phase) : view.phase === 'swap-target' && selectedSlot !== null)
          return <section key={player.id} data-player-id={player.id} className={`player-seat ${seats[(playerIndex - ownIndex + view.players.length) % view.players.length]}${self ? ' is-self' : ''}${view.phase !== 'initial' && !over && player.id === view.currentPlayerId ? ' is-active' : ''}`} aria-label={`${player.name}’s hand`}><div className="player-meta"><span className={`avatar avatar-${COLORS[playerIndex]}`}>{player.name[0].toUpperCase()}</span><div><span className="player-name">{player.name}{self && <small>YOU</small>}{view.dealerIndex === playerIndex && <span className="dealer-token" title="Dealer">D</span>}</span><span className="player-status">{over ? `${view.roundResult?.scores[player.id]} points` : view.phase === 'initial' ? player.ready ? 'Ready to play' : 'Viewing starting cards' : player.id === view.knockedBy ? 'Called Bitchbende' : player.id === view.currentPlayerId ? self ? 'Your turn' : online ? 'Their turn' : 'Thinking…' : self ? 'Waiting for your turn' : online ? 'Waiting for their turn' : 'Computer opponent'}</span></div>{!over && view.phase !== 'initial' && player.id === view.currentPlayerId && <span className="turn-indicator" />}</div><div className="hand">{player.hand.map((card, slot) => <div className="hand-slot" data-card-slot={slot} key={slot}><Card card={card || undefined} faceUp={card !== null} small={!self} selected={self && selectedSlot === slot} onClick={interactive ? () => chooseCard(player.id, slot) : undefined} label={interactive ? `${self ? 'Your' : player.name + '’s'} card ${slot + 1}${view.phase === 'choose' ? ': replace this card' : view.phase === 'peek-target' ? ': peek at this card' : ': select for swap'}` : card ? `${player.name}’s card ${slot + 1}: ${card.kind === 'number' ? card.value : POWER_NAMES[card.kind]}` : `${player.name}’s card ${slot + 1}, face down`} /><span className="slot-number">{slot + 1}</span></div>)}</div></section>
        })}
        <div className="table-center"><div className="table-watermark"><Beaver variant="face" /><span>BITCHBENDE</span></div><div className="pile-area"><div className="pile" data-pile="deck"><div className="card-stack"><Card onClick={myTurn && view.phase === 'draw' && !busy && !animating ? () => { void act({ type: 'draw', source: 'deck' }) } : myTurn && view.phase === 'draw-again' && !busy && !animating ? () => { void act({ type: 'draw-again' }) } : undefined} label="Draw a card from the deck" /></div><span className="pile-label">DRAW PILE <span>{view.deckCount} left</span></span></div><div className="pile" data-pile="discard"><Card key={view.discard?.id ?? 'empty-discard'} card={view.discard || undefined} faceUp={!!view.discard} onClick={myTurn && view.phase === 'draw' && view.discard?.kind === 'number' && !busy && !animating ? () => { void act({ type: 'draw', source: 'discard' }) } : undefined} label={view.discard ? `${view.discard.kind === 'number' ? `Take ${view.discard.value} from the discard pile` : `${POWER_NAMES[view.discard.kind]} on discard pile, cannot be taken`}` : 'Discard pile'} /><span className="pile-label">DISCARD PILE <span>Face up</span></span></div></div></div>
      </div></div>
      <CardMotion view={view} tableRef={tableRef} onAnimatingChange={setAnimating} />
      {over ? <RoundSummary view={view} ownId={ownId} onAction={(action) => { void act(action) }} onNewGame={onNewGame} canAdvanceRound={canAdvanceRound} /> : <section className={`action-panel${myTurn || view.phase === 'initial' ? ' action-panel-active' : ''}`} aria-label="Your actions">{view.drawn && myTurn && <div className="drawn-area"><span className="drawn-label">{view.drawnSource === 'discard' ? 'TAKEN FROM DISCARD' : 'DRAWN CARD'}</span><Card card={view.drawn} faceUp small /><span className="drawn-hint">{view.drawn.kind === 'number' ? `${view.drawn.value} points` : POWER_NAMES[view.drawn.kind]}</span></div>}<div className="action-heading"><span className="action-icon"><Icon name={view.phase === 'initial' || view.phase === 'peek-target' || view.phase === 'peeking' ? 'eye' : view.phase === 'swap-target' ? 'swap' : myTurn ? 'sparkles' : 'users'} size={22} /></span><div aria-live="polite"><span className="turn-kicker">{view.phase === 'initial' ? 'ROUND SETUP' : myTurn ? 'YOUR TURN' : `${activeName?.toUpperCase()}’S TURN`}</span><h2>{message.title}</h2><p>{message.text}</p>{lastAction && <p className="last-action">{lastAction}</p>}</div></div><div className="action-buttons">
        {view.phase === 'initial' && !me.ready && <button className="button button-primary" disabled={busy || animating} onClick={() => { void act({ type: 'ready' }) }}><Icon name="check" size={17} /> Hide my cards</button>}
        {myTurn && view.phase === 'draw' && <><button className="button button-primary" disabled={busy || animating} onClick={() => { void act({ type: 'draw', source: 'deck' }) }}><Icon name="draw" size={17} /> Draw a card</button><button className="button button-secondary" disabled={busy || animating || view.discard?.kind !== 'number'} onClick={() => { void act({ type: 'draw', source: 'discard' }) }}>Take discard{view.discard?.kind === 'number' ? ` · ${view.discard.value}` : ''}</button></>}
        {myTurn && view.phase === 'choose' && view.drawnSource === 'deck' && <>{view.drawn && view.drawn.kind !== 'number' && <button className="button button-primary" disabled={busy || animating} onClick={() => { void act({ type: 'use-power' }) }}><Icon name={view.drawn.kind === 'peek' ? 'eye' : view.drawn.kind === 'swap' ? 'swap' : 'draw'} size={17} /> Use {POWER_NAMES[view.drawn.kind]}</button>}<button className="button button-secondary" disabled={busy || animating} onClick={() => { void act({ type: 'discard' }) }}>{view.drawsRemaining ? 'Discard & draw another' : 'Discard this card'}</button><span className="action-hint">Or click a card in your hand to replace it.</span></>}
        {myTurn && view.phase === 'peeking' && <button className="button button-primary" disabled={busy || animating} onClick={() => { void act({ type: 'finish-peek' }) }}><Icon name="check" size={17} /> Hide card</button>}
        {myTurn && view.phase === 'swap-target' && <><button className="button button-secondary" disabled={busy || animating} onClick={() => { void act({ type: 'skip' }) }}>Skip swap</button>{selectedSlot !== null && <button className="text-button" onClick={() => setSelection(null)}>Change my selection</button>}</>}
        {myTurn && view.phase === 'draw-again' && <button className="button button-primary" disabled={busy || animating} onClick={() => { void act({ type: 'draw-again' }) }}><Icon name="draw" size={17} /> Draw your second card</button>}
        {myTurn && view.phase === 'end-turn' && <><button className="button button-primary" disabled={busy || animating} onClick={() => { void act({ type: 'end-turn' }) }}>End turn <Icon name="arrow" size={17} /></button>{!view.knockedBy && <button className="button button-knock" disabled={busy || animating} onClick={() => { void act({ type: 'knock' }) }}><Icon name="flag" size={17} /> Call Bitchbende</button>}</>}
        {!myTurn && view.phase !== 'initial' && <span className="thinking-dots" aria-label={online ? 'Waiting for another player' : 'Computer opponent is thinking'}><i /><i /><i /></span>}
      </div></section>}
      {error && <div className="notice error-notice" role="alert">{error}</div>}<div className="table-tip"><Icon name="eye" size={15} /><span>{over ? 'Power cards in a hand are replaced with number cards for scoring.' : 'Replaced cards go face up on the discard pile. The next player may take the top number card.'}</span></div>
    </div><aside className="sidebar"><Scoreboard view={view} ownId={ownId} /><section className="panel activity-panel"><div className="panel-header"><h2>Activity</h2><span className="live-dot" /></div><div className="activity-list" ref={activityRef} aria-label="Recent game activity">{[...view.log].reverse().slice(0, 14).map((entry, index) => <div className={`activity-item${index === 0 ? ' activity-latest' : ''}`} key={entry.id}><span className="activity-dot" /><div><p>{entry.text}</p><span>Round {entry.round}</span></div></div>)}</div></section><button className="rules-teaser" onClick={onRules}><span className="rules-teaser-icon"><Icon name="help" size={24} /></span><span><strong>How to play</strong><small>Rules and card powers</small></span><Icon name="chevron" size={17} /></button><p className="local-table-note"><span className="status-dot" /> {online ? `${view.players.length} friends · no computers` : `You + ${botCount} computer ${botCount === 1 ? 'opponent' : 'opponents'}`}<br /><span>{online ? 'This browser remembers your seat.' : 'Progress saves on this browser.'}</span></p></aside></div>
  </main>
}

function initiallyOnline() {
  if (getInviteCode()) return true
  try { return hasSavedRoom() && localStorage.getItem('bitchbende.active-mode') !== 'local' }
  catch { return hasSavedRoom() }
}

function rememberMode(mode: 'local' | 'online') {
  try { localStorage.setItem('bitchbende.active-mode', mode) } catch { /* Optional preference. */ }
}

function App() {
  const [online, setOnline] = useState(initiallyOnline)
  const [session, setSession] = useState<GameSession | null>(() => initiallyOnline() ? null : restoreLocalSession())
  const [rulesOpen, setRulesOpen] = useState(false)
  const [leaveOpen, setLeaveOpen] = useState(false)
  const [soundEnabled, setSoundEnabled] = useState(() => {
    try { return localStorage.getItem('bitchbende.sound') !== 'off' } catch { return true }
  })
  useEffect(() => {
    setGameSound(soundEnabled)
    const unlock = () => unlockGameAudio()
    window.addEventListener('pointerdown', unlock, { capture: true })
    window.addEventListener('keydown', unlock, { capture: true })
    return () => { window.removeEventListener('pointerdown', unlock, true); window.removeEventListener('keydown', unlock, true) }
  }, [soundEnabled])
  function toggleSound() {
    const enabled = !soundEnabled
    setGameSound(enabled)
    if (enabled) unlockGameAudio()
    setSoundEnabled(enabled)
    try { localStorage.setItem('bitchbende.sound', enabled ? 'on' : 'off') } catch { /* Optional preference. */ }
  }
  function newTable() { session?.stop(); clearLocalSession(); setSession(null); setLeaveOpen(false) }
  function backFromOnline() {
    rememberMode('local')
    setOnline(false)
    const url = new URL(window.location.href)
    url.searchParams.delete('room')
    window.history.replaceState(null, '', url)
  }
  return <>
    <header className="site-header"><a className="brand" href="#" aria-label="Bitchbende home" onClick={(event) => { event.preventDefault(); if (session) setLeaveOpen(true); else if (online) backFromOnline() }}><Beaver variant="logo" /><span className="brand-name">Bitchbende</span></a><div className="header-actions"><button className="button button-ghost sound-toggle" onClick={toggleSound} aria-label={soundEnabled ? 'Mute game sound' : 'Enable game sound'} aria-pressed={soundEnabled}><Icon name={soundEnabled ? 'sound' : 'muted'} size={17} /><span>Sound {soundEnabled ? 'on' : 'off'}</span></button><button className="button button-ghost" onClick={() => setRulesOpen(true)}><Icon name="help" size={17} /> How to play</button></div></header>
    {online ? <OnlineRoom onBack={backFromOnline} onRules={() => setRulesOpen(true)} renderGame={(onlineSession, room, onLeave) => <GameTable session={onlineSession} roomCode={room.code} canAdvanceRound={room.hostId === onlineSession.viewerId} soundEnabled={soundEnabled} onNewGame={onLeave} onRules={() => setRulesOpen(true)} />} /> : session ? <GameTable session={session} soundEnabled={soundEnabled} onNewGame={() => setLeaveOpen(true)} onRules={() => setRulesOpen(true)} /> : <StartLobby onStart={(name, rounds, botCount) => { rememberMode('local'); setSession(createLocalSession(name, rounds, botCount)) }} onOnline={() => { rememberMode('online'); setOnline(true) }} onRules={() => setRulesOpen(true)} />}
    <RulesDialog open={rulesOpen} onClose={() => setRulesOpen(false)} /><Dialog open={leaveOpen} onClose={() => setLeaveOpen(false)} title="Start a new match?"><p className="confirm-copy">This will end your current computer match and clear its scores.</p><div className="confirm-actions"><button className="button button-secondary" onClick={() => setLeaveOpen(false)}>Keep playing</button><button className="button button-primary" onClick={newTable}>New match <Icon name="arrow" size={17} /></button></div></Dialog>
  </>
}

export default App
