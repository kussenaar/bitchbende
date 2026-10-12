import { applyAction, chooseBotAction, createGame, getPlayerView, isGameState } from './engine.ts'
import { cardMoveTiming } from './presentation.ts'
import { COMPUTERS } from './computers.ts'
import type { GameAction, GameState, GameView } from './types'

export const LOCAL_PLAYER_ID = 'you'
const STORAGE_KEY = 'bitchbende.local-game.v1'

export type DispatchResult = { ok: true } | { ok: false; error: string }

/** The UI consumes this shared interface for local and remote sessions. */
export interface GameSession {
  readonly mode: 'local' | 'online'
  readonly viewerId: string
  getSnapshot: () => GameView
  subscribe: (listener: () => void) => () => void
  dispatch: (action: GameAction) => Promise<DispatchResult>
  start: () => void
  stop: () => void
}

/** Local authoritative host. Full hands and bot memory never enter React props. */
export class LocalGameSession implements GameSession {
  readonly mode = 'local' as const
  readonly viewerId = LOCAL_PLAYER_ID
  private state: GameState
  private snapshot: GameView
  private listeners = new Set<() => void>()
  private timer: ReturnType<typeof setTimeout> | undefined
  private running = false
  private presentationUntil = 0

  constructor(state: GameState) {
    this.state = state
    this.snapshot = getPlayerView(state, this.viewerId)
  }

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }

  dispatch = async (action: GameAction): Promise<DispatchResult> => {
    const result = applyAction(this.state, this.viewerId, action)
    if (!result.ok) return { ok: false, error: result.error }
    this.commit(result.state)
    return { ok: true }
  }

  start = () => { this.running = true; this.scheduleBot() }
  stop = () => {
    this.running = false
    clearTimeout(this.timer)
    this.timer = undefined
  }

  save = () => {
    try { localStorage.setItem(STORAGE_KEY, JSON.stringify({ version: 1, state: this.state })) }
    catch { /* Private browsing and full storage must not interrupt play. */ }
  }

  private commit(state: GameState) {
    const previousRevision = this.state.revision
    this.state = state
    this.snapshot = getPlayerView(state, this.viewerId)
    for (const { move } of state.log) {
      if (move && move.revision > previousRevision && (move.type === 'replace' || move.type === 'swap')) {
        const { flightMs, landingMs } = cardMoveTiming(move, this.viewerId)
        this.presentationUntil = Math.max(this.presentationUntil, Date.now() + flightMs + landingMs + 300)
      }
    }
    this.save()
    this.listeners.forEach((listener) => listener())
    this.scheduleBot()
  }

  private scheduleBot() {
    clearTimeout(this.timer)
    this.timer = undefined
    if (!this.running) return
    const view = this.snapshot
    const actorId = view.phase === 'initial'
      ? view.players.find((player) => player.id !== this.viewerId && !player.ready)?.id
      : view.currentPlayerId
    if (!actorId || actorId === this.viewerId || view.phase === 'round-over' || view.phase === 'game-over') return
    this.timer = setTimeout(() => {
      const action = chooseBotAction(this.state, actorId)
      if (!action) return
      const result = applyAction(this.state, actorId, action)
      if (result.ok) this.commit(result.state)
    }, view.phase === 'initial' ? 180 : Math.max(750, this.presentationUntil - Date.now()))
  }
}

export function createLocalSession(name: string, rounds: number, botCount = 3): LocalGameSession {
  if (!Number.isInteger(botCount) || botCount < 1 || botCount > 3) throw new Error('Choose 1 to 3 computer opponents.')
  const seed = crypto.getRandomValues(new Uint32Array(1))[0]
  const computers = COMPUTERS.slice(0, botCount).map(({ id, name }) => ({ id, name }))
  const session = new LocalGameSession(createGame([
    { id: LOCAL_PLAYER_ID, name: name.trim().slice(0, 20) || 'You' },
    ...computers,
  ], { seed, rounds }))
  session.save()
  return session
}

export function restoreLocalSession(): LocalGameSession | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (saved?.version !== 1 || !isGameState(saved.state)) return null
    const state = saved.state
    if (state.players.length < 2 || state.players.length > 4 || state.players[0].id !== LOCAL_PLAYER_ID) return null
    return new LocalGameSession(state)
  } catch { return null }
}

export function clearLocalSession() {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* Optional persistence. */ }
}
