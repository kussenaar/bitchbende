import { useState } from 'react'
import type { FormEvent } from 'react'
import { Beaver } from './Beaver'
import { Card } from './Card'
import { Icon } from './Icon'

const BOT_NAMES = ['Milo', 'Luna', 'Noor']
const COLORS = ['coral', 'gold', 'lavender', 'sage']

interface StartLobbyProps {
  onStart: (name: string, rounds: number, botCount: number) => void
  onOnline: () => void
  onRules: () => void
}

export function StartLobby({ onStart, onOnline, onRules }: StartLobbyProps) {
  const [name, setName] = useState('')
  const [rounds, setRounds] = useState(6)
  const [botCount, setBotCount] = useState(3)
  function start(event: FormEvent) { event.preventDefault(); onStart(name, rounds, botCount) }
  return <main className="lobby-layout">
    <section className="lobby-copy">
      <h1 className="lobby-title">Bitchbende</h1>
      <p className="lobby-description">A card game for 2–4 players. Keep the total value of your four cards as low as possible.</p>
      <div className="lobby-art" aria-hidden="true">
        <span className="art-orbit orbit-one" /><span className="art-orbit orbit-two" />
        <span className="art-spark spark-one">✳</span><span className="art-spark spark-two">✧</span>
        <div className="art-card art-card-one"><Card faceUp card={{ id: 'art-0', kind: 'number', value: 0 }} /></div>
        <div className="art-card art-card-two"><Card /></div>
        <div className="art-card art-card-three"><Card faceUp card={{ id: 'art-swap', kind: 'swap' }} /></div>
        <div className="art-mascot"><Beaver variant="face" /></div>
      </div>
      <div className="play-online-choice"><h3>Play online with friends</h3><p>Share a room code or link. Play with 2–4 people, without computers.</p><button className="button button-secondary" type="button" onClick={onOnline}><Icon name="users" size={18} /> Create or join a room</button></div>
    </section>
    <section className="lobby-form panel">
      <h2>Play against computers</h2>
      <p className="form-subtitle">Choose your opponents and start playing.</p>
      <form onSubmit={start}>
        <label className="field"><span>Your name</span><input className="field-input" autoComplete="nickname" maxLength={20} placeholder="Player name" value={name} onChange={(event) => setName(event.target.value)} /></label>
        <label className="field"><span>Computer opponents</span><select className="field-input" value={botCount} onChange={(event) => setBotCount(Number(event.target.value))}><option value={1}>1 computer · 2 players</option><option value={2}>2 computers · 3 players</option><option value={3}>3 computers · 4 players</option></select></label>
        <label className="field"><span>Number of rounds</span><select className="field-input" value={rounds} onChange={(event) => setRounds(Number(event.target.value))}><option value={3}>3 rounds</option><option value={6}>6 rounds</option><option value={10}>10 rounds</option></select></label>
        <div className="seat-list"><div className="seat-list-heading"><span>PLAYERS</span><span>{botCount + 1} / 4 seats</span></div>{[name.trim() || 'You', ...BOT_NAMES.slice(0, botCount)].map((player, index) => <div className="bot-seat" key={index}><span className={`avatar avatar-${COLORS[index]}`}>{index === 0 ? <Icon name="users" size={16} /> : player[0]}</span><span>{player}</span><span className="seat-type">{index === 0 ? 'You' : 'Computer'}</span><span className="seat-ready"><Icon name="check" size={15} /></span></div>)}</div>
        <button className="button button-primary start-button" type="submit">Start game <Icon name="arrow" size={18} /></button>
      </form>
      <p className="local-note"><span className="status-dot" /> Progress saves in this browser</p>
      <button className="text-button lobby-rules-link" onClick={onRules}>How to play <Icon name="chevron" size={14} /></button>
    </section>
  </main>
}
