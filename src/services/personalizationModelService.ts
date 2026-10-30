import { textLayers } from '../lib/textLines';
import { personalizationTextLayout } from '../lib/personalizationTextLayout';
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

export interface DecodedImage {
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

export async function decodePersonalizationSource(source: Blob | string): Promise<DecodedImage> {
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

export function personalizationFontSize(width: number, customization: TextCustomization): number {
  return width * (customization.tamanhoFonte !== undefined ? customization.tamanhoFonte / 100 : personalizationTextScale(customization.texto));
}

export async function preparePersonalizationFont(customization: TextCustomization | null | undefined, fonts: PersonalizationFont[]): Promise<() => void> {
  if (!customization) return () => undefined;
  const faces: FontFace[] = [];
  const layers = textLayers(customization);
  try {
    const used = new Set<string>();
    for (const layer of layers) {
      if (used.has(layer.value.fonte)) continue;
      used.add(layer.value.fonte);
      const selected = fonts.find(font => font.id === layer.value.fonte && font.ativo);
      if (selected?.arquivoUrl && typeof FontFace !== 'undefined' && document.fonts) {
        const face = await new FontFace(selected.cssFamily, `url(${JSON.stringify(selected.arquivoUrl)})`, { weight: '700' }).load();
        document.fonts.add(face); faces.push(face);
      }
      await document.fonts?.load(`700 32px ${textFontCssFamily(layer.value.fonte, fonts, layer.value.fonteCssFamily)}`, layer.value.texto || 'A');
    }
  } catch {
    faces.forEach(face => document.fonts?.delete(face));
    throw new Error('Uma das fontes escolhidas não pôde ser carregada para gerar o modelo.');
  }
  return () => faces.forEach(face => document.fonts?.delete(face));
}

export interface PersonalizationTextBox {
  id: string; index: number; x: number; y: number; width: number; height: number;
}

export function personalizationLayerLayout(context: CanvasRenderingContext2D, width: number, height: number, customization: TextCustomization, fonts: PersonalizationFont[]) {
  const fontSize = personalizationFontSize(width, customization);
  if (!Number.isFinite(fontSize) || fontSize <= 0) throw new Error('Informe um tamanho válido para a linha.');
  context.font = `700 ${fontSize}px ${textFontCssFamily(customization.fonte, fonts, customization.fonteCssFamily)}`;
  return personalizationTextLayout(width, height, customization, text => context.measureText(text).width);
}

export function drawPersonalizationText(context: CanvasRenderingContext2D, width: number, height: number, customization: TextCustomization, fonts: PersonalizationFont[]): PersonalizationTextBox[] {
  const boxes: PersonalizationTextBox[] = [];
  for (const layer of textLayers(customization)) {
    const layout = personalizationLayerLayout(context, width, height, layer.value, fonts);
    const { fontSize } = layout;
    context.textAlign = 'center'; context.textBaseline = 'middle'; context.lineJoin = 'round';
    const color = layer.value.cor || '#ffffff';
    const rgb = [1, 3, 5].map(index => parseInt(color.slice(index, index + 2), 16));
    context.strokeStyle = rgb[0] * 0.299 + rgb[1] * 0.587 + rgb[2] * 0.114 < 128 ? 'rgba(255,255,255,0.88)' : 'rgba(0,0,0,0.88)';
    context.lineWidth = fontSize * 0.1; context.fillStyle = color;
    layout.lines.forEach((line, index) => {
      const y = layout.firstLineY + index * layout.lineHeight;
      context.strokeText(line, layout.centerX, y); context.fillText(line, layout.centerX, y);
    });
    if (layer.value.texto.trim()) {
      const boxWidth = Math.max(...layout.lines.map(line => context.measureText(line).width)) + context.lineWidth;
      const boxHeight = layout.lines.length * layout.lineHeight + context.lineWidth;
      boxes.push({ id: layer.id, index: layer.index,
        x: (layout.centerX - boxWidth / 2) / width * 100,
        y: (layout.firstLineY - layout.lineHeight / 2 - context.lineWidth / 2) / height * 100,
        width: boxWidth / width * 100, height: boxHeight / height * 100,
      });
    }
  }
  return boxes;
}

export function personalizationCanvasBlob(canvas: HTMLCanvasElement, type = PERSONALIZATION_MODEL_MIME_TYPE): Promise<Blob> {
	return new Promise((resolve, reject) => {
		canvas.toBlob(blob => {
			if (!blob) {
				reject(new Error('Não foi possível finalizar o modelo personalizado.'));
				return;
			}
			resolve(blob);
		}, type, 1);
	});
}

export async function composePersonalizationModel({
	source,
	customization,
	fonts,
}: {
	source: Blob | string;
	customization?: TextCustomization | null;
	fonts: PersonalizationFont[];
}): Promise<ComposedPersonalizationModel> {
	const decoded = await decodePersonalizationSource(source);
	let releaseFont = () => undefined;
	const canvas = document.createElement('canvas');
	try {
		const dimensions = personalizationModelDimensions(decoded.width, decoded.height);
		if (!dimensions) throw new Error('Não é possível compor esta imagem na resolução original neste navegador. A imagem não foi reduzida.');

		canvas.width = dimensions.width;
		canvas.height = dimensions.height;
		const context = canvas.getContext('2d');
		if (!context) throw new Error('Este navegador não permite gerar o modelo personalizado.');

		context.fillStyle = '#ffffff';
		context.fillRect(0, 0, canvas.width, canvas.height);
		context.drawImage(decoded.source, 0, 0, canvas.width, canvas.height);

		if (customization) {
      releaseFont = await preparePersonalizationFont(customization, fonts);
      drawPersonalizationText(context, canvas.width, canvas.height, customization, fonts);
    }

		let modelBlob: Blob;
		try {
			modelBlob = await personalizationCanvasBlob(canvas);
		} catch (error) {
			if (error instanceof DOMException && error.name === 'SecurityError') {
				throw new Error('O servidor da imagem bloqueou a composição. Reenvie a imagem pelo painel para armazená-la no Firebase.');
			}
			throw error;
		}
		if (modelBlob.size <= 0 || modelBlob.size > MAX_PERSONALIZATION_MODEL_BYTES) {
			throw new Error('O modelo em resolução original excedeu 15 MB. Escolha outra imagem; nenhuma redução de qualidade foi aplicada.');
		}
		return { blob: modelBlob, width: canvas.width, height: canvas.height };
	} finally {
		releaseFont();
		decoded.dispose();
		canvas.width = canvas.height = 1;
	}
}
