/** Folder names are metadata; they are never used to build Storage paths. */
export interface DecorativeAlphabet {
  folderName: string;
  /** Maximum width and height relative to the page; the complete PNG canvas is centered. */
  sizePercent: number;
  letters: Record<string, { path: string; url: string }>;
}

export interface DecorativeInitial {
  source: Blob | string;
  sizePercent: number;
}

export function pdfBaseName(name: string): string {
  return name.replace(/\.pdf$/i, '').normalize('NFC').trim();
}

export function matchingAlphabetName(pdfName: string, folderName: string): boolean {
  return pdfBaseName(pdfName) === folderName.normalize('NFC').trim();
}

/** Ignore leading whitespace, but never skip a digit or symbol to choose another letter. */
export function firstInitial(text: string): string | undefined {
  const first = [...text.trimStart()][0];
  if (!first) return undefined;
  const letter = first.normalize('NFD').replace(/\p{M}/gu, '').toUpperCase();
  return /^[A-Z]$/.test(letter) ? letter : undefined;
}

export function isAlphabetImagePath(path: unknown, productId: string): path is string {
  return typeof path === 'string' && /^[A-Za-z0-9_-]{1,100}$/.test(productId) &&
    new RegExp(`^catalog/products/${productId}/[a-f0-9]{32}\\.png$`).test(path);
}

export function validAlphabet(value: unknown, pdfName: string, productId: string): value is DecorativeAlphabet {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const alphabet = value as DecorativeAlphabet;
  if (typeof alphabet.folderName !== 'string' || alphabet.folderName.length > 120 ||
    !matchingAlphabetName(pdfName, alphabet.folderName) || !Number.isFinite(alphabet.sizePercent) ||
    alphabet.sizePercent < 5 || alphabet.sizePercent > 100 || !alphabet.letters ||
    typeof alphabet.letters !== 'object' || Array.isArray(alphabet.letters)) return false;
  const letters = Object.entries(alphabet.letters);
  return letters.length > 0 && letters.length <= 26 && letters.every(([letter, image]) =>
    /^[A-Z]$/.test(letter) && image && isAlphabetImagePath(image.path, productId) &&
    typeof image.url === 'string' && image.url.length <= 4096 &&
    /^(https?:\/\/|\/[^/])/.test(image.url));
}

export function selectedInitial(template: { name: string; alphabet?: DecorativeAlphabet } | undefined, text: string, sizePercent?: number) {
  const alphabet = template?.alphabet;
  const letter = firstInitial(text);
  if (!template || !alphabet || !matchingAlphabetName(template.name, alphabet.folderName) || !letter) return undefined;
  const image = Object.hasOwn(alphabet.letters, letter) ? alphabet.letters[letter] : undefined;
  return image ? { ...image, letter, sizePercent: sizePercent ?? alphabet.sizePercent } : undefined;
}

/** Binds the approved preview to the canonical catalog selection, including the absence of a letter. */
export function initialReference(template: { name: string; alphabet?: DecorativeAlphabet } | undefined, text: string, sizePercent?: number): string {
  const initial = selectedInitial(template, text, sizePercent);
  return JSON.stringify(initial ? [initial.letter, initial.path, initial.sizePercent] : null);
}

export function centeredInitialBox(pageWidth: number, pageHeight: number, imageWidth: number, imageHeight: number, sizePercent: number) {
  if (![pageWidth, pageHeight, imageWidth, imageHeight].every(n => Number.isFinite(n) && n > 0) ||
    !Number.isFinite(sizePercent) || sizePercent < 5 || sizePercent > 100) throw new Error('Dimensões da inicial inválidas.');
  const scale = Math.min(pageWidth / imageWidth, pageHeight / imageHeight) * sizePercent / 100;
  const width = imageWidth * scale, height = imageHeight * scale;
  return { x: (pageWidth - width) / 2, y: (pageHeight - height) / 2, width, height };
}

export function alphabetUrls(templates: { alphabet?: DecorativeAlphabet }[] = []): string[] {
  return templates.flatMap(template => Object.values(template.alphabet?.letters || {}).map(image => image.url));
}

export function isFolderMetadata(file: File): boolean {
  const subfolders = file.webkitRelativePath?.split('/').slice(1, -1) ?? [];
  return [...subfolders, file.name].some(part =>
    part.startsWith('.') || /^(?:__macosx|thumbs\.db|desktop\.ini)$/i.test(part));
}

export function readAlphabetFiles(files: File[], pdfName: string): { folderName: string; letters: Array<{ letter: string; file: File }> } {
  const images = files.filter(file => !isFolderMetadata(file));
  if (!images.length) throw new Error('Selecione uma pasta com A.png até Z.png.');
  if (images.some(file => !file.webkitRelativePath?.includes('/')))
    throw new Error('Selecione a pasta inteira pelo botão de importar letras.');
  const folder = images[0].webkitRelativePath.split('/').slice(0, -1);
  const folderName = folder.at(-1);
  if (!folderName || !matchingAlphabetName(pdfName, folderName)) throw new Error(`A pasta deve se chamar “${pdfBaseName(pdfName)}”, exatamente como o PDF sem a extensão.`);
  const letters: Array<{ letter: string; file: File }> = [], used = new Set<string>();
  for (const file of images) {
    const parts = file.webkitRelativePath.split('/');
    const match = /^([A-Z])\.png$/i.exec(file.name);
    if (parts.slice(0, -1).join('/') !== folder.join('/') || !match) throw new Error('Use somente A.png até Z.png diretamente dentro da pasta, sem subpastas.');
    const letter = match[1].toUpperCase();
    if (used.has(letter)) throw new Error(`A letra ${letter} está duplicada.`);
    if (file.size <= 0 || file.size > 50 * 1024 * 1024) throw new Error(`A letra ${letter} excede o limite de 50 MB.`);
    used.add(letter); letters.push({ letter, file });
  }
  if (!letters.length || letters.length > 26) throw new Error('A pasta precisa conter entre 1 e 26 letras PNG.');
  return { folderName, letters: letters.sort((a, b) => a.letter.localeCompare(b.letter)) };
}
