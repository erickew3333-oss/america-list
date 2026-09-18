# América List — teste no celular

Esta versão é uma PWA responsiva e pode ser aberta no celular pelo navegador. Ela também pode ser adicionada à tela inicial quando servida em um endereço adequado.

## Teste rápido na mesma rede Wi‑Fi

1. No computador, abra um terminal nesta pasta.
2. Rode `npm install` (primeira vez) e depois `npm start`.
3. Descubra o IP local do computador (Windows: `ipconfig`; procure o IPv4, por exemplo `192.168.1.10`).
4. No celular, conectado à mesma Wi‑Fi, abra `http://IP_DO_PC:3000`.
   Exemplo: `http://192.168.1.10:3000`
5. Para encerrar, pressione Ctrl+C no terminal.

### Observações
- O firewall do Windows pode pedir autorização para o Node.js. Permita acesso na rede privada.
- O banco online só funciona quando `DATABASE_URL` estiver configurada no servidor.
- Para instalar como aplicativo/PWA de forma completa, o ideal é publicar o sistema em HTTPS.
