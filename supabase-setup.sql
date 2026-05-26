-- Run this in Supabase Dashboard → SQL Editor → New query → Run

create table if not exists public.client_requests (
  id uuid primary key default gen_random_uuid(),
  user_id uuid not null references auth.users(id) on delete cascade,
  business_name text not null,
  current_website text not null default 'NA',
  what_they_want text not null,
  contact_name text not null,
  contact_email text not null,
  contact_phone text not null,
  status text not null default 'pending'
    check (status in ('pending', 'accepted', 'denied')),
  client_dismissed boolean not null default false,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists client_requests_user_id_idx on public.client_requests(user_id);
create index if not exists client_requests_status_idx on public.client_requests(status);

alter table public.client_requests enable row level security;

create or replace function public.is_admin()
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select coalesce(
    lower(auth.jwt() ->> 'email') in (
      'aryan.238.sharma@gmail.com',
      'samarthssinghal@gmail.com'
    ),
    false
  );
$$;

drop policy if exists "Users read own requests" on public.client_requests;
create policy "Users read own requests"
  on public.client_requests for select
  using (auth.uid() = user_id or public.is_admin());

drop policy if exists "Users insert own requests" on public.client_requests;
create policy "Users insert own requests"
  on public.client_requests for insert
  with check (
    auth.uid() = user_id
    and status = 'pending'
    and client_dismissed = false
  );

drop policy if exists "Admins update request status" on public.client_requests;
create policy "Admins update request status"
  on public.client_requests for update
  using (public.is_admin());

drop policy if exists "Users dismiss own notification" on public.client_requests;
create policy "Users dismiss own notification"
  on public.client_requests for update
  using (
    auth.uid() = user_id
    and status in ('accepted', 'denied')
  )
  with check (
    auth.uid() = user_id
    and client_dismissed = true
  );

create or replace function public.dismiss_my_request(request_id uuid)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  update public.client_requests
  set client_dismissed = true, updated_at = now()
  where id = request_id
    and user_id = auth.uid()
    and status in ('accepted', 'denied');
end;
$$;

create or replace function public.admin_set_request_status(request_id uuid, new_status text)
returns void
language plpgsql
security definer
set search_path = public
as $$
begin
  if not public.is_admin() then
    raise exception 'Not authorized';
  end if;
  if new_status not in ('accepted', 'denied') then
    raise exception 'Invalid status';
  end if;
  update public.client_requests
  set status = new_status, updated_at = now()
  where id = request_id and status = 'pending';
end;
$$;

grant usage on schema public to anon, authenticated;
grant all on public.client_requests to authenticated;
grant execute on function public.dismiss_my_request(uuid) to authenticated;
grant execute on function public.admin_set_request_status(uuid, text) to authenticated;

create table if not exists public.request_messages (
  id uuid primary key default gen_random_uuid(),
  request_id uuid not null references public.client_requests(id) on delete cascade,
  sender_user_id uuid not null references auth.users(id) on delete cascade,
  message_body text not null,
  created_at timestamptz not null default now()
);

create index if not exists request_messages_request_id_idx on public.request_messages(request_id);
create index if not exists request_messages_created_at_idx on public.request_messages(created_at);

alter table public.request_messages enable row level security;

drop policy if exists "Participants read request messages" on public.request_messages;
create policy "Participants read request messages"
  on public.request_messages for select
  using (
    exists (
      select 1
      from public.client_requests r
      where r.id = request_messages.request_id
        and r.status = 'accepted'
        and (r.user_id = auth.uid() or public.is_admin())
    )
  );

drop policy if exists "Participants send request messages" on public.request_messages;
create policy "Participants send request messages"
  on public.request_messages for insert
  with check (
    sender_user_id = auth.uid()
    and exists (
      select 1
      from public.client_requests r
      where r.id = request_messages.request_id
        and r.status = 'accepted'
        and (r.user_id = auth.uid() or public.is_admin())
    )
  );

grant all on public.request_messages to authenticated;
