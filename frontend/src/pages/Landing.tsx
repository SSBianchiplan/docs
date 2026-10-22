import { useEffect, useState, type ReactNode } from "react";
import { Link, useLocation } from "react-router-dom";
import {
  ArrowRight, Bot, CheckCircle2, ClipboardCheck, Download, FileLock2, FileSearch, FileStack, GitBranch, Lock,
  MessageSquareText, Search, Send, ShieldCheck, Smartphone, WifiOff,
} from "lucide-react";
import { api } from "@/lib/api";
import { useInstall } from "@/lib/install";
import { ErrorBox } from "@/components/ui";

/* Paleta fixa da "prancha" (hero e faixa final) — igual à tela de login, independente do tema. */
const INK = "#14202B";
const GRID = (
  <svg className="absolute inset-0 w-full h-full opacity-[0.07] pointer-events-none" aria-hidden>
    <defs>
      <pattern id="g8" width="16" height="16" patternUnits="userSpaceOnUse"><path d="M16 0H0V16" fill="none" stroke="#fff" strokeWidth=".4" /></pattern>
      <pattern id="g32" width="80" height="80" patternUnits="userSpaceOnUse"><rect width="80" height="80" fill="url(#g8)" /><path d="M80 0H0V80" fill="none" stroke="#fff" strokeWidth="1" /></pattern>
    </defs>
    <rect width="100%" height="100%" fill="url(#g32)" />
  </svg>
);

function Delta({ label, color = "#F0654F", size = 26, text = "#E2E8ED" }: { label: string; color?: string; size?: number; text?: string }) {
  return (
    <svg width={size} height={size * 0.88} viewBox="0 0 24 21" aria-label={`Revisão ${label}`} className="shrink-0">
      <path d="M12 1.5 22.5 19.5h-21z" fill="none" stroke={color} strokeWidth="1.8" strokeLinejoin="round" />
      <text x="12" y="17" textAnchor="middle" fontSize="8" fontWeight="600" fill={text} fontFamily="IBM Plex Mono, monospace">{label}</text>
    </svg>
  );
}

/** Janela de produto desenhada em HTML (nada de imagem): lista mestra com revisões e situações reais do sistema. */
function ProductMock() {
  const rows: [string, string, string, string, string][] = [
    ["UHE01-CIV-DE-0012", "Planta de fôrmas — bloco B", "2", "Aprovada (A)", "#5cc486"],
    ["UHE01-MEC-FD-0003", "Folha de dados — bomba P-101", "B", "Em verificação", "#f0b04a"],
    ["UHE01-ELE-DF-0007", "Diagrama unifilar — SE 13,8 kV", "1", "Emitida", "#40b4ba"],
    ["UHE01-TUB-LM-0021", "Lista de materiais — linha 6\"", "C", "Aprov. c/ coment. (B)", "#f0b04a"],
    ["UHE01-INS-LI-0004", "Lista de instrumentos — área 200", "A", "Em elaboração", "#8593a0"],
  ];
  return (
    <div className="relative rounded-xl border border-[#2b3947] bg-[#0f1820]/90 shadow-[0_30px_80px_-20px_rgba(0,0,0,.6)] overflow-hidden backdrop-blur">
      <div className="flex items-center gap-2 px-4 h-10 border-b border-[#26323d] bg-[#151d25]">
        <span className="w-2.5 h-2.5 rounded-full bg-[#f0654f]" /><span className="w-2.5 h-2.5 rounded-full bg-[#f0b04a]" /><span className="w-2.5 h-2.5 rounded-full bg-[#5cc486]" />
        <span className="ml-3 text-[12px] text-[#8593a0] font-mono">docs.gplansis.com/documentos</span>
      </div>
      <div className="px-4 py-3 flex items-center gap-2 border-b border-[#26323d]">
        <span className="text-[14px] font-semibold text-[#e2e8ed]">Lista mestra</span>
        <span className="text-[12px] text-[#8593a0]">· 1.284 documentos</span>
        <span className="ml-auto h-7 px-2.5 rounded-md bg-[#40b4ba] text-[#06201f] text-[12px] font-semibold inline-flex items-center">+ Novo documento</span>
      </div>
      <ul className="divide-y divide-[#1f2a34]">
        {rows.map(([code, title, rev, st, c]) => (
          <li key={code} className="flex items-center gap-3 px-4 py-2.5">
            <Delta label={rev} size={24} />
            <div className="min-w-0 flex-1">
              <div className="font-mono text-[11.5px] text-[#9fb3c2] truncate">{code}</div>
              <div className="text-[13px] text-[#e2e8ed] truncate">{title}</div>
            </div>
            <span className="hidden sm:inline-flex h-6 px-2 rounded-full text-[11px] font-medium whitespace-nowrap items-center" style={{ color: c, background: `${c}1f` }}>{st}</span>
          </li>
        ))}
      </ul>
      <div className="grid grid-cols-[1fr_auto_auto] border-t border-[#26323d] text-[11px] text-[#b9c4cd]">
        <div className="px-3 py-2 border-r border-[#26323d]"><div className="text-[#6b7a87]">GRD</div><span className="font-mono">GRD-UHE01-0042</span> · emitida</div>
        <div className="px-3 py-2 border-r border-[#26323d]"><div className="text-[#6b7a87]">Manifesto</div><span className="font-mono">sha256 9f3c…a71e</span></div>
        <div className="px-3 py-2"><div className="text-[#6b7a87]">Trilha</div><span className="text-[#5cc486]">íntegra</span></div>
      </div>
    </div>
  );
}

const FEATURES: { icon: ReactNode; title: string; body: string }[] = [
  { icon: <FileStack size={20} />, title: "Lista mestra codificada", body: "Códigos gerados pela máscara do projeto ({PROJ}-{DISC}-{TIPO}-{SEQ}), sequenciais sem lacuna e validados pelo banco. Exporta para Excel em um clique." },
  { icon: <GitBranch size={20} />, title: "Revisões com máquina de estados", body: "Elaboração → verificação → aprovação interna → emitida → retorno do cliente. Transição fora da regra é recusada, e arquivos congelam ao sair da elaboração." },
  { icon: <ClipboardCheck size={20} />, title: "Workflow com SLA", body: "Verificação técnica e aprovação do controle de documentos, com prazo por etapa, pendências por pessoa e segregação: quem elabora não aprova." },
  { icon: <MessageSquareText size={20} />, title: "Comentários na folha", body: "Marque a região exata do PDF, classifique (obrigatório, técnico, editorial) e acompanhe o atendimento na revisão seguinte." },
  { icon: <Send size={20} />, title: "GRD numerada com prova", body: "Guia de remessa com numeração única por projeto e manifesto SHA-256 do que foi enviado. Protocolo de recebimento e impressão da guia." },
  { icon: <FileSearch size={20} />, title: "OCR que lê a prancha", body: "PDF escaneado vira pesquisável: correção de inclinação, pranchas A0 fatiadas, PDF/A e leitura do carimbo (código, revisão, escala, folha)." },
  { icon: <Search size={20} />, title: "Busca por conteúdo e fonética", body: "Encontre pelo texto de dentro do documento, pelo código aproximado ou pelo som da palavra. Acentos e erros de OCR não atrapalham." },
  { icon: <Bot size={20} />, title: "IA propõe, humano decide", body: "Sugestões de metadados do carimbo e de comentários atendidos ficam como proposta. Nada é aplicado sem o clique de uma pessoa." },
  { icon: <FileLock2 size={20} />, title: "Check-out e confidencialidade", body: "Bloqueio de edição por documento, níveis público/interno/confidencial/restrito e retenção que impede exclusão." },
  { icon: <ShieldCheck size={20} />, title: "Auditoria à prova de adulteração", body: "Cada alteração entra numa trilha append-only encadeada por SHA-256. Um clique verifica se alguém mexeu no histórico." },
];

const FLOW: { rev: string; title: string; who: string }[] = [
  { rev: "A", title: "Elaboração", who: "Autor anexa PDF e nativos" },
  { rev: "A", title: "Verificação", who: "Revisor comenta na folha" },
  { rev: "A", title: "Aprovação interna", who: "Controle de documentos" },
  { rev: "0", title: "GRD emitida", who: "Numerada, com manifesto" },
  { rev: "0", title: "Retorno do cliente", who: "A · B · C registrados" },
  { rev: "1", title: "Nova revisão", who: "Comentários verificados" },
];

const REFUSALS: [string, string][] = [
  ["INV-WF-003", "O autor não pode aprovar a própria revisão"],
  ["INV-REV-004", "Revisão sem PDF não pode ser emitida"],
  ["INV-REV-007", "Comentário obrigatório aberto bloqueia a aprovação"],
  ["INV-GRD-001", "Numeração de GRD única e sem lacuna"],
  ["INV-DOC-002", "Código fora da máscara do projeto é recusado"],
  ["INV-AUD-001", "Trilha de auditoria só aceita inclusão"],
];

function AccessForm() {
  const [f, setF] = useState({ name: "", email: "", company: "", message: "", website: "" });
  const [sent, setSent] = useState(false);
  const [err, setErr] = useState<unknown>(null);
  const [busy, setBusy] = useState(false);
  const valid = f.name.trim().length >= 2 && /^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(f.email);

  async function submit(e: React.FormEvent) {
    e.preventDefault();
    setBusy(true); setErr(null);
    try {
      await api.post("/access-requests", { ...f, company: f.company || null, message: f.message || null, website: f.website || null });
      setSent(true);
    } catch (e2) { setErr(e2); } finally { setBusy(false); }
  }

  if (sent) return (
    <div className="panel p-6 text-center" role="status">
      <CheckCircle2 size={36} className="mx-auto text-ok mb-3" />
      <p className="font-semibold text-lg">Solicitação recebida</p>
      <p className="text-sm text-muted mt-1 max-w-sm mx-auto">O administrador vai analisar o pedido. Aprovado, você recebe o e-mail de acesso e uma senha temporária para o primeiro login.</p>
    </div>
  );
  return (
    <form onSubmit={submit} className="panel p-5 sm:p-6">
      <div className="grid sm:grid-cols-2 gap-x-3">
        <label className="block mb-3"><span className="label">Nome</span>
          <input className="input" required autoComplete="name" value={f.name} onChange={(e) => setF({ ...f, name: e.target.value })} /></label>
        <label className="block mb-3"><span className="label">E-mail de trabalho</span>
          <input className="input" required type="email" autoComplete="email" value={f.email} onChange={(e) => setF({ ...f, email: e.target.value })} /></label>
      </div>
      <label className="block mb-3"><span className="label">Empresa</span>
        <input className="input" autoComplete="organization" value={f.company} onChange={(e) => setF({ ...f, company: e.target.value })} /></label>
      <label className="block mb-3"><span className="label">Projeto ou necessidade <span className="text-muted font-normal">(opcional)</span></span>
        <textarea className="input h-20 py-2 resize-none" maxLength={2000} value={f.message} onChange={(e) => setF({ ...f, message: e.target.value })} placeholder="Ex.: controle de documentos da UHE, cerca de 800 pranchas" /></label>
      {/* honeypot: invisível para pessoas */}
      <input tabIndex={-1} autoComplete="off" aria-hidden className="absolute -left-[9999px] w-px h-px" value={f.website} onChange={(e) => setF({ ...f, website: e.target.value })} />
      {err !== null && <div className="mb-3"><ErrorBox error={err} /></div>}
      <button className="btn btn-primary w-full h-11 text-[15px]" disabled={!valid || busy}>{busy ? "Enviando…" : <>Solicitar acesso <ArrowRight size={17} /></>}</button>
      <p className="text-[12px] text-muted mt-2.5 text-center">Contas são liberadas por um administrador. Seus dados servem só para criar o acesso.</p>
    </form>
  );
}

function InstallCard() {
  const inst = useInstall();
  const [iosOpen, setIosOpen] = useState(false);
  if (inst.installed) return <p className="inline-flex items-center gap-2 text-sm text-ok"><CheckCircle2 size={16} /> App já instalado neste aparelho</p>;
  return (
    <div className="flex flex-wrap items-center gap-3">
      {inst.canPrompt && <button className="btn btn-primary h-11 px-5" onClick={() => void inst.prompt()}><Download size={17} /> Instalar o app</button>}
      {inst.iosHint && <button className="btn h-11 px-5" onClick={() => setIosOpen(!iosOpen)}><Smartphone size={17} /> Instalar no iPhone</button>}
      {!inst.canPrompt && !inst.iosHint && <p className="text-sm text-muted">No Chrome ou Edge, use o ícone de instalar na barra de endereço. No celular, “Adicionar à tela inicial”.</p>}
      {iosOpen && <p className="basis-full text-sm text-ink-2">No Safari, toque em <b>Compartilhar</b> e depois em <b>Adicionar à Tela de Início</b>.</p>}
    </div>
  );
}

export default function Landing() {
  const loc = useLocation();
  useEffect(() => {
    if (loc.hash) document.getElementById(loc.hash.slice(1))?.scrollIntoView({ behavior: "smooth", block: "start" });
  }, [loc.hash]);

  return (
    <div className="min-h-full bg-bg">
      {/* ——— hero ——— */}
      <section className="relative overflow-hidden text-[#E2E8ED]" style={{ background: `radial-gradient(1200px 600px at 80% -10%, #1d3440 0%, ${INK} 55%)` }}>
        {GRID}
        <header className="relative max-w-7xl mx-auto px-4 sm:px-6 h-16 flex items-center gap-4">
          <Link to="/" className="flex items-center gap-2.5 shrink-0">
            <img src="/logo.svg" alt="" className="w-9 h-9" />
            <span className="text-[17px] font-semibold tracking-tight">GPlanSiS<span className="opacity-50">|</span>DOCS</span>
          </Link>
          <nav className="hidden md:flex items-center gap-6 ml-8 text-[14px] text-[#9FB3C2]" aria-label="Seções">
            <a href="#recursos" className="hover:text-white">Recursos</a>
            <a href="#fluxo" className="hover:text-white">Fluxo</a>
            <a href="#seguranca" className="hover:text-white">Segurança</a>
            <a href="#app" className="hover:text-white">App</a>
          </nav>
          <div className="ml-auto flex items-center gap-2">
            <Link to="/entrar" className="h-9 px-4 rounded-md text-[14px] font-medium inline-flex items-center hover:bg-white/10">Entrar</Link>
            <a href="#acesso" className="hidden sm:inline-flex h-9 px-4 rounded-md text-[14px] font-semibold items-center bg-[#40b4ba] text-[#06201f] hover:brightness-110">Solicitar acesso</a>
          </div>
        </header>

        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 pt-10 sm:pt-16 pb-16 sm:pb-24 grid lg:grid-cols-[1.05fr_1fr] gap-10 lg:gap-14 items-center">
          <div>
            <p className="inline-flex items-center gap-2 h-7 px-3 rounded-full border border-[#37475A] text-[12.5px] text-[#9FB3C2] mb-6">
              <span className="w-1.5 h-1.5 rounded-full bg-[#5cc486]" /> EDMS para engenharia · EPC · owner · fornecedor
            </p>
            <h1 className="text-[38px] sm:text-[54px] leading-[1.04] font-semibold tracking-[-0.02em]">
              Toda revisão rastreada.<br /><span className="text-[#40b4ba]">Toda emissão com prova.</span>
            </h1>
            <p className="mt-5 text-[17px] sm:text-[18px] text-[#B9C4CD] max-w-xl leading-relaxed">
              Lista mestra, workflow de verificação e aprovação, GRD numerada e OCR que lê até o carimbo da prancha. No navegador ou instalado no celular.
            </p>
            <div className="mt-8 flex flex-col sm:flex-row gap-3">
              <Link to="/entrar" className="h-12 px-6 rounded-lg bg-[#40b4ba] text-[#06201f] font-semibold text-[16px] inline-flex items-center justify-center gap-2 hover:brightness-110 shadow-[0_10px_30px_-10px_#40b4ba]">
                Entrar no sistema <ArrowRight size={18} />
              </Link>
              <a href="#acesso" className="h-12 px-6 rounded-lg border border-[#4a5b6c] text-[16px] font-medium inline-flex items-center justify-center gap-2 hover:bg-white/5">
                Solicitar acesso
              </a>
            </div>
            <ul className="mt-7 flex flex-wrap gap-x-5 gap-y-2 text-[13px] text-[#8593A0]">
              <li className="inline-flex items-center gap-1.5"><Smartphone size={14} /> Instala como app</li>
              <li className="inline-flex items-center gap-1.5"><WifiOff size={14} /> Consulta offline</li>
              <li className="inline-flex items-center gap-1.5"><Lock size={14} /> Acesso por perfil e projeto</li>
            </ul>
          </div>
          <div className="relative">
            <div className="absolute -inset-6 bg-[#40b4ba]/10 blur-3xl rounded-full" aria-hidden />
            <ProductMock />
          </div>
        </div>

        <div className="relative border-t border-[#26323d]">
          <dl className="max-w-7xl mx-auto px-4 sm:px-6 grid grid-cols-2 lg:grid-cols-4 divide-x divide-[#26323d] text-center lg:text-left">
            {[
              ["29", "regras de negócio garantidas pelo banco"],
              ["SHA-256", "em cada arquivo, GRD e registro de auditoria"],
              ["PT + EN", "OCR com leitura de carimbo"],
              ["6 perfis", "admin, controle, autor, revisor, leitor, externo"],
            ].map(([k, v]) => (
              <div key={k} className="px-3 sm:px-6 py-5">
                <dt className="font-mono text-[20px] sm:text-[22px] text-white">{k}</dt>
                <dd className="text-[12.5px] text-[#8593A0] mt-0.5">{v}</dd>
              </div>
            ))}
          </dl>
        </div>
      </section>

      {/* ——— recursos ——— */}
      <section id="recursos" className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24 scroll-mt-4">
        <p className="code text-accent text-[13px] mb-2">01 · RECURSOS</p>
        <h2 className="text-[30px] sm:text-[38px] font-semibold tracking-tight leading-tight max-w-3xl">Do rascunho à emissão para construção, sem planilha paralela.</h2>
        <p className="text-muted mt-3 max-w-2xl text-[16px]">Tudo o que o controle de documentos faz no dia a dia, com as regras do setor embutidas.</p>
        <div className="mt-10 grid sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5 gap-3">
          {FEATURES.map((f) => (
            <article key={f.title} className="panel p-5 hover:border-line-strong transition-colors">
              <div className="w-10 h-10 rounded-lg bg-accent-soft text-accent flex items-center justify-center mb-4">{f.icon}</div>
              <h3 className="font-semibold text-[15.5px] leading-snug">{f.title}</h3>
              <p className="text-[13.5px] text-muted mt-1.5 leading-relaxed">{f.body}</p>
            </article>
          ))}
        </div>
      </section>

      {/* ——— fluxo ——— */}
      <section id="fluxo" className="border-y border-line bg-surface scroll-mt-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24">
          <p className="code text-accent text-[13px] mb-2">02 · FLUXO</p>
          <h2 className="text-[30px] sm:text-[38px] font-semibold tracking-tight leading-tight max-w-3xl">O ciclo de vida de cada documento, em uma linha do tempo.</h2>
          <ol className="mt-12 grid grid-cols-2 md:grid-cols-3 lg:grid-cols-6 gap-y-10">
            {FLOW.map((s, i) => (
              <li key={s.title} className="relative pr-4">
                {i < FLOW.length - 1 && <span className="hidden lg:block absolute top-[14px] left-10 right-2 h-px bg-line-strong" aria-hidden />}
                <div className="relative flex items-center gap-2 mb-3">
                  <span className="bg-surface pr-2"><Delta label={s.rev} color="var(--delta)" text="var(--ink)" size={30} /></span>
                </div>
                <p className="code text-[11px] text-muted">ETAPA {i + 1}</p>
                <p className="font-semibold mt-0.5">{s.title}</p>
                <p className="text-[13px] text-muted mt-0.5">{s.who}</p>
              </li>
            ))}
          </ol>
        </div>
      </section>

      {/* ——— segurança ——— */}
      <section id="seguranca" className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24 grid lg:grid-cols-2 gap-10 items-center scroll-mt-4">
        <div>
          <p className="code text-accent text-[13px] mb-2">03 · SEGURANÇA</p>
          <h2 className="text-[30px] sm:text-[38px] font-semibold tracking-tight leading-tight">Regra que não depende de boa vontade.</h2>
          <p className="text-muted mt-3 text-[16px] leading-relaxed">As regras do controle de documentos moram no próprio banco de dados. Se alguém tentar pular uma etapa, seja pela tela, pela API ou direto no SQL, a operação é recusada com o código da regra violada.</p>
          <ul className="mt-6 space-y-2 text-[14px]">
            <li className="flex gap-2"><CheckCircle2 size={18} className="text-ok shrink-0 mt-0.5" /> Senha com hash Argon2, bloqueio após tentativas repetidas e troca obrigatória no primeiro acesso</li>
            <li className="flex gap-2"><CheckCircle2 size={18} className="text-ok shrink-0 mt-0.5" /> Perfis por projeto; conta desativada perde o acesso na hora</li>
            <li className="flex gap-2"><CheckCircle2 size={18} className="text-ok shrink-0 mt-0.5" /> Arquivos endereçados por SHA-256: o que foi emitido é o que está guardado</li>
          </ul>
        </div>
        <div className="rounded-xl border border-line bg-[#0f1820] text-[#b9c4cd] font-mono text-[12.5px] overflow-hidden shadow-xl">
          <div className="px-4 h-9 flex items-center border-b border-[#26323d] text-[#6b7a87]">postgres · recusas registradas</div>
          <ul className="p-4 space-y-2.5">
            {REFUSALS.map(([code, msg]) => (
              <li key={code} className="flex flex-col sm:flex-row sm:gap-3">
                <span className="text-[#f0654f] shrink-0">ERROR {code}</span>
                <span className="text-[#e2e8ed]">{msg}</span>
              </li>
            ))}
          </ul>
        </div>
      </section>

      {/* ——— app ——— */}
      <section id="app" className="border-y border-line bg-surface scroll-mt-4">
        <div className="max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-20 grid md:grid-cols-[1fr_auto] gap-8 items-center">
          <div>
            <p className="code text-accent text-[13px] mb-2">04 · NO CANTEIRO</p>
            <h2 className="text-[28px] sm:text-[34px] font-semibold tracking-tight leading-tight">A lista mestra no bolso, até sem sinal.</h2>
            <p className="text-muted mt-3 max-w-2xl text-[16px]">Instale como app no Android, iPhone ou computador. As consultas recentes ficam disponíveis offline e a versão nova se atualiza sozinha.</p>
            <div className="mt-6"><InstallCard /></div>
          </div>
          <div className="hidden md:flex w-44 h-80 rounded-[28px] border-[6px] border-[#26323d] bg-[#0f1820] p-3 flex-col gap-2 shadow-xl" aria-hidden>
            <div className="h-1.5 w-12 rounded-full bg-[#26323d] mx-auto mb-2" />
            {([["0012", "2"], ["0003", "B"], ["0007", "1"], ["0021", "C"], ["0004", "A"], ["0018", "0"]] as const).map(([n, rev]) => (
              <div key={n} className="flex items-center gap-2 rounded-md bg-[#151d25] px-2 py-1.5">
                <Delta label={rev} size={16} />
                <span className="font-mono text-[9px] text-[#9fb3c2]">UHE01-{n}</span>
              </div>
            ))}
          </div>
        </div>
      </section>

      {/* ——— solicitar acesso ——— */}
      <section id="acesso" className="relative overflow-hidden text-[#E2E8ED] scroll-mt-0" style={{ background: INK }}>
        {GRID}
        <div className="relative max-w-7xl mx-auto px-4 sm:px-6 py-16 sm:py-24 grid lg:grid-cols-[1fr_minmax(0,480px)] gap-10 items-center">
          <div>
            <h2 className="text-[32px] sm:text-[44px] font-semibold tracking-tight leading-[1.08]">Pare de caçar a revisão certa<br className="hidden sm:block" /> em pastas e e-mails.</h2>
            <p className="text-[#9FB3C2] mt-4 text-[17px] max-w-lg">Peça seu acesso agora. Assim que o administrador aprovar, você entra com uma senha temporária e define a sua.</p>
            <div className="mt-8 flex flex-wrap gap-3 items-center">
              <Link to="/entrar" className="h-11 px-5 rounded-lg border border-[#4a5b6c] font-medium inline-flex items-center gap-2 hover:bg-white/5">Já tenho conta · Entrar <ArrowRight size={16} /></Link>
            </div>
          </div>
          <div className="text-ink"><AccessForm /></div>
        </div>
      </section>

      <footer className="max-w-7xl mx-auto px-4 sm:px-6 py-8 flex flex-col sm:flex-row gap-3 items-center justify-between text-[13px] text-muted">
        <div className="flex items-center gap-2"><img src="/logo.svg" alt="" className="w-6 h-6" /> GPlanSiS|DOCS · gestão de documentos técnicos</div>
        <div className="flex gap-4"><Link to="/entrar" className="hover:text-ink">Entrar</Link><a href="#acesso" className="hover:text-ink">Solicitar acesso</a><a href="https://gplansis.com" className="hover:text-ink">gplansis.com</a></div>
      </footer>
    </div>
  );
}
