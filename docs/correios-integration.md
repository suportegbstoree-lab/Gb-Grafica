# Integração de frete com os Correios

Preço e prazo nacionais de PAC/SEDEX por contrato, consultados no backend. O checkout consulta novamente antes de criar pedido ou pagamento. Não existe fallback para a antiga tabela regional de R$ 18,50/R$ 35,90.

## Aplicar

Base: projeto fornecido em 27/10/2026, com os patches de App Check e IA administrativa já aplicados. Na raiz do seu repositório:

```bash
git apply --check /caminho/correios-integration.patch
git apply /caminho/correios-integration.patch
npm ci
npm run lint
npm test
npm run build
```

Se a verificação indicar conflito, não force a aplicação nem copie arquivos sobre alterações locais. O pacote inclui os arquivos alterados para comparação. Não aplique os patches anteriores novamente.

## Usar o token atual

Localmente, acrescente ao `.env` usado pelo servidor. Na Vercel, configure as Environment Variables nos ambientes desejados e faça novo deploy. Nunca use prefixo `VITE_` nestas variáveis.

```dotenv
CORREIOS_ENV=production
CORREIOS_TOKEN=COLE_AQUI_O_TOKEN_GERADO_NO_CWS
CORREIOS_ORIGIN_CEP=SEU_CEP_DE_POSTAGEM_COM_8_DIGITOS
CORREIOS_SERVICES=CODIGO_PAC:PAC,CODIGO_SEDEX:SEDEX
```

Substitua todos os placeholders. O token pode ter o prefixo `Bearer ` ou ser apenas o valor. Use token autorizado pelo **cartão de postagem** da empresa. Para token de homologação, configure `CORREIOS_ENV=homologation`.

Serviços são códigos de encomenda (`coProduto`) liberados no seu contrato. Exemplo de formato: `03298:PAC,03220:SEDEX`, **somente se esses forem seus códigos autorizados**. Os números 38202 e 38210 identificam a contratação das APIs e não são os códigos PAC/SEDEX enviados na cotação. Pode configurar apenas um serviço.

Um token colado manualmente funciona até expirar. Depois disso, a loja apresenta erro controlado e exige substituição do token; não cobra um valor fictício.

## Renovação automática

Para dispensar trocas manuais, preencha os três campos:

```dotenv
CORREIOS_USER=USUARIO_DO_MEU_CORREIOS
CORREIOS_ACCESS_CODE=CODIGO_DE_ACESSO_AS_APIS_GERADO_NO_CWS
CORREIOS_POSTING_CARD=NUMERO_DO_CARTAO_DE_POSTAGEM
# Opcionais na autenticação por cartão:
CORREIOS_CONTRACT=
CORREIOS_REGIONAL=
```

Mantenha ambiente, origem e serviços. **O código de acesso não é o token Bearer nem a senha de login do portal.** Credenciais completas têm prioridade sobre `CORREIOS_TOKEN`, que pode ser removido quando não for mais necessário.

O backend gera tokens por `/token/v1/autentica/cartaopostagem`, mantém em memória até perto do vencimento, compartilha emissões simultâneas na mesma instância e renova uma vez após HTTP 401. Instâncias distintas da Vercel têm caches independentes; reinícios podem exigir nova emissão. Tokens não são salvos no Firestore, navegador ou logs.

## Peso e embalagem no painel

Abra cada produto e use **Peso e embalagem para os Correios**:

- **Peso por unidade vendida (g):** conteúdo de uma unidade do carrinho. Se a variação vende um lote de 100 cartões, informe o peso do lote inteiro.
- **Peso da embalagem vazia (g):** caixa e toda a proteção.
- **Comprimento, largura e altura externos (cm):** embalagem pronta para postagem.
- **Unidades que cabem por volume:** capacidade física verificada por vocês. Use 1 quando cada unidade precisa de embalagem individual.

Exemplo ilustrativo: produto de 300 g, embalagem de 150 g, capacidade de 2 unidades e caixa de 25 × 20 × 15 cm. Um pedido de 3 unidades gera dois volumes: 750 g e 450 g, ambos com as medidas cadastradas. O preço é a soma das cotações reais dos volumes. Use dados físicos da sua operação, não os números do exemplo.

Em **Aplicar a**, selecione uma combinação de atributos para cadastrar embalagem específica. Sem perfil específico, a combinação utiliza o padrão do produto.

Produtos e combinações diferentes usam volumes separados. Linhas do mesmo produto/combinação são agrupadas pela capacidade cadastrada, inclusive com personalizações diferentes. O sistema não tenta encaixar produtos diferentes em uma caixa. Se vocês consolidarem tudo fisicamente depois, a cotação desta versão pode ser maior que o custo consolidado.

Esta versão trabalha com caixas/pacotes retangulares: até 30 kg por volume; comprimento mínimo de 11 cm, largura de 6 cm e altura de 0,4 cm; nenhum lado acima de 100 cm; soma de até 200 cm. O serviço e a rota podem impor restrições adicionais. Limite de 20 volumes por pedido. Produtos sem perfil não recebem frete automático; retirada continua funcionando.

## Validar sua conta sem compra

Conferência local, sem chamar os Correios nem imprimir credenciais:

```bash
npm run shipping:check
```

Cotação real de **um volume de teste**; troque CEP e medidas por dados válidos:

```bash
npm run shipping:check -- --quote --destination 01001000 --weight 750 --length 25 --width 20 --height 15
```

A consulta usa a origem configurada e retorna preço e prazo dos serviços disponíveis. Não cria etiqueta, postagem, pedido, checkout ou pagamento. Ela valida o acesso da conta; não testa o perfil físico do catálogo.

Depois cadastre um produto, adicione ao carrinho, calcule o frete e alterne entre os serviços. Alterar CEP, itens, opções ou quantidades invalida a cotação; ela também vence na interface após 10 minutos. Antes de abrir o PagBank, o backend relê os produtos, utiliza os perfis dessas mesmas leituras e consulta os Correios novamente. Se o preço mudar, exige novo cálculo e revisão do total.

O prazo é de transporte, em dias úteis após postagem, separado da produção configurada na loja. Não se promete data contada a partir da compra. Quando a API não oferece entrega domiciliar, o carrinho avisa sobre possível retirada em agência.

## Erros e operação

| Código | Ação |
| --- | --- |
| `CORREIOS_CONFIGURATION` | Confira origem, códigos e token ou credenciais completas. |
| `CORREIOS_TOKEN_EXPIRED` | Troque o token temporário ou configure renovação automática. |
| `CORREIOS_ACCESS_DENIED` | Confira ambiente, cartão, credenciais e APIs autorizadas. |
| `CORREIOS_UNAVAILABLE` / `CORREIOS_TIMEOUT` | Aguarde e tente novamente; não há preço de fallback. |
| `SHIPPING_PRODUCT_NOT_CONFIGURED` | Cadastre peso e embalagem do produto/combinação. |
| `SHIPPING_UNAVAILABLE` | Nenhum serviço retornou preço e prazo para todos os volumes. |
| `SHIPPING_TOO_MANY_PARCELS` | Combine o envio com a loja; esta implementação aceita até 20 volumes. |
| `SHIPPING_QUOTE_CHANGED` | Recalcule e confira o total antes de pagar. |

O pedido registra serviço, código, preço, prazo da cotação, origem, destino e volumes. O painel mostra os dados para preparação. O PagBank recebe frete `FIXED`, com valor recalculado e serviço escolhido; ele não calcula o frete desta integração.

App Check e os limites de requisição existentes continuam conforme sua configuração. A API não confia em peso ou preço enviados pelo navegador. As requisições aos Correios têm destinos fixos, redirecionamentos bloqueados e espera limitada. Respostas brutas e credenciais não são devolvidas ao cliente. A função `api/index.ts` passa a ter duração máxima de 60 s na Vercel, incluindo recotação e checkout.

Esta entrega não emite etiquetas, pré-postagens, seguro com valor declarado, AR, logística reversa ou rastreamento. Nenhuma conta ou configuração externa foi alterada, e nenhum deploy foi feito. A cotação da sua conta precisa ser validada pelo comando acima: suas credenciais não foram fornecidas neste ambiente.

## Referências

Esquemas públicos consultados em 29/10/2026. Os caminhos confirmados das operações são `/v1`; `/v3/api-docs` é a URL dos documentos OpenAPI:

- [Token OpenAPI](https://api.correios.com.br/token/v3/api-docs)
- [Preço OpenAPI](https://api.correios.com.br/preco/v3/api-docs)
- [Prazo OpenAPI](https://api.correios.com.br/prazo/v3/api-docs)
- [Manual CWS](https://www.correios.com.br/atendimento/developers/manuais/correioswebservice)
- [API Preço](https://www.correios.com.br/atendimento/developers/manuais/manual-api-preco-1)
- [API Prazo](https://www.correios.com.br/atendimento/developers/manuais/manual-api-prazo)
- [Encomendas: formatos e limites](https://www.correios.com.br/enviar/encomendas/nacional)
- [Checkout PagBank](https://developer.pagbank.com.br/reference/objeto-checkout)

Commit sugerido: `feat(shipping): integrate Correios quotes and validate freight at checkout`.
