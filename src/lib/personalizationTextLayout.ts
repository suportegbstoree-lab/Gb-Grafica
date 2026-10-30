import { personalizationTextScale } from './personalizationModel.js';
import type { TextCustomization } from './textCustomization.js';

// One layout is used by the on-screen canvas and by the full-resolution export.
export function personalizationTextLayout(width: number, height: number, value: TextCustomization, measure: (text: string) => number) {
  const fontSize = width * (value.tamanhoFonte !== undefined ? value.tamanhoFonte / 100 : personalizationTextScale(value.texto));
  const maxWidth = width * 0.9;
  const lines: string[] = [];
  for (const paragraph of value.texto.replace(/\r\n?/g, '\n').split('\n')) {
    if (!paragraph.trim()) { lines.push(''); continue; }
    let line = '';
    for (const word of paragraph.trim().split(/\s+/)) {
      const candidate = line ? `${line} ${word}` : word;
      if (measure(candidate) <= maxWidth) { line = candidate; continue; }
      if (line) { lines.push(line); line = ''; }
      for (const character of word) {
        if (line && measure(line + character) > maxWidth) { lines.push(line); line = ''; }
        line += character;
      }
    }
    lines.push(line);
  }
  const lineHeight = fontSize * 1.18;
  const blockHeight = lines.length * lineHeight;
  const stroke = fontSize * 0.1;
  if (blockHeight + stroke > height * 0.95) throw new Error('O texto não cabe nesta capa. Reduza o tamanho da fonte ou a quantidade de linhas.');
  const blockWidth = Math.max(0, ...lines.map(measure)) + stroke;
  const centerX = Math.min(width - blockWidth / 2, Math.max(blockWidth / 2, width * value.posicao.x / 100));
  const centerY = Math.min(height - (blockHeight + stroke) / 2, Math.max((blockHeight + stroke) / 2, height * value.posicao.y / 100));
  return { lines, fontSize, lineHeight, centerX, firstLineY: centerY - blockHeight / 2 + lineHeight / 2 };
}
