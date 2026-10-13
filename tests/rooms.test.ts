import assert from 'node:assert/strict'
import test from 'node:test'
import { createRoomHandler } from '../server/rooms.ts'
import { MemoryRoomRepository } from '../server/memory-repository.ts'
import { SupabaseRoomRepository } from '../server/supabase-repository.ts'
import { isLocalDevOrigin } from '../server/dev-origin.ts'
import { secureShuffle } from '../server/shuffle.ts'
import { createDeck } from '../src/game/engine.ts'
import { REACTION_IMAGES, REACTION_LIFETIME_MS, REACTION_COOLDOWN_MS } from '../src/game/reactions.ts'
import type { GameAction } from '../src/game/types.ts'
import type { RoomCredentials, RoomErrorResponse, RoomResponse, RoomView } from '../src/game/room-types.ts'

function setup(options: Parameters<typeof createRoomHandler>[1] = {}) {
  const repository = new MemoryRoomRepository()
  const handler = createRoomHandler(repository, options)
  const send = async (body: unknown, origin?: string) => {
    const response = await handler(new Request('http://localhost/api/rooms', {
      method: 'POST', headers: { 'Content-Type': 'application/json', ...(origin ? { origin } : {}) },
      body: JSON.stringify(body),
    }))
    const data = await response.json() as RoomResponse & RoomErrorResponse
    return { status: response.status, data, response }
  }
  const create = async (name = 'Host', rounds = 3) => {
    const result = await send({ operation: 'create', name, rounds })
    assert.equal(result.status, 200, result.data.error)
    return { code: result.data.room.code, playerId: result.data.playerId!, token: result.data.token! }
  }
  const join = async (code: string, name = 'Friend') => {
    const result = await send({ operation: 'join', code, name })
    assert.equal(result.status, 200, result.data.error)
    return { code, playerId: result.data.playerId!, token: result.data.token! }
  }
  const read = async (seat: RoomCredentials): Promise<RoomView> => {
    const result = await send({ operation: 'view', ...seat })
    assert.equal(result.status, 200, result.data.error)
    return result.data.room
  }
  const action = async (seat: RoomCredentials, action: GameAction) => {
    const room = await read(seat)
    return send({ operation: 'action', ...seat, revision: room.revision, action })
  }
  return { repository, handler, send, create, join, read, action }
}

test('reactions require a valid seat and bundled image, expire, and never change game state or history', async () => {
  let now = Date.now()
  const api = setup({ now: () => now })
  const host = await api.create()
  const friend = await api.join(host.code)
  assert.equal((await api.send({ operation: 'react', ...host, imageId: 'reaction-1' })).status, 409)
  await api.send({ operation: 'start', ...host })
  const before = await api.read(friend)
  for (const imageId of ['https://example.com/image.jpg', '../secret', 1, null, 'reaction-9']) {
    assert.equal((await api.send({ operation: 'react', ...host, imageId })).status, 400)
  }
  assert.equal((await api.send({ operation: 'react', ...host, token: 'a'.repeat(64), imageId: 'reaction-1' })).status, 403)
  for (const image of REACTION_IMAGES) {
    now += REACTION_COOLDOWN_MS
    const sent = await api.send({ operation: 'react', ...host, imageId: image.id })
    assert.equal(sent.status, 200, sent.data.error)
    const seen = await api.read(friend)
    assert.equal(seen.reactions.at(-1)?.imageId, image.id)
    assert.equal(seen.reactions.at(-1)?.playerId, host.playerId)
    assert.equal(seen.reactions.at(-1)?.createdAt, now)
    assert.deepEqual(seen.game, before.game, 'Reactions cannot change hands, turn, scoring, game revision, or activity')
    assert.equal(JSON.stringify(seen).includes(host.token), false)
  }
  const tooSoon = await api.send({ operation: 'react', ...host, imageId: 'reaction-1' })
  assert.equal(tooSoon.status, 429)
  assert.equal(tooSoon.data.code, 'REACTION_COOLDOWN')
  now += REACTION_LIFETIME_MS
  assert.deepEqual((await api.read(friend)).reactions, [])
})

test('concurrent reactions preserve readiness, valid game moves, and duplicate-action protection', async () => {
  let now = Date.now()
  const api = setup({ now: () => now })
  const host = await api.create()
  const friend = await api.join(host.code)
  await api.send({ operation: 'start', ...host })
  const initial = await api.read(host)
  const setupResults = await Promise.all([
    api.send({ operation: 'react', ...host, imageId: 'reaction-1' }),
    ...[host, friend].map((seat) => api.send({ operation: 'action', ...seat, revision: initial.revision, action: { type: 'ready' } })),
  ])
  assert.ok(setupResults.every((result) => result.status === 200), JSON.stringify(setupResults.map((result) => result.data.error)))
  let room = await api.read(friend)
  assert.equal(room.game!.phase, 'draw')
  assert.equal(room.game!.currentPlayerId, friend.playerId)
  now += REACTION_COOLDOWN_MS
  // A reaction can arrive after the active player last polled the room.
  assert.equal((await api.send({ operation: 'react', ...host, imageId: 'reaction-2' })).status, 200)
  const draw = { operation: 'action', ...friend, revision: room.revision, action: { type: 'draw', source: 'deck' } }
  const concurrent = await Promise.all([
    api.send({ operation: 'react', ...friend, imageId: 'reaction-3' }),
    api.send(draw),
  ])
  assert.ok(concurrent.every((result) => result.status === 200), JSON.stringify(concurrent.map((result) => result.data.error)))
  const after = await api.read(friend)
  assert.equal(after.game!.deckCount, room.game!.deckCount - 1)
  assert.equal(after.game!.revision, room.game!.revision + 1)
  assert.equal(after.reactions.length, 3, 'No concurrent reactions may be lost')
  assert.equal((await api.send(draw)).status, 409, 'An actual game change still invalidates an old action')
  now += REACTION_COOLDOWN_MS
  const duplicates = await Promise.all([1, 2].map(() => api.send({ operation: 'react', ...friend, imageId: 'reaction-4' })))
  assert.deepEqual(duplicates.map((result) => result.status).sort(), [200, 429])
  room = await api.read(host)
  assert.equal(room.game!.drawn, null, 'Reactions do not expose another player’s private draw')
})

test('reaction history stays bounded and existing rooms without reaction metadata remain playable', async () => {
  let now = Date.now()
  const api = setup({ now: () => now })
  const host = await api.create()
  const seats = [host, ...await Promise.all(['A', 'B', 'C'].map((name) => api.join(host.code, name)))]
  await api.send({ operation: 'start', ...host })
  const old = (await api.repository.get(host.code))!
  delete old.gameRoomRevision
  delete old.roundStartRevision
  assert.equal(await api.repository.compareAndSwap(host.code, old.revision, old), true)
  const initial = await api.read(host)
  await api.send({ operation: 'react', ...host, imageId: 'reaction-1' })
  const covered = await Promise.all(seats.map((seat) => api.send({ operation: 'action', ...seat, revision: initial.revision, action: { type: 'ready' } })))
  assert.ok(covered.every((result) => result.status === 200))
  for (let batch = 0; batch < 4; batch++) {
    now += REACTION_COOLDOWN_MS
    const sent = await Promise.all(seats.map((seat) => api.send({ operation: 'react', ...seat, imageId: 'reaction-8' })))
    assert.ok(sent.every((result) => result.status === 200))
  }
  assert.equal((await api.read(host)).reactions.length, 12)
  assert.equal((await api.repository.get(host.code))!.reactions!.length, 12)
})

test('room creator starts with two humans, and only the creator can start', async () => {
  const api = setup()
  const host = await api.create('  Lieve  ', 6)
  const waiting = await api.read(host)
  assert.equal(waiting.players[0].name, 'Lieve')
  assert.equal(waiting.status, 'waiting')
  assert.equal(waiting.game, null)
  assert.equal(waiting.rounds, 6)
  assert.match(host.code, /^[A-HJKMNP-Z2-9]{6}$/)
  assert.match(host.token, /^[a-f0-9]{64}$/)
  const alone = await api.send({ operation: 'start', ...host })
  assert.equal(alone.status, 409)
  assert.equal(alone.data.code, 'NEED_PLAYERS')
  const friend = await api.join(host.code.toLowerCase())
  assert.equal((await api.send({ operation: 'start', ...friend })).status, 403)
  const started = await api.send({ operation: 'start', ...host })
  assert.equal(started.status, 200)
  assert.equal(started.data.room.status, 'playing')
  assert.equal(started.data.room.players.length, 2)
  assert.equal(started.data.room.game?.players.length, 2)
  assert.equal(started.data.room.game?.totalRounds, 6)
  assert.equal((await api.send({ operation: 'start', ...host })).status, 409)
})

test('concurrent joins never overfill a four-seat room and no one joins a started game', async () => {
  const api = setup()
  const host = await api.create()
  const joins = await Promise.all(Array.from({ length: 7 }, (_, index) =>
    api.send({ operation: 'join', code: host.code, name: `Friend ${index + 1}` })))
  assert.equal(joins.filter((result) => result.status === 200).length, 3)
  assert.ok(joins.filter((result) => result.status !== 200).every((result) => result.data.code === 'ROOM_FULL'))
  assert.equal((await api.read(host)).players.length, 4)
  assert.equal((await api.send({ operation: 'start', ...host })).status, 200)
  const late = await api.send({ operation: 'join', code: host.code, name: 'Late friend' })
  assert.equal(late.status, 409)
  assert.equal(late.data.code, 'GAME_STARTED')
  assert.equal(late.data.room, undefined)
})

test('only a seat owner reads its view and private state never appears in responses', async () => {
  const api = setup()
  const host = await api.create()
  const friend = await api.join(host.code)
  const document = (await api.repository.get(host.code))!
  assert.notEqual(document.players[0].tokenHash, host.token)
  assert.equal(JSON.stringify(document).includes(host.token), false)
  assert.equal((await api.send({ operation: 'view', ...host, token: 'a'.repeat(64) })).status, 403)
  assert.equal((await api.send({ operation: 'view', ...host, playerId: friend.playerId })).status, 403)
  assert.equal((await api.send({ operation: 'view', code: host.code, playerId: host.playerId })).status, 403)
  await api.send({ operation: 'start', ...host })
  for (const seat of [host, friend]) {
    const room = await api.read(seat)
    const own = room.game!.players.find((player) => player.id === seat.playerId)!
    const other = room.game!.players.find((player) => player.id !== seat.playerId)!
    assert.equal(own.hand.filter(Boolean).length, 2)
    assert.deepEqual(other.hand, [null, null, null, null])
    for (const field of ['deck', 'knowledge', 'rng', 'token', 'tokenHash']) {
      assert.equal(field in room.game!, false)
      assert.equal(field in room, false)
    }
    assert.ok(room.players.every((player) => Object.keys(player).sort().join(',') === 'id,name'))
    assert.equal(JSON.stringify(room).includes(host.token), false)
    assert.equal(JSON.stringify(room).includes(friend.token), false)
  }
})

test('stale and duplicate actions apply once, and concurrent commands cannot overwrite each other', async () => {
  const api = setup()
  const host = await api.create()
  const friend = await api.join(host.code)
  await api.send({ operation: 'start', ...host })
  let room = await api.read(host)
  const concurrent = await Promise.all([host, friend].map((seat) => api.send({
    operation: 'action', ...seat, revision: room.revision, action: { type: 'ready' },
  })))
  assert.equal(concurrent.filter((result) => result.status === 200).length, 2)
  room = await api.read(host)
  assert.equal(room.game!.phase, 'draw')
  assert.ok(room.game!.players.every((player) => player.ready))

  room = await api.read(friend)
  assert.equal(room.game!.currentPlayerId, friend.playerId)
  const draw = { operation: 'action', ...friend, revision: room.revision, action: { type: 'draw', source: 'deck' } }
  const [first, duplicate] = await Promise.all([api.send(draw), api.send(draw)])
  assert.deepEqual([first.status, duplicate.status].sort(), [200, 409])
  const latest = await api.read(friend)
  assert.equal(latest.revision, room.revision + 1)
  assert.equal(latest.game!.deckCount, room.game!.deckCount - 1)
  assert.ok(latest.game!.drawn)
  assert.equal((await api.read(host)).game!.drawn, null)
  const replay = await api.send(draw)
  assert.equal(replay.status, 409)
  assert.equal(replay.data.code, 'STALE_REVISION')
  assert.equal(replay.data.room.revision, latest.revision)
  assert.equal((await api.read(friend)).revision, latest.revision)
  const wrongTurn = await api.action(host, { type: 'discard' })
  assert.equal(wrongTurn.status, 400)
  assert.equal(wrongTurn.data.code, 'INVALID_ACTION')
})

test('lobby departures transfer ownership, delete empty rooms, and cannot remove active seats', async () => {
  const api = setup()
  const host = await api.create()
  const friend = await api.join(host.code)
  assert.equal((await api.send({ operation: 'leave', ...host })).status, 200)
  const room = await api.read(friend)
  assert.equal(room.hostId, friend.playerId)
  assert.equal(room.players.length, 1)
  assert.equal((await api.send({ operation: 'view', ...host })).status, 403)
  const newcomer = await api.join(host.code, 'New friend')
  assert.equal((await api.send({ operation: 'start', ...friend })).status, 200)
  assert.equal((await api.send({ operation: 'leave', ...newcomer })).status, 409)
  assert.equal((await api.read(newcomer)).players.length, 2)

  const empty = await api.create()
  assert.equal((await api.send({ operation: 'leave', ...empty })).status, 200)
  assert.equal(await api.repository.get(empty.code), null)
  assert.equal((await api.send({ operation: 'join', code: empty.code, name: 'Friend' })).status, 404)
})

test('only the host advances rounds, and a complete human match reaches finished status', async () => {
  const api = setup()
  const host = await api.create('Host', 2)
  const friend = await api.join(host.code)
  await api.send({ operation: 'start', ...host })
  const firstRoundRevision = (await api.read(host)).revision
  for (let round = 1; round <= 2; round++) {
    for (const seat of [host, friend]) assert.equal((await api.action(seat, { type: 'ready' })).status, 200)
    let room = await api.read(host)
    const caller = room.game!.currentPlayerId === host.playerId ? host : friend
    const other = caller.playerId === host.playerId ? friend : host
    for (const [seat, end] of [[caller, 'knock'], [other, 'end-turn']] as const) {
      assert.equal((await api.action(seat, { type: 'draw', source: 'deck' })).status, 200)
      assert.equal((await api.action(seat, { type: 'discard' })).status, 200)
      assert.equal((await api.action(seat, { type: end })).status, 200)
    }
    room = await api.read(host)
    if (round === 1) {
      assert.equal(room.game!.phase, 'round-over')
      const forbidden = await api.action(friend, { type: 'next-round' })
      assert.equal(forbidden.status, 403)
      assert.equal(forbidden.data.code, 'HOST_ONLY')
      assert.equal((await api.action(host, { type: 'next-round' })).status, 200)
      const delayedReady = await api.send({ operation: 'action', ...host, revision: firstRoundRevision, action: { type: 'ready' } })
      assert.equal(delayedReady.status, 409)
      assert.equal((await api.read(host)).game!.players.find((player) => player.id === host.playerId)!.ready, false)
    } else {
      assert.equal(room.game!.phase, 'game-over')
      assert.equal(room.status, 'finished')
      assert.ok(room.game!.players.every((player) => player.roundScores.length === 2))
      assert.equal((await api.action(host, { type: 'next-round' })).status, 409)
    }
  }
})

test('untrusted inputs, disallowed origins and expired rooms are rejected safely', async () => {
  let time = Date.parse('2026-10-12T12:00:00Z')
  const api = setup({ now: () => time, allowedOrigins: ['https://game.example'] })
  for (const rounds of [0, 101, 1.5, '6', null]) {
    assert.equal((await api.send({ operation: 'create', name: 'Host', rounds })).status, 400)
  }
  for (const name of ['', ' '.repeat(4), 'x'.repeat(21), 'bad\nname']) {
    assert.equal((await api.send({ operation: 'create', name, rounds: 3 })).status, 400)
  }
  assert.equal((await api.send({ operation: 'join', code: 'bad&select=*', name: 'Friend' })).status, 400)
  assert.equal((await api.send({ operation: 'unknown' })).status, 400)
  assert.equal((await api.send(null)).status, 400)
  assert.equal((await api.send({ operation: 'create', name: 'Host', rounds: 3 }, 'https://attacker.example')).status, 403)
  const cors = await api.send({ operation: 'create', name: 'Host', rounds: 3 }, 'https://game.example')
  assert.equal(cors.response.headers.get('Access-Control-Allow-Origin'), 'https://game.example')
  assert.equal(cors.response.headers.get('Cache-Control'), 'no-store')
  const host = await api.create()
  time += 8 * 24 * 60 * 60 * 1000
  const expired = await api.send({ operation: 'view', ...host })
  assert.equal(expired.status, 404)
  assert.equal(expired.data.code, 'ROOM_NOT_FOUND')
  assert.equal(expired.data.room, undefined)
})

test('Supabase writes compare revisions atomically and use modern secret keys only as apikey', async (t) => {
  const requests: { url: string; init?: RequestInit }[] = []
  t.mock.method(globalThis, 'fetch', async (url: string, init?: RequestInit) => {
    requests.push({ url, init })
    return new Response('[]', { status: 200, headers: { 'Content-Type': 'application/json' } })
  })
  const api = setup()
  const host = await api.create()
  const room = (await api.repository.get(host.code))!
  const repository = new SupabaseRoomRepository('https://project.supabase.co', 'sb_secret_test')
  assert.equal(await repository.compareAndSwap(room.code, 7, { ...room, revision: 8 }), false)
  assert.equal(requests[0].init?.method, 'PATCH')
  assert.ok(requests[0].url.includes(`code=eq.${room.code}&revision=eq.7`))
  const headers = requests[0].init?.headers as Record<string, string>
  assert.equal(headers.apikey, 'sb_secret_test')
  assert.equal(headers.Authorization, undefined)
  assert.equal(headers.Prefer, 'return=representation')
  assert.equal(await repository.delete(room.code, 7), false)
  assert.equal(requests[1].init?.method, 'DELETE')
  assert.ok(requests[1].url.endsWith('&revision=eq.7'))
})

test('development accepts bumped Vite loopback ports while production remains origin-restricted', async () => {
  const local = setup({ allowOrigin: isLocalDevOrigin })
  assert.equal((await local.send({ operation: 'create', name: 'Host', rounds: 3 }, 'http://localhost:5174')).status, 200)
  assert.equal((await local.send({ operation: 'create', name: 'Host', rounds: 3 }, 'http://127.0.0.1:5180')).status, 200)
  for (const origin of ['http://localhost.attacker.example:5174', 'https://localhost:5174', 'http://192.168.1.2:5173', 'http://localhost:99999']) {
    assert.equal((await local.send({ operation: 'create', name: 'Host', rounds: 3 }, origin)).status, 403)
  }
  const production = setup({ allowedOrigins: ['https://game.example'] })
  assert.equal((await production.send({ operation: 'create', name: 'Host', rounds: 3 }, 'http://localhost:5174')).status, 403)
})

test('all four players can cover starting cards simultaneously without stale-revision retries', async () => {
  const api = setup()
  const host = await api.create()
  const seats = [host]
  for (let index = 1; index < 4; index++) seats.push(await api.join(host.code, `Friend ${index}`))
  await api.send({ operation: 'start', ...host })
  const room = await api.read(host)
  const results = await Promise.all(seats.map((seat) => api.send({
    operation: 'action', ...seat, revision: room.revision, action: { type: 'ready' },
  })))
  assert.ok(results.every((result) => result.status === 200))
  const latest = await api.read(host)
  assert.equal(latest.revision, room.revision + 4)
  assert.equal(latest.game!.phase, 'draw')
  assert.ok(latest.game!.players.every((player) => player.ready && player.hand.every((card) => card === null)))
  const replay = await api.send({ operation: 'action', ...host, revision: room.revision, action: { type: 'ready' } })
  assert.equal(replay.status, 409)
  assert.equal((await api.read(host)).revision, latest.revision)
})

test('malformed primitive actions never reach the engine or mutate the game', async () => {
  const api = setup()
  const host = await api.create()
  await api.join(host.code)
  await api.send({ operation: 'start', ...host })
  const room = await api.read(host)
  for (const action of [null, false, 42, 'ready', [], { type: 42 }]) {
    const result = await api.send({ operation: 'action', ...host, revision: room.revision, action })
    assert.equal(result.status, 400)
    assert.equal(result.data.room, undefined)
  }
  assert.equal((await api.read(host)).revision, room.revision)
})

test('online shuffling consumes fresh cryptographic entropy and preserves the immutable deck', (t) => {
  const drawEntropy = crypto.getRandomValues.bind(crypto)
  let entropyCalls = 0
  t.mock.method(crypto, 'getRandomValues', (array: Uint32Array<ArrayBuffer>) => {
    entropyCalls++
    return drawEntropy(array)
  })
  const cards = Object.freeze(createDeck().map((card) => Object.freeze(card)))
  const before = JSON.stringify(cards)
  for (let iteration = 0; iteration < 3; iteration++) {
    const shuffled = secureShuffle(cards)
    assert.notEqual(shuffled, cards)
    assert.deepEqual(shuffled.map((card) => card.id).sort(), cards.map((card) => card.id).sort())
    assert.equal(JSON.stringify(cards), before)
  }
  assert.ok(entropyCalls >= 3 * (cards.length - 1))
})
