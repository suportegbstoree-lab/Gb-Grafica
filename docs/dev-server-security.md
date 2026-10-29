# Proteção do servidor local

Esta alteração fecha o bloco de exposição do servidor de desenvolvimento. Não modifica os mecanismos de autenticação da loja, regras Firebase, permissões da conta de serviço, integração dos Correios ou fluxo do PagBank. Também não publica alterações em contas externas.

## Rodar localmente

```bash
npm ci
npm run dev
```

O servidor escuta em `127.0.0.1:3000`. Use `http://127.0.0.1:3000` ou `http://localhost:3000`. É possível escolher porta com `npm run dev -- --port 3100` ou host loopback com `--host ::1`.

`npm run dev` seleciona desenvolvimento explicitamente. `npm start` seleciona produção. A execução direta de `server.ts` sem modo/ambiente usa produção. `NODE_ENV=production` e `NODE_ENV=staging` usam produção; `NODE_ENV=development` habilita desenvolvimento. Valores desconhecidos, portas inválidas, argumentos repetidos ou conflito entre `--mode` e `NODE_ENV` causam erro antes da inicialização. A interface dos argumentos permanece em inglês.

## Túnel ou rede local

Para um túnel que encaminha para `http://127.0.0.1:3000`, configure no `.env`:

```dotenv
DEV_SERVER_ALLOW_NETWORK=true
VITE_ALLOWED_HOSTS=nome-exato-do-seu-tunel.trycloudflare.com
APP_URL=https://nome-exato-do-seu-tunel.trycloudflare.com
```

Reinicie o servidor após alterar o endereço do túnel. A lista aceita nomes/IPs exatos separados por vírgula, sem URL ou porta. Curingas, sufixos como `.trycloudflare.com` e `allowedHosts=true` não fazem parte da configuração suportada. `APP_URL` continua configurando URLs públicas e CORS da API, mas não é usado para autorizar hosts do servidor local. Host e Origin devem corresponder; o proxy precisa preservar esses valores.

Para LAN, informe o endereço de acesso exato e habilite a opção de rede. Exemplo de formato, substituindo pelo seu IP:

```dotenv
DEV_SERVER_ALLOW_NETWORK=true
VITE_ALLOWED_HOSTS=192.168.1.20
APP_URL=http://192.168.1.20:3000
```

```bash
npm run dev -- --host 0.0.0.0
```

A opção de rede não remove a proteção dos arquivos nem a autenticação/App Check das APIs. Sem ela, binds em endereços externos ou `0.0.0.0` são rejeitados. O nome `terminal.local` não é autorizado automaticamente; se necessário, cadastre-o como host exato e habilite a opção de rede.

## Arquivos disponíveis ao navegador

O código cliente em `src/`, as dependências necessárias em `node_modules/`, `index.html`, a configuração pública do SDK Firebase e os recursos públicos são acessíveis conforme seu uso pelo frontend. Arquivos do frontend são públicos por natureza: credenciais não devem ser colocadas nesses módulos.

Se `node_modules` for um link simbólico, apenas o destino declarado das dependências também é autorizado. Isso mantém os módulos do Vite funcionais sem liberar o projeto ou a pasta que contém essas dependências.

Na primeira execução, requisições a módulos JavaScript do cache conhecido de dependências podem aguardar a geração pelo próprio Vite. Essa permissão não vale para arquivos ausentes arbitrários e continua verificando o destino real dos diretórios, inclusive links externos.

Ficam bloqueados `server.ts`, `src/server/`, scripts, testes, metadados do repositório, certificados, arquivos de segredo/credenciais, backups e arquivos compactados. A decisão considera o caminho decodificado e o destino real dos links simbólicos. Consultas como `?raw`, `?url`, `?import` e `/@fs/` não ampliam as permissões. Uma verificação no carregamento de módulos também impede que imports comuns de arquivos privados produzam um bundle para o navegador.

O diretório `public/` é examinado antes de iniciar o Vite ou construir o site. Ele aceita imagens, fontes, CSS, textos/XML públicos, webmanifest, PDFs e mídia. JSON arbitrário, fontes TypeScript, arquivos compactados, nomes de segredo e links simbólicos não são aceitos ali. A configuração pública `firebase-applet-config.json` continua permitida na raiz para o SDK, sem conter credenciais Admin. Arquivos privados não podem ser movidos para um diretório cliente como forma de armazenamento.

O endpoint `__open-in-editor` é bloqueado para impedir que uma requisição web abra arquivos no editor do computador. As mensagens de desenvolvimento continuam disponíveis; a abertura automática do editor pelo overlay deixa de funcionar.

## HMR e E2E

O Vite usa o servidor HTTP principal para atualizar módulos. Não abre um listener HMR independente em `24678`. Com `DISABLE_HMR=true`, o listener WebSocket também fica desligado. O mesmo controle de Host/Origin vale para upgrades WebSocket, incluindo o protocolo de ping do Vite.

`npm run dev:e2e` escuta sempre em loopback e mantém WebSocket desligado, mesmo quando a opção de rede está habilitada no ambiente. O modo `e2e` permite apenas os módulos cliente de teste necessários, incluindo a fixture isolada de App Check. Fora desse modo, esses arquivos não são servidos. O Vite aquece os módulos da fixture; as expectativas do Playwright toleram até 15 segundos de inicialização a frio.

Um build com `VITE_E2E_MODE=true` é recusado. A entrada da aplicação exige desenvolvimento e modo `e2e` para montar a interface simulada. Assim, configurações de testes não são uma forma suportada de publicar a loja.

## Produção e preview

```bash
npm run build
npm start
```

Produção serve somente arquivos de `dist/` e as rotas reais da API. Sem `dist/index.html`, o processo não inicia. Vite não é importado nesse caminho e requisições a fontes, módulos de desenvolvimento, arquivos privados ou links para fora de `dist/` não são entregues. O bind de produção continua em `0.0.0.0`, adequado ao ambiente de hospedagem.

`npm run preview` recebe a proteção de arquivos/hosts e usa loopback por padrão. Continua sendo uma ferramenta de conferência local do build; não substitui o servidor de produção.

Na Vercel, a API continua usando o ponto de entrada existente e o frontend continua vindo do build. Não é necessário cadastrar novas variáveis na Vercel para esta correção. Nunca habilite a opção de rede do desenvolvimento como forma de servir produção.

## Verificar

```bash
npm run lint
npm test
npm run build
npm run test:smoke
npm run test:server-security
npm run test:e2e
```

Instale o Chromium do Playwright caso ainda não esteja disponível. A CI executa a regressão do servidor depois de construir o site, antes dos testes de navegador.

Os testes usam marcadores fictícios e arquivos temporários; não precisam de credenciais nem fazem pagamentos. Verificam arquivos privados por HTTP, caminhos codificados, links simbólicos, Host/Origin, WebSocket, CLI do Vite, preview, falhas de configuração, impedimento de build E2E e HMR real no navegador. Execute essa suíte numa cópia de trabalho de teste, sem editar o projeto durante sua execução: os testes criam e removem arquivos com nomes únicos para exercitar os bloqueios.

Referências: [opções do servidor Vite 6](https://v6.vite.dev/config/server-options), [preview do Vite 6](https://v6.vite.dev/guide/static-deploy), [advisories oficiais](https://github.com/vitejs/vite/security/advisories). A implementação foi conferida com o Vite 6.4.5 do lockfile.
