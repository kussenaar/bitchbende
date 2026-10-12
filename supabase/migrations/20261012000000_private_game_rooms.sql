-- Only the game Edge Function may read or mutate these documents. They include
-- every hidden card and hashes of players' private seat credentials.
create table public.game_rooms (
  code text primary key check (code ~ '^[A-HJKMNP-Z2-9]{6}$'),
  revision bigint not null default 0 check (revision >= 0),
  document jsonb not null check (jsonb_typeof(document) = 'object'),
  expires_at timestamptz not null,
  check (document ->> 'code' = code),
  check ((document ->> 'revision')::bigint = revision)
);

create index game_rooms_expiry on public.game_rooms (expires_at);

alter table public.game_rooms enable row level security;
-- No anon/authenticated policies exist: the default is deny, even if grants
-- change later. Revoke table access as an additional boundary.
revoke all on public.game_rooms from public, anon, authenticated;
grant select, insert, update, delete on public.game_rooms to service_role;

comment on table public.game_rooms is
  'Private authoritative game state. Never expose through a browser client or public Realtime publication.';

-- Optional daily Supabase Cron job: select public.remove_expired_game_rooms();
-- Expiry is also enforced on every request, independently of cleanup.
create function public.remove_expired_game_rooms()
returns void
language sql
security invoker
set search_path = ''
as $$
  delete from public.game_rooms where expires_at < now();
$$;
revoke all on function public.remove_expired_game_rooms() from public, anon, authenticated;
grant execute on function public.remove_expired_game_rooms() to service_role;
