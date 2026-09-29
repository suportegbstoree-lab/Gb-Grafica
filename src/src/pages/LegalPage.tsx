import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, FileText, ShieldCheck } from 'lucide-react';
import { Link } from 'react-router-dom';
import type { SiteConfig } from '../types';
import {
  LEGAL_EFFECTIVE_DATE,
  LEGAL_ROUTES,
  type LegalDocumentId,
  missingLegalBusinessFields,
} from '../lib/legal';
import { DEFAULT_LOGO_URL, resolvePublicImage, usePageMetadata } from '../lib/seo';

interface LegalPageProps {
  documentId: LegalDocumentId;
  config: SiteConfig;
}

interface LegalSection {
  title: string;
  content: ReactNode;
}

interface LegalDocument {
  title: string;
  description: string;
  sections: LegalSection[];
}

const DOCUMENT_LABELS: Record<LegalDocumentId, string> = {
  about: 'Sobre nós',
  privacy: 'Política de Privacidade',
  terms: 'Termos de Uso',
  exchanges: 'Trocas e reembolsos',
  production: 'Prazos de produção',
  artwork: 'Artes personalizadas',
  lgpd: 'LGPD e seus direitos',
};

const MISSING_FIELD_LABELS: Record<string, string> = {
  razao_social: 'razão social',
  documento_fiscal: 'CNPJ ou CPF do fornecedor',
  endereco_comercial: 'endereço comercial',
  email_atendimento: 'e-mail de atendimento',
  email_privacidade: 'e-mail de privacidade',
  prazo_producao: 'prazo padrão de produção',
};

function valueOrPending(value: string | undefined): string {
  return value?.trim() || 'A confirmar antes da publicação comercial';
}

function ExternalLegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className="font-bold text-pink-600 hover:underline">
      {children}
    </a>
  );
}

function buildDocument(documentId: LegalDocumentId, config: SiteConfig): LegalDocument {
  const providerName = valueOrPending(config.razao_social);
  const taxId = valueOrPending(config.documento_fiscal);
  const address = valueOrPending(config.endereco_comercial);
  const serviceEmail = valueOrPending(config.email_atendimento);
  const privacyEmail = valueOrPending(config.email_privacidade || config.email_atendimento);
  const productionDeadline = valueOrPending(config.prazo_producao);

  const providerSection: LegalSection = {
    title: 'Identificação do fornecedor',
    content: (
      <dl className="grid gap-3 sm:grid-cols-[12rem_1fr]">
        <dt className="font-bold text-gray-900">Nome fantasia</dt><dd>GB Gráfica</dd>
        <dt className="font-bold text-gray-900">Razão social</dt><dd>{providerName}</dd>
        <dt className="font-bold text-gray-900">CNPJ ou CPF</dt><dd>{taxId}</dd>
        <dt className="font-bold text-gray-900">Endereço</dt><dd>{address}</dd>
        <dt className="font-bold text-gray-900">Atendimento</dt><dd>{serviceEmail}</dd>
        <dt className="font-bold text-gray-900">Privacidade e LGPD</dt><dd>{privacyEmail}</dd>
        <dt className="font-bold text-gray-900">Telefones</dt><dd>{config.telefone1} / {config.telefone2}</dd>
      </dl>
    ),
  };

  const documents: Record<LegalDocumentId, LegalDocument> = {
    about: {
      title: 'Sobre a GB Gráfica',
      description: 'Informações institucionais, identificação do fornecedor e canais oficiais de atendimento.',
      sections: [
        providerSection,
        {
          title: 'Nossa atividade',
          content: (
            <p>
              A GB Gráfica comercializa materiais gráficos, impressos e produtos personalizados. As características,
              opções de personalização, preço e disponibilidade de cada item são apresentados no catálogo e no resumo
              do carrinho antes da contratação.
            </p>
          ),
        },
        {
          title: 'Atendimento ao consumidor',
          content: (
            <div className="space-y-3">
              <p>
                Solicitações sobre pedidos, dúvidas, reclamações, cancelamentos e arrependimento podem ser encaminhadas
                pelos telefones exibidos nesta página ou pelo e-mail {serviceEmail}.
              </p>
              <p>O recebimento da solicitação deve ser confirmado e a resposta será encaminhada em até cinco dias.</p>
            </div>
          ),
        },
      ],
    },
    privacy: {
      title: 'Política de Privacidade',
      description: 'Como a GB Gráfica coleta, utiliza, compartilha, protege e elimina dados pessoais.',
      sections: [
        providerSection,
        {
          title: 'Dados tratados',
          content: (
            <ul className="list-disc space-y-2 pl-5">
              <li>dados da conta Google, como identificador, nome, e-mail e fotografia de perfil;</li>
              <li>nome, CPF, telefone e endereço informados para compra, entrega e faturamento;</li>
              <li>itens do pedido, personalizações, histórico de pagamento e andamento da produção;</li>
              <li>arquivos de arte, nomes de arquivo e metadados necessários à produção;</li>
              <li>registros técnicos de acesso, segurança, prevenção a fraude, rate limit e funcionamento da aplicação;</li>
              <li>mensagens e solicitações enviadas aos canais de atendimento.</li>
            </ul>
          ),
        },
        {
          title: 'Finalidades e bases legais',
          content: (
            <div className="space-y-3">
              <p>
                Os dados são tratados para autenticar a conta, preparar e executar o pedido, processar pagamento,
                entregar ou disponibilizar o produto, atender o consumidor, cumprir obrigações legais e exercer
                regularmente direitos em processos administrativos ou judiciais.
              </p>
              <p>
                Também podem ser usados, no limite necessário, para segurança, prevenção a fraude, diagnóstico de
                falhas e proteção da loja e de seus clientes. Consentimento será solicitado separadamente quando ele
                for a base legal adequada, sem autorizações genéricas ou presumidas.
              </p>
            </div>
          ),
        },
        {
          title: 'Compartilhamento e operadores',
          content: (
            <div className="space-y-3">
              <p>Dados podem ser compartilhados somente na medida necessária com:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Google Firebase, para autenticação, banco de dados e armazenamento privado de artes;</li>
                <li>Vercel, para hospedagem e execução da aplicação;</li>
                <li>PagBank, para criação, processamento e confirmação do pagamento;</li>
                <li>transportadoras ou serviços de frete, quando houver entrega;</li>
                <li>autoridades públicas, quando houver obrigação legal ou ordem válida.</li>
              </ul>
              <p>
                A GB Gráfica não recebe nem armazena o número completo do cartão. Esses dados são fornecidos diretamente
                ao ambiente hospedado do PagBank.
              </p>
            </div>
          ),
        },
        {
          title: 'Transferência internacional',
          content: (
            <p>
              Alguns fornecedores de tecnologia podem processar ou armazenar informações fora do Brasil. Nesses casos,
              serão adotadas medidas compatíveis com a LGPD e exigidas salvaguardas adequadas dos prestadores contratados.
            </p>
          ),
        },
        {
          title: 'Armazenamento local e tecnologias essenciais',
          content: (
            <p>
              O site utiliza armazenamento do navegador e tecnologias estritamente necessárias para manter sessão,
              autenticação, carrinho e segurança. Caso sejam adicionadas ferramentas de publicidade, perfilamento ou
              análise não essencial, esta política será atualizada e os controles de consentimento aplicáveis serão
              apresentados antes da ativação.
            </p>
          ),
        },
        {
          title: 'Retenção e eliminação',
          content: (
            <p>
              Os dados são conservados pelo período necessário à execução do pedido, atendimento, garantia, cumprimento
              de obrigações fiscais e defesa de direitos. Artes e registros técnicos não devem ser mantidos por prazo
              superior ao necessário à sua finalidade. Encerrado o tratamento, serão eliminados ou anonimizados, salvo
              quando a conservação for autorizada ou exigida por lei.
            </p>
          ),
        },
        {
          title: 'Segurança e incidentes',
          content: (
            <p>
              São adotados controles de autenticação, autorização, acesso restrito, links temporários e validações de
              arquivo. Nenhum sistema é absolutamente imune a incidentes; ocorrências relevantes serão tratadas e
              comunicadas aos titulares e à ANPD quando exigido pela legislação.
            </p>
          ),
        },
        {
          title: 'Direitos do titular',
          content: (
            <p>
              O titular pode solicitar confirmação do tratamento, acesso, correção, anonimização, bloqueio ou eliminação
              de dados inadequados, portabilidade quando regulamentada, informação sobre compartilhamentos, oposição e
              revogação do consentimento. Solicitações devem ser enviadas para {privacyEmail}.
            </p>
          ),
        },
      ],
    },
    terms: {
      title: 'Termos de Uso e Compra',
      description: 'Condições para utilização do site, personalização de produtos, pedidos, pagamento e entrega.',
      sections: [
        providerSection,
        {
          title: 'Aceitação e âmbito',
          content: (
            <p>
              Estes termos regem o uso do site e as compras realizadas junto à GB Gráfica. Antes de seguir para o
              pagamento, o cliente pode revisar os itens, quantidades, personalizações, entrega, valores e estes
              documentos. A aceitação é registrada com a versão vigente, sem afastar direitos assegurados por lei.
            </p>
          ),
        },
        {
          title: 'Conta e informações do cliente',
          content: (
            <p>
              O acesso aos pedidos utiliza autenticação Google. O cliente deve fornecer informações verdadeiras,
              atualizadas e suficientes para contato, pagamento e entrega, além de proteger o acesso à própria conta.
              Divergências devem ser comunicadas antes do início da produção.
            </p>
          ),
        },
        {
          title: 'Oferta, preço e formação do pedido',
          content: (
            <p>
              As características essenciais, combinações, quantidade e preço aparecem no catálogo e no carrinho. Frete
              e eventuais despesas adicionais devem ser apresentados separadamente antes do pagamento. O pedido é
              registrado após a solicitação de checkout e somente avança à produção depois da confirmação do pagamento
              e do recebimento de uma arte utilizável, quando aplicável.
            </p>
          ),
        },
        {
          title: 'Pagamento',
          content: (
            <p>
              O pagamento ocorre no checkout hospedado do PagBank, por uma das modalidades exibidas naquela página. A
              volta ao site não representa confirmação: o pedido é considerado pago somente após a notificação validada
              do PagBank. Tentativas recusadas, expiradas ou não concluídas não autorizam o início da produção.
            </p>
          ),
        },
        {
          title: 'Produtos e artes personalizadas',
          content: (
            <p>
              O cliente é responsável por revisar textos, nomes, datas, medidas, opções e arquivos enviados. Ao fornecer
              uma arte, declara possuir autorização para sua reprodução no pedido. A GB Gráfica poderá recusar conteúdo
              ilegal, discriminatório, ofensivo ou que aparente violar direitos de terceiros. Detalhes adicionais estão
              na <Link to={LEGAL_ROUTES.artwork} className="font-bold text-pink-600 hover:underline">Política de Artes Personalizadas</Link>.
            </p>
          ),
        },
        {
          title: 'Produção, retirada e entrega',
          content: (
            <div className="space-y-3">
              <p>Prazo padrão informado pela loja: <strong>{productionDeadline}</strong>.</p>
              <p>
                O prazo de produção é diferente do prazo de transporte. Ele começa após pagamento confirmado e, quando
                necessário, após recebimento ou aprovação da arte. A modalidade, o endereço e o valor de entrega são
                apresentados no carrinho. Pedidos de retirada serão disponibilizados no local e horário informados pelo
                atendimento.
              </p>
            </div>
          ),
        },
        {
          title: 'Cancelamento, arrependimento e problemas',
          content: (
            <p>
              Solicitações serão tratadas conforme o Código de Defesa do Consumidor e a política específica da loja.
              A personalização não implica renúncia automática ao direito de arrependimento nem limita a garantia legal
              por defeito, dano ou divergência. Consulte a <Link to={LEGAL_ROUTES.exchanges} className="font-bold text-pink-600 hover:underline">Política de Trocas, Cancelamentos e Reembolsos</Link>.
            </p>
          ),
        },
        {
          title: 'Responsabilidade e indisponibilidade',
          content: (
            <p>
              A loja adotará medidas razoáveis para manter o serviço disponível, mas poderá realizar manutenção ou
              enfrentar indisponibilidade de terceiros. Erros evidentes de catálogo serão corrigidos com comunicação ao
              consumidor e oferecimento das alternativas previstas na legislação, sem alteração unilateral prejudicial
              de pedido já confirmado.
            </p>
          ),
        },
        {
          title: 'Legislação e solução de conflitos',
          content: (
            <p>
              Aplicam-se as leis brasileiras, especialmente o Código de Defesa do Consumidor. Estes termos não impõem
              arbitragem obrigatória nem afastam o foro legalmente assegurado ao consumidor. O atendimento deve ser
              procurado primeiro quando isso puder resolver a demanda de forma rápida, sem impedir acesso aos órgãos de
              defesa do consumidor ou ao Poder Judiciário.
            </p>
          ),
        },
      ],
    },
    exchanges: {
      title: 'Política de Trocas, Cancelamentos e Reembolsos',
      description: 'Procedimentos para arrependimento, defeitos, divergências, cancelamentos e devolução de valores.',
      sections: [
        providerSection,
        {
          title: 'Como solicitar',
          content: (
            <p>
              Envie a solicitação para {serviceEmail} ou utilize um dos telefones informados nesta página. Informe o
              número do pedido e descreva o motivo. A loja confirmará imediatamente o recebimento e encaminhará resposta
              em até cinco dias, sem impedir providências urgentes exigidas pela legislação.
            </p>
          ),
        },
        {
          title: 'Direito de arrependimento',
          content: (
            <p>
              Nas compras feitas fora do estabelecimento comercial, o consumidor pode exercer o direito de
              arrependimento no prazo de sete dias contado da assinatura ou do recebimento do produto ou serviço. Os
              valores pagos serão devolvidos na forma e no prazo legais, sem custo ao consumidor, e a solicitação será
              comunicada imediatamente ao PagBank para cancelamento ou estorno.
            </p>
          ),
        },
        {
          title: 'Produtos personalizados',
          content: (
            <p>
              A fabricação sob encomenda pode impedir o reaproveitamento comercial do produto, mas isso não cria uma
              exclusão automática do direito de arrependimento previsto no CDC. Cada solicitação será analisada conforme
              o estágio do pedido e a legislação aplicável, sem cláusula de renúncia prévia a direitos do consumidor.
            </p>
          ),
        },
        {
          title: 'Defeito, dano ou divergência',
          content: (
            <div className="space-y-3">
              <p>
                Se o produto chegar danificado, com defeito de fabricação ou diferente da oferta ou personalização
                confirmada, comunique o atendimento assim que possível. Fotos podem ser solicitadas para agilizar o
                diagnóstico, sem serem usadas para impedir o exercício de um direito legal.
              </p>
              <p>
                A garantia legal segue os prazos do art. 26 do CDC: em regra, trinta dias para produtos não duráveis e
                noventa dias para produtos duráveis, conforme a natureza concreta do item, sem prejuízo das regras para
                vícios ocultos.
              </p>
            </div>
          ),
        },
        {
          title: 'Cancelamento antes da produção',
          content: (
            <p>
              Pedidos ainda não pagos podem ser abandonados ou cancelados. Para pedidos pagos cuja produção ainda não
              tenha começado, contate a loja imediatamente. O cancelamento e o reembolso serão processados observando o
              direito aplicável e o meio de pagamento utilizado.
            </p>
          ),
        },
        {
          title: 'Forma de reembolso',
          content: (
            <p>
              O reembolso será solicitado pelo mesmo meio de pagamento sempre que possível. O PagBank e a instituição
              financeira podem possuir prazos operacionais próprios para exibir o crédito ou estorno, que serão
              informados ao consumidor sem reduzir os direitos previstos em lei.
            </p>
          ),
        },
        {
          title: 'Contestação e chargeback',
          content: (
            <p>
              Uma contestação financeira poderá suspender a produção ou entrega enquanto o pagamento estiver sob
              análise. Isso não impede o consumidor de procurar a loja para resolver erro, fraude, cancelamento ou
              divergência diretamente pelos canais oficiais.
            </p>
          ),
        },
      ],
    },
    production: {
      title: 'Prazos de Produção e Entrega',
      description: 'Quando a produção começa, como o prazo é contado e a diferença entre fabricação e transporte.',
      sections: [
        providerSection,
        {
          title: 'Prazo padrão',
          content: (
            <p>
              Prazo padrão informado pela loja: <strong>{productionDeadline}</strong>. Quando um produto possuir prazo
              específico, prevalecerá a informação apresentada na oferta e no resumo do pedido antes do pagamento.
            </p>
          ),
        },
        {
          title: 'Início da contagem',
          content: (
            <p>
              A produção começa somente após a confirmação automática do pagamento e, para itens personalizados, depois
              do recebimento de arquivo utilizável e das informações necessárias. Se a loja solicitar correção ou
              aprovação, a contagem começa ou recomeça após a resposta do cliente, desde que isso seja comunicado de
              forma clara.
            </p>
          ),
        },
        {
          title: 'Dias úteis e pedidos com vários itens',
          content: (
            <p>
              Salvo indicação diferente na oferta, prazos em dias úteis não incluem sábados, domingos e feriados do local
              de produção. Em pedidos com vários produtos, a retirada ou postagem pode aguardar a conclusão do item de
              maior prazo, o que deve ser informado antes da contratação.
            </p>
          ),
        },
        {
          title: 'Entrega e retirada',
          content: (
            <p>
              O prazo de transporte é adicional ao prazo de produção e depende do CEP, serviço contratado e operação da
              transportadora. Para retirada, o cliente deve aguardar a confirmação de que o pedido está pronto. Pedido
              urgente somente será considerado quando houver confirmação expressa da loja antes do pagamento.
            </p>
          ),
        },
        {
          title: 'Atrasos e impossibilidade de cumprimento',
          content: (
            <p>
              Ocorrendo atraso relevante, a loja informará o consumidor e apresentará as alternativas legalmente
              cabíveis, incluindo cumprimento da oferta, produto equivalente aceito pelo cliente ou cancelamento com
              restituição quando aplicável. Eventos externos não autorizam alteração unilateral prejudicial da oferta.
            </p>
          ),
        },
      ],
    },
    artwork: {
      title: 'Política de Artes Personalizadas',
      description: 'Regras para envio, análise técnica, reprodução, armazenamento e responsabilidade sobre arquivos.',
      sections: [
        providerSection,
        {
          title: 'Formatos e envio',
          content: (
            <p>
              O site aceita PDF, PNG, JPG e WebP com até 15 MB por arquivo. O envio bem-sucedido não significa aprovação
              técnica automática. Arquivos corrompidos, ilegíveis, incompletos ou incompatíveis com o produto poderão ser
              devolvidos para correção antes do início da produção.
            </p>
          ),
        },
        {
          title: 'Conteúdo e autorização de reprodução',
          content: (
            <p>
              Ao enviar uma arte, o cliente declara que a criou, possui os direitos necessários ou recebeu autorização
              para sua reprodução no pedido. Concede à GB Gráfica autorização limitada para analisar, adaptar tecnicamente,
              imprimir, produzir e entregar aquele pedido, sem transferência de titularidade da obra.
            </p>
          ),
        },
        {
          title: 'Conteúdo recusado',
          content: (
            <p>
              A loja pode recusar material aparentemente ilegal, fraudulento, discriminatório, que exponha dados de
              terceiros sem autorização ou que viole marcas, direitos autorais, imagem ou outros direitos. Valores
              relativos a etapas não executadas serão tratados conforme a legislação e a política de cancelamento.
            </p>
          ),
        },
        {
          title: 'Conferência do cliente',
          content: (
            <p>
              Antes de finalizar, confira ortografia, nomes, datas, medidas, orientação, quantidade e versão do arquivo.
              Diferenças previsíveis entre tela e impressão podem ocorrer por resolução, perfil de cor, material e
              acabamento. Quando houver prova para aprovação, a produção seguirá a última versão expressamente aprovada,
              sem afastar responsabilidade por falha de fabricação ou divergência imputável à loja.
            </p>
          ),
        },
        {
          title: 'Privacidade e acesso',
          content: (
            <p>
              Artes são armazenadas em área privada. O cliente proprietário e administradores autorizados podem receber
              um link temporário para download. Os arquivos não devem ser usados para publicidade, portfólio ou finalidade
              diferente da execução do pedido sem uma autorização específica e separada.
            </p>
          ),
        },
        {
          title: 'Retenção',
          content: (
            <p>
              Os arquivos serão mantidos pelo tempo necessário à produção, atendimento, garantia e defesa de direitos,
              e depois eliminados ou anonimizados quando não houver outra base legal para conservação. O cliente pode
              solicitar informações ou eliminação pelo canal {privacyEmail}, observadas as obrigações legais da loja.
            </p>
          ),
        },
      ],
    },
    lgpd: {
      title: 'LGPD e Direitos do Titular',
      description: 'Canal para solicitações sobre dados pessoais e explicação dos direitos previstos na LGPD.',
      sections: [
        providerSection,
        {
          title: 'Controlador e canal de privacidade',
          content: (
            <p>
              O controlador dos dados tratados para operação da loja é {providerName}, inscrito sob {taxId}. Solicitações
              relacionadas à proteção de dados devem ser enviadas para {privacyEmail}. Se a empresa estiver enquadrada
              como agente de tratamento de pequeno porte, este canal também cumprirá a função de comunicação simplificada
              com titulares e com a ANPD, ainda que não haja encarregado formalmente indicado.
            </p>
          ),
        },
        {
          title: 'Direitos disponíveis',
          content: (
            <ul className="list-disc space-y-2 pl-5">
              <li>confirmação da existência de tratamento e acesso aos dados;</li>
              <li>correção de informações incompletas, inexatas ou desatualizadas;</li>
              <li>anonimização, bloqueio ou eliminação de dados desnecessários ou irregulares;</li>
              <li>portabilidade, quando aplicável e regulamentada;</li>
              <li>informação sobre entidades com as quais houve compartilhamento;</li>
              <li>informação sobre consentimento, consequências da negativa e possibilidade de revogação;</li>
              <li>oposição a tratamento realizado em desconformidade com a LGPD;</li>
              <li>peticionamento perante a ANPD e órgãos de defesa do consumidor.</li>
            </ul>
          ),
        },
        {
          title: 'Como exercer seus direitos',
          content: (
            <p>
              Envie a solicitação para {privacyEmail}, descrevendo o direito que pretende exercer. Para impedir acesso
              indevido, poderão ser solicitadas informações proporcionais para confirmar a identidade do requerente. A
              resposta explicará eventual impossibilidade de atendimento, inclusive quando a manutenção do dado for
              necessária para cumprir obrigação legal ou exercer direitos.
            </p>
          ),
        },
        {
          title: 'Informações completas',
          content: (
            <p>
              Categorias de dados, finalidades, compartilhamentos, transferência internacional, segurança e retenção são
              detalhados na <Link to={LEGAL_ROUTES.privacy} className="font-bold text-pink-600 hover:underline">Política de Privacidade</Link>.
            </p>
          ),
        },
      ],
    },
  };

  return documents[documentId];
}

export default function LegalPage({ documentId, config }: LegalPageProps) {
  const legalDocument = buildDocument(documentId, config);
  const missingFields = missingLegalBusinessFields(config);

  usePageMetadata({
    title: `${legalDocument.title} | GB Gráfica`,
    description: legalDocument.description,
    path: LEGAL_ROUTES[documentId],
    image: config.logo_url,
  });

  useEffect(() => {
    window.scrollTo({ top: 0, behavior: 'auto' });
  }, [documentId]);

  return (
    <div className="min-h-screen bg-[#fcfcfd] text-gray-800">
      <div className="h-2 bg-[#cf4784]" />
      <header className="border-b border-pink-100 bg-[#fffed8] px-4 py-6 md:px-10">
        <div className="mx-auto flex max-w-7xl items-center justify-between gap-4">
          <Link to="/" className="flex items-center gap-3 font-black tracking-tight text-gray-900">
            <img
              src={resolvePublicImage(config.logo_url || DEFAULT_LOGO_URL)}
              alt="GB Gráfica"
              className="h-12 w-28 object-contain object-left"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          </Link>
          <Link to="/" className="flex items-center gap-2 rounded-full bg-gray-900 px-5 py-3 text-xs font-black uppercase tracking-widest text-white transition-colors hover:bg-pink-500">
            <ArrowLeft size={15} /> Voltar à loja
          </Link>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-10 px-4 py-12 md:px-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:py-16">
        <aside>
          <nav aria-label="Documentos institucionais" className="sticky top-6 rounded-3xl border border-pink-100 bg-white p-4 shadow-sm">
            <div className="mb-3 flex items-center gap-2 px-3 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-pink-500">
              <FileText size={14} /> Institucional
            </div>
            <ul className="space-y-1">
              {(Object.keys(LEGAL_ROUTES) as LegalDocumentId[]).map(id => (
                <li key={id}>
                  <Link
                    to={LEGAL_ROUTES[id]}
                    aria-current={id === documentId ? 'page' : undefined}
                    className={`block rounded-xl px-3 py-2.5 text-sm font-bold transition-colors ${
                      id === documentId ? 'bg-pink-50 text-pink-600' : 'text-gray-500 hover:bg-gray-50 hover:text-gray-900'
                    }`}
                  >
                    {DOCUMENT_LABELS[id]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article className="min-w-0">
          <div className="mb-10">
            <div className="mb-4 inline-flex items-center gap-2 rounded-full bg-pink-50 px-4 py-2 text-[10px] font-black uppercase tracking-[0.2em] text-pink-600">
              <ShieldCheck size={14} /> Vigente desde {LEGAL_EFFECTIVE_DATE}
            </div>
            <h1 className="text-3xl font-black tracking-tight text-gray-950 md:text-5xl">{legalDocument.title}</h1>
            <p className="mt-4 max-w-3xl text-base leading-relaxed text-gray-500">{legalDocument.description}</p>
          </div>

          {missingFields.length > 0 && (
            <div role="alert" className="mb-8 rounded-2xl border border-amber-200 bg-amber-50 p-5 text-sm leading-relaxed text-amber-900">
              <div className="mb-2 flex items-center gap-2 font-black"><AlertTriangle size={18} /> Documento em preparação</div>
              <p>
                Este texto ainda não deve ser usado para contratação comercial. Faltam confirmar no painel: {' '}
                {missingFields.map(field => MISSING_FIELD_LABELS[field]).join(', ')}.
              </p>
            </div>
          )}

          <div className="space-y-6">
            {legalDocument.sections.map(section => (
              <section key={section.title} className="rounded-3xl border border-gray-100 bg-white p-6 shadow-sm md:p-8">
                <h2 className="mb-4 text-xl font-black tracking-tight text-gray-950">{section.title}</h2>
                <div className="text-sm leading-7 text-gray-600">{section.content}</div>
              </section>
            ))}
          </div>

          <section className="mt-8 rounded-3xl bg-gray-950 p-6 text-sm leading-7 text-gray-300 md:p-8">
            <h2 className="mb-3 text-lg font-black text-white">Referências legais</h2>
            <p>
              Estes documentos foram estruturados com base no {' '}
              <ExternalLegalLink href="https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm">Código de Defesa do Consumidor</ExternalLegalLink>, no {' '}
              <ExternalLegalLink href="https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm">Decreto do Comércio Eletrônico</ExternalLegalLink> e na {' '}
              <ExternalLegalLink href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm">Lei Geral de Proteção de Dados</ExternalLegalLink>.
              Em caso de conflito, prevalecem a legislação vigente e os direitos do consumidor.
            </p>
          </section>
        </article>
      </main>

      <footer className="border-t border-gray-100 bg-white px-4 py-8 text-center text-xs text-gray-400">
        © {new Date().getFullYear()} GB Gráfica. Todos os direitos reservados.
      </footer>
    </div>
  );
}
