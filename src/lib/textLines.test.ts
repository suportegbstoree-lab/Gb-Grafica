import assert from 'node:assert/strict';
import test from 'node:test';
import { distributeTextLines, reconcileTextLines, textLayers } from './textLines';
import { normalizeTextCustomization, textCustomizationFingerprint, type TextCustomization } from './textCustomization';

const fonts = [{ id: 'arial', nome: 'Arial', cssFamily: 'Arial', ativo: true }, { id: 'georgia', nome: 'Georgia', cssFamily: 'Georgia', ativo: true }];
function value(): TextCustomization {
  return { texto: 'A\nB', fonte: 'arial', tamanhoFonte: 7, cor: '#ffffff', posicao: { x: 50, y: 50 }, fonteCompartilhada: false, corCompartilhada: false, linhas: [
    { id: 'line-a', texto: 'A', fonte: 'arial', tamanhoFonte: 5, cor: '#ff0000', posicao: { x: 20, y: 30 } },
    { id: 'line-b', texto: 'B', fonte: 'georgia', tamanhoFonte: 9, cor: '#00ff00', posicao: { x: 70, y: 80 } },
  ] };
}
test('normaliza linhas independentes e resolve snapshots das fontes permitidas', () => {
  const normalized = normalizeTextCustomization(value(), fonts)!;
  assert.equal(normalized.linhas?.[1].fonteNome, 'Georgia');
  assert.deepEqual(normalized.linhas?.map(row => [row.tamanhoFonte, row.cor, row.posicao]), [[5, '#ff0000', { x: 20, y: 30 }], [9, '#00ff00', { x: 70, y: 80 }]]);
  assert.equal(normalized.texto, 'A\nB');
});
test('fonte e cor compartilhadas aplicam o estilo comum sem alterar posições ou tamanhos', () => {
  const normalized = normalizeTextCustomization({ ...value(), fonteCompartilhada: true, corCompartilhada: true }, fonts)!;
  assert.deepEqual(normalized.linhas?.map(row => [row.fonte, row.cor]), [['arial', '#ffffff'], ['arial', '#ffffff']]);
  assert.deepEqual(textLayers(normalized).map(row => row.value.posicao), [{ x: 20, y: 30 }, { x: 70, y: 80 }]);
  assert.deepEqual(textLayers(normalized).map(row => row.value.tamanhoFonte), [5, 9]);
});
test('rejeita inconsistências entre texto e linhas, IDs duplicados e estilos manipulados', () => {
  for (const patch of [{ texto: 'Outra' }, { id: 'line-a' }, { posicao: { x: -1, y: 2 } }, { tamanhoFonte: 0 }, { tamanhoFonte: null }, { cor: 'url(x)' }, { fonte: 'nao-permitida' }]) {
    const input = value(); input.linhas![1] = { ...input.linhas![1], ...patch } as never;
    assert.equal(normalizeTextCustomization(input, fonts), null, JSON.stringify(patch));
  }
  assert.equal(normalizeTextCustomization({ ...value(), linhas: [] }, fonts), null);
  assert.equal(normalizeTextCustomization({ ...value(), fonteCompartilhada: 'false' }, fonts), null);
});
test('linhas vazias mantêm sua identidade e o texto legado continua válido', () => {
  const input = value(); input.texto = '\nA\nB\n';
  input.linhas = [{ ...input.linhas![0], id: 'blank-top', texto: '' }, ...input.linhas!, { ...input.linhas![0], id: 'blank-bottom', texto: '' }];
  assert.equal(normalizeTextCustomization(input, fonts)?.linhas?.length, 4);
  const old = normalizeTextCustomization({ texto: '  Texto antigo ', fonte: 'arial', posicao: { x: 50, y: 50 } }, fonts)!;
  assert.equal(old.linhas, undefined); assert.equal(old.texto, 'Texto antigo');
});
test('editar, inserir e apagar texto preserva estilos e IDs das linhas existentes', () => {
  const original = value();
  const inserted = reconcileTextLines(original, 'Nova\nA\nB', 800, 1200, () => 'line-new');
  assert.deepEqual(inserted.linhas?.map(row => row.id), ['line-new', 'line-a', 'line-b']);
  assert.deepEqual(inserted.linhas?.[2], original.linhas?.[1]);
  const edited = reconcileTextLines(inserted, 'Nova\nA alterada\nB', 800, 1200);
  assert.equal(edited.linhas?.[1].id, 'line-a'); assert.equal(edited.linhas?.[1].cor, '#ff0000');
  const deleted = reconcileTextLines(edited, 'B', 800, 1200);
  assert.equal(deleted.linhas?.[0].id, 'line-b'); assert.deepEqual(deleted.linhas?.[0].posicao, { x: 70, y: 80 });
});
test('distribuição usa alturas individuais, preserva estilos e informa quando não cabe', () => {
  const input = value(); const arranged = distributeTextLines(input, 800, 1200, layer => layer.tamanhoFonte! * 10);
  assert.ok(arranged.linhas![0].posicao.y < arranged.linhas![1].posicao.y);
  assert.deepEqual(arranged.linhas?.map(row => row.cor), ['#ff0000', '#00ff00']);
  assert.throws(() => distributeTextLines(input, 800, 20), /não cabem/);
  assert.deepEqual(input.linhas?.[0].posicao, { x: 20, y: 30 });
});
test('fingerprint inclui estilos e posições por linha e ignora IDs aleatórios de edição', () => {
  const first = value(), equivalent = value(); equivalent.linhas![0].id = 'other-id';
  assert.equal(textCustomizationFingerprint(first), textCustomizationFingerprint(equivalent));
  for (const patch of [{ tamanhoFonte: 6 }, { cor: '#0000ff' }, { posicao: { x: 1, y: 2 } }, { fonte: 'georgia' }]) {
    const different = value(); different.linhas![0] = { ...different.linhas![0], ...patch };
    assert.notEqual(textCustomizationFingerprint(first), textCustomizationFingerprint(different));
  }
});

test('posição ajustada antes de digitar não se perde ao preencher uma linha vazia', () => {
  const input = value(); input.texto = ''; input.linhas = [{ ...input.linhas![0], texto: '' }];
  const next = reconcileTextLines(input, 'Agora preenchida', 800, 1200, () => 'new-line', true);
  assert.deepEqual(next.linhas?.[0].posicao, { x: 20, y: 30 });
});
