import React from "react";
import { Upload } from "lucide-react";
import {
  identifyProduct,
  missingLabelCategories,
  type LabelArchiveHeader,
  type LabelCategory,
  type LabelCategoryApi,
  type LabelCategoryDirectory,
  type LabelImport,
  type ImportedLabel,
  type ImportedProduct,
} from "../lib/staffLabelImport";
import ConfirmDialog from "./ConfirmDialog";
import { openLabels, uploadLabelPages } from "../services/staffLabelArchive";
import { listLabelImports, readLabelImport, forgetLocalLabelImport } from "../services/staffLabelImport";

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
  ...new Set(records.flatMap((r) => r.pages.flatMap((p) => p.products.map((item) => item.key)))),
];

function IdentifyLabel({
  openPage,
  page,
  issue,
  busy,
  save,
}: {
  openPage?: () => void;
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
      {openPage && (
        <button type="button" className={button} onClick={openPage}>
          Conferir página no PDF
        </button>
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
  const [headers, setHeaders] = React.useState<LabelArchiveHeader[]>([]);
  const [legacy, setLegacy] = React.useState<LabelImport[]>([]);
  const [current, setCurrent] = React.useState<LabelImport>();
  const [editing, setEditing] = React.useState<LabelCategory>();
  const [editName, setEditName] = React.useState("");
  type Removal =
    | { kind: "category"; category: LabelCategory }
    | { kind: "file" | "page"; header: LabelArchiveHeader; number?: number };
  const [removal, setRemoval] = React.useState<Removal>();
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
  const mounted = React.useRef(true);
  const pendingBox = React.useRef<HTMLHeadingElement>(null);
  const header = headers.find((h) => h.id === current?.id);
  const records = [
    ...headers.map((h) => ({ id: h.id, name: h.name, count: h.count, confirmed: h.confirmed })),
    ...legacy
      .filter((l) => !headers.some((h) => h.id === l.id))
      .map((l) => ({ id: l.id, name: l.name, count: l.pages.length, confirmed: false })),
  ];
  const assignments = directory.assignments;
  const missing = current ? missingLabelCategories(current.pages, assignments) : 0;
  const pending = React.useMemo(
    () => pendingProducts(current?.pages ?? [], assignments),
    [current, assignments],
  );
  const names = new Map(directory.categories.map((c) => [c.id, c.name]));
  const busy = Boolean(working) || !loaded;

  const completed = header?.state === "ready" && header.confirmed && !missing;
  async function load(preferred?: string, live = () => mounted.current) {
    const [remote, local] = await Promise.all([
      api.archive.list(),
      owner ? listLabelImports(owner).catch(() => []) : [],
    ]);
    remote.sort((a, b) => b.importedAt - a.importedAt);
    const available = [...remote, ...local];
    const selected = available.find((r) => r.id === preferred) ?? available[0];
    const h = remote.find((r) => r.id === selected?.id);
    const record: LabelImport | undefined = h
      ? {
          id: h.id,
          name: h.name,
          importedAt: h.importedAt,
          pages: await api.archive.read({ id: h.id, revision: h.revision }),
        }
      : local.find((r) => r.id === selected?.id);
    const fresh = await api.lookup(record ? allKeys([record]) : []);
    if (!live()) return;
    setHeaders(remote);
    setLegacy(local);
    setCurrent(record);
    setDirectory(fresh);
    setOnlineReady(true);
    setChoices({});
  }
  React.useEffect(() => {
    let live = true;
    mounted.current = true;
    setLoaded(false);
    setCurrent(undefined);
    setLegacy([]);
    setHeaders([]);
    setDirectory(emptyDirectory);
    setOnlineReady(false);
    void load(undefined, () => live)
      .catch(() => {
        if (live) setError("Não foi possível carregar as etiquetas da equipe. Tente atualizar.");
      })
      .finally(() => {
        if (live) setLoaded(true);
      });
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
  function importFiles(files: File[]) {
    return run("Lendo etiquetas…", async () => {
      const known = new Set(headers.map((h) => h.id));
      const failed: string[] = [];
      let first = "",
        added = 0;
      for (const [i, file] of files.entries()) {
        if (!mounted.current) return;
        setWorking(`Lendo PDF ${i + 1} de ${files.length}…`);
        try {
          const parsed = await readLabelImport(file);
          const previous = legacy.find((r) => r.id === parsed.id);
          const item = previous ?? parsed;
          first ||= item.id;
          await uploadLabelPages(api.archive, file, item, (n, total) =>
            setWorking(`Salvando ${file.name} · ${n} de ${total} etiquetas…`),
          );
          if (previous && owner) {
            const h = await api.archive.begin(item.id, item.name, item.pages.length);
            const ref = { id: h.id, revision: h.revision };
            const shared = await api.archive.read(ref);
            for (const page of shared) {
              const local = previous.pages[page.number! - 1];
              if (page.issue && local && !local.issue && local.products.length) {
                await api.archive.identify(ref, page.number!, local.products);
                Object.assign(page, { issue: undefined, products: local.products });
              }
            }
            if (previous.completed) {
              const directory = await api.lookup(allKeys([{ ...previous, pages: shared }]));
              if (!missingLabelCategories(shared, directory.assignments)) await api.archive.confirm(ref);
            }
            await forgetLocalLabelImport(owner, item.id);
          }
          if (!known.has(item.id)) added++;
          known.add(item.id);
        } catch (e) {
          failed.push(file.name + " — " + (e instanceof Error ? e.message : "Falha no envio."));
        }
      }
      if (!mounted.current) return;
      await load(first || current?.id);
      setShowDetails(false);
      if (failed.length)
        setError("Confira os arquivos e selecione-os novamente para retomar. " + failed.join(" · "));
      else setMessage(`${added} PDF(s) novo(s). Etiquetas disponíveis para a equipe.`);
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
        if ((e as { status?: number }).status === 409) await load(current?.id);
        throw e;
      }
      setDirectory((old) => ({ ...old, assignments: { ...old.assignments, [key]: categoryId } }));
      setMessage(
        `Categoria “${names.get(categoryId)}” salva para este produto e para as próximas importações da equipe.`,
      );
    });
  }
  function complete() {
    if (!header) return;
    return run("Concluindo importação…", async () => {
      await api.archive.confirm({ id: header.id, revision: header.revision });
      await load(header.id);
      setMessage("Importação concluída. Todas as etiquetas deste PDF estão categorizadas.");
    });
  }
  function showPages(numbers: number[], print = false) {
    if (header) void run("Abrindo etiquetas…", () => openLabels(api.archive, header, numbers, print));
  }
  function remove() {
    if (!removal) return;
    void run("Excluindo…", async () => {
      if (removal.kind === "category") await api.remove(removal.category.id, removal.category.name);
      else {
        const { id, revision } = removal.header;
        await api.archive.remove({ id, revision }, removal.number);
      }
      setRemoval(undefined);
      await load(current?.id);
      setMessage(
        removal.kind === "category"
          ? "Categoria excluída. Produtos vinculados precisam de uma nova categoria."
          : removal.kind === "page"
            ? "Etiqueta excluída."
            : "Etiquetas do arquivo excluídas.",
      );
    });
  }
  return (
    <section aria-label="Importação de etiquetas" className="space-y-4">
      <h4 className="font-semibold">Importar etiquetas</h4>
      <label
        className={
          button +
          " inline-flex cursor-pointer flex-wrap items-center gap-2 has-[:focus-visible]:outline"
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
              await load(current?.id);
            })
          }
        >
          Atualizar importações e categorias
        </button>
      )}
      {onlineReady && (
        <div className="space-y-2">
          {!directory.categories.length && (
            <p className="text-sm text-amber-200">
              Crie a primeira categoria para classificar as etiquetas.
            </p>
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
          {directory.categories.length > 0 && (
            <details>
              <summary className="cursor-pointer text-sm">
                Gerenciar categorias ({directory.categories.length})
              </summary>
              <ul className="mt-2 space-y-2">
                {[...directory.categories]
                  .sort((a, b) => a.name.localeCompare(b.name, "pt-BR"))
                  .map((c) => (
                    <li key={c.id} className="flex flex-wrap items-center gap-2">
                      {editing?.id === c.id ? (
                        <form
                          className="flex flex-wrap gap-2"
                          onSubmit={(e) => {
                            e.preventDefault();
                            void run("Salvando categoria…", async () => {
                              await api.rename(c.id, editing.name, editName);
                              await load(current?.id);
                              setEditing(undefined);
                            });
                          }}
                        >
                          <input
                            autoFocus
                            aria-label="Novo nome da categoria"
                            className={input}
                            value={editName}
                            maxLength={100}
                            onChange={(e) => setEditName(e.target.value)}
                          />
                          <button className={button} disabled={busy || !editName.trim()}>
                            Salvar nome
                          </button>
                          <button className={button} type="button" onClick={() => setEditing(undefined)}>
                            Cancelar
                          </button>
                        </form>
                      ) : (
                        <>
                          <span>{c.name}</span>
                          <button
                            className={button}
                            disabled={busy}
                            aria-label={"Editar categoria " + c.name}
                            onClick={() => {
                              setEditing(c);
                              setEditName(c.name);
                            }}
                          >
                            Editar
                          </button>
                          <button
                            className={button}
                            disabled={busy}
                            aria-label={"Excluir categoria " + c.name}
                            onClick={() => {
                              setError("");
                              setRemoval({ kind: "category", category: c });
                            }}
                          >
                            Excluir
                          </button>
                        </>
                      )}
                    </li>
                  ))}
              </ul>
            </details>
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
                const id = e.target.value;
                void run("Carregando etiquetas…", () => load(id));
                setShowDetails(false);
              }}
            >
              {records.map((r) => (
                <option key={r.id} value={r.id}>
                  {r.name} · {r.count} etiqueta(s)
                  {r.confirmed && (r.id !== current.id || completed) && " · Concluído"}
                </option>
              ))}
            </select>
          </label>
          {!header && (
            <p className="text-sm text-amber-200">
              Esta revisão foi salva neste navegador. Selecione o PDF original uma vez para enviar as
              etiquetas ao Firebase e compartilhar com a equipe.
            </p>
          )}
          {header?.state === "uploading" && (
            <p className="text-sm text-amber-200">
              Envio incompleto · {header.count} de {header.total} etiquetas salvas. Selecione o mesmo PDF
              para continuar de onde parou.
            </p>
          )}
          {header?.state === "deleting" && (
            <p className="text-sm text-amber-200">
              Exclusão em andamento. Use “Excluir etiquetas do arquivo” para retomar.
            </p>
          )}
          {header && (
            <div className="flex flex-wrap gap-2">
              <button
                className={button}
                disabled={busy || header.state !== "ready"}
                onClick={() =>
                  showPages(
                    current.pages.map((p) => p.number!),
                    true,
                  )
                }
              >
                Imprimir etiquetas do arquivo
              </button>
              <button
                className={button}
                disabled={busy}
                onClick={() => {
                  setError("");
                  setRemoval({ kind: "file", header });
                }}
              >
                Excluir etiquetas do arquivo
              </button>
            </div>
          )}
          {header?.state === "ready" && !completed && onlineReady && !missing && (
            <p className="text-sm text-green-300">
              Todas as etiquetas têm categoria. Você já pode concluir este PDF.
            </p>
          )}
          {header?.state === "ready" && !completed && onlineReady && missing > 0 && (
            <div className="space-y-2 rounded-lg border border-amber-800 p-3">
              <p className="text-sm text-amber-200">
                Faltam categorias em {missing} de {current.pages.length} etiqueta(s). Resolva as
                pendências para concluir este PDF.
              </p>
              <button className={button} onClick={() => pendingBox.current?.focus()}>
                Ver pendências
              </button>
            </div>
          )}
          {header?.state === "ready" && !completed && onlineReady && (
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
                    <p className="text-xs text-gray-300">
                      Presente em {pages.length} etiqueta(s) deste PDF.
                    </p>
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
                            Ao confirmar, “{names.get(choice)}” será aplicada às {pages.length}{" "}
                            etiqueta(s) deste PDF e a todas as próximas etiquetas deste produto, para
                            toda a equipe.{" "}
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
                        openPage={header ? () => showPages([page.number!]) : undefined}
                        page={page.number ?? i + 1}
                        issue={page.issue}
                        busy={busy}
                        save={(products) =>
                          run("Salvando identificação…", async () => {
                            await api.archive.identify(
                              { id: header.id, revision: header.revision },
                              page.number!,
                              products,
                            );
                            await load(current.id);
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
                    <li key={p.number ?? i} className="border-b border-gray-800 pb-2">
                      <b>Página {p.number ?? i + 1}</b>
                      {header?.state === "ready" && (
                        <div className="my-1 flex flex-wrap gap-2">
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() => showPages([p.number!])}
                          >
                            Visualizar
                          </button>
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() => showPages([p.number!], true)}
                          >
                            Imprimir
                          </button>
                          <button
                            className={button}
                            disabled={busy}
                            onClick={() => {
                              setError("");
                              setRemoval({ kind: "page", header, number: p.number });
                            }}
                          >
                            Excluir etiqueta
                          </button>
                        </div>
                      )}
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
          {completed ? (
            <p className="text-sm text-green-300">
              Importação concluída · {current.pages.length} etiqueta(s).
            </p>
          ) : (
            <button
              className={button}
              disabled={busy || header?.state !== "ready" || !onlineReady || missing > 0}
              onClick={() => void complete()}
            >
              Concluir importação
            </button>
          )}
        </>
      )}
      {removal && (
        <ConfirmDialog
          danger
          busy={busy}
          title={
            removal.kind === "category"
              ? "Excluir categoria?"
              : removal.kind === "page"
                ? "Excluir esta etiqueta?"
                : "Excluir etiquetas do arquivo?"
          }
          message={
            error ||
            (removal.kind === "category"
              ? `Os produtos de “${removal.category.name}” precisarão de uma nova categoria. Os PDFs serão preservados.`
              : removal.kind === "page"
                ? `A página ${removal.number} de “${removal.header.name}” será excluída para toda a equipe.`
                : `Todas as etiquetas de “${removal.header.name}” serão excluídas para toda a equipe.`)
          }
          confirmLabel="Confirmar exclusão"
          onCancel={() => setRemoval(undefined)}
          onConfirm={remove}
        />
      )}
    </section>
  );
}
