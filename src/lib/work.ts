export type WorkKind =
  | "product"
  | "category"
  | "promotion"
  | "settings"
  | "order"
  | "document";
export const WORK_KINDS: WorkKind[] = [
  "product",
  "category",
  "promotion",
  "settings",
  "order",
  "document",
];
export const DOCUMENT_RETENTION_DAYS = 7;
export interface TimeSpan {
  start: string;
  end: string | null;
}
export interface Workday {
  name?: string;
  role?: string;
  uid: string;
  day: string;
  startedAt: string;
  endedAt: string | null;
  status: "working" | "break" | "closed";
  sessions: TimeSpan[];
  breaks: TimeSpan[];
}
export function workDay(now = Date.now()) {
  return new Intl.DateTimeFormat("en-CA", {
    timeZone: "America/Sao_Paulo",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(now);
}
export function overlapMs(spans: TimeSpan[], start: number, end: number) {
  return spans.reduce(
    (sum, span) =>
      sum +
      Math.max(
        0,
        Math.min(end, span.end ? Date.parse(span.end) : end) -
          Math.max(start, Date.parse(span.start)),
      ),
    0,
  );
}
export function workdayMilliseconds(
  day: Workday,
  now = Date.now(),
): number | null {
  if (day.status !== "closed" && day.day !== workDay(now)) return null;
  const start = Date.parse(day.startedAt),
    end = day.endedAt ? Date.parse(day.endedAt) : now;
  return Math.max(
    0,
    overlapMs(day.sessions, start, end) - overlapMs(day.breaks, start, end),
  );
}
export function taskMilliseconds(start: string, end: string, day?: Workday) {
  const from = Date.parse(start),
    to = Date.parse(end);
  if (
    !Number.isFinite(from) ||
    !Number.isFinite(to) ||
    to < from ||
    to - from > 86400000 ||
    workDay(from) !== workDay(to)
  )
    return null;
  return Math.max(
    0,
    day
      ? overlapMs(day.sessions, from, to) - overlapMs(day.breaks, from, to)
      : to - from,
  );
}
export function changeWorkday(
  previous: Workday | undefined,
  uid: string,
  action: "open" | "resume" | "break" | "return" | "close",
  now = Date.now(),
): Workday {
  const at = new Date(now).toISOString(),
    date = workDay(now);
  if (!previous) {
    if (action !== "open" && action !== "resume")
      throw new Error("Inicie o expediente antes de continuar.");
    return {
      uid,
      day: date,
      startedAt: at,
      endedAt: null,
      status: "working",
      sessions: [{ start: at, end: null }],
      breaks: [],
    };
  }
  const value = structuredClone(previous);
  if (value.uid !== uid || value.day !== date)
    throw new Error("Expediente inválido.");
  if (action === "open") return value;
  if (action === "resume") {
    if (value.status !== "closed") return value;
    if (value.sessions.length >= 20)
      throw new Error("Limite diário de reaberturas atingido.");
    value.sessions.push({ start: at, end: null });
    value.endedAt = null;
    value.status = "working";
    return value;
  }
  if (action === "break") {
    if (value.status === "break") return value;
    if (value.status === "closed")
      throw new Error("O expediente foi encerrado.");
    if (value.breaks.length >= 40)
      throw new Error("Limite de intervalos atingido.");
    value.breaks.push({ start: at, end: null });
    value.status = "break";
    return value;
  }
  if (action === "return") {
    if (value.status === "working") return value;
    if (value.status !== "break")
      throw new Error("Não existe intervalo aberto.");
    value.breaks[value.breaks.length - 1].end = at;
    value.status = "working";
    return value;
  }
  if (value.status === "closed") return value;
  if (value.status === "break") value.breaks[value.breaks.length - 1].end = at;
  value.sessions[value.sessions.length - 1].end = at;
  value.status = "closed";
  value.endedAt = at;
  return value;
}
export function reportingRange(period: string, now = Date.now()) {
  const end = workDay(now),
    days =
      period === "day"
        ? 0
        : period === "week"
          ? 6
          : period === "month"
            ? 29
            : -1;
  if (days < 0) throw new Error("Período inválido.");
  return {
    start: new Date(Date.parse(end) - days * 86400000)
      .toISOString()
      .slice(0, 10),
    end,
  };
}
