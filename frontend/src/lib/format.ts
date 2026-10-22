import type { Purpose, RevisionStatus } from "./types";

const dtf = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "numeric" });
const dtt = new Intl.DateTimeFormat("pt-BR", { day: "2-digit", month: "2-digit", year: "2-digit", hour: "2-digit", minute: "2-digit" });
// "YYYY-MM-DD" (data sem hora) é lida no fuso local; senão new Date() a trata como UTC e mostra o dia anterior
const toDate = (s: string) => (/^\d{4}-\d{2}-\d{2}$/.test(s) ? new Date(`${s}T00:00:00`) : new Date(s));
export const fmtDate = (s: string | null | undefined) => (s ? dtf.format(toDate(s)) : "—");
export const fmtDateTime = (s: string | null | undefined) => (s ? dtt.format(new Date(s)) : "—");
export function fmtBytes(n: number): string {
  if (n < 1024) return `${n} B`;
  if (n < 1024 ** 2) return `${(n / 1024).toFixed(0)} KB`;
  if (n < 1024 ** 3) return `${(n / 1024 ** 2).toFixed(1)} MB`;
  return `${(n / 1024 ** 3).toFixed(2)} GB`;
}
export function relTime(s: string): string {
  const d = (new Date(s).getTime() - Date.now()) / 1000;
  const rtf = new Intl.RelativeTimeFormat("pt-BR", { numeric: "auto" });
  const a = Math.abs(d);
  if (a < 3600) return rtf.format(Math.round(d / 60), "minute");
  if (a < 86400) return rtf.format(Math.round(d / 3600), "hour");
  return rtf.format(Math.round(d / 86400), "day");
}

type Tone = "neutral" | "info" | "warn" | "ok" | "bad" | "accent";
export const STATUS: Record<RevisionStatus, { label: string; tone: Tone }> = {
  EM_ELABORACAO: { label: "Em elaboração", tone: "neutral" },
  EM_VERIFICACAO: { label: "Em verificação", tone: "warn" },
  APROVADA_INTERNA: { label: "Aprovada interna", tone: "info" },
  EMITIDA: { label: "Emitida", tone: "accent" },
  APROVADA: { label: "Aprovada (A)", tone: "ok" },
  APROVADA_COM_COMENTARIOS: { label: "Aprov. c/ coment. (B)", tone: "warn" },
  REPROVADA: { label: "Reprovada (C)", tone: "bad" },
  SUPERADA: { label: "Superada", tone: "neutral" },
  CANCELADA: { label: "Cancelada", tone: "neutral" },
};
export const PURPOSE: Record<Purpose, string> = {
  PI: "Para informação", PA: "Para aprovação", PC: "Para construção", CE: "Conforme construído", CA: "Cancelamento",
};
export const TONE_CLASS: Record<Tone, string> = {
  neutral: "bg-surface-2 text-ink-2 border-line",
  info: "bg-info-soft text-info border-transparent",
  warn: "bg-warn-soft text-warn border-transparent",
  ok: "bg-ok-soft text-ok border-transparent",
  bad: "bg-bad-soft text-bad border-transparent",
  accent: "bg-accent-soft text-accent border-transparent",
};
export const ROLE_LABEL: Record<string, string> = {
  ADMIN: "Administrador", CONTROLADOR: "Controle de documentos", AUTOR: "Autor", REVISOR: "Revisor",
  LEITOR: "Leitor", EXTERNO: "Externo",
};
