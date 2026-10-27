# Validação do envio de artes em partes

Esta é uma implementação para validação gradual. Ela não ativa proteção por si só: por padrão a loja continua usando o upload direto e as regras atuais ainda o autorizam. Não considerar a cota como efetiva até que o novo fluxo seja validado e a criação direta seja bloqueada em uma implantação separada.

## Preparação

- A API usa `ARTWORK_UPLOAD_RELAY_MODE=enabled`; o frontend usa `VITE_ARTWORK_UPLOAD_RELAY_MODE=enabled` no momento do build. Se ausentes, o fluxo existente permanece em uso. Os valores devem ser configurados no mesmo ambiente de teste; uma configuração inválida no frontend interrompe o envio com erro, em vez de voltar silenciosamente ao modo direto.
- O backend usa o Firebase Admin, o Firestore nomeado configurado e o bucket já usados pelo projeto. Nenhuma nova chave é necessária. A conta precisa criar sessões de upload e ler os metadados dos objetos.
- A cota experimental autoriza no máximo 100 arquivos e 512 MiB por conta em uma janela fixa de uma hora, além de limites de requisições já aplicados à API. A reserva é consumida mesmo que o envio falhe. Não é uma cota de armazenamento acumulado nem um limite global; usuários com múltiplas contas podem ter múltiplas cotas. Antes da ativação definitiva, ajuste esses limites conforme os dados reais.
- A URI de sessão fica apenas no Firestore, nas coleções privadas `_artworkUploadSessions` e `_artworkUploadBudgets`; as regras atuais negam acesso aos clientes por padrão. A URI é removida da sessão concluída. Não imprima URIs, tokens nem credenciais em logs.
- Os documentos têm o campo `cleanupAt`. Antes da ativação definitiva, configure políticas TTL nesse campo para ambas as coleções no Firestore **do banco nomeado**. O TTL é assíncrono, gera operações de exclusão e não cancela uma sessão de upload pendente no Cloud Storage. Sem TTL, esses documentos permanecem até uma limpeza administrativa. Não modificar regras globais nem apagar pedidos ou artes pendentes ao configurar isso.
- Confira o tempo máximo das Functions no projeto Vercel: cada parte pode aguardar respostas do Storage. As configurações dependem do plano e do Fluid Compute; não foi alterado `maxDuration` pelo patch.

## Teste e ativação

1. Execute os testes locais. Configure os dois indicadores apenas em um ambiente de validação, com App Check conforme a configuração existente. O valor `VITE_` precisa estar presente no build; variáveis de servidor não entram automaticamente no navegador.
2. Teste upload e checkout com PDF, JPG, PNG e WebP, arquivos pequenos e de 15 MiB, modelos de personalização, remoção e falhas de rede. O conteúdo segue para o Storage em partes de até 2 MiB por requisição; o corpo JSON fica abaixo do limite das Functions da Vercel. O uso de funções, tráfego e latência pode aumentar.
3. Enquanto as regras atuais permitirem `create` diretamente em `artworks/{uid}/pending`, o limite poderá ser contornado. Depois de validar o novo fluxo no ambiente real, faça uma mudança separada nas regras para negar apenas essa criação direta. Preserve leitura e remoção do proprietário, os objetos antigos e as regras de catálogo. Verifique a publicação das regras e o novo fluxo novamente.
4. Para reverter após restringir as regras, restaure primeiro a regra anterior de criação direta e confirme sua publicação; só depois volte os indicadores para o modo anterior. Requisições em andamento podem precisar ser refeitas.

O CORS do bucket não precisa ser alterado para o envio em partes através da API da loja. A conclusão em produção depende de validar também as origens da API e o funcionamento do App Check nos clientes reais.
