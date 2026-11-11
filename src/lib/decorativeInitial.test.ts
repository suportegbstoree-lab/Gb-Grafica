import test from 'node:test';
import assert from 'node:assert/strict';
import { centeredInitialBox, firstInitial, initialReference, matchingAlphabetName, readAlphabetFiles, selectedInitial, validAlphabet, validDecorativePngHeader } from './decorativeInitial';
import { validPdfTemplates } from './pdfTemplate';

const path = `catalog/products/product/${'b'.repeat(32)}.png`;
const alphabet = { folderName: 'Alfabeto Borboleta', sizePercent: 60, letters: { A: { path, url: 'https://example.test/A.png' } } };
const template = { id: 'a'.repeat(32), path: `catalog/templates/product/${'a'.repeat(32)}.pdf`, name: 'Alfabeto Borboleta.pdf', pages: ['/front.png'], alphabet };
const file = (name: string, folder = 'Alfabeto Borboleta', nested = '') => Object.assign(new File(['png'], name, { type: 'image/png' }), { webkitRelativePath: `${folder}/${nested}${name}` });

test('associa somente nomes iguais; acentos Unicode equivalentes mantêm a associação', () => {
  assert.equal(matchingAlphabetName('Alfabeto Borboleta.pdf', 'Alfabeto Borboleta'), true);
  assert.equal(matchingAlphabetName('Alfabeto Borboleta.PDF', 'Alfabeto Borborboleta'), false);
  assert.equal(matchingAlphabetName('Coleção.pdf', 'Colec\u0327a\u0303o'), true);
  assert.equal(matchingAlphabetName('Alfabeto Borboleta.pdf', 'alfabeto borboleta'), false);
});
test('importa a pasta sem o sufixo do molde, preservando os PNGs e os vínculos anteriores', () => {
  const folder = 'Alfabeto Marrom';
  const image = file('A.png', folder);
  for (const name of ['Alfabeto Marrom_template', 'Alfabeto Marrom_template__2p', 'Alfabeto Marrom_template_2p.PDF']) {
    assert.deepEqual(readAlphabetFiles([image], name), { folderName: folder, letters: [{ letter: 'A', file: image }] });
    assert.equal(selectedInitial({ name, alphabet: { ...alphabet, folderName: folder } }, 'Ana')?.path, path);
    assert.throws(() => readAlphabetFiles([file('A.png', 'Alfabeto Azul')], name), /Alfabeto Marrom/);
  }
  assert.equal(matchingAlphabetName('Alfabeto Marrom_template.pdf', 'Alfabeto Marrom_template'), true);
});
test('valida PNG com canal alpha sem modificar o arquivo', () => {
  const png = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64');
  assert.equal(png[25], 4); // Grayscale with alpha.
  assert.equal(validDecorativePngHeader(png.subarray(0, 33)), true);
  assert.equal(validDecorativePngHeader(png.subarray(0, 32)), false);
  const oversized = Buffer.from(png);
  oversized.writeUInt32BE(16385, 16);
  assert.equal(validDecorativePngHeader(oversized), false);
});
test('usa o primeiro caractere digitado, preserva acentos e não pula símbolos', () => {
  for (const [text, expected] of [['  ána', 'Á'], ['çarlos', 'Ç'], ['e\u0301rica', 'É'], ['\nBruna', 'B'], ['A\nB', 'A'], [' 123 Ana', undefined], ['🌸Ana', undefined], ['', undefined]]) assert.equal(firstInitial(text || ''), expected);
  assert.equal(selectedInitial(template, 'Ana')?.path, path);
  assert.equal(selectedInitial(template, 'Beatriz'), undefined);
  assert.equal(selectedInitial({ ...template, alphabet: undefined }, 'Ana'), undefined);
  assert.equal(initialReference(template, 'Beatriz'), 'null');
  assert.notEqual(initialReference(template, 'Ana'), initialReference({ ...template, alphabet: { ...alphabet, sizePercent: 40 } }, 'Ana'));
});
test('letras com e sem acento coexistem, com fallback para a letra sem acento', () => {
  const accentedPath = path.replace('b'.repeat(32), 'c'.repeat(32));
  const letters = {
    ...alphabet.letters,
    E: alphabet.letters.A,
    É: { path: accentedPath, url: 'https://example.test/accent.png' },
  };
  const accented = { ...template, alphabet: { ...alphabet, letters } };
  assert.equal(validPdfTemplates([accented], 'product', ['/front.png']), true);
  assert.equal(selectedInitial(accented, 'Érica')?.path, accentedPath);
  assert.equal(selectedInitial(accented, 'Erica')?.path, path);
  assert.equal(selectedInitial(accented, 'Ênio')?.path, path);
  assert.equal(selectedInitial(template, 'Ágata')?.letter, 'A');
  assert.deepEqual(readAlphabetFiles([file('E.png'), file('e\u0301.PNG')], template.name).letters.map(item => item.letter), ['E', 'É']);
  assert.throws(() => readAlphabetFiles([file('É.png'), file('E\u0301.png')], template.name), /É está duplicada/);
});
test('importação recusa outra pasta, subpastas, letras repetidas e extensões indevidas', () => {
  assert.deepEqual(readAlphabetFiles([file('B.png'), file('a.png')], template.name).letters.map(item => item.letter), ['A', 'B']);
  for (const files of [[file('A.png', 'Outra')], [file('A.png'), file('a.png')], [file('A.png', alphabet.folderName, 'sub/')], [file('A.jpg')], [file('AB.png')]]) assert.throws(() => readAlphabetFiles(files, template.name));
});
test('metadados do sistema são ignorados antes de identificar a pasta de letras', () => {
  const input = [
    file('._A.png', alphabet.folderName, '__MACOSX/'),
    file('Thumbs.db'),
    file('desktop.ini'),
    file('A.png'),
  ];
  assert.deepEqual(readAlphabetFiles(input, template.name), {
    folderName: alphabet.folderName,
    letters: [{ letter: 'A', file: input[3] }],
  });
  assert.throws(
    () => readAlphabetFiles([new File(['png'], 'A.png')], template.name),
    /Selecione a pasta inteira/,
  );
});
test('metadados rejeitam caminhos fora do produto, tamanhos inválidos e pastas sem correspondência', () => {
  assert.equal(validAlphabet(alphabet, template.name, 'product'), true);
  for (const invalid of [{ ...alphabet, sizePercent: 101 }, { ...alphabet, sizePercent: NaN }, { ...alphabet, folderName: 'Outra' }, { ...alphabet, letters: {} }, { ...alphabet, letters: { AA: alphabet.letters.A } }, { ...alphabet, letters: { A: { path: path.replace('/product/', '/other/'), url: alphabet.letters.A.url } } }]) assert.equal(validAlphabet(invalid, template.name, 'product'), false);
  assert.equal(validPdfTemplates([template], 'product', ['/front.png']), true);
  assert.equal(validPdfTemplates([{ ...template, alphabet: { ...alphabet, sizePercent: 0 } }], 'product', ['/front.png']), false);
});
test('centraliza o canvas completo, mantém proporção e nunca ultrapassa a página', () => {
  const box = centeredInitialBox(210, 297, 1414, 2000, 60);
  assert.ok(Math.abs(box.width / box.height - 1414 / 2000) < 1e-9);
  assert.equal(box.x * 2 + box.width, 210);
  assert.equal(box.y * 2 + box.height, 297);
  for (const [w, h] of [[2000, 1414], [1, 20000], [20000, 1]]) { const result = centeredInitialBox(210, 297, w, h, 100); assert.ok(result.x >= 0 && result.y >= 0 && result.width <= 210 && result.height <= 297); }
  assert.throws(() => centeredInitialBox(0, 297, 1414, 2000, 60));
});
