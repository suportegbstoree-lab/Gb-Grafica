import test from "node:test";
import assert from "node:assert/strict";
import { createPersonalizationFontRegistry } from "./personalizationFontRegistration";

test("registering 500 fonts does not call load and cleanup only removes its own faces", () => {
  const previousDocument = Object.getOwnPropertyDescriptor(
    globalThis,
    "document",
  );
  const previousFontFace = Object.getOwnPropertyDescriptor(
    globalThis,
    "FontFace",
  );
  const faces = new Set<unknown>();
  const originalFace = {};
  faces.add(originalFace);
  let downloads = 0;
  class LazyFace {
    constructor(
      public family: string,
      public source: string,
    ) {}
    load() {
      downloads++;
      return Promise.resolve(this);
    }
  }
  try {
    Object.defineProperty(globalThis, "FontFace", {
      configurable: true,
      value: LazyFace,
    });
    Object.defineProperty(globalThis, "document", {
      configurable: true,
      value: {
        fonts: {
          add: (face: unknown) => faces.add(face),
          delete: (face: unknown) => faces.delete(face),
        },
      },
    });
    const fonts = Array.from({ length: 500 }, (_, i) => ({
      id: `font${i}`,
      nome: `Fonte ${i}`,
      cssFamily: `Font${i}`,
      arquivoUrl: `https://example.com/${i}.ttf`,
      ativo: true,
    }));
    const registry = createPersonalizationFontRegistry();
    registry.sync(fonts);
    assert.equal(faces.size, 501);
    assert.equal(downloads, 0);
    const sameFaces = [...faces];
    registry.sync(structuredClone(fonts));
    assert.deepEqual([...faces], sameFaces);
    registry.sync(fonts.slice(0, 1));
    assert.equal(faces.size, 2);
    registry.dispose();
    assert.deepEqual([...faces], [originalFace]);
  } finally {
    if (previousDocument)
      Object.defineProperty(globalThis, "document", previousDocument);
    else Reflect.deleteProperty(globalThis, "document");
    if (previousFontFace)
      Object.defineProperty(globalThis, "FontFace", previousFontFace);
    else Reflect.deleteProperty(globalThis, "FontFace");
  }
});
