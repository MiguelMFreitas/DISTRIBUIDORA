"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { erroMsg, fmtData, fmtMoeda, fmtQtd } from "@/lib/formato";
import { Botao, Cabecalho, Vazio, avisar } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";

type Linha = { vendedor_id: string; vendedor: string; pedidos: number; clientes: number; itens: number; valor: number };

/** Segunda-feira da semana de "d" */
function segunda(d: Date) {
  const x = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  x.setDate(x.getDate() - ((x.getDay() + 6) % 7));
  return x;
}
const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MEDALHA = ["🥇", "🥈", "🥉"];

function Podio({ titulo, linhas, chave, fmt }: { titulo: string; linhas: Linha[]; chave: "clientes" | "itens" | "valor"; fmt: (n: number) => string }) {
  const ord = [...linhas].sort((a, b) => Number(b[chave]) - Number(a[chave]));
  const max = Number(ord[0]?.[chave] ?? 0) || 1;
  return (
    <section className="cartao p-4">
      <h2 className="titulo mb-3 text-lg">{titulo}</h2>
      <ol className="space-y-2.5">
        {ord.map((l, i) => (
          <li key={l.vendedor_id}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={`font-semibold ${i === 0 ? "text-lg" : ""}`}>{MEDALHA[i] ?? `${i + 1}º`} {l.vendedor}</span>
              <span className="font-semibold">{fmt(Number(l[chave]))}</span>
            </div>
            <div className="mt-1 h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className={`h-2 rounded-full ${i === 0 ? "bg-marca-500" : "bg-zinc-400 dark:bg-zinc-500"}`} style={{ width: `${(Number(l[chave]) / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function Ranking() {
  const sb = supabaseNavegador();
  const [inicio, setInicio] = useState(() => segunda(new Date()));
  const [linhas, setLinhas] = useState<Linha[] | null>(null);
  const fim = useMemo(() => { const f = new Date(inicio); f.setDate(f.getDate() + 6); return f; }, [inicio]);

  useEffect(() => {
    setLinhas(null);
    sb.rpc("ranking_vendedores", { p_inicio: iso(inicio), p_fim: iso(fim) }).then(({ data, error }) => {
      if (error) avisar(erroMsg(error), "erro");
      setLinhas((data ?? []) as Linha[]);
    });
  }, [sb, inicio, fim]);

  const mudar = (dias: number) => setInicio((d) => { const x = new Date(d); x.setDate(x.getDate() + dias); return x; });
  const estaSemana = iso(inicio) === iso(segunda(new Date()));

  return (
    <Exige admin>
      <Cabecalho titulo="Ranking semanal" sub={`${fmtData(iso(inicio))} a ${fmtData(iso(fim))}${estaSemana ? " (esta semana)" : ""}. Não conta pedidos cancelados ou recusados.`}>
        <Botao variante="secundario" onClick={() => mudar(-7)}>← Semana anterior</Botao>
        <Botao variante="secundario" onClick={() => mudar(7)} disabled={estaSemana}>Próxima →</Botao>
      </Cabecalho>
      {linhas === null ? <div className="cartao p-8 text-center text-zinc-500">Carregando…</div> : linhas.length === 0 ? <Vazio>Nenhuma venda nesta semana.</Vazio> : (
        <div className="grid gap-4 lg:grid-cols-3">
          <Podio titulo="Mais clientes atendidos" linhas={linhas} chave="clientes" fmt={(n) => `${n} cliente${n === 1 ? "" : "s"}`} />
          <Podio titulo="Mais itens vendidos" linhas={linhas} chave="itens" fmt={(n) => fmtQtd(n)} />
          <Podio titulo="Maior valor vendido" linhas={linhas} chave="valor" fmt={fmtMoeda} />
        </div>
      )}
    </Exige>
  );
}
