export interface StaffPdfQueueProgressValue {
  status: "processing" | "waiting" | "completed" | "paused" | "error";
  total: number;
  completed: number;
  failed: number;
}

const labels = {
  processing: "Gerando PDFs",
  waiting: "Aguardando o limite de geração",
  completed: "Processamento de PDFs concluído",
  paused: "Geração de PDFs pausada",
  error: "Falha no processamento de PDFs",
};

export default function StaffPdfQueueProgress({
  value,
}: {
  value: StaffPdfQueueProgressValue;
}) {
  const processed = value.completed + value.failed;
  return (
    <section
      aria-label="Processamento da fila de PDFs"
      className="space-y-2 rounded-xl border border-gray-800 p-4 text-sm"
    >
      <p role="status">
        {labels[value.status]} · {processed} de {value.total} processado(s)
        {value.failed > 0 && ` · ${value.failed} com erro`}
      </p>
      <progress
        aria-label="Progresso da fila de PDFs"
        max={value.total}
        value={processed}
        className="block w-full accent-pink-500"
      />
    </section>
  );
}
