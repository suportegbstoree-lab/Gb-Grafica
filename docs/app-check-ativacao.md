# App Check: aplicação e validação

Base do patch: commit `7ff0fcb`, pacote com SHA-256 `716c71b6831867cd62bfa9efffc4948988a44aacbd28a57ad1ccdc8234c12070`.

O cadastro do app no console, a emissão de tokens pelo navegador e a exigência desses tokens são etapas distintas. “Registrado (não aplicado)” não comprova que a versão publicada está enviando tokens, nem que os serviços já estão rejeitando solicitações sem atestado.

Os tokens de sessão têm validade e são renovados pelo SDK. Não é necessário renovar manualmente a chave pública a cada hora. O TTL pertence à configuração do App Check, não às variáveis da Vercel. Esta implementação não altera UI, UX, limites dos arquivos, regras Firebase, CORS do bucket ou flags do upload em partes.

## Aplicar

Na raiz do repositório, com as mudanças anteriores já registradas:

```bash
git apply --check app-check-integracao.patch
git apply app-check-integracao.patch
npm ci
npm test
npm run lint
npm run build
npm run test:rules
npx playwright install chromium
npm run test:e2e
npm run test:smoke
```

Use Node `22.23.4`, npm `12.2.1` e Java 21, como no workflow. O patch não troca dependências nem precisa regenerar o lockfile. A alteração em `package.json` adiciona somente um comando de diagnóstico. Os testes usam projetos fictícios e serviços simulados, sem acessar credenciais ou dados da loja.

## Configurar fora do código

Estas ações são manuais; o patch não sincroniza contas nem altera o console.

| Local | Configuração | Valor/ação |
| --- | --- | --- |
| Firebase → App Check → Apps → gb-webapp | Provedor | Confirmar reCAPTCHA Enterprise e a mesma chave pública usada no build |
| Google Cloud → reCAPTCHA → chave web | Tipo | Baseada em pontuação, sem checkbox |
| Google Cloud → reCAPTCHA → chave web | Domínios | Confirmar `gblgrafica.com.br` e `www.gblgrafica.com.br`; adicionar apenas hosts de preview efetivamente usados |
| Firebase → App Check → app web | TTL e pontuação | Manter inicialmente os padrões de 1 hora e 0,5; ajustar depois com dados de tráfego |
| Vercel → Environment Variables → Production | `VITE_RECAPTCHA_ENTERPRISE_SITE_KEY` | Chave pública correspondente ao cadastro; disponível durante o build |
| Vercel → Environment Variables → Production | `FIREBASE_APP_CHECK_MODE` | `monitor` na primeira publicação; `enforce` após a validação abaixo |
| Vercel → Environment Variables | `VITE_APP_CHECK_DEBUG` | Ausente ou `false` em Production e Preview |
| Vercel → Environment Variables | `FIREBASE_APP_CHECK_ALLOWED_APP_IDS` | Opcional; ausente autoriza somente o App ID web do config. Não usar `*` |
| Vercel → Deployments | Nova publicação | Fazer redeploy após configurar a chave; variáveis `VITE_*` são incorporadas ao bundle |

Não adicione `localhost` à chave reCAPTCHA usada em produção. Authentication → Authorized domains é outra configuração: mantenha os hosts necessários para o login Google, incluindo localhost somente para desenvolvimento. `APP_URL` e `APP_ALLOWED_ORIGINS` continuam com as origens atuais; não é necessário abrir CORS para `*`.

Antes do build local com configuração equivalente à publicação:

```bash
npm run security:app-check -- --production
```

Esse comando lê os arquivos de ambiente no padrão do Vite, inclusive `.env.local`, sem imprimir seus valores. O resultado não consulta as variáveis remotas da Vercel nem confirma o registro do provedor. O build impede `enforce` sem chave e impede a flag de debug em qualquer build, inclusive em outros modos do Vite. Um build de CI sem configuração Firebase continua permitido, mas não comprova prontidão de produção.

## Validar no domínio publicado

1. Publicar inicialmente com `FIREBASE_APP_CHECK_MODE=monitor`. Não aplicar todos os bloqueios ao mesmo tempo.
2. Abrir o site em um navegador normal, sem token de debug. No DevTools → Network, localizar `exchangeRecaptchaEnterpriseToken`: deve concluir com sucesso. Não copiar nem compartilhar seus tokens, payloads ou capturas da aba de resposta.
3. Localizar `GET /api/app-check/status`, iniciado automaticamente pelo cliente. Em monitor, esperar HTTP 200 e `{"mode":"monitor","verified":true}`. HTTP 200 com `verified:false` indica que a proteção ainda não foi confirmada. Abrir a URL diretamente em outra aba não envia o header e não equivale a esse teste.
4. Confirmar nos logs Vercel o evento `app_check_status` com `verified:true`. Ausências/falhas aparecem como `app_check_monitor_observation`, com motivo, sem token. Não usar apenas ausência de erros como prova de sucesso.
5. Exercitar catálogo anônimo, login Google, cálculo de frete, upload e leitura de arte, checkout Sandbox, consulta de pagamento e as funções administrativas e de IA usadas pelo painel. Validar também em uma sessão nova e em celular. Não efetuar compras reais.
6. Conferir métricas de requisições verificadas em cada API usada no Firebase App Check: Firestore, Storage e Firebase AI Logic. Se o serviço Authentication tiver enforcement disponível/habilitado no seu projeto, validar login e renovação de sessão também. O diagnóstico Express confirma somente a API própria.
7. Alterar `FIREBASE_APP_CHECK_MODE=enforce` na Vercel e fazer redeploy. Repetir os fluxos. O diagnóstico autenticado pelo SDK deve retornar `{"mode":"enforce","verified":true}`.
8. Ativar enforcement por serviço no Firebase, verificando o funcionamento após cada um. A propagação pode levar até 15 minutos. Registrar quais serviços foram efetivamente ativados, inclusive quando a configuração mostrar escopo específico por banco/bucket. Não mudar regras de autorização para compensar falha de atestado.

Para conferir a rejeição sem token, de forma somente de leitura:

```bash
curl -i https://www.gblgrafica.com.br/api/app-check/status
```

Em `enforce`, esperar HTTP 401 e código `APP_CHECK_REQUIRED`. Em `monitor`, o resultado será 200 com `verified:false`, por definição. Um cliente não autenticado pode emitir App Check válido; login e autorização continuam sendo exigidos nas rotas que precisam deles.

## IA e proteção contra reuso

Firebase informa que o App Check passa a ser obrigatório para Firebase AI Logic em **2 de novembro de 2026**. Não depender de poder desativar essa exigência após a data. Concluir a validação do SDK e da chave antes disso.

A instância de IA agora pede tokens de uso limitado. Para ativar replay protection no Firebase AI Logic, publicar essa versão, confirmar chamadas verificadas e só depois ativar a opção correspondente no console. Tokens novos por chamada, isoladamente, não garantem rejeição a reuso: o console também precisa exigir a proteção. Isso aumenta a frequência de atestações para IA. O backend Express não consome tokens de sessão e não exige a permissão IAM de consumo de tokens.

App Check não transforma um usuário comum em administrador nem restringe a IA a admins por si só. O escopo administrativo da IA é uma revisão de autorização separada; não foi anunciado como resolvido por este patch.

## Desenvolvimento e CI

Para desenvolvimento sem acesso aos serviços protegidos, chave vazia e modo `off` continuam disponíveis. Para acessar serviços reais com enforcement a partir de localhost:

1. Manter a chave pública configurada localmente e definir `VITE_APP_CHECK_DEBUG=true` apenas no ambiente de desenvolvimento.
2. Usar `npm run dev` em `localhost` ou `127.0.0.1`.
3. Cadastrar no Firebase → App Check → app web → Manage debug tokens o token exibido pelo SDK no console do navegador. Esse token é um segredo e deve permanecer local.
4. Remover a flag antes de gerar build. Não colocar o segredo em variável `VITE_*`, código, Git ou logs de CI. Revogar no console qualquer debug token exposto.

O CI deste projeto não precisa de debug token real: a bateria usa fixtures próprias, o SDK Firebase e um provedor reCAPTCHA simulado. A fixture só é entregue pelo servidor E2E e não entra no build publicado.

## Falhas e reversão

| Sintoma | Verificação |
| --- | --- |
| `APP_CHECK_REQUIRED` | Chave no build, versão publicada, aquisição do token e envio do header |
| `APP_CHECK_INVALID` | Registro, App ID, chave correspondente, relógio do dispositivo, validade e métricas do provedor |
| `app_mismatch` nos logs de monitor | App ID do cliente diferente do config ou da lista explícita do servidor |
| `APP_CHECK_CONFIGURATION_ERROR` | Modo ou lista de App IDs inválidos |
| `APP_CHECK_UNAVAILABLE` | Inicialização/credenciais do Firebase Admin; o servidor não libera a operação em enforce |
| Diagnóstico válido, Firestore/Storage/IA bloqueado | Conferir enforcement e métricas daquele serviço; a API própria usa validação independente |
| Script/frame bloqueado pelo navegador | Conferir CSP efetivamente servida, extensões, bloqueadores e acesso aos domínios reCAPTCHA |

Reverter o código com Git é independente de reverter configurações no console. Se a API própria bloquear tráfego legítimo durante a implantação, voltar `FIREBASE_APP_CHECK_MODE` para `monitor`, fazer redeploy e investigar. Se o problema estiver em um serviço Firebase, a reversão precisa ocorrer na configuração daquele serviço, quando permitida; voltar a API para monitor não desativa o enforcement do Storage/Firestore/IA. A exigência obrigatória da IA tem a restrição de data descrita acima.

## Referências oficiais

- https://firebase.google.com/docs/app-check/web/recaptcha-enterprise-provider
- https://firebase.google.com/docs/app-check/custom-resource-backend
- https://firebase.google.com/docs/app-check/web/debug-provider
- https://firebase.google.com/docs/app-check/enable-enforcement
- https://firebase.google.com/docs/ai-logic/app-check
