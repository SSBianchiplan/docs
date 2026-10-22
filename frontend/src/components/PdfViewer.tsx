import { useEffect, useRef, useState } from "react";
import * as pdfjs from "pdfjs-dist";
import workerUrl from "pdfjs-dist/build/pdf.worker.min.mjs?url";
import { ChevronLeft, ChevronRight, Maximize2, MousePointerSquareDashed, ZoomIn, ZoomOut } from "lucide-react";
import type { Comment } from "@/lib/types";
import { Skeleton } from "./ui";

pdfjs.GlobalWorkerOptions.workerSrc = workerUrl;

export interface Rect { x: number; y: number; w: number; h: number }

const CAT_COLOR: Record<Comment["category"], string> = {
  OBRIGATORIO: "var(--delta)", TECNICO: "var(--warn)", EDITORIAL: "var(--info)", GERAL: "var(--accent)",
};

/** Visualizador PDF com camada de marcações (retângulos normalizados 0..1 por página). */
export function PdfViewer({ url, comments = [], onDraw, activeId, onSelect }: {
  url: string; comments?: Comment[]; onDraw?: (page: number, r: Rect) => void;
  activeId?: string | null; onSelect?: (id: string) => void;
}) {
  const [doc, setDoc] = useState<pdfjs.PDFDocumentProxy | null>(null);
  const [page, setPage] = useState(1);
  const [zoom, setZoom] = useState<number | "fit">("fit");
  const [err, setErr] = useState<string | null>(null);
  const [drawing, setDrawing] = useState(false);
  const [drag, setDrag] = useState<{ x0: number; y0: number; x1: number; y1: number } | null>(null);
  const canvas = useRef<HTMLCanvasElement>(null);
  const box = useRef<HTMLDivElement>(null);
  const [size, setSize] = useState({ w: 0, h: 0 });

  useEffect(() => {
    let dead = false;
    setDoc(null); setErr(null); setPage(1);
    const task = pdfjs.getDocument({ url, isEvalSupported: false });
    task.promise.then((d) => !dead && setDoc(d)).catch((e: Error) => !dead && setErr(e.message));
    return () => { dead = true; void task.destroy(); };
  }, [url]);

  useEffect(() => {
    if (!doc || !canvas.current || !box.current) return;
    let cancelled = false;
    let renderTask: pdfjs.RenderTask | null = null;
    void doc.getPage(page).then((p) => {
      if (cancelled || !canvas.current || !box.current) return;
      const base = p.getViewport({ scale: 1 });
      const scale = zoom === "fit" ? (box.current.clientWidth - 2) / base.width : zoom;
      const vp = p.getViewport({ scale });
      const dpr = Math.min(window.devicePixelRatio || 1, 2);
      const c = canvas.current;
      c.width = Math.floor(vp.width * dpr); c.height = Math.floor(vp.height * dpr);
      c.style.width = `${vp.width}px`; c.style.height = `${vp.height}px`;
      setSize({ w: vp.width, h: vp.height });
      const ctx = c.getContext("2d");
      if (!ctx) return;
      renderTask = p.render({ canvasContext: ctx, viewport: vp, transform: dpr !== 1 ? [dpr, 0, 0, dpr, 0, 0] : undefined });
      renderTask.promise.catch(() => undefined);
    });
    return () => { cancelled = true; renderTask?.cancel(); };
  }, [doc, page, zoom]);

  const rel = (e: React.PointerEvent) => {
    const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
    return { x: Math.min(1, Math.max(0, (e.clientX - r.left) / r.width)), y: Math.min(1, Math.max(0, (e.clientY - r.top) / r.height)) };
  };
  const pageComments = comments.filter((c) => c.page === page && c.x !== null);
  const n = doc?.numPages ?? 0;
  const cur = typeof zoom === "number" ? zoom : null;

  return (
    <div className="flex flex-col h-full min-h-[420px]">
      <div className="flex flex-wrap items-center gap-1.5 px-2 py-1.5 border-b border-line bg-surface-2/60">
        <button className="btn btn-ghost btn-sm" disabled={page <= 1} onClick={() => setPage((p) => p - 1)} aria-label="Página anterior"><ChevronLeft size={16} /></button>
        <span className="text-sm tnum px-1">{n ? `${page} / ${n}` : "—"}</span>
        <button className="btn btn-ghost btn-sm" disabled={page >= n} onClick={() => setPage((p) => p + 1)} aria-label="Próxima página"><ChevronRight size={16} /></button>
        <span className="w-px h-5 bg-line mx-1" />
        <button className="btn btn-ghost btn-sm" onClick={() => setZoom(Math.max(0.25, (cur ?? 1) - 0.25))} aria-label="Reduzir"><ZoomOut size={16} /></button>
        <span className="text-sm tnum w-12 text-center">{cur ? `${Math.round(cur * 100)}%` : "Ajuste"}</span>
        <button className="btn btn-ghost btn-sm" onClick={() => setZoom(Math.min(6, (cur ?? 1) + 0.25))} aria-label="Ampliar"><ZoomIn size={16} /></button>
        <button className="btn btn-ghost btn-sm" onClick={() => setZoom("fit")} aria-label="Ajustar à largura"><Maximize2 size={15} /></button>
        {onDraw && (
          <button className={`btn btn-sm ml-auto ${drawing ? "btn-primary" : ""}`} onClick={() => setDrawing((d) => !d)} aria-pressed={drawing}>
            <MousePointerSquareDashed size={15} /> {drawing ? "Marque a área na folha" : "Comentar área"}
          </button>
        )}
      </div>
      <div ref={box} className="flex-1 overflow-auto bg-[color-mix(in_oklab,var(--surface-2)_70%,var(--bg))] p-0">
        {err && <p className="p-6 text-sm text-bad">Não foi possível abrir o PDF: {err}</p>}
        {!doc && !err && <Skeleton className="m-4 h-[70vh]" />}
        <div className="relative mx-auto" style={{ width: size.w || undefined }}>
          <canvas ref={canvas} className="block bg-white shadow-sm" />
          {doc && (
            <div
              className={`absolute inset-0 ${drawing ? "cursor-crosshair" : ""}`}
              onPointerDown={(e) => { if (!drawing) return; const p = rel(e); (e.target as HTMLElement).setPointerCapture(e.pointerId); setDrag({ x0: p.x, y0: p.y, x1: p.x, y1: p.y }); }}
              onPointerMove={(e) => { if (drag) { const p = rel(e); setDrag({ ...drag, x1: p.x, y1: p.y }); } }}
              onPointerUp={() => {
                if (drag && onDraw) {
                  const r = { x: Math.min(drag.x0, drag.x1), y: Math.min(drag.y0, drag.y1), w: Math.abs(drag.x1 - drag.x0), h: Math.abs(drag.y1 - drag.y0) };
                  if (r.w > 0.01 && r.h > 0.008) { onDraw(page, r); setDrawing(false); }
                }
                setDrag(null);
              }}
            >
              {pageComments.map((c, i) => (
                <button key={c.id} onClick={() => onSelect?.(c.id)} title={c.body}
                  className="absolute rounded-sm transition-shadow"
                  style={{
                    left: `${c.x! * 100}%`, top: `${c.y! * 100}%`, width: `${c.w! * 100}%`, height: `${c.h! * 100}%`,
                    border: `2px ${c.status === "ABERTO" ? "solid" : "dashed"} ${CAT_COLOR[c.category]}`,
                    background: activeId === c.id ? "color-mix(in oklab, var(--warn) 18%, transparent)" : "transparent",
                    boxShadow: activeId === c.id ? "0 0 0 3px color-mix(in oklab, var(--warn) 35%, transparent)" : undefined,
                  }}>
                  <span className="absolute -top-2.5 -left-2.5 w-5 h-5 rounded-full text-[11px] font-semibold text-white flex items-center justify-center" style={{ background: CAT_COLOR[c.category] }}>{i + 1}</span>
                </button>
              ))}
              {drag && (
                <div className="absolute border-2 border-dashed border-delta bg-delta/10"
                  style={{ left: `${Math.min(drag.x0, drag.x1) * 100}%`, top: `${Math.min(drag.y0, drag.y1) * 100}%`, width: `${Math.abs(drag.x1 - drag.x0) * 100}%`, height: `${Math.abs(drag.y1 - drag.y0) * 100}%` }} />
              )}
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
