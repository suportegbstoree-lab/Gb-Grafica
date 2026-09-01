# GB Gráfica

Loja virtual em React/Vite com catálogo e administração no Firebase, autenticação Google, upload privado de artes e Checkout PagBank hospedado. A API Express valida usuário, endereço, produtos, combinações, preços e notificações financeiras no servidor.

## Rodar localmente

Requisitos: Node.js 22 ou superior e npm.

```bash
npm ci
cp .env.example .env
npm run dev
```

Abra `http://localhost:3000`. Preencha o `.env` com credenciais de Sandbox; nunca versione esse arquivo.

Para usar um Quick Tunnel do Cloudflare, mantenha o site na porta 3000, execute o túnel em outro terminal e defina no `.env`:

```dotenv
APP_URL=https://seu-subdominio.trycloudflare.com
VITE_ALLOWED_HOSTS=.trycloudflare.com
```

Reinicie `npm run dev` depois de alterar variáveis de ambiente.

## Verificações

```bash
npm test
npm run lint
npm run build
```

## Variáveis na Vercel

Cadastre as variáveis em Project Settings → Environment Variables. Para produção, as principais são:

- `APP_URL=https://www.gblgrafica.com.br`
- `PAGBANK_ENV=production`
- `PAGBANK_TOKEN`
- `FIREBASE_SERVICE_ACCOUNT_JSON` ou as três credenciais Firebase separadas
- `FIREBASE_FIRESTORE_DATABASE_ID`
- `FIREBASE_STORAGE_BUCKET`
- `GEMINI_API_KEY` e, opcionalmente, `GEMINI_MODEL`

O token PagBank, a conta de serviço Firebase e a chave Gemini são exclusivos do servidor. Não use prefixo `VITE_` nesses segredos.

## Firebase

- Adicione `localhost` e os domínios publicados em Authentication → Settings → Authorized domains.
- Ative o Cloud Storage no mesmo projeto do Firebase usado pela aplicação.
- Confirme que `FIREBASE_STORAGE_BUCKET` corresponde ao `storageBucket` de `firebase-applet-config.json`.
- Publique `firestore.rules` e `storage.rules` antes de liberar o checkout.
- A coleção `promocoes` precisa das regras desta versão para aparecer na loja.
- Configure uma política TTL para o campo `expiresAt` das coleções `_rateLimits` e `_checkoutRequests` para remover registros técnicos vencidos.

O `firebase.json` aponta explicitamente para o banco Firestore nomeado usado pelo projeto. Antes de publicar, selecione o projeto Firebase correto e confira o diff das regras:

```bash
firebase deploy --project gen-lang-client-0631415673 --only firestore,storage
```

### Administrador

O acesso administrativo aceita a custom claim `admin: true`. Depois que a conta Google já tiver feito ao menos um login, aplique a permissão usando as credenciais Firebase Admin do `.env`:

```bash
npm run admin:set -- --email administrador@exemplo.com
```

Depois disso, saia e entre novamente no site para receber um token atualizado. O documento `users/{uid}` com `role: admin` continua aceito para compatibilidade com a conta administrativa existente.

### Artes personalizadas

- Formatos aceitos: PDF, PNG, JPG e WebP.
- Tamanho máximo: 15 MB.
- O navegador envia diretamente ao Cloud Storage usando `storage.rules`.
- O pedido guarda apenas o caminho privado do arquivo.
- Cliente e administrador recebem um link assinado de cinco minutos através da API.

## Integridade do checkout

- Cada tentativa recebe um UUID e uma reserva persistente em `_checkoutRequests`.
- A mesma chave é enviada ao PagBank no header `x-idempotency-key`.
- O webhook é deduplicado pelo hash do corpo recebido.
- Atualizações financeiras usam transação Firestore.
- Pagamentos `PAID` só são aplicados quando valor, moeda e identificadores correspondem ao pedido.
- Pagamento e andamento operacional são armazenados separadamente.

## Publicação

Após validar Sandbox e configurar as variáveis de produção:

```bash
git add -A
git status
git commit -m "fix: harden store flows and interactions"
git push origin main
```

Com o repositório conectado à Vercel, o push inicia um novo deploy. Confira `/api/health`, login, frete, criação do checkout e recebimento do webhook antes de divulgar a loja.
