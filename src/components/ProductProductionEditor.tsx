import React from "react";
import type { Anuncio, PersonalizationFont } from "../types";
import {
  staffPdfApi,
  type StaffPdfApi,
  type StaffPdfLibrary,
} from "../services/staffPdfService";
import { uploadCatalogPdf } from "../services/catalogPdfService";
import {
  uploadCatalogImage,
  type UploadedCatalogImage,
} from "../services/catalogImageService";
import { layoutFont } from "../lib/staffPdf";
import UploadInput from "./UploadInput";
const field =
  "mt-2 w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm";
/** No advertisement URL is ever silently adopted as a new production base. */
export default function ProductProductionEditor({
  product,
  fonts = [],
  onChange,
  onUploaded,
  onBusy,
  uploadImage = uploadCatalogImage,
  uploadPdf = uploadCatalogPdf,
  api = staffPdfApi,
  canBind = true,
}: {
  product: Partial<Anuncio>;
  fonts?: PersonalizationFont[];
  onChange: (p: Partial<Anuncio>) => void;
  onUploaded: (files: Array<{ path: string; url: string }>) => void;
  onBusy: (busy: boolean) => void;
  uploadImage?: (id: string, f: File) => Promise<UploadedCatalogImage>;
  uploadPdf?: typeof uploadCatalogPdf;
  api?: StaffPdfApi;
  canBind?: boolean;
}) {
  const [library, setLibrary] = React.useState<StaffPdfLibrary>();
  const [baseId, setBase] = React.useState(product.moldePdf?.baseId || ""),
    [layoutId, setLayout] = React.useState(product.moldePdf?.layoutId || "");
  const [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState("");
  const run = async (work: () => Promise<void>) => {
    setBusy(true);
    onBusy(true);
    setError("");
    try {
      await work();
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
      onBusy(false);
    }
  };
  return (
    <fieldset
      disabled={busy}
      className="space-y-4 rounded-xl border border-gray-700 p-4 md:col-span-2"
    >
      <legend className="px-2 font-bold">Arte de produção</legend>
      <p className="text-xs text-gray-400">
        As imagens do anúncio servem para divulgação. Escolha aqui a base usada
        para imprimir. O envio de imagem pelo cliente é opcional quando há uma
        base.
      </p>
      <label className="inline-flex cursor-pointer rounded-lg border border-gray-600 px-4 py-3 text-sm">
        Enviar imagem-base
        <UploadInput
          className="sr-only"
          type="file"
          aria-label="Enviar imagem-base"
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f)
              void run(async () => {
                if (!product.id) throw new Error("Produto inválido.");
                const file = await uploadImage(product.id, f);
                onUploaded([file]);
                onChange({ ...product, imagemBase: file.url });
              });
          }}
        />
      </label>
      {product.imagemBase && (
        <div className="flex items-center gap-3">
          <img
            src={product.imagemBase}
            alt="Imagem-base de impressão"
            className="h-28 w-28 object-contain"
          />
          <button
            type="button"
            onClick={() => {
              const { imagemBase, ...rest } = product;
              onChange(rest);
            }}
            className="text-sm text-red-300"
          >
            Remover imagem-base
          </button>
        </div>
      )}
      {canBind && (
        <>
          <button
            type="button"
            onClick={() => void run(async () => setLibrary(await api.list()))}
            className="rounded-lg border border-gray-600 px-4 py-3 text-sm"
          >
            Carregar bases e moldes da oficina
          </button>
          {library && (
            <>
              <label className="block text-sm">
                Base PDF
                <select
                  aria-label="Base PDF do produto"
                  className={field}
                  value={baseId}
                  onChange={(e) => setBase(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {library.bases.map((b) => (
                    <option key={b.id} value={b.id}>
                      {b.name}
                    </option>
                  ))}
                </select>
              </label>
              <label className="block text-sm">
                Molde de edição
                <select
                  aria-label="Molde de edição do produto"
                  className={field}
                  value={layoutId}
                  onChange={(e) => setLayout(e.target.value)}
                >
                  <option value="">Selecione</option>
                  {library.layouts.map((l) => (
                    <option key={l.id} value={l.id}>
                      {l.name}
                    </option>
                  ))}
                </select>
              </label>
              <button
                type="button"
                disabled={!baseId || !layoutId}
                className="rounded-lg bg-purple-500 px-4 py-3 text-sm disabled:opacity-40"
                onClick={() =>
                  void run(async () => {
                    const base = library.bases.find((b) => b.id === baseId),
                      layout = library.layouts.find((l) => l.id === layoutId);
                    if (!base || !layout || !product.id)
                      throw new Error("Selecione a base e o molde.");
                    const font = layoutFont(layout.layout, fonts);
                    if (layout.layout.font_name && !font)
                      throw new Error(
                        "Cadastre a fonte do molde antes de vincular.",
                      );
                    const original = await api.baseFile(base.id),
                      result = await uploadPdf(
                        product.id,
                        new File(
                          [original],
                          /\.pdf$/i.test(base.name)
                            ? base.name
                            : base.name + ".pdf",
                          { type: "application/pdf" },
                        ),
                        16,
                      );
                    onUploaded([
                      ...result.images,
                      { path: result.template.path, url: result.template.path },
                    ]);
                    if (base.initialLetters?.length) {
                      const letters: Record<
                        string,
                        { path: string; url: string }
                      > = {};
                      let sizePercent = 60;
                      for (const letter of base.initialLetters) {
                        const initial = await api.initial(base.id, letter);
                        if (!initial || !(initial.source instanceof Blob))
                          throw new Error(
                            "A inicial mudou. Carregue a biblioteca novamente.",
                          );
                        const image = await uploadImage(
                          product.id,
                          new File([initial.source], letter + ".png", {
                            type: "image/png",
                          }),
                        );
                        onUploaded([image]);
                        letters[letter] = { path: image.path, url: image.url };
                        sizePercent = initial.sizePercent;
                      }
                      result.template.alphabet = {
                        folderName: base.name.replace(/\.pdf$/i, ""),
                        sizePercent,
                        letters,
                      };
                    }
                    const { printProfile, ...productionProduct } = product;
                    onChange({
                      ...productionProduct,
                      moldePdf: {
                        revision: crypto.randomUUID().replaceAll("-", ""),
                        baseId: base.id,
                        baseRevision: base.revision,
                        layoutId: layout.id,
                        layoutRevision: layout.revision,
                        layout: layout.layout,
                        fonts: font ? [font] : [],
                        pdf: result.template,
                      },
                    });
                  })
                }
              >
                Vincular / atualizar molde
              </button>
            </>
          )}
        </>
      )}
      {product.moldePdf && (
        <div className="rounded-lg bg-black/30 p-3 text-sm">
          <p>
            Vinculado: {product.moldePdf.pdf.name} ·{" "}
            {product.moldePdf.pdf.pages.length} páginas
          </p>
          <p className="mt-2 text-xs text-gray-400">
            Posição, fonte, tamanho e cor seguem o molde. Para publicar mudanças
            da oficina, atualize este vínculo. Pedidos anteriores mantêm a
            versão comprada.
          </p>
          <button
            type="button"
            className="mt-2 text-red-300"
            onClick={() => {
              const { moldePdf, ...rest } = product;
              onChange(rest);
            }}
          >
            Desvincular molde
          </button>
        </div>
      )}
      {busy && (
        <p role="status" className="text-sm">
          Preparando arte de produção…
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
    </fieldset>
  );
}
