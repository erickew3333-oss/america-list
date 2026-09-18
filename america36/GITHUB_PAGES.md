# América List — Hospedagem definitiva

## Arquitetura
- Frontend: GitHub Pages
- Login/banco/fotos/realtime: Supabase
- Operações administrativas de Auth: Supabase Edge Function `admin-users`
- O computador local NÃO é servidor.

## 1. Publicar o frontend
1. Crie um repositório no GitHub, por exemplo `america-list`.
2. Envie para a raiz do repositório: `index.html`, `css/`, `js/`, `assets/`, `manifest.json`, `sw.js` e `.nojekyll`.
3. No GitHub: Settings → Pages → Deploy from a branch → `main` → `/ (root)`.
4. Aguarde a publicação. O endereço será `https://SEU-USUARIO.github.io/america-list/`.

## 2. Publicar a função administrativa no Supabase
Use o CLI do Supabase ou o editor de Edge Functions. A pasta `supabase/functions/admin-users` contém `index.ts`.

Com o Supabase CLI:
`supabase functions deploy admin-users --project-ref zsbfwstbbfuvihcxvnvk`

A função usa automaticamente os secrets padrão do ambiente do Supabase (`SUPABASE_URL`, `SUPABASE_ANON_KEY` e `SUPABASE_SERVICE_ROLE_KEY`). A service role NÃO fica no GitHub.

## 3. Banco
O banco existente do projeto `america-list` continua sendo usado. Não execute novamente scripts antigos de criação de tabelas sem conferir o estado atual.

## 4. Teste
Abra o endereço do GitHub Pages em dois dispositivos. Faça login com contas diferentes e teste:
- criação de O.S.;
- atualização de status;
- atualização em tempo real;
- fotos;
- edição/exclusão de O.S. pelo administrador;
- cadastro/edição/exclusão de usuários;
- cadastro/edição/exclusão de motoristas.

Se uma operação administrativa retornar erro de Edge Function, confira primeiro se `admin-users` foi implantada no projeto correto.
