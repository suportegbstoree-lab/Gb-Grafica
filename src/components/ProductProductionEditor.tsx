import React from "react";
import type { Anuncio, PersonalizationFont } from "../types";
import {
  staffPdfApi,
  type StaffPdfApi,
  type StaffPdfLibrary,
} from "../services/staffPdfService";
import { Search } from "lucide-react";
import { readStaffPdf } from "../services/staffPdfRequest";
import { pdfPreviewPages } from "../services/pdfPreview";
import { uploadBatch } from "../lib/uploadBatch";
import { retireCatalogAsset } from "../services/catalogRetentionService";
import {
  uploadCatalogImage,
  type UploadedCatalogImage,
} from "../services/catalogImageService";
import { layoutFont, matchPdfLayout } from "../lib/staffPdf";
import UploadInput from "./UploadInput";
const field =
  "mt-2 w-full rounded-lg border border-gray-700 bg-black px-3 py-2 text-sm";
const compareNames = new Intl.Collator("pt-BR", {
  sensitivity: "base",
  numeric: true,
});
const searchableName = (value: string) =>
  value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();

function LibrarySelect({
  label,
  options,
  value,
  onChange,
}: {
  label: string;
  options: { id: string; name: string }[];
  value: string;
  onChange: (id: string) => void;
}) {
  const [searching, setSearching] = React.useState(false);
  const [query, setQuery] = React.useState("");
  const filterId = React.useId();
  const search = searchableName(query.trim());
  const visible = options
    .filter(
      (row) => row.id === value || searchableName(row.name).includes(search),
    )
    .sort((a, b) => compareNames.compare(a.name, b.name));
  return (
    <div className="space-y-2">
      <div className="flex items-end gap-2">
        <label className="min-w-0 flex-1 text-sm">
          {label}
          <select
            aria-label={`${label} do produto`}
            className={field}
            value={value}
            onChange={(event) => {
              onChange(event.target.value);
              setQuery("");
              setSearching(false);
            }}
          >
            <option value="">Selecione</option>
            {visible.map((row) => (
              <option key={row.id} value={row.id}>
                {row.name}
              </option>
            ))}
          </select>
        </label>
        <button
          type="button"
          aria-label={`Buscar ${label.toLowerCase()}`}
          aria-expanded={searching}
          aria-controls={filterId}
          className="rounded-lg border border-gray-700 p-2"
          onClick={() => {
            setSearching(!searching);
            setQuery("");
          }}
        >
          <Search size={18} aria-hidden="true" />
        </button>
      </div>
      {searching && (
        <input
          id={filterId}
          autoFocus
          type="search"
          aria-label={`Filtrar ${label.toLowerCase()} pelo nome`}
          placeholder="Filtrar por nome"
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter") event.preventDefault();
          }}
          className={field}
        />
      )}
      {searching &&
        search &&
        !visible.some((row) => searchableName(row.name).includes(search)) && (
          <p className="text-xs text-gray-400">Nenhum resultado.</p>
        )}
    </div>
  );
}

export interface ProductProductionEditorProps {
  product: Partial<Anuncio>;
  fonts?: PersonalizationFont[];
  onChange: (p: Partial<Anuncio>) => void;
  onUploaded: (files: Array<{ path: string; url: string }>) => void;
  onBusy: (busy: boolean) => void;
  uploadImage?: (id: string, f: File) => Promise<UploadedCatalogImage>;
  api?: StaffPdfApi;
  canBind?: boolean;
  disabled?: boolean;
  optionLabel?: string;
}

/** No advertisement URL is ever silently adopted as a new production base. */
export default function ProductProductionEditor({
  product,
  fonts = [],
  onChange,
  onUploaded,
  onBusy,
  uploadImage = uploadCatalogImage,
  api = staffPdfApi,
  canBind = true,
  disabled = false,
  optionLabel,
}: ProductProductionEditorProps) {
  const latestProduct = React.useRef(product);
  latestProduct.current = product;
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
      disabled={disabled || busy}
      className="space-y-4 rounded-xl border border-gray-700 p-4 md:col-span-2"
    >
      <legend className="px-2 font-bold">
        {optionLabel ? "Base desta opção" : "Arte de produção"}
      </legend>
      <p className="text-xs text-gray-400">
        {optionLabel
          ? "Envie uma imagem-base ou vincule um PDF com molde. Sem vínculo próprio, a opção usa a arte do produto."
          : "As imagens do anúncio servem para divulgação. Escolha aqui a base usada para imprimir. O envio de imagem pelo cliente é opcional quando há uma base."}
      </p>
      <label className="inline-flex cursor-pointer rounded-lg border border-gray-600 px-4 py-3 text-sm">
        Enviar imagem-base
        <UploadInput
          className="sr-only"
          type="file"
          aria-label={
            optionLabel
              ? `Enviar imagem-base de ${optionLabel}`
              : "Enviar imagem-base"
          }
          accept="image/png,image/jpeg,image/webp"
          onChange={(e) => {
            const f = e.target.files?.[0];
            e.target.value = "";
            if (f)
              void run(async () => {
                if (!product.id) throw new Error("Produto inválido.");
                const file = await uploadImage(product.id, f);
                onUploaded([file]);
                const next = { ...latestProduct.current, imagemBase: file.url };
                if (optionLabel) delete next.moldePdf;
                onChange(next);
              });
          }}
        />
      </label>
      {product.imagemBase && (
        <div className="flex items-center gap-3">
          <img
            src={product.imagemBase}
            alt="Imagem-base de impressão"
            loading="lazy"
            decoding="async"
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
            {optionLabel ? "Usar arte do produto" : "Remover imagem-base"}
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
              <LibrarySelect
                label="Base PDF"
                options={library.bases}
                value={baseId}
                onChange={(id) => {
                  setBase(id);
                  const base = library.bases.find((row) => row.id === id);
                  setLayout(
                    base
                      ? matchPdfLayout(
                          base.name,
                          base.pageCount,
                          library.layouts,
                          id,
                        )?.id || ""
                      : "",
                  );
                }}
              />
              <LibrarySelect
                label="Molde de edição"
                options={library.layouts}
                value={layoutId}
                onChange={setLayout}
              />
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
                    const previous = product.moldePdf;
                    let template =
                      previous?.baseId === base.id &&
                      previous.baseRevision === base.revision
                        ? previous.pdf
                        : undefined;
                    if (!template) {
                      const prepared = await api.prepareProductCopy(
                        product.id,
                        base,
                      );
                      onUploaded(prepared.assets);
                      template = prepared.template;
                      if (prepared.sourceUrl) {
                        const pdf = await readStaffPdf(prepared.sourceUrl);
                        const pages = await pdfPreviewPages(pdf, 16);
                        const images = await uploadBatch(
                          pages,
                          (page) => uploadImage(product.id!, page),
                          {
                            rollback: (file) => retireCatalogAsset(file.path),
                          },
                        );
                        onUploaded(images);
                        template = {
                          ...template,
                          pages: images.map((image) => image.url),
                        };
                      }
                    }
                    const { printProfile, ...productionProduct } =
                      latestProduct.current;
                    if (optionLabel) delete productionProduct.imagemBase;
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
                        pdf: template,
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
            {optionLabel ? "Usar arte do produto" : "Desvincular molde"}
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
