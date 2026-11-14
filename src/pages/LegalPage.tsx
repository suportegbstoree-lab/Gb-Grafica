import { useEffect, type ReactNode } from 'react';
import { AlertTriangle, ArrowLeft, FileText } from 'lucide-react';
import { Link } from 'react-router-dom';
import { StoreThemeControl } from '../components/StoreTheme';
import type { SiteConfig } from '../types';
import { contactHref, storeContacts } from '../lib/storePresentation';
import {
  LEGAL_REVIEW_DATE,
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
  return value?.trim() || 'A confirmar com a loja';
}

function ExternalLegalLink({ href, children }: { href: string; children: ReactNode }) {
  return (
    <a href={href} target="_blank" rel="noopener noreferrer" className={inlineLink}>
      {children}
    </a>
  );
}

const inlineLink = 'break-words font-semibold text-[var(--legal-accent)] underline underline-offset-2 hover:decoration-2';
const panel = 'rounded-2xl border border-[var(--legal-border)] bg-[var(--legal-surface)]';
const reviewDate = new Intl.DateTimeFormat('pt-BR', { dateStyle: 'long', timeZone: 'UTC' })
  .format(new Date(LEGAL_REVIEW_DATE));

function EmailLink({ address, subject }: { address?: string; subject?: string }) {
  if (!address) return <>E-mail a confirmar no cadastro da loja</>;
  const mailto = `mailto:${encodeURIComponent(address).replace('%40', '@')}`;
  const query = subject ? `?subject=${encodeURIComponent(subject)}` : '';
  return <a className={inlineLink} href={mailto + query}>{address}</a>;
}

function buildDocument(documentId: LegalDocumentId, config: SiteConfig): LegalDocument {
  const providerName = valueOrPending(config.razao_social);
  const taxId = valueOrPending(config.documento_fiscal);
  const address = valueOrPending(config.endereco_comercial);
  const contacts = storeContacts(config);
  const serviceEmail = config.email_atendimento?.trim() || contacts.find(contact => contact.type === 'email')?.value;
  const privacyEmail = config.email_privacidade?.trim() || serviceEmail;
  const phoneContacts = contacts.filter(contact => contact.type !== 'email');
  const productionDeadline = valueOrPending(config.prazo_producao);

  const providerSection: LegalSection = {
    title: 'Identificação do fornecedor',
    content: (
      <dl className="space-y-3 [&_dd]:min-w-0 [&_dd]:break-words [&_dt]:font-bold [&_dt]:text-[var(--legal-text)]">
        <div className="grid gap-x-3 sm:grid-cols-[11rem_minmax(0,1fr)]"><dt>Nome fantasia</dt><dd>GB Gráfica</dd></div>
        <div className="grid gap-x-3 sm:grid-cols-[11rem_minmax(0,1fr)]"><dt>Razão social</dt><dd>{providerName}</dd></div>
        <div className="grid gap-x-3 sm:grid-cols-[11rem_minmax(0,1fr)]"><dt>CNPJ ou CPF</dt><dd>{taxId}</dd></div>
        <div className="grid gap-x-3 sm:grid-cols-[11rem_minmax(0,1fr)]"><dt>Endereço</dt><dd>{address}</dd></div>
        <div className="grid gap-x-3 sm:grid-cols-[11rem_minmax(0,1fr)]"><dt>Atendimento</dt><dd><EmailLink address={serviceEmail} /></dd></div>
        <div className="grid gap-x-3 sm:grid-cols-[11rem_minmax(0,1fr)]"><dt>Privacidade e LGPD</dt><dd><EmailLink address={privacyEmail} /></dd></div>
        {phoneContacts.length > 0 && <div className="grid gap-x-3 sm:grid-cols-[11rem_minmax(0,1fr)]">
          <dt>Telefones e WhatsApp</dt>
          <dd><ul>{phoneContacts.map(contact => <li key={contact.id}>
            <a className={inlineLink} href={contactHref(contact)}>{contact.label} · {contact.value}</a>
          </li>)}</ul></dd>
        </div>}
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
                pelos canais exibidos nesta página. Para falar sobre uma compra, tenha o número do pedido em mãos.
              </p>
              <p>A loja confirma o recebimento pelo mesmo canal e responde em até cinco dias.</p>
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
              <li>nome, CPF do pagador, telefone e endereço para compra, entrega e faturamento, além do CPF ou CNPJ do destinatário quando necessário para expedir o pedido;</li>
              <li>itens do pedido, personalizações, histórico de pagamento e andamento da produção;</li>
              <li>arquivos de arte, nomes de arquivo e metadados necessários à produção;</li>
              <li>registros técnicos de acesso, segurança, prevenção a fraude e funcionamento do site;</li>
              <li>mensagens e solicitações enviadas aos canais de atendimento;</li>
              <li>preferências de e-mail e registros de autorização ou descadastro de mensagens opcionais;</li>
              <li>nota, comentário e nome exibido nas avaliações de produtos, se você optar por publicar uma avaliação.</li>
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
              <p>
                Avisos de boas-vindas, confirmação da compra e andamento de pedidos são enviados para apoiar o uso da
                conta e o atendimento da compra. Promoções e novidades são opcionais e dependem de autorização separada
                nas preferências de e-mail. Você pode retirar essa autorização pela loja ou pelo link de descadastro
                das mensagens, sem perder o acesso à conta ou aos avisos dos seus pedidos.
              </p>
            </div>
          ),
        },
        {
          title: 'Compartilhamento e operadores',
          content: (
            <div className="space-y-3">
              <p>Compartilhamos os dados necessários com os seguintes serviços, conforme a operação:</p>
              <ul className="list-disc space-y-2 pl-5">
                <li>Google, para autenticação, banco de dados e armazenamento de artes no Firebase e verificações de segurança do site;</li>
                <li>Vercel, para hospedagem e execução da aplicação;</li>
                <li>PagBank, para criação, processamento e confirmação do pagamento;</li>
                <li>Resend, para envio dos e-mails autorizados e dos avisos de conta e pedidos;</li>
                <li>ViaCEP, para consulta do endereço a partir do CEP;</li>
                <li>Melhor Envio, para cotação pelo CEP e dados dos volumes e, na entrega, emissão de etiqueta com dados do destinatário, do pedido e da nota fiscal. A transportadora recebe os dados necessários à entrega e ao rastreamento;</li>
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
              O site usa o armazenamento do navegador para manter a sessão, o carrinho, a referência do pedido durante
              o pagamento e a preferência de tema. A autenticação e a proteção contra abuso também usam tecnologias
              do navegador.
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
              Consulte <Link to={LEGAL_ROUTES.lgpd} className={inlineLink}>LGPD e Direitos do Titular</Link> para saber
              quais direitos você pode exercer. Envie sua solicitação para <EmailLink address={privacyEmail} subject="Solicitação de privacidade" />.
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
              e eventuais despesas adicionais são apresentados separadamente antes do pagamento. O carrinho mostra
              o desconto de um cupom aplicável e o total a pagar. O pedido é registrado ao finalizar a compra no site
              e avança à produção depois da confirmação do pagamento
              e do recebimento de uma arte utilizável, quando aplicável.
            </p>
          ),
        },
        {
          title: 'Pagamento',
          content: (
            <p>
              O pagamento ocorre no checkout hospedado do PagBank, por uma das modalidades exibidas naquela página. A
              loja confirma o pagamento com o PagBank e mostra a situação em Meus Pedidos. Tentativas recusadas,
              expiradas ou não concluídas não autorizam o início da produção.
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
              na <Link to={LEGAL_ROUTES.artwork} className={inlineLink}>Política de Artes Personalizadas</Link>.
            </p>
          ),
        },
        {
          title: 'Produção, retirada e entrega',
          content: (
            <div className="space-y-3">
              <p>Prazo padrão informado pela loja: <strong>{productionDeadline}</strong>.</p>
              <p>
                O prazo de produção começa após o pagamento confirmado e, quando
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
              por defeito, dano ou divergência. Consulte a <Link to={LEGAL_ROUTES.exchanges} className={inlineLink}>Política de Trocas, Cancelamentos e Reembolsos</Link>.
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
              Envie a solicitação para <EmailLink address={serviceEmail} subject="Troca, cancelamento ou reembolso" /> ou use
              outro canal de atendimento desta página. Informe o número que aparece em Meus Pedidos e o que deseja solicitar.
              A loja confirma imediatamente o recebimento pelo mesmo canal e encaminha resposta
              em até cinco dias, sem impedir providências urgentes exigidas pela legislação.
            </p>
          ),
        },
        {
          title: 'Direito de arrependimento',
          content: (
            <p>
              Nas compras feitas fora do estabelecimento comercial, o consumidor pode exercer o direito de
              arrependimento em sete dias corridos, contados da assinatura ou do recebimento do produto ou serviço,
              conforme o caso. O consumidor pode desistir sem precisar justificar. A loja orienta a devolução sem
              custo, comunica imediatamente o PagBank para cancelamento ou estorno e restitui os valores pagos,
              inclusive o frete, conforme a legislação.
            </p>
          ),
        },
        {
          title: 'Produtos personalizados',
          content: (
            <p>
              A loja recebe solicitações de arrependimento também para produtos personalizados e as analisa conforme
              a legislação aplicável. A garantia legal por defeito, dano ou divergência vale para esses produtos.
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
              Prazo padrão informado pela loja: <strong>{productionDeadline}</strong>. Confira o prazo de produção
              no resumo do pedido antes de seguir para o pagamento.
            </p>
          ),
        },
        {
          title: 'Início da contagem',
          content: (
            <p>
              A produção começa após a confirmação do pagamento e, para itens personalizados, depois
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
              de produção. Em pedidos com vários produtos, a retirada ou postagem pode aguardar a conclusão de todos os itens.
            </p>
          ),
        },
        {
          title: 'Entrega e retirada',
          content: (
            <p>
              O prazo de transporte é adicional ao prazo de produção. O carrinho mostra a estimativa em dias úteis
              após a postagem, conforme o CEP e o serviço selecionado. Acompanhe o andamento e, quando disponível,
              o rastreio em Meus Pedidos. Para retirada, aguarde a confirmação de que o pedido está pronto. Pedido
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
              Os formatos disponíveis aparecem no campo de envio de cada produto. São aceitos PDF, PNG, JPG e WebP,
              com até 50 MB por arquivo. No campo de imagem para um molde vinculado, envie PNG, JPG ou WebP.
              Arquivos corrompidos, ilegíveis, incompletos ou incompatíveis podem precisar de correção antes da produção.
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
              As artes enviadas pelo cliente são armazenadas em área privada. A equipe autorizada pode acessar os
              originais por meio de links temporários para produzir o pedido. A loja solicita autorização separada
              antes de usar uma arte em publicidade ou portfólio.
            </p>
          ),
        },
        {
          title: 'Retenção',
          content: (
            <p>
              Os arquivos serão mantidos pelo tempo necessário à produção, atendimento, garantia e defesa de direitos,
              e depois eliminados ou anonimizados quando não houver outra base legal para conservação. O cliente pode
              solicitar informações ou eliminação pelo canal <EmailLink address={privacyEmail} subject="Solicitação sobre arquivos de arte" />,
              observadas as obrigações legais da loja.
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
              O controlador dos dados da loja é {providerName}, inscrito sob {taxId}. Para falar sobre seus dados,
              escreva para <EmailLink address={privacyEmail} subject="Solicitação de privacidade" />.
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
              <li>eliminação de dados tratados com consentimento, observadas as hipóteses legais de conservação;</li>
              <li>revisão de decisões tomadas unicamente com base em tratamento automatizado que afetem seus interesses;</li>
              <li>oposição a tratamento realizado em desconformidade com a LGPD;</li>
              <li>peticionamento perante a <ExternalLegalLink href="https://www.gov.br/anpd/pt-br/canais_atendimento/cidadao-titular-de-dados/denuncia-peticao-de-titular-referente-lgpd">ANPD</ExternalLegalLink> e órgãos de defesa do consumidor.</li>
            </ul>
          ),
        },
        {
          title: 'Como exercer seus direitos',
          content: (
            <p>
              Envie a solicitação pelo canal de privacidade acima, descrevendo o direito que pretende exercer. Para impedir acesso
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
              detalhados na <Link to={LEGAL_ROUTES.privacy} className={inlineLink}>Política de Privacidade</Link>.
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
    <div className="legal-page store-shell min-h-screen bg-[#fcfcfd] font-sans">
      <a href="#conteudo-institucional" className="sr-only focus:not-sr-only focus:absolute focus:top-3 focus:left-3 focus:z-10 focus:rounded-lg focus:bg-[var(--legal-surface)] focus:p-3">
        Ir para o conteúdo
      </a>
      <div className="h-2 bg-[#d14d8c]" />
      <header className="store-header border-b border-[var(--legal-border)] bg-[#fffdd6] px-4 py-4 md:px-10 md:py-6">
        <div className="mx-auto flex max-w-7xl flex-wrap items-center justify-between gap-3">
          <Link to="/" className="flex items-center rounded-lg">
            <img
              src={resolvePublicImage(config.logo_url || DEFAULT_LOGO_URL)}
              alt="GB Gráfica"
              className="h-12 w-28 object-contain object-left"
              decoding="async"
              referrerPolicy="no-referrer"
            />
          </Link>
          <div className="legal-header-actions flex flex-wrap items-center gap-2">
            <StoreThemeControl />
            <Link to="/" className="inline-flex items-center gap-2 rounded-lg px-3 py-2 text-sm font-bold transition-colors">
              <ArrowLeft size={16} aria-hidden="true" /> Voltar à loja
            </Link>
          </div>
        </div>
      </header>

      <main className="mx-auto grid max-w-7xl gap-6 px-4 py-8 md:px-8 lg:grid-cols-[17rem_minmax(0,1fr)] lg:gap-x-10 lg:py-12">
        <div className="min-w-0 lg:col-start-2 lg:row-start-1">
          <h1 id="titulo-institucional" className="text-3xl font-black tracking-tight md:text-5xl">{legalDocument.title}</h1>
          <p className="mt-3 max-w-3xl text-base leading-relaxed text-[var(--legal-muted)]">{legalDocument.description}</p>
          <time dateTime={LEGAL_REVIEW_DATE} className="mt-3 block text-sm text-[var(--legal-muted)]">Atualizado em {reviewDate}</time>
        </div>

        <aside className="lg:col-start-1 lg:row-span-2 lg:row-start-1">
          <nav aria-label="Documentos institucionais" className={`${panel} p-3 lg:sticky lg:top-6`}>
            <div className="mb-2 flex items-center gap-2 px-3 py-2 text-sm font-bold">
              <FileText size={16} aria-hidden="true" /> Institucional
            </div>
            <ul className="grid gap-1 sm:grid-cols-2 lg:grid-cols-1">
              {(Object.keys(LEGAL_ROUTES) as LegalDocumentId[]).map(id => (
                <li key={id}>
                  <Link
                    to={LEGAL_ROUTES[id]}
                    aria-current={id === documentId ? 'page' : undefined}
                    className="legal-nav-link block rounded-lg px-3 py-2.5 text-sm font-semibold transition-colors"
                  >
                    {DOCUMENT_LABELS[id]}
                  </Link>
                </li>
              ))}
            </ul>
          </nav>
        </aside>

        <article id="conteudo-institucional" aria-labelledby="titulo-institucional" tabIndex={-1} className="min-w-0 lg:col-start-2 lg:row-start-2">
          {missingFields.length > 0 && (
            <div role="alert" className="mb-6 rounded-2xl border border-[var(--legal-warning-border)] bg-[var(--legal-warning-surface)] p-5 text-sm leading-relaxed text-[var(--legal-warning-text)]">
              <div className="mb-1 flex items-center gap-2 font-bold"><AlertTriangle size={18} aria-hidden="true" /> Dados comerciais a confirmar</div>
              <p>Campos pendentes no cadastro da loja: {missingFields.map(field => MISSING_FIELD_LABELS[field]).join(', ')}.</p>
            </div>
          )}

          <div className="space-y-6">
            {legalDocument.sections.map(section => (
              <section key={section.title} className={`${panel} p-5 md:p-7`}>
                <h2 className="mb-3 text-xl font-bold tracking-tight">{section.title}</h2>
                <div className="text-base leading-relaxed text-[var(--legal-muted)]">{section.content}</div>
              </section>
            ))}
          </div>

          <section className={`${panel} mt-6 p-5 md:p-7`}>
            <h2 className="mb-3 text-lg font-bold">Referências legais</h2>
            <ul className="flex flex-wrap gap-x-5 gap-y-2 text-sm">
              <li><ExternalLegalLink href="https://www.planalto.gov.br/ccivil_03/leis/l8078compilado.htm">Código de Defesa do Consumidor</ExternalLegalLink></li>
              <li><ExternalLegalLink href="https://www.planalto.gov.br/ccivil_03/_ato2011-2014/2013/decreto/d7962.htm">Decreto do Comércio Eletrônico</ExternalLegalLink></li>
              <li><ExternalLegalLink href="https://www.planalto.gov.br/ccivil_03/_ato2015-2018/2018/lei/l13709compilado.htm">Lei Geral de Proteção de Dados</ExternalLegalLink></li>
            </ul>
          </section>
        </article>
      </main>

      <footer className="border-t border-[var(--legal-border)] bg-[var(--legal-surface)] px-4 py-6 text-center text-sm text-[var(--legal-muted)]">
        © {new Date().getFullYear()} GB Gráfica. Todos os direitos reservados.
      </footer>
    </div>
  );
}
