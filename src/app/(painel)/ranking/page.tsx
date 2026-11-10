"use client";

import { useEffect, useMemo, useState } from "react";
import { supabaseNavegador } from "@/lib/supabase/client";
import { combina, erroMsg, fmtMoeda, fmtQtd } from "@/lib/formato";
import { Botao, Cabecalho, Vazio, avisar } from "@/components/ui";
import { Exige } from "@/components/perfil-contexto";

type Periodo = "semana" | "mes";
type Aba = "vendedores" | "clientes";
type LinhaV = { vendedor_id: string; vendedor: string; pedidos: number; clientes: number; itens: number; valor: number };
type LinhaC = { cliente_id: string; cliente: string; fantasia: string | null; bairro: string | null; rota: string | null; vendedor: string | null; pedidos: number; itens: number; caixas: number; valor: number };

const iso = (d: Date) => `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;
const MEDALHA = ["🥇", "🥈", "🥉"];
const n = (v: unknown) => Number(v ?? 0);

function intervalo(p: Periodo, ref: Date): [Date, Date] {
  const d = new Date(ref.getFullYear(), ref.getMonth(), ref.getDate());
  if (p === "semana") {
    const ini = new Date(d); ini.setDate(d.getDate() - ((d.getDay() + 6) % 7));
    const fim = new Date(ini); fim.setDate(ini.getDate() + 6);
    return [ini, fim];
  }
  return [new Date(d.getFullYear(), d.getMonth(), 1), new Date(d.getFullYear(), d.getMonth() + 1, 0)];
}

/** Pódio: lista ordenada pelo critério, com barra proporcional ao 1º */
function Podio<T>({ titulo, linhas, valor, nome, sub, fmt, desempate, limite = 10 }: {
  titulo: string; linhas: T[]; valor: (l: T) => number; nome: (l: T) => string; sub?: (l: T) => string; fmt: (n: number) => string;
  desempate?: (l: T) => number; limite?: number;
}) {
  const ord = [...linhas].sort((a, b) => valor(b) - valor(a) || (desempate ? desempate(b) - desempate(a) : 0)).slice(0, limite);
  const max = valor(ord[0]) || 1;
  return (
    <section className="cartao p-4">
      <h2 className="titulo mb-3 text-lg">{titulo}</h2>
      <ol className="space-y-2.5">
        {ord.map((l, i) => (
          <li key={i}>
            <div className="flex items-baseline justify-between gap-2">
              <span className={`min-w-0 truncate font-semibold ${i === 0 ? "text-lg" : ""}`}>{MEDALHA[i] ?? `${i + 1}º`} {nome(l)}</span>
              <span className="shrink-0 font-semibold">{fmt(valor(l))}</span>
            </div>
            {sub && <div className="truncate text-xs text-zinc-500">{sub(l)}</div>}
            <div className="mt-1 h-2 rounded-full bg-zinc-100 dark:bg-zinc-800">
              <div className={`h-2 rounded-full ${i === 0 ? "bg-marca-500" : "bg-zinc-400 dark:bg-zinc-500"}`} style={{ width: `${(valor(l) / max) * 100}%` }} />
            </div>
          </li>
        ))}
      </ol>
    </section>
  );
}

export default function Ranking() {
  const sb = supabaseNavegador();
  const [aba, setAba] = useState<Aba>("clientes");
  const [periodo, setPeriodo] = useState<Periodo>("semana");
  const [ref, setRef] = useState(() => new Date());
  const [vends, setVends] = useState<LinhaV[] | null>(null);
  const [clis, setClis] = useState<LinhaC[] | null>(null);
  const [busca, setBusca] = useState("");
  const [ordem, setOrdem] = useState<"pedidos" | "itens" | "valor">("valor");

  const [ini, fim] = useMemo(() => intervalo(periodo, ref), [periodo, ref]);
  const atual = iso(intervalo(periodo, new Date())[0]) === iso(ini);

  useEffect(() => {
    setVends(null); setClis(null);
    sb.rpc("ranking_vendedores", { p_inicio: iso(ini), p_fim: iso(fim) }).then(({ data, error }) => {
      if (error) avisar(erroMsg(error), "erro");
      setVends((data ?? []) as LinhaV[]);
    });
    sb.rpc("ranking_clientes", { p_inicio: iso(ini), p_fim: iso(fim) }).then(({ data, error }) => {
      if (error) avisar(erroMsg(error), "erro");
      setClis((data ?? []) as LinhaC[]);
    });
  }, [sb, ini, fim]);

  function mover(passo: number) {
    const d = new Date(ref);
    if (periodo === "semana") d.setDate(d.getDate() + 7 * passo); else d.setMonth(d.getMonth() + passo, 1);
    setRef(d);
  }

  const tituloPeriodo = periodo === "semana"
    ? `${ini.toLocaleDateString("pt-BR")} a ${fim.toLocaleDateString("pt-BR")}${atual ? " (esta semana)" : ""}`
    : (() => { const m = ini.toLocaleDateString("pt-BR", { month: "long", year: "numeric" }); return m[0].toUpperCase() + m.slice(1) + (atual ? " (este mês)" : ""); })();

  const tabelaClientes = useMemo(() => {
    let l = clis ?? [];
    if (busca.trim()) l = l.filter((c) => combina(`${c.cliente} ${c.fantasia ?? ""} ${c.bairro ?? ""} ${c.rota ?? ""}`, busca));
    return [...l].sort((a, b) => n(b[ordem]) - n(a[ordem]) || n(b.valor) - n(a.valor));
  }, [clis, busca, ordem]);
  const posicao = useMemo(() => new Map([...(clis ?? [])].sort((a, b) => n(b[ordem]) - n(a[ordem]) || n(b.valor) - n(a.valor)).map((c, i) => [c.cliente_id, i + 1])), [clis, ordem]);

  const nomeCli = (c: LinhaC) => c.fantasia || c.cliente;
  const subCli = (c: LinhaC) => [c.rota, c.bairro !== c.rota ? c.bairro : null].filter(Boolean).join(" · ");
  const th = "px-3 py-2 font-semibold";

  return (
    <Exige admin>
      <Cabecalho titulo="Ranking" sub={`${tituloPeriodo}. Não conta pedidos cancelados ou recusados.`}>
        <div className="flex rounded-lg border border-zinc-300 bg-white p-0.5 dark:border-zinc-700 dark:bg-zinc-900" role="group" aria-label="Período">
          {([["semana", "Semana"], ["mes", "Mês"]] as const).map(([k, t]) => (
            <button key={k} onClick={() => setPeriodo(k)} aria-pressed={periodo === k} className={`rounded-md px-4 py-1.5 text-sm font-semibold ${periodo === k ? "bg-marca-500 text-white" : "text-zinc-600 dark:text-zinc-300"}`}>{t}</button>
          ))}
        </div>
        <Botao variante="secundario" onClick={() => mover(-1)} aria-label="Período anterior">←</Botao>
        <Botao variante="secundario" onClick={() => setRef(new Date())} disabled={atual}>{periodo === "semana" ? "Esta semana" : "Este mês"}</Botao>
        <Botao variante="secundario" onClick={() => mover(1)} disabled={atual} aria-label="Próximo período">→</Botao>
      </Cabecalho>

      <div className="mb-4 flex gap-2" role="tablist">
        {([["clientes", "🏪 Clientes"], ["vendedores", "👤 Vendedores"]] as const).map(([k, t]) => (
          <button key={k} role="tab" aria-selected={aba === k} onClick={() => setAba(k)}
            className={`rounded-full px-5 py-2 font-semibold ${aba === k ? "bg-zinc-900 text-white dark:bg-white dark:text-zinc-900" : "bg-white text-zinc-700 dark:bg-zinc-900 dark:text-zinc-300"}`}>{t}</button>
        ))}
      </div>

      {aba === "vendedores" ? (
        vends === null ? <div className="cartao p-8 text-center text-zinc-500">Carregando…</div> : vends.length === 0 ? <Vazio>Nenhuma venda neste período.</Vazio> : (
          <div className="grid gap-4 lg:grid-cols-3">
            <Podio titulo="Mais clientes atendidos" linhas={vends} valor={(l) => n(l.clientes)} nome={(l) => l.vendedor} fmt={(x) => `${x} cliente${x === 1 ? "" : "s"}`} />
            <Podio titulo="Mais itens vendidos" linhas={vends} valor={(l) => n(l.itens)} nome={(l) => l.vendedor} fmt={fmtQtd} />
            <Podio titulo="Maior valor vendido" linhas={vends} valor={(l) => n(l.valor)} nome={(l) => l.vendedor} fmt={fmtMoeda} />
          </div>
        )
      ) : clis === null ? <div className="cartao p-8 text-center text-zinc-500">Carregando…</div> : clis.length === 0 ? <Vazio>Nenhum cliente comprou neste período.</Vazio> : (
        <div className="space-y-6">
          <div className="grid gap-4 lg:grid-cols-3">
            <Podio titulo="Compraram mais vezes" linhas={clis} valor={(l) => n(l.pedidos)} desempate={(l) => n(l.valor)} nome={nomeCli} sub={subCli} fmt={(x) => `${x} pedido${x === 1 ? "" : "s"}`} />
            <Podio titulo="Compraram mais itens" linhas={clis} valor={(l) => n(l.itens)} desempate={(l) => n(l.valor)} nome={nomeCli} sub={(l) => `${subCli(l)}${n(l.caixas) ? ` · ${fmtQtd(l.caixas)} cx` : ""}`} fmt={fmtQtd} />
            <Podio titulo="Compraram mais em R$" linhas={clis} valor={(l) => n(l.valor)} nome={nomeCli} sub={subCli} fmt={fmtMoeda} />
          </div>

          <section>
            <div className="mb-2 flex flex-wrap items-end justify-between gap-2">
              <h2 className="titulo text-lg">Todos os clientes ({clis.length})</h2>
              <div className="flex flex-wrap gap-2">
                <input className="campo max-w-xs" placeholder="🔍 Pesquisar cliente ou bairro" value={busca} onChange={(e) => setBusca(e.target.value)} aria-label="Pesquisar cliente" />
                <select className="campo w-auto!" value={ordem} onChange={(e) => setOrdem(e.target.value as typeof ordem)} aria-label="Ordenar por">
                  <option value="valor">Ordenar por valor (R$)</option>
                  <option value="pedidos">Ordenar por vezes que comprou</option>
                  <option value="itens">Ordenar por itens</option>
                </select>
              </div>
            </div>
            <div className="cartao overflow-x-auto">
              <table className="w-full text-[15px]">
                <thead className="border-b border-zinc-200 text-left text-xs uppercase text-zinc-500 dark:border-zinc-800">
                  <tr><th className={th}>#</th><th className={th}>Cliente</th><th className={th}>Bairro</th><th className={th}>Vendedor</th><th className={`${th} text-right`}>Vezes</th><th className={`${th} text-right`}>Itens</th><th className={`${th} text-right`}>Valor</th></tr>
                </thead>
                <tbody className="[&_td]:border-b [&_td]:border-zinc-100 [&_td]:px-3 [&_td]:py-2 dark:[&_td]:border-zinc-800 [&_tr:last-child_td]:border-0">
                  {tabelaClientes.map((c) => {
                    const pos = posicao.get(c.cliente_id)!;
                    return (
                      <tr key={c.cliente_id}>
                        <td className="font-semibold text-zinc-500">{MEDALHA[pos - 1] ?? `${pos}º`}</td>
                        <td><div className="font-semibold">{c.cliente}</div>{c.fantasia && <div className="text-xs text-zinc-500">{c.fantasia}{c.bairro ? ` · ${c.bairro}` : ""}</div>}</td>
                        <td>{c.rota ?? "—"}</td>
                        <td>{c.vendedor ?? "—"}</td>
                        <td className={`text-right ${ordem === "pedidos" ? "font-bold" : ""}`}>{c.pedidos}</td>
                        <td className={`text-right whitespace-nowrap ${ordem === "itens" ? "font-bold" : ""}`}>{fmtQtd(c.itens)}</td>
                        <td className={`text-right whitespace-nowrap ${ordem === "valor" ? "font-bold" : ""}`}>{fmtMoeda(c.valor)}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <p className="mt-1 text-xs text-zinc-500">Só aparecem clientes que compraram no período. “Vezes” = quantidade de pedidos. Itens = caixas, fardos e litros somados.</p>
          </section>
        </div>
      )}
    </Exige>
  );
}
