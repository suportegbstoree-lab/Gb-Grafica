import React from "react";
import EditorModal from "./EditorModal";

export default function StaffPdfPicker({
  title,
  options,
  selected,
  onChoose,
  onClose,
  suggestions,
  context,
}: {
  title: string;
  options: { id: string; name: string }[];
  selected: string;
  onChoose: (id: string) => void;
  onClose: () => void;
  suggestions?: { id: string; reason: string }[];
  context?: string;
}) {
  const [query, setQuery] = React.useState("");
  const reasonId = React.useId();
  const search = (value: string) =>
    value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const visible = options.filter((option) =>
    search(option.name).includes(search(query.trim())),
  );
  const suggested = (suggestions ?? []).flatMap(suggestion => {
    const option = visible.find(option => option.id === suggestion.id);
    return option ? [{ ...option, reason: suggestion.reason }] : [];
  });
  const suggestedIds = new Set(suggested.map(option => option.id));
  const remaining = visible.filter(option => !suggestedIds.has(option.id));
  function choice(option: { id: string; name: string; reason?: string }) {
    return (
      <li key={option.id}>
        <button
          type="button"
          aria-label={option.name}
          aria-pressed={option.id === selected}
          aria-describedby={option.reason ? reasonId + option.id : undefined}
          className={"w-full rounded-lg border px-3 py-2 text-left hover:bg-gray-800 " +
            (option.reason ? "border-pink-400/40 bg-pink-400/5" : "border-gray-800")}
          onClick={() => {
            onChoose(option.id);
            onClose();
          }}
        >
          <span className="flex flex-wrap items-center gap-2">
            <span className="min-w-0 break-words">{option.name}</span>
            {option.reason && <span className="text-xs font-semibold text-pink-300">Sugestão</span>}
          </span>
          {option.reason && (
            <span id={reasonId + option.id} className="mt-1 block text-xs text-gray-400">
              {option.reason}
            </span>
          )}
        </button>
      </li>
    );
  }
  return (
    <EditorModal
      title={title}
      onClose={onClose}
      closeLabel="Fechar busca"
      doneLabel="Voltar"
      footerText=""
    >
      {context && <p className="mb-3 break-words text-sm text-gray-300">{context}</p>}
      <label className="block text-sm">
        Filtrar por nome
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-700 bg-black p-2"
        />
      </label>
      <div className="mt-3 max-h-[55vh] space-y-4 overflow-auto">
        {suggestions !== undefined && (suggested.length > 0 || !query.trim()) && (
          <section aria-label="Sugestões de bases" className="space-y-2">
            <h4 className="text-sm font-semibold">Sugestões</h4>
            <p className="text-xs text-gray-400">
              {suggested.length
                ? "Bases mais próximas dos dados da etiqueta. Confira antes de confirmar o vínculo."
                : "Nenhuma correspondência clara. Use a busca ou escolha uma base na lista."}
            </p>
            {!!suggested.length && <ul className="space-y-1">{suggested.map(choice)}</ul>}
          </section>
        )}
        {!!remaining.length && (
          <div className="space-y-2">
            {suggestions !== undefined && (
              <h4 className="text-sm font-semibold">{suggested.length ? "Outras bases" : "Todas as bases"}</h4>
            )}
            <ul className="space-y-1">{remaining.map(choice)}</ul>
          </div>
        )}
      </div>
      {!visible.length && (
        <p className="py-3 text-sm text-gray-400">Nenhum resultado.</p>
      )}
    </EditorModal>
  );
}
