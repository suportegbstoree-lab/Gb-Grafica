import { PRODUCTION_UNITS } from "../lib/operations";
interface Total {
  unit: string;
  completed: number;
}
export default function ProductionChart({
  daily,
}: {
  daily: Array<{ date: string; totals: Total[] }>;
}) {
  if (!daily.length) return null;
  return (
    <div className="grid gap-4 xl:grid-cols-3">
      {Object.entries(PRODUCTION_UNITS).map(([unit, label]) => {
        const values = daily.map((day) => ({
          date: day.date,
          value:
            day.totals.find((total) => total.unit === unit)?.completed || 0,
        }));
        if (!values.some((point) => point.value)) return null;
        const max = Math.max(1, ...values.map((point) => point.value)),
          step = 560 / values.length;
        return (
          <figure
            key={unit}
            className="min-w-0 rounded-xl border border-gray-800 p-4"
          >
            <figcaption className="mb-3 text-sm font-bold">
              Concluídas por dia · {label}
            </figcaption>
            <svg
              viewBox="0 0 600 180"
              role="img"
              aria-label={`Produção diária em ${label.toLowerCase()}. Valores detalhados na tabela abaixo.`}
              className="w-full"
            >
              <line x1="20" y1="155" x2="580" y2="155" stroke="#6b7280" />
              <text x="20" y="15" fill="#c4c5ce" fontSize="12">
                {max.toLocaleString("pt-BR")}
              </text>
              {values.map((point, index) => (
                <rect
                  key={point.date}
                  x={20 + index * step}
                  y={155 - (point.value / max) * 125}
                  width={Math.max(0.5, step * 0.8)}
                  height={(point.value / max) * 125}
                  rx="2"
                  fill="#ff4d79"
                >
                  <title>
                    {point.date}: {point.value} {label.toLowerCase()}
                  </title>
                </rect>
              ))}
              <text x="20" y="175" fill="#c4c5ce" fontSize="12">
                {values[0].date}
              </text>
              <text
                x="580"
                y="175"
                textAnchor="end"
                fill="#c4c5ce"
                fontSize="12"
              >
                {values.at(-1)!.date}
              </text>
            </svg>
          </figure>
        );
      })}
    </div>
  );
}
