import { applyAction, createGame, getPlayerView } from '../src/game/engine.ts'
import type { GameAction, GameState } from '../src/game/types.ts'
import type { RoomView } from '../src/game/room-types.ts'
import { secureShuffle } from './shuffle.ts'

export interface RoomDocument {
  code: string
  hostId: string
  revision: number
  status: RoomView['status']
  players: { id: string; name: string; tokenHash: string }[]
  rounds: number
  game: GameState | null
  createdAt: string
  updatedAt: string
  expiresAt: string
}

/** Repositories must implement atomic revision comparisons, including deletes. */
export interface RoomRepository {
  get(code: string): Promise<RoomDocument | null>
  create(room: RoomDocument): Promise<boolean>
  compareAndSwap(code: string, revision: number, next: RoomDocument): Promise<boolean>
  delete(code: string, revision: number): Promise<boolean>
}

export interface RoomHandlerOptions {
  allowedOrigins?: string[]
  /** Optional local-development policy. Production supplies only allowedOrigins. */
  allowOrigin?: (origin: string) => boolean
  now?: () => number
}

const CODE_ALPHABET = 'ABCDEFGHJKMNPQRSTUVWXYZ23456789'
const MAX_BODY_BYTES = 16_384
const ROOM_LIFETIME_MS = 7 * 24 * 60 * 60 * 1000
const DEV_ORIGINS = ['http://localhost:5173', 'http://127.0.0.1:5173', 'http://localhost:4173', 'http://127.0.0.1:4173']

function randomHex(bytes: number): string {
  return Array.from(crypto.getRandomValues(new Uint8Array(bytes)), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function roomCode(): string {
  let code = ''
  // Reject the uneven tail so every character has the same probability.
  const ceiling = 256 - 256 % CODE_ALPHABET.length
  while (code.length < 6) {
    for (const byte of crypto.getRandomValues(new Uint8Array(12))) {
      if (byte < ceiling) code += CODE_ALPHABET[byte % CODE_ALPHABET.length]
      if (code.length === 6) break
    }
  }
  return code
}

async function hashToken(token: string): Promise<string> {
  const digest = await crypto.subtle.digest('SHA-256', new TextEncoder().encode(token))
  return Array.from(new Uint8Array(digest), (byte) => byte.toString(16).padStart(2, '0')).join('')
}

function equalHashes(a: string, b: string): boolean {
  if (a.length !== b.length) return false
  let difference = 0
  for (let index = 0; index < a.length; index++) difference |= a.charCodeAt(index) ^ b.charCodeAt(index)
  return difference === 0
}

function view(room: RoomDocument, viewerId: string): RoomView {
  return {
    code: room.code,
    hostId: room.hostId,
    revision: room.revision,
    status: room.status,
    players: room.players.map(({ id, name }) => ({ id, name })),
    rounds: room.rounds,
    game: room.game ? getPlayerView(room.game, viewerId) : null,
  }
}

function playerName(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const name = value.trim()
  return name.length >= 1 && name.length <= 20 && !/[\u0000-\u001f\u007f]/.test(name) ? name : null
}

function normalizedCode(value: unknown): string | null {
  if (typeof value !== 'string') return null
  const code = value.trim().toUpperCase()
  return /^[A-HJKMNP-Z2-9]{6}$/.test(code) ? code : null
}

/** HTTP adapter shared by the local server and the production Edge Function. */
export function createRoomHandler(repository: RoomRepository, options: RoomHandlerOptions = {}) {
  const allowedOrigins = options.allowedOrigins ?? DEV_ORIGINS
  const now = options.now ?? Date.now

  return async (request: Request): Promise<Response> => {
    const origin = request.headers.get('origin')
    const originAllowed = !origin || allowedOrigins.includes(origin) || options.allowOrigin?.(origin) === true
    const headers = new Headers({
      'Content-Type': 'application/json; charset=utf-8',
      'Cache-Control': 'no-store',
      'X-Content-Type-Options': 'nosniff',
      'Vary': 'Origin',
    })
    if (origin && originAllowed) {
      headers.set('Access-Control-Allow-Origin', origin)
      headers.set('Access-Control-Allow-Methods', 'POST, OPTIONS')
      headers.set('Access-Control-Allow-Headers', 'content-type, authorization, apikey, x-client-info')
      headers.set('Access-Control-Max-Age', '86400')
    }
    const response = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers })
    const failure = (error: string, status: number, code?: string, room?: RoomView) =>
      response({ error, ...(code ? { code } : {}), ...(room ? { room } : {}) }, status)

    if (!originAllowed) return failure('This website is not allowed to use the game server.', 403, 'ORIGIN_DENIED')
    if (request.method === 'OPTIONS') return new Response(null, { status: 204, headers })
    if (request.method !== 'POST') return failure('Use POST for room requests.', 405)
    if (!request.headers.get('content-type')?.toLowerCase().includes('application/json')) return failure('Send a JSON request.', 415)

    try {
      if (Number(request.headers.get('content-length')) > MAX_BODY_BYTES) return failure('The request is too large.', 413)
      const text = await request.text()
      if (new TextEncoder().encode(text).length > MAX_BODY_BYTES) return failure('The request is too large.', 413)
      let body: Record<string, unknown>
      try {
        const parsed: unknown = JSON.parse(text)
        if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) return failure('Invalid room request.', 400)
        body = parsed as Record<string, unknown>
      } catch { return failure('Invalid JSON request.', 400) }

      const operation = body.operation
      if (!['create', 'join', 'view', 'start', 'leave', 'action'].includes(String(operation))) return failure('Unknown room operation.', 400)
      const timestamp = () => new Date(now()).toISOString()
      const expiresAt = () => new Date(now() + ROOM_LIFETIME_MS).toISOString()
      const get = async (code: string) => {
        const room = await repository.get(code)
        return room && Date.parse(room.expiresAt) > now() ? room : null
      }
      const touch = (room: RoomDocument): RoomDocument => ({
        ...room, revision: room.revision + 1, updatedAt: timestamp(), expiresAt: expiresAt(),
      })

      if (operation === 'create' || operation === 'join') {
        const name = playerName(body.name)
        if (!name) return failure('Enter a name between 1 and 20 characters.', 400)
        const token = randomHex(32)
        const player = { id: `p_${randomHex(12)}`, name, tokenHash: await hashToken(token) }

        if (operation === 'create') {
          const rounds = body.rounds
          if (typeof rounds !== 'number' || !Number.isInteger(rounds) || rounds < 1 || rounds > 100) {
            return failure('Choose 1 to 100 rounds.', 400)
          }
          for (let attempt = 0; attempt < 8; attempt++) {
            const room: RoomDocument = {
              code: roomCode(), hostId: player.id, revision: 0, status: 'waiting',
              players: [player], rounds, game: null,
              createdAt: timestamp(), updatedAt: timestamp(), expiresAt: expiresAt(),
            }
            if (await repository.create(room)) return response({ room: view(room, player.id), playerId: player.id, token })
          }
          return failure('Could not create a room. Please try again.', 503)
        }

        const code = normalizedCode(body.code)
        if (!code) return failure('Enter the six-character room code.', 400)
        // Retry concurrent lobby joins against the latest revision; the cap is atomic.
        for (let attempt = 0; attempt < 8; attempt++) {
          const room = await get(code)
          if (!room) return failure('That room does not exist or has expired.', 404, 'ROOM_NOT_FOUND')
          if (room.status !== 'waiting') return failure('This game has already started.', 409, 'GAME_STARTED')
          if (room.players.length >= 4) return failure('This room already has four players.', 409, 'ROOM_FULL')
          const next = touch({ ...room, players: [...room.players, player] })
          if (await repository.compareAndSwap(code, room.revision, next)) {
            return response({ room: view(next, player.id), playerId: player.id, token })
          }
        }
        return failure('The room changed while you were joining. Try again.', 409, 'ROOM_CHANGED')
      }

      const code = normalizedCode(body.code)
      if (!code) return failure('Enter the six-character room code.', 400)
      if (typeof body.playerId !== 'string' || typeof body.token !== 'string' || !/^[a-f0-9]{64}$/.test(body.token)) {
        return failure('Your seat credential is invalid. Rejoin the room.', 403, 'INVALID_SEAT')
      }
      const room = await get(code)
      if (!room) return failure('That room does not exist or has expired.', 404, 'ROOM_NOT_FOUND')
      const player = room.players.find((seat) => seat.id === body.playerId)
      if (!player || !equalHashes(player.tokenHash, await hashToken(body.token))) {
        return failure('Your seat credential is invalid. Rejoin the room.', 403, 'INVALID_SEAT')
      }
      const playerId = player.id
      const stale = async () => {
        const latest = await get(code)
        const stillSeated = latest?.players.find((seat) => seat.id === playerId && equalHashes(seat.tokenHash, player.tokenHash))
        return failure('The room changed. Your game has been refreshed; try the move again.', 409, 'STALE_REVISION',
          latest && stillSeated ? view(latest, playerId) : undefined)
      }

      if (operation === 'view') return response({ room: view(room, playerId) })
      if (operation === 'start') {
        if (playerId !== room.hostId) return failure('Only the room creator can start the game.', 403, 'HOST_ONLY')
        if (room.status !== 'waiting') return failure('This game has already started.', 409, 'GAME_STARTED')
        if (room.players.length < 2) return failure('At least two players must join before starting.', 409, 'NEED_PLAYERS')
        const seed = crypto.getRandomValues(new Uint32Array(1))[0]
        const next = touch({
          ...room, status: 'playing',
          game: createGame(room.players.map(({ id, name }) => ({ id, name })), { rounds: room.rounds, seed, shuffle: secureShuffle }),
        })
        if (!await repository.compareAndSwap(code, room.revision, next)) return stale()
        return response({ room: view(next, playerId) })
      }
      if (operation === 'leave') {
        if (room.status !== 'waiting') {
          return failure('Seats stay reserved after the game starts. You can close this page and return to the same seat.', 409, 'GAME_STARTED')
        }
        const remaining = room.players.filter((seat) => seat.id !== playerId)
        const next = touch({ ...room, players: remaining, hostId: remaining[0]?.id ?? '' })
        const saved = remaining.length
          ? await repository.compareAndSwap(code, room.revision, next)
          : await repository.delete(code, room.revision)
        if (!saved) return stale()
        return response({ room: view(next, playerId) })
      }

      if (typeof body.revision !== 'number' || !Number.isSafeInteger(body.revision) || body.revision < 0) {
        return failure('This move is missing a valid room revision.', 400)
      }
      const action = body.action
      if (!action || typeof action !== 'object' || Array.isArray(action) || typeof (action as GameAction).type !== 'string') {
        return failure('Invalid game action.', 400)
      }
      // Covering your own starting cards commutes with other players doing the
      // same. Retry only this preparation action; strategic moves still require
      // the exact revision the player saw and are never silently replayed.
      if ((action as GameAction).type === 'ready' && body.revision <= room.revision &&
        room.game?.phase === 'initial' && !room.game.players.find((seat) => seat.id === playerId)?.ready) {
        let candidate = room
        for (let attempt = 0; attempt < 8; attempt++) {
          const sameSeat = candidate.players.some((seat) => seat.id === playerId && equalHashes(seat.tokenHash, player.tokenHash))
          if (!sameSeat || candidate.status !== 'playing' || candidate.game?.phase !== 'initial') return stale()
          // Only readiness writes happen during preparation. Their count gives
          // this round's starting revision, excluding delayed earlier-round
          // commands that must not cover a new deal before its owner sees it.
          const roundStartRevision = candidate.revision - candidate.game.players.filter((seat) => seat.ready).length
          if (body.revision < roundStartRevision) return stale()
          const result = applyAction(candidate.game, playerId, { type: 'ready' }, secureShuffle)
          if (!result.ok) return stale()
          const next = touch({ ...candidate, game: result.state })
          if (await repository.compareAndSwap(code, candidate.revision, next)) return response({ room: view(next, playerId) })
          const latest = await get(code)
          if (!latest) return stale()
          candidate = latest
        }
        return stale()
      }
      if (body.revision !== room.revision) return stale()
      if (!room.game || room.status !== 'playing') return failure('The game is not in progress.', 409)
      if ((action as GameAction).type === 'next-round' && playerId !== room.hostId) {
        return failure('Only the room creator can start the next round.', 403, 'HOST_ONLY')
      }
      const result = applyAction(room.game, playerId, action as GameAction, secureShuffle)
      if (!result.ok) return failure(result.error, 400, 'INVALID_ACTION')
      const next = touch({ ...room, game: result.state, status: result.state.phase === 'game-over' ? 'finished' : 'playing' })
      if (!await repository.compareAndSwap(code, room.revision, next)) return stale()
      return response({ room: view(next, playerId) })
    } catch {
      // Do not serialize database errors or private game state into error responses.
      return failure('The game server could not complete your request. Please try again.', 503, 'SERVER_UNAVAILABLE')
    }
  }
}
