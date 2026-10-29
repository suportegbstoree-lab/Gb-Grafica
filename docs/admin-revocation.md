# Revogação de acesso administrativo

Este patch torna a autorização administrativa revogável no Firestore, no Storage e na API. Aplica-se depois de `dev-server-security.patch`, sobre a estrutura atual com App Check, IA e Correios. Não muda os fluxos de artes personalizadas nem seus limites de upload.

## Aplicar e verificar localmente

Na raiz do repositório, onde está `package.json`:

```bash
git apply --check admin-revocation.patch
git apply admin-revocation.patch
npm ci
npm run lint
npm test
npm run test:rules
npm run build
npm run test:smoke
npm run test:server-security
npm run test:e2e
```

Use Node 22, npm 12.2.1 e Java 21. Os testes de regras iniciam Auth, Firestore e Storage locais com o projeto fictício `demo-gb-grafica-rules`. Não apontam para produção. O Chromium do Playwright precisa estar instalado para a suíte de navegador.

## Como funciona

Além do papel/claim, as regras consultam um registro `_adminAccess/{uid}` que somente o servidor pode alterar. O registro contém versão do formato, estado habilitado e uma época de autorização. O navegador pode observar apenas seu registro no banco da loja.

| Local | Autoridade consultada |
| --- | --- |
| Firestore e API | `_adminAccess/{uid}` no banco configurado da loja |
| Storage | `_adminAccess/{uid}` no Firestore `(default)` |

O Storage só consegue consultar o Firestore `(default)`. Por isso, o comando mantém uma cópia do registro ali. O banco nomeado da loja continua sendo usado para catálogo, pedidos e perfis; esses dados não são movidos.

Admins existentes são migrados para uma autorização `legacy`, compatível com seus tokens atuais. Cada concessão posterior gera uma nova época aleatória, registrada também na claim `gbAdminEpoch`. Retirar e devolver o papel não torna o token anterior válido novamente. Uma revogação deixa registros desabilitados; a migração não reativa esses registros.

## Preparação obrigatória antes do deploy

**Não publique as novas regras ou a aplicação antes de preparar os registros dos Admins atuais.** Sem registro válido, o acesso administrativo é negado. A leitura pública da loja continua pública.

1. Confira que a conta de serviço, o app e o projeto selecionado na CLI são os mesmos. Use as credenciais de servidor já configuradas no `.env`; não coloque chaves em variáveis `VITE_`.
2. No Firebase, verifique se existe o banco Firestore `(default)`. Se não existir, o responsável pelo projeto precisa criá-lo em modo nativo, com regras fechadas. O patch e os scripts não criam bancos ou alteram IAM.
3. Proteja a coleção `_adminAccess` do banco `(default)` contra **qualquer gravação por clientes**, incluindo Admins autenticados. A API Admin do servidor usa IAM e continua podendo gravar.

Para um `(default)` **novo/vazio e dedicado a esse controle**, há um template fechado em `firestore-admin-access.rules` e uma configuração separada `firebase.admin-access.json`:

```bash
npx firebase deploy --config firebase.admin-access.json --only firestore:rules --project SEU_PROJECT_ID
```

Se o `(default)` já atende outros dados/aplicativos, preserve e ajuste suas regras existentes. **Não use o template fechado para sobrescrevê-las.** Uma regra `allow ...: if false` específica não cancela uma permissão concedida por outro `match`: todas as permissões sobrepostas precisam excluir `_adminAccess`. A configuração principal `firebase.json` não foi ampliada para publicar regras nesse banco e sobrescrever políticas desconhecidas.

## Migrar os Admins atuais

Depois de proteger o `(default)`, com as credenciais de servidor já configuradas:

```bash
npm run admin:sync -- --dry-run
```

O plano lista os usuários que já têm a claim administrativa ou o papel legado. Conta sem usuário correspondente no Auth é informada e ignorada. O comando é somente leitura por padrão, não concede Admin a usuários comuns e detecta divergências entre as cópias antes de começar a migração.

Para executar o plano:

```bash
npm run admin:sync -- --apply
npm run admin:sync -- --dry-run
```

Contas ativas já migradas devem aparecer como `unchanged`. `blocked` preserva um bloqueio ou impede uma conta desativada/sem papel atual de ser habilitada. Se houver erro ou cópias divergentes, resolva-o antes de publicar as regras. Não apague os registros desabilitados para repetir a migração.

## Publicar as proteções

Com a migração concluída:

```bash
npx firebase deploy --only firestore:rules,storage --project SEU_PROJECT_ID
```

O `firebase.json` existente seleciona o banco nomeado da loja. Confira no Console a publicação nesse banco e no bucket correto. Ao publicar regras de Storage com consultas ao Firestore pela primeira vez, o Firebase pode solicitar permissão para conectar os dois produtos, usando o papel `roles/firebaserules.firestoreServiceAgent`. Se sua conta não puder concedê-lo, o responsável pelo IAM do projeto precisa habilitar essa conexão.

Depois, publique frontend e API pelo fluxo habitual da Vercel. Não há nova variável de ambiente obrigatória. Não houve deploy ou mudança em contas reais durante a preparação deste patch.

## Conceder e revogar

O comando de concessão mantém a sintaxe anterior:

```bash
npm run admin:set -- --email pessoa@exemplo.com
```

O usuário deve sair e entrar novamente para obter a claim/época atualizada. A renovação automática normal do token não desmonta o painel nem descarta edições enquanto a autorização continua válida.

Para retirar o privilégio:

```bash
npm run admin:set -- --email pessoa@exemplo.com --revoke
```

O comando bloqueia os registros nos dois bancos, remove a claim e o papel legado, preserva claims não relacionadas e chama a revogação de refresh tokens. Os demais Admins mantêm suas permissões. O navegador observa o bloqueio, retira o acesso ao painel e limpa a lista administrativa de pedidos em memória.

É possível conferir a intenção sem alteração:

```bash
npm run admin:set -- --email pessoa@exemplo.com --revoke --dry-run
```

Por e-mail, esse dry-run confirma a conta; por UID, mostra somente o alvo informado. Ele também mostra os bancos alvos, não simula gravações nem garante que IAM permita executá-las. Se uma etapa real falhar, o comando tenta as outras etapas de revogação, termina com código diferente de zero e identifica o que falta. Repita `--revoke` depois de corrigir a causa. Não trate resultado parcial como revogação concluída.

Se a conta já foi excluída do Auth, bloqueie os registros pelo UID conhecido:

```bash
npm run admin:set -- --uid UID_DO_USUARIO --revoke
```

Esse formato é exclusivo da revogação; não cria usuários nem concede Admin por UID.

Use esse comando para retirar Admin **antes** de desativar ou excluir uma conta no Console. Alterações manuais apenas em claims/roles ou no estado do Auth não atualizam automaticamente os dois registros. Este patch não instala gatilhos para observar alterações externas.

## Limites e recuperação

- A garantia vale para novas operações administrativas depois da revogação concluída. Dados já recebidos e operações aceitas antes disso não podem ser retirados retroativamente.
- A conta continua sendo um usuário comum. Os direitos próprios de cliente não são substituídos por uma política de bloqueio total da conta.
- Registros ausentes, desabilitados, inválidos ou com época incompatível negam Admin. A API também verifica o token com revogação e a claim atual no Auth. Falha ao consultar a autorização retorna erro controlado.
- As consultas do Storage ao Firestore contam como leituras desse banco. O registro não contém senha, token de acesso ou chave privada.
- Uma falha de concessão não pode reativar uma época mais nova bloqueada por uma revogação concorrente. Operações incompletas são informadas para correção; não há transação única envolvendo Auth e dois bancos.

Antes da publicação, mantenha o commit anterior para reversão do código da aplicação. Se precisar reverter frontend/API, preserve as regras endurecidas e os registros: as regras anteriores que aceitavam apenas a claim podem voltar a autorizar tokens antigos. Não remova o controle das regras para contornar um erro de migração; corrija o registro, a configuração do banco ou a conexão IAM indicada no erro.

Mensagem sugerida de commit:

```text
fix(security): revoke admin access across Firebase services
```

Referências primárias: [claims e propagação](https://firebase.google.com/docs/auth/admin/custom-claims), [revogação de sessões](https://firebase.google.com/docs/auth/admin/manage-sessions), [Storage e consultas ao Firestore](https://firebase.google.com/docs/storage/security/rules-conditions#enhance_with_cloud_firestore), [publicação de regras](https://firebase.google.com/docs/rules/manage-deploy).


## Validação desta entrega

| Verificação local | Resultado |
| --- | --- |
| Instalação limpa | `npm ci` aprovado com Node 22.23.4/npm 12.2.1 |
| Tipagem | `npm run lint` aprovado |
| Unitários/HTTP | 291 testes aprovados |
| Auth/Firestore/Storage emulados | 43 testes aprovados |
| Build de produção | Aprovado |
| Smoke de produção | Saúde, contrato da API, rotas públicas, robots e sitemap aprovados |
| Regressão do servidor local | 13 testes aprovados |
| Navegador | Suíte existente de 30 fluxos simulados aprovada |
| Auditoria de dependências | 0 alertas |

São 377 testes aprovados no conjunto. As regressões novas exercitam o comando real de migração/concessão/revogação contra emuladores, incluindo banco nomeado, cópia padrão, token congelado, Admin preservado, retirada/devolução do papel e conta excluída do Auth. Também cobrem registros inacessíveis/ausentes, falhas parciais, proteção contra reativação concorrente, indisponibilidade da autorização na API e cancelamento de observadores de sessões antigas no cliente.

O emulador é iniciado com uma única política Firestore comum para exercitar os bancos nomeado e padrão. O template privado do padrão é carregado e testado separadamente. Os emuladores não comprovam IAM nem a publicação de políticas independentes em produção. Os fluxos do navegador continuam usando a simulação existente; a observação de revogação do cliente é testada no módulo compartilhado de autorização.

O build mantém o aviso existente de chunks acima de 500 kB. Não houve alteração de dependências, compras, chamadas pagas de IA, deploy ou mudanças em contas reais. Todas as contas e arquivos usados na integração são fictícios e locais.
