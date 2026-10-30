import assert from 'node:assert/strict';
import test from 'node:test';
import { PDFDocument, PDFName, PDFRawStream } from 'pdf-lib';
import { exportPersonalizationPdf, personalizationDownloadName } from './personalizationExport';

const png = new Blob([Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mNk+A8AAQUBAScY42YAAAAASUVORK5CYII=', 'base64')], { type: 'image/png' });

test('PDF válido inclui as duas faces como imagens, na ordem e sem mudar os pixels', async () => {
  const result = await exportPersonalizationPdf({ title: 'Caderno Teste', pages: [{ label: 'Capa', blob: png }, { label: 'Contracapa', blob: png }] });
  assert.equal(result.type, 'application/pdf');
  const pdf = await PDFDocument.load(await result.arrayBuffer());
  assert.equal(pdf.getPageCount(), 2);
  assert.equal(pdf.getTitle(), 'Caderno Teste');
  const images = pdf.context.enumerateIndirectObjects().filter(([, obj]) => obj instanceof PDFRawStream && obj.dict.get(PDFName.of('Subtype')) === PDFName.of('Image'));
  assert.ok(images.length >= 1);
  for (const [, image] of images) {
    assert.equal((image as PDFRawStream).dict.get(PDFName.of('Width'))?.toString(), '1');
    assert.equal((image as PDFRawStream).dict.get(PDFName.of('Height'))?.toString(), '1');
  }
});

test('modelo antigo com uma única face continua exportando PDF de uma página', async () => {
  const result = await exportPersonalizationPdf({ title: 'Capa', pages: [{ label: 'Capa', blob: png }] });
  assert.equal((await PDFDocument.load(await result.arrayBuffer())).getPageCount(), 1);
  await assert.rejects(() => exportPersonalizationPdf({ title: 'Vazio', pages: [] }));
});

test('nomes de download não contêm caminhos de arquivos', () => {
  assert.equal(personalizationDownloadName('../../caderno.png', 'capa', 'jpg'), 'caderno-capa.jpg');
});
