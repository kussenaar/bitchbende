import type { RoomDocument, RoomRepository } from './rooms.ts'

/** Development only. Restarts discard rooms; production uses Postgres. */
export class MemoryRoomRepository implements RoomRepository {
  private readonly rooms = new Map<string, RoomDocument>()

  async get(code: string): Promise<RoomDocument | null> {
    const room = this.rooms.get(code)
    return room ? structuredClone(room) : null
  }

  async create(room: RoomDocument): Promise<boolean> {
    if (this.rooms.has(room.code)) return false
    this.rooms.set(room.code, structuredClone(room))
    return true
  }

  async compareAndSwap(code: string, revision: number, next: RoomDocument): Promise<boolean> {
    if (this.rooms.get(code)?.revision !== revision) return false
    this.rooms.set(code, structuredClone(next))
    return true
  }

  async delete(code: string, revision: number): Promise<boolean> {
    if (this.rooms.get(code)?.revision !== revision) return false
    return this.rooms.delete(code)
  }
}
