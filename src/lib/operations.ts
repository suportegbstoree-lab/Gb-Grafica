export const PRODUCTION_UNITS = {
  pecas: "Peças",
  lotes: "Lotes",
  arquivos: "Arquivos",
} as const;
export interface ProductionEntry {
  employeeId: string;
  date: string;
  service: string;
  unit: keyof typeof PRODUCTION_UNITS;
  completed: number;
  rework: number;
  loss: number;
  reason: string;
  reference: string;
  notes: string;
}
export class OperationsError extends Error {
  constructor(
    message: string,
    public status = 422,
  ) {
    super(message);
  }
}
export const localToday = () =>
  new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(new Date());
export function validDay(value: unknown): value is string {
  return (
    typeof value === "string" &&
    /^\d{4}-\d{2}-\d{2}$/.test(value) &&
    Number.isFinite(Date.parse(value)) &&
    new Date(value).toISOString().slice(0, 10) === value
  );
}
export function boundedText(
  value: unknown,
  label: string,
  max: number,
  required = false,
) {
  if (
    typeof value !== "string" ||
    value.length > max ||
    (required && !value.trim())
  )
    throw new OperationsError(
      `${label}: ${required ? "preencha com" : "use"} até ${max} caracteres.`,
    );
  return value.trim();
}
export function validateProduction(
  input: Record<string, unknown>,
  allowed: string[],
  preservedId?: string,
): ProductionEntry {
  const employeeId = boundedText(input.employeeId, "Funcionário", 128, true);
  if (!allowed.includes(employeeId) && preservedId !== employeeId)
    throw new OperationsError("Selecione um funcionário ativo.");
  if (
    !validDay(input.date) ||
    input.date < "1970-01-01" ||
    input.date > localToday()
  )
    throw new OperationsError("Informe uma data de produção válida, até hoje.");
  if (!Object.hasOwn(PRODUCTION_UNITS, String(input.unit)))
    throw new OperationsError("Selecione a unidade.");
  const counts = ["completed", "rework", "loss"].map((key) => {
    const value = input[key];
    if (
      typeof value !== "number" ||
      !Number.isSafeInteger(value) ||
      value < 0 ||
      value > 1_000_000
    )
      throw new OperationsError(
        "As quantidades devem ser inteiras entre 0 e 1.000.000.",
      );
    return value;
  });
  const [completed, rework, loss] = counts;
  if (completed + loss === 0 || rework > completed)
    throw new OperationsError(
      "Informe produção ou perda; retrabalhos fazem parte das concluídas.",
    );
  const reason = boundedText(input.reason || "", "Motivo", 1000);
  if ((rework || loss) && !reason)
    throw new OperationsError("Informe o motivo do retrabalho ou da perda.");
  return {
    employeeId,
    date: input.date,
    service: boundedText(input.service, "Serviço", 120, true),
    unit: input.unit as ProductionEntry["unit"],
    completed,
    rework,
    loss,
    reason,
    reference: boundedText(input.reference || "", "Pedido/lote", 120),
    notes: boundedText(input.notes || "", "Observação", 2000),
  };
}
export function csvRows(rows: unknown[][]): string {
  return (
    "\uFEFF" +
    rows
      .map((row) =>
        row
          .map((cell) => {
            let value = String(cell ?? "");
            if (/^[\s]*[=+@-]/.test(value)) value = "'" + value;
            return `"${value.replaceAll('"', '""')}"`;
          })
          .join(";"),
      )
      .join("\r\n")
  );
}
export function productionTotals(entries: ProductionEntry[]) {
  const totals = Object.keys(PRODUCTION_UNITS).map((unit) => {
    const rows = entries.filter((row) => row.unit === unit),
      completed = rows.reduce((sum, row) => sum + row.completed, 0),
      rework = rows.reduce((sum, row) => sum + row.rework, 0),
      loss = rows.reduce((sum, row) => sum + row.loss, 0);
    return {
      unit,
      completed,
      rework,
      loss,
      reworkRate: completed ? (rework / completed) * 100 : 0,
      lossRate: completed + loss ? (loss / (completed + loss)) * 100 : 0,
    };
  });
  return totals;
}
