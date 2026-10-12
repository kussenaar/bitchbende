import type { ActionResult, Card, GameAction, GameLog, GameState, GameView, PublicCardMove, RoundResult } from './types.ts'
import { activityText } from './activity.ts'

export type { Card, GameAction, GamePhase, GameState, GameView, PlayerView, PublicCardMove, RoundResult } from './types.ts'

/** Trusted hosts may inject a cryptographic shuffle; seeded local games use the default. */
export type CardShuffler = (cards: readonly Card[]) => Card[]

/** The standard 66-card deck: four 0–8s, nine 9s, and 21 powers. */
export function createDeck(): Card[] {
  const cards: Card[] = []
  for (let value = 0; value <= 9; value++) {
    for (let copy = 0; copy < (value === 9 ? 9 : 4); copy++) {
      cards.push({ id: `number-${value}-${copy}`, kind: 'number', value })
    }
  }
  for (const [kind, count] of [['swap', 9], ['peek', 7], ['draw', 5]] as const) {
    for (let copy = 0; copy < count; copy++) cards.push({ id: `${kind}-${copy}`, kind })
  }
  return cards
}

function random(state: GameState): number {
  let value = state.rng
  value ^= value << 13
  value ^= value >>> 17
  value ^= value << 5
  state.rng = value >>> 0
  return state.rng / 4294967296
}

function shuffle(state: GameState, cards: Card[], shuffleCards?: CardShuffler): Card[] {
  if (shuffleCards) return shuffleCards(cards.slice())
  const result = cards.slice()
  for (let i = result.length - 1; i > 0; i--) {
    const j = Math.floor(random(state) * (i + 1))
    ;[result[i], result[j]] = [result[j], result[i]]
  }
  return result
}

function log(state: GameState, playerId: string | null, text: string, move?: PublicCardMove): void {
  state.log.push({ id: state.nextLogId++, round: state.round, playerId, text, ...(move ? { move } : {}) })
  // Keep persisted and transmitted snapshots bounded over long matches.
  if (state.log.length > 80) state.log = state.log.slice(-80)
}

function setKnown(state: GameState, viewerId: string, ownerId: string, slot: number, card: Card | null): void {
  state.knowledge[viewerId][ownerId][slot] = card
}

function safePlayerId(id: unknown): id is string {
  return typeof id === 'string' && id.length > 0 && id !== 'prototype' && !Object.hasOwn(Object.prototype, id)
}

function dealRound(state: GameState, shuffleCards?: CardShuffler): void {
  state.phase = 'initial'
  state.turnIndex = (state.dealerIndex + 1) % state.players.length
  state.turnNumber = 1
  state.deck = shuffle(state, createDeck(), shuffleCards)
  state.discard = []
  state.drawn = null
  state.drawnSource = null
  state.drawsRemaining = 0
  state.peekedSlot = null
  state.knockedBy = null
  state.finalTurnsRemaining = null
  state.roundResult = null
  state.winners = []
  state.knowledge = {}
  for (const player of state.players) {
    player.hand = []
    player.ready = false
    state.knowledge[player.id] = {}
    for (const owner of state.players) state.knowledge[player.id][owner.id] = [null, null, null, null]
  }
  // Deal one at a time, beginning with the player to the dealer's left.
  for (let slot = 0; slot < 4; slot++) {
    for (let offset = 1; offset <= state.players.length; offset++) {
      const player = state.players[(state.dealerIndex + offset) % state.players.length]
      player.hand.push(state.deck.pop()!)
    }
  }
  // The supplied rules require an opening number. Re-shuffle rejected powers.
  while (state.deck[state.deck.length - 1].kind !== 'number') state.deck = shuffle(state, state.deck, shuffleCards)
  state.discard.push(state.deck.pop()!)
  for (const player of state.players) {
    setKnown(state, player.id, player.id, 0, player.hand[0])
    setKnown(state, player.id, player.id, 3, player.hand[3])
  }
  log(state, null, `Round ${state.round}. Take a look at your two outer cards.`)
}

export function createGame(
  players: { id: string; name: string }[],
  options: { seed?: number; rounds?: number; shuffle?: CardShuffler } = {},
): GameState {
  if (players.length < 2 || players.length > 6) throw new Error('A game needs 2 to 6 players.')
  if (new Set(players.map((p) => p.id)).size !== players.length || players.some((p) => !safePlayerId(p.id) || !p.name.trim())) {
    throw new Error('Players need unique, safe IDs and a name.')
  }
  const rounds = options.rounds ?? 6
  if (!Number.isInteger(rounds) || rounds < 1 || rounds > 100) throw new Error('Choose 1 to 100 rounds.')
  const seed = options.seed ?? Date.now()
  if (!Number.isFinite(seed)) throw new Error('The seed must be a finite number.')
  const state: GameState = {
    version: 1, revision: 0, rng: (seed >>> 0) || 0x6d2b79f5,
    phase: 'initial', round: 1, totalRounds: rounds,
    players: players.map((player) => ({ ...player, name: player.name.trim(), hand: [], ready: false, totalScore: 0, roundScores: [] })),
    dealerIndex: 0, turnIndex: 1, turnNumber: 1,
    deck: [], discard: [], drawn: null, drawnSource: null, drawsRemaining: 0, peekedSlot: null,
    knockedBy: null, finalTurnsRemaining: null, log: [], nextLogId: 1, roundResult: null, winners: [], knowledge: {},
  }
  dealRound(state, options.shuffle)
  return state
}

/** Validate untrusted local save data before allowing the browser adapter to restore it. */
export function isGameState(value: unknown): value is GameState {
  if (!value || typeof value !== 'object') return false
  const state = value as GameState
  const integer = (number: unknown, min: number, max = Number.MAX_SAFE_INTEGER): boolean =>
    typeof number === 'number' && Number.isInteger(number) && number >= min && number <= max
  const phases = ['initial', 'draw', 'choose', 'peek-target', 'peeking', 'swap-target', 'draw-again', 'end-turn', 'round-over', 'game-over']
  if (state.version !== 1 || !phases.includes(state.phase) || !integer(state.revision, 0) || !integer(state.rng, 1, 0xffffffff)) return false
  if (!integer(state.totalRounds, 1, 100) || !integer(state.round, 1, state.totalRounds) || !integer(state.turnNumber, 1)) return false
  if (!Array.isArray(state.players) || state.players.length < 2 || state.players.length > 6) return false
  if (!integer(state.turnIndex, 0, state.players.length - 1) || !integer(state.dealerIndex, 0, state.players.length - 1)) return false
  const canonicalCards = new Map(createDeck().map((card) => [card.id, card]))
  const validCard = (card: unknown): card is Card => {
    if (!card || typeof card !== 'object') return false
    const candidate = card as Card
    const expected = canonicalCards.get(candidate.id)
    return !!expected && candidate.kind === expected.kind &&
      (expected.kind !== 'number' || (candidate.kind === 'number' && candidate.value === expected.value))
  }
  const ids = new Set<string>()
  const cardLocations: Card[] = []
  for (const player of state.players) {
    if (!player || !safePlayerId(player.id) || ids.has(player.id) || typeof player.name !== 'string' || !player.name.trim()) return false
    ids.add(player.id)
    if (!Array.isArray(player.hand) || player.hand.length !== 4 || !player.hand.every(validCard)) return false
    if (typeof player.ready !== 'boolean' || !integer(player.totalScore, 0) || !Array.isArray(player.roundScores) || !player.roundScores.every((score) => integer(score, 0, 36))) return false
    if (player.totalScore !== player.roundScores.reduce((sum, score) => sum + score, 0)) return false
    const scored = state.phase === 'round-over' || state.phase === 'game-over'
    if (player.roundScores.length !== state.round - (scored ? 0 : 1)) return false
    cardLocations.push(...player.hand)
  }
  if (!Array.isArray(state.deck) || !state.deck.every(validCard) || !Array.isArray(state.discard) || !state.discard.every(validCard)) return false
  cardLocations.push(...state.deck, ...state.discard)
  if (state.drawn !== null) {
    if (!validCard(state.drawn)) return false
    cardLocations.push(state.drawn)
  }
  if (cardLocations.length !== 66 || new Set(cardLocations.map((card) => card.id)).size !== 66) return false
  if (state.drawnSource !== null && state.drawnSource !== 'deck' && state.drawnSource !== 'discard') return false
  if ((state.phase === 'choose') !== (state.drawn !== null) || (state.drawn !== null) !== (state.drawnSource !== null)) return false
  if (!integer(state.drawsRemaining, 0, 1) || (state.peekedSlot !== null && !validSlot(state.peekedSlot))) return false
  const allReady = state.players.every((player) => player.ready)
  if (state.phase === 'initial' ? allReady : !allReady) return false
  if (state.phase === 'draw-again') {
    if (state.drawsRemaining !== 1) return false
  } else if (state.phase !== 'choose' && state.drawsRemaining !== 0) return false
  if (state.drawnSource === 'discard' && (state.drawn?.kind !== 'number' || state.drawsRemaining !== 0)) return false
  if (state.phase === 'peeking' ? state.peekedSlot === null : state.peekedSlot !== null) return false
  if (state.knockedBy !== null && !ids.has(state.knockedBy)) return false
  if (state.finalTurnsRemaining !== null && !integer(state.finalTurnsRemaining, 0, state.players.length - 1)) return false
  const scored = state.phase === 'round-over' || state.phase === 'game-over'
  if (scored) {
    if (state.knockedBy === null || state.finalTurnsRemaining !== 0) return false
    if ((state.phase === 'game-over') !== (state.round === state.totalRounds)) return false
    if (state.players.some((player) => player.hand.some((card) => card.kind !== 'number'))) return false
  } else if (state.knockedBy === null) {
    if (state.finalTurnsRemaining !== null) return false
  } else {
    if (!integer(state.finalTurnsRemaining, 1, state.players.length - 1)) return false
    const callerIndex = state.players.findIndex((player) => player.id === state.knockedBy)
    const expectedTurn = (callerIndex + state.players.length - state.finalTurnsRemaining!) % state.players.length
    if (state.turnIndex !== expectedTurn || state.phase === 'initial') return false
  }
  if (!Array.isArray(state.log) || state.log.length > 80 || !integer(state.nextLogId, 1)) return false
  const validMove = (move: PublicCardMove | undefined, playerId: string | null): boolean => {
    if (move === undefined) return true
    if (!move || typeof move !== 'object' || !integer(move.revision, 1, state.revision) || !ids.has(move.playerId) || move.playerId !== playerId) return false
    switch (move.type) {
      case 'draw':
        return move.source === 'deck' ? move.card === null : move.source === 'discard' && validCard(move.card) && move.card.kind === 'number'
      case 'replace':
        return validSlot(move.slot) && validCard(move.discarded) &&
          (move.source === 'deck' ? move.incoming === null : move.source === 'discard' && validCard(move.incoming) && move.incoming.kind === 'number')
      case 'swap':
        return validSlot(move.slot) && validSlot(move.targetSlot) && ids.has(move.targetPlayerId) && move.targetPlayerId !== move.playerId
      case 'discard':
        return validCard(move.card)
      default:
        return false
    }
  }
  if (!state.log.every((entry) => entry && integer(entry.id, 1) && integer(entry.round, 1, state.round) && typeof entry.text === 'string' &&
    (entry.playerId === null || ids.has(entry.playerId)) && validMove(entry.move, entry.playerId))) return false
  if (!Array.isArray(state.winners) || !state.winners.every((id) => ids.has(id))) return false
  if (!state.knowledge || typeof state.knowledge !== 'object') return false
  for (const viewerId of ids) {
    const memory = state.knowledge[viewerId]
    if (!memory || typeof memory !== 'object') return false
    for (const ownerId of ids) {
      const hand = memory[ownerId]
      if (!Array.isArray(hand) || hand.length !== 4 || !hand.every((card) => card === null || validCard(card))) return false
    }
  }
  const result = state.roundResult
  if (state.phase === 'round-over' || state.phase === 'game-over') {
    if (!result || result.round !== state.round || !result.scores || typeof result.scores !== 'object') return false
    if (![...ids].every((id) => integer(result.scores[id], 0, 36))) return false
    if (state.players.some((player) => result.scores[player.id] !== player.roundScores.at(-1) ||
      result.scores[player.id] !== player.hand.reduce((sum, card) => sum + (card.kind === 'number' ? card.value : 0), 0))) return false
    if (!Array.isArray(result.winners) || !result.winners.every((id) => ids.has(id))) return false
    if (!Array.isArray(result.replacements) || !result.replacements.every((item) => item && ids.has(item.playerId) && validSlot(item.slot) && validCard(item.from) && validCard(item.to))) return false
  } else if (result !== null) return false
  return true
}

function takeDeckCard(state: GameState, shuffleCards?: CardShuffler): Card {
  if (!state.deck.length) {
    // Keep a number as the face-up discard, as required by the supplied PDF.
    // Usually this is the top card; when a power is on top, retain the latest number.
    let retainIndex = state.discard.findLastIndex((card) => card.kind === 'number')
    if (retainIndex < 0) retainIndex = state.discard.length - 1
    const retained = retainIndex >= 0 ? state.discard.splice(retainIndex, 1)[0] : null
    state.deck = shuffle(state, state.discard, shuffleCards)
    state.discard = retained ? [retained] : []
    log(state, null, 'The discard pile was shuffled into a fresh draw pile.')
  }
  const card = state.deck.pop()
  if (!card) throw new Error('No cards are available to draw.')
  return card
}

function completeAction(state: GameState): void {
  state.drawn = null
  state.drawnSource = null
  state.drawsRemaining = 0
  state.peekedSlot = null
  state.phase = 'end-turn'
}

function finishRound(state: GameState, shuffleCards?: CardShuffler): void {
  const result: RoundResult = { round: state.round, scores: {}, winners: [], replacements: [] }
  const callerIndex = state.players.findIndex((player) => player.id === state.knockedBy)
  // Resolve in visible clockwise order, starting with the caller.
  for (let offset = 0; offset < state.players.length; offset++) {
    const player = state.players[((callerIndex < 0 ? 0 : callerIndex) + offset) % state.players.length]
    for (let slot = 0; slot < 4; slot++) {
      const original = player.hand[slot]
      if (original.kind === 'number') continue
      state.discard.push(original)
      let replacement = takeDeckCard(state, shuffleCards)
      while (replacement.kind !== 'number') {
        state.discard.push(replacement)
        replacement = takeDeckCard(state, shuffleCards)
      }
      player.hand[slot] = replacement
      result.replacements.push({ playerId: player.id, slot, from: original, to: replacement })
    }
    const score = player.hand.reduce((sum, card) => sum + (card.kind === 'number' ? card.value : 0), 0)
    player.totalScore += score
    player.roundScores.push(score)
    result.scores[player.id] = score
  }
  const minimum = Math.min(...Object.values(result.scores))
  result.winners = state.players.filter((player) => result.scores[player.id] === minimum).map((player) => player.id)
  state.roundResult = result
  state.finalTurnsRemaining = 0
  if (state.round === state.totalRounds) {
    state.phase = 'game-over'
    const lowestTotal = Math.min(...state.players.map((player) => player.totalScore))
    state.winners = state.players.filter((player) => player.totalScore === lowestTotal).map((player) => player.id)
    log(state, null, 'All rounds are played. The lowest total wins!')
  } else {
    state.phase = 'round-over'
    log(state, null, `Round ${state.round} complete. The lowest score wins.`)
  }
}

function advanceTurn(state: GameState, justKnocked = false, shuffleCards?: CardShuffler): void {
  if (state.knockedBy && !justKnocked) {
    state.finalTurnsRemaining = (state.finalTurnsRemaining ?? 1) - 1
    if (state.finalTurnsRemaining === 0) {
      finishRound(state, shuffleCards)
      return
    }
  }
  state.turnIndex = (state.turnIndex + 1) % state.players.length
  state.turnNumber++
  state.phase = 'draw'
}

function validSlot(slot: number): boolean {
  return Number.isInteger(slot) && slot >= 0 && slot < 4
}

function reject(error: string): ActionResult {
  return { ok: false, error }
}

/** Immutable command reducer. Default seeded transitions are deterministic and replayable. */
export function applyAction(previous: GameState, actorId: string, action: GameAction, shuffleCards?: CardShuffler): ActionResult {
  if (!action || typeof action !== 'object' || typeof action.type !== 'string') return reject('Invalid game action.')
  const playerIndex = previous.players.findIndex((player) => player.id === actorId)
  if (playerIndex < 0) return reject('You are not a player in this game.')

  if (action.type === 'ready') {
    if (previous.phase !== 'initial' || previous.players[playerIndex].ready) return reject('Your cards are already covered.')
    const state = structuredClone(previous)
    state.players[playerIndex].ready = true
    if (state.players.every((player) => player.ready)) {
      state.phase = 'draw'
      log(state, null, `${state.players[state.turnIndex].name} starts the round.`)
    }
    state.revision++
    return { ok: true, state }
  }

  if (action.type === 'next-round') {
    if (previous.phase !== 'round-over') return reject('The current round is not finished.')
    const state = structuredClone(previous)
    state.round++
    state.dealerIndex = (state.dealerIndex + 1) % state.players.length
    dealRound(state, shuffleCards)
    state.revision++
    return { ok: true, state }
  }

  if (previous.phase === 'initial' || previous.phase === 'round-over' || previous.phase === 'game-over') return reject('The round is not in progress.')
  if (previous.turnIndex !== playerIndex) return reject('Wait for your turn.')

  const state = structuredClone(previous)
  const player = state.players[playerIndex]
  const fail = (message: string): ActionResult => reject(message)
  switch (action.type) {
    case 'draw': {
      if (state.phase !== 'draw') return fail('Finish your current action first.')
      if (action.source !== 'deck' && action.source !== 'discard') return fail('Choose the draw or discard pile.')
      if (action.source === 'discard') {
        const top = state.discard[state.discard.length - 1]
        if (!top || top.kind !== 'number') return fail('Only a number card can be taken from the discard pile.')
        state.drawn = state.discard.pop()!
        log(state, actorId, `${player.name} took a card from the discard pile.`, {
          type: 'draw', revision: state.revision + 1, playerId: actorId, source: 'discard', card: top,
        })
      } else {
        state.drawn = takeDeckCard(state, shuffleCards)
        log(state, actorId, `${player.name} drew a card.`, {
          type: 'draw', revision: state.revision + 1, playerId: actorId, source: 'deck', card: null,
        })
      }
      state.drawnSource = action.source
      state.drawsRemaining = 0
      state.phase = 'choose'
      break
    }
    case 'replace': {
      if (state.phase !== 'choose' || !state.drawn || !validSlot(action.slot)) return fail('Choose one of your four cards to replace.')
      const card = state.drawn
      const old = player.hand[action.slot]
      player.hand[action.slot] = card
      state.discard.push(old)
      for (const viewer of state.players) {
        setKnown(state, viewer.id, actorId, action.slot, viewer.id === actorId || state.drawnSource === 'discard' ? card : null)
      }
      log(state, actorId, `${player.name} replaced a card.`, {
        type: 'replace', revision: state.revision + 1, playerId: actorId, slot: action.slot,
        source: state.drawnSource!, incoming: state.drawnSource === 'discard' ? card : null, discarded: old,
      })
      completeAction(state)
      break
    }
    case 'discard': {
      if (state.phase !== 'choose' || !state.drawn) return fail('Draw a card first.')
      if (state.drawnSource === 'discard') return fail('A card taken from the discard pile must replace one of your cards.')
      const card = state.drawn
      state.discard.push(card)
      log(state, actorId, `${player.name} discarded a card.`, {
        type: 'discard', revision: state.revision + 1, playerId: actorId, card,
      })
      state.drawn = null
      state.drawnSource = null
      if (state.drawsRemaining > 0) state.phase = 'draw-again'
      else completeAction(state)
      break
    }
    case 'use-power': {
      if (state.phase !== 'choose' || !state.drawn || state.drawn.kind === 'number' || state.drawnSource !== 'deck') {
        return fail('Only a power drawn from the deck can be used.')
      }
      const power = state.drawn
      state.discard.push(power)
      state.drawn = null
      state.drawnSource = null
      state.drawsRemaining = 0
      if (power.kind === 'peek') {
        state.phase = 'peek-target'
        log(state, actorId, `${player.name} played Peek.`, {
          type: 'discard', revision: state.revision + 1, playerId: actorId, card: power,
        })
      } else if (power.kind === 'swap') {
        state.phase = 'swap-target'
        log(state, actorId, `${player.name} played Swap.`, {
          type: 'discard', revision: state.revision + 1, playerId: actorId, card: power,
        })
      } else {
        // A new Draw Two replaces any unfinished Draw Two opportunity.
        state.drawn = takeDeckCard(state, shuffleCards)
        state.drawnSource = 'deck'
        state.drawsRemaining = 1
        state.phase = 'choose'
        log(state, actorId, `${player.name} played Draw Two and drew the first card.`, {
          type: 'discard', revision: state.revision + 1, playerId: actorId, card: power,
        })
      }
      break
    }
    case 'peek': {
      if (state.phase !== 'peek-target' || !validSlot(action.slot)) return fail('Choose one of your own cards to peek at.')
      setKnown(state, actorId, actorId, action.slot, player.hand[action.slot])
      state.peekedSlot = action.slot
      state.phase = 'peeking'
      log(state, actorId, `${player.name} peeked at a card.`)
      break
    }
    case 'finish-peek': {
      if (state.phase !== 'peeking') return fail('There is no peek to finish.')
      completeAction(state)
      break
    }
    case 'swap': {
      if (state.phase !== 'swap-target' || !validSlot(action.ownSlot) || !validSlot(action.targetSlot)) return fail('Choose one card in each row to swap.')
      const target = state.players.find((candidate) => candidate.id === action.targetPlayerId)
      if (!target || target.id === actorId) return fail('Choose a different player to swap with.')
      ;[player.hand[action.ownSlot], target.hand[action.targetSlot]] = [target.hand[action.targetSlot], player.hand[action.ownSlot]]
      for (const viewer of state.players) {
        const knownOwn = state.knowledge[viewer.id][actorId][action.ownSlot]
        const knownOther = state.knowledge[viewer.id][target.id][action.targetSlot]
        setKnown(state, viewer.id, actorId, action.ownSlot, knownOther)
        setKnown(state, viewer.id, target.id, action.targetSlot, knownOwn)
      }
      log(state, actorId, `${player.name} swapped a card with ${target.name}.`, {
        type: 'swap', revision: state.revision + 1, playerId: actorId, slot: action.ownSlot,
        targetPlayerId: target.id, targetSlot: action.targetSlot,
      })
      completeAction(state)
      break
    }
    case 'skip': {
      if (state.phase !== 'swap-target' && state.phase !== 'peek-target') return fail('There is no optional power to skip.')
      log(state, actorId, `${player.name} skipped the power.`)
      completeAction(state)
      break
    }
    case 'draw-again': {
      if (state.phase !== 'draw-again' || state.drawsRemaining !== 1) return fail('There is no second draw available.')
      state.drawn = takeDeckCard(state, shuffleCards)
      state.drawnSource = 'deck'
      state.drawsRemaining = 0
      state.phase = 'choose'
      log(state, actorId, `${player.name} drew the second card.`, {
        type: 'draw', revision: state.revision + 1, playerId: actorId, source: 'deck', card: null,
      })
      break
    }
    case 'end-turn': {
      if (state.phase !== 'end-turn') return fail('Finish your action before ending your turn.')
      advanceTurn(state, false, shuffleCards)
      break
    }
    case 'knock': {
      if (state.phase !== 'end-turn') return fail('You can knock only at the end of your turn.')
      if (state.knockedBy) return fail('The final turns have already started.')
      state.knockedBy = actorId
      state.finalTurnsRemaining = state.players.length - 1
      log(state, actorId, `${player.name} called Bitchbende! Everyone else has one last turn.`)
      advanceTurn(state, true, shuffleCards)
      break
    }
    default:
      return fail('Unknown game action.')
  }
  state.revision++
  return { ok: true, state }
}

function publicCard(card: Card): Card {
  return card.kind === 'number'
    ? { id: card.id, kind: 'number', value: card.value }
    : { id: card.id, kind: card.kind }
}

/** Explicitly project metadata instead of forwarding arbitrary persisted fields. */
function publicLog(entry: GameLog, players: GameState['players']): GameLog {
  const result: GameLog = { id: entry.id, round: entry.round, playerId: entry.playerId, text: activityText(entry, players) }
  const move = entry.move
  if (!move) return result
  const common = { revision: move.revision, playerId: move.playerId }
  switch (move.type) {
    case 'draw':
      result.move = { ...common, type: 'draw', source: move.source, card: move.source === 'discard' && move.card ? publicCard(move.card) : null }
      break
    case 'replace':
      result.move = {
        ...common, type: 'replace', slot: move.slot, source: move.source,
        incoming: move.source === 'discard' && move.incoming ? publicCard(move.incoming) : null,
        discarded: publicCard(move.discarded),
      }
      break
    case 'swap':
      result.move = { ...common, type: 'swap', slot: move.slot, targetPlayerId: move.targetPlayerId, targetSlot: move.targetSlot }
      break
    case 'discard':
      result.move = { ...common, type: 'discard', card: publicCard(move.card) }
      break
  }
  return result
}

/** Do not send GameState to clients: this projection is the hidden-information boundary. */
export function getPlayerView(state: GameState, viewerId: string): GameView {
  const current = state.players[state.turnIndex]
  const revealed = state.phase === 'round-over' || state.phase === 'game-over'
  const viewerIsPlaying = state.players.some((player) => player.id === viewerId)
  const view: GameView = {
    phase: state.phase, round: state.round, totalRounds: state.totalRounds, revision: state.revision,
    turnIndex: state.turnIndex, turnNumber: state.turnNumber, currentPlayerId: current.id, dealerIndex: state.dealerIndex,
    players: state.players.map((player) => ({
      id: player.id, name: player.name, ready: player.ready, totalScore: player.totalScore, roundScores: [...player.roundScores],
      hand: player.hand.map((card, slot) => {
        if (revealed) return card
        if (player.id !== viewerId) return null
        if (state.phase === 'initial' && !player.ready && (slot === 0 || slot === 3)) return card
        if (state.phase === 'peeking' && current.id === viewerId && state.peekedSlot === slot) return card
        return null
      }),
    })),
    deckCount: state.deck.length, discard: state.discard[state.discard.length - 1] ?? null,
    drawn: viewerIsPlaying && current.id === viewerId ? state.drawn : null,
    drawnSource: state.drawnSource, drawsRemaining: state.drawsRemaining,
    peekedSlot: current.id === viewerId ? state.peekedSlot : null,
    knockedBy: state.knockedBy, finalTurnsRemaining: state.finalTurnsRemaining,
    log: state.log.map((entry) => publicLog(entry, state.players)), roundResult: revealed ? state.roundResult : null, winners: state.winners,
  }
  // Detach all references so consumers cannot mutate authoritative cards or logs.
  return structuredClone(view)
}

/** Estimate unseen numbers from the deck list and cards this player has observed. */
function unseenNumberProbabilities(state: GameState, actorId: string): number[] {
  const unseen = new Map(createDeck().filter((card) => card.kind === 'number').map((card) => [card.id, card]))
  for (const card of [...state.discard, ...Object.values(state.knowledge[actorId]).flat(), state.drawn]) {
    if (card) unseen.delete(card.id)
  }
  const counts = Array<number>(10).fill(0)
  for (const card of unseen.values()) if (card.kind === 'number') counts[card.value]++
  // A completely counted numeric deck is possible near scoring; retain a safe prior.
  if (!unseen.size) return [4, 4, 4, 4, 4, 4, 4, 4, 4, 9].map((count) => count / 45)
  return counts.map((count) => count / unseen.size)
}

function expectedValue(card: Card | null, unseenMean: number): number {
  return card?.kind === 'number' ? card.value : unseenMean
}

function exchangeValue(card: Card | null, unseenMean: number): number {
  if (card?.kind === 'number') return card.value
  // Remove uncertainty before giving up a remembered 0–3. A dealt power also
  // carries the risk of a random replacement when the round is scored.
  return Math.max(4, unseenMean + (card === null ? 0.25 : 0.5))
}

function scoreProbabilities(hand: (Card | null)[], unseen: number[]): number[] {
  let totals = [1]
  for (const card of hand) {
    const values = card?.kind === 'number'
      ? Array.from({ length: 10 }, (_, value) => value === card.value ? 1 : 0)
      : unseen
    const next = Array<number>(totals.length + 9).fill(0)
    for (let total = 0; total < totals.length; total++) {
      for (let value = 0; value < values.length; value++) next[total + value] += totals[total] * values[value]
    }
    totals = next
  }
  return totals
}

/** Stable variation per turn, using public facts instead of the hidden shuffle RNG. */
function botCallRoll(state: GameState, actorId: string): number {
  let hash = 2166136261
  for (const character of `${actorId}:${state.round}:${state.turnNumber}`) {
    hash = Math.imul(hash ^ character.charCodeAt(0), 16777619)
  }
  hash = Math.imul(hash ^ (hash >>> 16), 0x85ebca6b)
  hash = Math.imul(hash ^ (hash >>> 13), 0xc2b2ae35)
  return ((hash ^ (hash >>> 16)) >>> 0) / 4294967296
}

/** Bot strategy reads only its own observed knowledge and its own drawn card. */
export function chooseBotAction(state: GameState, actorId: string): GameAction | null {
  const player = state.players.find((candidate) => candidate.id === actorId)
  if (!player) return null
  if (state.phase === 'initial') return player.ready ? null : { type: 'ready' }
  if (state.players[state.turnIndex].id !== actorId) return null
  const memory = state.knowledge[actorId]
  const own = memory[actorId]
  const unseen = unseenNumberProbabilities(state, actorId)
  const unseenMean = unseen.reduce((sum, chance, value) => sum + chance * value, 0)
  const worstSlot = own.reduce((best, card, slot) => exchangeValue(card, unseenMean) > exchangeValue(own[best], unseenMean) ? slot : best, 0)
  const worstValue = exchangeValue(own[worstSlot], unseenMean)
  const helpfulSwap = (): GameAction | null => {
    let best: { playerId: string; slot: number; estimate: number } | null = null
    for (const other of state.players) {
      if (other.id === actorId) continue
      for (let slot = 0; slot < 4; slot++) {
        const target = memory[other.id][slot]
        const estimate = exchangeValue(target, unseenMean)
        const minimumGain = target?.kind === 'number' ? 0.5 : 1
        if (worstValue - estimate >= minimumGain && (!best || estimate < best.estimate)) {
          best = { playerId: other.id, slot, estimate }
        }
      }
    }
    return best ? { type: 'swap', ownSlot: worstSlot, targetPlayerId: best.playerId, targetSlot: best.slot } : null
  }
  switch (state.phase) {
    case 'draw': {
      const top = state.discard[state.discard.length - 1]
      return { type: 'draw', source: top?.kind === 'number' && top.value < worstValue ? 'discard' : 'deck' }
    }
    case 'choose': {
      const card = state.drawn
      if (!card) return null
      if (state.drawnSource === 'discard') return { type: 'replace', slot: worstSlot }
      if (card.kind !== 'number') {
        if (card.kind === 'peek') return { type: own.some((known) => known === null) ? 'use-power' : 'discard' }
        if (card.kind === 'swap') return { type: helpfulSwap() ? 'use-power' : 'discard' }
        return { type: 'use-power' }
      }
      // On the first Draw Two opportunity, pass a weak improvement to try again.
      if (state.drawsRemaining > 0 && card.value > 3 && worstValue - card.value < 2) return { type: 'discard' }
      return card.value < worstValue ? { type: 'replace', slot: worstSlot } : { type: 'discard' }
    }
    case 'peek-target': {
      const unknown = own.findIndex((card) => card === null)
      return unknown >= 0 ? { type: 'peek', slot: unknown } : { type: 'skip' }
    }
    case 'peeking': return { type: 'finish-peek' }
    case 'swap-target': return helpfulSwap() ?? { type: 'skip' }
    case 'draw-again': return { type: 'draw-again' }
    case 'end-turn': {
      if (state.knockedBy) return { type: 'end-turn' }
      // A good-looking estimate must not trigger a call with unknown cards or
      // powers that will turn into random numbers at scoring time.
      if (own.some((card) => card?.kind !== 'number')) return { type: 'end-turn' }
      const estimatedTotal = own.reduce((sum, card) => sum + expectedValue(card, unseenMean), 0)
      if (estimatedTotal >= 10) return { type: 'end-turn' }
      const opponents = state.players.filter((other) => other.id !== actorId).map((other) => memory[other.id])
      const opponentBest = Math.min(...opponents.map((hand) => hand.reduce((sum, card) => sum + expectedValue(card, unseenMean), 0)))
      const ownChances = scoreProbabilities(own, unseen)
      const opponentChances = opponents.map((hand) => scoreProbabilities(hand, unseen))
      const confidence = ownChances.reduce((chance, probability, score) => chance + probability * opponentChances.reduce(
        (all, totals) => all * totals.slice(score).reduce((sum, value) => sum + value, 0), 1,
      ), 0)
      const turnsPerPlayer = state.turnNumber / state.players.length
      // Opponents get one final improvement, so call only with a good margin.
      // After several turns, accept a closer race rather than waiting for perfection.
      const requiredConfidence = turnsPerPlayer >= 8 ? 0.55 : turnsPerPlayer >= 4 ? 0.7 : 0.82
      // Excellent hands call promptly. Good but less secure hands sometimes
      // wait for another improvement, making timing less predictable.
      const willingness = estimatedTotal <= 6 ? 1 : estimatedTotal === 7 ? 0.8 : estimatedTotal === 8 ? 0.65 : 0.5
      return estimatedTotal <= opponentBest && confidence >= requiredConfidence && botCallRoll(state, actorId) < willingness
        ? { type: 'knock' }
        : { type: 'end-turn' }
    }
    default: return null
  }
}
