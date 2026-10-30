import { sanitizeArtworkName } from '../lib/artwork';
import { personalizationModelDimensions } from '../lib/personalizationModel';
import { decodePersonalizationSource, personalizationCanvasBlob } from './personalizationModelService';

export interface PersonalizationPage {
  label: 'Capa' | 'Contracapa';
  blob: Blob;
}

export interface PersonalizationDocument {
  title: string;
  pages: PersonalizationPage[];
}

export async function exportPersonalizationImage(blob: Blob, type: 'image/png' | 'image/jpeg'): Promise<Blob> {
  const decoded = await decodePersonalizationSource(blob);
  const canvas = document.createElement('canvas');
  try {
    const dimensions = personalizationModelDimensions(decoded.width, decoded.height);
    if (!dimensions) throw new Error('A imagem excede a capacidade de exportação em resolução original deste navegador.');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Este navegador não permite exportar a imagem.');
    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0);
    const result = await personalizationCanvasBlob(canvas, type);
    if (result.type !== type) throw new Error('Este navegador não suporta o formato de exportação escolhido.');
    return result;
  } finally {
    decoded.dispose();
    canvas.width = canvas.height = 1;
  }
}

export async function exportPersonalizationPdf(document: PersonalizationDocument): Promise<Blob> {
  if (document.pages.length < 1 || document.pages.length > 2) throw new Error('Selecione a capa e, se existir, a contracapa.');
  const { PDFDocument } = await import('pdf-lib');
  const pdf = await PDFDocument.create();
  pdf.setTitle(document.title);
  for (const page of document.pages) {
    const blob = ['image/png', 'image/jpeg'].includes(page.blob.type)
      ? page.blob : await exportPersonalizationImage(page.blob, 'image/png');
    const bytes = await blob.arrayBuffer();
    const image = blob.type === 'image/jpeg' ? await pdf.embedJpg(bytes) : await pdf.embedPng(bytes);
    // Uma página por face, com os pixels originais. O tamanho físico usa 300 dpi.
    const size: [number, number] = [image.width * 72 / 300, image.height * 72 / 300];
    pdf.addPage(size).drawImage(image, { x: 0, y: 0, width: size[0], height: size[1] });
  }
  const bytes = await pdf.save();
  return new Blob([new Uint8Array(bytes)], { type: 'application/pdf' });
}

export function personalizationDownloadName(title: string, suffix: string, extension: 'jpg' | 'pdf'): string {
  const base = sanitizeArtworkName(title).replace(/\.[^.]+$/, '').replace(/[^A-Za-z0-9À-ÿ_-]/g, '-').replace(/-+/g, '-').replace(/^-|-$/g, '').slice(0, 80) || 'personalizacao';
  return `${base}-${suffix}.${extension}`;
}

export function downloadPersonalization(blob: Blob, filename: string): void {
  const url = URL.createObjectURL(blob);
  const link = document.createElement('a');
  link.href = url;
  link.download = filename;
  document.body.appendChild(link);
  link.click();
  link.remove();
  // Revogar imediatamente pode interromper o download em alguns navegadores.
  setTimeout(() => URL.revokeObjectURL(url), 60_000);
}
