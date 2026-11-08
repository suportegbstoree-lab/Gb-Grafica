import test from "node:test";
import assert from "node:assert/strict";
import { planFontUploads, runFontUploads } from "./fontUploadQueue.js";
import {
  normalizePersonalizationFonts,
  personalizationFontsIssue,
} from "./textCustomization.js";
import { validateSiteConfig } from "./adminValidation.js";

const file = (name: string) =>
  new File([new Uint8Array([0, 1, 0, 0])], name, { type: "font/ttf" });

test("400 uploaded fonts survive normalization, unique-name allocation and config validation", () => {
  const rows = planFontUploads(
    Array.from({ length: 400 }, (_, i) => file(`Fonte ${i}.ttf`)),
    [],
  );
  const fonts = rows.map((row) => ({
    ...row.font,
    arquivoUrl: `https://firebasestorage.googleapis.com/catalog/fonts/${row.font.id}/original.ttf`,
  }));
  assert.ok(fonts.every(font => font.ativo === false), 'new uploaded fonts remain inactive until explicitly enabled');
  assert.equal(normalizePersonalizationFonts(fonts).length, 400);
  assert.equal(personalizationFontsIssue(fonts), null);
  const config = {
    banner_principal: "/banner.png",
    fontes_personalizacao: fonts,
  } as any;
  assert.equal(validateSiteConfig(config).ok, true);
  assert.equal(normalizePersonalizationFonts(fonts)[399].nome, "Fonte 399");
});

test("500 is a total catalog bound and duplicate filenames get distinct IDs and display names", () => {
  const fonts = planFontUploads(
    Array.from({ length: 500 }, () => file("Uma-fonte.ttf")),
    [],
  ).map((row) => row.font);
  assert.equal(new Set(fonts.map((font) => font.id)).size, 500);
  assert.equal(new Set(fonts.map((font) => font.nome)).size, 500);
  assert.equal(personalizationFontsIssue(fonts), null);
  assert.throws(() => planFontUploads([file("extra.ttf")], fonts), /500/);
  assert.throws(
    () =>
      planFontUploads(
        Array.from({ length: 501 }, () => file("a.ttf")),
        [],
      ),
    /500/,
  );
  assert.match(
    personalizationFontsIssue([
      ...fonts,
      { ...fonts[0], id: "extra", nome: "Extra" },
    ])!,
    /500/,
  );
});

test("metadata budgets reject oversized catalogs, unsafe URLs and oversized full configuration", () => {
  const fonts = planFontUploads(
    Array.from({ length: 500 }, (_, i) => file(`${i}.ttf`)),
    [],
  ).map((row) => ({
    ...row.font,
    arquivoUrl: `https://example.com/${"a".repeat(1500)}`,
  }));
  assert.match(personalizationFontsIssue(fonts)!, /512 KB/);
  assert.match(
    personalizationFontsIssue([
      { ...fonts[0], arquivoUrl: "javascript:alert(1)" },
    ])!,
    /URL/,
  );
  assert.equal(
    validateSiteConfig({
      banner_principal: "/banner.png",
      banner_subtitulo: "a".repeat(800 * 1024),
    } as any).ok,
    false,
  );
});

test("400 files run with at most 3 concurrent uploads and failures preserve every success", async () => {
  const rows = planFontUploads(
    Array.from({ length: 400 }, (_, i) => file(`${i}.ttf`)),
    [],
  );
  let active = 0,
    peak = 0;
  const uploaded: string[] = [];
  const upload = async (
    row: (typeof rows)[number],
    progress: (percent: number) => void,
  ) => {
    active++;
    peak = Math.max(peak, active);
    try {
      await new Promise<void>((resolve) => setTimeout(resolve, 0));
      progress(53);
      if (row.file.name === "17.ttf") throw new Error("Falha simulada");
      uploaded.push(row.file.name);
    } finally {
      active--;
    }
  };
  await runFontUploads(rows, {
    retryErrors: false,
    stopped: () => false,
    changed: () => {},
    upload,
  });
  assert.equal(peak, 3);
  assert.equal(rows.filter((row) => row.status === "ready").length, 399);
  assert.equal(rows.filter((row) => row.status === "error").length, 1);
  assert.equal(uploaded.length, 399);
  const retries: string[] = [];
  await runFontUploads(rows, {
    retryErrors: true,
    stopped: () => false,
    changed: () => {},
    upload: async (row) => {
      retries.push(row.file.name);
    },
  });
  assert.deepEqual(retries, ["17.ttf"]);
  assert.equal(rows.filter((row) => row.status === "ready").length, 400);
});

test("pause leaves unsent files pending and retry errors does not send those files", async () => {
  const rows = planFontUploads(
    Array.from({ length: 8 }, (_, i) => file(`${i}.ttf`)),
    [],
  );
  let stopped = false;
  await runFontUploads(rows, {
    retryErrors: false,
    stopped: () => stopped,
    changed: () => {},
    upload: async (row) => {
      await Promise.resolve();
      stopped = true;
      if (row.file.name === "0.ttf") throw new Error("Falhou");
    },
  });
  assert.equal(rows.filter((row) => row.status === "pending").length, 5);
  await runFontUploads(rows, {
    retryErrors: true,
    stopped: () => false,
    changed: () => {},
    upload: async () => {},
  });
  assert.equal(rows.filter((row) => row.status === "pending").length, 5);
  await runFontUploads(rows, {
    retryErrors: false,
    stopped: () => false,
    changed: () => {},
    upload: async () => {},
  });
  assert.equal(rows.filter((row) => row.status === "ready").length, 8);
});
