import React from "react";
import {
  labelBaseIdentity,
  type ImportedLabel,
  type ImportedProduct,
  type LabelBaseBinding,
  type LabelBaseBindingsApi,
} from "../lib/staffLabelImport";
import type { StaffPdfApi } from "../services/staffPdfService";
import type { StaffPdfBase } from "../lib/staffPdf";
import StaffPdfPicker from "./StaffPdfPicker";
import ConfirmDialog from "./ConfirmDialog";

const button =
  "rounded-lg border border-gray-700 px-3 py-2 text-sm hover:border-pink-400 focus-visible:outline-pink-400 disabled:opacity-50";
type ProductGroup = { identity: string; product: ImportedProduct; pages: Set<number> };
export default function StaffLabelBaseLinks({
  pages,
  api,
  library,
}: {
  pages: ImportedLabel[];
  api: LabelBaseBindingsApi;
  library: Pick<StaffPdfApi, "list">;
}) {
  const groups = new Map<string, ProductGroup>();
  pages.forEach((page, i) => {
    if (page.excluded || page.issue) return;
    page.products.forEach((product) => {
      const identity = labelBaseIdentity(product);
      const group = groups.get(identity) ?? { identity, product, pages: new Set<number>() };
      group.pages.add(page.number ?? i + 1);
      groups.set(identity, group);
    });
  });
  const signature = JSON.stringify([...groups.keys()].sort());
  const [links, setLinks] = React.useState<Record<string, LabelBaseBinding>>({});
  const [bases, setBases] = React.useState<StaffPdfBase[]>([]);
  const [loading, setLoading] = React.useState(true),
    [saving, setSaving] = React.useState(false);
  const [error, setError] = React.useState(""),
    [message, setMessage] = React.useState("");
  const [query, setQuery] = React.useState("");
  const [picker, setPicker] = React.useState<ProductGroup>();
  const [action, setAction] = React.useState<{
    group: ProductGroup;
    baseId: string | null;
    expectedVersion: number;
  }>();
  const request = React.useRef(0),
    mounted = React.useRef(false);
  async function load() {
    const version = ++request.current;
    setLoading(true);
    setError("");
    try {
      const [libraryResult, bindings] = await Promise.all([
        library.list(),
        api.lookup([...groups.values()].map((g) => g.product)),
      ]);
      if (version === request.current) {
        setBases(libraryResult.bases);
        setLinks(bindings);
      }
    } catch (error) {
      if (version === request.current)
        setError((error as Error)?.message || "Não foi possível carregar os vínculos das bases.");
    } finally {
      if (version === request.current) setLoading(false);
    }
  }
  React.useEffect(() => {
    mounted.current = true;
    setPicker(undefined);
    setAction(undefined);
    setSaving(false);
    setMessage("");
    void load();
    return () => {
      mounted.current = false;
      request.current++;
    };
  }, [api, library, signature]);
  async function save() {
    if (!action || saving) return;
    const version = request.current;
    setSaving(true);
    setError("");
    setMessage("");
    try {
      const binding = await api.save(action.group.product, action.baseId, action.expectedVersion);
      if (version !== request.current) return;
      setLinks((old) => ({ ...old, [action.group.identity]: binding }));
      setAction(undefined);
      setMessage(
        binding.baseId ? "Vínculo da base salvo para toda a equipe." : "Vínculo da base removido.",
      );
    } catch (error) {
      if (version !== request.current) return;
      if ((error as { status?: number }).status === 409) {
        await load();
        setAction(undefined);
      }
      if (mounted.current)
        setError((error as Error)?.message || "Não foi possível salvar o vínculo da base.");
    } finally {
      if (mounted.current) setSaving(false);
    }
  }
  if (!groups.size) return null;
  const pending = [...groups.keys()].filter(
    (key) => !links[key]?.baseId || !links[key].available,
  ).length;
  const options = bases.map((base) => ({
    id: base.id,
    name: [base.category, base.name].filter(Boolean).join(" · "),
  }));
  const term = query.trim().toLocaleLowerCase("pt-BR");
  return (
    <details className="rounded-xl border border-gray-700 p-4">
      <summary className="cursor-pointer font-semibold">
        Vínculos com bases · {loading ? "carregando…" : pending + " pendente(s)"}
      </summary>
      <div className="mt-4 space-y-3">
        <p className="text-sm text-gray-400">
          O vínculo usa SKU e variação e vale para as próximas importações da equipe.
        </p>
        {loading && (
          <p role="status" className="text-sm">
            Carregando bases e vínculos…
          </p>
        )}
        {error && (
          <p role="alert" className="text-sm text-red-300">
            {error}
          </p>
        )}
        {message && (
          <p role="status" className="text-sm text-green-300">
            {message}
          </p>
        )}
        <button
          type="button"
          className={button}
          disabled={loading || saving}
          onClick={() => void load()}
        >
          Atualizar bases e vínculos
        </button>
        {!loading && !bases.length && (
          <p className="text-sm text-amber-200">
            Cadastre uma base em Bases e moldes para fazer o vínculo.
          </p>
        )}
        <label className="grid gap-1 text-sm">
          Filtrar produtos para vincular
          <input
            className="min-w-0 rounded-lg border border-gray-700 bg-black p-2"
            value={query}
            onChange={(e) => setQuery(e.target.value)}
          />
        </label>
        <ul className="max-h-96 space-y-3 overflow-auto">
          {[...groups.values()]
            .filter((g) =>
              [g.product.sku, g.product.description, g.product.variation]
                .join(" ")
                .toLocaleLowerCase("pt-BR")
                .includes(term),
            )
            .map((group) => {
              const binding = links[group.identity];
              return (
                <li key={group.identity} className="space-y-2 rounded-lg border border-gray-800 p-3">
                  <p className="break-words font-medium">
                    {[
                      group.product.description,
                      group.product.variation,
                      group.product.sku && "SKU " + group.product.sku,
                    ]
                      .filter(Boolean)
                      .join(" · ")}
                  </p>
                  <p className="text-xs text-gray-400">{group.pages.size} etiqueta(s)</p>
                  {binding?.baseId ? (
                    <div className="text-sm">
                      <p className={binding.available ? "text-green-300" : "text-amber-200"}>
                        {binding.available
                          ? (binding.name ?? bases.find((b) => b.id === binding.baseId)?.name)
                          : "Base indisponível. Escolha outra base."}
                      </p>
                      <code className="block break-all text-xs text-gray-400">{binding.baseId}</code>
                    </div>
                  ) : (
                    <p className="text-sm text-amber-200">Base pendente</p>
                  )}
                  <div className="flex flex-wrap gap-2">
                    <button
                      type="button"
                      className={button}
                      disabled={loading || saving || !bases.length}
                      onClick={() => {
                        setError("");
                        setPicker(group);
                      }}
                    >
                      {binding?.baseId ? "Alterar base" : "Selecionar base"}
                    </button>
                    {binding?.baseId && (
                      <button
                        type="button"
                        className={button}
                        disabled={loading || saving}
                        onClick={() => {
                          setError("");
                          setAction({ group, baseId: null, expectedVersion: binding.version });
                        }}
                      >
                        Remover vínculo
                      </button>
                    )}
                  </div>
                </li>
              );
            })}
        </ul>
      </div>
      {picker && (
        <StaffPdfPicker
          title="Vincular base ao produto da etiqueta"
          options={options}
          selected={links[picker.identity]?.baseId ?? ""}
          onChoose={(baseId) =>
            setAction({ group: picker, baseId, expectedVersion: links[picker.identity]?.version ?? 0 })
          }
          onClose={() => setPicker(undefined)}
        />
      )}
      {action && (
        <ConfirmDialog
          title={action.baseId ? "Salvar vínculo da base?" : "Remover vínculo da base?"}
          message={
            error ||
            (action.baseId
              ? "A base “" +
                (options.find((b) => b.id === action.baseId)?.name ?? action.baseId) +
                "” será vinculada a este produto e variação nas " +
                action.group.pages.size +
                " etiqueta(s) deste arquivo e nas próximas importações da equipe."
              : "O vínculo deste produto e variação será removido para toda a equipe.")
          }
          confirmLabel={action.baseId ? "Salvar vínculo" : "Remover vínculo"}
          busy={saving}
          onCancel={() => setAction(undefined)}
          onConfirm={() => void save()}
        />
      )}
    </details>
  );
}
