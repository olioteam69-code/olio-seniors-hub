-- Olio Senior's Hub: intake tables, row-level security and storage rules.
-- Students never read any of these tables. Published roads stay in public.senior_roads.

-- ---------- tables ----------
create table public.journeys (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null unique default auth.uid() references auth.users(id) on delete cascade,
  first_name text not null check (char_length(first_name) between 1 and 60),
  field text check (char_length(field) <= 60),
  headline text check (char_length(headline) <= 200),
  reminder_slot text not null default 'Evening' check (reminder_slot in ('Morning','After lunch','Evening','Late night')),
  timezone text not null default 'Asia/Dhaka',
  started_at timestamptz not null default now(),
  current_day int not null default 1 check (current_day between 1 and 7),
  status text not null default 'active' check (status in ('active','paused','submitted','kept_private','withdrawn','not_a_fit','drafted')),
  last_active_at timestamptz not null default now(),
  reminders_stopped_at timestamptz,
  invited_by_code text check (char_length(invited_by_code) <= 60),
  senior_road_id uuid references public.senior_roads(id) on delete set null,
  resume_token_hash text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table public.journey_answers (
  journey_id uuid not null references public.journeys(id) on delete cascade,
  day int not null check (day between 1 and 7),
  answers jsonb not null default '{}'::jsonb check (pg_column_size(answers) < 200000),
  completed_at timestamptz,
  updated_at timestamptz not null default now(),
  primary key (journey_id, day)
);

create table public.wizard_notes (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys(id) on delete cascade,
  day int not null check (day between 1 and 7),
  question_key text not null check (char_length(question_key) <= 40),
  said text not null check (char_length(said) <= 1200),
  ask text not null check (char_length(ask) <= 600),
  created_at timestamptz not null default now()
);

create table public.senior_private (
  journey_id uuid primary key references public.journeys(id) on delete cascade,
  full_name text check (char_length(full_name) <= 120),
  email text check (char_length(email) <= 200),
  proof_type text check (proof_type in ('Offer letter','Certificate','Official profile link','Someone who can confirm')),
  proof_link text check (char_length(proof_link) <= 500),
  proof_path text check (char_length(proof_path) <= 300),
  proof_checked_by uuid references auth.users(id),
  proof_checked_at timestamptz,
  team_notes text,
  updated_at timestamptz not null default now()
);

create table public.hub_consents (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys(id) on delete cascade,
  share_road boolean not null,
  include_hard boolean not null default true,
  include_letter boolean not null default true,
  include_voice boolean not null default false,
  understands_takedown boolean not null,
  feeling text check (char_length(feeling) <= 1000),
  wording_version text not null,
  given_at timestamptz not null default now(),
  withdrawn_at timestamptz
);

create table public.hub_reminders (
  id uuid primary key default gen_random_uuid(),
  journey_id uuid not null references public.journeys(id) on delete cascade,
  day int not null check (day between 1 and 7),
  channel text not null default 'email' check (channel in ('email','hub')),
  due_at timestamptz not null,
  sent_at timestamptz,
  opened_at timestamptz,
  provider_id text,
  error text,
  created_at timestamptz not null default now(),
  unique (journey_id, day, channel)
);

create table public.community_members (
  id uuid primary key default gen_random_uuid(),
  user_id uuid unique references auth.users(id) on delete set null,
  display_name text not null,
  roles text[] not null default '{senior}',
  status text not null default 'active' check (status in ('applied','active','suspended')),
  invite_code text not null unique,
  joined_at timestamptz not null default now()
);

create table public.referrals (
  id uuid primary key default gen_random_uuid(),
  referrer_member_id uuid references public.community_members(id) on delete set null,
  journey_id uuid not null unique references public.journeys(id) on delete cascade,
  code_used text not null,
  status text not null default 'pending' check (status in ('pending','qualified','rejected')),
  attributed_at timestamptz not null default now(),
  qualified_at timestamptz
);

create index on public.wizard_notes (journey_id, day);
create index on public.hub_reminders (due_at) where sent_at is null;
create index on public.hub_consents (journey_id);
create index on public.referrals (referrer_member_id);
create index on public.journeys (status, last_active_at);

-- ---------- helpers and triggers ----------
create or replace function public.hub_owns(p_journey uuid) returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from journeys where id = p_journey and user_id = auth.uid())
$$;

create or replace function public.hub_touch() returns trigger
language plpgsql set search_path = public as $$
begin new.updated_at := now(); return new; end $$;

create trigger journeys_touch before update on public.journeys for each row execute function public.hub_touch();
create trigger senior_private_touch before update on public.senior_private for each row execute function public.hub_touch();

create or replace function public.hub_answers_activity() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  new.updated_at := now();
  update journeys set last_active_at = now(),
    status = case when status = 'paused' then 'active' else status end
  where id = new.journey_id;
  return new;
end $$;
create trigger journey_answers_activity before insert or update on public.journey_answers
  for each row execute function public.hub_answers_activity();

-- ---------- row-level security ----------
alter table public.journeys enable row level security;
alter table public.journey_answers enable row level security;
alter table public.wizard_notes enable row level security;
alter table public.senior_private enable row level security;
alter table public.hub_consents enable row level security;
alter table public.hub_reminders enable row level security;
alter table public.community_members enable row level security;
alter table public.referrals enable row level security;

-- Start with no table rights for browser roles, then grant only what each needs.
revoke all on public.journeys, public.journey_answers, public.wizard_notes, public.senior_private,
  public.hub_consents, public.hub_reminders, public.community_members, public.referrals from anon, authenticated;

grant select on public.journeys to authenticated;
grant update (first_name, field, headline, reminder_slot, current_day, reminders_stopped_at) on public.journeys to authenticated;
create policy journeys_own_or_admin_read on public.journeys for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy journeys_own_update on public.journeys for update to authenticated using (user_id = auth.uid()) with check (user_id = auth.uid());

grant select, insert, update on public.journey_answers to authenticated;
create policy answers_read on public.journey_answers for select to authenticated using (public.hub_owns(journey_id) or public.is_admin());
create policy answers_insert on public.journey_answers for insert to authenticated with check (public.hub_owns(journey_id));
create policy answers_update on public.journey_answers for update to authenticated using (public.hub_owns(journey_id)) with check (public.hub_owns(journey_id));

grant select, insert on public.wizard_notes to authenticated;
create policy wizard_read on public.wizard_notes for select to authenticated using (public.hub_owns(journey_id) or public.is_admin());
create policy wizard_insert on public.wizard_notes for insert to authenticated with check (public.hub_owns(journey_id));

grant select on public.senior_private to authenticated;
grant insert (journey_id, full_name, email, proof_type, proof_link, proof_path) on public.senior_private to authenticated;
grant update (full_name, email, proof_type, proof_link, proof_path) on public.senior_private to authenticated;
create policy private_read on public.senior_private for select to authenticated using (public.hub_owns(journey_id) or public.is_admin());
create policy private_insert on public.senior_private for insert to authenticated with check (public.hub_owns(journey_id));
create policy private_update on public.senior_private for update to authenticated using (public.hub_owns(journey_id)) with check (public.hub_owns(journey_id));

grant select on public.hub_consents to authenticated;
create policy consents_read on public.hub_consents for select to authenticated using (public.hub_owns(journey_id) or public.is_admin());

grant select on public.hub_reminders, public.community_members, public.referrals to authenticated;
create policy reminders_admin on public.hub_reminders for select to authenticated using (public.is_admin());
create policy members_read on public.community_members for select to authenticated using (user_id = auth.uid() or public.is_admin());
create policy referrals_admin on public.referrals for select to authenticated using (public.is_admin());

-- ---------- RPCs the hub calls ----------
-- Start (or return) the signed-in senior's journey. Creates their community member row and invite code,
-- and records who invited them if the code matches.
create or replace function public.hub_start(p jsonb) returns public.journeys
language plpgsql security definer set search_path = public as $$
declare j journeys; code text; ref community_members;
begin
  if auth.uid() is null then raise exception 'not signed in'; end if;
  select * into j from journeys where user_id = auth.uid();
  if found then return j; end if;
  insert into journeys (user_id, first_name, field, headline, reminder_slot, invited_by_code)
  values (auth.uid(), left(trim(p->>'first'),60), left(p->>'field',60), left(p->>'what',200),
          coalesce(nullif(p->>'when',''),'Evening'), nullif(left(trim(p->>'ref'),60),''))
  returning * into j;
  insert into senior_private (journey_id, full_name, email) values (j.id, left(p->>'full',120), left(p->>'email',200));
  loop
    code := upper(regexp_replace(left(j.first_name,6),'[^A-Za-z]','','g')) || '-' || upper(substr(md5(gen_random_uuid()::text),1,4));
    exit when not exists (select 1 from community_members where invite_code = code);
  end loop;
  insert into community_members (user_id, display_name, invite_code) values (auth.uid(), j.first_name, code)
  on conflict (user_id) do nothing;
  if j.invited_by_code is not null then
    select * into ref from community_members where upper(invite_code) = upper(j.invited_by_code) and user_id is distinct from auth.uid();
    insert into referrals (referrer_member_id, journey_id, code_used) values (ref.id, j.id, j.invited_by_code);
  end if;
  return j;
end $$;

-- Mark an evening complete. Working ahead is allowed.
create or replace function public.hub_complete_day(p_day int) returns void
language plpgsql security definer set search_path = public as $$
declare jid uuid;
begin
  select id into jid from journeys where user_id = auth.uid();
  if jid is null then raise exception 'no journey'; end if;
  insert into journey_answers (journey_id, day, completed_at) values (jid, p_day, now())
  on conflict (journey_id, day) do update set completed_at = coalesce(journey_answers.completed_at, now());
  update journeys set current_day = greatest(current_day, least(p_day + 1, 7)) where id = jid;
end $$;

-- Day 7: record consent (or keep private) and submit.
create or replace function public.hub_submit(p jsonb) returns void
language plpgsql security definer set search_path = public as $$
declare jid uuid; share boolean := coalesce((p->>'share')::boolean,false);
begin
  select id into jid from journeys where user_id = auth.uid();
  if jid is null then raise exception 'no journey'; end if;
  if share and not (coalesce((p->>'road')::boolean,false) and coalesce((p->>'ok')::boolean,false)) then
    raise exception 'sharing needs both required boxes';
  end if;
  insert into hub_consents (journey_id, share_road, include_hard, include_letter, include_voice, understands_takedown, feeling, wording_version)
  values (jid, share and (p->>'road')::boolean, coalesce((p->>'hard')::boolean,true), coalesce((p->>'letter')::boolean,true),
          coalesce((p->>'voice')::boolean,false), coalesce((p->>'ok')::boolean,false), left(p->>'feel',1000), coalesce(p->>'wording','v0-draft'));
  perform public.hub_complete_day(7);
  update journeys set status = case when share then 'submitted' else 'kept_private' end where id = jid;
end $$;

-- Senior withdraws consent; a drafted or published road gets a removal request.
create or replace function public.hub_withdraw() returns void
language plpgsql security definer set search_path = public as $$
declare j journeys;
begin
  select * into j from journeys where user_id = auth.uid();
  if not found then return; end if;
  update hub_consents set withdrawn_at = now() where journey_id = j.id and withdrawn_at is null;
  update journeys set status = 'withdrawn', reminders_stopped_at = coalesce(reminders_stopped_at, now()) where id = j.id;
  if j.senior_road_id is not null then
    update senior_roads set removal_requested_at = coalesce(removal_requested_at, now()) where id = j.senior_road_id;
  end if;
end $$;

-- ---------- admin RPCs ----------
create or replace function public.admin_hub_list() returns table (
  id uuid, first_name text, field text, headline text, status text, current_day int, days_done int,
  started_at timestamptz, last_active_at timestamptz, quiet_days int, reminders_sent int, reminders_opened int,
  invited_by text, referrer_name text, shared boolean, kept_private boolean, senior_road_id uuid)
language sql stable security definer set search_path = public as $$
  select j.id, j.first_name, j.field, j.headline, j.status, j.current_day,
    (select count(*) from journey_answers a where a.journey_id = j.id and a.completed_at is not null)::int,
    j.started_at, j.last_active_at, (extract(epoch from now() - j.last_active_at) / 86400)::int,
    (select count(*) from hub_reminders r where r.journey_id = j.id and r.sent_at is not null)::int,
    (select count(*) from hub_reminders r where r.journey_id = j.id and r.opened_at is not null)::int,
    j.invited_by_code, (select m.display_name from referrals f join community_members m on m.id = f.referrer_member_id where f.journey_id = j.id),
    exists (select 1 from hub_consents c where c.journey_id = j.id and c.share_road and c.withdrawn_at is null),
    j.status = 'kept_private', j.senior_road_id
  from journeys j where public.is_admin() order by j.last_active_at desc
$$;

create or replace function public.admin_hub_journey(p_id uuid) returns jsonb
language sql stable security definer set search_path = public as $$
  select case when not public.is_admin() then null else jsonb_build_object(
    'journey', (select to_jsonb(j) - 'resume_token_hash' from journeys j where j.id = p_id),
    'private', (select to_jsonb(s) from senior_private s where s.journey_id = p_id),
    'answers', (select coalesce(jsonb_agg(to_jsonb(a) order by a.day), '[]') from journey_answers a where a.journey_id = p_id),
    'wizard', (select coalesce(jsonb_agg(to_jsonb(w) order by w.created_at), '[]') from wizard_notes w where w.journey_id = p_id),
    'consents', (select coalesce(jsonb_agg(to_jsonb(c) order by c.given_at), '[]') from hub_consents c where c.journey_id = p_id),
    'reminders', (select coalesce(jsonb_agg(to_jsonb(r) order by r.due_at), '[]') from hub_reminders r where r.journey_id = p_id)
  ) end
$$;

create or replace function public.admin_hub_set_status(p_id uuid, p_status text, p_note text default null) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update journeys set status = p_status where id = p_id;
  if p_note is not null then update senior_private set team_notes = concat_ws(E'\n', team_notes, p_note) where journey_id = p_id; end if;
end $$;

create or replace function public.admin_hub_mark_proof(p_id uuid) returns void
language plpgsql security definer set search_path = public as $$
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  update senior_private set proof_checked_by = auth.uid(), proof_checked_at = now() where journey_id = p_id;
end $$;

-- Create a draft senior_roads row from a consented journey. The existing admin review and publish flow takes it from there.
create or replace function public.admin_hub_draft_road(p_id uuid) returns uuid
language plpgsql security definer set search_path = public as $$
declare j journeys; s senior_private; c hub_consents; a jsonb; rid uuid; steps jsonb;
begin
  if not public.is_admin() then raise exception 'admins only'; end if;
  select * into j from journeys where id = p_id;
  if j.senior_road_id is not null then return j.senior_road_id; end if;
  select * into c from hub_consents where journey_id = p_id and share_road and withdrawn_at is null order by given_at desc limit 1;
  if not found then raise exception 'no active consent to share'; end if;
  select * into s from senior_private where journey_id = p_id;
  select coalesce(jsonb_object_agg(day::text, answers), '{}') into a from journey_answers where journey_id = p_id;
  select coalesce(jsonb_agg(jsonb_build_object('title', x->>'s', 'when', x->>'m')), '[]') into steps
    from jsonb_array_elements(coalesce(a->'3'->'steps','[]')) x where coalesce(x->>'s','') <> '';
  insert into senior_roads (slug, full_name, display_name, name_display, headline, track, starting_point, story, steps, duration, lang, status, created_by)
  values (lower(regexp_replace(j.first_name,'[^A-Za-z]','','g')) || '-' || substr(md5(j.id::text),1,6),
    coalesce(nullif(trim(s.full_name),''), j.first_name), j.first_name, 'first', left(coalesce(j.headline,''),140),
    case j.field when 'A business competition' then 'competition' when 'Studying abroad' then 'admission' else 'job' end,
    left(a->'1'->>'before',300),
    left(concat_ws(E'\n\n', a->'2'->>'spark', a->'5'->>'moment', case when c.include_letter then a->'6'->>'letter' end),4000),
    steps, left(a->'6'->>'time',40), 'en', 'draft', auth.uid())
  returning id into rid;
  update journeys set senior_road_id = rid, status = 'drafted' where id = p_id;
  return rid;
end $$;

revoke execute on function public.hub_start(jsonb), public.hub_complete_day(int), public.hub_submit(jsonb), public.hub_withdraw(),
  public.admin_hub_list(), public.admin_hub_journey(uuid), public.admin_hub_set_status(uuid,text,text),
  public.admin_hub_mark_proof(uuid), public.admin_hub_draft_road(uuid), public.hub_owns(uuid),
  public.hub_answers_activity(), public.hub_touch() from public, anon;
grant execute on function public.hub_start(jsonb), public.hub_complete_day(int), public.hub_submit(jsonb), public.hub_withdraw(),
  public.admin_hub_list(), public.admin_hub_journey(uuid), public.admin_hub_set_status(uuid,text,text),
  public.admin_hub_mark_proof(uuid), public.admin_hub_draft_road(uuid), public.hub_owns(uuid) to authenticated;

-- ---------- storage: senior-media bucket ----------
-- hub/<user id>/...        voice notes and photos: the senior and admins
-- hub-proof/<user id>/...  proof files: the senior can upload, only admins can read
create policy hub_media_own_select on storage.objects for select to authenticated
  using (bucket_id = 'senior-media' and (storage.foldername(name))[1] = 'hub' and (storage.foldername(name))[2] = auth.uid()::text);
create policy hub_media_own_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'senior-media' and (storage.foldername(name))[1] in ('hub','hub-proof') and (storage.foldername(name))[2] = auth.uid()::text);
create policy hub_media_own_delete on storage.objects for delete to authenticated
  using (bucket_id = 'senior-media' and (storage.foldername(name))[1] = 'hub' and (storage.foldername(name))[2] = auth.uid()::text);
