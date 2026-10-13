let context: AudioContext | undefined
let soundEnabled = true
let stopCurrent: (() => void) | undefined

export function setGameSound(enabled: boolean) {
  soundEnabled = enabled
  if (!enabled) stopCurrent?.()
}

/** Call from a user gesture so browsers allow the later multiplayer alarm. */
export function stopCallSiren() { stopCurrent?.() }

export function unlockGameAudio() {
  if (!soundEnabled) return
  try {
    context ??= new AudioContext()
    if (context.state === 'suspended') void context.resume().catch(() => {})
  } catch { /* Sound is optional on browsers without Web Audio. */ }
}

export function playCallSiren() {
  if (!soundEnabled || !context || context.state !== 'running') return () => {}
  stopCurrent?.()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const now = context.currentTime
  oscillator.type = 'triangle'
  oscillator.frequency.setValueAtTime(440, now)
  for (let pulse = 0; pulse < 5; pulse++) {
    oscillator.frequency.linearRampToValueAtTime(760, now + pulse * .6 + .3)
    oscillator.frequency.linearRampToValueAtTime(440, now + pulse * .6 + .6)
  }
  gain.gain.setValueAtTime(0, now)
  gain.gain.linearRampToValueAtTime(.075, now + .07)
  gain.gain.setValueAtTime(.075, now + 2.8)
  gain.gain.linearRampToValueAtTime(0, now + 3.1)
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + 3.2)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    oscillator.stop()
    oscillator.disconnect()
    gain.disconnect()
    if (stopCurrent === stop) stopCurrent = undefined
  }
  oscillator.onended = stop
  stopCurrent = stop
  return stop
}

export function playWinFanfare() {
  if (!soundEnabled || !context || context.state !== 'running') return () => {}
  stopCurrent?.()
  const oscillator = context.createOscillator()
  const gain = context.createGain()
  const now = context.currentTime
  oscillator.type = 'triangle'
  gain.gain.setValueAtTime(0, now)
  const notes = [523.25, 659.25, 783.99, 1046.5, 783.99, 1046.5]
  notes.forEach((frequency, index) => {
    const start = now + index * .2
    oscillator.frequency.setValueAtTime(frequency, start)
    gain.gain.setValueAtTime(0, start)
    gain.gain.linearRampToValueAtTime(.075, start + .025)
    gain.gain.linearRampToValueAtTime(0, start + (index === 5 ? .65 : .18))
  })
  oscillator.connect(gain)
  gain.connect(context.destination)
  oscillator.start(now)
  oscillator.stop(now + 1.7)
  let stopped = false
  const stop = () => {
    if (stopped) return
    stopped = true
    oscillator.stop()
    oscillator.disconnect()
    gain.disconnect()
    if (stopCurrent === stop) stopCurrent = undefined
  }
  oscillator.onended = stop
  stopCurrent = stop
  return stop
}
