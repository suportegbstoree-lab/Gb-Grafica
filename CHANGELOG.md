# Changelog

## 2026-09-17 — Personalização visual de texto e arte obrigatória

- Removida da loja a opção de enviar a arte posteriormente pelo WhatsApp.
- Produtos configurados para receber arte agora só podem entrar no carrinho depois do upload privado do arquivo.
- Adicionado ao painel administrativo o tipo de personalização `Texto + Imagem`, combinando arquivo obrigatório e texto configurável.
- Criado drawer acessível para o cliente informar o texto, escolher entre fontes permitidas e posicioná-lo por clique, arraste ou teclado em uma prévia do produto ou da arte enviada.
- Texto, identificador da fonte e coordenadas proporcionais X/Y passam a compor a identidade do item no carrinho e são enviados ao servidor como dados estruturados.
- O servidor normaliza e valida o tipo de personalização, a fonte, o limite do texto, as coordenadas e a presença da arte antes de criar o pedido.
- O carrinho e a área de pedidos do cliente exibem um resumo da personalização escolhida.
- O painel administrativo exibe para produção o texto, a fonte, as coordenadas e um mapa proporcional da posição, mantendo o download privado da arte separado.
- Pedidos antigos com texto simples ou arte pendente continuam legíveis, sem reabrir a opção removida para novas compras.
- Adicionados testes unitários, de regras e de navegador para o novo tipo combinado e para o fluxo de texto até o payload do checkout.
- Mantida intacta a folha global `src/index.css` e preservada a identidade visual da loja.

## 2026-09-17 — Correção do cadastro e upload de imagens do catálogo

- Corrigida a perda de foco que enviava o cursor de volta ao botão de fechar após cada caractere digitado no editor de produtos.
- O gerenciamento de foco agora reage somente à abertura e ao fechamento dos diálogos, sem remontar a interação a cada alteração do rascunho.
- Adicionado upload pelo computador para a imagem principal e para múltiplas imagens da galeria de produtos.
- Mantida a entrada por URL como alternativa compatível com os produtos já cadastrados.
- Permitidos somente JPG, PNG e WebP de até 8 MB, com nome aleatório, MIME coerente, metadado do administrador e bloqueio de sobrescrita.
- Imagens do catálogo passaram a ter leitura pública individual, enquanto criação, listagem e exclusão exigem custom claim `admin: true`.
- Uploads descartados, substituídos e pertencentes a produtos excluídos recebem limpeza automática no Cloud Storage.
- Adicionados testes unitários, de regras Firebase e de navegador para formatos, caminhos, permissões, upload e digitação contínua.
- Mantida intacta a folha global `src/index.css` e preservada a identidade visual da loja.

## 2026-09-17 — Testes automatizados das regras Firebase

- Criada suíte isolada nos emuladores do Firestore e do Cloud Storage usando exclusivamente um projeto fictício `demo-*`.
- Adicionados 25 cenários para acesso público, autenticação, propriedade, consultas de pedidos, custom claim administrativa, função administrativa legada e bloqueio das coleções técnicas.
- Confirmado que pedidos e subcoleções financeiras não podem ser criados, alterados ou excluídos diretamente por clientes, inclusive por uma sessão administrativa.
- Cobertos uploads privados por proprietário, anonimato, isolamento entre usuários, metadado `ownerId`, MIME, limite de 15 MB, caminhos de pedidos e formatos PDF, JPG, PNG e WebP.
- Exigido nome aleatório de 32 caracteres hexadecimais e correspondência entre extensão e MIME para novas artes pendentes.
- Corrigida uma brecha identificada pela suíte em que uma segunda gravação poderia sobrescrever uma arte pendente; a criação agora exige explicitamente que o objeto ainda não exista.
- Integrados os testes de regras ao CI com Node.js 22 e Java 21.
- Mantida intacta a folha global `src/index.css` e preservada a identidade visual da loja.

## 2026-09-12 — Reconciliação segura de pagamentos PagBank

- Mantida a validação oficial `SHA-256(token-payload)` para notificações que chegam com `x-authenticity-token` válido.
- Notificações cuja assinatura esteja ausente ou divergente passam a funcionar somente como gatilho para uma consulta autenticada ao Checkout PagBank; nenhum estado recebido no corpo não autenticado é aplicado diretamente.
- A confirmação alternativa exige que referência, pedido, cobrança, estado, valor, moeda e método coincidam com o evento obtido diretamente da API PagBank.
- Adicionados limites locais e persistentes específicos para impedir abuso das consultas alternativas.
- Evidências de homologação agora distinguem assinatura SHA-256 válida de confirmação independente pela API PagBank e não inventam um header que não tenha sido recebido.
- Corrigida a reconciliação de boletos do Checkout Hospedado que retornam cobrança exatamente R$ 1,00 acima do valor dos itens.
- O acréscimo é aceito somente quando o método confirmado pelo PagBank é `BOLETO`; cartão e Pix continuam exigindo igualdade exata e qualquer subpagamento permanece bloqueado.
- Registrados método, total efetivamente cobrado e acréscimo do comprador no pedido e no evento financeiro para auditoria.
- Confirmado em teste real que o Sandbox pode entregar o webhook com assinatura ausente ou incompatível, apesar de registrar a cobrança como `PAID`.
- Notificações não autenticadas continuam sem permissão para alterar pedidos com os dados recebidos; apenas a resposta consultada com o token secreto do servidor pode ser aplicada.
- Adicionada reconciliação autenticada consultando o Checkout e o Pedido diretamente na API PagBank.
- Validados checkout, referência interna, identificadores do provedor, valor e moeda antes de confirmar qualquer pagamento no Firebase.
- Adicionada deduplicação dos eventos obtidos por reconciliação e preservada a proteção contra regressão de status.
- O retorno do Checkout passa a consultar o status automaticamente e repetir a verificação durante alguns segundos quando o pagamento ainda estiver em processamento.
- Adicionado diagnóstico seguro que distingue header ausente, formato inválido e assinatura divergente sem registrar token ou corpo do webhook.
- Substituído o cliente HTTP da reconciliação por uma implementação cujas exceções não carregam headers de autorização.
- Mantida intacta a folha global `src/index.css` e preservada a identidade visual da loja.

## 2026-09-09 — Evidências reais para homologação PagBank

- Criado modo de captura disponível somente quando o PagBank está em Sandbox e a ativação é explícita.
- Registrados o request efetivamente enviado a `/checkouts` e o response efetivamente devolvido pelo PagBank.
- Registrados webhooks autenticados e a resposta HTTP real fornecida pela aplicação.
- Removidos automaticamente o token `Authorization`, a assinatura de autenticidade e eventuais segredos aninhados.
- Armazenadas as evidências em coleção técnica bloqueada pelas regras do Firestore e preparada para TTL de 14 dias.
- Adicionado exportador que combina vários pedidos em um único `.txt` pronto para anexar à homologação.
- Mantida intacta a folha global `src/index.css` e preservada a identidade visual da loja.

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
