import { personalizationTextScale } from './personalizationModel.js';
import type { TextCustomization, TextCustomizationLine } from './textCustomization.js';

const coordinate = (value: number) => Math.round(Math.min(100, Math.max(0, value)) * 10) / 10;
export function textLineValue(value: TextCustomization, line: TextCustomizationLine): TextCustomization {
  const individualFont = value.fonteCompartilhada === false && Boolean(line.fonte);
  return {
    texto: line.texto,
    fonte: individualFont ? line.fonte! : value.fonte,
    fonteNome: individualFont ? line.fonteNome : value.fonteNome,
    fonteCssFamily: individualFont ? line.fonteCssFamily : value.fonteCssFamily,
    fonteArquivoUrl: individualFont ? line.fonteArquivoUrl : value.fonteArquivoUrl,
    tamanhoFonte: line.tamanhoFonte ?? value.tamanhoFonte,
    cor: value.corCompartilhada === false ? line.cor ?? value.cor : value.cor,
    posicao: line.posicao,
  };
}

export function textLayers(value: TextCustomization) {
  return value.linhas?.length ? value.linhas.map((line, index) => ({ id: line.id, index, value: textLineValue(value, line) })) : [{ id: 'legacy', index: 0, value }];
}

export function distributeTextLines(value: TextCustomization, width: number, height: number, measureHeight?: (value: TextCustomization) => number): TextCustomization {
  if (!value.linhas?.length) return value;
  const sizes = value.linhas.map(line => {
    const layer = textLineValue(value, line);
    const size = width * (layer.tamanhoFonte !== undefined ? layer.tamanhoFonte / 100 : personalizationTextScale(layer.texto));
    const rows = Math.max(1, Math.ceil(layer.texto.length * size * 0.58 / (width * 0.9)));
    return measureHeight ? measureHeight(layer) : size * (rows * 1.18 + 0.1);
  });
  if (sizes.some(size => !Number.isFinite(size) || size <= 0)) throw new Error('Informe um tamanho válido para cada linha.');
  const gap = width * 0.01;
  const total = sizes.reduce((sum, size) => sum + size, 0) + gap * (sizes.length - 1);
  if (total > height * 0.95) throw new Error('As linhas não cabem juntas nesta capa. Reduza os tamanhos antes de distribuir.');
  let offset = (height - total) / 2;
  const linhas = value.linhas.map((line, index) => {
    const y = coordinate((offset + sizes[index] / 2) / height * 100);
    offset += sizes[index] + gap;
    return { ...line, posicao: { x: 50, y } };
  });
  return { ...value, linhas };
}

// Keep styles and identity when text is edited, inserted or deleted in the textarea.
export function reconcileTextLines(value: TextCustomization, text: string, width: number, height: number, id = () => `line-${crypto.randomUUID().replaceAll('-', '')}`, keepPositions = false): TextCustomization {
  const rows = text.replace(/\r\n?/g, '\n').split('\n');
  const old = value.linhas || [];
  const assigned = new Set<number>();
  const mapping = rows.map((row, index) => {
    if (old.length === rows.length) { assigned.add(index); return old[index]; }
    const found = old.findIndex((line, i) => !assigned.has(i) && line.texto === row);
    if (found >= 0) { assigned.add(found); return old[found]; }
    return undefined;
  });
  const linhas = mapping.map((previous, index) => {
    if (!previous) {
      const unused = old.findIndex((_, i) => !assigned.has(i));
      if (unused >= 0) { assigned.add(unused); previous = old[unused]; }
    }
    return previous ? { ...previous, texto: rows[index] } : {
      id: id(), texto: rows[index], fonte: value.fonte, fonteNome: value.fonteNome,
      fonteCssFamily: value.fonteCssFamily, fonteArquivoUrl: value.fonteArquivoUrl,
      tamanhoFonte: value.tamanhoFonte ?? 7.2, cor: value.cor || '#ffffff', posicao: { ...value.posicao },
    };
  });
  const next = { ...value, texto: text.replace(/\r\n?/g, '\n'), linhas };
  if (!keepPositions && (!old.length || old.every(line => !line.texto.trim())) && text.trim()) {
    try { return distributeTextLines(next, width, height); } catch { return next; }
  }
  // Put new lines after their preceding line; existing positions stay untouched.
  next.linhas = linhas.map((line, index) => {
    if (old.some(previous => previous.id === line.id)) return line;
    const predecessor = linhas[index - 1];
    const step = (line.tamanhoFonte ?? 7.2) * width / height * 1.4;
    return { ...line, posicao: predecessor ? { x: predecessor.posicao.x, y: coordinate(predecessor.posicao.y + step) } : { x: 50, y: coordinate(50 + index * step) } };
  });
  return next;
}
