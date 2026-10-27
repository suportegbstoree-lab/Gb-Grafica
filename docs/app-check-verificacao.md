# Evidências de validação do App Check

Data: 27/10/2026. Base: `7ff0fcb`. Pacote recebido: SHA-256 `716c71b6831867cd62bfa9efffc4948988a44aacbd28a57ad1ccdc8234c12070`, conferido antes da extração.

Ambiente: Node 22.23.4, npm 12.2.1, OpenJDK 21.0.2 para os emuladores, Playwright 1.63.0 e Chromium headless 153 para navegador. SDKs mantidos: Firebase 12.19.0 e Firebase Admin 14.5.0. Nenhuma dependência foi atualizada; `package-lock.json` permanece igual ao pacote recebido.

## Resultados

| Verificação | Resultado |
| --- | --- |
| Instalação com `npm ci` | Aprovada com Node/npm equivalentes ao CI |
| Testes unitários e HTTP | 217 aprovados, zero falhas ou testes ignorados |
| Regras Firebase nos emuladores Firestore/Storage | 36 aprovados, zero falhas ou testes ignorados |
| Navegador | 23 aprovados: 12 regressões da loja/painel e 11 cenários de App Check |
| `npm run lint` | Aprovado |
| Build de produção com chave fictícia e modo `enforce` | Aprovado |
| Smoke do servidor de produção | Saúde, contrato da API, 8 rotas públicas, robots.txt e sitemap.xml aprovados |
| `npm audit --omit=dev --audit-level=moderate` | Zero vulnerabilidades reportadas nesta execução |
| Build com `enforce` sem site key | Recusado como esperado |
| Build com flag de debug | Recusado como esperado |
| Diagnóstico de configuração de produção | Aceita chave + monitor; recusa chave ausente |

## Cobertura específica

- Emissão de tokens com `ReCaptchaEnterpriseProvider` real, cache e oito solicitações concorrentes compartilhando a aquisição.
- Renovação automática antes de expirar, com relógio virtual; nova aquisição ao retomar uma aba após duas horas sem executar os timers.
- Transporte do header para a API própria e, pelo SDK, para Firestore, Storage, Authentication e Firebase AI Logic.
- Cliente de IA da aplicação requisitando tokens de uso limitado distintos em duas gerações.
- Entrada do reCAPTCHA e chamadas Firebase sob a política CSP lida do `vercel.json`, sem violações nos cenários simulados.
- Recuperação após rejeição explícita de App Check pelo middleware, limitada a uma tentativa.
- Preservação de Authorization, outros headers e corpo ao receber um objeto `Request`.
- Não repetição em erros de rede, autenticação, permissão, PagBank, indisponibilidade, requisição cancelada ou falha de obtenção do token.
- Destinos externos não recebem automaticamente o atestado; redirecionamento de uma API para outro servidor local é rejeitado sem chamada ao destino.
- Headers ausentes, duplicados, malformados e excessivos rejeitados em `enforce`.
- JWTs locais com assinatura RSA verificada pelo Firebase Admin real; rejeição de token expirado, assinatura alterada, algoritmo incorreto, audience de outro projeto, issuer falso e App ID de outro app.
- `monitor` distingue atestado validado de ausente/inválido; modo desconhecido e lista de App IDs inválida não liberam as rotas protegidas.
- Token App Check válido não substitui autenticação Firebase. Health, webhook PagBank e preflight CORS permanecem acessíveis segundo seus contratos atuais.
- Depuração via provedor oficial em localhost; bloqueio no modo de produção; ausência de token ou chave sem impedir a montagem da fixture.
- Falha de avaliação e script reCAPTCHA bloqueado resultam em erro controlado no helper. O teste usa prazo reduzido; o prazo publicado é de dez segundos.
- Logs e diagnóstico não devolvem o conteúdo do atestado.

## Limites da evidência

O navegador executa os SDKs reais, mas o script externo reCAPTCHA e os endpoints Google são simulados. Os JWTs do teste HTTP são assinados com uma chave fictícia local; somente a obtenção de chaves públicas pelo Admin é substituída. Não foi emitido um atestado de produção nem exercitado o algoritmo real de pontuação/risco. Os testes de regras usam um projeto fictício `demo-*`; não demonstram enforcement de App Check no projeto real.

O teste de Authentication usa login com custom token fictício. Login Google, cadastro da chave, domínios, permissões reais, quotas e configuração de enforcement dos serviços exigem a validação no domínio publicado descrita em `app-check-ativacao.md`.

Não foram usadas credenciais de produção, conectadas contas Vercel/Firebase, modificados consoles, aplicadas regras remotas ou realizados pagamentos reais. O sucesso local não deve ser anunciado como confirmação de proteção já ativa no ambiente publicado.
