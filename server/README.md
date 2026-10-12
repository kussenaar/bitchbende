# Room server

The browser sends commands to an authoritative server. The same engine powers
local games and online games; online browsers receive only `getPlayerView`
projections for their authenticated seat. There are no computer players in rooms.

## Local integration

Use Node 24 or newer. Run `npm run dev` to start both the room server and Vite.
Alternatively, run `npm run dev:server` and `npm run dev:client` in separate
terminals. The Vite proxy sends `/api/rooms` to `127.0.0.1:8787`. Use separate
browser profiles or private windows to represent friends on one computer.

The development repository is in memory: stopping the room server removes its
rooms. `PORT` overrides 8787. `ALLOWED_ORIGIN` accepts a comma-separated list of
website origins; the local default permits HTTP localhost/127.0.0.1 origins on
any valid port. Only the Vite server needs to listen on the LAN for a phone to use its proxy;
add that LAN website origin to `ALLOWED_ORIGIN` when doing this.

## Deploy the Supabase backend

1. Create or select a Supabase project and link it from this repository using
   `supabase link --project-ref YOUR_PROJECT_REF`.
2. Apply `supabase/migrations/20261012000000_private_game_rooms.sql` with
   `supabase db push` (or run its contents in the project's SQL editor).
3. Set the `ALLOWED_ORIGIN` Edge secret to the website's origin, such as
   `https://YOUR_GITHUB_USERNAME.github.io`. Do not include the repository path.
   The template is in `supabase/functions/.env.example`.
4. Deploy from the repository root with `supabase functions deploy game --use-api`.
   The API bundler includes imports from the shared engine and server directories
   outside `supabase/`; this avoids older Docker bundler path restrictions.
   The committed config disables gateway JWT verification because room seats
   use their own private credentials. The handler authenticates every room read
   and game command; only creation/joining of waiting rooms are public.
5. Point the production frontend's `VITE_ROOM_API_URL` at
   `https://YOUR_PROJECT_REF.supabase.co/functions/v1/game`. If the frontend
   supplies an API key, use only the project's public publishable key.

The Edge runtime supplies `SUPABASE_URL` and `SUPABASE_SECRET_KEYS`. The handler
uses the `default` secret key for server-only REST calls, with support for the
legacy `SUPABASE_SERVICE_ROLE_KEY` as a fallback. Never place a secret or service
key in any `VITE_` variable, GitHub Pages configuration, or frontend source.

Rooms expire after seven days without a successful lobby change or move. An
optional daily Supabase Cron job running
`select public.remove_expired_game_rooms();` removes old rows. Polling does not
extend the expiration time. Keep room documents out of Realtime publications;
the browser polls the safe HTTP projection instead.

The room code is an invitation, not a seat credential. Every seat has an
independent random 256-bit token; only its SHA-256 hash is stored. Sharing a link
shares only the room code. All writes compare the stored revision atomically,
which prevents simultaneous moves, duplicate commands and overfilled lobbies.
The initial "cover my cards" actions safely retry when different players submit
them together. Strategic moves always require the exact observed revision.
Online deals and recycled decks use fresh cryptographic shuffle entropy, so a
player cannot search the local engine's seeded RNG to predict hidden cards.
Only the host starts a game or the next round. Lobby departures transfer the
host role; active-game seats stay reserved so a player can reconnect.

No cloud resources are created automatically by the local application. A real
Supabase project and a frontend deployment are needed for internet play.

Official references: [Function configuration](https://supabase.com/docs/guides/functions/function-configuration),
[Edge environment variables](https://supabase.com/docs/guides/functions/secrets),
[API keys](https://supabase.com/docs/guides/getting-started/api-keys),
[Row Level Security](https://supabase.com/docs/guides/database/postgres/row-level-security),
[CLI deployment flags](https://supabase.com/docs/reference/cli/supabase-functions-deploy).
