# Changelog

## 2026-09-08 — Observabilidade e contrato de segurança da API

- Adicionado `X-Request-Id` a todas as respostas e correlação automática entre erros apresentados ao usuário e logs do servidor.
- Padronizadas respostas de erro em JSON com mensagem pública, código estável e referência da requisição.
- Convertidos logs do servidor para eventos JSON com método, rota, status HTTP e duração em milissegundos.
- Removidos de logs corpos de requisição, credenciais, tokens, CPF, telefone, e-mail, endereço e campos sensíveis aninhados.
- Criados níveis configuráveis de log e stack traces desativados por padrão.
- Corrigidas respostas de CORS recusado, JSON malformado, payload acima de 256 KB e tipo de mídia incompatível.
- Impedido que rotas `/api` inexistentes retornem o shell React com HTTP 200.
- Adicionados testes HTTP reais para headers de segurança, CORS, preflight, limites, erros operacionais e contrato 404.
- Mantida intacta a folha global `src/index.css` e preservada a identidade visual da loja.

## 2026-09-02 — Painel administrativo e testes de navegador

- Adicionadas validações centralizadas para categorias, produtos, atributos, combinações, promoções e configurações antes de qualquer gravação.
- Bloqueados nomes duplicados, URLs inseguras, limites excessivos de galeria e variações e produtos vinculados a categoria inexistente.
- Substituídas confirmações nativas por diálogos acessíveis para exclusões e descarte de alterações não salvas.
- Protegidas troca de seção, retorno à loja, logout e fechamento da aba quando houver edição pendente.
- Impedidas operações simultâneas no painel e melhoradas as mensagens de falha e os alvos de toque no mobile.
- Criado ambiente E2E isolado, com catálogo, usuário, persistência administrativa, cálculo de frete e checkout simulados.
- Adicionados oito fluxos Playwright cobrindo busca, carrinho, frete, checkout, validação administrativa, persistência, exclusão, alterações pendentes e responsividade.
- Integrados os testes de navegador ao CI, com artefatos de diagnóstico preservados quando ocorrer falha.
- Mantida intacta a folha global `src/index.css` e preservada a composição visual existente.

## 2026-09-02 — SEO, acessibilidade, resiliência e testes de fluxo

- Adicionados canonical, robots, Open Graph, Twitter Cards e dados estruturados para a loja e documentos públicos.
- Publicados `robots.txt` e `sitemap.xml` com as oito rotas públicas atuais; painel administrativo e página não encontrada ficam fora da indexação.
- Criada página 404 interna com identidade da loja e barreira global para recuperar falhas inesperadas do React.
- Adicionados atalho para conteúdo, nomes acessíveis, rótulos de formulário e contenção de foco nos diálogos administrativos.
- Incluído controle de pausa no carrossel e respeito à preferência de redução de movimento do sistema.
- Ajustados painel administrativo, barra superior e modais para telas menores sem alterar a composição de desktop.
- Ativado carregamento tardio e decodificação assíncrona nas imagens fora da primeira dobra e cache longo nos assets versionados do build.
- Removida a dependência em execução do `public/logo.png` corrompido; o fallback passa a usar a cópia pública íntegra já adotada pela loja.
- Separadas validação do formulário e chamada ao checkout para testes com dependências simuladas.
- Bloqueado no navegador qualquer redirecionamento de checkout que não seja HTTPS em domínio oficial do PagBank.
- Criado smoke test do servidor de produção para saúde, loja, documentos comerciais, robots e sitemap, integrado ao CI.
- Mantida intacta a folha global `src/index.css`.

## 2026-09-02 — Documentos comerciais e aceite no checkout

- Criadas páginas públicas para identificação da loja, privacidade, termos de uso, trocas e reembolsos, prazos de produção, artes personalizadas e direitos LGPD.
- Transformados os itens institucionais do rodapé em links funcionais.
- Adicionados ao painel os campos de razão social, CNPJ/CPF, endereço, e-mails de atendimento e privacidade e prazo padrão de produção.
- Adicionado aviso visível de documento em preparação enquanto os dados obrigatórios do fornecedor estiverem incompletos.
- Incluídos resumo do prazo e aceite explícito, não pré-selecionado, antes do Checkout PagBank.
- Registradas no servidor a data e as versões dos documentos aceitos em cada pedido e em cada tentativa idempotente de checkout.
- Rejeitados pelo servidor checkouts sem aceite da versão jurídica atual.
- Preservados o direito de arrependimento e a garantia legal, sem criar exclusão automática para produtos personalizados.
- Mantida intacta a folha de estilos global e a identidade visual existente.

## 2026-09-02 — Correção da função serverless na Vercel

- Fixada a versão do Node.js em `22.x` para evitar atualizações automáticas de major no runtime.
- Aplicado `jose@4.15.9` somente à dependência transitiva `jwks-rsa`, corrigindo a incompatibilidade CommonJS/ESM que derrubava a função antes de atender `/api/health`.
- Mantidas intactas a interface e a folha de estilos restaurada.

## 2026-09-02 — Correção do login Google

- Liberado `https://apis.google.com` no `script-src` da Content Security Policy do Express e do Vercel.
- Corrigido o bloqueio do carregador GAPI usado por `signInWithPopup`, que aparecia para o usuário como `Firebase: Error (auth/internal-error)`.
- Adicionadas mensagens claras para domínio não autorizado, falha de rede e falha interna no login.
- Mantidas as demais restrições da política de segurança.

## 2026-09-01 — Restauração visual e entrega do CSS

- Restaurada integralmente a folha global `src/index.css` da versão anterior.
- Corrigido o caso em que o React carregava, mas o navegador recebia a página sem nenhuma regra Tailwind aplicada.
- O CSS compilado passou a viajar dentro do bundle principal do React, eliminando a requisição separada para `/assets/index-*.css`.
- O build agora só conclui com as regras Tailwind incorporadas ao arquivo JavaScript principal.
- Removidas as alterações globais de fonte, foco, rolagem e redução de movimento que mudavam a aparência original.
- Restaurados os breakpoints, espaçamentos e dimensões originais do topo, cabeçalho, hero, catálogo e painel administrativo.
- Restaurados os tamanhos originais dos ícones, título principal, botão do banner e cartões de produto.
- Restaurados o selo "Novo", a composição visual do preço, os logotipos de pagamento e o rodapé da versão anterior.
- Mantidas as correções funcionais e de segurança das baterias 1 e 2, incluindo PagBank, webhook, pedidos, upload privado e autenticação administrativa.

## 2026-09-01 — Bateria 2: pedidos e produção

### PagBank

- Adicionada chave idempotente persistente por tentativa de checkout.
- Envio de `x-idempotency-key` ao criar o Checkout PagBank.
- Deduplicação de webhooks pelo hash do corpo original.
- Processamento do webhook dentro de transação Firestore.
- Validação de referência, valor, moeda, checkout, pedido e cobrança.
- Proteção contra regressão de um pagamento já confirmado.
- Registro técnico dos eventos PagBank na subcoleção `pagbankEvents`.
- Link hospedado salvo para permitir continuar um pagamento pendente.

### Pedidos

- Separação entre `paymentStatus` e `fulfillmentStatus`.
- Fluxo operacional restrito à sequência pagamento, produção e entrega/retirada.
- Alteração operacional movida do Firestore do navegador para API administrativa autenticada.
- Histórico das mudanças operacionais na subcoleção `events`.
- Exclusão e alteração direta de pedidos bloqueadas nas regras do Firestore.
- Endereço completo, telefone, subtotal, frete e total em centavos armazenados no pedido.

### Artes

- Substituição de links externos por upload privado no Cloud Storage.
- Formatos permitidos: PDF, PNG, JPG e WebP, com limite de 15 MB.
- Verificação de MIME, tamanho, proprietário e assinatura binária do arquivo.
- Arquivo movido para um caminho vinculado ao usuário, pedido e item.
- Download por URL assinada de cinco minutos, forçado como anexo.
- Opção explícita para enviar a arte posteriormente pelo WhatsApp.
- Adicionadas `storage.rules`.

### Segurança e operação

- Rate limit persistente no Firestore para rotas críticas.
- Content Security Policy em produção.
- Endpoint de saúde reduzido em produção.
- Remoção do e-mail administrativo fixo.
- Suporte a custom claim Firebase `admin: true`.
- Script controlado para conceder a claim administrativa.
- CI no GitHub com testes, TypeScript e build de produção.
- Suíte ampliada para checkout, webhook, status e arquivos.

## 2026-08-31 — Bateria 1: estabilidade e interface

- Corrigidas busca, categorias, banners e ações sem comportamento.
- Carrinho protegido contra dados locais inválidos e colisões entre personalizações.
- Validação de CPF, preços e combinações no navegador e servidor.
- Regras do Firestore reforçadas para usuários, promoções e pedidos.
- Gemini movido do navegador para uma rota administrativa autenticada.
- CORS, headers HTTP, mensagens de erro e logs revisados.
- Painel administrativo e diálogos adaptados para telas menores e teclado.
- Admin carregado sob demanda e dependências divididas em chunks.
- `.env.example` sanitizado e documentação de ambiente reescrita.
