import React from "react";
import { Trash2 } from "lucide-react";
import FontSample from "./FontSample";
import type { PersonalizationFont } from "../lib/textCustomization";

export default function AdminFontList({
  fonts,
  onChange,
  onRemove,
  onSetAll,
}: {
  fonts: PersonalizationFont[];
  onChange: (index: number, patch: Partial<PersonalizationFont>) => void;
  onRemove: (index: number) => void;
  onSetAll: (active: boolean) => void;
}) {
  const [query, setQuery] = React.useState(""),
    [page, setPage] = React.useState(0);
  const filtered = fonts
    .map((font, index) => ({ font, index }))
    .filter(({ font }) =>
      font.nome
        .toLocaleLowerCase("pt-BR")
        .includes(query.trim().toLocaleLowerCase("pt-BR")),
    );
  const pages = Math.max(1, Math.ceil(filtered.length / 25)),
    current = Math.min(page, pages - 1);
  const button =
    "rounded-lg border border-gray-700 px-3 py-2 text-xs disabled:opacity-40";
  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className={button}
          disabled={!fonts.some((font) => !font.ativo)}
          onClick={() => onSetAll(true)}
        >
          Marcar todas
        </button>
        <button
          type="button"
          className={button}
          disabled={!fonts.some((font) => font.ativo)}
          onClick={() => onSetAll(false)}
        >
          Desmarcar todas
        </button>
        <span className="text-xs text-gray-400">
          {fonts.filter((font) => font.ativo).length} de {fonts.length} ativas
        </span>
      </div>
      <p className="text-xs text-gray-400">
        Estas ações se aplicam a todas as fontes, incluindo outras páginas e
        filtros. Salve para publicar.
      </p>
      <label className="block text-xs">
        Filtrar fontes
        <input
          className="mt-1 block w-full rounded-lg border border-gray-800 bg-black p-3 text-sm"
          value={query}
          onChange={(e) => {
            setQuery(e.target.value);
            setPage(0);
          }}
        />
      </label>
      {filtered
        .slice(current * 25, (current + 1) * 25)
        .map(({ font, index }) => (
          <div
            key={font.id}
            className="grid grid-cols-1 items-center gap-3 rounded-lg border border-gray-800 bg-black p-4 sm:grid-cols-[1fr_1fr_auto_auto]"
          >
            <input
              aria-label={`Nome da fonte ${index + 1}`}
              maxLength={80}
              value={font.nome}
              onChange={(e) => onChange(index, { nome: e.target.value })}
              className="rounded border border-gray-800 bg-[#111111] px-3 py-2 text-sm"
            />
            <div className="min-w-0">
              <div className="truncate text-lg">
                <FontSample font={font}>Texto de exemplo</FontSample>
              </div>
              <div className="truncate text-[10px] text-gray-600">
                {font.arquivoUrl
                  ? `Arquivo ${(font.arquivoFormato || "woff2").toUpperCase()}`
                  : font.cssFamily}
              </div>
            </div>
            <label className="flex items-center gap-2 text-xs font-bold text-gray-400">
              <input
                type="checkbox"
                checked={font.ativo}
                onChange={(e) => onChange(index, { ativo: e.target.checked })}
                className="accent-[#ff4d79]"
              />{" "}
              Ativa
            </label>
            <button
              type="button"
              onClick={() => onRemove(index)}
              aria-label={`Remover fonte ${font.nome}`}
              className="p-2 text-gray-500 hover:text-red-500"
            >
              <Trash2 size={17} />
            </button>
          </div>
        ))}
      {!filtered.length && (
        <p className="text-sm text-gray-400">
          {fonts.length
            ? "Nenhuma fonte corresponde à busca."
            : "Nenhuma fonte cadastrada. Produtos com texto ficam indisponíveis até que ao menos uma fonte ativa seja salva."}
        </p>
      )}
      {pages > 1 && (
        <div className="flex items-center gap-3">
          <button
            type="button"
            className={button}
            disabled={!current}
            onClick={() => setPage(current - 1)}
          >
            Fontes anteriores
          </button>
          <span className="text-xs">
            Página {current + 1} de {pages} · {filtered.length} fontes
          </span>
          <button
            type="button"
            className={button}
            disabled={current + 1 >= pages}
            onClick={() => setPage(current + 1)}
          >
            Próximas fontes
          </button>
        </div>
      )}
    </div>
  );
}
