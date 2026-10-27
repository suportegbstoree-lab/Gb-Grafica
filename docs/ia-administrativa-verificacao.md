# IA administrativa: evidências de verificação

Data: 27 de outubro de 2026. Ambiente: Node.js `22.23.4`, npm `12.2.1`, Java 21 e Chromium headless para Playwright.

Base: código do commit `7ff0fcb` com `app-check-integracao.patch` já aplicado. SHA-256 daquele patch: `16980feaf638f3c83ae16b2e5db20413804b280b261e8544b36a856992b7abe3`. O commit local `728f859` registra essa base reconstruída para comparação; não é um commit publicado do usuário.

## Resultado da bateria

| Verificação | Resultado observado |
| --- | --- |
| Instalação limpa com `npm ci` | Aprovada com o lockfile entregue |
| Testes unitários e HTTP com `npm test` | 239 aprovados; nenhuma falha ou teste ignorado |
| Testes Firebase com `npm run test:rules` | 39 aprovados; 36 cenários de regras e 3 de limites compartilhados de IA |
| Navegador com Playwright | 25 cenários aprovados: execução integral de 23 e execução adicional dos 2 novos cenários do editor |
| `npm run lint` | Aprovado, inclusive após os novos testes do editor |
| `npm run build` | Aprovado; permanece o aviso informativo de tamanho de chunk do Vite |
| `npm run test:smoke` | Aprovados saúde, contrato da API, oito rotas públicas, robots e sitemap |
| `npm audit --omit=dev --audit-level=moderate` | Zero vulnerabilidades reportadas na execução |
| Auditoria incluindo dependências de desenvolvimento | Zero vulnerabilidades reportadas na execução |
| Aplicação do patch sobre base limpa | `git apply --check`, aplicação, comparação dos arquivos e verificação de reversão aprovadas |

O resultado da auditoria descreve a base de avisos disponível naquele momento; não equivale a ausência de toda vulnerabilidade. Os avisos de proxy experimental do ambiente de execução não foram ocultados alterando as configurações da aplicação.

## Segurança verificada

- Anonimato, usuário comum e papel administrativo forjado no corpo são recusados antes de qualquer chamada OAuth ou ao modelo.
- Sessões revogadas, expiradas, inválidas e de conta desativada são recusadas. Uma custom claim antiga não libera a IA depois de retiradas a permissão atual e a autorização legada.
- Falha na consulta de autenticação ou de autorização não concede acesso.
- Em modo `enforce`, a ausência de App Check bloqueia a geração antes do handler. App Check válido não substitui a permissão administrativa.
- Ações e campos não autorizados, escolha de modelo ou URL pelo navegador e textos inválidos não chegam ao provedor.
- O décimo primeiro pedido por administrador na mesma janela é bloqueado. Contadores persistidos por outra instância são consultados antes de gerar.
- No Firestore real do emulador, com uma vaga restante no limite global, apenas uma das doze solicitações concorrentes alcançou o modelo; onze receberam `429`.
- O provedor recebe somente o OAuth do servidor e o texto necessário; não recebe o ID token do usuário ou App Check. Redirecionamentos não são seguidos.
- Erros de credencial, IAM, API, modelo, cota, rede e timeout não devolvem tokens ou o corpo privado do provedor. A geração não é repetida automaticamente.
- A resposta do provedor tem limite de leitura e de texto. Partes identificadas como raciocínio não são devolvidas ao navegador.
- Respostas da API usam `no-store`, inclusive recusas de origem. A política CORS existente continua sendo aplicada.
- O navegador envia autenticação e App Check à API da mesma origem. Os cenários de renovação e de serviços Firebase da bateria anterior continuam aprovados.
- No editor existente, gerar descrição, melhorar título, melhorar descrição e comando personalizado mantêm a aprovação manual. Uma recusa da API preserva o texto e permite continuar editando.

## Alcance dos testes

Os testes HTTP usam a aplicação Express real, mas simulam respostas de Firebase Auth, OAuth e do modelo. As regras e as transações de cota usam o projeto fictício `demo-gb-grafica-rules` nos emuladores, com bloqueio explícito para impedir que o novo teste de transações use Firestore real. Os testes de navegador usam serviços simulados e SDKs reais nas fixtures de App Check.

Não houve geração paga, compra, alteração de IAM, desativação de API, modificação da Vercel ou publicação de regras. A permissão da conta de serviço, a disponibilidade do modelo e o funcionamento no domínio publicado ainda precisam da validação descrita em [IA administrativa: aplicação e configuração](ia-administrativa-seguranca.md).

## O que este patch não encerra

| Pendência | Situação |
| --- | --- |
| Acesso direto antigo à IA | Precisa do fechamento no Google Cloud após testar a nova versão. Remover o SDK do navegador não desativa o serviço antigo. |
| Revogação administrativa nos acessos diretos ao Firebase | Permanece pendente; as Security Rules ainda podem aceitar claims de tokens antigos até sua expiração. O novo endpoint usa a verificação atual já existente no backend. |
| Abuso de uploads | Cota do fluxo experimental continua sem garantia enquanto as regras admitirem uploads diretos. Limites dos arquivos não foram alterados. |
| Estornos PagBank | Teste real no sandbox continua reservado para o final. |
| App Check e regras publicados | A configuração efetiva dos serviços e do domínio exige confirmação externa; a bateria local não a substitui. |
| Servidor de desenvolvimento | O item crítico previamente adiado permanece fora deste patch. |

## Referências de configuração

- [Firebase AI Logic: modo de usuários autenticados](https://firebase.google.com/docs/ai-logic/auth-mode)
- [Firebase AI Logic: desativação das APIs e impacto nos clientes antigos](https://firebase.google.com/docs/ai-logic/faq-and-troubleshooting)
- [IAM para geração de conteúdo](https://cloud.google.com/vertex-ai/generative-ai/docs/access-control)
- [Duração das funções Vercel](https://vercel.com/docs/functions/configuring-functions/duration)
