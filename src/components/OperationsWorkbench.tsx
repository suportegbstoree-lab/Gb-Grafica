import React from "react";
import { Link, useLocation, useSearchParams } from "react-router-dom";
import type { OperationsClient } from "../services/operationsService";
import { workApi, type WorkApi } from "../services/workService";
import { durationLabel } from "./WorkdayBar";
import { ACTIVITY_LABELS } from "../lib/staffActivity";
import { downloadPersonalization } from "../services/personalizationExport";
const button =
  "rounded-lg border border-gray-700 px-4 py-2 text-sm font-bold disabled:opacity-40";
export default function OperationsWorkbench({
  workClient = workApi,
  fullAdmin = false,
}: {
  client?: OperationsClient;
  workClient?: WorkApi;
  fullAdmin?: boolean;
}) {
  const location = useLocation(),
    [params, setParams] = useSearchParams(),
    section = location.pathname.split("/")[3] || "",
    valid =
      ["", "production", "activity"].includes(section) &&
      location.pathname.split("/").filter(Boolean).length <= 3;
  const [people, setPeople] = React.useState<
    Array<{ id: string; name: string }>
  >([]);
  const [data, setData] = React.useState<any>(),
    [error, setError] = React.useState(""),
    [revision, setRevision] = React.useState(0),
    [busy, setBusy] = React.useState(false);
  const period = params.get("period") || "month",
    employee = params.get("employee") || "",
    page = Number(params.get("page") || 1);
  const query = new URLSearchParams({
    period,
    ...(employee ? { employee } : {}),
    page: String(page),
  }).toString();
  React.useEffect(() => {
    let active = true;
    setData(undefined);
    setError("");
    if (valid)
      void workClient
        .get(`/report?${query}`)
        .then((result) => {
          if (active) setData(result);
        })
        .catch((e) => {
          if (active) setError(e.message);
        });
    return () => {
      active = false;
    };
  }, [workClient, query, revision, valid]);
  React.useEffect(() => {
    if (data && !employee)
      setPeople(
        data.employees.map((person: any) => ({
          id: person.id,
          name: person.name,
        })),
      );
  }, [data, employee]);
  const filter = (changes: Record<string, string>) => {
    const next = new URLSearchParams(params);
    for (const [key, value] of Object.entries(changes)) {
      if (value) next.set(key, value);
      else next.delete(key);
    }
    if (!("page" in changes)) next.delete("page");
    setParams(next);
  };
  const navigation = [
    ["", "Visão geral"],
    ["production", "Produção"],
    ["activity", "Atividade"],
  ];
  const maximum = Math.max(1, ...(data?.days || []).map((d: any) => d.count)),
    total = (data?.employees || []).reduce(
      (sum: number, p: any) => sum + p.completed,
      0,
    );
  return (
    <section className="space-y-6">
      <header>
        <h2 className="text-2xl font-bold">
          Operações ·{" "}
          {navigation.find(([key]) => key === section)?.[1] ||
            "Página não encontrada"}
        </h2>
        <p className="mt-2 text-sm text-gray-400">
          Produção automática a partir das atividades concluídas, pedidos e PDFs
          gerados.
        </p>
      </header>
      <nav aria-label="Páginas de operações" className="flex flex-wrap gap-2">
        {navigation.map(([key, label]) => (
          <Link
            key={key}
            to={`/admin/operations${key ? "/" + key : ""}${location.search}`}
            aria-current={section === key ? "page" : undefined}
            className={`${button} ${section === key ? "bg-pink-500" : ""}`}
          >
            {label}
          </Link>
        ))}
      </nav>
      {!valid ? (
        <p>Página não encontrada.</p>
      ) : (
        <>
          <div className="flex flex-wrap items-end gap-3 rounded-xl border border-gray-800 p-4">
            <label className="text-sm">
              Período
              <select
                aria-label="Período da produtividade"
                value={period}
                onChange={(e) => filter({ period: e.target.value })}
                className="ml-3 rounded-lg border border-gray-700 bg-black p-3"
              >
                <option value="day">Hoje</option>
                <option value="week">Últimos 7 dias</option>
                <option value="month">Últimos 30 dias</option>
              </select>
            </label>
            {fullAdmin && (
              <label className="text-sm">
                Funcionário
                <select
                  aria-label="Filtrar funcionário"
                  value={employee}
                  onChange={(e) => filter({ employee: e.target.value })}
                  className="ml-3 rounded-lg border border-gray-700 bg-black p-3"
                >
                  <option value="">Todos</option>
                  {people.map((person) => (
                    <option key={person.id} value={person.id}>
                      {person.name}
                    </option>
                  ))}
                  {employee &&
                    !people.some((person) => person.id === employee) && (
                      <option value={employee}>{employee}</option>
                    )}
                </select>
              </label>
            )}
            <button
              className={button}
              onClick={() => setRevision((v) => v + 1)}
            >
              Atualizar atividades
            </button>
            <button
              disabled={busy}
              className={button}
              onClick={() => {
                setBusy(true);
                void workClient
                  .csv(`/report?${query}&format=csv`)
                  .then((blob) =>
                    downloadPersonalization(blob, "atividades-producao.csv"),
                  )
                  .catch((e) => setError(e.message))
                  .finally(() => setBusy(false));
              }}
            >
              Exportar CSV
            </button>
          </div>
          {error && (
            <p role="alert" className="rounded-lg bg-red-950 p-4 text-red-200">
              {error}
            </p>
          )}
          {!data && !error ? (
            <p role="status">Carregando atividades...</p>
          ) : (
            data && (
              <>
                {data.truncated && (
                  <p role="alert" className="text-amber-300">
                    O limite de registros foi atingido. Selecione um período
                    menor.
                  </p>
                )}
                <p className="text-sm text-gray-400">
                  {data.fullAdmin
                    ? "Visão administrativa da equipe."
                    : "Somente suas próprias atividades e horários são exibidos."}{" "}
                  Os intervalos registrados são descontados. Expedientes antigos
                  sem encerramento não recebem estimativa de horas.
                </p>
                <div className="grid gap-4 sm:grid-cols-3">
                  <article className="rounded-xl border border-gray-800 p-5">
                    <h3>Atividades concluídas</h3>
                    <p className="mt-2 text-3xl font-black">{total}</p>
                  </article>
                  <article className="rounded-xl border border-gray-800 p-5">
                    <h3>Funcionários com atividade</h3>
                    <p className="mt-2 text-3xl font-black">
                      {data.employees.length}
                    </p>
                  </article>
                  <article className="rounded-xl border border-gray-800 p-5">
                    <h3>PDFs gerados no período</h3>
                    <p className="mt-2 text-3xl font-black">
                      {data.generatedDocuments ?? "—"}
                    </p>
                  </article>
                </div>
                {section !== "activity" && (
                  <>
                    <figure className="rounded-xl border border-gray-800 p-5">
                      <figcaption className="font-bold">
                        Atividades concluídas por dia
                      </figcaption>
                      {data.days.length ? (
                        <svg
                          viewBox="0 0 640 200"
                          role="img"
                          aria-label="Quantidade de atividades concluídas por dia"
                          className="mt-4 w-full"
                        >
                          <line
                            x1="20"
                            y1="160"
                            x2="620"
                            y2="160"
                            stroke="#6b7280"
                          />
                          {data.days.map((day: any, i: number) => (
                            <rect
                              key={day.date}
                              x={20 + (i * 600) / data.days.length}
                              y={160 - (day.count / maximum) * 135}
                              width={Math.max(1, 480 / data.days.length)}
                              height={(day.count / maximum) * 135}
                              fill="#ff4d79"
                            >
                              <title>
                                {day.date}: {day.count} atividades
                              </title>
                            </rect>
                          ))}
                          <text x="20" y="190" fill="#c4c5ce" fontSize="12">
                            {data.days[0]?.date}
                          </text>
                          <text
                            x="620"
                            y="190"
                            textAnchor="end"
                            fill="#c4c5ce"
                            fontSize="12"
                          >
                            {data.days.at(-1)?.date}
                          </text>
                        </svg>
                      ) : (
                        <p className="mt-3 text-sm text-gray-400">
                          Nenhuma atividade concluída no período.
                        </p>
                      )}
                    </figure>
                    <div className="space-y-3">
                      <h3 className="font-bold">
                        Produtividade média por funcionário
                      </h3>
                      {data.employees.map((person: any) => {
                        const max = Math.max(
                          1,
                          ...data.employees.map(
                            (p: any) => p.averagePerDay || 0,
                          ),
                        );
                        return (
                          <article
                            key={person.id}
                            className="rounded-xl border border-gray-800 p-4"
                          >
                            <div className="flex flex-wrap justify-between gap-2">
                              <h4 className="font-bold">
                                {person.name} · {person.role}
                              </h4>
                              <span className="text-sm">
                                {person.completed} atividades ·{" "}
                                {person.averagePerDay === null
                                  ? "Sem expediente registrado"
                                  : `${person.averagePerDay.toFixed(1)} por dia registrado`}
                              </span>
                            </div>
                            <div
                              role="img"
                              aria-label={`Média diária de ${person.name}: ${person.averagePerDay ?? "não disponível"}`}
                              className="my-3 h-3 overflow-hidden rounded-full bg-gray-800"
                            >
                              <div
                                style={{
                                  width: `${((person.averagePerDay || 0) / max) * 100}%`,
                                }}
                                className="h-full rounded-full bg-pink-500"
                              />
                            </div>
                            <p className="text-xs text-gray-400">
                              Tempo registrado sem intervalos:{" "}
                              {durationLabel(person.workedMs)} ·{" "}
                              {person.averagePerHour === null
                                ? "Média por hora indisponível"
                                : `${person.averagePerHour.toFixed(1)} atividades por hora registrada`}
                              {person.incompleteDays
                                ? ` · ${person.incompleteDays} expediente(s) sem encerramento`
                                : ""}
                            </p>
                          </article>
                        );
                      })}
                    </div>
                  </>
                )}
                <section className="space-y-3">
                  <h3 className="font-bold">Expedientes e intervalos</h3>
                  <div className="overflow-x-auto rounded-xl border border-gray-800">
                    <table className="w-full min-w-[620px] text-left text-sm [&_td]:p-3 [&_td]:align-top">
                      <thead>
                        <tr>
                          {[
                            "Data",
                            "Funcionário",
                            "Início do expediente",
                            "Encerramento",
                            "Intervalos",
                            "Tempo sem intervalos",
                          ].map((title) => (
                            <th key={title} className="p-3">
                              {title}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.workdays.map((day: any) => (
                          <tr
                            key={`${day.uid}-${day.day}`}
                            className="border-t border-gray-800"
                          >
                            <td className="p-3">{day.day}</td>
                            <td>
                              {data.employees.find((p: any) => p.id === day.uid)
                                ?.name || day.uid}
                            </td>
                            <td>
                              {new Date(day.startedAt).toLocaleTimeString(
                                "pt-BR",
                              )}
                            </td>
                            <td>
                              {day.endedAt
                                ? new Date(day.endedAt).toLocaleTimeString(
                                    "pt-BR",
                                  )
                                : "Em aberto"}
                            </td>
                            <td>
                              {day.breaks
                                .map(
                                  (b: any) =>
                                    `${new Date(b.start).toLocaleTimeString("pt-BR")} – ${b.end ? new Date(b.end).toLocaleTimeString("pt-BR") : "em aberto"}`,
                                )
                                .join(" · ") || "Nenhum"}
                            </td>
                            <td>{durationLabel(day.workedMs)}</td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                </section>
                <section className="space-y-3">
                  <h3 className="font-bold">
                    Atividades e pedido / lote de origem
                  </h3>
                  <div className="overflow-x-auto rounded-xl border border-gray-800">
                    <table className="w-full min-w-[680px] text-left text-sm [&_td]:p-3 [&_td]:align-top">
                      <thead>
                        <tr>
                          {[
                            "Funcionário",
                            "Serviço",
                            "Início",
                            "Conclusão",
                            "Pedido / lote",
                            "Duração",
                          ].map((title) => (
                            <th key={title} className="p-3">
                              {title}
                            </th>
                          ))}
                        </tr>
                      </thead>
                      <tbody>
                        {data.records.map((row: any) => (
                          <tr key={row.id} className="border-t border-gray-800">
                            <td className="p-3">
                              {row.actorName || row.actor}
                              <span className="block text-xs text-gray-400">
                                {row.actorRole}
                              </span>
                            </td>
                            <td>{ACTIVITY_LABELS[row.action] || row.action}</td>
                            <td>
                              {new Date(row.startedAt || row.at).toLocaleString(
                                "pt-BR",
                              )}
                            </td>
                            <td>
                              {new Date(
                                row.completedAt || row.at,
                              ).toLocaleString("pt-BR")}
                            </td>
                            <td>{row.reference || row.entityId || "—"}</td>
                            <td>
                              {row.durationMs == null
                                ? "Não registrado"
                                : `${(row.durationMs / 1000).toFixed(1)} s`}
                              <span className="block text-[10px] text-gray-500">
                                {row.timing === "task"
                                  ? "Tarefa de edição"
                                  : row.timing === "request"
                                    ? "Ação rápida / requisição"
                                    : "Registro anterior"}
                              </span>
                            </td>
                          </tr>
                        ))}
                      </tbody>
                    </table>
                  </div>
                  <div className="flex items-center gap-3">
                    <button
                      disabled={page <= 1}
                      onClick={() => filter({ page: String(page - 1) })}
                      className={button}
                    >
                      Anterior
                    </button>
                    <span className="text-sm">
                      Página {page} · {data.count} atividades
                    </span>
                    <button
                      disabled={page * 50 >= data.count}
                      onClick={() => filter({ page: String(page + 1) })}
                      className={button}
                    >
                      Próxima
                    </button>
                  </div>
                </section>
              </>
            )
          )}
        </>
      )}
    </section>
  );
}
