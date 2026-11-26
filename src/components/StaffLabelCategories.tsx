import React from "react";
import { Upload } from "lucide-react";
import {
  identifyProduct,
  missingLabelCategories,
  type LabelCategoryApi,
  type LabelCategoryDirectory,
  type LabelImport,
  type ImportedLabel,
  type ImportedProduct,
} from "../lib/staffLabelImport";
import { listLabelImports, readLabelImport, updateLabelImport } from "../services/staffLabelImport";

const button =
  "rounded-lg border border-gray-700 px-3 py-2 text-sm hover:border-pink-400 focus-visible:outline-pink-400 disabled:opacity-50";
const input = "min-w-0 rounded-lg border border-gray-700 bg-black p-2 text-sm";
const emptyDirectory: LabelCategoryDirectory = { categories: [], assignments: {} };
function productName(p: ImportedProduct) {
  return [p.description, p.variation, p.sku && "SKU " + p.sku].filter(Boolean).join(" · ");
}
function pendingProducts(pages: ImportedLabel[], assignments: Record<string, string>) {
  const products = new Map<string, { product: ImportedProduct; pages: number[] }>();
  for (const [i, page] of pages.entries()) {
    for (const p of new Map(page.products.map((p) => [p.key, p])).values()) {
      if (assignments[p.key]) continue;
      const group = products.get(p.key) ?? { product: p, pages: [] };
      group.pages.push(i + 1);
      products.set(p.key, group);
    }
  }
  return [...products.values()];
}
const allKeys = (records: LabelImport[]) => [
  ...new Set(
    records
      .filter((r) => !r.completed)
      .flatMap((r) => r.pages.flatMap((p) => p.products.map((item) => item.key))),
  ),
];

function IdentifyLabel({
  originalUrl,
  page,
  issue,
  busy,
  save,
}: {
  originalUrl: string;
  page: number;
  issue: string;
  busy: boolean;
  save: (products: ImportedProduct[]) => Promise<void>;
}) {
  const newRow = () => ({ id: crypto.randomUUID(), sku: "", description: "", variation: "" });
  const [rows, setRows] = React.useState(() => [newRow()]);
  return (
    <details className="rounded-lg border border-amber-800 p-3">
      <summary className="cursor-pointer">Página {page} · Identificar produtos manualmente</summary>
      <p className="my-2 text-sm text-amber-200">{issue} Confira todos os itens antes de confirmar.</p>
      {originalUrl ? (
        <a
          href={originalUrl + "#page=" + page}
          target="_blank"
          rel="noreferrer"
          className="text-sm underline"
        >
          Conferir página no PDF
        </a>
      ) : (
        <span className="text-xs text-gray-400">
          Selecione o PDF original novamente para consultar esta página.
        </span>
      )}
      <form
        className="mt-3 space-y-2"
        onSubmit={async (e) => {
          e.preventDefault();
          if (busy || rows.some((row) => !(row.sku.trim() || row.description.trim()))) return;
          await save(
            await Promise.all(
              rows.map((row) =>
                identifyProduct({
                  sku: row.sku.trim(),
                  description: row.description.trim(),
                  variation: row.variation.trim(),
                }),
              ),
            ),
          );
        }}
      >
        {rows.map((row) => (
          <fieldset key={row.id} disabled={busy} className="flex flex-wrap items-end gap-2">
            {(["sku", "description", "variation"] as const).map((field, i) => (
              <label className="grid text-xs" key={field}>
                {["SKU", "Descrição", "Variação"][i]}
                <input
                  className={input}
                  maxLength={250}
                  value={row[field]}
                  onChange={(e) => {
                    const value = e.target.value;
                    setRows((previous) =>
                      previous.map((item) => (item.id === row.id ? { ...item, [field]: value } : item)),
                    );
                  }}
                />
              </label>
            ))}
            {rows.length > 1 && (
              <button
                type="button"
                className={button}
                onClick={() => setRows((old) => old.filter((item) => item.id !== row.id))}
              >
                Remover item
              </button>
            )}
          </fieldset>
        ))}
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={button}
            disabled={busy}
            onClick={() => setRows((old) => [...old, newRow()])}
          >
            Adicionar outro produto
          </button>
          <button
            className={button}
            disabled={busy || rows.some((row) => !(row.sku.trim() || row.description.trim()))}
          >
            Confirmar produtos da etiqueta
          </button>
        </div>
      </form>
    </details>
  );
}

export default function StaffLabelCategories({ api, owner }: { api: LabelCategoryApi; owner?: string }) {
  const [records, setRecords] = React.useState<LabelImport[]>([]);
  const [selected, setSelected] = React.useState("");
  const [directory, setDirectory] = React.useState<LabelCategoryDirectory>(emptyDirectory);
  const [onlineReady, setOnlineReady] = React.useState(false);
  const [loaded, setLoaded] = React.useState(false);
  const [working, setWorking] = React.useState("");
  const [message, setMessage] = React.useState("");
  const [error, setError] = React.useState("");
  const [newName, setNewName] = React.useState("");
  const [creating, setCreating] = React.useState(false);
  const [choices, setChoices] = React.useState<Record<string, string>>({});
  const [showDetails, setShowDetails] = React.useState(false);
  const active = React.useRef(false);
  const originals = React.useRef(new Map<string, File>());
  const mounted = React.useRef(true);
  const pendingBox = React.useRef<HTMLHeadingElement>(null);
  const current = records.find((item) => item.id === selected) ?? records[0];
  const originalFile = current && originals.current.get(current.id);
  const [originalUrl, setOriginalUrl] = React.useState("");
  React.useEffect(() => {
    if (!originalFile) {
      setOriginalUrl("");
      return;
    }
    const url = URL.createObjectURL(new Blob([originalFile], { type: "application/pdf" }));
    setOriginalUrl(url);
    return () => URL.revokeObjectURL(url);
  }, [originalFile]);
  const assignments = current?.completed ?? directory.assignments;
  const missing = current ? missingLabelCategories(current.pages, assignments) : 0;
  const pending = React.useMemo(
    () => pendingProducts(current?.pages ?? [], assignments),
    [current, assignments],
  );
  const names = new Map(directory.categories.map((c) => [c.id, c.name]));
  const busy = Boolean(working) || !loaded;

  async function sync(records: LabelImport[]) {
    const result = await api.lookup(allKeys(records));
    if (mounted.current) {
      setDirectory(result);
      setOnlineReady(true);
    }
    return result;
  }
  React.useEffect(() => {
    let live = true;
    mounted.current = true;
    async function load() {
      try {
        const stored = owner ? await listLabelImports(owner) : [];
        if (!live) return;
        const sorted = stored.sort((a, b) => b.importedAt - a.importedAt);
        setRecords(sorted);
        const d = await api.lookup(allKeys(sorted));
        if (live) {
          setDirectory(d);
          setOnlineReady(true);
        }
      } catch {
        if (live)
          setError(
            "Não foi possível carregar as importações ou consultar as categorias da equipe. Tente atualizar.",
          );
      } finally {
        if (live) setLoaded(true);
      }
    }
    void load();
    return () => {
      live = false;
      mounted.current = false;
    };
  }, [api, owner]);

  async function run(title: string, action: () => Promise<void>) {
    if (active.current || !loaded) return;
    active.current = true;
    setWorking(title);
    setMessage("");
    setError("");
    try {
      await action();
    } catch (e) {
      if (mounted.current) setError(e instanceof Error ? e.message : "A operação não foi concluída.");
    } finally {
      active.current = false;
      if (mounted.current) setWorking("");
    }
  }
  async function update(id: string, change: (r?: LabelImport) => LabelImport) {
    const result = owner
      ? await updateLabelImport(owner, id, change)
      : change(records.find((r) => r.id === id));
    if (mounted.current)
      setRecords((old) =>
        [result, ...old.filter((r) => r.id !== id)].sort((a, b) => b.importedAt - a.importedAt),
      );
    return result;
  }

  function importFiles(files: File[]) {
    return run("Lendo etiquetas…", async () => {
      const existing = new Map<string, LabelImport>(records.map((r) => [r.id, r]));
      const failed: string[] = [];
      let first = "",
        added = 0;
      for (const [i, file] of files.entries()) {
        if (!mounted.current) return;
        setWorking(`Lendo PDF ${i + 1} de ${files.length}…`);
        let item: LabelImport;
        try {
          item = await readLabelImport(file);
        } catch {
          failed.push(file.name);
          continue;
        }
        const saved = await update(item.id, (previous) => previous ?? item);
        if (!existing.has(saved.id)) added++;
        existing.set(saved.id, saved);
        originals.current.set(saved.id, file);
        if (!first) first = saved.id;
      }
      if (!mounted.current) return;
      if (first) {
        setSelected(first);
        setShowDetails(false);
      }
      if (failed.length)
        setError("PDFs que não abriram: " + failed.join(", ") + ". Confira o arquivo ou a senha.");
      if (first) {
        setMessage(`${added} PDF(s) novo(s). Arquivos já importados mantêm sua classificação.`);
        setOnlineReady(false);
        await sync([...existing.values()]);
      }
    });
  }
  function newCategory() {
    return run("Criando categoria…", async () => {
      const cat = await api.create(newName);
      setDirectory((old) => ({
        ...old,
        categories: [...old.categories.filter((c) => c.id !== cat.id), cat],
      }));
      setMessage(`Categoria “${cat.name}” disponível para toda a equipe.`);
      setCreating(false);
      setNewName("");
    });
  }
  function assign(key: string, categoryId: string) {
    return run("Confirmando categoria…", async () => {
      try {
        await api.assign(key, categoryId);
      } catch (e) {
        if ((e as { status?: number }).status === 409) await sync(records);
        throw e;
      }
      setDirectory((old) => ({ ...old, assignments: { ...old.assignments, [key]: categoryId } }));
      setMessage(
        `Categoria “${names.get(categoryId)}” salva para este produto e para as próximas importações da equipe.`,
      );
    });
  }
  function complete() {
    if (!current || current.completed) return;
    return run("Concluindo importação…", async () => {
      setOnlineReady(false);
      const fresh = await sync(records);
      await update(current.id, (latest) => {
        if (!latest) throw new Error("Selecione o PDF novamente.");
        if (latest.completed) return latest;
        if (missingLabelCategories(latest.pages, fresh.assignments))
          throw new Error("Ainda há etiquetas sem categoria neste PDF.");
        return {
          ...latest,
          completed: Object.fromEntries(
            latest.pages.flatMap((page) => page.products.map((p) => [p.key, fresh.assignments[p.key]])),
          ),
        };
      });
      setMessage("Importação concluída. Todas as etiquetas deste PDF estão categorizadas.");
    });
  }

  return (
    <section aria-label="Importação de etiquetas" className="space-y-4">
      <h4 className="font-semibold">Importar etiquetas</h4>
      <label
        className={
          button + " inline-flex cursor-pointer flex-wrap items-center gap-2 has-[:focus-visible]:outline"
        }
        onDragOver={(e) => e.preventDefault()}
        onDrop={(e) => {
          e.preventDefault();
          if (!busy && e.dataTransfer.files.length) void importFiles(Array.from(e.dataTransfer.files));
        }}
      >
        <Upload size={16} aria-hidden="true" /> Selecionar PDFs de etiquetas{" "}
        <span className="text-xs text-gray-400">ou arraste os arquivos aqui</span>
        <input
          aria-label="PDFs de etiquetas"
          className="sr-only"
          type="file"
          multiple
          accept="application/pdf,.pdf"
          disabled={busy}
          onChange={(e) => {
            const files = Array.from<File>(e.currentTarget.files ?? []);
            e.currentTarget.value = "";
            if (files.length) void importFiles(files);
          }}
        />
      </label>
      {(working || message) && (
        <p role="status" className="text-sm">
          {working || message}
        </p>
      )}
      {error && (
        <p role="alert" className="text-sm text-red-300">
          {error}
        </p>
      )}
      {loaded && (
        <button
          className={button}
          disabled={busy}
          onClick={() =>
            void run("Atualizando…", async () => {
              const list = owner ? await listLabelImports(owner) : records;
              setRecords(list.sort((a, b) => b.importedAt - a.importedAt));
              await sync(list);
            })
          }
        >
          Atualizar importações e categorias
        </button>
      )}
      {onlineReady && (
        <div className="space-y-2">
          {!directory.categories.length && (
            <p className="text-sm text-amber-200">Crie a primeira categoria para classificar as etiquetas.</p>
          )}
          {!directory.categories.length || creating ? (
            <form
              className="flex flex-wrap items-end gap-2"
              onSubmit={(e) => {
                e.preventDefault();
                void newCategory();
              }}
            >
              <label className="grid gap-1 text-sm">
                Nome da categoria
                <input
                  className={input}
                  value={newName}
                  maxLength={100}
                  disabled={busy}
                  onChange={(e) => setNewName(e.target.value)}
                  placeholder="Ex.: Caderneta saúde"
                />
              </label>
              <button className={button} disabled={busy || !newName.trim()}>
                Criar categoria
              </button>
              {creating && (
                <button type="button" className={button} onClick={() => setCreating(false)}>
                  Cancelar
                </button>
              )}
            </form>
          ) : (
            <button type="button" className={button} disabled={busy} onClick={() => setCreating(true)}>
              Criar categoria
            </button>
          )}
        </div>
      )}
      {current && (
        <>
          <label className="grid gap-1 text-sm">
            PDF em revisão
            <select
              className={input}
              disabled={busy}
              value={current.id}
              onChange={(e) => {
                setSelected(e.target.value);
                setShowDetails(false);
              }}
            >
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.pages.length} etiqueta(s){r.completed && " · Concluído"}
                </option>
              ))}
            </select>
          </label>
          {!current.completed && onlineReady && !missing && (
            <p className="text-sm text-green-300">
              Todas as etiquetas têm categoria. Você já pode concluir este PDF.
            </p>
          )}
          {!current.completed && onlineReady && missing > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-800 p-3">
              <p className="text-sm text-amber-200">
                Faltam categorias em {missing} de {current.pages.length} etiqueta(s). Resolva as pendências
                para concluir este PDF.
              </p>
              <button className={button} onClick={() => pendingBox.current?.focus()}>
                Ver pendências
              </button>
            </div>
          )}
          {!current.completed && onlineReady && (
            <section className="space-y-2">
              {!!missing && (
                <h5 tabIndex={-1} ref={pendingBox} className="font-semibold">
                  Pendências de categorização
                </h5>
              )}
              {pending.map(({ product, pages }) => {
                const choice = choices[product.key];
                return (
                  <article key={product.key} className="space-y-2 rounded-lg border border-gray-700 p-3">
                    <strong className="break-words">{productName(product)}</strong>
                    <p className="text-xs text-gray-300">Presente em {pages.length} etiqueta(s) deste PDF.</p>
                    {!!directory.categories.length && (
                      <>
                        <label className="grid w-fit max-w-full gap-1 text-sm">
                          Categoria do produto
                          <select
                            className={input}
                            disabled={busy}
                            value={choice ?? ""}
                            onChange={(e) => {
                              const value = e.target.value;
                              setChoices((old) => ({ ...old, [product.key]: value }));
                            }}
                          >
                            <option value="">Escolha a categoria</option>
                            {[...directory.categories]
                              .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
                              .map((c) => (
                                <option value={c.id} key={c.id}>
                                  {c.name}
                                </option>
                              ))}
                          </select>
                        </label>
                        {choice && (
                          <p className="text-sm text-amber-200">
                            Ao confirmar, “{names.get(choice)}” será aplicada às {pages.length} etiqueta(s)
                            deste PDF e a todas as próximas etiquetas deste produto, para toda a equipe.{" "}
                            {product.sku
                              ? "O vínculo usa o SKU, inclusive se a variação mudar."
                              : "Como não há SKU, o vínculo usa a descrição e a variação."}
                          </p>
                        )}
                        <button
                          className={button}
                          disabled={busy || !choice}
                          onClick={() => void assign(product.key, choice)}
                        >
                          Confirmar categoria
                        </button>
                      </>
                    )}
                  </article>
                );
              })}
              {current.pages.map(
                (page, i) =>
                  page.issue && (
                    <div key={current.id + i}>
                      <IdentifyLabel
                        originalUrl={originalUrl}
                        page={i + 1}
                        issue={page.issue}
                        busy={busy}
                        save={(products) =>
                          run("Salvando identificação…", async () => {
                            const updated = await update(current.id, (latest) => {
                              if (!latest || latest.completed || !latest.pages[i]?.issue)
                                throw new Error("Esta página já foi atualizada. Reabra a importação.");
                              return {
                                ...latest,
                                pages: latest.pages.map((p, j) => (i === j ? { products } : p)),
                              };
                            });
                            setOnlineReady(false);
                            await sync([...records.filter((r) => r.id !== updated.id), updated]);
                          })
                        }
                      />
                    </div>
                  ),
              )}
            </section>
          )}
          {onlineReady && (
            <details
              key={current.id}
              open={showDetails}
              onToggle={(e) => setShowDetails(e.currentTarget.open)}
            >
              <summary className="cursor-pointer text-sm">
                Conferir etiquetas ({current.pages.length})
              </summary>
              {showDetails && (
                <ul className="mt-2 max-h-64 space-y-2 overflow-auto text-sm">
                  {current.pages.map((p, i) => (
                    <li key={i}>
                      <b>Página {i + 1}</b>
                      {p.issue
                        ? " · Identificação pendente"
                        : p.products.map((product, j) => (
                            <div key={j} className="break-words">
                              {productName(product)} ·{" "}
                              {names.get(assignments[product.key])
                                ? names.get(assignments[product.key]) + " · vínculo da equipe"
                                : "Sem categoria"}
                            </div>
                          ))}
                    </li>
                  ))}
                </ul>
              )}
            </details>
          )}
          {current.completed ? (
            <p className="text-sm text-green-300">
              Importação concluída · {current.pages.length} etiqueta(s).
            </p>
          ) : (
            <button
              className={button}
              disabled={busy || !onlineReady || missing > 0}
              onClick={() => void complete()}
            >
              Concluir importação
            </button>
          )}
        </>
      )}
    </section>
  );
}
