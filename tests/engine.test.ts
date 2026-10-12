import assert from 'node:assert/strict'
import test from 'node:test'
import { applyAction, chooseBotAction, createDeck, createGame, getPlayerView, isGameState } from '../src/game/engine.ts'
import type { CardShuffler } from '../src/game/engine.ts'
import { createLocalSession, restoreLocalSession } from '../src/game/session.ts'
import type { Card, GameAction, GameState } from '../src/game/types.ts'

const players = [
  { id: 'a', name: 'Ada' },
  { id: 'b', name: 'Bo' },
  { id: 'c', name: 'Cleo' },
  { id: 'd', name: 'Daan' },
]

function command(state: GameState, action: GameAction, actorId = state.players[state.turnIndex].id, shuffle?: CardShuffler): GameState {
  const result = applyAction(state, actorId, action, shuffle)
  assert.equal(result.ok, true, `${actorId}: ${JSON.stringify(action)} in ${state.phase}: ${'error' in result ? result.error : ''}`)
  return result.state
}

function rejected(state: GameState, action: GameAction, actorId = state.players[state.turnIndex].id): void {
  const before = structuredClone(state)
  const result = applyAction(state, actorId, action)
  assert.equal(result.ok, false, `${JSON.stringify(action)} must be rejected in ${state.phase}`)
  assert.deepEqual(state, before, 'Rejected commands must not mutate authoritative state')
}

function readyGame(seed = 123, rounds = 2): GameState {
  let state = createGame(players, { seed, rounds })
  for (const player of players) state = command(state, { type: 'ready' }, player.id)
  return state
}

function number(value: number, id = `test-number-${value}`): Card {
  return { id, kind: 'number', value }
}

function power(kind: 'peek' | 'swap' | 'draw', id = `test-${kind}`): Card {
  return { id, kind }
}

function withNextCards(cards: Card[], seed = 123): GameState {
  const state = readyGame(seed)
  // The final array element is the next card drawn.
  state.deck = cards.toReversed()
  return state
}

function freezeDeep<T>(value: T): T {
  if (value !== null && typeof value === 'object') {
    Object.freeze(value)
    for (const child of Object.values(value)) freezeDeep(child)
  }
  return value
}

function setNumberHands(state: GameState, values = [1, 2, 3, 4]): void {
  for (const player of state.players) {
    player.hand = values.map((value, slot) => number(value, `${player.id}-fixture-${slot}`))
  }
}

test('standard deck has unique cards and the expected number/power distribution', () => {
  const deck = createDeck()
  assert.equal(deck.length, 66)
  assert.equal(new Set(deck.map((card) => card.id)).size, 66)
  for (let value = 0; value <= 9; value++) {
    assert.equal(deck.filter((card) => card.kind === 'number' && card.value === value).length, value === 9 ? 9 : 4)
  }
  assert.equal(deck.filter((card) => card.kind === 'swap').length, 9)
  assert.equal(deck.filter((card) => card.kind === 'peek').length, 7)
  assert.equal(deck.filter((card) => card.kind === 'draw').length, 5)
})

test('dealing is reproducible, preserves every card, and starts to the dealer’s left', () => {
  const first = createGame(players, { seed: 721, rounds: 3 })
  assert.deepEqual(first, createGame(players, { seed: 721, rounds: 3 }))
  assert.notDeepEqual(first.deck, createGame(players, { seed: 722, rounds: 3 }).deck)
  assert.equal(first.phase, 'initial')
  assert.equal(first.dealerIndex, 0)
  assert.equal(first.turnIndex, 1)
  assert.equal(first.deck.length, 49)
  assert.equal(first.discard.length, 1)
  assert.equal(first.discard[0].kind, 'number')
  assert.ok(first.players.every((player) => player.hand.length === 4))
  const dealtCards = [...first.deck, ...first.discard, ...first.players.flatMap((player) => player.hand)]
  assert.deepEqual(dealtCards.map((card) => card.id).sort(), createDeck().map((card) => card.id).sort())
})

test('initial outer-card viewing is private and disappears as each player becomes ready', () => {
  let state = createGame(players, { seed: 12 })
  for (const viewer of players) {
    const view = getPlayerView(state, viewer.id)
    for (const row of view.players) {
      const actual = state.players.find((player) => player.id === row.id)!
      assert.deepEqual(row.hand, row.id === viewer.id ? [actual.hand[0], null, null, actual.hand[3]] : [null, null, null, null])
    }
  }
  assert.ok(getPlayerView(state, 'spectator').players.every((row) => row.hand.every((card) => card === null)))
  rejected(state, { type: 'draw', source: 'deck' })
  state = command(state, { type: 'ready' }, 'a')
  assert.deepEqual(getPlayerView(state, 'a').players[0].hand, [null, null, null, null])
  assert.equal(state.phase, 'initial')
  rejected(state, { type: 'ready' }, 'a')
  for (const player of players.slice(1)) state = command(state, { type: 'ready' }, player.id)
  assert.equal(state.phase, 'draw')
  assert.ok(getPlayerView(state, 'b').players.every((row) => row.hand.every((card) => card === null)))
})

test('successful commands are pure and deterministic; invalid actors/phases/slots are rejected', () => {
  const state = freezeDeep(readyGame())
  const before = structuredClone(state)
  const next = command(state, { type: 'draw', source: 'deck' })
  assert.deepEqual(state, before)
  assert.deepEqual(next, command(state, { type: 'draw', source: 'deck' }))
  assert.notEqual(next, state)
  assert.equal(next.revision, state.revision + 1)
  rejected(state, { type: 'draw', source: 'deck' }, 'a')
  rejected(state, { type: 'draw', source: 'deck' }, 'unknown')
  for (const action of [
    { type: 'knock' }, { type: 'replace', slot: 0 }, { type: 'discard' },
    { type: 'use-power' }, { type: 'peek', slot: 0 }, { type: 'finish-peek' },
    { type: 'swap', ownSlot: 0, targetPlayerId: 'a', targetSlot: 0 },
    { type: 'skip' }, { type: 'draw-again' }, { type: 'end-turn' }, { type: 'next-round' },
  ] satisfies GameAction[]) rejected(state, action)
  rejected(next, { type: 'draw', source: 'deck' })
  for (const slot of [-1, 4, 0.5, Number.NaN]) rejected(next, { type: 'replace', slot })
})

test('a number taken from the discard pile must replace a card and is public knowledge', () => {
  let state = readyGame()
  const incoming = number(2)
  state.discard = [number(8), incoming]
  const old = state.players[1].hand[2]
  state = command(state, { type: 'draw', source: 'discard' })
  rejected(state, { type: 'discard' })
  rejected(state, { type: 'use-power' })
  rejected(state, { type: 'knock' })
  state = command(state, { type: 'replace', slot: 2 })
  assert.equal(state.phase, 'end-turn')
  assert.deepEqual(state.players[1].hand[2], incoming)
  assert.deepEqual(state.discard.at(-1), old)
  assert.equal(state.drawn, null)
  for (const viewer of players) assert.deepEqual(state.knowledge[viewer.id].b[2], incoming)
})

test('replacing a hand card exposes it to everyone and lets the next player take that exact discard', () => {
  let state = readyGame(123)
  const incoming = state.deck.at(-1)!
  const outgoing = state.players[1].hand[1]
  assert.equal(outgoing.kind, 'number')
  state = command(state, { type: 'draw', source: 'deck' })
  state = command(state, { type: 'replace', slot: 1 })
  assert.deepEqual(state.players[1].hand[1], incoming)
  assert.equal(isGameState(state), true)
  for (const viewerId of [...players.map((player) => player.id), 'spectator']) {
    const view = getPlayerView(state, viewerId)
    assert.deepEqual(view.discard, outgoing, 'The replaced card must be the public face-up discard')
    assert.ok(view.players.every((player) => player.hand.every((card) => card === null)))
  }

  state = command(state, { type: 'end-turn' })
  assert.equal(state.players[state.turnIndex].id, 'c')
  const deckBefore = structuredClone(state.deck)
  state = command(state, { type: 'draw', source: 'discard' })
  assert.deepEqual(state.drawn, outgoing)
  assert.deepEqual(getPlayerView(state, 'c').drawn, outgoing)
  assert.deepEqual(state.deck, deckBefore, 'Taking the face-up card must not draw from the deck')
  rejected(state, { type: 'discard' })
  rejected(state, { type: 'use-power' })
  state = command(state, { type: 'replace', slot: 0 })
  assert.deepEqual(state.players[2].hand[0], outgoing)
  assert.equal(isGameState(state), true)
  for (const viewer of players) assert.deepEqual(state.knowledge[viewer.id].c[0], outgoing)
})

test('the next player may draw from the deck while the previous replaced card stays face up', () => {
  let state = readyGame(123)
  const outgoing = state.players[1].hand[1]
  state = command(state, { type: 'draw', source: 'deck' })
  state = command(state, { type: 'replace', slot: 1 })
  state = command(state, { type: 'end-turn' })
  const incoming = state.deck.at(-1)!
  const discardBefore = structuredClone(state.discard)
  state = command(state, { type: 'draw', source: 'deck' })
  assert.deepEqual(state.drawn, incoming)
  assert.deepEqual(state.discard, discardBefore)
  for (const viewer of players) assert.deepEqual(getPlayerView(state, viewer.id).discard, outgoing)
  const nextOutgoing = state.players[2].hand[1]
  state = command(state, { type: 'replace', slot: 1 })
  assert.deepEqual(state.discard.at(-2), outgoing)
  for (const viewer of players) assert.deepEqual(getPlayerView(state, viewer.id).discard, nextOutgoing)
  assert.equal(isGameState(state), true)
})

test('public move events preserve the draw/replacement sequence without exposing deck draws', () => {
  let state = readyGame(123)
  const hiddenIncoming = state.deck.at(-1)!
  const firstOutgoing = state.players[1].hand[1]
  assert.equal(firstOutgoing.kind, 'number')
  state = command(state, { type: 'draw', source: 'deck' })
  const drawRevision = state.revision
  assert.deepEqual(state.log.at(-1)?.move, { type: 'draw', revision: drawRevision, playerId: 'b', source: 'deck', card: null })
  state = command(state, { type: 'replace', slot: 1 })
  const replaceRevision = state.revision
  assert.equal(state.log.at(-1)?.text, 'Bo replaced a card.')
  assert.deepEqual(state.log.at(-1)?.move, {
    type: 'replace', revision: replaceRevision, playerId: 'b', slot: 1, source: 'deck', incoming: null, discarded: firstOutgoing,
  })
  for (const viewerId of [...players.map((player) => player.id), 'spectator']) {
    const view = getPlayerView(state, viewerId)
    assert.ok(!JSON.stringify(view.log).includes(hiddenIncoming.id), 'A public animation must not identify the face-down incoming card')
    assert.ok(view.players.every((player) => player.hand.every((card) => card === null)))
  }

  state = command(state, { type: 'end-turn' })
  state = command(state, { type: 'draw', source: 'discard' })
  const publicDrawRevision = state.revision
  assert.equal(state.log.at(-1)?.text, 'Cleo took a card from the discard pile.')
  assert.deepEqual(state.log.at(-1)?.move, {
    type: 'draw', revision: publicDrawRevision, playerId: 'c', source: 'discard', card: firstOutgoing,
  })
  const secondOutgoing = state.players[2].hand[2]
  state = command(state, { type: 'replace', slot: 2 })
  assert.deepEqual(state.log.at(-1)?.move, {
    type: 'replace', revision: state.revision, playerId: 'c', slot: 2, source: 'discard', incoming: firstOutgoing, discarded: secondOutgoing,
  })
  const moves = state.log.filter((entry) => entry.move)
  assert.deepEqual(moves.map((entry) => entry.move!.revision), [drawRevision, replaceRevision, publicDrawRevision, state.revision])
  assert.equal(new Set(moves.map((entry) => `${entry.round}:${entry.id}`)).size, moves.length)
  assert.ok(moves.every((entry, index) => index === 0 || entry.id > moves[index - 1].id))
  assert.equal(isGameState(state), true)
})

test('a blind swap event reveals only its public slots and stays detached from authoritative state', () => {
  let state = readyGame(321)
  const swapIndex = state.deck.findIndex((card) => card.kind === 'swap')
  ;[state.deck[swapIndex], state.deck[state.deck.length - 1]] = [state.deck.at(-1)!, state.deck[swapIndex]]
  state = command(state, { type: 'draw', source: 'deck' })
  state = command(state, { type: 'use-power' })
  const ownBefore = state.players[1].hand[0]
  const targetBefore = state.players[3].hand[3]
  state = command(state, { type: 'swap', ownSlot: 0, targetPlayerId: 'd', targetSlot: 3 })
  const expected = { type: 'swap', revision: state.revision, playerId: 'b', slot: 0, targetPlayerId: 'd', targetSlot: 3 }
  assert.equal(state.log.at(-1)?.text, 'Bo swapped a card with Daan.')
  assert.deepEqual(state.log.at(-1)?.move, expected)
  assert.deepEqual(state.players[1].hand[0], targetBefore)
  assert.deepEqual(state.players[3].hand[3], ownBefore)
  for (const viewerId of [...players.map((player) => player.id), 'spectator']) {
    const view = getPlayerView(state, viewerId)
    assert.deepEqual(view.log.at(-1)?.move, expected)
    assert.ok(!JSON.stringify(view.log).includes(ownBefore.id))
    assert.ok(!JSON.stringify(view.log).includes(targetBefore.id))
    assert.ok(view.players.every((player) => player.hand.every((card) => card === null)))
  }
  const viewMove = getPlayerView(state, 'a').log.at(-1)!.move!
  assert.ok(viewMove.type === 'swap')
  viewMove.slot = 2
  assert.deepEqual(state.log.at(-1)?.move, expected)
  assert.equal(isGameState(state), true)
})

test('ordinary discards and power activations emit only the revealed card for animation', () => {
  let discarded = readyGame(111)
  discarded = command(discarded, { type: 'draw', source: 'deck' })
  const ordinaryCard = discarded.drawn!
  discarded = command(discarded, { type: 'discard' })
  assert.equal(discarded.log.at(-1)?.text, 'Bo discarded a card.')
  assert.deepEqual(discarded.log.at(-1)?.move, { type: 'discard', revision: discarded.revision, playerId: 'b', card: ordinaryCard })
  for (const kind of ['peek', 'swap', 'draw'] as const) {
    let state = readyGame(123)
    const powerIndex = state.deck.findIndex((card) => card.kind === kind)
    ;[state.deck[powerIndex], state.deck[state.deck.length - 1]] = [state.deck.at(-1)!, state.deck[powerIndex]]
    state = command(state, { type: 'draw', source: 'deck' })
    const revealedPower = state.drawn!
    state = command(state, { type: 'use-power' })
    assert.deepEqual(state.log.at(-1)?.move, { type: 'discard', revision: state.revision, playerId: 'b', card: revealedPower })
    const spectator = getPlayerView(state, 'spectator')
    assert.deepEqual(spectator.log.at(-1)?.move, state.log.at(-1)?.move)
    assert.equal(spectator.drawn, null, 'The first Draw Two card must remain private')
    assert.equal(isGameState(state), true)
  }
})

test('legacy saves without move events restore, while malformed or private move metadata is rejected', () => {
  let original = readyGame(123)
  original = command(original, { type: 'draw', source: 'deck' })
  original = command(original, { type: 'replace', slot: 1 })
  assert.equal(isGameState(original), true)
  const legacy = structuredClone(original)
  for (const entry of legacy.log) delete entry.move
  assert.equal(isGameState(JSON.parse(JSON.stringify(legacy))), true)
  const corruptions = [
    { revision: 0 }, { revision: original.revision + 1 }, { playerId: 'not-a-player' },
    { slot: 4 }, { source: 'hand' }, { discarded: { id: 'bad', kind: 'number', value: 0 } },
    { incoming: original.players[1].hand[1] }, { type: 'unknown' },
  ]
  for (const corruption of corruptions) {
    const state = structuredClone(original)
    Object.assign(state.log.at(-1)!.move!, corruption)
    assert.equal(isGameState(state), false, `Reject invalid move: ${JSON.stringify(corruption)}`)
  }
  const tainted = structuredClone(original)
  const entry = tainted.log.at(-1)!
  Object.assign(entry, { secretDeck: tainted.deck })
  Object.assign(entry.move!, { incoming: original.players[1].hand[1], secretHand: tainted.players[1].hand })
  const projected = getPlayerView(tainted, 'a').log.at(-1)!
  assert.ok(projected.move?.type === 'replace')
  assert.equal(projected.move.incoming, null, 'Projection must independently enforce a face-down deck replacement')
  assert.equal('secretDeck' in projected, false)
  assert.equal('secretHand' in projected.move, false)
})

test('discarded powers cannot be taken or activated, but a deck power may replace a card', () => {
  let state = withNextCards([power('peek')])
  state.discard = [number(1), power('swap')]
  rejected(state, { type: 'draw', source: 'discard' })
  rejected(state, { type: 'use-power' })
  state = command(state, { type: 'draw', source: 'deck' })
  const incoming = state.drawn
  state = command(state, { type: 'replace', slot: 1 })
  assert.deepEqual(state.players[1].hand[1], incoming)
  assert.equal(state.phase, 'end-turn')
  rejected(state, { type: 'use-power' })
})

test('drawn deck values are private, views are detached, and ordinary discard ends the action', () => {
  let state = withNextCards([number(7)])
  state = command(state, { type: 'draw', source: 'deck' })
  const own = getPlayerView(state, 'b')
  assert.deepEqual(own.drawn, number(7))
  assert.equal(getPlayerView(state, 'a').drawn, null)
  assert.equal(getPlayerView(state, 'spectator').drawn, null)
  assert.equal('deck' in own, false)
  assert.equal('knowledge' in own, false)
  own.drawn!.id = 'tampered'
  own.log[0].text = 'tampered'
  assert.equal(state.drawn!.id, 'test-number-7')
  assert.notEqual(state.log[0].text, 'tampered')
  state = command(state, { type: 'discard' })
  assert.equal(state.phase, 'end-turn')
  assert.deepEqual(state.discard.at(-1), number(7))
  assert.equal(state.drawn, null)
})

test('Peek reveals exactly one own card only to its actor, then covers it again', () => {
  let state = withNextCards([power('peek')])
  state = command(state, { type: 'draw', source: 'deck' })
  state = command(state, { type: 'use-power' })
  assert.equal(state.phase, 'peek-target')
  assert.equal(state.discard.at(-1)?.kind, 'peek')
  rejected(state, { type: 'peek', slot: 1 }, 'a')
  rejected(state, { type: 'peek', slot: 4 })
  state = command(state, { type: 'peek', slot: 1 })
  const card = state.players[1].hand[1]
  assert.deepEqual(getPlayerView(state, 'b').players[1].hand, [null, card, null, null])
  assert.deepEqual(getPlayerView(state, 'a').players[1].hand, [null, null, null, null])
  assert.equal(getPlayerView(state, 'a').peekedSlot, null)
  assert.deepEqual(state.knowledge.b.b[1], card)
  rejected(state, { type: 'peek', slot: 2 })
  state = command(state, { type: 'finish-peek' })
  assert.equal(state.phase, 'end-turn')
  assert.deepEqual(getPlayerView(state, 'b').players[1].hand, [null, null, null, null])
})

test('Swap can be skipped, swaps two cards without revealing them, and follows remembered identities', () => {
  let state = withNextCards([power('swap')])
  state = command(state, { type: 'draw', source: 'deck' })
  state = command(state, { type: 'use-power' })
  assert.equal(command(state, { type: 'skip' }).phase, 'end-turn')
  rejected(state, { type: 'swap', ownSlot: 0, targetPlayerId: 'b', targetSlot: 0 })
  rejected(state, { type: 'swap', ownSlot: 0, targetPlayerId: 'unknown', targetSlot: 0 })
  const own = state.players[1].hand[0]
  const target = state.players[0].hand[0]
  state = command(state, { type: 'swap', ownSlot: 0, targetPlayerId: 'a', targetSlot: 0 })
  assert.deepEqual(state.players[1].hand[0], target)
  assert.deepEqual(state.players[0].hand[0], own)
  assert.equal(state.knowledge.b.b[0], null)
  assert.deepEqual(state.knowledge.b.a[0], own)
  assert.deepEqual(state.knowledge.a.b[0], target)
  assert.equal(state.knowledge.a.a[0], null)
  assert.equal(state.phase, 'end-turn')
  for (const viewer of ['a', 'b']) assert.ok(getPlayerView(state, viewer).players.every((row) => row.hand.every((card) => card === null)))
})

test('Draw Two discarding the first card permits exactly one second draw', () => {
  let state = withNextCards([power('draw'), number(9), number(1), number(8)])
  state = command(state, { type: 'draw', source: 'deck' })
  state = command(state, { type: 'use-power' })
  assert.deepEqual(state.drawn, number(9))
  assert.equal(state.drawsRemaining, 1)
  rejected(state, { type: 'draw-again' })
  state = command(state, { type: 'discard' })
  assert.equal(state.phase, 'draw-again')
  rejected(state, { type: 'knock' })
  state = command(state, { type: 'draw-again' })
  assert.deepEqual(state.drawn, number(1))
  assert.equal(state.drawsRemaining, 0)
  state = command(state, { type: 'discard' })
  assert.equal(state.phase, 'end-turn')
  assert.equal(state.deck.length, 1)
  rejected(state, { type: 'draw-again' })
})

test('using the first Draw Two card forfeits the second, including using another power', () => {
  let state = withNextCards([power('draw'), number(1), number(8)])
  state = command(command(state, { type: 'draw', source: 'deck' }), { type: 'use-power' })
  state = command(state, { type: 'replace', slot: 2 })
  assert.equal(state.phase, 'end-turn')
  assert.equal(state.deck.length, 1)
  assert.equal(state.drawsRemaining, 0)
  rejected(state, { type: 'draw-again' })

  state = withNextCards([power('draw'), power('peek'), number(8)])
  state = command(command(state, { type: 'draw', source: 'deck' }), { type: 'use-power' })
  state = command(state, { type: 'use-power' })
  assert.equal(state.phase, 'peek-target')
  assert.equal(state.drawsRemaining, 0)
  state = command(command(state, { type: 'peek', slot: 2 }), { type: 'finish-peek' })
  assert.equal(state.phase, 'end-turn')
  assert.equal(state.deck.length, 1)
})

test('a new Draw Two restarts the sequence when found on either draw', () => {
  for (const newPowerOnSecond of [false, true]) {
    let state = withNextCards([
      power('draw', 'first-draw-power'),
      ...(newPowerOnSecond ? [number(9)] : []),
      power('draw', 'chained-draw-power'),
      number(8), number(0), number(7),
    ])
    state = command(command(state, { type: 'draw', source: 'deck' }), { type: 'use-power' })
    if (newPowerOnSecond) state = command(command(state, { type: 'discard' }), { type: 'draw-again' })
    assert.equal(state.drawn?.kind, 'draw')
    state = command(state, { type: 'use-power' })
    assert.deepEqual(state.drawn, number(8))
    assert.equal(state.drawsRemaining, 1)
    state = command(command(state, { type: 'discard' }), { type: 'draw-again' })
    assert.deepEqual(state.drawn, number(0))
    state = command(state, { type: 'replace', slot: 0 })
    assert.equal(state.phase, 'end-turn')
    assert.equal(state.deck.length, 1)
  }
})

test('knocking is allowed only at turn end and gives every other player exactly one last turn', () => {
  let state = withNextCards(Array.from({ length: 8 }, (_, i) => number(i, `last-turn-${i}`)))
  setNumberHands(state)
  rejected(state, { type: 'knock' })
  state = command(state, { type: 'draw', source: 'deck' })
  rejected(state, { type: 'knock' })
  state = command(state, { type: 'discard' })
  state = command(state, { type: 'knock' })
  assert.equal(state.knockedBy, 'b')
  assert.equal(state.finalTurnsRemaining, 3)
  assert.equal(state.players[state.turnIndex].id, 'c')
  for (const [id, remaining] of [['c', 2], ['d', 1], ['a', 0]] as const) {
    assert.equal(state.players[state.turnIndex].id, id)
    state = command(command(state, { type: 'draw', source: 'deck' }), { type: 'discard' })
    rejected(state, { type: 'knock' })
    state = command(state, { type: 'end-turn' })
    assert.equal(state.finalTurnsRemaining, remaining)
  }
  assert.equal(state.phase, 'round-over')
  assert.ok(state.players.every((player) => player.roundScores.length === 1))
  rejected(state, { type: 'draw', source: 'deck' }, 'b')
})

test('scoring repeatedly replaces powers until numeric and accumulates scores with tied winners', () => {
  let state = readyGame(456, 2)
  setNumberHands(state, [1, 1, 1, 1])
  state.players[1].hand[0] = power('swap', 'hand-swap')
  state.deck = [number(1, 'replacement-one'), power('draw', 'replacement-draw'), power('peek', 'replacement-peek')]
  state.knockedBy = 'b'
  state.finalTurnsRemaining = 1
  state.turnIndex = 0
  state.phase = 'end-turn'
  state = command(state, { type: 'end-turn' })
  assert.equal(state.phase, 'round-over')
  assert.ok(state.players.every((player) => player.hand.every((card) => card.kind === 'number')))
  assert.deepEqual(state.roundResult?.scores, { b: 4, c: 4, d: 4, a: 4 })
  assert.deepEqual(state.roundResult?.winners, ['a', 'b', 'c', 'd'])
  assert.deepEqual(state.players.map((player) => player.totalScore), [4, 4, 4, 4])
  assert.deepEqual(state.players.map((player) => player.roundScores), [[4], [4], [4], [4]])
  assert.equal(state.roundResult?.replacements.length, 1)
  assert.equal(state.roundResult?.replacements[0].to.kind, 'number')
  assert.ok(['replacement-peek', 'replacement-draw', 'hand-swap'].every((id) => state.discard.some((card) => card.id === id)))
  assert.ok(getPlayerView(state, 'a').players.every((row) => row.hand.every((card) => card !== null)))

  state = command(state, { type: 'next-round' }, 'd')
  assert.equal(state.round, 2)
  assert.equal(state.dealerIndex, 1)
  assert.equal(state.turnIndex, 2)
  assert.equal(state.phase, 'initial')
  assert.equal(state.roundResult, null)
  assert.equal(state.knockedBy, null)
  assert.deepEqual(state.players.map((player) => player.totalScore), [4, 4, 4, 4])
  for (const player of players) state = command(state, { type: 'ready' }, player.id)
  setNumberHands(state, [2, 2, 2, 2])
  state.knockedBy = 'a'
  state.finalTurnsRemaining = 1
  state.phase = 'end-turn'
  state = command(state, { type: 'end-turn' })
  assert.equal(state.phase, 'game-over')
  assert.deepEqual(state.winners, ['a', 'b', 'c', 'd'])
  assert.deepEqual(state.players.map((player) => player.totalScore), [12, 12, 12, 12])
  assert.deepEqual(state.players.map((player) => player.roundScores), [[4, 8], [4, 8], [4, 8], [4, 8]])
  rejected(state, { type: 'next-round' })
})

test('exhausted deck is recycled while retaining a numeric face-up discard', () => {
  let state = readyGame()
  state.deck = []
  const retained = number(4, 'retained-number')
  const recyclable = [number(8, 'recycled-eight'), power('peek', 'recycled-peek'), power('swap', 'recycled-swap')]
  state.discard = [recyclable[0], retained, recyclable[1], recyclable[2]]
  state = command(state, { type: 'draw', source: 'deck' })
  assert.deepEqual(state.discard, [retained])
  assert.equal(state.deck.length, 2)
  assert.deepEqual([...state.deck, state.drawn!].map((card) => card.id).sort(), recyclable.map((card) => card.id).sort())
})

test('trusted shuffle injection handles initial dealing, rejected opening powers, and the next round', () => {
  let calls = 0
  const injected: CardShuffler = (cards) => {
    calls++
    // The first order deals powers and leaves a power on top; the opening-card
    // retry must use this provider too, rather than the seeded local generator.
    return calls === 1 ? [...cards] : cards.toSorted((a, b) => Number(a.kind === 'number') - Number(b.kind === 'number'))
  }
  let state = createGame(players, { seed: 123, rounds: 2, shuffle: injected })
  assert.equal(calls, 2)
  assert.equal(state.rng, 123, 'Injected shuffling must not fall back to the seeded PRNG')
  assert.equal(state.discard.at(-1)?.kind, 'number')
  for (const player of players) state = command(state, { type: 'ready' }, player.id, injected)
  state = command(state, { type: 'draw', source: 'deck' }, 'b', injected)
  state = command(state, { type: 'discard' }, 'b', injected)
  state = command(state, { type: 'knock' }, 'b', injected)
  for (const actorId of ['c', 'd', 'a']) {
    state = command(state, { type: 'draw', source: 'deck' }, actorId, injected)
    state = command(state, { type: 'discard' }, actorId, injected)
    state = command(state, { type: 'end-turn' }, actorId, injected)
  }
  assert.equal(state.phase, 'round-over')
  state = command(state, { type: 'next-round' }, 'a', injected)
  assert.equal(calls, 3)
  assert.equal(state.rng, 123)
  assert.equal(isGameState(state), true)
})

test('trusted shuffle injection handles recycling during normal draws, Draw Two, and scoring', () => {
  for (const action of [
    { type: 'draw', source: 'deck' },
    { type: 'use-power' },
    { type: 'draw-again' },
    { type: 'end-turn' },
  ] satisfies GameAction[]) {
    let calls = 0
    const injected: CardShuffler = (cards) => {
      calls++
      return cards.toSorted((a, b) => Number(a.kind === 'number') - Number(b.kind === 'number'))
    }
    let state = readyGame()
    state.deck = []
    state.discard = [number(8, 'recyclable-eight'), number(4, 'retained-four'), power('peek')]
    if (action.type === 'use-power') {
      state.phase = 'choose'
      state.drawn = power('draw')
      state.drawnSource = 'deck'
    } else if (action.type === 'draw-again') {
      state.phase = 'draw-again'
      state.drawsRemaining = 1
    } else if (action.type === 'end-turn') {
      setNumberHands(state)
      state.players[1].hand[0] = power('swap')
      state.phase = 'end-turn'
      state.knockedBy = 'b'
      state.finalTurnsRemaining = 1
      state.turnIndex = 0
    }
    const seedBefore = state.rng
    state = command(state, action, state.players[state.turnIndex].id, injected)
    assert.equal(calls, 1, `${action.type} must use the host's shuffle when recycling`)
    assert.equal(state.rng, seedBefore)
    assert.deepEqual(state.discard[0], number(4, 'retained-four'))
    if (action.type === 'end-turn') {
      assert.equal(state.phase, 'round-over')
      assert.equal(state.players[1].hand[0].kind, 'number')
    } else assert.deepEqual(state.drawn, number(8, 'recyclable-eight'))
  }
})

test('saved-state validation accepts JSON round trips and rejects corrupt cards, scores, and phase data', () => {
  const original = readyGame()
  assert.equal(isGameState(JSON.parse(JSON.stringify(original))), true)
  for (const value of [null, undefined, {}, [], { version: 1 }]) assert.equal(isGameState(value), false)
  const corruptions: ((state: GameState) => void)[] = [
    (state) => { state.players[0].hand.pop() },
    (state) => { state.deck[0] = state.players[0].hand[0] },
    (state) => { state.players[0].totalScore = 100 },
    (state) => { state.players[0].roundScores = [5] },
    (state) => { state.players[0].id = state.players[1].id },
    (state) => { state.turnIndex = 5 },
    (state) => { state.phase = 'choose' },
    (state) => { state.phase = 'draw-again'; state.drawsRemaining = 0 },
    (state) => { state.phase = 'initial' },
    (state) => { state.phase = 'peeking'; state.peekedSlot = null },
    (state) => { state.drawnSource = 'deck' },
    (state) => { state.knowledge.a.b = [] },
    (state) => {
      const index = state.deck.findIndex((card) => card.kind === 'number')
      const card = state.deck[index]
      if (card.kind === 'number') card.value = 99
    },
  ]
  for (const corrupt of corruptions) {
    const state = structuredClone(original)
    corrupt(state)
    assert.equal(isGameState(state), false)
  }

  let drawAgain = structuredClone(original)
  const drawPowerIndex = drawAgain.deck.findIndex((card) => card.kind === 'draw')
  assert.notEqual(drawPowerIndex, -1)
  drawAgain.deck.push(drawAgain.deck.splice(drawPowerIndex, 1)[0])
  drawAgain = command(command(drawAgain, { type: 'draw', source: 'deck' }), { type: 'use-power' })
  drawAgain = command(drawAgain, { type: 'discard' })
  assert.equal(drawAgain.phase, 'draw-again')
  assert.equal(drawAgain.drawsRemaining, 1)
  assert.equal(isGameState(drawAgain), true, 'A genuine Draw Two second-draw opportunity must be restorable')
})

test('player identifiers cannot overwrite record dictionary prototype keys', () => {
  for (const id of [...Object.getOwnPropertyNames(Object.prototype), 'prototype']) {
    const unsafePlayers = players.map((player, index) => index === 0 ? { ...player, id } : player)
    assert.throws(() => createGame(unsafePlayers, { seed: 123 }), `Unsafe ID ${id} must be rejected`)
    const saved = readyGame()
    saved.players[0].id = id
    assert.equal(isGameState(saved), false, `A saved unsafe ID ${id} must be rejected`)
  }
})

test('bots keep remembered 0–3 cards unless a lower drawn card improves them', () => {
  const state = readyGame()
  state.phase = 'choose'
  state.drawnSource = 'deck'
  state.knowledge.b.b = [number(0), number(1), number(2), number(3)]
  for (let value = 3; value <= 9; value++) {
    state.drawn = number(value)
    assert.deepEqual(chooseBotAction(state, 'b'), { type: 'discard' })
  }
  state.drawn = number(2)
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'replace', slot: 3 })
})

test('bots replace known high cards, dealt powers, and unknown cards before low cards', () => {
  const state = readyGame()
  state.phase = 'choose'
  state.drawnSource = 'deck'
  state.drawn = number(1)
  state.knowledge.b.b = [number(0), null, power('peek'), number(9)]
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'replace', slot: 3 })
  state.knowledge.b.b[3] = number(3)
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'replace', slot: 2 })
  state.knowledge.b.b[2] = number(2)
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'replace', slot: 1 })
})

test('bots take useful face-up numbers and pass a weak first Draw Two card', () => {
  const state = readyGame()
  state.knowledge.b.b = [number(0), null, number(2), number(3)]
  state.discard = [number(2)]
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'draw', source: 'discard' })
  state.discard = [number(9)]
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'draw', source: 'deck' })
  state.phase = 'choose'
  state.drawnSource = 'deck'
  state.drawsRemaining = 1
  state.drawn = number(4)
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'discard' })
  state.drawn = number(2)
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'replace', slot: 1 })
  state.knowledge.b.b[1] = number(9)
  state.drawn = number(4)
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'replace', slot: 1 })
})

test('bots peek at an unknown card and avoid repeating a useless Peek', () => {
  const state = readyGame()
  state.phase = 'peek-target'
  state.knowledge.b.b = [number(0), number(1), null, number(3)]
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'peek', slot: 2 })
  state.knowledge.b.b[2] = number(2)
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'skip' })
  state.phase = 'choose'
  state.drawnSource = 'deck'
  state.drawn = power('peek')
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'discard' })
})

test('bots trade their worst card for an observed low card and skip weak swaps', () => {
  const state = readyGame()
  state.phase = 'swap-target'
  state.knowledge.b.b = [number(0), number(1), null, number(9)]
  state.knowledge.b.c[2] = number(1)
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'swap', ownSlot: 3, targetPlayerId: 'c', targetSlot: 2 })
  state.knowledge.b.c[2] = null
  const blindSwap = chooseBotAction(state, 'b')
  assert.equal(blindSwap?.type, 'swap', 'Trading a remembered 9 for an unknown is a useful risk')
  if (blindSwap?.type === 'swap') assert.equal(blindSwap.ownSlot, 3)
  state.knowledge.b.b = [number(0), number(1), number(2), number(3)]
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'skip' }, 'Keep low cards instead of blind swaps')
  state.knowledge.b.b = [null, null, null, null]
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'skip' }, 'Unknown for unknown has no strategic gain')
  state.phase = 'choose'
  state.drawnSource = 'deck'
  state.drawn = power('swap')
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'discard' })
})

test('bots call with a strong hand but respect observed opponents and ties', () => {
  const state = readyGame()
  state.phase = 'end-turn'
  state.knowledge.b.b = [number(0), number(1), number(2), number(3)]
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'knock' })
  state.knowledge.b.c = [number(0), number(0), number(1), number(1)]
  state.turnNumber = 500
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'end-turn' }, 'Do not call just because a round is long when an opponent is known to be ahead')
  state.knowledge.b.b = [number(0), number(0), number(0), number(0)]
  state.knowledge.b.c = [number(0), number(0), number(0), number(0)]
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'knock' }, 'A guaranteed tied win should end the round')
})

test('bots never call with ten or more remembered points, even very late in a round', () => {
  const state = readyGame()
  state.phase = 'end-turn'
  for (const other of players) if (other.id !== 'b') state.knowledge.b[other.id] = Array.from({ length: 4 }, () => number(9))
  for (const values of [[1, 2, 3, 4], [0, 0, 2, 9], [9, 9, 9, 9]]) {
    state.knowledge.b.b = values.map((value) => number(value))
    for (const turn of [1, 21, 500, 10001]) {
      state.turnNumber = turn
      assert.deepEqual(chooseBotAction(state, 'b'), { type: 'end-turn' }, `Do not call with ${values.join('+')} on turn ${turn}`)
    }
  }
})

test('bots confirm all four numeric cards before calling instead of trusting low estimates', () => {
  const state = readyGame()
  state.phase = 'end-turn'
  for (const other of players) if (other.id !== 'b') state.knowledge.b[other.id] = Array.from({ length: 4 }, () => number(9))
  for (const uncertain of [null, power('peek'), power('swap'), power('draw')]) {
    for (let slot = 0; slot < 4; slot++) {
      state.knowledge.b.b = Array.from({ length: 4 }, () => number(0))
      state.knowledge.b.b[slot] = uncertain
      for (const turn of [1, 21, 500, 10001]) {
        state.turnNumber = turn
        assert.deepEqual(chooseBotAction(state, 'b'), { type: 'end-turn' }, `Unknown or power card in slot ${slot} must prevent a call on turn ${turn}`)
      }
    }
  }
  state.knowledge.b.b = [number(0), null, number(0), null]
  assert.deepEqual(chooseBotAction(state, 'b'), { type: 'end-turn' }, 'Two unknown cards are not a confirmed good hand')
})

test('bots call promptly with confirmed safe hands of zero to six points', () => {
  const state = readyGame()
  state.phase = 'end-turn'
  for (const other of players) if (other.id !== 'b') state.knowledge.b[other.id] = Array.from({ length: 4 }, () => number(9))
  for (let score = 0; score <= 6; score++) {
    state.knowledge.b.b = [number(0), number(0), number(0), number(score)]
    for (const turn of [1, 5, 21, 500, 10001]) {
      state.turnNumber = turn
      assert.deepEqual(chooseBotAction(state, 'b'), { type: 'knock' }, `A confirmed safe ${score}-point hand should call on turn ${turn}`)
    }
  }
})

test('bots sometimes wait with seven to nine points and call more readily with lower scores', () => {
  const state = readyGame()
  state.phase = 'end-turn'
  for (const other of players) if (other.id !== 'b') state.knowledge.b[other.id] = Array.from({ length: 4 }, () => number(9))
  const rates: number[] = []
  const samples = 256
  for (const score of [7, 8, 9]) {
    state.knowledge.b.b = [number(0), number(1), number(2), number(score - 3)]
    let calls = 0
    for (let turn = 0; turn < samples; turn++) {
      state.turnNumber = 1 + turn * players.length
      if (chooseBotAction(state, 'b')?.type === 'knock') calls++
    }
    assert.ok(calls > 0 && calls < samples, `A safe ${score}-point hand must sometimes call and sometimes wait`)
    rates.push(calls / samples)
  }
  assert.ok(rates[0] > rates[1] && rates[1] > rates[2], `Lower scores should call more readily: ${rates}`)
  for (let index = 0; index < rates.length; index++) {
    assert.ok(Math.abs(rates[index] - [0.8, 0.65, 0.5][index]) < 0.2, `Call variation should remain sensible: ${rates}`)
  }
  state.knowledge.b.c = [number(0), number(1), number(2), number(5)]
  for (let turn = 0; turn < samples; turn++) {
    state.turnNumber = 1 + turn * players.length
    assert.deepEqual(chooseBotAction(state, 'b'), { type: 'end-turn' }, 'Variation must never override an observed opponent with a better hand')
  }
})

test('varied bot calls are reproducible and independent of hidden state', () => {
  const state = readyGame()
  state.phase = 'end-turn'
  state.knowledge.b.b = [number(0), number(1), number(2), number(6)]
  for (const other of players) if (other.id !== 'b') state.knowledge.b[other.id] = Array.from({ length: 4 }, () => number(9))
  const observed = new Set<string>()
  for (let turn = 0; turn < 64; turn++) {
    state.turnNumber = 1 + turn * players.length
    const original = freezeDeep(structuredClone(state))
    const decision = chooseBotAction(original, 'b')
    assert.ok(decision)
    observed.add(decision.type)
    assert.deepEqual(chooseBotAction(original, 'b'), decision, 'Repeated decisions at the same turn must agree')
    const hiddenChanged = structuredClone(state)
    for (const player of hiddenChanged.players) {
      player.hand = player.hand.map((_, slot) => number(9, `hidden-${player.id}-${slot}`))
      if (player.id !== 'b') {
        for (const other of hiddenChanged.players) hiddenChanged.knowledge[player.id][other.id] = [null, null, null, null]
      }
    }
    hiddenChanged.deck.reverse()
    hiddenChanged.rng = 42
    assert.deepEqual(chooseBotAction(freezeDeep(hiddenChanged), 'b'), decision, 'Call timing must not reveal hidden hands, deck order, RNG, or other memories')
  }
  assert.deepEqual([...observed].sort(), ['end-turn', 'knock'], 'Both a call and a wait must be checked for hidden-state independence')
})

test('bot decisions never depend on hidden hands, deck order, RNG, or other players’ private memories', () => {
  for (const phase of ['draw', 'choose', 'peek-target', 'swap-target', 'end-turn'] as const) {
    const state = readyGame()
    state.phase = phase
    state.knowledge.b.b = [number(0), null, number(2), number(9)]
    state.knowledge.b.c[2] = number(1)
    state.drawn = phase === 'choose' ? number(2) : null
    state.drawnSource = phase === 'choose' ? 'deck' : null
    const decision = chooseBotAction(freezeDeep(structuredClone(state)), 'b')
    const hiddenChanged = structuredClone(state)
    for (const player of hiddenChanged.players) {
      player.hand = player.hand.map((_, slot) => number(9, `hidden-${player.id}-${slot}`))
      if (player.id !== 'b') {
        for (const other of hiddenChanged.players) hiddenChanged.knowledge[player.id][other.id] = [null, null, null, null]
      }
    }
    hiddenChanged.deck = hiddenChanged.deck.toReversed()
    hiddenChanged.rng = 42
    assert.deepEqual(chooseBotAction(freezeDeep(hiddenChanged), 'b'), decision, `Hidden information affected ${phase}`)
  }
})

test('local sessions support one, two, or three computers and restore every table size', () => {
  const original = Object.getOwnPropertyDescriptor(globalThis, 'localStorage')
  const storage = new Map<string, string>()
  Object.defineProperty(globalThis, 'localStorage', {
    configurable: true,
    value: { getItem: (key: string) => storage.get(key) ?? null, setItem: (key: string, value: string) => storage.set(key, value) },
  })
  try {
    for (const botCount of [1, 2, 3]) {
      const session = createLocalSession('Ada', 3, botCount)
      assert.equal(session.mode, 'local')
      assert.equal(session.getSnapshot().players.length, botCount + 1)
      assert.equal(restoreLocalSession()?.getSnapshot().players.length, botCount + 1)
    }
    assert.equal(createLocalSession('Ada', 3).getSnapshot().players.length, 4)
    for (const botCount of [0, 4, -1, 1.5, NaN]) assert.throws(() => createLocalSession('Ada', 3, botCount))
  } finally {
    if (original) Object.defineProperty(globalThis, 'localStorage', original)
    else Reflect.deleteProperty(globalThis, 'localStorage')
  }
})

test('deterministic two-to-four-player bot matches finish and preserve card, turn, privacy, and score invariants', () => {
  for (const playerCount of [2, 3, 4]) for (let seed = 1; seed <= 24; seed++) {
    const table = players.slice(0, playerCount)
    let state = createGame(table, { seed, rounds: 3 })
    const expectedIds = createDeck().map((card) => card.id).sort()
    let commands = 0
    while (state.phase !== 'game-over') {
      assert.ok(commands++ < 8000, `Seed ${seed} did not finish; phase=${state.phase}`)
      let actorId: string
      let action: GameAction | null
      if (state.phase === 'round-over') {
        actorId = 'a'
        action = { type: 'next-round' }
      } else {
        actorId = state.phase === 'initial'
          ? state.players.find((player) => !player.ready)!.id
          : state.players[state.turnIndex].id
        action = chooseBotAction(state, actorId)
      }
      assert.ok(action, `Seed ${seed}: no bot action in ${state.phase}`)
      if (action.type === 'knock') {
        const own = state.knowledge[actorId][actorId]
        assert.ok(own.every((card) => card?.kind === 'number'), `Seed ${seed}: a bot called without confirming its hand`)
        const score = own.reduce((sum, card) => sum + (card?.kind === 'number' ? card.value : Infinity), 0)
        assert.ok(score < 10, `Seed ${seed}: a bot called with ${score} points`)
      }
      const before = JSON.stringify(state)
      state = command(state, action, actorId)
      assert.equal(isGameState(state), true, `Seed ${seed}: transition produced an invalid save`)
      assert.ok(state.players.every((player) => player.hand.length === 4))
      assert.ok(state.turnIndex >= 0 && state.turnIndex < state.players.length)
      const cards = [...state.deck, ...state.discard, ...state.players.flatMap((player) => player.hand), ...(state.drawn ? [state.drawn] : [])]
      assert.deepEqual(cards.map((card) => card.id).sort(), expectedIds, `Seed ${seed}: cards were lost or duplicated`)
      assert.notEqual(JSON.stringify(state), before)
      if (state.phase !== 'round-over' && state.phase !== 'game-over') {
        for (const viewer of table) {
          const view = getPlayerView(state, viewer.id)
          for (const row of view.players) if (row.id !== viewer.id) assert.ok(row.hand.every((card) => card === null))
          if (viewer.id !== state.players[state.turnIndex].id) assert.equal(view.drawn, null)
        }
      }
      for (const player of state.players) assert.equal(player.totalScore, player.roundScores.reduce((sum, score) => sum + score, 0))
    }
    assert.equal(state.round, 3)
    assert.ok(state.players.every((player) => player.roundScores.length === 3))
    const lowest = Math.min(...state.players.map((player) => player.totalScore))
    assert.deepEqual(state.winners, state.players.filter((player) => player.totalScore === lowest).map((player) => player.id))
  }
})
