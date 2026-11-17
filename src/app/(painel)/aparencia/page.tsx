"use client";

import { useEffect, useState } from "react";
import { Botao, Cabecalho, avisar } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";
import { usarParaTodos } from "@/components/visual";
import {
  LAYOUTS, VISUAIS, comecarPrevia, comecarPreviaLayout, layoutPrevia, layoutSalvo, sairPrevia, visualPrevia, visualSalvo,
  type IdLayout, type IdVisual, type Layout, type Visual,
} from "@/lib/visual";

/** Desenho pequeno do sistema com as cores do visual */
function Miniatura({ v }: { v: Visual }) {
  const m = v.mini;
  const titulo = m.titulo === "condensado"
    ? { fontFamily: "var(--font-barlow-condensed)", textTransform: "uppercase" as const, letterSpacing: "0.03em", fontWeight: 700 }
    : { fontFamily: v.id === "verde" ? "var(--font-poppins)" : "var(--font-inter)", fontWeight: v.id === "verde" ? 600 : 700 };
  const ativo = v.id === "azul" ? { background: "#eff6ff", color: m.marca } : v.id === "vermelho" ? { background: "#fff", color: "#b91c1c" } : { background: m.marca, color: v.id === "escuro" ? "#18181b" : "#fff" };
  return (
    <div className="flex h-44 overflow-hidden rounded-xl border" style={{ borderColor: m.borda, background: m.fundo }} aria-hidden>
      <div className="flex w-[34%] flex-col gap-1.5 p-2" style={{ background: m.menu, borderRight: v.id === "azul" ? `1px solid ${m.borda}` : undefined }}>
        <div className="truncate text-[11px]" style={{ ...titulo, color: v.id === "azul" ? m.marca : v.id === "escuro" ? m.marca : "#fff" }}>Distribuidora</div>
        <div className="rounded px-1.5 py-1 text-[9px] font-semibold" style={ativo}>🏠 Início</div>
        {["📋 Pedidos", "🚚 Cargas", "🏪 Clientes", "📦 Produtos"].map((t) => <div key={t} className="px-1.5 text-[9px]" style={{ color: m.menuTexto }}>{t}</div>)}
      </div>
      <div className="flex-1 space-y-1.5 p-2.5" style={{ color: m.texto }}>
        <div className="text-[15px] leading-none" style={titulo}>Olá, Miguel</div>
        <div className="grid grid-cols-2 gap-1.5">
          {[["Pedidos hoje", "42"], ["Sem carga", "7"]].map(([a, b]) => (
            <div key={a} className="p-1.5" style={{ background: m.cartao, border: `1px solid ${m.borda}`, borderTop: v.id === "vermelho" ? `2px solid ${m.marca}` : undefined, borderRadius: v.id === "vermelho" ? 4 : v.id === "classico" ? 6 : 9 }}>
              <div className="text-[7px] uppercase opacity-60">{a}</div>
              <div className="text-[15px] leading-tight" style={titulo}>{b}</div>
            </div>
          ))}
        </div>
        <div className="p-1.5 text-[8px]" style={{ background: m.cartao, border: `1px solid ${m.borda}`, borderRadius: v.id === "vermelho" ? 4 : v.id === "classico" ? 6 : 9 }}>
          <div className="flex justify-between"><span>Nº 128 · Bar do Zé</span><b>R$ 245,00</b></div>
          <div className="flex justify-between opacity-70"><span>Nº 129 · Mercadinho</span><b>R$ 98,50</b></div>
        </div>
        <div className="inline-block rounded px-2 py-1 text-[9px] font-bold" style={{ background: m.marca, color: v.id === "escuro" ? "#18181b" : "#fff" }}>+ Novo pedido</div>
      </div>
    </div>
  );
}

/** Desenho pequeno do layout (computador e celular), nas cores que estão em uso */
function MiniLayout({ l }: { l: Layout }) {
  const menu = { background: "var(--menu-fundo)" };
  const linha = (w: string, forte = false) => <div className="h-1.5 rounded-full" style={{ width: w, background: forte ? "var(--color-marca-500)" : "var(--menu-texto)", opacity: forte ? 1 : 0.55 }} />;
  const cartoes = (
    <div className="grid flex-1 grid-cols-3 gap-1.5 p-2">
      {[0, 1, 2].map((k) => <div key={k} className="h-7 rounded border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800" />)}
      <div className="col-span-3 h-12 rounded border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800" />
    </div>
  );
  const abas = (
    <div className="flex gap-2 border-b border-zinc-200 bg-white px-2 pt-1.5 dark:border-zinc-700 dark:bg-zinc-900">
      {["Novo", "Balcão", "Pedidos", "Link"].map((t, k) => <div key={t} className={`pb-1 text-[7px] font-bold ${k === 2 ? "border-b-2 border-marca-500 text-marca-600" : "text-zinc-400"}`}>{t}</div>)}
    </div>
  );
  const computador = (
    <div className="flex h-32 flex-1 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-100 dark:border-zinc-700 dark:bg-zinc-950">
      {l.id === "lateral" && <><div className="flex w-[26%] flex-col gap-1.5 p-2" style={menu}>{linha("70%")}{linha("85%", true)}{[60, 75, 55, 80, 65, 70, 50, 75].map((w, k) => <div key={k}>{linha(`${w}%`)}</div>)}</div>{cartoes}</>}
      {l.id === "grupos" && <><div className="flex w-[26%] flex-col gap-1 p-2" style={menu}>{linha("70%")}<div className="my-0.5 h-2.5 rounded" style={{ background: "var(--menu-hover-fundo)", border: "1px solid var(--menu-divisor)" }} />{["VENDAS", "ENTREGAS", "CLIENTES"].map((g, k) => <div key={g} className="space-y-1"><div className="text-[6px] font-bold" style={{ color: "var(--menu-texto-fraco)" }}>{g}</div>{linha("75%", k === 0)}{linha("60%")}</div>)}</div>{cartoes}</>}
      {l.id === "topo" && <div className="flex flex-1 flex-col"><div className="flex h-5 items-center gap-1.5 px-2" style={{ background: "var(--topo-fundo)" }}>{[28, 18, 22, 20, 18].map((w, k) => <div key={k} className="h-1.5 rounded-full" style={{ width: w, background: "var(--topo-texto)", opacity: k === 2 ? 1 : 0.5 }} />)}</div>{cartoes}</div>}
      {l.id === "areas" && <><div className="flex w-[11%] flex-col items-center gap-1.5 py-2" style={menu}><div className="size-3.5 rounded bg-marca-500" />{[0, 1, 2, 3, 4].map((k) => <div key={k} className="size-3 rounded" style={{ background: k === 1 ? "var(--menu-ativo-fundo)" : "var(--menu-texto)", opacity: k === 1 ? 1 : 0.4 }} />)}</div><div className="flex flex-1 flex-col">{abas}{cartoes}</div></>}
    </div>
  );
  const celular = (
    <div className="flex h-32 w-[62px] shrink-0 flex-col overflow-hidden rounded-xl border-2 border-zinc-300 bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-950">
      <div className="flex h-4 items-center justify-between px-1.5" style={{ background: "var(--topo-fundo)" }}>
        <div className="h-1 w-6 rounded-full" style={{ background: "var(--topo-texto)" }} />
        {l.id === "lateral" && <div className="h-2 w-3 rounded-sm border" style={{ borderColor: "var(--topo-texto)" }} />}
      </div>
      {l.id === "areas" && <div className="flex gap-1 border-b border-zinc-200 bg-white px-1 py-0.5 dark:border-zinc-700 dark:bg-zinc-900">{[0, 1, 2].map((k) => <div key={k} className={`h-1 w-3 rounded-full ${k === 1 ? "bg-marca-500" : "bg-zinc-300"}`} />)}</div>}
      <div className="flex-1 space-y-1 p-1">{[0, 1, 2].map((k) => <div key={k} className="h-4 rounded-sm border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-800" />)}</div>
      {l.id !== "lateral" && <div className="flex h-4 items-center justify-around border-t border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">{[0, 1, 2, 3, 4].map((k) => <div key={k} className={`size-1.5 rounded-full ${k === 0 ? "bg-marca-500" : "bg-zinc-300"}`} />)}</div>}
    </div>
  );
  return <div className="flex items-end gap-2" aria-hidden>{computador}{celular}</div>;
}

export default function Aparencia() {
  const [emUso, setEmUso] = useState<IdVisual | null>(null);
  const [previa, setPrevia] = useState<IdVisual | null>(null);
  const [layoutEmUso, setLayoutEmUso] = useState<IdLayout | null>(null);
  const [layoutVendo, setLayoutVendo] = useState<IdLayout | null>(null);
  const [salvando, setSalvando] = useState<string | null>(null);

  useEffect(() => {
    const ler = () => { setEmUso(visualSalvo()); setPrevia(visualPrevia()); setLayoutEmUso(layoutSalvo()); setLayoutVendo(layoutPrevia()); };
    ler();
    window.addEventListener("visual-mudou", ler);
    return () => window.removeEventListener("visual-mudou", ler);
  }, []);

  async function usar(v: Visual) {
    setSalvando(v.id);
    if (await usarParaTodos({ visual: v.id })) avisar(`Cores “${v.nome}” ligadas para todos os aparelhos`);
    setSalvando(null);
  }
  async function usarLayout(l: Layout) {
    setSalvando(l.id);
    if (await usarParaTodos({ layout: l.id })) avisar(`Layout “${l.nome}” ligado para todos os aparelhos`);
    setSalvando(null);
  }

  return (
    <Exige admin>
      <Cabecalho titulo="Aparência" sub="Escolha o layout (onde fica o menu) e as cores. Pode juntar qualquer layout com qualquer cor. “Ver no sistema” muda só no seu aparelho para você andar pelas telas; “Usar para todos” muda o computador e o celular de todo mundo." />

      <h2 className="titulo mb-1 text-xl">Layout</h2>
      <p className="mb-3 text-sm text-zinc-500">Onde fica o menu e como se anda pelas telas.</p>
      <div className="mb-8 grid gap-4 sm:grid-cols-2">
        {LAYOUTS.map((l, i) => {
          const usando = layoutEmUso === l.id, vendo = layoutVendo === l.id;
          return (
            <div key={l.id} className={`cartao space-y-3 p-4 ${usando ? "ring-2 ring-marca-500" : ""}`}>
              <MiniLayout l={l} />
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-bold">{String.fromCharCode(65 + i)}. {l.nome}</h3>
                  {usando && <span className="rounded-full bg-marca-500 px-2 py-0.5 text-xs font-bold text-white">✓ Em uso</span>}
                  {vendo && !usando && <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-bold dark:bg-zinc-700">👀 Vendo agora</span>}
                </div>
                <p className="text-sm text-zinc-500">{l.descricao}</p>
                <p className="text-sm text-zinc-500">📱 {l.celular}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {vendo
                  ? <Botao variante="secundario" onClick={() => sairPrevia()}>Sair da prévia</Botao>
                  : !usando && <Botao variante="secundario" onClick={() => comecarPreviaLayout(l.id)}>Ver no sistema</Botao>}
                {!usando && <Botao onClick={() => usarLayout(l)} carregando={salvando === l.id}>Usar para todos</Botao>}
              </div>
            </div>
          );
        })}
      </div>

      <h2 className="titulo mb-1 text-xl">Cores</h2>
      <p className="mb-3 text-sm text-zinc-500">As cores, a letra dos títulos e o jeito dos cartões.</p>
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {VISUAIS.map((v, i) => {
          const usando = emUso === v.id, vendo = previa === v.id;
          return (
            <div key={v.id} className={`cartao space-y-3 p-4 ${usando ? "ring-2 ring-marca-500" : ""}`}>
              <Miniatura v={v} />
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h3 className="text-lg font-bold">{i + 1}. {v.nome}</h3>
                  {usando && <span className="rounded-full bg-marca-500 px-2 py-0.5 text-xs font-bold text-white">✓ Em uso</span>}
                  {vendo && !usando && <span className="rounded-full bg-zinc-200 px-2 py-0.5 text-xs font-bold dark:bg-zinc-700">👀 Vendo agora</span>}
                </div>
                <p className="text-sm text-zinc-500">{v.descricao}</p>
              </div>
              <div className="flex flex-wrap gap-2">
                {vendo
                  ? <Botao variante="secundario" onClick={() => sairPrevia()}>Sair da prévia</Botao>
                  : !usando && <Botao variante="secundario" onClick={() => comecarPrevia(v.id)}>Ver no sistema</Botao>}
                {!usando && <Botao onClick={() => usar(v)} carregando={salvando === v.id}>Usar para todos</Botao>}
              </div>
            </div>
          );
        })}
      </div>
      <p className="mt-4 text-sm text-zinc-500">O layout vale para as telas do sistema. O app do vendedor no celular continua do jeito dele (só as cores acompanham) e as folhas impressas (romaneio, pedidos, recibos) não mudam.</p>
    </Exige>
  );
}
