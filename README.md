# GB Gráfica

Loja virtual em React/Vite com catálogo e administração no Firebase, autenticação Google, imagens de produtos hospedadas no Cloud Storage, upload privado de artes e Checkout PagBank hospedado. A API Express valida usuário, endereço, produtos, combinações, preços e notificações financeiras no servidor.

## Rodar localmente

Requisitos: Node.js 22, npm e Java 21 para os testes das regras Firebase.

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

## Estrutura do repositório

Execute os comandos npm na raiz, onde ficam `package.json`, `package-lock.json`, `index.html`, `vite.config.ts` e `vercel.json`.

- `src/`: código da aplicação, incluindo `src/server/` e `src/e2e/E2EHarness.tsx`.
- `api/index.ts`: entrada da API para a Vercel; importa `src/server/app.ts`.
- `server.ts`: servidor local; usa a mesma aplicação Express.
- `public/`: arquivos estáticos.
- `scripts/`: utilitários de desenvolvimento, administração e validação.
- `e2e/` e `test/firebase-rules/`: testes de navegador e regras Firebase.

Na Vercel, use a raiz do repositório como **Root Directory** (campo vazio), `npm run build` como **Build Command** e `dist` como **Output Directory**, com Node.js 22. Antes de publicar a limpeza das cópias aninhadas, confira essa configuração: um projeto configurado para construir a partir de `src` precisa ser ajustado para a raiz.

`src/` não contém outro projeto npm. Não copie configurações, scripts ou a árvore completa do repositório para dentro dessa pasta. Relatórios locais de testes, inventários `tree*.txt`, pacotes e patches de manutenção são ignorados pelo Git. Credenciais e arquivos pessoais continuam locais.

## Verificações

Na primeira execução dos testes de navegador, instale o Chromium controlado pelo Playwright:

```bash
npx playwright install --with-deps chromium
```

```bash
npm test
npm run test:rules
npm run lint
npm run build
npm run test:smoke
npm run test:e2e
```

`npm run test:rules` requer Java 21 e inicia emuladores descartáveis do Firestore e do Storage com um projeto fictício `demo-*`. A suíte valida acesso público, propriedade dos dados, permissão administrativa, isolamento de pedidos, uploads privados e imagens públicas do catálogo sem acessar o Firebase real.

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

## Observabilidade e erros da API

- Toda resposta da API recebe o header `X-Request-Id`.
- Respostas de erro retornam `error`, `code` e `request_id` em JSON.
- O frontend apresenta a referência da requisição junto à mensagem, permitindo localizar a falha nos logs da Vercel.
- Os logs do servidor usam uma linha JSON por evento, com método, rota, status e duração.
- Corpos de requisição não são registrados; credenciais, CPF, telefone, e-mail e endereço são removidos de estruturas enviadas ao logger.
- CORS recusado, JSON inválido, payload excessivo, mídia incorreta e rota inexistente também seguem o mesmo contrato JSON.

Para operação normal, use `LOG_LEVEL=info`. Valores aceitos: `info`, `warn`, `error` e `silent`. `LOG_INCLUDE_STACK` deve permanecer `false`; ative temporariamente apenas durante uma investigação controlada.

## Variáveis na Vercel

Cadastre as variáveis em Project Settings → Environment Variables. Para produção, as principais são:

- `APP_URL=https://www.gblgrafica.com.br`
- `PAGBANK_ENV=production`
- `PAGBANK_TOKEN`
- `FIREBASE_SERVICE_ACCOUNT_JSON` ou as três credenciais Firebase separadas
- `FIREBASE_FIRESTORE_DATABASE_ID`
- `FIREBASE_STORAGE_BUCKET`
- `FIREBASE_APP_CHECK_MODE=monitor` durante a ativação inicial
- `VITE_GEMINI_MODEL` e, se o App Check estiver configurado, `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY`
- `LOG_LEVEL=info`
- `LOG_INCLUDE_STACK=false`

O token PagBank e a conta de serviço Firebase são exclusivos do servidor. O Firebase AI Logic usa a Gemini Developer API diretamente no app, sem `GEMINI_API_KEY`; configure o App Check no console Firebase antes de aplicar a proteção em produção.

### App Check

O frontend só inicializa o App Check quando `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` contém uma chave pública. A ausência da chave não impede login, desenvolvimento local ou build. O backend aceita três modos em `FIREBASE_APP_CHECK_MODE`:

- `off`: não verifica o header; padrão seguro para desenvolvimento antes da configuração;
- `monitor`: valida quando possível, registra ausências ou falhas e não bloqueia a requisição;
- `enforce`: rejeita rotas protegidas sem um token válido.

As rotas de frete, checkout, consulta de pagamento, atualização administrativa e acesso privado às artes são protegidas. `/api/health`, `/health` e o webhook PagBank permanecem fora do middleware porque são chamadas públicas ou servidor a servidor. O token é enviado apenas no header `X-Firebase-AppCheck`, nunca em URL ou log.

Para ativar em produção:

1. crie uma chave web baseada em pontuação do reCAPTCHA Enterprise para os domínios publicados;
2. registre a chave no Firebase App Check;
3. configure a site key pública na Vercel;
4. publique primeiro com `FIREBASE_APP_CHECK_MODE=monitor`;
5. confira os eventos `app_check_monitor_observation` nos logs;
6. altere para `enforce` somente quando o tráfego legítimo estiver enviando tokens.

Em desenvolvimento local, mantenha a site key vazia e o modo `off`, ou configure oficialmente um token de depuração no console Firebase. Nunca publique um token de depuração como variável `VITE_*`.

`PAGBANK_HOMOLOGATION_CAPTURE` deve permanecer ausente ou `false` em produção: essa variável ativa apenas a coleta Sandbox. A coleta para a validação final em produção exige a conta e a janela explícitas descritas abaixo.

## Firebase

- Adicione `localhost` e os domínios publicados em Authentication → Settings → Authorized domains.
- Ative o Cloud Storage no mesmo projeto do Firebase usado pela aplicação.
- Confirme que `FIREBASE_STORAGE_BUCKET` corresponde ao `storageBucket` de `firebase-applet-config.json`.
- Publique `firestore.rules` e `storage.rules` antes de liberar o checkout.
- A coleção `promocoes` precisa das regras desta versão para aparecer na loja.
- Configure uma política TTL para o campo `expiresAt` das coleções `_rateLimits`, `_checkoutRequests` e `_pagbankHomologation` para remover registros técnicos vencidos.

O `firebase.json` aponta explicitamente para o banco Firestore nomeado usado pelo projeto. Antes de publicar, selecione o projeto Firebase correto e confira o diff das regras:

```bash
npx firebase deploy --project gen-lang-client-0631415673 --only firestore:rules,storage
```

A geração do modelo composto precisa ler os bytes da imagem pelo navegador. Configure uma vez o CORS do bucket usando o arquivo versionado `firebase-storage-cors.json`:

```bash
gcloud storage buckets update \
  gs://gen-lang-client-0631415673.firebasestorage.app \
  --cors-file=firebase-storage-cors.json

gcloud storage buckets describe \
  gs://gen-lang-client-0631415673.firebasestorage.app \
  --format="default(cors_config)"
```

O CORS permite a leitura web; ele não torna arquivos privados públicos nem substitui `storage.rules`. A configuração usa `GET` e `HEAD`, enquanto as permissões de cada objeto continuam sendo decididas pelas regras e pelos links assinados.

Os testes E2E usam persistência e uploads simulados. Portanto, um teste E2E aprovado não confirma as permissões do projeto real. Se o painel funcionar em `/__e2e/admin`, mas o upload real devolver `storage/unauthorized` ou a gravação devolver `permission-denied`, publique os dois arquivos de regras com o comando acima, saia da conta administrativa e entre novamente para renovar o token com a claim.

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
- A arte deve ser anexada antes de o produto entrar no carrinho; não existe envio posterior pelo WhatsApp em novas compras.

### Personalização de texto

- O painel permite configurar produtos como `Texto`, `Upload de Arte`, `Texto + Imagem` ou sem personalização.
- As fontes disponíveis são administradas em Configurações. É possível cadastrar uma família CSS instalada no sistema ou enviar WOFF2 de até 3 MB; nenhuma opção comercial é fixada no código.
- O cliente informa o texto em um drawer, escolhe uma das fontes ativas e posiciona o conteúdo por clique, arraste ou teclado em uma prévia.
- Ao aplicar, o navegador produz uma imagem raster já composta com fundo, texto, fonte e posição e a envia para a área privada do Cloud Storage.
- Produtos `Texto + Imagem` aceitam JPG, PNG ou WebP como arte de origem. PDF permanece disponível apenas para produtos de upload sem texto, pois não pode ser composto no navegador.
- O pedido armazena o modelo pronto e também texto, fonte e posição como metadados de auditoria e compatibilidade.
- O servidor exige o arquivo composto, valida formato, assinatura, proprietário e metadado técnico e o move para o caminho definitivo do pedido.
- Cliente e administrador acessam o modelo por URL assinada de cinco minutos. No painel, a produção abre a imagem pronta; quando existir arte original, ela permanece disponível separadamente.

### Imagens do catálogo

- O cadastro de produtos aceita JPG, PNG e WebP enviados pelo computador, com até 8 MB por arquivo.
- A imagem principal e várias imagens de galeria são hospedadas em `catalog/products/{productId}`.
- A leitura individual é pública porque essas imagens aparecem na vitrine; gravação, listagem e exclusão exigem a custom claim `admin: true`.
- Arquivos recebem nome aleatório, extensão coerente com o MIME e não podem ser sobrescritos.
- Uploads feitos durante uma edição são removidos se o administrador descartar o formulário; imagens substituídas também são limpas depois do salvamento.
- URLs externas existentes continuam aceitas para manter compatibilidade com o catálogo antigo.

### Categorias, identidade e promoções

- Ícones de categoria, logo, banner principal e banners de promoção aceitam JPG, PNG e WebP de até 8 MB.
- Categorias podem ser renomeadas e ordenadas no painel; a loja usa o campo `ordem` e mantém itens antigos sem esse campo ao final da lista.
- Promoções exigem um produto ou categoria como alvo e desconto percentual ou fixo. Se houver mais de uma promoção aplicável, somente o menor preço é usado; descontos não são acumulados.
- O navegador exibe a promoção, mas o preço final é recalculado no servidor antes de criar o pedido e o Checkout PagBank.
- Arquivos públicos administrativos ficam em `catalog/categories`, `catalog/site`, `catalog/promotions` e `catalog/fonts`; somente administrador pode criar, listar ou excluir.

## Integridade do checkout

- Cada tentativa recebe um UUID e uma reserva persistente em `_checkoutRequests`.
- A mesma chave é enviada ao PagBank no header `x-idempotency-key`.
- O webhook é deduplicado pelo hash do corpo recebido.
- Atualizações financeiras usam transação Firestore.
- Pagamentos `PAID` só são aplicados quando valor, moeda e identificadores correspondem ao pedido. Cartão e Pix exigem o valor exato; no boleto do Checkout Hospedado também é reconhecido exclusivamente o acréscimo de R$ 1,00 devolvido pelo PagBank ao comprador.
- Webhooks com assinatura válida seguem a verificação oficial `SHA-256(token-payload)` sobre o corpo bruto.
- Se o Sandbox omitir ou enviar uma assinatura divergente, o payload é descartado como fonte de verdade e serve apenas para acionar uma consulta autenticada ao PagBank. Somente o evento devolvido pela API pode alterar o pedido.
- A consulta alternativa possui limites locais e persistentes e exige coincidência dos identificadores e dados financeiros antes de registrar a notificação como evidência.
- No retorno do Checkout, uma rota autenticada consulta o checkout e as cobranças diretamente no PagBank como mecanismo de reconciliação.
- A reconciliação usa somente identificadores já vinculados ao pedido e constrói os endpoints no servidor, sem seguir URLs recebidas do navegador ou do payload.
- Eventos reconciliados também são deduplicados e passam pelas mesmas validações de valor, moeda, método e transição de estado aplicadas ao webhook.
- Pagamento e andamento operacional são armazenados separadamente.

## Evidências para homologação PagBank

O modo de homologação registra a comunicação real do servidor com o Checkout PagBank e os webhooks validados por assinatura ou por consulta autenticada à API PagBank. Ele não registra o token do PagBank nem a assinatura do webhook e só funciona em Sandbox.

Use um ambiente local ou Preview isolado com:

```dotenv
PAGBANK_ENV=sandbox
PAGBANK_TOKEN=seu_token_sandbox
PAGBANK_HOMOLOGATION_CAPTURE=true
```

Não use dados pessoais ou cartões reais. Crie um checkout novo para cada meio que será demonstrado — cartão, Pix e boleto — e conclua o fluxo no Checkout Sandbox. Depois de receber os webhooks, exporte os três pedidos em um único anexo:

```bash
npm run pagbank:homologation:export -- \
  --order GB-PEDIDO-CARTAO \
  --order GB-PEDIDO-PIX \
  --order GB-PEDIDO-BOLETO
```

Também é possível definir o nome do arquivo:

```bash
npm run pagbank:homologation:export -- \
  --orders GB-PEDIDO-CARTAO,GB-PEDIDO-PIX,GB-PEDIDO-BOLETO \
  --output anexo-homologacao-pagbank.txt
```

O exportador lê a coleção técnica `_pagbankHomologation` usando Firebase Admin e produz um `.txt` com:

- endpoint, método e headers seguros do request;
- body exato enviado a `/checkouts`;
- status e body exatos retornados pelo PagBank;
- requests reais dos webhooks e o método usado para verificá-los;
- responses reais devolvidos pela aplicação.

O arquivo exportado é ignorado pelo Git. Revise-o antes do envio e confirme que os três meios aparecem. Ao terminar, volte `PAGBANK_HOMOLOGATION_CAPTURE` para `false` e remova a variável do ambiente de homologação.

## Evidências da validação final em produção

A coleta fica desligada por padrão. Ela captura somente checkouts da conta Firebase indicada no servidor, dentro de uma janela UTC de no máximo duas horas. Não existe parâmetro no navegador para ligar a coleta. Webhooks precisam ter passado pela validação existente e corresponder a um checkout capturado para a mesma conta e janela.

Notificações recebidas depois da janela continuam seguindo o processamento normal de pagamentos, mas não entram no anexo. Planeje a janela para incluir a confirmação do método testado.

Os registros continuam na coleção técnica `_pagbankHomologation`, bloqueada para os clientes pelas regras existentes. Em produção, somente campos técnicos permitidos são preservados nos corpos: identificadores, estados, meios, valores, datas e callbacks conhecidos. Cliente, endereço, cartão, textos livres, links de pagamento e campos desconhecidos são mascarados antes da gravação. O anexo declara que os corpos estão sanitizados; não apresenta dados omitidos como se fossem uma reprodução integral.

### Ativar somente quando o teste estiver pronto

1. Aplique o patch, valide e confira que o projeto Vercel constrói a partir da raiz do repositório.
2. Identifique no Firebase Authentication o UID da conta que fará a compra de teste.
3. Gere o início e o fim da janela imediatamente antes da configuração/deploy:

```bash
node -e 'const start = new Date(); const end = new Date(start.getTime() + 2 * 60 * 60 * 1000); console.log("PAGBANK_PRODUCTION_CAPTURE_START_AT=" + start.toISOString()); console.log("PAGBANK_PRODUCTION_CAPTURE_END_AT=" + end.toISOString());'
```

4. Na Vercel, configure em conjunto o ambiente, o token de produção como Secret e a captura:

```dotenv
PAGBANK_ENV=production
PAGBANK_TOKEN=<token de produção; somente no servidor>
PAGBANK_HOMOLOGATION_CAPTURE=false
PAGBANK_PRODUCTION_CAPTURE_USER_ID=<UID da conta de teste>
PAGBANK_PRODUCTION_CAPTURE_START_AT=<início UTC gerado acima>
PAGBANK_PRODUCTION_CAPTURE_END_AT=<fim UTC gerado acima>
```

Mantenha `APP_URL` e as origens públicas corretas. A coleta não exige alterar o modo atual do App Check. Publique um novo deployment para carregar os valores. O tempo do build faz parte da janela: confira o horário antes da compra.

5. Crie um checkout novo pela conta indicada, faça o teste acordado com o PagBank e anote o ID `GB-...`. Confira os eventos `pagbank_homologation_checkout_captured` e `pagbank_homologation_webhook_captured` nos logs. Falhas de captura são registradas em `pagbank_homologation_capture_failed`; a captura não muda o resultado do pagamento.
6. Exporte localmente usando Firebase Admin no mesmo projeto/banco. O exportador não usa o token PagBank e não precisa trocar seu `.env` local de Sandbox para produção. Informe a URL pública nesse comando para preservar os callbacks conhecidos ao sanitizar novamente o anexo:

```bash
APP_URL=https://www.gblgrafica.com.br npm run pagbank:homologation:export -- --environment production --order GB-IDDOSEUPEDIDO
```

O arquivo é criado sem sobrescrever outro, com permissão local `0600`, e contém o ambiente no nome. A exportação recusa registros de outro ambiente. Se não houver webhook validado capturado, o anexo informa sua ausência; não fabrica confirmação. Revise o anexo antes de enviar ao suporte.

7. Após obter o anexo, remova as três variáveis `PAGBANK_PRODUCTION_CAPTURE_*` e publique um novo deployment. A coleta já para automaticamente ao final da janela, mesmo sem esse novo deploy. O campo `expiresAt` continua com retenção de 14 dias; a exclusão dos registros depende da política TTL configurada no Firestore.

Esta etapa prepara a evidência do teste; não gera a chave pública solicitada pelo suporte nem altera o contrato do Checkout Hospedado.

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
