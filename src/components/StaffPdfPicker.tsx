import React from "react";
import EditorModal from "./EditorModal";

export default function StaffPdfPicker({
  title,
  options,
  selected,
  onChoose,
  onClose,
}: {
  title: string;
  options: { id: string; name: string }[];
  selected: string;
  onChoose: (id: string) => void;
  onClose: () => void;
}) {
  const [query, setQuery] = React.useState("");
  const search = (value: string) =>
    value.normalize("NFD").replace(/\p{M}/gu, "").toLowerCase();
  const visible = options.filter((option) =>
    search(option.name).includes(search(query.trim())),
  );
  return (
    <EditorModal
      title={title}
      onClose={onClose}
      closeLabel="Fechar busca"
      doneLabel="Voltar"
      footerText=""
    >
      <label className="block text-sm">
        Filtrar por nome
        <input
          value={query}
          onChange={(event) => setQuery(event.target.value)}
          className="mt-1 block w-full rounded-lg border border-gray-700 bg-black p-2"
        />
      </label>
      <ul className="mt-3 max-h-[55vh] space-y-1 overflow-auto">
        {visible.map((option) => (
          <li key={option.id}>
            <button
              type="button"
              aria-pressed={option.id === selected}
              className="w-full rounded-lg border border-gray-800 px-3 py-2 text-left hover:bg-gray-800"
              onClick={() => {
                onChoose(option.id);
                onClose();
              }}
            >
              {option.name}
            </button>
          </li>
        ))}
      </ul>
      {!visible.length && (
        <p className="py-3 text-sm text-gray-400">Nenhum resultado.</p>
      )}
    </EditorModal>
  );
}
