import type { PersonalizationFont } from "../lib/textCustomization";

/** Adding an unloaded FontFace registers its URL without starting a download. */
export function createPersonalizationFontRegistry() {
  const registry =
    typeof FontFace !== "undefined" && typeof document !== "undefined"
      ? document.fonts
      : undefined;
  const faces = new Map<string, FontFace>();
  const key = (font: PersonalizationFont) =>
    JSON.stringify([font.cssFamily, font.arquivoUrl]);
  return {
    sync(fonts: PersonalizationFont[]) {
      if (!registry) return;
      const wanted = new Map(
        fonts
          .filter((font) => font.arquivoUrl)
          .map((font) => [key(font), font]),
      );
      for (const [id, face] of faces)
        if (!wanted.has(id)) {
          registry.delete(face);
          faces.delete(id);
        }
      for (const [id, font] of wanted) {
        if (faces.has(id)) continue;
        try {
          const face = new FontFace(
            font.cssFamily,
            `url(${JSON.stringify(font.arquivoUrl)})`,
          );
          registry.add(face);
          faces.set(id, face);
        } catch (error) {
          console.error(
            `Não foi possível registrar a fonte ${font.nome}:`,
            error,
          );
        }
      }
    },
    dispose() {
      faces.forEach((face) => registry?.delete(face));
      faces.clear();
    },
  };
}

export function registerPersonalizationFonts(fonts: PersonalizationFont[]) {
  const registry = createPersonalizationFontRegistry();
  registry.sync(fonts);
  return () => registry.dispose();
}
