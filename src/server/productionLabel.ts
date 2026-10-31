import bwipjs from 'bwip-js/node';
import { PDFDocument, StandardFonts, rgb } from 'pdf-lib';
import { createHash } from 'node:crypto';
import type { Order } from '../types.js';
import { printProfileLabel } from '../lib/printProfile.js';

export function productionLabelFingerprint(order: Record<string, unknown>): string {
  return createHash('sha256').update(JSON.stringify({ itens: order.itens, clienteNome: order.clienteNome,
    clienteEmail: order.clienteEmail, enderecoEntrega: order.enderecoEntrega, total: order.total, observacoes: order.observacoes, clienteTelefone: order.clienteTelefone, metodoEntrega: order.metodoEntrega, data: order.data })).digest('hex');
}

/** A6 internal work label. The PDF contains order data, never bearer URLs or payment credentials. */
export async function createOrderLabel(orderId: string, order: Order, production = false): Promise<Uint8Array> {
  const pdf = await PDFDocument.create();
  pdf.setTitle(`Etiqueta de produção ${orderId}`); pdf.setAuthor('GB Gráfica');
  const regular = await pdf.embedFont(StandardFonts.Helvetica), bold = await pdf.embedFont(StandardFonts.HelveticaBold);
  const width = 105 * 72 / 25.4, height = 148 * 72 / 25.4, margin = 20;
  let page = pdf.addPage([width, height]), y = height - margin;
  const clean = (text: string) => [...text].map(character => { if (character === '\n') return character; try { regular.encodeText(character); return character; } catch { return '?'; } }).join('');
  const line = (text: string, emphasis = false, size = 9) => {
    const font = emphasis ? bold : regular;
    // Wrap by measured glyph width, including very long identifiers.
    let buffer = '';
    const flush = () => {
      if (y < margin + 16) { page = pdf.addPage([width, height]); y = height - margin; }
      page.drawText(buffer, { x: margin, y: y - size, size, font, color: rgb(0.08, 0.08, 0.08) }); y -= size + 5; buffer = '';
    };
    for (const character of clean(text).slice(0, 5000)) {
      if (character === '\n') { flush(); continue; }
      if (font.widthOfTextAtSize(buffer + character, size) > width - margin * 2) flush();
      buffer += character;
    }
    if (buffer) flush();
  };
  line('GB GRÁFICA', true, 16); line(production ? 'ETIQUETA INTERNA DE PRODUÇÃO' : 'FICHA INICIAL DO PEDIDO', true, 9);
  line(`Pedido #${orderId}`, true, 10); line(`Cliente: ${order.clienteNome || 'Não informado'}`);
  const barcode = await pdf.embedPng(await bwipjs.toBuffer({ bcid: 'code128', text: orderId, scale: 3, height: 12, includetext: false }));
  page.drawImage(barcode, { x: margin, y: y - 48, width: width - 2 * margin, height: 42 }); y -= 56;
  line(`Email: ${order.clienteEmail || 'Não informado'}`);
  const date = new Date(order.data); line(`Criado em: ${Number.isFinite(date.getTime()) ? date.toLocaleString('pt-BR', { timeZone: 'America/Sao_Paulo' }) : order.data}`);
  if (order.clienteTelefone) line(`Contato: ${order.clienteTelefone}`);
  line(order.metodoEntrega === 'retirada' ? 'Retirada na loja' : 'Entrega ao cliente');
  if (order.enderecoEntrega) { const a = order.enderecoEntrega; line(`${a.rua}, ${a.numero}${a.complemento ? ' - ' + a.complemento : ''}`); line(`${a.bairro} - ${a.cidade}/${a.estado} - CEP ${a.cep}`); }
  line(`Pagamento: ${order.metodoPagamento === 'pagbank' ? 'PagBank (modalidade escolhida no checkout)' : order.metodoPagamento || 'Não informado'}`);
  line(`Status: ${order.status} / ${order.paymentStatus || 'pendente'}`);
  y -= 6;
  for (const item of order.itens) {
    line(`${item.quantidade} x ${item.nome} - R$ ${item.preco} / unidade`, true, 11);
    for (const [key, value] of Object.entries(item.selecoes || {})) line(`${key}: ${value}`);
    line(item.printProfile ? printProfileLabel(item.printProfile) : 'Formato: conferir antes de produzir');
    const text = item.personalizacaoTexto?.texto || item.textoPersonalizado;
    if (text) line(`Texto: ${text}`);
    line(item.contracapaPath ? 'Capa + contracapa' : item.modeloPath ? 'Capa' : 'Conferir arte original');
    line(item.aprovacaoArte ? 'Aprovação da arte registrada na compra' : 'Conferir aprovação da arte no painel');
    y -= 7;
  }
  line(`Total: R$ ${order.total}`, true, 12);
  if (order.observacoes) line(`Observações: ${order.observacoes}`);
  line('Confira os arquivos e a ficha no painel antes de produzir.', false, 8);
  line('Uso interno. Não substitui etiqueta de postagem dos Correios.', false, 8);
  return pdf.save();
}

export async function createProductionLabel(orderId: string, order: Order) { return createOrderLabel(orderId, order, true); }
