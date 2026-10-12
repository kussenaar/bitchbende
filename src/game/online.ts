import type { RoomCredentials, RoomErrorResponse, RoomRequest, RoomResponse, RoomView } from './room-types'
import type { DispatchResult, GameSession } from './session'
import type { GameAction, GameView } from './types'

const STORAGE_KEY = 'bitchbende.online-seat.v1'
const API_URL = import.meta.env.VITE_ROOM_API_URL?.trim() || '/api/rooms'

export class RoomApiError extends Error {
  readonly status: number
  readonly code?: string
  readonly room?: RoomView

  constructor(message: string, status = 0, body?: RoomErrorResponse) {
    super(message)
    this.name = 'RoomApiError'
    this.status = status
    this.code = body?.code
    this.room = body?.room
  }
}

export function onlineConfigurationError(): string | null {
  if (import.meta.env.PROD && !import.meta.env.VITE_ROOM_API_URL?.trim()) {
    return 'Online rooms are not available on this site yet. You can still play against computers.'
  }
  return null
}

export async function requestRoom(request: RoomRequest, signal?: AbortSignal): Promise<RoomResponse> {
  const configurationError = onlineConfigurationError()
  if (configurationError) throw new RoomApiError(configurationError)
  const headers: Record<string, string> = { 'Content-Type': 'application/json' }
  const publicKey = import.meta.env.VITE_SUPABASE_PUBLISHABLE_KEY?.trim()
  if (publicKey) headers.apikey = publicKey
  let response: Response
  try {
    const timeout = AbortSignal.timeout(12000)
    const requestSignal = signal ? AbortSignal.any([signal, timeout]) : timeout
    response = await fetch(API_URL, { method: 'POST', headers, body: JSON.stringify(request), signal: requestSignal })
  } catch (error) {
    if (signal?.aborted) throw error
    throw new RoomApiError('Cannot reach the room server. Check your connection and try again.')
  }
  let body: RoomResponse | RoomErrorResponse
  try { body = await response.json() }
  catch {
    throw new RoomApiError(import.meta.env.DEV
      ? 'The room server is not responding. Start the local room server, then retry.'
      : 'The room server returned an invalid response. Please retry shortly.', response.status)
  }
  if (!response.ok || 'error' in body) {
    const errorBody = 'error' in body ? body : undefined
    throw new RoomApiError(errorBody?.error || 'The room request failed. Please try again.', response.status, errorBody)
  }
  if (!body.room || typeof body.room.code !== 'string') throw new RoomApiError('The room server returned an invalid room.', response.status)
  return body
}

export function normalizeRoomCode(value: string): string {
  return value.toUpperCase().replace(/[^A-Z0-9]/g, '').slice(0, 8)
}

export function getInviteCode(): string {
  return normalizeRoomCode(new URL(window.location.href).searchParams.get('room') || '')
}

export function getInviteLink(code: string): string {
  const url = new URL(window.location.href)
  url.searchParams.set('room', code)
  url.hash = ''
  return url.toString()
}

export function loadRoomCredentials(): RoomCredentials | null {
  try {
    const saved = JSON.parse(localStorage.getItem(STORAGE_KEY) || 'null')
    if (typeof saved?.code !== 'string' || typeof saved?.playerId !== 'string' || typeof saved?.token !== 'string' || !saved.token) return null
    if (normalizeRoomCode(saved.code) !== saved.code || !saved.playerId) return null
    return { code: saved.code, playerId: saved.playerId, token: saved.token }
  } catch { return null }
}

export function hasSavedRoom(): boolean { return loadRoomCredentials() !== null }

export function saveRoomCredentials(credentials: RoomCredentials): void {
  try { localStorage.setItem(STORAGE_KEY, JSON.stringify(credentials)) }
  catch { /* Room play remains available when browser storage is disabled. */ }
}

export function clearRoomCredentials(): void {
  try { localStorage.removeItem(STORAGE_KEY) } catch { /* Optional persistence. */ }
}

/** Holds only the server's safe projection. It never runs the game engine. */
export class OnlineGameSession implements GameSession {
  readonly mode = 'online' as const
  readonly viewerId: string
  private snapshot: GameView
  private readonly listeners = new Set<() => void>()
  private readonly sendAction: (action: GameAction) => Promise<DispatchResult>

  constructor(viewerId: string, initialView: GameView, sendAction: (action: GameAction) => Promise<DispatchResult>) {
    this.viewerId = viewerId
    this.snapshot = initialView
    this.sendAction = sendAction
  }

  getSnapshot = () => this.snapshot
  subscribe = (listener: () => void) => {
    this.listeners.add(listener)
    return () => { this.listeners.delete(listener) }
  }
  dispatch = (action: GameAction) => this.sendAction(action)
  // The room component owns the polling lifecycle, including between rounds.
  start = () => {}
  stop = () => {}

  update(view: GameView): void {
    if (view.revision <= this.snapshot.revision) return
    this.snapshot = view
    this.listeners.forEach((listener) => listener())
  }
}
