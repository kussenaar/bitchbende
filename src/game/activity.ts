import type { GameLog, Player } from './types.ts'

/** Activity is an action history, not a record of cards or their positions. */
export function activityText(entry: GameLog, players: readonly Pick<Player, 'id' | 'name'>[]): string {
  const player = players.find((candidate) => candidate.id === entry.playerId)
  if (!player) return entry.text
  const action = entry.text.startsWith(`${player.name} `) ? entry.text.slice(player.name.length + 1) : ''
  const move = entry.move

  // Also cover older saved games and rooms whose server still sends detailed text.
  if (move?.type === 'replace' || action.startsWith('replaced card ')) return `${player.name} replaced a card.`
  if (move?.type === 'swap' || action.startsWith('swapped card ')) {
    const target = move?.type === 'swap'
      ? players.find((candidate) => candidate.id === move.targetPlayerId)
      : players.find((candidate) => [1, 2, 3, 4].some((slot) => action.endsWith(`with ${candidate.name}’s card ${slot}.`)))
    return `${player.name} swapped a card with ${target?.name ?? 'another player'}.`
  }
  if ((move?.type === 'draw' && move.source === 'discard') || (action.startsWith('took ') && action.endsWith(' from the discard pile.'))) {
    return `${player.name} took a card from the discard pile.`
  }
  if ((move?.type === 'discard' && !action.startsWith('played ')) || action.startsWith('discarded ')) {
    return `${player.name} discarded a card.`
  }
  if (action.startsWith('peeked at card ')) return `${player.name} peeked at a card.`
  return entry.text
}
