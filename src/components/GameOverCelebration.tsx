import { useEffect, useEffectEvent, useRef, useState, type CSSProperties } from 'react'
import { createPortal } from 'react-dom'
import { playWinFanfare } from '../game/audio'
import { Beaver } from './Beaver'
import './GameOverCelebration.css'

export function GameOverCelebration({ winners, winnerCount, score, soundEnabled }: {
  winners: string
  winnerCount: number
  score: number
  soundEnabled: boolean
}) {
  const stopSound = useRef<() => void>(() => {})
  const [visible, setVisible] = useState(true)
  const playSound = useEffectEvent(() => soundEnabled ? playWinFanfare() : () => {})
  useEffect(() => {
    const stop = playSound()
    stopSound.current = stop
    const timeout = window.setTimeout(() => setVisible(false), 6500)
    return () => { window.clearTimeout(timeout); stop() }
  }, [])
  if (!visible) return null
  return createPortal(<div className="match-celebration" role="status" aria-live="polite">
    <div className="celebration-rays" aria-hidden="true" />
    <div className="celebration-confetti" aria-hidden="true">{Array.from({ length: 44 }, (_, index) => <i key={index} style={{ '--left': `${(index * 37) % 100}%`, '--delay': `${-(index % 13) * .31}s`, '--duration': `${2.7 + index % 5 * .35}s`, '--color': ['#ffcf56', '#e77c6b', '#b49ce5', '#fff9d3'][index % 4], '--drift': `${(index % 2 ? 1 : -1) * (35 + index % 4 * 20)}px` } as CSSProperties} />)}</div>
    <span className="celebration-trophy trophy-left" aria-hidden="true">🏆</span>
    <span className="celebration-trophy trophy-right" aria-hidden="true">🏆</span>
    <div className="celebration-burst">
      <div className="celebration-beaver" aria-hidden="true"><Beaver /><span>👑</span></div>
      <span className="celebration-kicker">MATCH COMPLETE</span>
      <strong>{winners}</strong>
      <span className="celebration-winner">{winnerCount > 1 ? 'SHARE THE WIN!' : 'TAKES THE WIN!'}</span>
      <p>{score} total points · lowest score wins</p>
      <button className="button celebration-dismiss" onClick={() => { setVisible(false); stopSound.current() }}>View results</button>
    </div>
  </div>, document.body)
}
