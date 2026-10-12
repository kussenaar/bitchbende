import { useEffect, useRef, useState } from 'react'
import { playCallSiren } from '../game/audio'
import { Beaver } from './Beaver'

export function CallAlarm({ callKey, caller, soundEnabled, onMute }: {
  callKey: string | null
  caller: string | undefined
  soundEnabled: boolean
  onMute: () => void
}) {
  const previous = useRef(callKey)
  const sound = useRef(soundEnabled)
  sound.current = soundEnabled
  const [burst, setBurst] = useState<string | null>(null)
  useEffect(() => {
    if (previous.current === callKey) return
    previous.current = callKey
    if (!callKey) { setBurst(null); return }
    setBurst(callKey)
    const stop = sound.current ? playCallSiren() : () => {}
    const timeout = window.setTimeout(() => setBurst(null), 4400)
    return () => { window.clearTimeout(timeout); stop() }
  }, [callKey])
  if (!burst || burst !== callKey || !caller) return null
  return <div className="call-alarm" role="status" aria-live="assertive">
    <div className="alarm-wash" aria-hidden="true" />
    <div className="alarm-beacon alarm-beacon-left" aria-hidden="true">🚨</div>
    <div className="alarm-beacon alarm-beacon-right" aria-hidden="true">🚨</div>
    <div className="alarm-burst">
      <div className="alarm-beaver" aria-hidden="true"><Beaver variant="face" /></div>
      <strong>BITCHBENDE!</strong>
      <span>{caller} called it. Final turns!</span>
      <button className="button alarm-dismiss" onClick={() => { setBurst(null); onMute() }}>Dismiss alarm</button>
    </div>
  </div>
}
