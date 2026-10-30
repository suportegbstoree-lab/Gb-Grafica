import { adminFontUploadType, isAllowedAdminFont, matchesAdminFontSignature, MAX_ADMIN_FONT_BYTES } from '../lib/adminAsset';

export async function validateAdminFontFile(file: File): Promise<string> {
  const normalizedContentType = adminFontUploadType(file.name, file.type);
  if (!normalizedContentType || !isAllowedAdminFont(normalizedContentType, file.size)) {
    throw new Error(`Envie uma fonte WOFF2, TTF ou OTF com no máximo ${MAX_ADMIN_FONT_BYTES / 1024 / 1024} MB.`);
  }
  const bytes = await file.arrayBuffer();
  if (!matchesAdminFontSignature(normalizedContentType, new Uint8Array(bytes))) {
    throw new Error('O conteúdo da fonte não corresponde ao formato informado.');
  }
  try { await new FontFace('GBFontValidation', bytes).load(); }
  catch { throw new Error('O arquivo de fonte está inválido ou não é compatível com este navegador.'); }
  return normalizedContentType;
}
