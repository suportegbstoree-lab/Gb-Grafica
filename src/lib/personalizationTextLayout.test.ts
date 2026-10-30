import assert from 'node:assert/strict';
import test from 'node:test';
import { personalizationTextLayout } from './personalizationTextLayout';

const base = { texto: 'AB\n\nCD', fonte: 'arial', tamanhoFonte: 10, cor: '#ffffff', posicao: { x: 50, y: 50 } };
test('layout preserva Enter e linhas vazias e escala proporcionalmente à imagem', () => {
  const small = personalizationTextLayout(1000, 1500, base, text => text.length * 60);
  const large = personalizationTextLayout(2000, 3000, base, text => text.length * 120);
  assert.deepEqual(small.lines, ['AB', '', 'CD']);
  assert.equal(large.fontSize, small.fontSize * 2);
  assert.equal(large.firstLineY, small.firstLineY * 2);
});
test('layout quebra palavras longas sem descartar caracteres ou cortar linhas finais', () => {
  const value = { ...base, texto: 'ABCDEFGHIJKLMNOPQRST UV XYZ', tamanhoFonte: 2 };
  const result = personalizationTextLayout(100, 1000, value, text => text.length * 10);
  assert.equal(result.lines.join('').replace(/ /g, ''), value.texto.replace(/ /g, ''));
  assert.ok(result.lines.every(line => line.length <= 9));
});
test('texto grande demais falha explicitamente; bordas mantêm o bloco visível', () => {
  assert.throws(() => personalizationTextLayout(1000, 100, base, text => text.length * 60), /não cabe/);
  const edge = personalizationTextLayout(1000, 1500, { ...base, posicao: { x: 0, y: 0 } }, text => text.length * 60);
  assert.ok(edge.centerX >= 60); assert.ok(edge.firstLineY > 0);
});
