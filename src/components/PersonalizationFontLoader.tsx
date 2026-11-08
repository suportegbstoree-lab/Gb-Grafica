import React from 'react';
import { normalizePersonalizationFonts, type PersonalizationFont } from '../lib/textCustomization';
import { createPersonalizationFontRegistry } from '../services/personalizationFontRegistration';

export default function PersonalizationFontLoader({ fonts, includeInactive = false }: { fonts: PersonalizationFont[]; includeInactive?: boolean }) {
  const normalized = React.useMemo(() => normalizePersonalizationFonts(fonts).filter(font => includeInactive || font.ativo), [fonts, includeInactive]);

  const registry = React.useMemo(() => createPersonalizationFontRegistry(), []);
  React.useEffect(() => { registry.sync(normalized); }, [registry, normalized]);
  React.useEffect(() => () => registry.dispose(), [registry]);

  return null;
}
