import type { GameAction, GameView } from './types.ts'
import type { ReactionId, TableReaction } from './reactions.ts'

/** The only room data sent to a browser; the game is projected for its seat. */
export interface RoomView {
  code: string
  hostId: string
  revision: number
  status: 'waiting' | 'playing' | 'finished'
  players: { id: string; name: string }[]
  rounds: number
  game: GameView | null
  reactions: TableReaction[]
}

/** Keep this credential on its owner's device; invite links contain only the code. */
export interface RoomCredentials {
  code: string
  playerId: string
  token: string
}

export type RoomRequest =
  | { operation: 'create'; name: string; rounds: number }
  | { operation: 'join'; code: string; name: string }
  | ({ operation: 'view' | 'start' | 'leave' } & RoomCredentials)
  | ({ operation: 'action'; revision: number; action: GameAction } & RoomCredentials)
  | ({ operation: 'react'; imageId: ReactionId } & RoomCredentials)

export interface RoomResponse {
  room: RoomView
  playerId?: string
  token?: string
}

export interface RoomErrorResponse {
  error: string
  code?: string
  room?: RoomView
}
