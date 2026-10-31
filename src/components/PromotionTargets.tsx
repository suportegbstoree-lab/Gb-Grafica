import { useState } from "react";
import type { Anuncio, Category, Promocao } from "../types";

export default function PromotionTargets({
  value,
  products,
  categories,
  onChange,
}: {
  value: Partial<Promocao>;
  products: Anuncio[];
  categories: Category[];
  onChange: (value: Partial<Promocao>) => void;
}) {
  const [search, setSearch] = useState("");
  const selected = value.alvoIds || (value.alvoId ? [value.alvoId] : []);
  const targets = value.alvoTipo === "categoria" ? categories : products;
  return (
    <fieldset className="space-y-3 rounded-xl border border-gray-800 p-4">
      <legend>Produtos ou categorias da promoção</legend>
      <label className="block text-sm">
        Aplicar em
        <select
          id="promotion-target-type"
          value={value.alvoTipo || "produto"}
          onChange={(e) =>
            onChange({
              ...value,
              alvoTipo: e.target.value as Promocao["alvoTipo"],
              alvoId: "",
              alvoIds: [],
              alvoNomes: [],
            })
          }
          className="ml-3 rounded border border-gray-700 bg-black p-2"
        >
          <option value="produto">Produtos selecionados</option>
          <option value="categoria">Categorias inteiras</option>
        </select>
      </label>
      <p className="text-xs text-gray-400">
        {value.alvoTipo === "categoria"
          ? "Todos os produtos das categorias marcadas recebem o desconto."
          : "Selecione produtos de qualquer categoria."}{" "}
        Até 100 seleções.
      </p>
      <input
        aria-label="Buscar alvos da promoção"
        value={search}
        onChange={(e) => setSearch(e.target.value)}
        placeholder="Buscar por nome ou categoria"
        className="w-full rounded border border-gray-700 bg-black p-3"
      />
      <div className="max-h-64 space-y-2 overflow-y-auto">
        {targets
          .filter((t) =>
            `${t.nome} ${"categoria" in t ? t.categoria : ""}`
              .toLocaleLowerCase("pt-BR")
              .includes(search.toLocaleLowerCase("pt-BR")),
          )
          .map((t) => (
            <label
              key={t.id}
              className="flex items-center gap-3 rounded bg-black/30 p-2 text-sm"
            >
              <input
                type="checkbox"
                checked={selected.includes(t.id)}
                disabled={!selected.includes(t.id) && selected.length >= 100}
                onChange={(e) => {
                  const ids = e.target.checked
                    ? [...selected, t.id]
                    : selected.filter((id) => id !== t.id);
                  onChange({ ...value, alvoIds: ids, alvoId: ids[0] || "" });
                }}
              />
              {t.nome}
              {"categoria" in t && (
                <span className="text-xs text-gray-400">{t.categoria}</span>
              )}
            </label>
          ))}
      </div>
      <p className="text-xs text-gray-400">{selected.length} selecionado(s)</p>
    </fieldset>
  );
}
