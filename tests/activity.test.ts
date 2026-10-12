import assert from 'node:assert/strict'
import test from 'node:test'
import { activityText } from '../src/game/activity.ts'
import { createGame, getPlayerView, isGameState } from '../src/game/engine.ts'
import type { GameLog } from '../src/game/types.ts'

const players = [{ id: 'a', name: 'Player 9' }, { id: 'b', name: 'Sam 4' }]
const number = { id: 'number-8-0', kind: 'number', value: 8 } as const

test('activity removes card values and positions from old logs with or without animation metadata', () => {
  const entries: [string, GameLog['move'], string][] = [
    ['Player 9 replaced card 3 and discarded 8.', { type: 'replace', revision: 1, playerId: 'a', slot: 2, source: 'deck', incoming: null, discarded: number }, 'Player 9 replaced a card.'],
    ['Player 9 discarded 8.', { type: 'discard', revision: 1, playerId: 'a', card: number }, 'Player 9 discarded a card.'],
    ['Player 9 discarded Swap.', { type: 'discard', revision: 1, playerId: 'a', card: { id: 'swap-0', kind: 'swap' } }, 'Player 9 discarded a card.'],
    ['Player 9 took 8 from the discard pile.', { type: 'draw', revision: 1, playerId: 'a', source: 'discard', card: number }, 'Player 9 took a card from the discard pile.'],
    ['Player 9 swapped card 2 with Sam 4’s card 3.', { type: 'swap', revision: 1, playerId: 'a', slot: 1, targetPlayerId: 'b', targetSlot: 2 }, 'Player 9 swapped a card with Sam 4.'],
    ['Player 9 peeked at card 4.', undefined, 'Player 9 peeked at a card.'],
  ]
  for (const [text, move, expected] of entries) {
    for (const metadata of [undefined, move]) {
      const entry: GameLog = { id: 1, round: 1, playerId: 'a', text, ...(metadata ? { move: metadata } : {}) }
      const before = structuredClone(entry)
      assert.equal(activityText(entry, players), expected)
      assert.deepEqual(entry, before, 'Formatting must preserve animation data and authoritative history')
      assert.equal(activityText({ ...entry, text: expected }, players), expected, 'Formatting remains stable on repeated views')
    }
  }
})

test('activity preserves power usage, ordinary draws, round announcements and Bitchbende calls', () => {
  for (const text of ['Player 9 played Peek.', 'Player 9 played Swap.', 'Player 9 played Draw Two and drew the first card.']) {
    const entry: GameLog = { id: 1, round: 1, playerId: 'a', text, move: { type: 'discard', revision: 1, playerId: 'a', card: { id: 'peek-0', kind: 'peek' } } }
    assert.equal(activityText(entry, players), text)
  }
  for (const text of ['Player 9 drew a card.', 'Player 9 drew the second card.', 'Player 9 called Bitchbende! Everyone else has one last turn.', 'Player 9 skipped the power.']) {
    assert.equal(activityText({ id: 1, round: 1, playerId: 'a', text }, players), text)
  }
  const round: GameLog = { id: 1, round: 1, playerId: null, text: 'Round 1. Take a look at your two outer cards.' }
  assert.equal(activityText(round, players), round.text)
})

test('public views sanitize legacy persisted history without changing the save or the face-up discard', () => {
  const state = createGame(players, { seed: 123, rounds: 3 })
  state.log.push({ id: state.nextLogId++, round: 1, playerId: 'a', text: 'Player 9 replaced card 2 and discarded 8.' })
  state.log.push({ id: state.nextLogId++, round: 1, playerId: 'b', text: 'Sam 4 swapped card 4 with Player 9’s card 1.' })
  assert.equal(isGameState(state), true)
  const before = structuredClone(state)
  for (const viewerId of ['a', 'b', 'spectator']) {
    const view = getPlayerView(state, viewerId)
    assert.equal(view.log.at(-2)?.text, 'Player 9 replaced a card.')
    assert.equal(view.log.at(-1)?.text, 'Sam 4 swapped a card with Player 9.')
    assert.deepEqual(view.discard, state.discard.at(-1))
  }
  assert.deepEqual(state, before)
})
