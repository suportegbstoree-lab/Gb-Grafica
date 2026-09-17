import React from 'react';
import { activePersonalizationFonts, type PersonalizationFont } from '../lib/textCustomization';

export default function PersonalizationFontLoader({ fonts }: { fonts: PersonalizationFont[] }) {
  const normalized = React.useMemo(() => activePersonalizationFonts(fonts), [fonts]);

  React.useEffect(() => {
    if (typeof FontFace === 'undefined' || !document.fonts) return undefined;
    let cancelled = false;
    const loadedFaces: FontFace[] = [];

    void Promise.all(normalized.filter(font => font.arquivoUrl).map(async font => {
      try {
        const face = new FontFace(font.cssFamily, `url(${JSON.stringify(font.arquivoUrl)}) format("woff2")`);
        const loaded = await face.load();
        if (cancelled) return;
        document.fonts.add(loaded);
        loadedFaces.push(loaded);
      } catch (error) {
        console.error(`Não foi possível carregar a fonte ${font.nome}:`, error);
      }
    }));

    return () => {
      cancelled = true;
      loadedFaces.forEach(face => document.fonts.delete(face));
    };
  }, [normalized]);

  return null;
}
