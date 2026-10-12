export type Card =
  | { id: string; kind: 'number'; value: number }
  | { id: string; kind: 'peek' | 'swap' | 'draw' }

export type GamePhase =
  | 'initial'
  | 'draw'
  | 'choose'
  | 'peek-target'
  | 'peeking'
  | 'swap-target'
  | 'draw-again'
  | 'end-turn'
  | 'round-over'
  | 'game-over'

export type GameAction =
  | { type: 'ready' }
  | { type: 'draw'; source: 'deck' | 'discard' }
  | { type: 'replace'; slot: number }
  | { type: 'discard' }
  | { type: 'use-power' }
  | { type: 'peek'; slot: number }
  | { type: 'finish-peek' }
  | { type: 'swap'; ownSlot: number; targetPlayerId: string; targetSlot: number }
  | { type: 'skip' }
  | { type: 'draw-again' }
  | { type: 'end-turn' }
  | { type: 'knock' }
  | { type: 'next-round' }

export interface Player {
  id: string
  name: string
  hand: Card[]
  ready: boolean
  totalScore: number
  roundScores: number[]
}

/** Public card positions for animation. Hidden card identities never belong here. */
export type PublicCardMove =
  | {
    type: 'draw'
    revision: number
    playerId: string
    source: 'deck' | 'discard'
    /** Deck draws are face down; discard draws are already public. */
    card: Card | null
  }
  | {
    type: 'replace'
    revision: number
    playerId: string
    slot: number
    source: 'deck' | 'discard'
    /** Only a number taken from the face-up discard may be exposed. */
    incoming: Card | null
    discarded: Card
  }
  | {
    type: 'swap'
    revision: number
    playerId: string
    slot: number
    targetPlayerId: string
    targetSlot: number
  }
  | {
    type: 'discard'
    revision: number
    playerId: string
    card: Card
  }

export interface GameLog {
  id: number
  round: number
  playerId: string | null
  text: string
  /** Optional so saved games from before card-move animations still restore. */
  move?: PublicCardMove
}

export interface RoundResult {
  round: number
  scores: Record<string, number>
  winners: string[]
  replacements: { playerId: string; slot: number; from: Card; to: Card }[]
}

/** Private authoritative state. Never broadcast this object to multiplayer clients. */
export interface GameState {
  version: 1
  revision: number
  rng: number
  phase: GamePhase
  round: number
  totalRounds: number
  players: Player[]
  dealerIndex: number
  turnIndex: number
  turnNumber: number
  deck: Card[]
  discard: Card[]
  drawn: Card | null
  drawnSource: 'deck' | 'discard' | null
  drawsRemaining: number
  peekedSlot: number | null
  knockedBy: string | null
  finalTurnsRemaining: number | null
  log: GameLog[]
  nextLogId: number
  roundResult: RoundResult | null
  winners: string[]
  /** Only information each player has legitimately observed, including public card moves. */
  knowledge: Record<string, Record<string, (Card | null)[]>>
}

export interface PlayerView {
  id: string
  name: string
  hand: (Card | null)[]
  ready: boolean
  totalScore: number
  roundScores: number[]
}

/** Safe, serializable projection for one player, with unknown card identities removed. */
export interface GameView {
  phase: GamePhase
  round: number
  totalRounds: number
  revision: number
  turnIndex: number
  turnNumber: number
  currentPlayerId: string
  dealerIndex: number
  players: PlayerView[]
  deckCount: number
  discard: Card | null
  drawn: Card | null
  drawnSource: 'deck' | 'discard' | null
  drawsRemaining: number
  peekedSlot: number | null
  knockedBy: string | null
  finalTurnsRemaining: number | null
  log: GameLog[]
  roundResult: RoundResult | null
  winners: string[]
}

export type ActionResult = { ok: true; state: GameState } | { ok: false; error: string }
