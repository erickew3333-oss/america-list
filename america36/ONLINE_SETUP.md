# América List — integração online v1.0.34

Esta versão usa o Supabase diretamente no navegador para autenticação, banco de dados, Storage e atualização em tempo real.

## Já configurado no projeto Supabase

- `profiles`
- `drivers`
- `service_orders`
- `os_photos`
- `audit_logs`
- RLS e políticas
- bucket privado `os-photos`
- usuário administrador inicial

## Última etapa necessária no Supabase

No SQL Editor, execute o arquivo `db/online-login.sql`. Ele cria a função usada pela tela de login para transformar o nome de usuário em e-mail do Supabase Auth, sem armazenar senhas na tabela do aplicativo.

## Credenciais

A aplicação usa apenas a Project URL e a Publishable Key. A Publishable Key pode ficar no frontend; não coloque Secret Key ou service_role no aplicativo.

## Execução local

```bash
npm.cmd install
npm.cmd start
```

Abra `http://localhost:3000`.

O login agora é feito pelo Supabase Auth. Não existe mais seleção manual de perfil na tela de login.

## Observação sobre criação de usuários

A criação, edição e exclusão de contas Auth pelo painel administrativo usa o servidor Express seguro e a Secret Key apenas no servidor. A chave secreta nunca é enviada ao navegador.
