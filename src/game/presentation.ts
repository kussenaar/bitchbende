import type { PublicCardMove } from './types.ts'

type AnimatedCardMove = Extract<PublicCardMove, { type: 'replace' | 'swap' }>

/** Observers need extra time to register which hidden hand position changed. */
export function cardMoveTiming(move: AnimatedCardMove, viewerId: string) {
  return move.type === 'replace' && move.playerId !== viewerId
    ? { flightMs: 3000, landingMs: 1200, reducedMs: 4200 }
    : { flightMs: 1500, landingMs: 500, reducedMs: 900 }
}
