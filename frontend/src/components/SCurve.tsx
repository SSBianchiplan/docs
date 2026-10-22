import { useEffect, useMemo, useRef, useState } from "react";
import { Table2, TrendingUp } from "lucide-react";
import type { Progress } from "@/lib/types";

const fmtWeek = (s: string) => { const [y, m, d] = s.split("-"); return `${d}/${m}/${y!.slice(2)}`; };
const fmtMonth = new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit" });

/** Curva S do avanço da documentação: % acumulado do peso planejado × emitido, por semana. */
export function SCurve({ data }: { data: Progress["curve"] }) {
  const wrap = useRef<HTMLDivElement>(null);
  const [w, setW] = useState(640);
  const [hover, setHover] = useState<number | null>(null);
  const [table, setTable] = useState(false);
  useEffect(() => {
    const el = wrap.current;
    if (!el) return;
    const ro = new ResizeObserver(([e]) => setW(Math.max(280, e!.contentRect.width)));
    ro.observe(el);
    return () => ro.disconnect();
  }, []);

  const H = 240, padL = 38, padR = 76, padT = 12, padB = 26;
  const n = data.length;
  const x = (i: number) => padL + (n <= 1 ? 0 : (i / (n - 1)) * (w - padL - padR));
  const y = (v: number) => padT + (1 - v / 100) * (H - padT - padB);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const todayIdx = useMemo(() => {
    let k = -1;
    data.forEach((d, i) => { if (new Date(d.week + "T00:00:00") <= today) k = i; });
    return k;
  }, [data]); // eslint-disable-line react-hooks/exhaustive-deps

  const path = (vals: (number | null)[]) => vals.reduce<string>((acc, v, i) => v === null ? acc : `${acc}${acc ? "L" : "M"}${x(i).toFixed(1)},${y(v).toFixed(1)}`, "");
  const planned = path(data.map((d) => d.planned));
  const actual = path(data.map((d) => d.actual));
  const lastActual = [...data].reverse().find((d) => d.actual !== null);
  const lastActualIdx = lastActual ? data.lastIndexOf(lastActual) : -1;
  const last = data[n - 1];

  // marcas do eixo x: ~1 por mês, sem sobrepor
  const ticks = useMemo(() => {
    const out: number[] = [];
    let prevMonth = "";
    const minGap = 56;
    data.forEach((d, i) => {
      const m = d.week.slice(0, 7);
      if (m !== prevMonth && (out.length === 0 || x(i) - x(out[out.length - 1]!) >= minGap)) out.push(i);
      prevMonth = m;
    });
    return out;
  }, [data, w]); // eslint-disable-line react-hooks/exhaustive-deps

  function onMove(e: React.PointerEvent<SVGRectElement>) {
    const r = e.currentTarget.getBoundingClientRect();
    const px = e.clientX - r.left + padL;
    const i = Math.round(((px - padL) / (w - padL - padR)) * (n - 1));
    setHover(Math.max(0, Math.min(n - 1, i)));
  }
  const hv = hover !== null ? data[hover] : null;

  return (
    <div>
      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 mb-2 text-[12.5px] text-ink-2">
        <span className="inline-flex items-center gap-1.5"><svg width="22" height="8" aria-hidden><path d="M1 4h20" stroke="var(--series-1)" strokeWidth="2" strokeDasharray="5 3" /></svg>Planejado</span>
        <span className="inline-flex items-center gap-1.5"><svg width="22" height="8" aria-hidden><path d="M1 4h20" stroke="var(--series-2)" strokeWidth="2" /></svg>Realizado (1ª emissão)</span>
        <button className="btn btn-ghost btn-sm ml-auto" onClick={() => setTable(!table)} aria-pressed={table}>
          {table ? <><TrendingUp size={14} /> Gráfico</> : <><Table2 size={14} /> Tabela</>}
        </button>
      </div>
      <div ref={wrap} className="relative">
        {table ? (
          <div className="max-h-64 overflow-y-auto border border-line rounded-md">
            <table className="w-full text-sm">
              <thead className="sticky top-0 bg-surface-2"><tr><th className="th">Semana</th><th className="th text-right">Planejado</th><th className="th text-right">Realizado</th></tr></thead>
              <tbody className="divide-y divide-line tnum">
                {data.map((d) => <tr key={d.week}><td className="td">{fmtWeek(d.week)}</td><td className="td text-right">{d.planned.toFixed(1)}%</td><td className="td text-right">{d.actual === null ? "—" : `${d.actual.toFixed(1)}%`}</td></tr>)}
              </tbody>
            </table>
          </div>
        ) : (
          <svg width={w} height={H} role="img" aria-label={`Curva S: planejado ${last?.planned ?? 0}% até o fim, realizado ${lastActual?.actual ?? 0}% até hoje`} className="block overflow-visible">
            {[0, 25, 50, 75, 100].map((v) => (
              <g key={v}>
                <line x1={padL} x2={w - padR} y1={y(v)} y2={y(v)} stroke="var(--line)" strokeWidth={v === 0 ? 1 : 0.6} />
                <text x={padL - 6} y={y(v) + 4} textAnchor="end" fontSize="11" fill="var(--muted)" className="tnum">{v}%</text>
              </g>
            ))}
            {ticks.map((i) => (
              <text key={i} x={x(i)} y={H - 6} textAnchor="middle" fontSize="11" fill="var(--muted)">{fmtMonth.format(new Date(data[i]!.week + "T00:00:00")).replace(".", "")}</text>
            ))}
            {todayIdx >= 0 && todayIdx < n - 1 && (
              <g>
                <line x1={x(todayIdx)} x2={x(todayIdx)} y1={padT} y2={H - padB} stroke="var(--line-strong)" strokeDasharray="2 3" />
                <text x={x(todayIdx) + 4} y={padT + 10} fontSize="10.5" fill="var(--muted)">hoje</text>
              </g>
            )}
            <path d={planned} fill="none" stroke="var(--series-1)" strokeWidth="2" strokeDasharray="6 4" strokeLinejoin="round" />
            <path d={actual} fill="none" stroke="var(--series-2)" strokeWidth="2" strokeLinejoin="round" />
            {/* rótulos diretos no fim de cada linha */}
            {last && <text x={x(n - 1) + 6} y={y(last.planned) + 4} fontSize="11.5" fill="var(--ink-2)" className="tnum">{last.planned.toFixed(0)}% plan.</text>}
            {lastActual && lastActual.actual !== null && (
              <>
                <circle cx={x(lastActualIdx)} cy={y(lastActual.actual)} r="4" fill="var(--series-2)" stroke="var(--surface)" strokeWidth="2" />
                <text x={x(lastActualIdx) + 7} y={y(lastActual.actual) + (Math.abs(lastActual.actual - (data[lastActualIdx]?.planned ?? 0)) < 8 ? 14 : 4)} fontSize="11.5" fill="var(--ink)" fontWeight="600" className="tnum">{lastActual.actual.toFixed(1)}% real</text>
              </>
            )}
            {hv && hover !== null && (
              <g pointerEvents="none">
                <line x1={x(hover)} x2={x(hover)} y1={padT} y2={H - padB} stroke="var(--ink-2)" strokeWidth="1" opacity=".5" />
                <circle cx={x(hover)} cy={y(hv.planned)} r="4" fill="var(--series-1)" stroke="var(--surface)" strokeWidth="2" />
                {hv.actual !== null && <circle cx={x(hover)} cy={y(hv.actual)} r="4" fill="var(--series-2)" stroke="var(--surface)" strokeWidth="2" />}
              </g>
            )}
            <rect x={padL} y={padT} width={Math.max(1, w - padL - padR)} height={H - padT - padB} fill="transparent"
              onPointerMove={onMove} onPointerDown={onMove} onPointerLeave={() => setHover(null)} style={{ touchAction: "pan-y" }} />
          </svg>
        )}
        {!table && hv && hover !== null && (
          <div className="absolute pointer-events-none panel shadow-lg px-3 py-2 text-[12.5px] tnum z-10"
            style={{ left: Math.min(Math.max(0, x(hover) - 70), w - 160), top: 0, width: 150 }}>
            <div className="font-medium mb-1">Semana de {fmtWeek(hv.week)}</div>
            <div className="flex justify-between gap-2"><span className="text-ink-2">Planejado</span><span>{hv.planned.toFixed(1)}%</span></div>
            <div className="flex justify-between gap-2"><span className="text-ink-2">Realizado</span><span>{hv.actual === null ? "—" : `${hv.actual.toFixed(1)}%`}</span></div>
          </div>
        )}
      </div>
    </div>
  );
}
