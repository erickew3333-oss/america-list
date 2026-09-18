-- América List: correções para GitHub Pages + Supabase
-- Execute UMA vez no SQL Editor.

create or replace function public.login_email_by_username(p_username text)
returns text
language sql stable security definer set search_path=public
as $$
  select au.email from auth.users au
  join public.profiles p on p.id=au.id
  where lower(p.username)=lower(trim(p_username)) and p.active=true
  limit 1;
$$;

grant execute on function public.login_email_by_username(text) to anon, authenticated;

create or replace function public.get_login_email(p_username text)
returns text
language sql stable security definer set search_path=public
as $$
  select au.email from auth.users au
  join public.profiles p on p.id=au.id
  where lower(p.username)=lower(trim(p_username)) and p.active=true
  limit 1;
$$;

grant execute on function public.get_login_email(text) to anon, authenticated;

-- Recria as políticas das O.S. sem depender do servidor local.
do $$
declare r record;
begin
  for r in select policyname from pg_policies where schemaname='public' and tablename='service_orders' loop
    execute format('drop policy if exists %I on public.service_orders', r.policyname);
  end loop;
end $$;

create policy service_orders_select on public.service_orders
for select to authenticated
using (public.is_admin() or public.is_assistencia() or (public.is_motorista() and driver_id=public.current_driver_id()));

create policy service_orders_insert on public.service_orders
for insert to authenticated
with check (
  (public.is_admin() or public.is_assistencia() or (public.is_motorista() and driver_id=public.current_driver_id()))
  and created_by=auth.uid()
);

create policy service_orders_update on public.service_orders
for update to authenticated
using (public.is_admin() or public.is_assistencia() or (public.is_motorista() and driver_id=public.current_driver_id()))
with check (public.is_admin() or public.is_assistencia() or (public.is_motorista() and driver_id=public.current_driver_id()));

create policy service_orders_delete on public.service_orders
for delete to authenticated using (public.is_admin());

-- Habilita Realtime para as tabelas usadas pelo aplicativo.
do $$
begin
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='service_orders') then
    alter publication supabase_realtime add table public.service_orders;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='profiles') then
    alter publication supabase_realtime add table public.profiles;
  end if;
  if not exists (select 1 from pg_publication_tables where pubname='supabase_realtime' and schemaname='public' and tablename='drivers') then
    alter publication supabase_realtime add table public.drivers;
  end if;
end $$;


-- Assinatura manuscrita do associado (touchscreen/mouse).
alter table public.service_orders add column if not exists signature_data text;
alter table public.service_orders add column if not exists signed_at timestamptz;

