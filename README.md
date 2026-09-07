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

Na primeira execução dos testes de navegador, instale o Chromium controlado pelo Playwright:

```bash
npx playwright install --with-deps chromium
```

```bash
npm test
npm run lint
npm run build
npm run test:smoke
npm run test:e2e
```

O smoke test inicia o bundle de produção em uma porta local e valida `/api/health`, a loja, as sete páginas comerciais, `robots.txt` e `sitemap.xml`. Os testes unitários simulam respostas do checkout sem chamar Firebase ou PagBank. Os testes E2E abrem a loja e o painel administrativo em desktop e mobile com dados isolados e APIs simuladas; não escrevem no Firebase nem criam checkout real no PagBank.

## SEO, acessibilidade e resiliência

- Metadados canônicos, Open Graph e Twitter são atualizados por rota.
- A loja publica dados estruturados `WebSite` e `Store`, além de `robots.txt` e `sitemap.xml`.
- A área administrativa e a página 404 recebem `noindex`.
- Há atalhos de teclado para o conteúdo, contenção de foco nos diálogos e controle de pausa do carrossel.
- A preferência de redução de movimento do sistema é respeitada.
- Imagens fora da primeira dobra usam carregamento tardio e decodificação assíncrona.
- Uma barreira global apresenta uma recuperação segura se a interface React falhar.
- O fallback visual usa a cópia pública íntegra do logo; o arquivo histórico `public/logo.png` está corrompido e não é mais usado em execução.

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

## Documentos comerciais

O rodapé contém páginas públicas de identificação da loja, privacidade, termos, trocas e reembolsos, prazos de produção, artes personalizadas e LGPD. Antes de liberar vendas, preencha em **Admin → Configurações**:

- razão social ou nome completo do fornecedor;
- CNPJ ou CPF;
- endereço físico/comercial;
- e-mail de atendimento;
- e-mail de privacidade/LGPD;
- prazo padrão de produção.

Enquanto algum desses dados estiver ausente, as páginas exibem um aviso de documento em preparação. O checkout exige aceite explícito e o servidor registra a data e as versões aceitas no pedido. Os textos são uma base operacional e devem ser conferidos com os dados reais da empresa e, idealmente, revisados por profissional jurídico antes da publicação comercial.

## Publicação

Após validar Sandbox e configurar as variáveis de produção:

```bash
git add -A
git status
git commit -m "fix: harden store flows and interactions"
git push origin main
```

Com o repositório conectado à Vercel, o push inicia um novo deploy. Confira `/api/health`, login, frete, criação do checkout e recebimento do webhook antes de divulgar a loja.
