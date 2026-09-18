# América List v1.0.37 — GitHub + Supabase

## Correções incluídas
- O.S. salva e recarrega a lista imediatamente.
- Status Finalizada/Com problema gravados no Supabase.
- Impressão/PDF com logo em URL absoluta; botão disponível na visualização da O.S.
- Login por usuário com fallback para o e-mail interno do Auth.
- Assinatura manuscrita por touchscreen/mouse via canvas.
- Assinatura salva em `service_orders.signature_data` e `signed_at`, exibida na O.S. e no PDF.

## Banco
Execute `db/github-supabase-migration.sql` no SQL Editor do Supabase uma vez.

## Edge Function
Publique `supabase/functions/admin-users/index.ts` como a função `admin-users`.
NUNCA coloque a `SUPABASE_SERVICE_ROLE_KEY` no GitHub ou no navegador.
