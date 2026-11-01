import React from "react";
import { workApi, type WorkApi } from "../services/workService";
import { workDay, workdayMilliseconds, type Workday } from "../lib/work";
export function durationLabel(ms: number | null) {
  if (ms === null) return "Não encerrado";
  const minutes = Math.floor(Math.max(0, ms) / 60000);
  return `${Math.floor(minutes / 60)}h ${String(minutes % 60).padStart(2, "0")}min`;
}
export default function WorkdayBar({ api = workApi }: { api?: WorkApi }) {
  const [day, setDay] = React.useState<Workday | null>(null),
    [error, setError] = React.useState(""),
    [busy, setBusy] = React.useState(false),
    [now, setNow] = React.useState(Date.now());
  const alive = React.useRef(true);
  const date = workDay(now);
  React.useEffect(() => {
    alive.current = true;
    void api
      .post("/day", { action: "open" })
      .then((result) => {
        if (alive.current) setDay(result.day);
      })
      .catch((e) => {
        if (alive.current) setError(e.message);
      });
    const timer = setInterval(() => setNow(Date.now()), 30000);
    return () => {
      alive.current = false;
      clearInterval(timer);
    };
  }, [api, date]);
  const change = async (action: string) => {
    if (busy) return;
    setBusy(true);
    setError("");
    try {
      const result = await api.post("/day", { action });
      if (alive.current) setDay(result.day);
    } catch (e) {
      if (alive.current) setError((e as Error).message);
    } finally {
      if (alive.current) setBusy(false);
    }
  };
  return (
    <section
      aria-label="Meu expediente"
      className="mb-6 rounded-xl border border-gray-800 bg-[#151515] p-4 text-sm"
    >
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <p className="font-bold">
            Meu expediente
            {day
              ? ` · ${day.status === "working" ? "Em atividade" : day.status === "break" ? "Em intervalo" : "Encerrado"}`
              : ""}
          </p>
          {day && (
            <p className="mt-1 text-xs text-gray-400">
              Início: {new Date(day.startedAt).toLocaleTimeString("pt-BR")} ·
              Tempo sem intervalos:{" "}
              {durationLabel(workdayMilliseconds(day, now))}
            </p>
          )}
        </div>
        <div className="flex flex-wrap gap-2">
          {day?.status === "working" && (
            <button
              disabled={busy}
              onClick={() => void change("break")}
              className="rounded-lg border border-gray-700 px-3 py-2 text-xs"
            >
              Iniciar intervalo
            </button>
          )}
          {day?.status === "break" && (
            <button
              disabled={busy}
              onClick={() => void change("return")}
              className="rounded-lg border border-gray-700 px-3 py-2 text-xs"
            >
              Retornar do intervalo
            </button>
          )}
          {day && day.status !== "closed" && (
            <button
              disabled={busy}
              onClick={() => void change("close")}
              className="rounded-lg border border-gray-700 px-3 py-2 text-xs"
            >
              Encerrar expediente
            </button>
          )}
          {day?.status === "closed" && (
            <button
              disabled={busy}
              onClick={() => void change("resume")}
              className="rounded-lg border border-gray-700 px-3 py-2 text-xs"
            >
              Retomar expediente
            </button>
          )}
        </div>
      </div>
      {error && (
        <p role="alert" className="mt-2 text-xs text-amber-300">
          {error}
        </p>
      )}
    </section>
  );
}
