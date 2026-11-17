"use client";

import { useEffect, useState } from "react";
import { Botao, Cabecalho, avisar } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";
import { usarParaTodos } from "@/components/visual";
import { VISUAIS, comecarPrevia, sairPrevia, visualPrevia, visualSalvo, type IdVisual, type Visual } from "@/lib/visual";

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

export default function Aparencia() {
  const [emUso, setEmUso] = useState<IdVisual | null>(null);
  const [previa, setPrevia] = useState<IdVisual | null>(null);
  const [salvando, setSalvando] = useState<IdVisual | null>(null);

  useEffect(() => {
    const ler = () => { setEmUso(visualSalvo()); setPrevia(visualPrevia()); };
    ler();
    window.addEventListener("visual-mudou", ler);
    return () => window.removeEventListener("visual-mudou", ler);
  }, []);

  async function usar(v: Visual) {
    setSalvando(v.id);
    if (await usarParaTodos(v.id)) avisar(`Visual “${v.nome}” ligado para todos os aparelhos`);
    setSalvando(null);
  }

  return (
    <Exige admin>
      <Cabecalho titulo="Aparência" sub="Escolha o visual do sistema. Toque em “Ver no sistema” para andar pelas telas com ele (só no seu aparelho); quando gostar, “Usar para todos” muda o computador e o celular de todo mundo." />
      <div className="grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
        {VISUAIS.map((v, i) => {
          const usando = emUso === v.id, vendo = previa === v.id;
          return (
            <div key={v.id} className={`cartao space-y-3 p-4 ${usando ? "ring-2 ring-marca-500" : ""}`}>
              <Miniatura v={v} />
              <div>
                <div className="flex items-center justify-between gap-2">
                  <h2 className="text-lg font-bold">{i + 1}. {v.nome}</h2>
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
      <p className="mt-4 text-sm text-zinc-500">As folhas impressas (romaneio, pedidos, recibos) não mudam: continuam iguais em qualquer visual.</p>
    </Exige>
  );
}
