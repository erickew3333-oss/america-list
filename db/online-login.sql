-- América List — suporte ao login por nome de usuário
-- Execute no SQL Editor do projeto Supabase.

create or replace function public.get_login_email(p_username text)
returns text
language sql
stable
security definer
set search_path = public
as $$
  select au.email
  from auth.users au
  join public.profiles p on p.id = au.id
  where lower(p.username) = lower(trim(p_username))
    and p.active = true
  limit 1;
$$;

grant execute on function public.get_login_email(text) to anon, authenticated;
