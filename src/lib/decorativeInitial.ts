export const DEFAULT_DECORATIVE_INITIAL_PERCENT = 50;

export const MAX_ALPHABET_LETTERS = 64;

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

export function alphabetFolderName(name: string): string {
  const stem = pdfBaseName(name);
  return stem.replace(/_template(?:__?\d+p)?$/i, '').trimEnd() || stem;
}

export function matchingAlphabetName(name: string, folderName: string): boolean {
  const folder = folderName.normalize('NFC').trim();
  return folder === alphabetFolderName(name) || folder === pdfBaseName(name);
}

export function validDecorativePngHeader(bytes: Uint8Array): boolean {
  if (bytes.length < 33) return false;
  const header = new DataView(bytes.buffer, bytes.byteOffset, bytes.byteLength);
  const width = header.getUint32(16), height = header.getUint32(20);
  return header.getUint32(0) === 0x89504e47 &&
    header.getUint32(4) === 0x0d0a1a0a &&
    header.getUint32(8) === 13 &&
    header.getUint32(12) === 0x49484452 &&
    width > 0 && height > 0 &&
    width <= 16384 && height <= 16384 && width * height <= 64_000_000;
}

function unaccentedLetter(letter: string): string {
  return letter.normalize('NFD').replace(/\p{M}/gu, '');
}

export function isAlphabetLetter(letter: string): boolean {
  return letter === letter.normalize('NFC') && /^\p{Script=Latin}$/u.test(letter) && /^[A-Z]$/.test(unaccentedLetter(letter));
}

/** Ignore leading whitespace, but never skip a digit or symbol to choose another letter. */
export function firstInitial(text: string): string | undefined {
  const first = [...text.trimStart().normalize('NFC')][0];
  const letter = first?.toUpperCase().normalize('NFC');
  return letter && isAlphabetLetter(letter) ? letter : undefined;
}

export function findAlphabetLetter(letters: Record<string, unknown> | undefined, text: string): string | undefined {
  const letter = firstInitial(text);
  if (!letters || !letter) return undefined;
  if (Object.hasOwn(letters, letter)) return letter;
  const fallback = unaccentedLetter(letter);
  return Object.hasOwn(letters, fallback) ? fallback : undefined;
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
  return letters.length > 0 && letters.length <= MAX_ALPHABET_LETTERS && letters.every(([letter, image]) =>
    isAlphabetLetter(letter) && image && isAlphabetImagePath(image.path, productId) &&
    typeof image.url === 'string' && image.url.length <= 4096 &&
    /^(https?:\/\/|\/[^/])/.test(image.url));
}

export function selectedInitial(template: { name: string; alphabet?: DecorativeAlphabet } | undefined, text: string, sizePercent?: number) {
  const alphabet = template?.alphabet;
  if (!template || !alphabet || !matchingAlphabetName(template.name, alphabet.folderName)) return undefined;
  const letter = findAlphabetLetter(alphabet.letters, text);
  if (!letter) return undefined;
  const image = alphabet.letters[letter];
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

export function readAlphabetFiles(files: File[], modelName: string): { folderName: string; letters: Array<{ letter: string; file: File }> } {
  const images = files.filter(file => !isFolderMetadata(file));
  if (!images.length) throw new Error('Selecione uma pasta com imagens de letras, como A.png e É.png.');
  if (images.length > MAX_ALPHABET_LETTERS) throw new Error(`A pasta pode conter até ${MAX_ALPHABET_LETTERS} letras PNG.`);
  if (images.some(file => !file.webkitRelativePath?.includes('/')))
    throw new Error('Selecione a pasta inteira pelo botão de importar letras.');
  const folder = images[0].webkitRelativePath.split('/').slice(0, -1);
  const folderName = folder.at(-1);
  if (!folderName || !matchingAlphabetName(modelName, folderName)) throw new Error(`A pasta “${folderName || ''}” não corresponde a “${modelName}”. Selecione a pasta “${alphabetFolderName(modelName)}”.`);
  const letters: Array<{ letter: string; file: File }> = [], used = new Set<string>();
  for (const file of images) {
    const parts = file.webkitRelativePath.split('/');
    const letter = /\.png$/i.test(file.name) ? file.name.slice(0, -4).toUpperCase().normalize('NFC') : '';
    if (parts.slice(0, -1).join('/') !== folder.join('/') || !isAlphabetLetter(letter))
      throw new Error(`“${file.name}” é inválido. Use um PNG por letra, como A.png e É.png, na pasta selecionada.`);
    if (used.has(letter)) throw new Error(`A letra ${letter} está duplicada.`);
    if (!file.size) throw new Error(`O arquivo “${file.name}” está vazio.`);
    if (file.size > 50 * 1024 * 1024) throw new Error(`A letra ${letter} excede o limite de 50 MB.`);
    used.add(letter); letters.push({ letter, file });
  }
  return { folderName, letters: letters.sort((a, b) => a.letter.localeCompare(b.letter)) };
}
