import type { Card } from '../src/game/types.ts'

function randomIndex(limit: number): number {
  // Rejection sampling avoids modulo bias and reveals no reusable RNG state.
  const ceiling = 0x1_0000_0000 - 0x1_0000_0000 % limit
  const bytes = new Uint32Array(1)
  do { crypto.getRandomValues(bytes) } while (bytes[0] >= ceiling)
  return bytes[0] % limit
}

/** Fresh OS-backed entropy for every shuffle in an online game. */
export function secureShuffle(cards: readonly Card[]): Card[] {
  const shuffled = cards.slice()
  for (let index = shuffled.length - 1; index > 0; index--) {
    const target = randomIndex(index + 1)
    ;[shuffled[index], shuffled[target]] = [shuffled[target], shuffled[index]]
  }
  return shuffled
}
