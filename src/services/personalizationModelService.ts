import { matchesArtworkSignature } from '../lib/artwork';
import {
  isComposablePersonalizationImage,
  MAX_PERSONALIZATION_MODEL_BYTES,
  PERSONALIZATION_MODEL_MIME_TYPE,
  personalizationModelDimensions,
  personalizationTextScale,
} from '../lib/personalizationModel';
import {
  textFontCssFamily,
  type PersonalizationFont,
  type TextCustomization,
} from '../lib/textCustomization';

export interface ComposedPersonalizationModel {
  blob: Blob;
  width: number;
  height: number;
}

interface DecodedImage {
  source: CanvasImageSource;
  width: number;
  height: number;
  dispose: () => void;
}

async function decodeImage(blob: Blob): Promise<DecodedImage> {
  if (!isComposablePersonalizationImage(blob.type, blob.size)) {
    throw new Error('O modelo com texto exige uma imagem JPG, PNG ou WebP de até 15 MB.');
  }
  const signature = new Uint8Array(await blob.slice(0, 16).arrayBuffer());
  if (!matchesArtworkSignature(blob.type, signature)) {
    throw new Error('A imagem usada no modelo possui conteúdo inválido.');
  }

  if (typeof createImageBitmap === 'function') {
    const bitmap = await createImageBitmap(blob);
    return {
      source: bitmap,
      width: bitmap.width,
      height: bitmap.height,
      dispose: () => bitmap.close(),
    };
  }

  const objectUrl = URL.createObjectURL(blob);
  const image = new Image();
  image.decoding = 'async';
  image.src = objectUrl;
  try {
    await image.decode();
    return {
      source: image,
      width: image.naturalWidth,
      height: image.naturalHeight,
      dispose: () => URL.revokeObjectURL(objectUrl),
    };
  } catch {
    URL.revokeObjectURL(objectUrl);
    throw new Error('Não foi possível interpretar a imagem usada no modelo.');
  }
}

async function decodeImageUrl(source: string): Promise<DecodedImage> {
  let parsed: URL;
  try {
    parsed = new URL(source, window.location.href);
  } catch {
    throw new Error('O endereço da imagem usada no modelo é inválido.');
  }
  if (!['http:', 'https:', 'data:', 'blob:'].includes(parsed.protocol)) {
    throw new Error('O endereço da imagem usada no modelo não é permitido.');
  }

  const image = new Image();
  image.decoding = 'async';
  image.referrerPolicy = 'no-referrer';
  if (parsed.origin !== window.location.origin && !['data:', 'blob:'].includes(parsed.protocol)) {
    image.crossOrigin = 'anonymous';
  }
  image.src = parsed.href;

  try {
    await image.decode();
  } catch {
    throw new Error('A imagem não autorizou a composição. Reenvie a imagem do produto pelo painel e confira o CORS do Firebase Storage.');
  }
  if (image.naturalWidth <= 0 || image.naturalHeight <= 0) {
    throw new Error('A imagem usada no modelo não possui dimensões válidas.');
  }
  return {
    source: image,
    width: image.naturalWidth,
    height: image.naturalHeight,
    dispose: () => undefined,
  };
}

async function decodeSource(source: Blob | string): Promise<DecodedImage> {
  if (source instanceof Blob) return decodeImage(source);

  try {
    const response = await fetch(source, { credentials: 'same-origin' });
    if (!response.ok) throw new Error(`HTTP ${response.status}`);
    return await decodeImage(await response.blob());
  } catch (error) {
    if (error instanceof Error && (
      error.message.startsWith('O modelo com texto exige') ||
      error.message.startsWith('A imagem usada no modelo possui conteúdo inválido') ||
      error.message.startsWith('Não foi possível interpretar')
    )) {
      throw error;
    }
    return decodeImageUrl(source);
  }
}

function splitLongWord(context: CanvasRenderingContext2D, word: string, maxWidth: number): string[] {
  const chunks: string[] = [];
  let current = '';
  for (const character of word) {
    const candidate = current + character;
    if (current && context.measureText(candidate).width > maxWidth) {
      chunks.push(current);
      current = character;
    } else {
      current = candidate;
    }
  }
  if (current) chunks.push(current);
  return chunks;
}

function wrappedLines(context: CanvasRenderingContext2D, text: string, maxWidth: number): string[] {
  const words = text.trim().split(/\s+/).flatMap(word => (
    context.measureText(word).width > maxWidth ? splitLongWord(context, word, maxWidth) : [word]
  ));
  const lines: string[] = [];
  let current = '';

  for (const word of words) {
    const candidate = current ? `${current} ${word}` : word;
    if (current && context.measureText(candidate).width > maxWidth) {
      lines.push(current);
      current = word;
    } else {
      current = candidate;
    }
  }
  if (current) lines.push(current);
  return lines.slice(0, 8);
}

function canvasBlob(canvas: HTMLCanvasElement): Promise<Blob> {
  return new Promise((resolve, reject) => {
    canvas.toBlob(blob => {
      if (!blob) {
        reject(new Error('Não foi possível finalizar o modelo personalizado.'));
        return;
      }
      resolve(blob);
    }, PERSONALIZATION_MODEL_MIME_TYPE, 0.92);
  });
}

export async function composePersonalizationModel({
  source,
  customization,
  fonts,
}: {
  source: Blob | string;
  customization: TextCustomization;
  fonts: PersonalizationFont[];
}): Promise<ComposedPersonalizationModel> {
  const decoded = await decodeSource(source);
  let temporaryFontFace: FontFace | null = null;
  try {
    const dimensions = personalizationModelDimensions(decoded.width, decoded.height);
    if (!dimensions) throw new Error('A imagem usada no modelo não possui dimensões válidas.');

    const canvas = document.createElement('canvas');
    canvas.width = dimensions.width;
    canvas.height = dimensions.height;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Este navegador não permite gerar o modelo personalizado.');

    context.fillStyle = '#ffffff';
    context.fillRect(0, 0, canvas.width, canvas.height);
    context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

    const fontSize = Math.max(18, Math.round(canvas.width * personalizationTextScale(customization.texto)));
    const fontFamily = textFontCssFamily(customization.fonte, fonts, customization.fonteCssFamily);
    const fontDeclaration = `700 ${fontSize}px ${fontFamily}`;
    try {
      const selectedFont = fonts.find(font => font.id === customization.fonte && font.ativo);
      if (selectedFont?.arquivoUrl && typeof FontFace !== 'undefined' && document.fonts) {
        temporaryFontFace = await new FontFace(
          selectedFont.cssFamily,
          `url(${JSON.stringify(selectedFont.arquivoUrl)}) format("woff2")`,
          { weight: '700' },
        ).load();
        document.fonts.add(temporaryFontFace);
      }
      await document.fonts?.load(fontDeclaration, customization.texto);
    } catch {
      throw new Error('A fonte escolhida não pôde ser carregada para gerar o modelo.');
    }
    context.font = fontDeclaration;
    context.textAlign = 'center';
    context.textBaseline = 'middle';
    context.lineJoin = 'round';

    const lines = wrappedLines(context, customization.texto, canvas.width * 0.9);
    const lineHeight = fontSize * 1.18;
    const blockHeight = Math.max(lineHeight, lines.length * lineHeight);
    const centerX = canvas.width * (customization.posicao.x / 100);
    const centerY = canvas.height * (customization.posicao.y / 100);
    const firstLineY = centerY - (blockHeight / 2) + (lineHeight / 2);

    context.strokeStyle = 'rgba(0, 0, 0, 0.88)';
    context.lineWidth = Math.max(2, fontSize * 0.1);
    context.fillStyle = '#ffffff';
    lines.forEach((line, index) => {
      const y = firstLineY + index * lineHeight;
      context.strokeText(line, centerX, y, canvas.width * 0.9);
      context.fillText(line, centerX, y, canvas.width * 0.9);
    });

    let modelBlob: Blob;
    try {
      modelBlob = await canvasBlob(canvas);
    } catch (error) {
      if (error instanceof DOMException && error.name === 'SecurityError') {
        throw new Error('O servidor da imagem bloqueou a composição. Reenvie a imagem pelo painel para armazená-la no Firebase.');
      }
      throw error;
    }
    if (modelBlob.size <= 0 || modelBlob.size > MAX_PERSONALIZATION_MODEL_BYTES) {
      throw new Error('O modelo gerado ficou grande demais. Use uma imagem menor.');
    }
    return { blob: modelBlob, width: canvas.width, height: canvas.height };
  } finally {
    if (temporaryFontFace && document.fonts) document.fonts.delete(temporaryFontFace);
    decoded.dispose();
  }
}
