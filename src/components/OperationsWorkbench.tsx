import { ACTIVITY_LABELS } from '../lib/staffActivity';
import ProductionChart from "./ProductionChart";
import React from "react";
import {
  Link,
  useLocation,
  useNavigate,
  useSearchParams,
} from "react-router-dom";
import {
  localToday,
  PRODUCTION_UNITS,
  type ProductionEntry,
} from "../lib/operations";
import {
  operationsClient,
  type OperationsClient,
} from "../services/operationsService";
import { downloadPersonalization } from "../services/personalizationExport";

const Client = React.createContext(operationsClient);
const inputStyle =
  "mt-1 w-full rounded-lg border border-gray-700 bg-black p-3 text-sm";
const buttonStyle =
  "inline-block rounded-lg border border-gray-700 px-4 py-3 text-sm font-bold disabled:opacity-40";
const primaryStyle = `${buttonStyle} bg-pink-500 text-white`;
const labels: Record<string, string> = {
  employeeId: "Funcionário",
  date: "Data da produção",
  service: "Serviço",
  unit: "Unidade",
  completed: "Concluídas",
  rework: "Com retrabalho",
  loss: "Perdas",
  reason: "Motivo",
  reference: "Pedido / lote",
  notes: "Observação",
  cancelledAt: "Cancelado em",
  cancellationReason: "Motivo do cancelamento",
};
const actionLabels = ACTIVITY_LABELS;
function useData(path: string) {
  const client = React.useContext(Client),
    [data, setData] = React.useState<any>(),
    [error, setError] = React.useState(""),
    [revision, setRevision] = React.useState(0);
  React.useEffect(() => {
    let alive = true;
    setData(undefined);
    setError("");
    client
      .get(path)
      .then((result) => {
        if (alive) setData(result);
      })
      .catch((reason) => {
        if (alive) setError(reason.message);
      });
    return () => {
      alive = false;
    };
  }, [client, path, revision]);
  return { data, error, reload: () => setRevision((value) => value + 1) };
}
function Loading({ error }: { error: string }) {
  return error ? (
    <p role="alert" className="rounded-lg bg-red-950 p-4 text-red-200">
      {error}
    </p>
  ) : (
    <p role="status" className="py-8 text-gray-400">
      Carregando...
    </p>
  );
}
function Table({
  headings,
  children,
}: {
  headings: string[];
  children: React.ReactNode;
}) {
  return (
    <div className="overflow-x-auto rounded-xl border border-gray-800">
      <table className="w-full text-left text-sm">
        <thead className="bg-black/40">
          <tr>
            {headings.map((heading) => (
              <th key={heading} className="p-3">
                {heading}
              </th>
            ))}
          </tr>
        </thead>
        <tbody className="divide-y divide-gray-800">{children}</tbody>
      </table>
    </div>
  );
}
function CSVButton({ path }: { path: string }) {
  const client = React.useContext(Client),
    [error, setError] = React.useState(""),
    [busy, setBusy] = React.useState(false);
  return (
    <>
      <button
        type="button"
        disabled={busy}
        className={buttonStyle}
        onClick={() => {
          setBusy(true);
          setError("");
          void client
            .csv(`${path}${path.includes("?") ? "&" : "?"}format=csv`)
            .then((blob) => downloadPersonalization(blob, "relatorio.csv"))
            .catch((error) => setError(error.message))
            .finally(() => setBusy(false));
        }}
      >
        Exportar CSV
      </button>
      {error && <span role="alert">{error}</span>}
    </>
  );
}
function Filters({ activity = false }: { activity?: boolean }) {
  const [params, setParams] = useSearchParams(),
    persons = useData("/people");
  const end = params.get("end") || localToday(),
    start =
      params.get("start") ||
      new Date(Date.parse(end) - 29 * 86400_000).toISOString().slice(0, 10);
  const change = (key: string, value: string) => {
    const next = new URLSearchParams(params);
    if (value) next.set(key, value);
    else next.delete(key);
    next.delete("page");
    setParams(next);
  };
  return (
    <div className="grid gap-3 rounded-xl border border-gray-800 p-4 sm:grid-cols-2 xl:grid-cols-4">
      <label className="text-xs">
        De
        <input
          aria-label="Data inicial"
          type="date"
          value={start}
          max={end}
          onChange={(e) => change("start", e.target.value)}
          className={inputStyle}
        />
      </label>
      <label className="text-xs">
        Até
        <input
          aria-label="Data final"
          type="date"
          value={end}
          max={localToday()}
          onChange={(e) => change("end", e.target.value)}
          className={inputStyle}
        />
      </label>
      <label className="text-xs">
        Funcionário
        <select
          aria-label="Filtrar funcionário"
          value={params.get("employee") || ""}
          onChange={(e) => change("employee", e.target.value)}
          className={inputStyle}
        >
          <option value="">Todos</option>
          {persons.data?.people.map((person) => (
            <option key={person.id} value={person.id}>
              {person.name}
            </option>
          ))}
        </select>
      </label>
      {!activity && <>
      <label className="text-xs">
        Unidade
        <select
          aria-label="Filtrar unidade"
          value={params.get("unit") || ""}
          onChange={(e) => change("unit", e.target.value)}
          className={inputStyle}
        >
          <option value="">Todas (totais separados)</option>
          {Object.entries(PRODUCTION_UNITS).map(([key, name]) => (
            <option key={key} value={key}>
              {name}
            </option>
          ))}
        </select>
      </label>
      <label className="text-xs">
        Serviço
        <input
          aria-label="Filtrar serviço"
          value={params.get("service") || ""}
          onChange={(e) => change("service", e.target.value)}
          className={inputStyle}
        />
      </label>
      <label className="flex items-center gap-2 text-sm">
        <input
          type="checkbox"
          checked={params.get("cancelled") === "true"}
          onChange={(e) => change("cancelled", e.target.checked ? "true" : "")}
        />
        Mostrar cancelados
      </label>
      </>}
    </div>
  );
}
function Pagination({ page, count }: { page: number; count: number }) {
  const [params, setParams] = useSearchParams();
  const go = (page: number) => {
    const next = new URLSearchParams(params);
    next.set("page", String(page));
    setParams(next);
  };
  return (
    <div className="flex flex-wrap items-center gap-4">
      <button
        className={buttonStyle}
        disabled={page <= 1}
        onClick={() => go(page - 1)}
      >
        Anterior
      </button>
      <span>
        Página {page} de {Math.max(1, Math.ceil(count / 50))} · {count}{" "}
        registros
      </span>
      <button
        className={buttonStyle}
        disabled={page * 50 >= count}
        onClick={() => go(page + 1)}
      >
        Próxima
      </button>
    </div>
  );
}
function ProductionReport({ overview = false }: { overview?: boolean }) {
  const [params] = useSearchParams(),
    path = `/production?${params}`,
    { data, error } = useData(path),
    persons = useData("/people");
  return (
    <div className="space-y-6">
      <div className="flex flex-wrap items-center gap-3">
        <Link to="/admin/operations/production/new" className={primaryStyle}>
          Novo lançamento
        </Link>
        <CSVButton path={path} />
      </div>
      <Filters />
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          {data.truncated && (
            <p role="alert">
              Período excede 10.000 registros. Reduza as datas para obter um
              relatório completo.
            </p>
          )}
          <div className="grid gap-4 lg:grid-cols-3">
            {data.totals.map((total) => {
              const previous = data.previous.find(
                (item) => item.unit === total.unit,
              );
              return (
                <article
                  key={total.unit}
                  className="rounded-xl border border-gray-800 bg-black/30 p-5"
                >
                  <h3 className="font-bold">{PRODUCTION_UNITS[total.unit]}</h3>
                  <p className="my-3 text-3xl font-black">
                    {total.completed.toLocaleString("pt-BR")}
                  </p>
                  <p className="text-xs text-gray-400">
                    Concluídas · período anterior: {previous?.completed || 0}
                  </p>
                  <p className="mt-3 text-sm">
                    Retrabalhos: {total.rework} ({total.reworkRate.toFixed(1)}%)
                  </p>
                  <p className="text-sm">
                    Perdas: {total.loss} ({total.lossRate.toFixed(1)}%)
                  </p>
                </article>
              );
            })}
          </div>
          {overview && (
            <>
              <ProductionChart daily={data.daily} />
              <h3 className="text-lg font-bold">Produção por dia</h3>
              <Table
                headings={[
                  "Data",
                  "Unidade",
                  "Concluídas",
                  "Retrabalho",
                  "Perdas",
                ]}
              >
                {data.daily.flatMap((day) =>
                  day.totals
                    .filter((total) => total.completed || total.loss)
                    .map((total) => (
                      <tr key={`${day.date}-${total.unit}`}>
                        <td className="p-3">{day.date}</td>
                        <td>{PRODUCTION_UNITS[total.unit]}</td>
                        <td>{total.completed}</td>
                        <td>{total.rework}</td>
                        <td>{total.loss}</td>
                      </tr>
                    )),
                )}
              </Table>
              <h3 className="text-lg font-bold">Por funcionário</h3>
              <Table
                headings={[
                  "Funcionário",
                  "Unidade",
                  "Concluídas",
                  "Retrabalho",
                  "Perdas",
                ]}
              >
                {data.byEmployee.flatMap((person) =>
                  person.totals
                    .filter((total) => total.completed || total.loss)
                    .map((total) => (
                      <tr key={`${person.employeeId}-${total.unit}`}>
                        <td className="p-3">
                          {persons.data?.people.find(
                            (p) => p.id === person.employeeId,
                          )?.name || person.employeeId}
                        </td>
                        <td>{PRODUCTION_UNITS[total.unit]}</td>
                        <td>{total.completed}</td>
                        <td>{total.rework}</td>
                        <td>{total.loss}</td>
                      </tr>
                    )),
                )}
              </Table>
            </>
          )}
          <Table
            headings={[
              "Data",
              "Funcionário",
              "Serviço",
              "Unidade",
              "Concluídas",
              "Perdas",
              "Registro",
            ]}
          >
            {data.records.map((row) => (
              <tr
                key={row.id}
                className={row.cancelledAt ? "text-gray-500" : ""}
              >
                <td className="p-3">{row.date}</td>
                <td>
                  {persons.data?.people.find((p) => p.id === row.employeeId)
                    ?.name || row.employeeId}
                </td>
                <td>{row.service}</td>
                <td>{PRODUCTION_UNITS[row.unit]}</td>
                <td>{row.completed}</td>
                <td>{row.loss}</td>
                <td className="p-3">
                  <Link
                    to={`/admin/operations/production/${row.id}`}
                    className="text-pink-400 underline"
                  >
                    {row.cancelledAt ? "Cancelado" : "Detalhes"}
                  </Link>
                </td>
              </tr>
            ))}
          </Table>
          {!data.count && <p>Nenhum lançamento no período.</p>}
          <Pagination page={data.page} count={data.count} />
        </>
      )}
    </div>
  );
}
function EntryForm({
  initial,
  id,
}: {
  initial?: any;
  id?: string;
  key?: string;
}) {
  const client = React.useContext(Client),
    navigate = useNavigate(),
    persons = useData("/people");
  const [draft, setDraft] = React.useState<ProductionEntry>(
    initial || {
      employeeId: "",
      date: localToday(),
      service: "",
      unit: "pecas",
      completed: 0,
      rework: 0,
      loss: 0,
      reason: "",
      reference: "",
      notes: "",
    },
  );
  const [requestId] = React.useState(() => crypto.randomUUID()),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState("");
  const submit = async (e: React.FormEvent) => {
    e.preventDefault();
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await client.post(
        id ? `/production/${id}` : "/production",
        { ...draft, ...(id ? { version: initial.version } : { requestId }) },
      );
      navigate(`/admin/operations/production/${result.id}`);
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="max-w-4xl space-y-5">
      <fieldset disabled={busy} className="grid gap-4 sm:grid-cols-2">
        <label className="text-sm">
          Funcionário
          <select
            required
            value={draft.employeeId}
            onChange={(e) => setDraft({ ...draft, employeeId: e.target.value })}
            className={inputStyle}
          >
            <option value="">Selecionar</option>
            {initial?.employeeId &&
              !persons.data?.people.some(
                (person) => person.id === initial.employeeId,
              ) && (
                <option value={initial.employeeId}>
                  Cadastro anterior ({initial.employeeId})
                </option>
              )}
            {persons.data?.people.map((person) => (
              <option key={person.id} value={person.id}>
                {person.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-sm">
          Data da produção
          <input
            required
            type="date"
            max={localToday()}
            value={draft.date}
            onChange={(e) => setDraft({ ...draft, date: e.target.value })}
            className={inputStyle}
          />
        </label>
        <label className="text-sm">
          Serviço
          <input
            required
            maxLength={120}
            value={draft.service}
            onChange={(e) => setDraft({ ...draft, service: e.target.value })}
            className={inputStyle}
          />
        </label>
        <label className="text-sm">
          Unidade
          <select
            value={draft.unit}
            onChange={(e) =>
              setDraft({
                ...draft,
                unit: e.target.value as ProductionEntry["unit"],
              })
            }
            className={inputStyle}
          >
            {Object.entries(PRODUCTION_UNITS).map(([key, value]) => (
              <option key={key} value={key}>
                {value}
              </option>
            ))}
          </select>
        </label>
        {(["completed", "rework", "loss"] as const).map((key) => (
          <label key={key} className="text-sm">
            {labels[key]}
            <input
              required
              type="number"
              min={0}
              max={1000000}
              step={1}
              value={draft[key]}
              onChange={(e) =>
                setDraft({
                  ...draft,
                  [key]: e.target.value === "" ? "" : Number(e.target.value),
                })
              }
              className={inputStyle}
            />
          </label>
        ))}
        {(["reason", "reference", "notes"] as const).map((key) => (
          <label key={key} className="text-sm">
            {labels[key]}
            <textarea
              required={key === "reason" && Boolean(draft.rework || draft.loss)}
              maxLength={key === "notes" ? 2000 : key === "reason" ? 1000 : 120}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              className={inputStyle}
            />
          </label>
        ))}
      </fieldset>
      <p className="text-xs text-gray-400">
        Retrabalho faz parte das concluídas. Peças, lotes e arquivos têm totais
        separados.
      </p>
      {error && (
        <p role="alert" className="text-red-300">
          {error}
        </p>
      )}
      <button disabled={busy} className={primaryStyle}>
        Salvar lançamento
      </button>{" "}
      <Link to="/admin/operations/production" className={buttonStyle}>
        Cancelar
      </Link>
    </form>
  );
}
function EntryDetail({
  id,
  edit,
}: {
  id: string;
  edit: boolean;
  key?: string;
}) {
  const { data, error, reload } = useData(`/production/${id}`),
    client = React.useContext(Client),
    [reason, setReason] = React.useState(""),
    [actionError, setActionError] = React.useState(""),
    [busy, setBusy] = React.useState(false);
  if (!data) return <Loading error={error} />;
  const record = data.record;
  if (edit && !record.cancelledAt)
    return (
      <EntryForm key={`${id}-${record.version}`} id={id} initial={record} />
    );
  return (
    <div className="space-y-6">
      <dl className="grid gap-4 rounded-xl border border-gray-800 p-5 sm:grid-cols-2">
        {Object.entries(labels)
          .filter(([key]) => record[key] !== undefined && record[key] !== "")
          .map(([key, label]) => (
            <div key={key}>
              <dt className="text-xs text-gray-400">{label}</dt>
              <dd className="break-words whitespace-pre-wrap">
                {key === "unit"
                  ? PRODUCTION_UNITS[record[key]]
                  : String(record[key])}
              </dd>
            </div>
          ))}
      </dl>
      {!record.cancelledAt && (
        <>
          <Link
            to={`/admin/operations/production/${id}/edit`}
            className={buttonStyle}
          >
            Corrigir lançamento
          </Link>
          <form
            className="max-w-lg space-y-3"
            onSubmit={(e) => {
              e.preventDefault();
              setBusy(true);
              setActionError("");
              void client
                .post(`/production/${id}`, {
                  version: record.version,
                  cancel: true,
                  reason,
                })
                .then(reload)
                .catch((error) => setActionError(error.message))
                .finally(() => setBusy(false));
            }}
          >
            <label className="block text-sm">
              Motivo do cancelamento
              <textarea
                required
                maxLength={500}
                value={reason}
                onChange={(e) => setReason(e.target.value)}
                className={inputStyle}
              />
            </label>
            <button disabled={busy} className={buttonStyle}>
              Cancelar lançamento
            </button>
            {actionError && <p role="alert">{actionError}</p>}
          </form>
        </>
      )}
      <h3 className="font-bold">Histórico de alterações</h3>
      {data.history.map((event) => (
        <article
          key={event.after.version}
          className="space-y-3 rounded-xl border border-gray-800 p-5"
        >
          <p>
            Versão {event.after.version} ·{" "}
            {event.action === "created"
              ? "Criação"
              : event.action === "corrected"
                ? "Correção"
                : "Cancelamento"}{" "}
            · {new Date(event.at).toLocaleString("pt-BR")} · {event.actor}
          </p>
          <dl className="text-sm">
            {Object.entries(labels)
              .filter(
                ([key]) =>
                  event.before?.[key] !== event.after[key] &&
                  event.after[key] !== undefined,
              )
              .map(([key, label]) => (
                <div key={key} className="break-words">
                  <dt className="inline font-bold">{label}: </dt>
                  <dd className="inline">
                    {event.before ? `${event.before[key] ?? "—"} → ` : ""}
                    {String(event.after[key])}
                  </dd>
                </div>
              ))}
          </dl>
        </article>
      ))}
      {data.historyTruncated && (
        <p>Exibindo as 100 alterações mais recentes.</p>
      )}
    </div>
  );
}
function ActivityOverview() {
  const [params] = useSearchParams(), { data, error, reload } = useData(`/activity?${params}`);
  const summary = data?.summary;
  const maximum = Math.max(1, ...(summary?.days || []).map(day => day.count));
  return <div className="space-y-5">
    <Filters activity />
    <div className="flex flex-wrap items-center gap-3"><button type="button" onClick={reload} className={buttonStyle}>Atualizar atividade</button><CSVButton path={`/activity?${params}`} /></div>
    <p className="text-sm text-gray-400">As ações da equipe alimentam este painel automaticamente. Contagens de atividade não representam tempo trabalhado nem quantidade de peças produzidas.</p>
    {!summary ? <Loading error={error} /> : <>
      {data.truncated && <p role="alert">Há mais de 10.000 eventos. Reduza o período para conferir todos os registros.</p>}
      <div className="grid gap-4 sm:grid-cols-2"><article className="rounded-xl border border-gray-800 p-5"><h3>Ações registradas</h3><p className="mt-2 text-3xl font-black">{summary.total}</p></article><article className="rounded-xl border border-gray-800 p-5"><h3>Funcionários com atividade</h3><p className="mt-2 text-3xl font-black">{summary.employees.length}</p></article></div>
      {summary.days.length > 0 && <figure className="rounded-xl border border-gray-800 p-4"><figcaption className="font-bold">Atividade por dia</figcaption><svg viewBox="0 0 600 180" role="img" aria-label="Quantidade de ações da equipe por dia" className="mt-3 w-full"><line x1="20" y1="150" x2="580" y2="150" stroke="#6b7280" />{summary.days.map((day, index) => <rect key={day.date} x={20 + index * 560 / summary.days.length} y={150 - day.count / maximum * 130} width={Math.max(0.5, 440 / summary.days.length)} height={day.count / maximum * 130} fill="#ff4d79"><title>{day.date}: {day.count} ações</title></rect>)}<text x="20" y="175" fill="#c4c5ce" fontSize="12">{summary.days[0]?.date}</text><text x="580" y="175" textAnchor="end" fill="#c4c5ce" fontSize="12">{summary.days.at(-1)?.date}</text></svg></figure>}
      <h3 className="font-bold">Atividade por funcionário</h3><Table headings={["Nome", "Cargo", "Ações"]}>{summary.employees.map(person => <tr key={person.id}><td className="p-3">{person.name}</td><td>{person.role}</td><td>{person.count}</td></tr>)}</Table>
      <h3 className="font-bold">Tipos de ação</h3><Table headings={["Ação", "Quantidade"]}>{summary.actions.map(row => <tr key={row.action}><td className="p-3">{ACTIVITY_LABELS[row.action] || row.action}</td><td>{row.count}</td></tr>)}</Table>
      {!summary.total && <p>Nenhuma atividade registrada no período.</p>}
    </>}
  </div>;
}
function Logs({ kind }: { kind: "activity" }) {
  const [params] = useSearchParams(),
    path = `/${kind}?${params}`,
    { data, error } = useData(path);
  return (
    <div className="space-y-5">
      <Filters activity />
      <CSVButton path={path} />
      <p className="text-sm text-gray-400">
        Ações registradas pelo servidor com o funcionário e o cargo associados. Acessos às artes indicam solicitação de acesso ou exportação.
      </p>
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          {data.truncated && (
            <p role="alert">Reduza o período para obter todos os eventos.</p>
          )}
          <Table headings={["Data/hora", "Autor", "Evento", "Registro"]}>
            {data.records.map((row) => (
              <tr key={row.id}>
                <td className="p-3">
                  {new Date(row.at).toLocaleString("pt-BR")}
                </td>
                <td className="break-words">{row.actorName || row.actor}{row.actorRole && <span className="block text-xs text-gray-400">{row.actorRole}</span>}</td>
                <td>
                  {actionLabels[row.action || row.code] ||
                    row.action ||
                    row.code}
                </td>
                <td>{row.entityId || "—"}</td>
              </tr>
            ))}
          </Table>
          {!data.count && <p>Nenhum evento registrado.</p>}
          <Pagination page={data.page} count={data.count} />
        </>
      )}
    </div>
  );
}
function People() {
  const { data, error } = useData("/people");
  return (
    <div className="space-y-5">
      <p>
        Contas da loja com acesso ativo. Funções e permissões são configuradas
        pelo administrador da loja.
      </p>
      {!data ? (
        <Loading error={error} />
      ) : (
        <Table headings={["Nome", "E-mail", "Função"]}>
          {data.people.map((person) => (
            <tr key={person.id}>
              <td className="p-3">{person.name}</td>
              <td>{person.email}</td>
              <td>{person.role}</td>
            </tr>
          ))}
        </Table>
      )}
    </div>
  );
}
export default function OperationsWorkbench({
  client = operationsClient,
}: {
  client?: OperationsClient;
}) {
  const location = useLocation(),
    parts = location.pathname.split("/").slice(3),
    section = parts[0] || "",
    id = parts[1],
    edit = parts[2] === "edit";
  const navigation = [
    ["", "Visão geral"],
    ["production", "Produção"],
    ["activity", "Atividade"],

    ["people", "Pessoas"],


  ];
  const valid = navigation.some(([key]) => key === section);
  return (
    <Client.Provider value={client}>
      <section className="space-y-6">
        <header>
          <h2 className="text-2xl font-bold">
            Operações ·{" "}
            {navigation.find(([key]) => key === section)?.[1] ||
              "Página não encontrada"}
          </h2>
          <p className="mt-2 text-sm text-gray-400">
            Atividade da equipe, produção e histórico da loja.
          </p>
        </header>
        <nav aria-label="Páginas de operações" className="flex flex-wrap gap-2">
          {navigation.map(([key, label]) => (
            <Link
              key={key}
              to={`/admin/operations${key ? "/" + key : ""}`}
              aria-current={section === key ? "page" : undefined}
              className={`${buttonStyle} ${section === key ? "bg-pink-500" : ""}`}
            >
              {label}
            </Link>
          ))}
        </nav>
        {!valid ? (
          <p>Página não encontrada.</p>
        ) : section === "production" ? (
          id === "new" ? (
            <EntryForm />
          ) : id ? (
            <EntryDetail key={`${id}-${edit}`} id={id} edit={edit} />
          ) : (
            <ProductionReport />
          )
        ) : section === "activity" ? (
          <Logs kind={section} />
        ) : section === "people" ? (
          <People />
        ) : (
          <ActivityOverview />
        )}
      </section>
    </Client.Provider>
  );
}
