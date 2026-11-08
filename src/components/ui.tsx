"use client";

import { useEffect, useRef, useState } from "react";

type BotaoProps = React.ButtonHTMLAttributes<HTMLButtonElement> & {
  variante?: "primario" | "secundario" | "perigo" | "fantasma";
  tamanho?: "p" | "m" | "g";
  carregando?: boolean;
};

export function Botao({ variante = "primario", tamanho = "m", carregando, className = "", children, disabled, ...props }: BotaoProps) {
  const base =
    "inline-flex items-center justify-center gap-2 rounded-lg font-semibold transition disabled:cursor-not-allowed disabled:opacity-50 focus-visible:outline-3 focus-visible:outline-offset-2 focus-visible:outline-marca-500";
  const vars = {
    primario: "bg-marca-500 text-white hover:bg-marca-600",
    secundario: "border border-zinc-300 bg-white text-zinc-800 hover:bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-100 dark:hover:bg-zinc-800",
    perigo: "bg-red-600 text-white hover:bg-red-700",
    fantasma: "text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800",
  };
  const tams = { p: "h-8 px-3 text-sm", m: "h-10 px-4 text-[15px]", g: "h-12 px-5 text-base" };
  return (
    <button className={`${base} ${vars[variante]} ${tams[tamanho]} ${className}`} disabled={disabled || carregando} {...props}>
      {carregando && <span className="size-4 animate-spin rounded-full border-2 border-current border-t-transparent" />}
      {children}
    </button>
  );
}

export function Modal({
  aberto, aoFechar, titulo, children, largura = "max-w-2xl", rodape,
}: {
  aberto: boolean; aoFechar: () => void; titulo: string; children: React.ReactNode; largura?: string; rodape?: React.ReactNode;
}) {
  useEffect(() => {
    if (!aberto) return;
    const f = (e: KeyboardEvent) => e.key === "Escape" && aoFechar();
    document.addEventListener("keydown", f);
    return () => document.removeEventListener("keydown", f);
  }, [aberto, aoFechar]);
  if (!aberto) return null;
  return (
    <div className="fixed inset-0 z-50 flex items-end justify-center bg-black/50 p-0 sm:items-center sm:p-4" onMouseDown={(e) => e.target === e.currentTarget && aoFechar()}>
      <div role="dialog" aria-modal="true" className={`flex max-h-[92vh] w-full ${largura} flex-col rounded-t-2xl bg-white shadow-2xl sm:rounded-2xl dark:bg-zinc-900`}>
        <div className="flex items-center justify-between border-b border-zinc-200 px-5 py-3 dark:border-zinc-800">
          <h2 className="font-display text-xl font-bold uppercase tracking-wide">{titulo}</h2>
          <button onClick={aoFechar} aria-label="Fechar" className="grid size-9 place-items-center rounded-full text-xl text-zinc-500 hover:bg-zinc-100 dark:hover:bg-zinc-800">×</button>
        </div>
        <div className="overflow-y-auto px-5 py-4">{children}</div>
        {rodape && <div className="flex flex-wrap justify-end gap-2 border-t border-zinc-200 px-5 py-3 dark:border-zinc-800">{rodape}</div>}
      </div>
    </div>
  );
}

export function Selo({ cor, children }: { cor: string; children: React.ReactNode }) {
  return <span className={`inline-flex items-center whitespace-nowrap rounded-full px-2 py-0.5 text-xs font-semibold ${cor}`}>{children}</span>;
}

export function Vazio({ children }: { children: React.ReactNode }) {
  return <div className="rounded-xl border border-dashed border-zinc-300 p-8 text-center text-zinc-500 dark:border-zinc-700">{children}</div>;
}

export function Cabecalho({ titulo, sub, children }: { titulo: string; sub?: React.ReactNode; children?: React.ReactNode }) {
  return (
    <div className="mb-5 flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="titulo text-3xl">{titulo}</h1>
        {sub && <p className="text-sm text-zinc-500 dark:text-zinc-400">{sub}</p>}
      </div>
      <div className="flex flex-wrap gap-2">{children}</div>
    </div>
  );
}

/* ---------- avisos (toast) ---------- */
type Aviso = { id: number; texto: string; tipo: "ok" | "erro" };
let ouvinte: ((a: Aviso) => void) | null = null;
export function avisar(texto: string, tipo: "ok" | "erro" = "ok") {
  ouvinte?.({ id: Date.now() + Math.random(), texto, tipo });
}
export function Avisos() {
  const [lista, setLista] = useState<Aviso[]>([]);
  useEffect(() => {
    ouvinte = (a) => {
      setLista((l) => [...l, a]);
      setTimeout(() => setLista((l) => l.filter((x) => x.id !== a.id)), a.tipo === "erro" ? 6000 : 2500);
    };
    return () => { ouvinte = null; };
  }, []);
  return (
    <div className="pointer-events-none fixed inset-x-0 bottom-4 z-[60] flex flex-col items-center gap-2 px-4 nao-imprimir">
      {lista.map((a) => (
        <div key={a.id} className={`pointer-events-auto max-w-md rounded-full px-4 py-2 text-sm font-semibold shadow-lg ${a.tipo === "erro" ? "bg-red-600 text-white" : "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900"}`}>
          {a.texto}
        </div>
      ))}
    </div>
  );
}

/** Botão que pede um segundo clique para confirmar */
export function BotaoConfirmar({ aoConfirmar, children, textoConfirmar = "Confirmar?", ...props }: BotaoProps & { aoConfirmar: () => void; textoConfirmar?: string }) {
  const [armado, setArmado] = useState(false);
  const t = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (t.current) clearTimeout(t.current); }, []);
  return (
    <Botao
      {...props}
      variante={armado ? "perigo" : props.variante}
      onClick={() => {
        if (armado) { setArmado(false); aoConfirmar(); return; }
        setArmado(true);
        t.current = setTimeout(() => setArmado(false), 3000);
      }}
    >
      {armado ? textoConfirmar : children}
    </Botao>
  );
}
