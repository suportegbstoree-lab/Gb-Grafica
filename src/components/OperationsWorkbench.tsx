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
import UploadInput from "./UploadInput";

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
const actionLabels: Record<string, string> = {
  "production.created": "Produção registrada",
  "production.corrected": "Produção corrigida",
  "production.cancelled": "Produção cancelada",
  "machine.saved": "Equipamento atualizado",
  "release.created": "Versão cadastrada",
  OPERATIONS_FAILURE: "Falha operacional",
};
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
function Filters() {
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
function Logs({ kind }: { kind: "activity" | "errors" }) {
  const [params] = useSearchParams(),
    path = `/${kind}?${params}`,
    { data, error } = useData(path);
  return (
    <div className="space-y-5">
      <Filters />
      <CSVButton path={path} />
      <p className="text-sm text-gray-400">
        Eventos reais das operações realizadas neste painel. Não indica presença
        ou uso de programas externos.
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
                <td>{row.actor}</td>
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
function Machines({ id, create }: { id?: string; create?: boolean }) {
  const data = useData(id ? `/machines/${id}` : "/machines");
  if (create) return <MachineForm />;
  if (!data.data) return <Loading error={data.error} />;
  if (id)
    return (
      <MachineForm
        key={`${id}-${data.data.record.version}`}
        initial={data.data.record}
      />
    );
  return (
    <div className="space-y-5">
      <Link to="/admin/operations/machines/new" className={primaryStyle}>
        Novo equipamento
      </Link>
      <p className="text-sm text-gray-400">
        Inventário manual. A autorização deste cadastro não conecta nem controla
        computadores externos.
      </p>
      {data.data.truncated && (
        <p role="alert">Exibindo os 500 cadastros mais recentes.</p>
      )}
      <Table
        headings={["Nome", "ID", "Versão informada", "Autorizado", "Cadastro"]}
      >
        {data.data.records.map((row) => (
          <tr key={row.id}>
            <td className="p-3">{row.name}</td>
            <td>{row.machineId}</td>
            <td>{row.installedVersion || "—"}</td>
            <td>{row.authorized ? "Sim" : "Não"}</td>
            <td className="p-3">
              <Link
                to={`/admin/operations/machines/${row.id}/edit`}
                className="text-pink-400 underline"
              >
                Editar
              </Link>
            </td>
          </tr>
        ))}
      </Table>
    </div>
  );
}
function MachineForm({ initial }: { initial?: any; key?: string }) {
  const client = React.useContext(Client),
    navigate = useNavigate(),
    [draft, setDraft] = React.useState(
      initial || {
        id: crypto.randomUUID(),
        name: "",
        machineId: "",
        installedVersion: "",
        authorized: false,
        version: 0,
      },
    ),
    [error, setError] = React.useState(""),
    [busy, setBusy] = React.useState(false);
  return (
    <form
      className="max-w-xl space-y-4"
      onSubmit={(e) => {
        e.preventDefault();
        setBusy(true);
        setError("");
        void client
          .post(`/machines/${draft.id}`, draft)
          .then(() => navigate("/admin/operations/machines"))
          .catch((error) => setError(error.message))
          .finally(() => setBusy(false));
      }}
    >
      <fieldset disabled={busy} className="space-y-4">
        {[
          ["name", "Nome", 120],
          ["machineId", "ID do equipamento", 64],
          ["installedVersion", "Versão instalada (informada)", 30],
        ].map(([key, label, max]) => (
          <label key={key} className="block text-sm">
            {label}
            <input
              required={key !== "installedVersion"}
              maxLength={Number(max)}
              value={draft[key]}
              onChange={(e) => setDraft({ ...draft, [key]: e.target.value })}
              className={inputStyle}
            />
          </label>
        ))}
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={draft.authorized}
            onChange={(e) =>
              setDraft({ ...draft, authorized: e.target.checked })
            }
          />
          Cadastro autorizado
        </label>
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy} className={primaryStyle}>
        Salvar equipamento
      </button>
    </form>
  );
}
function Releases({ create }: { create: boolean }) {
  const { data, error } = useData("/releases"),
    client = React.useContext(Client),
    [actionError, setActionError] = React.useState("");
  if (create) return <ReleaseForm />;
  return (
    <div className="space-y-5">
      <Link to="/admin/operations/releases/new" className={primaryStyle}>
        Cadastrar versão
      </Link>
      <p className="text-sm text-gray-400">
        Arquivos privados para distribuição manual. Não instala atualizações nos
        computadores.
      </p>
      {actionError && <p role="alert">{actionError}</p>}
      {!data ? (
        <Loading error={error} />
      ) : (
        <>
          {data.truncated && <p>Exibindo as 500 versões mais recentes.</p>}
          <Table
            headings={[
              "Versão",
              "Descrição",
              "Obrigatória",
              "SHA-256",
              "Arquivo",
            ]}
          >
            {data.records.map((row) => (
              <tr key={row.id}>
                <td className="p-3">{row.version}</td>
                <td>{row.description}</td>
                <td>{row.mandatory ? "Sim" : "Não"}</td>
                <td className="max-w-xs break-all p-3 font-mono text-xs">
                  {row.sha256}
                </td>
                <td className="p-3">
                  <button
                    type="button"
                    className={buttonStyle}
                    onClick={() => {
                      setActionError("");
                      void client
                        .get(`/releases/${encodeURIComponent(row.id)}/download`)
                        .then((result) => window.location.assign(result.url))
                        .catch((error) => setActionError(error.message));
                    }}
                  >
                    Baixar
                  </button>
                </td>
              </tr>
            ))}
          </Table>
        </>
      )}
    </div>
  );
}
function ReleaseForm() {
  const client = React.useContext(Client),
    navigate = useNavigate(),
    [draft, setDraft] = React.useState({
      version: "",
      description: "",
      mandatory: false,
    }),
    [file, setFile] = React.useState<File>(),
    [busy, setBusy] = React.useState(false),
    [error, setError] = React.useState(""),
    upload = React.useRef<string>();
  const submit = async (event: React.FormEvent) => {
    event.preventDefault();
    if (!file || busy) return;
    setBusy(true);
    setError("");
    try {
      if (!upload.current) upload.current = await client.uploadRelease(file);
      await client.post("/releases", { ...draft, path: upload.current });
      upload.current = undefined;
      navigate("/admin/operations/releases");
    } catch (error) {
      setError(error.message);
    } finally {
      setBusy(false);
    }
  };
  return (
    <form onSubmit={submit} className="max-w-xl space-y-4">
      <fieldset disabled={busy} className="space-y-4">
        <label className="block text-sm">
          Versão
          <input
            required
            pattern="[A-Za-z0-9][A-Za-z0-9._-]{0,29}"
            maxLength={30}
            value={draft.version}
            onChange={(e) => setDraft({ ...draft, version: e.target.value })}
            className={inputStyle}
          />
        </label>
        <label className="block text-sm">
          Descrição
          <textarea
            maxLength={2000}
            value={draft.description}
            onChange={(e) =>
              setDraft({ ...draft, description: e.target.value })
            }
            className={inputStyle}
          />
        </label>
        <label className="flex gap-2">
          <input
            type="checkbox"
            checked={draft.mandatory}
            onChange={(e) =>
              setDraft({ ...draft, mandatory: e.target.checked })
            }
          />
          Versão obrigatória
        </label>
        <label className="block rounded-xl border border-dashed border-gray-600 p-4">
          Arquivo ZIP, EXE ou MSI · até 50 MB
          <UploadInput
            originalPdf
            accept=".zip,.exe,.msi"
            className="mt-2 block w-full"
            onChange={(event) => {
              const next = event.target.files?.[0];
              if (upload.current) {
                setError(
                  "Este formulário já enviou um arquivo. Abra um novo cadastro para trocá-lo.",
                );
                return;
              }
              setFile(next);
            }}
          />
        </label>
        {file && <p>{file.name}</p>}
      </fieldset>
      {error && <p role="alert">{error}</p>}
      <button disabled={busy || !file} className={primaryStyle}>
        {busy ? "Enviando e validando..." : "Salvar versão"}
      </button>
    </form>
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
    ["errors", "Erros"],
    ["people", "Pessoas"],
    ["machines", "Equipamentos"],
    ["releases", "Versões"],
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
            Produção, inventário e histórico da loja.
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
        ) : section === "activity" || section === "errors" ? (
          <Logs kind={section} />
        ) : section === "people" ? (
          <People />
        ) : section === "machines" ? (
          <Machines id={id !== "new" ? id : undefined} create={id === "new"} />
        ) : section === "releases" ? (
          <Releases create={id === "new"} />
        ) : (
          <ProductionReport overview />
        )}
      </section>
    </Client.Provider>
  );
}
