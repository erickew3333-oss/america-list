# América List — versão para GitHub Pages + Supabase

Esta pasta é a adaptação da v1.0.36 para não depender do computador como servidor.

### O que mudou
- Removido o `server.js` e o `.env` do pacote de publicação.
- O frontend conversa diretamente com o Supabase usando a chave pública (publishable key).
- O.S. e motoristas usam o banco/RLS do Supabase.
- Login continua no Supabase Auth.
- Realtime continua no Supabase Realtime.
- Criação/edição/exclusão de usuários, que exigem privilégios do Auth, usam a Edge Function `admin-users`.
- A chave `service_role` nunca fica no código do navegador/GitHub.
- Service Worker atualizado para evitar cache antigo.

### Publicação
Consulte `GITHUB_PAGES.md`.
