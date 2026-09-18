# América List v1.0.34 — configuração do servidor seguro

A criação/edição/exclusão de usuários usa o servidor Express para manter a chave secreta do Supabase fora do navegador.

1. Copie `.env.example` para `.env`.
2. No Supabase, obtenha a chave **Secret** do projeto em Project Settings > API. Nunca use essa chave no código do navegador e nunca a envie por chat.
3. Coloque a chave em `SUPABASE_SERVICE_ROLE_KEY` no arquivo `.env`.
4. Rode `npm.cmd install`.
5. Rode `npm.cmd start`.

O arquivo `.env` não deve ser enviado ao GitHub.
