# IA administrativa: aplicação e configuração

Este ajuste se aplica sobre a versão com `app-check-integracao.patch` já aplicado. A referência usada foi o código `7ff0fcb` mais aquele patch, SHA-256 `16980feaf638f3c83ae16b2e5db20413804b280b261e8544b36a856992b7abe3`. Não reaplique o patch antigo.

As quatro funções existentes continuam no mesmo editor: gerar descrição, melhorar título, melhorar descrição e comando personalizado. A aprovação da sugestão continua manual. Nenhuma tela, estilo, regra de CORS ou limite de upload foi alterado.

Os resultados e os limites da bateria estão em [IA administrativa: evidências de verificação](ia-administrativa-verificacao.md).

## Antes de publicar: Google Cloud e Vercel

A geração agora passa por `POST /api/admin/ai/suggestions`. O servidor valida App Check conforme o modo configurado, verifica a sessão e a autorização administrativa atual e chama o modelo usando OAuth da conta de serviço Firebase existente. Não há nova chave Gemini.

1. No mesmo projeto Google Cloud do Firebase, confirme que **Agent Platform API / Vertex AI API**, serviço `aiplatform.googleapis.com`, está ativa e que faturamento e acesso ao modelo estão disponíveis. Mantenha esse serviço ativo: o backend depende dele.
2. Em IAM, localize a conta cujo `client_email` está em `FIREBASE_SERVICE_ACCOUNT_JSON`. Confirme a permissão `aiplatform.endpoints.predict`. O papel padrão `roles/aiplatform.user` atende à chamada; atribua-o à conta de serviço nesse projeto somente se necessário. Não conceda a usuários comuns e não altere a chave privada.
3. Na Vercel, preserve as variáveis atuais de Firebase, PagBank, URL e origens. As opções de IA são:

| Variável | Comportamento |
| --- | --- |
| `FIREBASE_AI_MODEL` | Opcional; escolhe o modelo somente no servidor. Ausente usa `VITE_GEMINI_MODEL`, depois `gemini-3.8-flash`, preservando a configuração anterior. |
| `FIREBASE_AI_LOCATION` | Opcional; padrão `global`, o mesmo padrão do `AgentPlatformBackend` anterior. Se alterar a região, confirme suporte do modelo nela. |
| `FIREBASE_SERVICE_ACCOUNT_JSON` | Conta de serviço já existente, exclusiva do servidor. |
| `FIREBASE_APP_CHECK_MODE` | Mantenha o modo já validado; este patch não ativa enforcement automaticamente. |
| `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` | Chave pública App Check já existente, necessária no build quando App Check estiver ativo. |

O nome do modelo é mantido por compatibilidade com o código recebido. O diagnóstico local não comprova que o modelo está disponível na sua conta. Se o modelo anterior já falhava, confirme o identificador disponível no projeto e informe `FIREBASE_AI_MODEL` antes de publicar.

A função `api/admin-ai.ts` tem duração própria de 60 segundos em `vercel.json`; a duração e as reescritas de checkout e das demais rotas foram preservadas. Confirme a configuração efetiva no deployment da Vercel.

## Aplicar e verificar localmente

```bash
git apply --check seguranca-ia-administrativa.patch &&
git apply seguranca-ia-administrativa.patch &&
npm ci &&
npm run security:ai-check &&
npm run lint &&
npm test &&
npm audit --omit=dev --audit-level=moderate &&
npm run build &&
npm run test:smoke
```

O comando `security:ai-check` lê a configuração local, confere projeto, modelo e localização e não imprime credenciais. Com as mesmas variáveis da Vercel disponíveis localmente, também é possível consultar apenas a permissão:

```bash
npm run security:ai-check -- --permissions
```

Essa consulta usa OAuth da conta existente e `projects:testIamPermissions`. Não concede papéis, não gera texto e não confirma API ativa, disponibilidade do modelo ou fechamento do endpoint anterior. Uma consulta indisponível requer conferência manual no IAM.

Para a bateria completa, use Java 21 e o navegador do Playwright:

```bash
npm run test:rules &&
npx playwright install chromium &&
npm run test:e2e
```

As regras e as transações usam um projeto fictício `demo-gb-grafica-rules` nos emuladores. As chamadas de Auth e do modelo são simuladas nos testes. Nenhuma compra ou chamada de IA real faz parte da bateria automatizada. O lockfile inclui o ajuste pontual de `qs` para `6.16.2`, sem `npm audit fix --force`.

## Publicar e fechar o acesso direto anterior

Faça nesta ordem, preservando uma aba da versão anterior para conferir o fechamento depois:

1. Confirme API e IAM acima. Publique a nova versão; abra outra aba atualizada e entre como administrador.
2. Exercite os quatro comandos de IA e confira aprovação e descarte. Na aba Network, as gerações devem ir para `/api/admin/ai/suggestions`, retornar `200` e alterar o formulário somente após aprovação. Confira login, catálogo, carrinho, frete e um checkout sandbox.
3. Se usa `FIREBASE_APP_CHECK_MODE=enforce`, confirme `/api/app-check/status` com `verified: true`. Caso esteja em `monitor`, conclua a ativação conforme `app-check-ativacao.md`; o login administrativo continua obrigatório em qualquer modo.
4. Nas restrições de API de **todas as chaves públicas usadas pelo app web**, mantenha as APIs necessárias a Firebase Auth, Firestore, Storage e App Check. Exclua o acesso às APIs de IA abaixo. Não substitua a lista inteira sem conferir as APIs Firebase necessárias.
5. Depois de a nova versão funcionar, desative o serviço antigo `firebasevertexai.googleapis.com` se nenhum outro aplicativo do projeto depender de Firebase AI Logic. Se houver outros consumidores, a migração deles precisa ser tratada antes: este patch não fecha os clientes antigos sozinho.
6. Na aba antiga, confirme que uma geração direta pelo Firebase AI Logic falha por serviço desativado; na aba nova, confirme novamente os quatro comandos pela API própria. Registre os resultados sem copiar tokens ou cabeçalhos de autorização.

| Serviço | Estado necessário após migração | Chave pública do navegador |
| --- | --- | --- |
| `aiplatform.googleapis.com` | Ativo: usado pelo servidor com OAuth. | Excluir da lista permitida da chave pública; o servidor não usa essa chave. |
| `firebasevertexai.googleapis.com` | Desativar após migrar os consumidores de Firebase AI Logic. | Excluir da lista permitida da chave pública. |
| `generativelanguage.googleapis.com` | Não é usado por esta implementação; avalie outros consumidores antes de desativar. | Excluir da lista permitida da chave pública. |

Sem fechar o caminho antigo, uma pessoa ainda pode tentar o serviço anterior fora do site e contornar o novo controle administrativo. App Check e o modo de usuários autenticados do Firebase AI Logic não concedem, por si só, uma permissão exclusiva de administrador.

## Controles e limites do ajuste

- Sessão Firebase verificada com conferência de revogação. O acesso administrativo usa a autorização atual já existente na API, inclusive a compatibilidade com administradores legados em `users/{uid}.role`.
- Apenas quatro ações e campos de texto conhecidos. Projeto, URL, credenciais, modelo e parâmetros de geração não podem ser escolhidos pelo navegador.
- Limites compartilhados no Firestore: 10 solicitações por administrador e 60 no projeto em uma janela de um minuto. Existe também o contador local. Tentativas autorizadas que falham no provedor consomem o limite; não há repetição automática da geração.
- Os limites reduzem abuso e consumo concorrente; não equivalem a um teto financeiro diário. Configure os alertas de faturamento existentes conforme a operação.
- OAuth com espera de até 10 segundos; modelo com até 25 segundos e cancelamento. Respostas privadas e erros da API própria recebem `Cache-Control: no-store`, inclusive recusas antecipadas de CORS e JSON.
- O provedor recebe apenas o token OAuth do servidor e o texto necessário. Tokens de usuário e App Check não são encaminhados. Logs não incluem prompts, sugestões, tokens ou corpos de erro do provedor.

Para retirar um administrador legado, remova também seu papel no documento protegido; retirar apenas a custom claim não remove um acesso legado ainda válido. Revogue as sessões quando necessário. Este ajuste não modifica o comportamento de revogação dos acessos diretos protegidos por Firebase Security Rules: tokens antigos podem continuar válidos até expirar, conforme o serviço.

Se precisar voltar à versão anterior, reverter apenas o código não reativa o serviço Firebase AI Logic nem suas permissões na chave pública. Planeje a reversão junto com as configurações externas alteradas. Não restaure o acesso direto antes de avaliar a proteção administrativa.

## Referências oficiais

- [Firebase AI Logic: modo de autenticação](https://firebase.google.com/docs/ai-logic/auth-mode)
- [Firebase AI Logic: desativação das APIs e impacto nos clientes antigos](https://firebase.google.com/docs/ai-logic/faq-and-troubleshooting)
- [Permissões para IA generativa](https://cloud.google.com/vertex-ai/generative-ai/docs/access-control)
- [API de geração de conteúdo](https://cloud.google.com/vertex-ai/generative-ai/docs/model-reference/inference)
- [Restrições de chaves Firebase](https://firebase.google.com/docs/projects/api-keys)
- [Ativar e desativar serviços](https://cloud.google.com/service-usage/docs/enable-disable)
- [Consultar permissões do projeto](https://docs.cloud.google.com/resource-manager/reference/rest/v1/projects/testIamPermissions)
- [Duração das funções Vercel](https://vercel.com/docs/functions/configuring-functions/duration)
