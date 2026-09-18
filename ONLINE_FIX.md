# América List — correção para GitHub Pages + Supabase

Esta correção remove as chamadas `/api/...` das O.S. e usa Supabase diretamente para consulta, criação, atualização e status. Operações administrativas de usuários e motoristas usam a Edge Function `admin-users`.

## 1. SQL
Execute `db/github-supabase-migration.sql` uma vez no SQL Editor do Supabase.

## 2. Edge Function
No Supabase Dashboard, crie uma Edge Function chamada `admin-users` e publique o conteúdo de `supabase/functions/admin-users/index.ts`. A função usa automaticamente os secrets `SUPABASE_URL` e `SUPABASE_SERVICE_ROLE_KEY` do ambiente da Edge Function. Nunca coloque a service role key no GitHub.

## 3. GitHub Pages
Substitua no repositório o `america36/js/app.js` pelo arquivo desta pasta e o `america36/index.html` pelo correspondente. Adicione `america36/supabase/functions/admin-users/index.ts`.
