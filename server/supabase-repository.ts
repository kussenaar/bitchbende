import type { RoomDocument, RoomRepository } from './rooms.ts'

/** Uses the service credential only on the server, never in a browser bundle. */
export class SupabaseRoomRepository implements RoomRepository {
  private readonly endpoint: string
  private readonly headers: Record<string, string>

  constructor(url: string, serviceKey: string) {
    if (!url || !serviceKey) throw new Error('The game database is not configured.')
    this.endpoint = `${url.replace(/\/$/, '')}/rest/v1/game_rooms`
    this.headers = {
      apikey: serviceKey,
      // Opaque secret keys belong only in apikey; legacy service keys are JWTs.
      ...(serviceKey.startsWith('sb_secret_') ? {} : { Authorization: `Bearer ${serviceKey}` }),
      'Content-Type': 'application/json',
      Prefer: 'return=representation',
    }
  }

  private async request(path: string, init: RequestInit = {}): Promise<Response> {
    return fetch(`${this.endpoint}${path}`, { ...init, headers: this.headers, signal: AbortSignal.timeout(10_000) })
  }

  async get(code: string): Promise<RoomDocument | null> {
    const response = await this.request(`?code=eq.${encodeURIComponent(code)}&select=document&limit=1`)
    if (!response.ok) throw new Error('Could not read room.')
    const rows = await response.json() as { document: RoomDocument }[]
    return rows[0]?.document ?? null
  }

  async create(room: RoomDocument): Promise<boolean> {
    const response = await this.request('', {
      method: 'POST',
      body: JSON.stringify({ code: room.code, revision: room.revision, document: room, expires_at: room.expiresAt }),
    })
    if (response.status === 409) return false
    if (!response.ok) throw new Error('Could not create room.')
    return true
  }

  async compareAndSwap(code: string, revision: number, next: RoomDocument): Promise<boolean> {
    const response = await this.request(`?code=eq.${encodeURIComponent(code)}&revision=eq.${revision}`, {
      method: 'PATCH',
      body: JSON.stringify({ revision: next.revision, document: next, expires_at: next.expiresAt }),
    })
    if (!response.ok) throw new Error('Could not save room.')
    const rows = await response.json() as unknown[]
    return rows.length === 1
  }

  async delete(code: string, revision: number): Promise<boolean> {
    const response = await this.request(`?code=eq.${encodeURIComponent(code)}&revision=eq.${revision}`, { method: 'DELETE' })
    if (!response.ok) throw new Error('Could not delete room.')
    return (await response.json() as unknown[]).length === 1
  }
}
