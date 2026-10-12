import { createRoomHandler } from '../../../server/rooms.ts'
import { SupabaseRoomRepository } from '../../../server/supabase-repository.ts'

// Supabase injects these into the Edge runtime, never into the Vite application.
const secretKeys = JSON.parse(Deno.env.get('SUPABASE_SECRET_KEYS') ?? '{}') as Record<string, string>
const serviceKey = secretKeys.default ?? Deno.env.get('SUPABASE_SERVICE_ROLE_KEY') ?? ''
const repository = new SupabaseRoomRepository(Deno.env.get('SUPABASE_URL') ?? '', serviceKey)
const allowedOrigins = (Deno.env.get('ALLOWED_ORIGIN') ?? '').split(',').map((origin) => origin.trim()).filter(Boolean)

export default { fetch: createRoomHandler(repository, { allowedOrigins }) }
