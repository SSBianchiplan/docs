import { useEffect, useRef, type ReactNode } from "react";
import { create } from "zustand";
import { AlertTriangle, Inbox, X } from "lucide-react";
import { STATUS, TONE_CLASS } from "@/lib/format";
import type { RevisionStatus } from "@/lib/types";

export function Badge({ tone = "neutral", children, title }: { tone?: keyof typeof TONE_CLASS; children: ReactNode; title?: string }) {
  return (
    <span title={title} className={`inline-flex items-center gap-1 h-6 px-2 rounded-full border text-[12px] font-medium whitespace-nowrap ${TONE_CLASS[tone]}`}>
      {children}
    </span>
  );
}

export function StatusBadge({ status }: { status: RevisionStatus | null }) {
  if (!status) return <Badge>Sem revisão</Badge>;
  const s = STATUS[status];
  return <Badge tone={s.tone}>{s.label}</Badge>;
}

/** Delta de revisão — o triângulo que os desenhos técnicos usam para marcar revisão. */
export function RevDelta({ label, size = "md", muted = false }: { label: string | null; size?: "sm" | "md" | "lg"; muted?: boolean }) {
  if (!label) return <span className="text-muted">—</span>;
  const dim = { sm: 22, md: 28, lg: 44 }[size];
  const fs = { sm: 10, md: 12, lg: 17 }[size];
  return (
    <span className="relative inline-flex items-end justify-center shrink-0" style={{ width: dim, height: dim * 0.9 }} aria-label={`Revisão ${label}`}>
      <svg viewBox="0 0 24 21" className="absolute inset-0 w-full h-full" aria-hidden>
        <path d="M12 1.5 22.5 19.5h-21z" fill="none" stroke={muted ? "var(--line-strong)" : "var(--delta)"} strokeWidth="1.8" strokeLinejoin="round" />
      </svg>
      <span className="relative code font-semibold leading-none" style={{ fontSize: fs, paddingBottom: dim * 0.1, color: muted ? "var(--muted)" : "var(--ink)" }}>{label}</span>
    </span>
  );
}

export function Skeleton({ className = "" }: { className?: string }) {
  return <div className={`animate-pulse rounded bg-surface-2 ${className}`} />;
}

export function Empty({ title, children, icon }: { title: string; children?: ReactNode; icon?: ReactNode }) {
  return (
    <div className="flex flex-col items-center justify-center text-center py-14 px-6 gap-2">
      <div className="text-muted">{icon ?? <Inbox size={28} />}</div>
      <p className="font-medium">{title}</p>
      {children && <div className="text-sm text-muted max-w-md">{children}</div>}
    </div>
  );
}

export function ErrorBox({ error }: { error: unknown }) {
  const msg = error instanceof Error ? error.message : String(error);
  return (
    <div role="alert" className="flex items-start gap-2 rounded-md border border-bad/30 bg-bad-soft text-bad px-3 py-2 text-sm">
      <AlertTriangle size={16} className="mt-0.5 shrink-0" /> <span>{msg}</span>
    </div>
  );
}

export function PageHeader({ title, sub, actions }: { title: ReactNode; sub?: ReactNode; actions?: ReactNode }) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3 mb-5">
      <div className="min-w-0">
        <h1 className="text-[22px] font-semibold leading-tight tracking-tight">{title}</h1>
        {sub && <p className="text-sm text-muted mt-0.5">{sub}</p>}
      </div>
      {actions && <div className="flex flex-wrap gap-2">{actions}</div>}
    </div>
  );
}

/** Painel lateral para formulários longos (nunca modal — ver skill de frontend). */
export function Drawer({ open, onClose, title, children, footer, wide }: {
  open: boolean; onClose: () => void; title: string; children: ReactNode; footer?: ReactNode; wide?: boolean;
}) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onKey = (e: KeyboardEvent) => e.key === "Escape" && onClose();
    window.addEventListener("keydown", onKey);
    ref.current?.querySelector<HTMLElement>("input,select,textarea,button")?.focus();
    return () => window.removeEventListener("keydown", onKey);
  }, [open, onClose]);
  if (!open) return null;
  return (
    <div className="fixed inset-0 z-50 flex justify-end">
      <div className="absolute inset-0 bg-black/40" onClick={onClose} />
      <div ref={ref} role="dialog" aria-modal="true" aria-label={title}
        className={`relative h-full w-full ${wide ? "sm:max-w-2xl" : "sm:max-w-md"} bg-surface border-l border-line flex flex-col shadow-2xl`}>
        <div className="flex items-center justify-between px-5 h-14 border-b border-line shrink-0">
          <h2 className="font-semibold">{title}</h2>
          <button className="btn btn-ghost btn-sm" onClick={onClose} aria-label="Fechar"><X size={18} /></button>
        </div>
        <div className="flex-1 overflow-y-auto px-5 py-4">{children}</div>
        {footer && <div className="px-5 py-3 border-t border-line flex justify-end gap-2 pb-safe">{footer}</div>}
      </div>
    </div>
  );
}

export function Field({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <label className="block mb-3.5">
      <span className="label">{label}</span>
      {children}
      {hint && <span className="block text-[12px] text-muted mt-1">{hint}</span>}
    </label>
  );
}

// ---- toasts
interface ToastItem { id: number; msg: string; tone: "ok" | "bad" }
const useToasts = create<{ items: ToastItem[]; push: (m: string, t?: "ok" | "bad") => void; drop: (id: number) => void }>((set) => ({
  items: [],
  push: (msg, tone = "ok") => {
    const id = Date.now() + Math.random();
    set((s) => ({ items: [...s.items, { id, msg, tone }] }));
    setTimeout(() => set((s) => ({ items: s.items.filter((i) => i.id !== id) })), tone === "bad" ? 7000 : 3500);
  },
  drop: (id) => set((s) => ({ items: s.items.filter((i) => i.id !== id) })),
}));
export const toast = {
  ok: (m: string) => useToasts.getState().push(m, "ok"),
  err: (e: unknown) => useToasts.getState().push(e instanceof Error ? e.message : String(e), "bad"),
};
export function Toasts() {
  const { items, drop } = useToasts();
  return (
    <div className="fixed z-[60] bottom-20 lg:bottom-5 right-4 left-4 sm:left-auto flex flex-col gap-2 sm:w-96" aria-live="polite">
      {items.map((t) => (
        <div key={t.id} className={`panel shadow-lg px-4 py-3 text-sm flex gap-3 items-start border-l-4 ${t.tone === "ok" ? "border-l-ok" : "border-l-bad"}`}>
          <span className="flex-1">{t.msg}</span>
          <button onClick={() => drop(t.id)} aria-label="Dispensar" className="text-muted hover:text-ink"><X size={16} /></button>
        </div>
      ))}
    </div>
  );
}
