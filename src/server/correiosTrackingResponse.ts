import { validTrackingCode } from '../lib/tracking.js';
import { isRecord } from '../lib/shipping.js';
import { CorreiosError } from './correiosError.js';
export interface CorreiosTrackingEvent { code: string; type: string; at: string; description: string; delivered: boolean; }
export function parseCorreiosTracking(value: unknown, code: string, now = Date.now()): CorreiosTrackingEvent {
  if (!validTrackingCode(code) || !isRecord(value) || !Array.isArray(value.objetos) || value.objetos.length !== 1) throw invalid();
  const object = value.objetos[0];
  if (!isRecord(object) || object.codObjeto !== code || object.mensagem || !Array.isArray(object.eventos) || !object.eventos.length || object.eventos.length > 500) throw invalid();
  const events = object.eventos.map(raw => {
    if (!isRecord(raw) || typeof raw.codigo !== 'string' || !/^[A-Z]{2,5}$/.test(raw.codigo) || typeof raw.tipo !== 'string' || !/^\d{2}$/.test(raw.tipo) ||
      typeof raw.dtHrCriado !== 'string' || !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?(?:Z|[+-]\d{2}:\d{2})?$/.test(raw.dtHrCriado) || typeof raw.descricao !== 'string' || raw.descricao.length > 500) throw invalid();
    const parts = raw.dtHrCriado.slice(0, 19).match(/^(\d{4})-(\d{2})-(\d{2})T(\d{2}):(\d{2}):(\d{2})$/)!.slice(1).map(Number);
    const calendar = new Date(Date.UTC(parts[0], parts[1] - 1, parts[2], parts[3], parts[4], parts[5]));
    if (calendar.toISOString().slice(0, 19) !== raw.dtHrCriado.slice(0, 19)) throw invalid();
    const timestamp = raw.dtHrCriado + (/(Z|[+-]\d{2}:\d{2})$/.test(raw.dtHrCriado) ? '' : '-03:00');
    const at = Date.parse(timestamp);
    if (!Number.isFinite(at) || at > now + 10 * 60_000 || at < Date.UTC(2000, 0, 1)) throw invalid();
    return { code: raw.codigo, type: raw.tipo, at: new Date(at).toISOString(), description: raw.descricao.trim(), delivered: raw.codigo === 'BDE' && raw.tipo === '01' };
  }).sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
  // Ambiguous simultaneous events cannot confirm delivery.
  if (events.some(event => event.at === events[0].at && !event.delivered)) events[0].delivered = false;
  return events[0];
}
function invalid() { return new CorreiosError(502, 'CORREIOS_TRACKING_INVALID', 'Os Correios ainda não retornaram um rastreio válido para este código.'); }
