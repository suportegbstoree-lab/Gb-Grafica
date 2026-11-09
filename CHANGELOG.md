# Changelog

## Última atualização: 2026-11-09

**Nota**: Este arquivo registra todas as alterações significativas do projeto. As versões são listadas em ordem cronológica inversa, com a data de implementação e um resumo das mudanças. Para detalhes completos, consulte os commits correspondentes no repositório. \
**Algumas das melhorias já foram pagas. Deixarei uma tabela com as datas - Mas de antemão, Tudo antes de 2026-09-27 já foi combinado e/ou pago.**

As integrações com PagBank, Correios e Firebase App Check, já previstas e pagas, possuem implementação no projeto. A homologação do PagBank, a liberação do contrato e dos serviços dos Correios e a ativação das proteções em produção dependem das credenciais, permissões e configurações dos respectivos ambientes. Essas etapas externas não devem ser confundidas com código ainda não implementado. Grande parte do histórico de segurança está em [CHANGELOG-SEGURANCA-E-FUNCIONALIDADES.md](CHANGELOG-SEGURANCA-E-FUNCIONALIDADES.md).

## TABELA DE IMPLEMENTAÇÕES AINDA NÃO COBRADAS

| Data da implementação | Funcionalidade                                                         | Status                               |
| --------------------- | ---------------------------------------------------------------------- | ------------------------------------ |
| 2026-11-01            | Gerador interno de PDF, retenção e compartilhamento para funcionários  | COMPLETO                             |
| 2026-11-01            | Produção automática, expediente e relatórios de produtividade privados | COMPLETO                             |
| 2026-11-01            | Filtros de produtos no Admin e upload paralelo do alfabeto             | COMPLETO                             |
| 2026-11-01            | Páginas do catálogo, vitrine padronizada e compartilhamento            | COMPLETO                             |
| 2026-11-01            | Pacotes de produtos com composição e desconto próprios                 | COMPLETO                             |
| 2026-11-01            | Perfil do cliente, histórico e preenchimento do checkout               | COMPLETO                             |
| 2026-11-01            | Busca por tags, filtros e avaliações de compras verificadas            | COMPLETO                             |
| 2026-10-31            | Integração de e-mails, preferências e campanhas                        | COMPLETP                             |
| 2026-10-31            | Cargos personalizados, exclusão segura e revogação de acessos          | COMPLETO                             |
| 2026-10-31            | Atividades da equipe e simplificação da aparência                      | COMPLETO                             |
| 2026-10-31            | Inicial decorativa de cadernetas e correções de PDF/API                | COMPLETO                             |
| 2026-10-31            | Ajustes de QoL e melhorias pontuais                                    | COMPLETO                             |
| 2026-10-31            | Ajustes em equipe e isolamento das seções                              | COMPLETO                             |
| 2026-10-30            | Funcionários, pedidos e promoções relâmpago                            | COMPLETO                             |
| 2026-10-30            | Impressão e produção de pedidos                                        | COMPLETO                             |
| 2026-10-30            | Ajustes na personalização de texto e arte obrigatória                  | COMPLETO                             |
| 2026-10-30            | Cards, contracapa e carrinho                                           | COMPLETO                             |
| 2026-10-30            | Melhorias de personalização                                            | COMPLETO                             |
| 2026-10-30            | Destaques, contatos e acesso temporário                                | COMPLETO                             |
| 2026-10-29            | Capa, contracapa e exportação dos modelos                              | COMPLETO                             |

Os status descrevem a implementação do código. Publicação, configuração externa e homologação permanecem pendentes quando indicadas; o histórico não confirma uma nova ativação em produção.

**Valor Estimado: R$ 1.300,00 (Mil e Trezentos Reais)** - Valor referente a implementação das funcionalidades acima descritas, que ainda não foram cobradas. Incluindo as que foram iniciadas, mas ainda não finalizadas.

### **Valor Restante:**

R$ **460,00 (Quatrocentos e Sessenta Reais)** Das funcionalidades referentes a Segurança que ainda não fora quitado.

R$ **1.300,00 (Mil e Trezentos Reais)** Dessa ultima bateria de funcionalidades.

Totalizando R$ **1.760,00 (Mil Setecentos e Sessenta Reais)** ao todo.

## 2026-11-09 — Prévia de PDF, cadastro de produtos, banner e cupons

- A personalização do cliente atualiza a prévia enquanto ele digita, usando o mesmo desenho da oficina. As páginas em resolução integral são geradas na confirmação.
- O cadastro de produtos permite escolher um tipo de variação existente ou cadastrar e adicionar um novo na mesma tela.
- Bases e moldes aparecem em ordem alfabética e podem ser filtrados pela lupa. Ao escolher a base, o painel sugere o molde correspondente e permite trocar o molde separadamente.
- O vínculo copia o PDF e as letras no Storage em uma única chamada do editor. As prévias já cadastradas são reaproveitadas. Bases sem prévias precisam de uma leitura do PDF para gerá-las. Ao trocar apenas o molde, o editor reutiliza os arquivos da base vinculada.
- O banner da identidade visual alterna no mesmo carrossel que os produtos em destaque e as promoções.
- O administrador pode escolher o código do cupom ou deixar o sistema gerar um. A conferência ignora maiúsculas e minúsculas e recusa códigos cadastrados, inclusive de cupons inativos.

## 2026-11-08 — Cadastro de vendas, variações com SKU e cupons

- O cadastro de produtos reúne informações básicas, descrição, variações, arte e moldes PDF e embalagem na mesma tela, com menu para ir a cada seção.
- O painel permite cadastrar, editar e excluir tipos de variação. Cada produto combina até dois tipos para gerar a tabela de preços e SKUs. As opções aceitam referências próprias, SKU e controles de personalização. A tabela permite preencher todos os preços de uma vez ou editar cada combinação.
- O SKU combina o nome ou SKU principal do produto com os nomes ou SKUs das opções. Cada combinação aceita um código próprio. O pedido guarda o SKU conferido pelo servidor e o exibe no painel e na etiqueta interna de produção. As referências das variações ficam separadas da galeria e da arte usada para imprimir.
- O painel de cupons gera códigos e permite listar, editar, ativar e excluir descontos fixos ou percentuais. Cada cupom tem validade até o fim da data em horário de Brasília, limite de usos e alcance por produto, categoria ou carrinho.
- O carrinho consulta o desconto antes de pagar. Cupons de primeira compra são aplicados automaticamente pelo e-mail verificado da conta. O sistema consulta pedidos anteriores e reserva a primeira compra para evitar usos simultâneos.
- Aplica-se um cupom por pedido, depois das promoções, sobre os produtos elegíveis. O valor do frete permanece separado. O servidor recalcula os valores em centavos, guarda o desconto no pedido e reserva o uso na mesma transação que cria o pedido. Falhas definitivas ou expiração confirmada sem cobrança liberam a reserva. Respostas ambíguas do PagBank mantêm a reserva enquanto a cobrança pode existir.

## 2026-11-08 — Arte de produção, vínculo com a oficina e variações de personalização

- O cadastro separa a imagem-base de impressão das imagens de divulgação. Produtos com uma base podem usar a arte padrão sem exigir envio do cliente; trocar fotos da galeria não altera a produção configurada.
- Produtos podem publicar um vínculo com a base PDF e o molde existentes na oficina. O editor simplificado do cliente reutiliza sua geometria, fonte, tamanho, cor, alinhamento e rotação, com texto e imagem opcional. Prévias, produção e exportação usam o renderizador da oficina; preservam as 1 a 16 páginas, as medidas originais e a regra de texto nas páginas 1 e 3 dos PDFs de quatro páginas. Iniciais cadastradas permanecem somente na primeira página.
- A imagem adicional do cliente é centralizada proporcionalmente na primeira página; o modo de página inteira do molde preenche a página com corte nas bordas. A base original permanece como fundo. O cliente confere todas as páginas no site e não recebe controles de download. JPG e PDF continuam no painel de pedidos, gerados a partir das fontes e da receita validadas.
- Atributos recebem controles independentes para habilitar ou desabilitar nome e imagem. O modo por adicionais soma preço base e valor de cada escolha, incluindo zero, sem exigir um preço para cada combinação. O modo anterior por combinação permanece disponível. Carrinho, pacotes, promoções e checkout usam o mesmo cálculo em centavos no servidor.
- Alterações de opções invalidam a prévia anterior. O checkout recusa preços adulterados, vínculos antigos e arquivos de outra conta; remove campos desativados da receita e valida todas as prévias. A base, a imagem adicional, as iniciais e as páginas são copiadas separadamente para o pedido com suas versões de Storage.
- O vínculo guarda a versão publicada da base, do molde e da fonte. Mudanças na oficina são publicadas pelo botão Vincular / atualizar molde, sem modificar pedidos anteriores. A API confere revisões, conteúdo dos arquivos e permissões; imagens-base, fontes e cópias publicadas participam da retenção existente de 7 dias.
- Produtos antigos preservam seu fluxo até receberem uma base separada. Não há novas dependências, variáveis, regras, índices ou cron. Configuração e publicação permanecem no fluxo habitual; detalhes em [docs/product-production.md](docs/product-production.md).

## 2026-11-08 — Editor de campanhas e gestão de rascunhos

- A seção E-mails oferece Nova campanha e os botões Editar e Excluir para rascunhos. A edição reabre assunto, tipo e mensagem salvos e atualiza o mesmo cadastro, sem criar outro rascunho ou iniciar envios. O botão de salvar permanece no rodapé do modal.
- O editor mostra o HTML real gerado pelo servidor, com banner, conteúdo, botão e rodapé, além de assunto, remetente e endereço de resposta. A prévia acompanha a digitação, permite conferir larguras de desktop e celular e descarta respostas antigas. O link de descadastro é individual e usa um marcador na prévia.
- A prévia fica isolada do painel, sem scripts, formulários ou navegação, mantendo a política de segurança existente. Visualizar ou salvar não chama o Resend nem altera preferências. Diferenças de renderização entre clientes de e-mail continuam possíveis.
- Alterações não salvas exigem confirmação antes do descarte. A API confere a revisão para editar ou excluir; a nova interface também confere a revisão ao confirmar o envio. Conflitos entre sessões preservam o texto digitado e recusam a versão antiga. Rascunhos legados recebem uma revisão na primeira edição.
- A exclusão exige confirmação, remove o rascunho da lista e guarda sua cópia privada por 7 dias completos, reutilizando a manutenção existente. Campanhas na fila, concluídas ou canceladas não podem ser editadas ou excluídas. O cancelamento dos próximos envios de uma campanha na fila permanece disponível.
- As rotas de prévia, edição e exclusão exigem a permissão de gerenciar e-mails e as verificações existentes de App Check, com respostas sem cache. A publicação usa o fluxo habitual de commit e deploy; não há novas dependências, variáveis, regras ou aliases de modelos para publicar.

## 2026-11-08 — Templates de e-mail com banner e envio de teste

- Os sete modelos de e-mail receberam o banner da GB Gráfica, títulos, botões, rodapé de suporte e layout em tabelas com adaptação para celular. O mesmo visual atende ao HTML gerado pelo site e aos modelos publicados pela API do Resend.
- As fichas do cliente e da loja exibem número, data, pagamento, contato, entrega ou retirada, produtos, quantidades, valores e observações, preservando o PDF anexo. As mensagens distinguem pedido recebido de pagamento confirmado e não inventam dados de cobrança que o sistema não coleta.
- Atualizadas as instruções e a configuração sugerida para `no-reply@gblgrafica.com.br`, `promo@gblgrafica.com.br` e `suporte@gblgrafica.com.br`. O banner está versionado em `public/email/gb-grafica-banner.png`; opcionalmente, `EMAIL_BANNER_URL` permite outra imagem pública HTTPS. As variáveis da Vercel continuam dependendo de configuração no ambiente.
- Adicionado `npm run email:test:send -- --email "destinatario@dominio.com.br"`: envia uma amostra de cada modelo somente ao endereço informado, com assunto identificado como teste, dados fictícios e anexos PDF de demonstração. Não lê nem altera Firebase, pedidos, cargos, campanhas ou preferências. O modo `--dry-run` mostra o plano sem envio, e `--preview-dir` salva os HTMLs e o banner para conferência local, também sem envio.
- O teste valida os remetentes, exige a URL pública HTTPS para envio real, espaça as chamadas e distingue aceite, recusa e ausência de confirmação. Recusas de autenticação ou cota interrompem o lote; somente uma limitação curta e explícita de frequência permite retentativa com o mesmo corpo e chave de idempotência.
- As variáveis dos modelos respeitam os limites de tamanho do Resend. Conteúdos maiores usam o mesmo layout em HTML direto, preservando todos os dados. Tentativas já iniciadas conservam remetente, conteúdo, alias e anexos para manter a idempotência. Novos aliases precisam ser publicados antes da aplicação quando o uso de modelos hospedados estiver ativo.

## 2026-11-08 — Limpeza após exclusão, fontes e biblioteca PDF

- Exclusões do catálogo e da biblioteca da equipe retiram o cadastro da interface imediatamente e guardam uma cópia privada por 7 dias completos. Arquivos removidos ou substituídos entram na fila de limpeza na mesma transação do cadastro.
- A manutenção diária apaga cópias vencidas, subcoleções e arquivos sem uso após esse prazo, com limites por execução e retentativas. Produtos excluídos também têm suas avaliações, agregados e registros auxiliares de autoria removidos. Arquivos ainda usados por outros cadastros ou pedidos são preservados; a retirada do último vínculo inicia um novo prazo de 7 dias.
- Arquivos órfãos antigos são identificados gradualmente. Sem uma data de remoção conhecida, recebem 7 dias a partir da primeira detecção. A limpeza restringe os caminhos ao bucket da aplicação, verifica referências e a geração do objeto e impede reutilizações concorrentes durante a exclusão.
- Alterações do catálogo e solicitações de limpeza passam pela API autenticada. As regras impedem gravações diretas nos cadastros e exclusões diretas dos arquivos pelo SDK, preservando uploads autorizados. A configuração inicial do site também passa pela API. As coleções de retenção são privadas e o conteúdo das cópias não é indexado.
- O gerenciador de fontes inclui Marcar todas e Desmarcar todas, aplicados ao cadastro completo, inclusive outras páginas e filtros. Fontes novas, tanto de arquivo quanto de sistema, entram inativas; fontes existentes preservam sua seleção. A publicação continua dependendo de salvar as configurações.
- Os grupos de bases PDF exclusivas da equipe começam recolhidos e podem ser abertos individualmente.
- A publicação exige a nova aplicação antes das regras e dos índices. O cron e o `CRON_SECRET` existentes são reutilizados. Backups, PITR, versionamento e Soft Delete geridos pelo Google mantêm suas políticas próprias. Detalhes em [docs/catalog-retention.md](docs/catalog-retention.md).

## 2026-11-08 — Progresso de fontes em overlay compacto

- Durante o envio em lote, o editor de fontes mostra somente um overlay compacto com uma barra de progresso geral, percentual, contagem e pausa após os arquivos atuais. A lista completa de arquivos deixa de ser renderizada durante o envio.
- As atualizações visuais de progresso são agrupadas, e o painel recebe o cadastro acumulado ao concluir ou pausar. Isso evita redesenhar o editor inteiro a cada arquivo e preserva os sucessos e a retomada da fila.
- Ao concluir ou pausar, o editor volta ao formato normal. Falhas ficam em detalhes recolhíveis e continuam disponíveis para retentativa. O foco do teclado acompanha a troca entre editor e progresso.

## 2026-11-08 — Importação de até 500 fontes e carregamento sob demanda

- O envio de fontes aceita até 500 arquivos por seleção, respeitando o total de 500 fontes cadastradas. O normalizador e a validação de gravação acompanham o novo limite, sem cortar o cadastro no limite antigo. Os demais campos de upload mantêm o padrão de 50 arquivos por seleção.
- A fila envia no máximo três arquivos simultaneamente, mostra progresso e resultado por arquivo, permite pausar após os envios atuais e retomar os pendentes. A retentativa processa somente as falhas, preservando as fontes já enviadas. As fontes válidas entram no rascunho e são publicadas ao salvar.
- Nomes de arquivo repetidos recebem nomes de exibição e identificadores próprios. Formatos WOFF2, TTF e OTF, validação real do arquivo, limite de 16 MB e verificações de permissão existentes permanecem no fluxo de upload.
- O cadastro limita os metadados das fontes a 512 KB e a configuração completa a 768 KB. Somente a rota de gravação de configurações aceita JSON de até 800 KB, preservando autenticação e validação no servidor.
- As fontes são registradas sem download antecipado. A loja e o administrador carregam arquivos ao usar a fonte ou exibir sua amostra. O gerenciador inclui filtro e páginas de 25 fontes, preservando o cadastro completo.

## 2026-11-08 — Categorias de bases, importação e códigos de barras

- O Code128 aceita códigos de 1 a 80 caracteres ASCII imprimíveis, preservando o conteúdo completo e a diferença entre maiúsculas e minúsculas. Rastreios fora do formato BR também são aceitos, sem cortes automáticos.
- O PNG parte de 650 px para até 15 caracteres e cresce proporcionalmente nos maiores. A aplicação ao PDF usa escala horizontal de 1,8 com teto de 1170 px e ajuste à largura da página. A altura permanece em 222 px, com margens transparentes e sem o texto abaixo das barras. Receitas de lotes já salvos preservam a versão anterior.
- Bases PDF podem ser importadas por pasta, usando seu nome como categoria, ou individualmente, escolhendo uma categoria existente ou nova. O envio permite acompanhar resultados, interromper após o arquivo atual e confirmar substituições dentro da mesma categoria.
- A biblioteca agrupa as bases por categoria e oferece Editar diretamente em cada base. Abre o molde associado, permite escolhê-lo quando há vários ou inicia um novo molde vinculado. Bases homônimas em categorias diferentes mantêm associações próprias por identificador.
- Códigos de rastreio repetidos continuam gerando itens independentes na fila. A importação CSV/XLSX oferece uma planilha somente para visualização, com os valores importados e destaque dos códigos repetidos, sem exigir exportação ou salvamento.

## 2026-11-07 — Códigos de barras e reconstrução de lotes internos

- PDFs da oficina recebem Code128 transparente no topo e no rodapé das frentes, seguindo as medidas do programa. O CSV fornece o rastreio, e o pedido manual recebe um identificador interno que pode ser editado.
- O nome padrão combina variação, texto e código de barras. Os arquivos dos lotes podem ser baixados individualmente ou em ZIP e reabertos para impressão.
- Lotes anteriores mantêm a receita por três dias, com cópias privadas das versões das bases, fontes e iniciais utilizadas. A reconstrução funciona mesmo após alterações no cadastro. O PDF final e a imagem do código de barras são compostos no navegador.
- A expiração é verificada pela API, e a manutenção existente remove os registros e os arquivos auxiliares expirados. Adicionado índice de consulta por funcionário e vencimento.
- A retenção por receita também atende à edição simples de modelos internos. O histórico anterior de documentos salvos continua acessível até sua expiração.

## 2026-11-06 — Ajustes da oficina de PDFs após revisão do cliente

- Lupas junto aos seletores abrem a busca por base e molde. A barra de formatação acima da prévia aparece ao adicionar texto extra. O bloco principal segue a geometria e o estilo do molde, com ajustes de fonte e tamanho.
- Linhas extras têm caixa ajustada ao texto, quebra automática e arraste limitado à página. A prévia e a exportação usam os mesmos controles de sombra, contorno, brilho, curvatura, espaçamento e transparência.
- A oficina consulta fontes cadastradas mesmo quando estão inativas para a loja. Fontes ausentes geram aviso e usam o padrão do sistema.
- Bases PDF e moldes JSON aceitam arrastar e soltar. Uma base interna com o mesmo nome só é substituída após confirmação e validação do novo PDF. Vários moldes podem ser associados à mesma base.
- A planilha mapeia SKU, notas do comprador, rastreio, prazo de envio e quantidade por letra ou cabeçalho. A conversão normaliza os nomes de molde no SKU e envia o CSV para revisão na fila.

## 2026-11-06 — Fluxo de pedidos na oficina de PDFs

- A oficina da equipe reúne configuração do pedido, edição direta sobre a prévia, navegação por página, zoom e fila principal. O editor de texto aplica negrito, opacidade, contorno, curvatura e espaçamentos na prévia e no PDF gerado. O editor de moldes permite arrastar e redimensionar a caixa de texto.
- A conversão XLSX usa as colunas escolhidas para produzir o CSV que alimenta os pedidos. A oficina também importa CSV pronto, associa bases e moldes pelo modelo informado e permite corrigir as associações antes de adicionar à fila.
- Pedidos manuais e importados passam pela mesma fila para revisão, edição e geração. A fila pode ser salva e recuperada em JSON, pausada após o pedido atual e limpa dos itens já concluídos. Os arquivos internos podem receber nome próprio.
- PDFs de quatro páginas preservam a arte original e os versos. A edição de texto acontece nas páginas 1 e 3, com as coordenadas do molde de retrato e paisagem.

## 2026-11-05 — Modelos de e-mail publicados pela API do Resend

- Adicionados sete modelos com a identidade da GB Gráfica e o comando `email:templates`. A consulta mostra o plano. A opção `--apply` cria e publica os modelos ausentes e publica os rascunhos correspondentes.
- `RESEND_USE_HOSTED_TEMPLATES=true` habilita o uso de aliases por versão nos novos envios. A primeira tentativa guarda o modelo e o conteúdo para as retentativas. Anexos, remetentes e descadastro continuam no fluxo de envio do site.

## 2026-11-04 — Ativação do Resend por API e remetentes separados

- Adicionado `email:setup`: plano de leitura, cadastro de domínio ausente e solicitação de verificação com `--apply`, exibindo os registros DNS reais do Resend. Reutiliza domínios existentes e não altera DNS, recebimento, caixas, chaves ou campanhas.
- `email:check -- --remote` consulta os domínios dos remetentes sem enviar mensagens; ferramentas locais respeitam `.env.local`, `.env` e variáveis já exportadas. Chave administrativa separada da chave de envio do servidor.
- `EMAIL_MARKETING_FROM` permite usar `promo@` nas campanhas, preservando o remetente dos avisos transacionais e o consentimento/descadastro existentes.
- `EMAIL_REPLY_TO` passa a alcançar também fichas de pedidos, avisos de cargos e PDFs internos. Novas tentativas preservam os dados da primeira tentativa.
- Documentados DNS, variáveis, caixa de suporte, redeploy e limites do cron atual. Ativação externa e testes de entrega real ainda dependem de credenciais e configuração; nenhum e-mail foi enviado nesta alteração.

## 2026-11-04 — Isolamento dos cenários de teste do painel

- Suíte Playwright configurada para executar com um worker também no ambiente local. O servidor E2E compartilha catálogo, documentos e atividades em memória; cenários simultâneos podiam substituir os modelos usados por outro teste e causar “Modelo não encontrado” na geração de PDF da equipe.
- Mantidas as verificações de geração, download, e-mail e compartilhamento. Nenhuma regra de acesso ou comportamento de produção foi alterado.

## 2026-11-04 — Oficina de PDFs da equipe e adaptação do programa Python

- Biblioteca de PDFs internos independente de produtos, com upload privado, validação estática no servidor e suporte de uma a 16 páginas.
- Moldes JSON compatíveis com as versões beta e reconstruída, importação/exportação, edição, exclusão e permissão independente `documents.templates.manage`.
- Editor de texto da equipe em modal, com linhas adicionadas por botão, fonte/tamanho/cor/alinhamento/rotação e geometria individual em retrato/paisagem.
- Fila principal com revisão, atualização, confirmação de remoção, processamento sequencial e retomada de itens com falha, reutilizando histórico, retenção e compartilhamento existentes.
- PDFs de quatro páginas editam a primeira e a terceira conforme o molde e preservam os versos reais; páginas permanecem na orientação original e a arte PDF continua vetorial. O fluxo simples anterior e o editor do cliente foram preservados.
- Inicial PNG associada por pasta com o nome do PDF, centralizada apenas na primeira página, com uploads privados para bases internas.
- Conversão XLSX para CSV no navegador, escolha de aba e colunas, separador e primeira linha, zeros à esquerda, datas comuns e proteção contra fórmulas exportadas.
- Validados os mapas JSON dos anexos (212 e 347 moldes) e a geração com os exemplos de duas/quatro páginas. Testes das novas regras incluídos; execução local pendente de Java 21.
- Ativação depende de publicação das regras do Storage e redeploy; nenhum arquivo foi importado automaticamente para produção. Valores financeiros anteriores foram preservados.

## 2026-11-04 — PagBank: endpoint, chaves e diagnóstico de produção

- Confirmado o endpoint próprio `POST /api/webhook/pagbank`, informado automaticamente nos dois campos de notificação do Checkout Hospedado. Adicionado GET público e mínimo para conferir a publicação da rota sem simular uma compra.
- Adicionado suporte a `x-payload-signature` com ECDSA/SHA-256 sobre o corpo original, consulta somente de leitura da chave pública de webhook, cache, rotação e isolamento por ambiente/token.
- Mantido o modo automático compatível com a integração anterior. Uma nova assinatura inválida não recorre ao método legado; o modo opcional `ecdsa` exige o novo header.
- Preservadas as validações financeiras e a idempotência. Evidências de homologação passaram a distinguir ECDSA do método anterior, sem registrar assinaturas ou inventar headers.
- Adicionado `pagbank:check`, com validação local e consultas GET opcionais, sem gerar chaves, checkouts, cobranças ou e-mails.
- Documentada a diferença entre a chave RSA de cartão do Checkout Transparente e a chave EC de webhook. O Checkout Hospedado atual não exige gerar a chave de cartão.
- Configuração de ambiente/URL passou a recusar valores inválidos, credenciais embutidas e URLs públicas inseguras. Ativação deste ajuste depende de redeploy; homologação e liberação do novo serviço de assinaturas continuam sujeitas à confirmação do PagBank.
- Configurações de e-mail e valores de cobrança foram preservados.


## 2026-11-01 — Gerador interno de PDFs para funcionários

- Adicionada a seção **Gerar PDF** ao painel, com permissão independente `documents.generate` e modelos PDF cadastrados no catálogo.
- Reutilizado o editor do cliente: texto em várias linhas, fontes, cores, tamanhos e posições individuais, além da inicial decorativa vinculada ao modelo.
- Fluxo interno sem checkout, pagamento, atributos comerciais ou upload de imagens avulsas.
- Contracapa obrigatória e automática, repetindo a primeira página do modelo sem texto personalizado nem inicial, mesmo quando o PDF original possui uma segunda página diferente. O gerador do cliente mantém seu funcionamento anterior.
- PDFs vinculados ao funcionário que iniciou a geração, com referência, horários, tamanho e SHA-256; retenção de sete dias após a conclusão. Envios interrompidos expiram em 24 horas.
- Adicionados histórico, visualização, download do PDF, abertura para impressão, envio manual por e-mail e link para compartilhar pelo WhatsApp.
- Links compartilhados podem ser revogados e expiram junto com o documento. O compartilhamento pelo WhatsApp depende da confirmação do funcionário no aplicativo.
- E-mails usam a integração Resend existente, com anexo ou link, tentativas idempotentes e distinção entre aceitação pelo provedor e entrega ao destinatário.
- API verifica permissão atual, propriedade e expiração; validação estática preserva os vetores e as dimensões do PDF sem importar scripts e ações ativas. Limpeza integrada à manutenção existente.
- Ativação depende da publicação das regras do Storage, construção dos índices e redeploy da aplicação; não foi realizado envio real de e-mail ou publicação em produção nesta entrega.

## 2026-11-01 — Produção automática, expediente e produtividade

- Produção passa a ser alimentada pelas ações confirmadas no servidor: alterações reais do catálogo e configurações, consultas e exportações de pedidos, etiquetas, etapas/rastreio e geração ou uso de PDFs internos.
- Cada conclusão registra funcionário, serviço, origem do pedido/lote ou documento, início, término e duração disponível. Gravações sem mudança e repetição da mesma geração não duplicam conclusões.
- Primeiro acesso ao painel inicia o expediente do dia. Adicionados controles explícitos de intervalo, retorno, encerramento e retomada; fechar a aba não encerra o expediente automaticamente.
- Tempos de edição descontam intervalos e períodos de expediente encerrado. Ações rápidas usam a duração da requisição e recebem essa identificação no relatório; dias anteriores não encerrados não recebem horas estimadas.
- Adicionados relatórios diários, dos últimos sete dias e dos últimos 30 dias, gráficos de barras, médias por funcionário, detalhes e exportação CSV, sem gráficos de pizza.
- Funcionários consultam somente os próprios dados, inclusive pela API. Apenas administradores completos podem consultar a equipe. A permissão `operations.self` libera a consulta própria; `operations.manage` também respeita esse isolamento para funcionários.
- Removido o formulário manual de unidades, retrabalho, perdas, motivos e notas. Dados antigos foram preservados para consulta administrativa, e a API legada passou a recusar novas escritas.
- O contador mede atividades concluídas no sistema, sem presumir quantidades físicas impressas. Permissões novas não são concedidas automaticamente aos cargos existentes.

## 2026-11-01 — Filtros administrativos e upload do alfabeto

- Adicionada busca por nome de produto combinada com filtro por categoria e opção de limpar filtros, sem distinguir acentos ou maiúsculas.
- Pasta do alfabeto validada integralmente antes de iniciar os uploads, com envio de até três PNGs simultaneamente e progresso visível.
- Em caso de falha, o lote aguarda os envios em andamento e tenta remover os arquivos já concluídos, sem publicar um alfabeto parcial.
- Preservados os bytes, a resolução e a transparência originais dos PNGs, sem redimensionamento, recompressão ou conversão para WebP.

## 2026-11-01 — Páginas do catálogo, vitrine e compartilhamento

- Adicionadas páginas de destaques, promoções, lançamentos e pacotes, além das páginas de categoria e produto, com filtros dentro de cada seção.
- Removida a lista lateral duplicada de categorias; mantida a navegação acima do banner.
- Vitrine com cards uniformes e grade responsiva. Atributos, imagens e personalização ficam concentrados na página do produto; itens simples continuam permitindo inclusão direta no carrinho.
- Centralizada a busca no cabeçalho de telas largas.
- Compartilhamento usa o link do produto ou da página atual, preserva filtros públicos e exclui parâmetros de sessão, prévia administrativa e pedido.
- Mantidos WhatsApp e copiar link, adicionada opção de copiar o link para compartilhar no Instagram e removidas as ações de Facebook e Twitter.

## 2026-11-01 — Pacotes de produtos

- Adicionada a seção **Pacotes** ao painel, com criação, edição, exclusão e permissão independente `bundles.manage`.
- Composição, quantidades e opções de cada componente podem ficar fixas ou disponíveis ao cliente, conforme autorização no cadastro.
- Preço calculado pelo catálogo atual com desconto percentual ou fixo próprio do pacote, sem acumular promoções dos componentes.
- Servidor revalida composição, variantes, quantidades, desconto e preço antes do pagamento; mudanças na definição exigem reconfiguração do carrinho.
- Frete considera os componentes físicos e suas quantidades; itens, personalizações e formatos são preservados no pedido e na produção.
- Texto, artes, modelos, capa e contracapa mantidos por componente, com conferência e aprovação individual no carrinho. Downloads de produção continuam restritos ao painel autorizado.

## 2026-11-01 — Perfil do cliente, busca e avaliações verificadas

- Adicionada a página **Minha conta**, com pedidos próprios, histórico, status e detalhes das compras.
- Cliente pode editar nome, telefone, CPF, CEP e endereço; os dados salvos preenchem o próximo checkout sem substituir a validação e a cotação do servidor.
- Perfil acessível somente pela API autenticada da própria conta, com controle de revisão; o formulário não altera UID, e-mail de login, cargos ou permissões.
- Busca ampliada para palavras independentes no nome, descrição, categoria e tags, com filtros de categoria, preço e avaliação preservados na URL.
- Produtos e pacotes podem receber tags e marcação explícita de lançamento.
- Avaliações de uma a cinco estrelas e comentário opcional exigem compra confirmada da própria conta, inclusive de componentes de pacotes. Pedidos pendentes, de terceiros ou com estorno registrado não autorizam nova avaliação.
- Cada conta mantém uma avaliação por produto; atualizações não duplicam a contagem, e os agregados são recalculados em transação.
- Comentários são exibidos como texto, sem publicar e-mail, UID ou número do pedido. Regras bloqueiam alterações diretas de avaliações, médias, perfis e comprovações de compra.

## 2026-10-31 — Integração de e-mails, preferências e campanhas

- Concluída no código a integração com Resend para boas-vindas, confirmação de criação de pedido e avisos após mudanças confirmadas de pagamento, estorno, produção, retirada, envio e entrega.
- Boas-vindas limitadas a contas novas com e-mail verificado, sem envio retroativo para contas antigas. Confirmação de pedido criado permanece separada de pagamento confirmado.
- Preferências de promoções e informativos separadas e desmarcadas por padrão; criar conta não inscreve automaticamente o cliente em marketing.
- Campanhas com rascunhos, confirmação explícita, cancelamento, processamento em lotes e permissão independente `emails.manage`.
- Preferências, endereço e situação da conta são novamente conferidos antes do envio. Adicionados descadastro por link e mecanismo de um clique dos clientes de e-mail.
- Filas persistidas, bloqueios de concorrência e idempotência protegem retentativas; tentativas ambíguas antigas exigem revisão no provedor.
- Atualizadas a política de privacidade, a versão de aceite e a documentação. Ativação depende de domínio/remetente validados, credenciais e agendamento; nenhum envio real foi realizado na implementação.

## 2026-10-31 — Cargos personalizados, exclusão e atividades da equipe

- Adicionadas criação e renomeação de cargos personalizados, permissões selecionadas pelo administrador e nome editável dos funcionários.
- Cada cargo libera apenas as seções e ações autorizadas; alterações do catálogo passam pela API com verificação da política atual.
- Exclusão de cargo exige confirmação, bloqueia os acessos administrativos vinculados e preserva contas de clientes, pedidos e histórico. Registros bloqueados nos espelhos impedem que sessões antigas restaurem o acesso removido.
- Falhas parciais mantêm o cargo fechado e permitem concluir a exclusão por nova tentativa.
- Dashboard passou a registrar ações reais com funcionário, cargo, serviço e horário; catálogo e atividade são confirmados juntos no servidor.
- Removidos os módulos de Erros, Equipamentos e Versões da navegação e da API; arquivos legados de versões continuam bloqueados para os clientes.
- Controle de aparência simplificado para botão de tema claro/escuro com paleta fixa e preferência persistida, substituindo o painel de escolha de cor.

## 2026-10-31 — Inicial decorativa, PDFs e compatibilidade da API

- Concluída a inicial decorativa por pasta com o mesmo nome do PDF e PNGs de A a Z, escolhida pela primeira letra do texto informado.
- Inicial centralizada somente na primeira página, preservando transparência. Modelos sem pasta correspondente ou sem a letra disponível continuam sem essa sobreposição.
- Prévia interna acompanha a composição, e o PDF de produção preserva os vetores e a transparência da inicial.
- Corrigidos os caminhos e as autorizações de upload dos modelos PDF e alfabetos, mantendo os originais privados e as permissões administrativas.
- Corrigidos imports relativos transitivos para execução nativa ESM na Vercel, incluindo `decorativeInitial` e `pdfTemplate`, eliminando a falha de inicialização que retornava HTTP 500 no status do App Check e no checkout.
- Migração de Gemini para OpenAI continua como TODO; o provedor não foi trocado nestas entregas.

## 2026-10-31 — Ajustes de QoL e melhorias pontuais

- Promoções para vários produtos ou categorias e vitrine única de descontos.
- Imagem opcional por combinação, páginas de categoria, banner com slide e tema escuro configurável.
- Lotes, arrastar e soltar, 50 MB para arquivos e 16 MB para fontes; modelos PDF privados com capa, contracapa e exportação de produção.
- Ficha inicial com Code128, observações e fila de e-mail independente do pagamento/produção.
- Na entrega inicial, adicionadas páginas operacionais com produção manual, gráficos, histórico, CSV, inventário e versões privadas com SHA-256. A retirada dos módulos e a automatização posteriores estão registradas nas atualizações acima.
- Contas Admin protegidas contra rebaixamento pelo painel e navegação administrativa por rotas/permissões.
- Checkout indica e foca campos obrigatórios ausentes.
- Na entrega inicial, preservados os TODOs de arte por inicial e migração do provedor de IA; a inicial foi concluída posteriormente, e a migração de IA continua pendente.

## 2026-10-30 — Início da integração de e-mails, Dashboard e criação de cadernetas

- Adicionado painel de e-mails com rascunhos, confirmação de envio, cancelamento, processamento da fila e contagens de aceitos/ignorados/revisão.
- Primeira etapa da integração com [resend.com](https://resend.com) para boas-vindas, confirmação de pedido, avisos de status e descadastro. O código foi concluído na atualização de 2026-10-31; a ativação depende da configuração externa.
- Adicionado Dashboard.
- Adicionada a opção de upload em batch, suporte a arquivos de até 50 MB, e PDFs.
- Ao Adicionar um arquivo de caderneta, o sistema pode receber uma pasta com as imagens [NOTA: A pasta deve ter o mesmo nome que o PDF, os nomes dos PNGs devem ser as letras de A-Z e não poder ter acentos. EX: `Alfabeto Ana Liz.pdf` só suporta a pasta `Alfabeto Ana Liz` com os arquivos `A.png`, `B.png`, `C.png`...] gerando assim o PDF da caderneta, com a primeira letra da primeira linha centralizada na capa.

## 2026-10-30 — Entrada da equipe e isolamento das seções

- Painel aguarda a primeira política de função antes de decidir o acesso, evitando recusa durante o carregamento.
- Sessão antiga, falha de consulta e ausência de seção liberada têm orientação explícita em `/admin`, com e-mail conectado e nova entrada Google.
- Entrada pelo cabeçalho usa permissões de funcionário; verificação de sessão disponível quando existe função pendente de renovação.
- Seções permitidas centralizadas; Pedidos administrativos não é renderizado nem recebe dados sem `orders.read`, e revogação fecha a área e o visualizador.
- Meus Pedidos da loja exibe somente compras da própria conta, inclusive para membros da equipe.
- Diagnóstico `security:staff-check -- --email` consulta Auth, política e espelhos sem alterar permissões.

## 2026-10-30 — Funcionários, pedidos e promoções relâmpago

- Funções Designer e Gestor de Produtos com permissões editáveis, atribuição por e-mail cadastrado e avisos de e-mail com fila/repetição.
- Autorização por função na API, no Firestore e no Storage, com épocas de sessão, revogação e espelhos privados.
- Abas Identidade Visual e Fontes separadas de Configurações; Designer altera somente imagens e opções de personalização dos produtos.
- Etiqueta A6 interna por pedido; geração inicia produção após conferência financeira, reimpressão não retrocede etapa.
- Ações explícitas de retirada/envio, fila A Caminho, código de rastreio e consulta Correios para confirmação de entrega.
- Detalhes de pedidos para o cliente e promoções relâmpago com prazo salvo, contador e preço revalidado no checkout.
- Manutenção diária protegida por segredo para rastreio e inativação de ofertas; ativação externa documentada.

## 2026-10-30 — Impressão e produção de pedidos

- Formato opcional por produto com medidas finais, sangria, margem segura e resolução recomendada.
- Guias de corte e área segura na prévia, avisos de resolução efetiva e texto próximo ao corte; proporção incompatível exige ajuste da arte.
- Confirmação explícita da arte no carrinho, com aprovação, gerações de arquivo e formato registrados pelo servidor no pedido.
- Checkout recusa formato desatualizado; pedidos antigos preservam seu fluxo e não recebem aprovação retroativa.
- Ficha de produção nos pedidos administrativos, usando os dados salvos na compra e a fila existente.
- PDF administrativo com tamanho físico, TrimBox e BleedBox; guias ficam fora dos arquivos e exportações seguem restritas ao painel.

## 2026-10-30 — Ajustes na personalização de texto e arte obrigatória

- Cada linha de texto tem posição, tamanho, cor e fonte próprios, com seleção na lista ou na prévia.
- Fonte e cor podem ser compartilhadas, mantendo tamanho e posição individuais; arraste por mouse/toque, setas e campos numéricos.
- Estilos e identidade das linhas são preservados ao editar, inserir ou remover texto, e validados no checkout.
- Prévia e modelo final usam a mesma composição; seleção e contornos de edição ficam fora do arquivo gerado.
- Exportação JPG/PDF disponível somente no visualizador de Pedidos do painel administrativo; cliente mantém a prévia.

## 2026-10-30 — Cards, contracapa e carrinho

- Conteúdo dos produtos contido no card, com colunas adaptadas à largura do próprio componente, textos longos e ações com quebra de linha.
- Personalização ocupa toda a largura disponível; preço, compartilhamento e botão de compra permanecem dentro dos limites.
- Contracapa com botão acessível em português para selecionar ou trocar imagem, mantendo validação e prévia.
- Adicionar produtos mostra “Adicionado ao carrinho.” e atualiza o contador; a abertura acontece pelo botão do carrinho.

## 2026-10-30 — Editor de personalização

- Editor em modal com texto em várias linhas, tamanho e cor selecionáveis e prévia em canvas.
- Prévia e exportação compartilham composição; Enter e linhas vazias são preservados.
- Fontes TTF e OTF, além de WOFF2: validação de conteúdo no navegador, caminhos, MIME, relay e regras do Storage.
- Gerenciamento de fontes em modal, mantendo a gravação das configurações e os pedidos antigos.

## 2026-10-30 — Destaques, contatos e acesso temporário

- Produtos podem compor o banner rotativo.
- Atendimento aceita listas de e-mails e telefones opcionais; benefícios são editáveis e reordenáveis.
- Exceção temporária por conta para arquivos administrativos, com autorização e revogação verificadas pela API.

## 2026-10-29 — Capa, contracapa e exportação dos modelos

- Adicionada contracapa opcional, usando a arte da capa sem texto sobreposto ou uma imagem escolhida pelo cliente; disponível também em produtos de arte sem texto.
- Novos modelos usam PNG e dimensões originais, sem a redução anterior para 3.200 pixels. Limites existentes de bytes foram preservados; falhas de capacidade são apresentadas sem redução silenciosa.
- Adicionado visualizador interno com escolha de face, ajuste à tela, zoom e download em JPG por face ou PDF com todas as faces. Loja, carrinho, pedidos e produção usam o mesmo visualizador.
- Checkout valida e vincula cada face ao proprietário e à versão do arquivo; limpeza de pendentes inclui contracapas. Pedidos antigos com apenas uma face continuam disponíveis.
- Adicionado gerador PDF carregado sob demanda, com `pdf-lib@1.17.1`, e testes de exportação, resolução, experiência móvel e autorização das duas faces.
- Migração futura de Gemini para OpenAI registrada em TODO, sem alterar o provedor nesta etapa.

## 2026-10-29 — Revogação administrativa entre serviços Firebase

- Adicionado registro de autorização controlado pelo servidor no banco da loja e espelhado no `(default)` para as regras do Storage.
- Firestore, Storage e API passaram a exigir autorização ativa; claim antiga ou papel legado isolado não contornam uma revogação registrada.
- Concessões geram uma nova época de autorização, impedindo que um token anterior volte a funcionar após remover e devolver Admin.
- `admin:set` preserva o formato anterior de concessão e agora aceita `--revoke` e `--dry-run`; a revogação bloqueia ambos os registros, remove os dois papéis e revoga refresh tokens.
- Adicionado `admin:sync`, somente leitura por padrão, para migrar Admins atuais preservando registros bloqueados, com verificação de divergências.
- Navegador observa autorização do servidor e retira o painel/lista administrativa quando o acesso é revogado; renovação normal do token preserva o painel ativo.
- Adicionados testes de falhas parciais, revogação concorrente, API e comandos reais em Auth/Firestore/Storage emulados, inclusive banco nomeado e token congelado antes da revogação.
- Documentada ativação do registro no banco padrão, conexão IAM e ordem de publicação. Regras de artes personalizadas e limites existentes foram preservados.

## 2026-10-29 — Proteção do servidor de desenvolvimento

- Desenvolvimento passou a escutar em loopback por padrão. Acesso por rede/túnel exige habilitação explícita e hosts exatos; `APP_URL` não amplia a lista de hosts do Vite.
- Adicionada validação de Host/Origin no HTTP e no upgrade WebSocket, sem confiar em headers encaminhados para autorizar o servidor local.
- Restringidos arquivos entregues pelo Vite ao código cliente, dependências e recursos públicos necessários. Backend, scripts, testes, credenciais, arquivos compactados e caminhos externos são bloqueados, inclusive por consultas raw/import, codificação de URL e links simbólicos.
- Diretório public é verificado antes de servir ou construir; imports de arquivos privados no bundle também são recusados. O endpoint de abertura do editor local foi desativado.
- HMR passou a compartilhar o servidor HTTP; desativá-lo também desliga o listener WebSocket. O servidor E2E fica em loopback e builds com VITE_E2E_MODE=true são rejeitados.
- `npm start` passou a executar produção explícita, com build obrigatório e sem importar Vite. Valores inválidos de ambiente, modo ou porta interrompem a inicialização.
- Adicionados testes reais de HTTP, preview, CLI, WebSocket e HMR no navegador, com regressão na CI. Preservados os fluxos de App Check, IA, personalização, checkout e frete.
- Atualizada somente a dependência transitiva `re2js` de `2.8.6` para `2.8.7`, corrigindo o alerta de negação de serviço identificado na auditoria do SDK Firebase.

## 2026-10-29 — Cotação real de frete com os Correios

- Substituída a tabela regional por consultas nacionais de preço e prazo dos serviços PAC/SEDEX autorizados no contrato, somente pelo backend.
- Adicionado suporte a token temporário e renovação automática com usuário, código de acesso CWS e cartão de postagem, sem credenciais no navegador.
- Adicionados peso por unidade, peso da embalagem, dimensões externas e capacidade por volume ao editor de produtos, com perfis específicos por combinação.
- Carrinho permite escolher serviço e apresenta prazo de transporte separado da produção; alterar CEP, itens, opções ou quantidades invalida a cotação.
- Pedidos usam até 20 volumes; produtos/combinações diferentes ficam separados. Serviço sem preço e prazo para todos os volumes não é oferecido.
- Checkout recalcula o frete antes de criar pedido/PagBank e exige revisão quando o preço muda. Serviço e volumes são registrados no pedido e exibidos no painel.
- Adicionados diagnóstico `shipping:check`, testes do provedor, HTTP e navegador, e guia `docs/correios-integration.md`.
- Ajustada a duração da função principal da API na Vercel para 60 segundos para acomodar recotação e checkout.

## 2026-10-27 — Autorização da IA administrativa no servidor

- As quatro funções de IA do editor passaram a chamar a API própria, que exige sessão válida e autorização administrativa atual antes de gerar uma sugestão.
- Reutilizada a verificação de revogação de sessão e de custom claim administrativa atual, preservando a compatibilidade com o papel administrativo legado protegido no Firestore.
- A chamada ao provedor usa OAuth da conta de serviço no servidor; o navegador não escolhe projeto, modelo, destino ou parâmetros de geração.
- Adicionados limites compartilhados no Firestore de 10 solicitações por administrador e 60 por projeto a cada minuto, além de limites de espera e saída do provedor.
- Recusas e erros da API recebem `Cache-Control: no-store`; erros de autenticação, permissões e provedor não expõem credenciais ou textos enviados.
- Adicionados diagnóstico de configuração e consulta opcional de permissão IAM, sem gerar texto ou alterar permissões.
- Ajustada a dependência transitiva `qs` para `6.16.2` no lockfile.
- Documentadas a configuração de IAM, a publicação e a desativação posterior do acesso direto antigo ao Firebase AI Logic; o patch não modifica essas configurações externas automaticamente.

## 2026-10-27 — Validação de sessões com Firebase App Check

- Adicionada confirmação da validação do navegador pela API em `/api/app-check/status`, com diagnóstico em segundo plano e sem expor tokens.
- A API passou a conferir o App ID da loja, com suporte a uma lista explícita de apps autorizados.
- Chamadas à API mantêm o atestado restrito à mesma origem e impedem seu encaminhamento por redirecionamentos.
- Uma sessão rejeitada pelo middleware pode obter um novo atestado e repetir a chamada uma única vez, preservando os headers e o corpo da requisição.
- A aquisição de tokens pela API recebeu espera limitada e aviso controlado quando o provedor está indisponível.
- Adicionado modo de depuração restrito ao desenvolvimento local e validação de build que impede publicar a flag de debug ou usar `enforce` sem chave pública.
- Chamadas ao Firebase AI Logic passaram a solicitar tokens de uso limitado, compatíveis com a ativação de proteção contra reuso no console.
- Adicionado o comando `security:app-check` para conferir a configuração local sem exibir credenciais.

## 2026-09-17 — Gestão operacional do painel administrativo

- Categorias agora podem ser editadas sem trocar o identificador do documento; renomeações atualizam os produtos e as promoções vinculadas.
- Adicionados upload de ícone pelo computador e controles para ordenar a navegação das categorias.
- Pedidos passaram a ser organizados em cinco filas recolhíveis: aguardando pagamento, pagamento confirmado, em produção, pronto para retirada e entregue.
- Mantida a separação interna entre situação financeira e andamento de produção, impedindo que uma ação administrativa simule confirmação de pagamento.
- Promoções agora possuem alvo obrigatório por produto ou categoria e desconto percentual ou valor fixo.
- A loja exibe preço original riscado, preço promocional e porcentagem calculada, inclusive quando o desconto foi informado em reais.
- O servidor recalcula a melhor promoção diretamente dos documentos do Firestore e ignora preços ou identificadores promocionais enviados pelo navegador.
- Logo, banner principal, banners promocionais e ícones de categoria agora aceitam upload de JPG, PNG ou WebP no painel.
- Removida da interface e das próximas gravações da configuração a chave de PIX manual legada; o checkout continua exclusivamente hospedado no PagBank.
- A área de configurações foi reorganizada em identidade visual, atendimento, benefícios, fontes de personalização e dados legais.
- Fontes de personalização passaram a ser cadastradas no painel, como família CSS ou arquivo WOFF2; não existe mais uma lista selecionável definida no código.
- A política de segurança de conteúdo passou a liberar fontes somente do próprio site, dados embutidos e Firebase Storage.
- Arquivos administrativos usam caminhos restritos, nomes aleatórios, limite de tamanho, conferência de assinatura no navegador e escrita exclusiva para administrador no Storage.
- Adicionados testes para descontos, filas operacionais, fontes e caminhos de arquivos administrativos.
- Corrigido o bloqueio nativo dos formulários de imagem: caminhos locais seguros como `/logo.png` agora podem ser salvos em categorias, identidade visual e promoções sem enfraquecer a validação contra protocolos inseguros.
- Mantida intacta a folha global `src/index.css` e preservada a identidade visual da loja.

## 2026-09-17 — Personalização visual de texto e arte obrigatória

- Removida da loja a opção de enviar a arte posteriormente pelo WhatsApp.
- Produtos configurados para receber arte agora só podem entrar no carrinho depois do upload privado do arquivo.
- Adicionado ao painel administrativo o tipo de personalização `Texto + Imagem`, combinando arquivo obrigatório e texto configurável.
- Criado drawer acessível para o cliente informar o texto, escolher entre fontes permitidas e posicioná-lo por clique, arraste ou teclado em uma prévia do produto ou da arte enviada.
- Ao aplicar a personalização, o navegador agora renderiza a imagem e o texto escolhido em um arquivo raster único, preservando proporção, fonte e posição visual.
- O modelo composto é enviado de forma privada ao Cloud Storage, com identificação técnica própria, limite de 15 MB, conferência de assinatura e caminho vinculado ao usuário.
- Adicionada configuração versionada de CORS do Firebase Storage e uma segunda estratégia de carregamento para imagens que abrem no navegador, mas têm o `fetch` bloqueado pela origem.
- Texto, fonte e posição continuam registrados como metadados de auditoria, mas a produção recebe o modelo visual já composto em vez de depender de um mapa de coordenadas.
- O servidor exige e valida o modelo para qualquer produto com texto, confere proprietário, MIME, assinatura e metadado técnico e o copia para o caminho definitivo do pedido.
- Cliente e administrador abrem o modelo por uma URL assinada de cinco minutos; o painel mantém a arte original separada quando o produto exige upload do cliente.
- O carrinho e a área de pedidos do cliente exibem um resumo da personalização e identificam quando o modelo composto está pronto.
- Modelos distintos passam a gerar itens distintos no carrinho, e cópias parciais são removidas se a preparação do pedido falhar.
- Pedidos antigos com texto simples ou arte pendente continuam legíveis, sem reabrir a opção removida para novas compras.
- Adicionados testes unitários, de regras e de navegador para o novo tipo combinado, o arquivo composto e o fluxo completo até o payload do checkout.
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

## 2026-08-31 — Estabilidade e interface

- Corrigidas busca, categorias, banners e ações sem comportamento.
- Carrinho protegido contra dados locais inválidos e colisões entre personalizações.
- Validação de CPF, preços e combinações no navegador e servidor.
- Regras do Firestore reforçadas para usuários, promoções e pedidos.
- Gemini movido do navegador para uma rota administrativa autenticada.
- CORS, headers HTTP, mensagens de erro e logs revisados.
- Painel administrativo e diálogos adaptados para telas menores e teclado.
- Admin carregado sob demanda e dependências divididas em chunks.
- `.env.example` sanitizado e documentação de ambiente reescrita.
